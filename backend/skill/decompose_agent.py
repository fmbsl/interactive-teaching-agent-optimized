"""知识点分解 agent:把一个 STEM 知识点递归分解,输出知识谱系图(只有前置依赖,无包含关系)。

核心语义(节点替换 + 全连剪枝):
- 图里只有一种边:prerequisite_of(A->B 表示"先学 A 才能学 B")。没有 decomposes_into。
- 分解 = 节点替换:把概念 X 拆成子概念 {c1,c2,...} 后,X 从图里删除,变成"集合标签"
  贴在子节点身上(子节点 sets 继承 X.sets + [X.title])。X 原有的入边/出边全连接到子节点
  (Y->X => Y->c1,Y->c2,...;X->Z => c1->Z,c2->Z,...),然后让 LLM 剪掉语义不成立的冗余边
  (但每个上游/下游至少保留一条,防丢依赖)。原子概念(旋度)不拆,作为叶节点保留。
- root 是普通节点;拆则消失变集合标签,不拆则留作叶(如"旋度")。

同物异名:
- children/prereqs 每项可带 aliases。去重按 标题+别名 匹配(后端字面兜底)。
- 拆分时把当前所有节点清单喂给 LLM 做语义归一(LLM 看着清单决定复用还是新增)。

环检测:每条边加入前 has_path 检查,成环则拒。

事件 kind:decompose_start / tool_call / tool_result / node / node_replaced / edge / edge_removed /
graph / error。node/edge/graph 事件经 _EMIT side-channel,run_decompose_agent 在每个 ToolMessage
前 drain,parentId 桥接到触发它的 tool_call(@tool 函数不能 yield)。

_split_replace 是核心替换函数,LLM 工具(expand_node)和手动拆分端点(/api/decompose/<sid>/split)共用。
agent="decompose",独立 _SAVER + thread_id="decompose#{sid}"。
不写 _SESSIONS、不调 save_state(轻量;落盘走 sessions/decompose/ 子目录,由 views 传 sub_dir)。
"""
from __future__ import annotations
from typing import Optional
from collections import defaultdict

from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from .manim_lesson import _get_runtime_cfg
from .debug_log import dlog
import threading as _threading


# 每会话一份图草稿 + 事件 side-channel 队列
_GRAPHS: dict[str, dict] = defaultdict(lambda: {
    "nodes": {},        # id -> {title, aliases, sets, mastery, depth}
    "edges": set(),     # (from_id, to_id),只有 prerequisite_of
    "frontier": [],     # 待拆节点 id 列表
    "title_index": {},  # 标题/别名 -> id(去重用,只含当前存活节点)
})
_EMIT: dict[str, list[dict]] = defaultdict(list)
_LOCKS: dict[str, _threading.Lock] = defaultdict(_threading.Lock)  # 每会话一把锁,防并行 tool_call 改图竞态
import uuid as _uuid
import json as _json
import re as _re

MAX_DEPTH = 4
MAX_NODES = 80
# 单次分解允许的 expand_node 次数上限(限时:每轮 = 一次 LLM 调用,叠太多耗时太长)。
# 触顶后清理 frontier,提示 agent 调 finish() 收尾。
MAX_EXPAND = 8


def _new_id() -> str:
    return _uuid.uuid4().hex[:12]


DECOMPOSE_PROMPT = """你是知识点分解 agent。把用户给的 STEM 知识点递归分解为知识谱系图。

**核心语义(重要)**:
- 图里只有一种关系:前置依赖 A->B(先学 A 才能学 B)。**没有"包含"关系**。
- 分解 = 节点替换:把概念拆成子概念后,原节点从图里消失,变成"集合标签"贴在子节点身上。
  例:"线性代数"拆成 {行列式, 矩阵, 线性变换} 后,"线性代数"节点消失,三个子节点身上都贴"线性代数"标签。
  再拆"矩阵"成 {矩阵运算, 逆矩阵} 后,"矩阵"消失,其子节点身上贴"线性代数""矩阵"两个标签。
- 原子概念(旋度、勾股定理、导数定义)不拆,作为叶节点保留在图里。

**工具**:
- expand_node(target, children, prereqs, deps):拆分 frontier 中的 target(标题)。
  - children:target 拆出的子概念。每项 {"title": str, "mastery": bool, "aliases": [str,...](可选)}。
    原子概念给 [](不拆)。
  - prereqs:外部前置知识(不在 children 里,是 target 及子概念依赖的外部概念)。每项同上。命中【已掌握清单】的 mastery=true。
  - deps:前置依赖关系。每项 {"from": "先学的标题", "to": "后学的标题"}。from/to 取自 children、prereqs 或 target 自身。
    例:矩阵 需先学 行列式 -> {"from":"行列式","to":"矩阵"};旋度 需先学 矢量场 -> {"from":"矢量场","to":"旋度"}。
- finish():frontier 空了调,完成。

**同物异名(关键)**:
- 同一事物的不同称呼(如 PCA = 主成分分析)用**同一个标题**+ aliases 列出别名,系统会合并,不要建两个节点。
- **相关但不同**的概念(如 PCA 和 SVD:PCA 用 SVD 实现,但二者是不同算法)应建**两个节点**,用 deps 连依赖。不要把相关概念强行合并成同一个。
- 拆分时系统会把当前图里所有已有节点清单给你看,请据此判断新概念是复用已有还是新增。

**递归规则**:
1. target 是原子概念(旋度/勾股定理)-> children=[],prereqs 给它的前置,deps 给 "前置->target"。
2. target 是复杂体系(线性代数/傅里叶变换)-> children 给 3-6 个子概念,deps 给子概念间及前置间的依赖。target 拆完消失。
3. 命中【已掌握清单】-> mastery=true,该节点不再展开(变叶)。
4. 工具返回当前 frontier(待拆标题列表)。挑一个继续 expand_node。frontier 空了调 finish()。

**铁律**:
- **每次只调一个 expand_node**(等它返回后再调下一个)。不要一轮发多个 expand_node 调用。
- **不要把 target 本身作为 children 或 prereqs**(target 是被拆的对象,不能是自己的子/前置)。如问"什么是旋度",target="什么是旋度",不要把"旋度"作为 child/prereq。
- children/prereqs 的标题必须是**与 target 不同**的新概念。

**【已掌握清单(高中毕业水平,命中即 mastery=true,停止该分支)】**
- 初等代数:整数/分数/指数/对数运算、一元一次/二次方程、多项式因式分解、不等式
- 函数:一次/二次/反比例/指数/对数/幂函数的定义与图像、定义域值域、单调性奇偶性
- 基本几何:平面图形面积体积、相似与全等三角形、坐标平面、两点距离与斜率、勾股定理
- 三角函数:sin/cos/tan 定义、单位圆、基本恒等式、正弦定理余弦定理
- 向量基础:二维向量加减、数乘、点积、模长
- 一元微积分基础:极限的直观概念、导数定义与基本求导法则(幂/乘积/链式)、定积分与面积、微积分基本定理
- 概率统计基础:频率与概率、均值方差标准差、基本计数(排列组合)
- 集合与逻辑:集合运算、命题、充分必要条件

**示例**:
- 问"什么是旋度":旋度原子不拆。expand_node(target="旋度", children=[], prereqs=[{"title":"矢量场","mastery":false},{"title":"偏导数","mastery":false},{"title":"向量叉乘","mastery":false}], deps=[{"from":"矢量场","to":"旋度"},{"from":"偏导数","to":"旋度"},{"from":"向量叉乘","to":"旋度"}])。然后递归展开"矢量场"(prereqs 含"向量基础"mastery=true->停)等。frontier 空后 finish。
- 问"线性代数":expand_node(target="线性代数", children=[{"title":"行列式","mastery":false},{"title":"矩阵","mastery":false},{"title":"线性变换","mastery":false},{"title":"特征值与特征向量","mastery":false}], prereqs=[], deps=[{"from":"行列式","to":"矩阵"},{"from":"行列式","to":"线性变换"},{"from":"矩阵","to":"特征值与特征向量"},{"from":"线性变换","to":"特征值与特征向量"}])。线性代数消失,四个子节点贴"线性代数"标签。然后逐个展开子节点。

全程中文。标题 4-16 字,简短。
"""


# ---------------- 图操作工具函数 ----------------

def _resolve_existing(sid: str, title: str, aliases: list[str] | None = None) -> Optional[str]:
    """按 标题+别名 在当前存活节点里查 id。找不到返 None。"""
    G = _GRAPHS[sid]
    ti = G["title_index"]
    for name in [title] + list(aliases or []):
        nid = ti.get(name)
        if nid and nid in G["nodes"]:  # 存活(未被删除)
            return nid
    return None


# 已掌握清单关键词(与系统提示词的【已掌握清单】对齐)。LLM 返回 mastery=true 时在此校验:
# 标题/别名命中这些关键词才允许 mastery=true,否则强制 false(防 LLM 泛化误标,如把"矩阵"当高中已掌握)。
_MASTERY_KEYWORDS = [
    # 初等代数
    "整数", "分数", "指数", "对数", "一元一次", "一元二次", "方程", "因式分解", "多项式", "不等式",
    # 函数
    "一次函数", "二次函数", "反比例", "指数函数", "对数函数", "幂函数", "定义域", "值域", "单调", "奇偶",
    "函数",
    # 基本几何
    "面积", "体积", "相似", "全等", "坐标平面", "两点距离", "斜率", "勾股定理",
    # 三角函数
    "sin", "cos", "tan", "正弦", "余弦", "正切", "单位圆", "正弦定理", "余弦定理", "三角",
    # 向量基础
    "向量", "数乘", "点积", "模长",
    # 一元微积分基础(高中水平:极限直观 + 基本求导 + 定积分面积)
    "极限", "导数", "求导", "定积分", "微积分基本定理",
    # 概率统计基础
    "频率", "概率", "均值", "方差", "标准差", "排列", "组合", "计数",
    # 集合与逻辑
    "集合", "命题", "充分", "必要",
]


def _in_mastery_list(title: str, aliases: list[str] | None = None) -> bool:
    """判断标题/别名是否命中已掌握清单(高中毕业水平)。用于校验 LLM 的 mastery=true 是否合理。"""
    names = [title] + list(aliases or [])
    for n in names:
        nl = (n or "").lower()
        # 排除大学/进阶修饰词:即使含高中关键词,带这些前缀的也是大学内容(偏导数/链式法则/多元微积分...)
        if any(x in nl for x in ["偏导", "链式", "多元", "重积分", "级数", "傅里叶", "微分方程", "矩阵", "行列式", "特征值", "特征向量", "线性变换"]):
            continue
        for kw in _MASTERY_KEYWORDS:
            if kw.lower() in nl:
                return True
    return False


def _add_node(sid: str, title: str, mastery: bool, aliases: list[str] | None,
              sets: list[str], depth: int, events: list[dict]) -> str:
    """新建或合并节点(按标题+别名去重)。返回 node_id。合并时 sets/aliases 取并集、mastery 只升不降。"""
    G = _GRAPHS[sid]
    title = (title or "").strip()
    aliases = [a.strip() for a in (aliases or []) if a and a.strip()]
    nid = _resolve_existing(sid, title, aliases)
    if nid:  # 合并
        nd = G["nodes"][nid]
        old_sets = set(nd["sets"])
        nd["sets"] = sorted(old_sets | set(sets))
        old_aliases = set(nd["aliases"])
        nd["aliases"] = sorted(old_aliases | set(aliases) - {title})
        if mastery and not nd["mastery"]:
            nd["mastery"] = True
        events.append({"kind": "node", "payload": {
            "id": nid, "title": nd["title"], "mastery": nd["mastery"], "depth": nd["depth"],
            "sets": list(nd["sets"]), "aliases": list(nd["aliases"]), "merged": True}})
        return nid
    # 新建
    if len(G["nodes"]) >= MAX_NODES:
        # 触顶:强制并入一个虚拟叶(不进 frontier),避免丢概念
        nid = "n" + _uuid.uuid4().hex[:8]
        G["nodes"][nid] = {"title": title, "aliases": list(aliases), "sets": list(sets),
                           "mastery": True, "depth": depth}  # mastery=True 防止继续展开
    else:
        nid = "n" + _uuid.uuid4().hex[:8]
        G["nodes"][nid] = {"title": title, "aliases": list(aliases), "sets": list(sets),
                           "mastery": mastery, "depth": depth}
    G["title_index"][title] = nid
    for a in aliases:
        G["title_index"][a] = nid
    events.append({"kind": "node", "payload": {
        "id": nid, "title": title, "mastery": G["nodes"][nid]["mastery"], "depth": depth,
        "sets": list(sets), "aliases": list(aliases), "merged": False}})
    return nid


def _has_path(G: dict, src: str, dst: str) -> bool:
    """图里 src 能否到达 dst(BFS)。"""
    if src == dst:
        return True
    adj: dict[str, set] = defaultdict(set)
    for (f, t) in G["edges"]:
        adj[f].add(t)
    stack = [src]
    seen = {src}
    while stack:
        n = stack.pop()
        for m in adj[n]:
            if m == dst:
                return True
            if m not in seen:
                seen.add(m)
                stack.append(m)
    return False


def _add_edge(sid: str, from_id: str, to_id: str, events: list[dict]) -> bool:
    """加 prerequisite 边 from->to。拒自环、拒已存在、拒成环(has_path to->from)。返回是否加入。"""
    G = _GRAPHS[sid]
    if not from_id or not to_id or from_id == to_id:
        return False
    if (from_id, to_id) in G["edges"]:
        return False
    if _has_path(G, to_id, from_id):  # 加 from->to 会成环(to 已能到 from)
        return False
    G["edges"].add((from_id, to_id))
    events.append({"kind": "edge", "payload": {"from": from_id, "to": to_id, "type": "prerequisite_of"}})
    return True


def _snapshot_graph(sid: str) -> dict:
    G = _GRAPHS[sid]
    nodes = [
        {"id": nid, "title": nd["title"], "mastery": nd["mastery"], "depth": nd["depth"],
         "sets": list(nd["sets"]), "aliases": list(nd["aliases"])}
        for nid, nd in G["nodes"].items()
    ]
    edges = [{"from": f, "to": t, "type": "prerequisite_of"} for (f, t) in sorted(G["edges"])]
    return {"nodes": nodes, "edges": edges}


# ---------------- 剪枝 LLM ----------------

def _prune_edges(sid: str, target_title: str, candidates: list[tuple]) -> set:
    """让 LLM 判断改接边语义是否成立。candidates: [(from_id, to_id, from_title, to_title), ...]。
    返回应删除的 (from_id, to_id) 集合。失败返空集(保守保留全部)。"""
    if not candidates:
        return set()
    try:
        cfg = _get_runtime_cfg()
        model = ChatOpenAI(base_url=cfg.base_url, api_key=cfg.api_key or "dummy",
                           model=cfg.model, temperature=0.0, request_timeout=45)
        edges_text = "\n".join([f"- {ft} -> {tt}" for (_, _, ft, tt) in candidates])
        prompt = f"""知识节点「{target_title}」被拆分为子节点,原来依赖它(或它依赖)的节点已全连接到它的子节点。
下面是改接产生的前置依赖候选(A -> B 表示"先学 A 才能学 B")。请判断每条语义上是否成立(B 是否真的需要先学 A)。
返回 JSON,在 drop 数组里列出**不成立/冗余**的依赖(格式 "A -> B")。其余保留。如果都成立,drop 给空数组。
只返回 JSON,不要解释。

候选依赖:
{edges_text}"""
        resp = model.invoke([{"role": "user", "content": prompt}])
        content = resp.content if hasattr(resp, "content") else str(resp)
        dlog(f"PRUNE target={target_title} cands={len(candidates)} resp={content[:300]!r}")
        m = _re.search(r'\{[\s\S]*\}', content)
        if not m:
            dlog("PRUNE no JSON match")
            return set()
        obj = _json.loads(m.group(0))
        drop_strs = obj.get("drop", []) or []
        pair_to_ids = {f"{ft} -> {tt}": (f, t) for (f, t, ft, tt) in candidates}
        drop_set = set()
        for s in drop_strs:
            key = str(s).strip()
            if key in pair_to_ids:
                drop_set.add(pair_to_ids[key])
        dlog(f"PRUNE drop_strs={drop_strs} drop_set={drop_set}")
        return drop_set
    except Exception as e:
        dlog(f"PRUNE EXC {type(e).__name__}: {e}")
        return set()  # 剪枝失败:保守保留全部


def _enforce_keep_at_least_one(candidates: list[tuple], drop_set: set) -> set:
    """每个上游(from)和每个下游(to)至少保留一条边,防过度剪枝丢依赖。"""
    from_groups: dict[str, list] = defaultdict(list)
    to_groups: dict[str, list] = defaultdict(list)
    for (f, t, ft, tt) in candidates:
        from_groups[f].append((f, t))
        to_groups[t].append((f, t))
    for f, edges in from_groups.items():
        if edges and all(e in drop_set for e in edges):
            drop_set.discard(edges[0])
    for t, edges in to_groups.items():
        if edges and all(e in drop_set for e in edges):
            drop_set.discard(edges[0])
    return drop_set


# ---------------- 核心替换函数(LLM 工具 + 手动端点共用) ----------------

def _split_replace(sid: str, target_id: str, children: list[dict], prereqs: list[dict],
                   deps: list[dict], prune: bool = True) -> tuple[list[dict], str]:
    """拆分 target_id 节点。返回 (事件列表, 给调用方的消息)。

    children: 子概念 [{title, mastery, aliases?}]。非空则 target 删除变集合标签。
    prereqs: 外部前置 [{title, mastery, aliases?}]。
    deps: 前置依赖 [{from, to}],from/to 取自 children/prereqs/target 标题。
    """
    G = _GRAPHS[sid]
    nodes = G["nodes"]
    events: list[dict] = []
    if target_id not in nodes:
        return [], f"错误:节点 {target_id} 不存在。"
    target = nodes[target_id]
    target_title = target["title"]
    target_depth = target["depth"]
    inherit_sets = list(target["sets"]) + [target_title]  # 子节点继承的集合标签
    new_depth = target_depth + 1

    # --- A. 建/合并 children(继承 sets) 与 prereqs(外部,sets=[]) ---
    # 校验 LLM 的 mastery=true:必须命中已掌握清单,否则强制 false(防泛化误标)
    child_ids: list[tuple[str, str]] = []   # (title, id)
    for ch in children or []:
        ct = (ch.get("title") or "").strip()
        if not ct:
            continue
        cm = bool(ch.get("mastery", False))
        if cm and not _in_mastery_list(ct, ch.get("aliases")):
            cm = False  # LLM 误标已掌握,回退为待学
        nid = _add_node(sid, ct, cm, ch.get("aliases", []), inherit_sets, new_depth, events)
        child_ids.append((ct, nid))
    prereq_ids: list[tuple[str, str]] = []
    for pr in prereqs or []:
        pt = (pr.get("title") or "").strip()
        if not pt:
            continue
        pm = bool(pr.get("mastery", False))
        if pm and not _in_mastery_list(pt, pr.get("aliases")):
            pm = False
        nid = _add_node(sid, pt, pm, pr.get("aliases", []), [], new_depth, events)
        prereq_ids.append((pt, nid))

    # 标题/别名 -> id 映射(供 deps 解析)
    name_to_id: dict[str, str] = {target_title: target_id}
    for t, nid in child_ids + prereq_ids:
        name_to_id[t] = nid
        nd = nodes.get(nid)
        if nd:
            for a in nd.get("aliases", []):
                name_to_id[a] = nid

    will_delete = bool(child_ids)

    # --- B. 加 deps 精确边(不剪枝)。删除 target 时跳过涉及 target 的 deps(改接处理)。 ---
    referenced: set[str] = set()
    for d in deps or []:
        ft = (d.get("from") or "").strip()
        tt = (d.get("to") or "").strip()
        referenced.add(ft)
        if will_delete and (ft == target_title or tt == target_title):
            continue  # target 要删,涉及它的 deps 交给改接全连
        fid = name_to_id.get(ft) or _resolve_existing(sid, ft, [])
        tid = name_to_id.get(tt) or _resolve_existing(sid, tt, [])
        if fid and tid:
            _add_edge(sid, fid, tid, events)

    # --- C. 改接候选:target 的入/出边全连到 children;孤儿 prereq 全连到 children(或 target 若不删) ---
    reconnect_candidates: list[tuple[str, str, str, str]] = []  # (from_id, to_id, from_title, to_title)
    if will_delete:
        in_edges = [(f, t) for (f, t) in G["edges"] if t == target_id]
        out_edges = [(f, t) for (f, t) in G["edges"] if f == target_id]
        for (f, _t) in in_edges:
            ftitle = nodes.get(f, {}).get("title", f)
            for (ct, cid) in child_ids:
                reconnect_candidates.append((f, cid, ftitle, ct))
        for (_f, t) in out_edges:
            ttitle = nodes.get(t, {}).get("title", t)
            for (ct, cid) in child_ids:
                reconnect_candidates.append((cid, t, ct, ttitle))
    # 孤儿 prereq(没出现在任何 dep.from):全连
    for (pt, pid) in prereq_ids:
        if pt not in referenced:
            if will_delete:
                for (ct, cid) in child_ids:
                    reconnect_candidates.append((pid, cid, pt, ct))
            else:
                reconnect_candidates.append((pid, target_id, pt, target_title))

    # 加改接边(环检测拒成环的)
    added_reconnect: list[tuple[str, str, str, str]] = []
    for (f, t, ft_title, tt_title) in reconnect_candidates:
        if _add_edge(sid, f, t, events):
            added_reconnect.append((f, t, ft_title, tt_title))

    # --- D. 删除 target(若 will_delete) ---
    if will_delete:
        # 移除 target 的原始边(改接边不涉及 target,不受影响)
        removed_edges = [(f, t) for (f, t) in G["edges"] if f == target_id or t == target_id]
        G["edges"] = {(f, t) for (f, t) in G["edges"] if f != target_id and t != target_id}
        for (f, t) in removed_edges:
            events.append({"kind": "edge_removed", "payload": {"from": f, "to": t}})
        # 清 title_index
        ti = G["title_index"]
        for name in [target_title] + target.get("aliases", []):
            if ti.get(name) == target_id:
                del ti[name]
        events.append({"kind": "node_replaced", "payload": {
            "removed": target_id, "title": target_title,
            "children": [nid for _, nid in child_ids]}})
        del nodes[target_id]

    # --- E. 剪枝改接边 ---
    dropped_count = 0
    if prune and added_reconnect:
        drop_set = _prune_edges(sid, target_title, added_reconnect)
        drop_set = _enforce_keep_at_least_one(added_reconnect, drop_set)
        for (f, t, ft_title, tt_title) in added_reconnect:
            if (f, t) in drop_set:
                G["edges"].discard((f, t))
                events.append({"kind": "edge_removed", "payload": {"from": f, "to": t, "pruned": True}})
                dropped_count += 1

    # --- F. 非 mastery 子/prereq 进 frontier ---
    for (_ct, cid) in child_ids:
        nd = nodes.get(cid)
        if nd and not nd["mastery"] and nd["depth"] < MAX_DEPTH and cid not in G["frontier"]:
            G["frontier"].append(cid)
    for (_pt, pid) in prereq_ids:
        nd = nodes.get(pid)
        if nd and not nd["mastery"] and nd["depth"] < MAX_DEPTH and pid not in G["frontier"]:
            G["frontier"].append(pid)
    if target_id in G["frontier"]:
        G["frontier"].remove(target_id)

    # --- G. 发完整 graph 快照(前端据此权威同步) ---
    events.append({"kind": "graph", "payload": _snapshot_graph(sid)})

    frontier_titles = [nodes[fid]["title"] for fid in G["frontier"] if fid in nodes]
    msg = f"已拆分「{target_title}」-> {len(child_ids)} 子节点, {len(prereq_ids)} 前置, {len(deps or [])} 依赖。"
    if dropped_count:
        msg += f" 剪枝删除 {dropped_count} 条冗余边。"
    if will_delete:
        msg += f" 「{target_title}」已删除(变集合标签)。"
    msg += f" 当前 frontier({len(frontier_titles)}):{frontier_titles[:8]}{'…' if len(frontier_titles)>8 else ''}。"
    msg += " 继续拆分 frontier 中的节点。" if frontier_titles else " frontier 已空,调 finish() 完成。"
    return events, msg


# ---------------- 工具(LLM) ----------------

def _build_tools(sid: str):
    G = _GRAPHS[sid]

    @tool
    def expand_node(target: str, children: list[dict], prereqs: list[dict], deps: list[dict]) -> str:
        """拆分 frontier 中的 target(知识点标题)。
        - children:target 分解出的子概念。每项 {"title": str, "mastery": bool, "aliases": [str,...](可选)}。原子概念给 []。
        - prereqs:外部前置知识(不在 children 里)。每项同上。
        - deps:前置依赖。每项 {"from": "先学标题", "to": "后学标题"}。from/to 取自 children/prereqs/target。
        拆分后 target 消失(变集合标签),其依赖改接到子节点并自动剪枝。返回当前 frontier(待拆标题)。空则调 finish()。
        ⚠️ **mastery 判定**:只有命中【已掌握清单】(高中毕业水平)的概念才给 mastery=true,其余一律 mastery=false。
          后端会校验:mastery=true 但不在清单的会被强制回退为 false。如"矩阵""卷积""梯度""神经网络"等大学内容绝不能 mastery=true。
        """
        tgt = (target or "").strip()
        with _LOCKS[sid]:  # 防并行 tool_call 改图竞态
            target_id = _resolve_existing(sid, tgt, [])
            if not target_id or target_id not in G["nodes"]:
                ft = [G["nodes"][fid]["title"] for fid in G["frontier"] if fid in G["nodes"]]
                return f"错误:找不到节点「{tgt}」。当前 frontier:{ft[:10]}"
            if target_id not in G["frontier"]:
                ft = [G["nodes"][fid]["title"] for fid in G["frontier"] if fid in G["nodes"]]
                return f"错误:「{tgt}」不在 frontier(可能已拆分)。当前 frontier:{ft[:10]}"
            if G.get("expand_count", 0) >= MAX_EXPAND:
                G["frontier"] = []
                return (f"已达到本次分解的展开上限({MAX_EXPAND} 次)。"
                        f"frontier 已清空以控制分解耗时,请调 finish() 输出当前知识谱系图。")
            events, msg = _split_replace(sid, target_id, children or [], prereqs or [], deps or [], prune=True)
            G["expand_count"] = G.get("expand_count", 0) + 1
        _EMIT[sid].extend(events)
        return msg

    @tool
    def finish() -> str:
        """全部分解完成,输出完整知识谱系图。frontier 空时调用。"""
        _EMIT[sid].append({"kind": "graph", "payload": _snapshot_graph(sid)})
        return "已完成分解,知识谱系图已生成。"

    return [expand_node, finish]


_SAVER = MemorySaver()


def _build_agent(cfg, sid: str):
    tools = _build_tools(sid)
    # parallel_tool_calls=False:防 LLM 一轮发多个 expand_node 导致并行改图竞态(即使有锁,顺序也难保证语义正确)
    # request_timeout=120:防 LLM 调用挂在网络 IO 拖死 agent(DeepSeek 偶发无响应)
    model = ChatOpenAI(base_url=cfg.base_url, api_key=cfg.api_key or "dummy", model=cfg.model,
                       temperature=0.7, model_kwargs={"parallel_tool_calls": False}, request_timeout=120)
    return create_react_agent(model=model, tools=tools, checkpointer=_SAVER, prompt=DECOMPOSE_PROMPT)


def _current_node_list(sid: str) -> str:
    """当前图里所有节点标题+别名清单,喂给 LLM 做语义去重参考。"""
    G = _GRAPHS[sid]
    items = []
    for nid, nd in G["nodes"].items():
        if nd["aliases"]:
            items.append(f"{nd['title']}(别名:{'/'.join(nd['aliases'])})")
        else:
            items.append(nd["title"])
    return "、".join(items) if items else "(空)"


def run_decompose_agent(sid: str, question: str, file_text: Optional[str] = None, cfg=None):
    """运行分解 agent。生成器 yield 事件 dict:
    {kind: decompose_start|tool_call|tool_result|node|node_replaced|edge|edge_removed|graph|error,
     id, parentId, agent=decompose, stepId, payload}。
    node/edge/graph/node_replaced/edge_removed 事件挂在触发它们的 tool_call 下(parentId=该 tool_call evt id)。
    """
    cfg = cfg or _get_runtime_cfg()
    # 初始化该 session 的图草稿 + root 节点(root 是普通节点,拆则消失,不拆则留作叶)
    # 复位整图要在 _LOCKS 内进行,防与并行编辑/edit_* 竞态(swap 瞬间短暂持锁,不阻塞后续工具)
    with _LOCKS[sid]:
        _GRAPHS[sid] = {"nodes": {}, "edges": set(), "frontier": [], "title_index": {}, "expand_count": 0}
        _EMIT[sid] = []
    G = _GRAPHS[sid]
    root_title = question.strip()[:40] or "知识点"
    root_id = "root"
    G["nodes"][root_id] = {"title": root_title, "aliases": [], "sets": [], "mastery": False, "depth": 0}
    G["title_index"][root_title] = root_id
    G["frontier"] = [root_id]

    agent_obj = _build_agent(cfg, sid)
    user_msg = (f"用户的知识点:{question}\n\n请从 root(即「{root_title}」)开始,调 expand_node 递归分解并找前置知识,"
                f"完成后调 finish()。\n当前图里已有节点:{_current_node_list(sid)}")
    if file_text:
        ft = file_text[:8000]
        user_msg = (f"用户上传的文件内容(围绕其中的知识点分解):\n```\n{ft}\n```\n\n用户的知识点:{question}\n\n"
                    f"请从 root(即「{root_title}」)开始递归分解并找前置知识,完成后调 finish()。")

    config = {"configurable": {"thread_id": f"decompose#{sid}"}}
    agent_evt_id = _new_id()
    yield {"kind": "decompose_start", "id": agent_evt_id, "parentId": None, "agent": "decompose",
           "stepId": None, "payload": {"title": f"知识分解 · {root_title}", "root_id": root_id}}
    # root 节点事件
    yield {"kind": "node", "id": _new_id(), "parentId": agent_evt_id, "agent": "decompose",
           "stepId": None, "payload": {"id": root_id, "title": root_title, "mastery": False,
                                       "depth": 0, "sets": [], "aliases": [], "merged": False}}

    tcid_to_evt: dict = {}
    current_tc_evt: Optional[str] = None
    graph_emitted = False
    try:
        for chunk in agent_obj.stream({"messages": [{"role": "user", "content": user_msg}]}, config, stream_mode="updates"):
            for node, state in chunk.items():
                if node == "__interrupt__":
                    continue
                msgs = state.get("messages", []) if isinstance(state, dict) else []
                for m in msgs:
                    nm = type(m).__name__
                    if nm == "AIMessage" and getattr(m, "tool_calls", None):
                        for tc in m.tool_calls:
                            eid = _new_id()
                            tcid_to_evt[tc.get("id")] = eid
                            current_tc_evt = eid
                            yield {"kind": "tool_call", "id": eid, "parentId": agent_evt_id,
                                   "agent": "decompose", "stepId": None,
                                   "payload": {"name": tc.get("name"), "args": tc.get("args", {})}}
                    elif nm == "ToolMessage":
                        # 先 drain _EMIT:把 tool 执行期间产生的事件挂到当前 tool_call 下
                        while _EMIT[sid]:
                            ev = _EMIT[sid].pop(0)
                            if ev["kind"] == "graph":
                                graph_emitted = True
                            ev_out = {"kind": ev["kind"], "id": _new_id(),
                                      "parentId": current_tc_evt, "agent": "decompose", "stepId": None,
                                      "payload": ev["payload"]}
                            yield ev_out
                        tcid = getattr(m, "tool_call_id", None)
                        parent = tcid_to_evt.get(tcid, current_tc_evt)
                        yield {"kind": "tool_result", "id": _new_id(), "parentId": parent,
                               "agent": "decompose", "stepId": None,
                               "payload": {"toolCallId": tcid, "output": str(getattr(m, "content", ""))[:2000]}}
    except Exception as e:
        yield {"kind": "error", "id": _new_id(), "parentId": agent_evt_id, "agent": "decompose",
               "stepId": None, "payload": {"message": f"分解 agent 异常:{type(e).__name__}: {e}"}}
        return

    # 兜底:若 LLM 没调 finish(没 emit graph),补发完整 graph 快照
    if not graph_emitted:
        yield {"kind": "graph", "id": _new_id(), "parentId": agent_evt_id, "agent": "decompose",
               "stepId": None, "payload": _snapshot_graph(sid)}


def graph_to_topic_sequence(sid: str, question: str) -> Optional[dict]:
    """把分解 DAG 拓扑排序成 Topic 结构,供主 agent topics list(知识清单)用。

    多级分层 + 融合总结:
    - 节点的 sets 链(被拆分父节点标题的继承链)决定层级:level = len(sets)。
      如 sets=["微积分"] 的微分/积分是 level 1;sets=["线性代数","向量"] 是 level 2。
    - 被拆分消失的父标题(在某个节点 sets 里出现,但已不是任何节点 title)= 融合总结候选。
      在其所有直接子节点(sets 末位 == 该父标题)学完后,追加一个"总结:父标题"步骤(is_summary=True),
      让用户学完子知识点后能把它们融合起来,真正懂父知识点。
    过滤 mastery=True(已掌握的高中知识不进学习序列,只在 summary 列出)。
    Kahn 拓扑序(只在"待学子图"上),同层按 (depth, 创建序) 稳定排序。断裂/未访问兜底补末尾。
    step_id:普通节点 {topicid-N};融合总结节点 {topicid-SN}(S 前缀防冲突)。
    返回 {id, title, summary, steps:[{id, title, level?, parent_title?, is_summary?}]} 或 None。
    """
    G = _GRAPHS.get(sid)
    if not G or not G["nodes"]:
        return None
    nodes, edges = G["nodes"], G["edges"]
    learn_ids = [nid for nid, nd in nodes.items() if not nd["mastery"]]
    learn_set = set(learn_ids)
    if not learn_ids:
        return None
    # Kahn(只在 learn 子图上)
    in_deg = {nid: 0 for nid in learn_ids}
    adj: dict[str, list] = {nid: [] for nid in learn_ids}
    for (f, t) in edges:
        if f in learn_set and t in learn_set:
            adj[f].append(t)
            in_deg[t] += 1
    import heapq as _hq
    queue = [(nodes[nid]["depth"], learn_ids.index(nid), nid) for nid in learn_ids if in_deg[nid] == 0]
    _hq.heapify(queue)
    order: list[str] = []
    while queue:
        _, _, n = _hq.heappop(queue)
        order.append(n)
        for m in adj[n]:
            in_deg[m] -= 1
            if in_deg[m] == 0:
                _hq.heappush(queue, (nodes[m]["depth"], learn_ids.index(m), m))
    # 兜底:断裂/未访问的全补到末尾(按 depth+创建序)
    visited = set(order)
    for nid in learn_ids:
        if nid not in visited:
            order.append(nid)

    # 找被拆分消失的父标题(融合总结候选):出现在某节点 sets 里,但不是任何节点 title
    all_titles = {nd["title"] for nd in nodes.values()}
    split_parents: set[str] = set()
    for nd in nodes.values():
        for s in nd["sets"]:
            if s not in all_titles:
                split_parents.add(s)

    # 对每个被拆分父标题 P,收集其后代节点(sets 含 P 任意位置=间接后代),用于判断总结插入时机
    # 直接子(sets 末位 == P)用于 level 推断;间接后代用于"全部学完"判断
    descendants_of_parent: dict[str, list[str]] = defaultdict(list)
    children_of_parent: dict[str, list[str]] = defaultdict(list)
    for nid in order:
        s = nodes[nid]["sets"]
        for i, p in enumerate(s):
            descendants_of_parent[p].append(nid)
            if i == len(s) - 1:
                children_of_parent[p].append(nid)

    topic_id = _uuid.uuid4().hex[:8]
    # 主体步骤(普通节点)+ 融合总结步骤,按拓扑序交错插入
    # 策略:遍历 order,每放完一个节点检查是否有父标题的所有直接子节点都已放完,若是则紧跟插入该父的总结步骤。
    placed: set[str] = set()
    steps: list[dict] = []
    n_counter = [0]

    def next_id(is_summary: bool = False) -> str:
        n_counter[0] += 1
        return f"{topic_id}-S{n_counter[0]}" if is_summary else f"{topic_id}-{n_counter[0]}"

    def try_emit_summaries():
        """所有后代节点(sets 含 P)都已 placed 的父标题 → 发融合总结步骤。
        用全部后代(不只是直接子)判断,确保总结在整棵子树学完后才出现。"""
        for p in sorted(split_parents):
            kids = children_of_parent.get(p, [])
            if not kids:
                continue
            desc = descendants_of_parent.get(p, [])
            if all(d in placed for d in desc) and p in split_parents:
                key = f"__SUM__{p}"
                if key in placed:
                    continue
                steps.append({
                    "id": next_id(is_summary=True),
                    "title": f"总结:{p}",
                    "is_summary": True,
                    "parent_title": p,
                    # 总结节点层级 = 最浅直接子的层级(收尾节点,与它的直接子同级显示,不因深嵌套子节点而过分缩进)
                    "level": min((len(nodes[k]["sets"]) - 1) for k in kids) if kids else 0,
                })
                placed.add(key)

    for nid in order:
        nd = nodes[nid]
        s = nd["sets"]
        steps.append({
            "id": next_id(),
            "title": nd["title"],
            "level": len(s),            # sets 链长 = 层级深度(0=顶层未被拆分父)
            "parent_title": s[-1] if s else None,
        })
        placed.add(nid)
        try_emit_summaries()
    # 末尾再扫一遍(防止依赖顺序导致某些总结没触发)
    try_emit_summaries()

    mastery_titles = [nd["title"] for nd in nodes.values() if nd["mastery"]]
    summary = "由知识分解生成,按前置依赖拓扑排序,含多级分层与融合总结节点"
    if mastery_titles:
        summary += f"。已掌握前置:{'、'.join(mastery_titles[:6])}"
    if split_parents:
        summary += f"。融合总结:{'、'.join(sorted(split_parents)[:6])}"
    return {
        "id": topic_id,
        "title": (question or "知识分解")[:30],
        "summary": summary,
        "steps": steps,
    }


def ensure_graph_loaded(sid: str) -> bool:
    """_GRAPHS[sid] 空时,从主 session 的 graph 快照重建(nodes/edges/title_index)。
    供重启后或切回 session 时的 split 前调。返回是否有可用图。

    重建的图 frontier 置空(快照不含 frontier),不能续 expand_node;但手动 split 可用(_split_replace 不依赖 frontier)。
    """
    if sid in _GRAPHS and _GRAPHS[sid].get("nodes"):
        return True
    try:
        import agent as _a
        s = _a.get_session(sid)
    except Exception:
        s = None
    snap = (s or {}).get("graph", {}).get("snapshot") if (s or {}).get("graph") else None
    if not snap or not snap.get("nodes"):
        return False
    G = {"nodes": {}, "edges": set(), "frontier": [], "title_index": {}, "expand_count": 0}
    for n in snap["nodes"]:
        G["nodes"][n["id"]] = {
            "title": n["title"], "aliases": list(n.get("aliases", [])),
            "sets": list(n.get("sets", [])), "mastery": bool(n.get("mastery", False)),
            "depth": int(n.get("depth", 0)),
        }
        G["title_index"][n["title"]] = n["id"]
        for a in n.get("aliases", []):
            G["title_index"][a] = n["id"]
    for e in snap.get("edges", []):
        G["edges"].add((e["from"], e["to"]))
    _GRAPHS[sid] = G
    dlog(f"ENSURE_GRAPH_LOADED sid={sid} rebuilt nodes={len(G['nodes'])} edges={len(G['edges'])}")
    return True


def manual_split(sid: str, target_title: str, children: list[dict], prereqs: list[dict],
                 deps: list[dict], prune: bool = True) -> tuple[list[dict], str, dict]:
    """手动拆分:绕过 LLM,直接调 _split_replace。供 /api/decompose/<sid>/split 端点用。
    返回 (事件列表, 消息, graph 快照)。需先确保 _GRAPHS[sid] 有图(从内存或 state.json 快照重建)。
    """
    ensure_graph_loaded(sid)
    G = _GRAPHS[sid]
    tgt = target_title.strip()
    with _LOCKS[sid]:  # 防与正在跑的 agent 或并行调用竞态
        target_id = _resolve_existing(sid, tgt, [])
        dlog(f"MANUAL_SPLIT sid={sid} target={tgt!r} resolved={target_id} "
             f"title_index_size={len(G.get('title_index', {}))} nodes={len(G.get('nodes', {}))} "
             f"target_in_nodes={[n['title'] for n in G['nodes'].values() if n['title']==tgt][:1]}")
        if not target_id or target_id not in G["nodes"]:
            return [], f"错误:找不到节点「{target_title}」", _snapshot_graph(sid)
        events, msg = _split_replace(sid, target_id, children or [], prereqs or [], deps or [], prune=prune)
    return events, msg, _snapshot_graph(sid)


# ---------------- 图编辑函数(供主 agent 工具直接改图,绕过 LLM) ----------------
# 每个函数:ensure_graph_loaded → 加锁 → 改 _GRAPHS[sid] → 返回 (消息, 快照)。
# 调用方(主 agent 工具)负责把快照写回 session.graph + 推 graph 事件给前端。
# 不在此发事件:主 agent 工具统一用最终快照刷新前端,过程事件无意义。

def edit_remove_node(sid: str, title: str) -> tuple[str, dict]:
    """删除节点(按标题+别名查)及其所有关联边。returns (msg, snapshot)。"""
    ensure_graph_loaded(sid)
    G = _GRAPHS[sid]
    with _LOCKS[sid]:
        nid = _resolve_existing(sid, title.strip(), [])
        if not nid or nid not in G["nodes"]:
            return f"错误:找不到节点「{title}」", _snapshot_graph(sid)
        nd = G["nodes"][nid]
        # 删关联边
        G["edges"] = {(f, t) for (f, t) in G["edges"] if f != nid and t != nid}
        # 清 title_index
        ti = G["title_index"]
        for name in [nd["title"]] + nd.get("aliases", []):
            if ti.get(name) == nid:
                del ti[name]
        del G["nodes"][nid]
        if nid in G["frontier"]:
            G["frontier"].remove(nid)
    return f"已删除节点「{nd['title']}」及其关联边。", _snapshot_graph(sid)


def edit_add_node(sid: str, title: str, mastery: bool = False, aliases: list[str] | None = None) -> tuple[str, dict]:
    """新增一个孤立节点(不带边)。returns (msg, snapshot)。复用 _add_node 去重合并。"""
    ensure_graph_loaded(sid)
    G = _GRAPHS[sid]
    events: list[dict] = []
    with _LOCKS[sid]:
        nid = _add_node(sid, title.strip(), mastery, aliases, [], 0, events)
        nd = G["nodes"][nid]
    return f"已添加节点「{nd['title']}」(mastery={'是' if nd['mastery'] else '否'})。", _snapshot_graph(sid)


def edit_rename_node(sid: str, title: str, new_title: str) -> tuple[str, dict]:
    """改节点标题(同步更新 title_index)。returns (msg, snapshot)。"""
    ensure_graph_loaded(sid)
    G = _GRAPHS[sid]
    new_title = new_title.strip()
    with _LOCKS[sid]:
        nid = _resolve_existing(sid, title.strip(), [])
        if not nid or nid not in G["nodes"]:
            return f"错误:找不到节点「{title}」", _snapshot_graph(sid)
        if not new_title:
            return "错误:新标题不能为空", _snapshot_graph(sid)
        nd = G["nodes"][nid]
        old = nd["title"]
        ti = G["title_index"]
        # 更新 title_index:移旧加新(别名映射保留)
        if ti.get(old) == nid:
            del ti[old]
        ti[new_title] = nid
        nd["title"] = new_title
    return f"已将「{old}」重命名为「{new_title}」。", _snapshot_graph(sid)


def edit_add_edge(sid: str, from_title: str, to_title: str) -> tuple[str, dict]:
    """加前置依赖边 from->to(先学 from 才能学 to)。环检测拒成环。returns (msg, snapshot)。"""
    ensure_graph_loaded(sid)
    G = _GRAPHS[sid]
    events: list[dict] = []
    with _LOCKS[sid]:
        fid = _resolve_existing(sid, from_title.strip(), [])
        tid = _resolve_existing(sid, to_title.strip(), [])
        if not fid:
            return f"错误:找不到节点「{from_title}」", _snapshot_graph(sid)
        if not tid:
            return f"错误:找不到节点「{to_title}」", _snapshot_graph(sid)
        if _add_edge(sid, fid, tid, events):
            return f"已加依赖:先学「{from_title}」才能学「{to_title}」。", _snapshot_graph(sid)
        # _add_edge 返回 False:可能已存在或成环
        if (fid, tid) in G["edges"]:
            return f"该依赖已存在:「{from_title}」->「{to_title}」。", _snapshot_graph(sid)
        return f"错误:加「{from_title}」->「{to_title}」会成环(「{to_title}」已能到「{from_title}」),已拒绝。", _snapshot_graph(sid)


def edit_remove_edge(sid: str, from_title: str, to_title: str) -> tuple[str, dict]:
    """删前置依赖边 from->to。returns (msg, snapshot)。"""
    ensure_graph_loaded(sid)
    G = _GRAPHS[sid]
    with _LOCKS[sid]:
        fid = _resolve_existing(sid, from_title.strip(), [])
        tid = _resolve_existing(sid, to_title.strip(), [])
        if not fid or not tid:
            return f"错误:找不到节点(「{from_title}」或「{to_title}」)", _snapshot_graph(sid)
        if (fid, tid) not in G["edges"]:
            return f"该依赖不存在:「{from_title}」->「{to_title}」", _snapshot_graph(sid)
        G["edges"].discard((fid, tid))
    return f"已删除依赖:「{from_title}」->「{to_title}」。", _snapshot_graph(sid)


def edit_set_mastered(sid: str, title: str, mastered: bool) -> tuple[str, dict]:
    """标记节点为已掌握(mastery=True)或取消(mastery=False)。returns (msg, snapshot)。"""
    ensure_graph_loaded(sid)
    G = _GRAPHS[sid]
    with _LOCKS[sid]:
        nid = _resolve_existing(sid, title.strip(), [])
        if not nid or nid not in G["nodes"]:
            return f"错误:找不到节点「{title}」", _snapshot_graph(sid)
        nd = G["nodes"][nid]
        nd["mastery"] = bool(mastered)
        # 标记已掌握后从 frontier 移除(不再展开);取消则不自动加回 frontier(避免误展开)
        if mastered and nid in G["frontier"]:
            G["frontier"].remove(nid)
    return f"已将「{nd['title']}」标记为{'已掌握' if mastered else '未掌握'}。", _snapshot_graph(sid)


def edit_list_nodes(sid: str) -> str:
    """列出当前图所有节点(标题 + mastery + depth),供主 agent 决策用。returns 文本。"""
    ensure_graph_loaded(sid)
    G = _GRAPHS[sid]
    if not G["nodes"]:
        return "图当前为空(尚未分解)。"
    lines = []
    for nid, nd in G["nodes"].items():
        flag = "✓已掌握" if nd["mastery"] else "待学"
        sets = f" [集合:{'/'.join(nd.get('sets', []))}]" if nd.get("sets") else ""
        lines.append(f"  - {nd['title']}({flag}, depth={nd['depth']}){sets}")
    return f"当前图 {len(G['nodes'])} 节点,{len(G['edges'])} 边:\n" + "\n".join(lines)


def edit_merge_nodes(sid: str, titles: list[str], new_title: str) -> tuple[str, dict]:
    """合并多个节点为一个新节点(用户指定标题)。新节点继承被合并节点的 sets 交集(共同父集合)+
    合并节点的 aliases,入/出边全连到新节点,删旧节点。returns (msg, snapshot)。"""
    ensure_graph_loaded(sid)
    G = _GRAPHS[sid]
    new_title = (new_title or "").strip()
    if not new_title:
        return "错误:缺少合并后的新标题。", _snapshot_graph(sid)
    if not titles or len(titles) < 2:
        return "错误:合并至少需要 2 个节点。", _snapshot_graph(sid)
    with _LOCKS[sid]:
        ids = []
        for t in titles:
            nid = _resolve_existing(sid, t.strip(), [])
            if not nid:
                return f"错误:找不到节点「{t}」", _snapshot_graph(sid)
            ids.append(nid)
        if len(set(ids)) < 2:
            return "错误:选中的是同一个节点,无需合并。", _snapshot_graph(sid)
        # 共同父集合(sets 交集):合并后保留共同的上层归属
        common_sets = set(G["nodes"][ids[0]].get("sets", []))
        for nid in ids[1:]:
            common_sets &= set(G["nodes"][nid].get("sets", []))
        # 合并 aliases:被合并节点标题都作为新节点别名
        merged_aliases = sorted({G["nodes"][nid]["title"] for nid in ids} | {a for nid in ids for a in G["nodes"][nid].get("aliases", [])})
        # 收集入/出边(排除被合并节点之间的内部边)
        in_edges = [(f, nid) for (f, t) in G["edges"] for nid in ids if t == nid and f not in ids]
        out_edges = [(nid, t) for (f, t) in G["edges"] for nid in ids if f == nid and t not in ids]
        # 新节点 depth = 最浅被合并节点 depth(合并后层级取较上层)
        new_depth = min(G["nodes"][nid]["depth"] for nid in ids)
        new_mastery = all(G["nodes"][nid]["mastery"] for nid in ids)  # 全已掌握才算已掌握
        # 删旧节点(及其边)
        for nid in ids:
            G["edges"] = {(f, t) for (f, t) in G["edges"] if f != nid and t != nid}
            old = G["nodes"].pop(nid, None)
            if old:
                G["title_index"].pop(old["title"], None)
                for a in old.get("aliases", []):
                    G["title_index"].pop(a, None)
            if nid in G["frontier"]:
                G["frontier"].remove(nid)
        # 加新节点
        new_id = "n" + _uuid.uuid4().hex[:8]
        G["nodes"][new_id] = {"title": new_title, "aliases": list(merged_aliases), "sets": sorted(common_sets),
                              "mastery": new_mastery, "depth": new_depth}
        G["title_index"][new_title] = new_id
        for a in merged_aliases:
            G["title_index"][a] = new_id
        # 重连入/出边(环检测)
        for (f, _) in in_edges:
            if f != new_id and (f, new_id) not in G["edges"] and not _has_path(G, new_id, f):
                G["edges"].add((f, new_id))
        for (_, t) in out_edges:
            if t != new_id and (new_id, t) not in G["edges"] and not _has_path(G, t, new_id):
                G["edges"].add((new_id, t))
    return f"已合并 {len(ids)} 个节点为「{new_title}」。", _snapshot_graph(sid)


def edit_auto_split(sid: str, target: str) -> tuple[str, dict]:
    """LLM 自动拆分某节点(右键"拆分"菜单):用 LLM 产 children/prereqs/deps,再调 _split_replace。
    适用于用户想细分某节点但不想手填子概念。returns (msg, snapshot)。"""
    ensure_graph_loaded(sid)
    G = _GRAPHS[sid]
    target = (target or "").strip()
    if not target:
        return "错误:缺少要拆分的节点标题。", _snapshot_graph(sid)
    nid = _resolve_existing(sid, target, [])
    if not nid or nid not in G["nodes"]:
        return f"错误:找不到节点「{target}」", _snapshot_graph(sid)
    nd = G["nodes"][nid]
    if nd["mastery"]:
        return f"「{target}」已标记为已掌握,无需拆分。", _snapshot_graph(sid)
    try:
        cfg = _get_runtime_cfg()
        model = ChatOpenAI(base_url=cfg.base_url, api_key=cfg.api_key or "dummy",
                           model=cfg.model, temperature=0.3, request_timeout=45)
        prompt = (f"把知识点「{target}」(深度={nd['depth']},集合标签={nd.get('sets',[])})拆分为 3-6 个子概念。"
                  f"返回 JSON:{{\"children\":[{{\"title\":...,\"mastery\":false,\"aliases\":[]}}],"
                  f"\"prereqs\":[{{\"title\":...,\"mastery\":false}}],"
                  f"\"deps\":[{{\"from\":\"先学\",\"to\":\"后学\"}}]}}。"
                  f"子概念标题 4-16 字,与 target 不同。只有高中已掌握的概念(代数/函数/几何/三角/向量/微积分基础/概率/集合)才 mastery=true。"
                  f"deps 的 from/to 取自 children/prereqs/target 标题。只返回 JSON。")
        resp = model.invoke([{"role": "user", "content": prompt}])
        content = resp.content if hasattr(resp, "content") else str(resp)
        dlog(f"AUTO_SPLIT target={target} resp={content[:300]!r}")
        m = _re.search(r'\{[\s\S]*\}', content)
        if not m:
            return f"自动拆分失败:LLM 未返回 JSON。", _snapshot_graph(sid)
        obj = _json.loads(m.group(0))
        children = obj.get("children", []) or []
        prereqs = obj.get("prereqs", []) or []
        deps = obj.get("deps", []) or []
        if not children:
            return f"自动拆分:{target} 是原子概念,LLM 未拆出子节点。可手动拆分。", _snapshot_graph(sid)
    except Exception as e:
        dlog(f"AUTO_SPLIT EXC {type(e).__name__}: {e}")
        return f"自动拆分出错:{type(e).__name__}: {e}", _snapshot_graph(sid)
    events, msg = _split_replace(sid, nid, children, prereqs, deps, prune=True)
    return f"已自动拆分「{target}」:{msg}", _snapshot_graph(sid)
