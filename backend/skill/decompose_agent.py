"""知识点分解 agent:把一个 STEM 知识点递归分解为子知识点 + 前置知识,输出知识谱系图。

复用 outline_agent 的 create_react_agent + stream(updates) 骨架。区别:
- 两个工具 expand_node(node_id, children, prereqs) / finish()。
- LLM 逐节点驱动递归:每次展开 frontier 中的一个节点,登记其子知识点(children)
  与前置知识(prereqs),Python 校验/去重/封顶,并通过 tool 返回值把当前 frontier 回喂 LLM。
- 命中"已掌握清单"(system prompt 内置,高中毕业水平)的节点 mastery=true,停止该分支。
- 节点/边/图事件经 _EMIT[sid] side-channel 队列,run_decompose_agent 在每个 ToolMessage
  前 drain,parentId 桥接到触发它的 tool_call(因为 @tool 函数不能 yield,只能 return)。
- agent="decompose",与 main/step 隔离;独立 _SAVER + thread_id="decompose#{sid}"。

事件 kind:decompose_start / tool_call / tool_result / node / edge / graph / error。
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


# 每会话一份图草稿 + 事件 side-channel 队列
_GRAPHS: dict[str, dict] = defaultdict(lambda: {"nodes": {}, "edges": set(), "frontier": [], "depth": {}})
_EMIT: dict[str, list[dict]] = defaultdict(list)
import uuid as _uuid

MAX_DEPTH = 4
MAX_NODES = 60


def _new_id() -> str:
    return _uuid.uuid4().hex[:12]


# 节点标题 -> 稳定 id(同标题复用,避免重复节点)。每个 session 一份。
_TITLE_TO_ID: dict[str, dict[str, str]] = defaultdict(dict)


DECOMPOSE_PROMPT = """你是知识点分解 agent。对用户给的 STEM 知识点,递归地构建知识谱系图(子知识点 + 前置知识)。

**工作方式**:只调工具,不要输出 JSON 或自然语言解释。
- expand_node(node_id, children, prereqs):展开 frontier 中的 node_id。登记其子知识点(children)与前置知识(prereqs)。
  - children:该节点分解出的下级子知识点(如"线性代数"→["行列式","矩阵","线性变换","特征值与特征向量"])。原子概念(如"旋度""勾股定理")不需要分解,children 给空数组 []。
  - prereqs:学习该节点所需的前置知识(如"旋度"的 prereqs=["矢量场","偏导数"])。
  - 每项是 {"title": "知识点名", "mastery": true/false}。mastery=true 仅当该知识点命中下方【已掌握清单】;否则 false。
- finish():所有分支都到头(叶节点全 mastery=true 或达深度上限)时调用,完成分解。

**递归规则**:
1. 先判断用户问的知识点是否需要分解:基础/原子概念(旋度、勾股定理、导数定义)→ children 给 [](不再向下分);复杂体系(线性代数、傅里叶变换、神经网络)→ children 给出 3-6 个子知识点。
2. 对每个节点都要列出它的前置知识 prereqs。
3. prereqs 若命中【已掌握清单】→ mastery=true,该分支停止;否则 mastery=false,会被加入 frontier 继续递归展开。
4. 工具返回值会告诉你当前 frontier(待展开节点 id 列表)。每次挑一个 frontier 里的 id 调 expand_node。frontier 空了就调 finish()。
5. 同一个知识点标题不要重复展开(系统会按标题去重)。

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
- 问"什么是旋度":旋度是原子概念不分解,children=[];prereqs=[{"title":"矢量场","mastery":false},{"title":"偏导数","mastery":false},{"title":"向量叉乘","mastery":false}]。然后递归展开"矢量场"(prereqs 可能是"向量基础"mastery=true → 停)、"偏导数"(prereqs 是"导数""多元函数",导数命中清单 mastery=true 停)、"向量叉乘"(prereqs 是"向量基础"mastery=true 停)。frontier 空后 finish。
- 问"线性代数":children=["行列式","矩阵","线性变换","特征值与特征向量"],prereqs=[](线性代数本身无前置)。然后逐个展开这些子节点,它们的 prereqs 递归到高中已掌握。

全程中文。子知识点标题 10-20 字。
"""


def _node_id_for_title(sid: str, title: str) -> str:
    """同标题复用 id(去重节点)。"""
    t2i = _TITLE_TO_ID[sid]
    if title in t2i:
        return t2i[title]
    nid = "n" + _uuid.uuid4().hex[:8]
    t2i[title] = nid
    return nid


def _emit(sid: str, kind: str, payload: dict) -> None:
    """tool 函数把事件塞进 side-channel 队列,run_decompose_agent 会 drain 并补 id/parentId/agent。"""
    _EMIT[sid].append({"kind": kind, "payload": payload})


def _snapshot_graph(sid: str) -> dict:
    G = _GRAPHS[sid]
    nodes = [
        {"id": nid, "title": nd["title"], "mastery": nd["mastery"], "depth": nd["depth"]}
        for nid, nd in G["nodes"].items()
    ]
    edges = [{"from": f, "to": t, "type": ty} for (f, t, ty) in sorted(G["edges"])]
    return {"nodes": nodes, "edges": edges}


def _build_tools(sid: str):
    G = _GRAPHS[sid]

    @tool
    def expand_node(node_id: str, children: list[dict], prereqs: list[dict]) -> str:
        """展开 frontier 中的 node_id:登记其子知识点(children)与前置知识(prereqs)。
        children/prereqs 每项为 {"title": str, "mastery": bool}。原子概念 children 给 []。
        返回当前 frontier(待展开 id 列表),空则调 finish()。"""
        nodes = G["nodes"]
        # 校验 node_id(允许 root 或已登记节点)
        if node_id != "root" and node_id not in nodes:
            return f"错误:node_id={node_id} 不存在。请从 frontier 中选一个。当前 frontier:{G['frontier']}"
        parent_depth = nodes.get(node_id, {}).get("depth", 0)
        parent_title = nodes.get(node_id, {}).get("title", "根知识点")

        def _add_item(item: dict, edge_type: str) -> None:
            """登记一个子/前置节点 + 一条边。"""
            if len(nodes) >= MAX_NODES:
                return
            title = (item.get("title") or "").strip()
            if not title:
                return
            mastery = bool(item.get("mastery", False))
            nid = _node_id_for_title(sid, title)
            is_new = nid not in nodes
            if is_new:
                nodes[nid] = {"title": title, "mastery": mastery, "depth": parent_depth + 1}
                _emit(sid, "node", {"id": nid, "title": title, "mastery": mastery,
                                     "depth": parent_depth + 1, "parent": node_id})
            else:
                # 已存在:若任一处标 mastery 则升级为 mastery(不降级)
                if mastery and not nodes[nid]["mastery"]:
                    nodes[nid]["mastery"] = True
            # 边:decomposes_into(node_id→child) 或 prerequisite_of(prereq→node_id)
            if edge_type == "decomposes_into":
                f, t = node_id, nid
            else:  # prerequisite_of:前置指向当前节点
                f, t = nid, node_id
            if f != t:  # 拒自环
                G["edges"].add((f, t, edge_type))
                _emit(sid, "edge", {"from": f, "to": t, "type": edge_type})
            # 非 mastery 且未达深度上限 → 加入 frontier 继续展开
            if not mastery and nodes[nid]["depth"] < MAX_DEPTH and nid not in G["frontier"]:
                G["frontier"].append(nid)

        for ch in children or []:
            _add_item(ch, "decomposes_into")
        for pr in prereqs or []:
            _add_item(pr, "prerequisite_of")

        # 从 frontier 移除已展开的 node_id
        if node_id in G["frontier"]:
            G["frontier"].remove(node_id)

        # 触顶提示
        capped = len(nodes) >= MAX_NODES
        msg = f"已展开「{parent_title}」(+{len(children or [])} 子知识点, +{len(prereqs or [])} 前置)。"
        if capped:
            msg += f" 已达节点上限 {MAX_NODES},剩余分支不再展开。"
        msg += f" 当前 frontier({len(G['frontier'])}):{G['frontier'][:8]}{'…' if len(G['frontier'])>8 else ''}。"
        msg += " frontier 空了就调 finish()。" if G["frontier"] else " frontier 已空,请调 finish() 完成分解。"
        return msg

    @tool
    def finish() -> str:
        """全部分解完成,输出完整知识谱系图。frontier 空或已达上限时调用。"""
        _emit(sid, "graph", _snapshot_graph(sid))
        return "已完成分解,知识谱系图已生成。"

    return [expand_node, finish]


_SAVER = MemorySaver()


def _build_agent(cfg, sid: str):
    tools = _build_tools(sid)
    model = ChatOpenAI(base_url=cfg.base_url, api_key=cfg.api_key or "dummy", model=cfg.model, temperature=0.7)
    return create_react_agent(model=model, tools=tools, checkpointer=_SAVER, prompt=DECOMPOSE_PROMPT)


def run_decompose_agent(sid: str, question: str, file_text: Optional[str] = None, cfg=None):
    """运行分解 agent。生成器 yield 事件 dict:
    {kind: decompose_start|tool_call|tool_result|node|edge|graph|error, id, parentId, agent=decompose, payload}。
    node/edge/graph 事件挂在触发它们的 tool_call 下(parentId=该 tool_call 的 evt id)。
    """
    cfg = cfg or _get_runtime_cfg()
    # 初始化该 session 的图草稿 + root 节点
    _GRAPHS[sid] = {"nodes": {}, "edges": set(), "frontier": [], "depth": {}}
    _TITLE_TO_ID[sid] = {}
    _EMIT[sid] = []
    G = _GRAPHS[sid]
    root_title = question.strip()[:40] or "知识点"
    root_id = "root"
    G["nodes"][root_id] = {"title": root_title, "mastery": False, "depth": 0}
    G["depth"][root_id] = 0
    G["frontier"] = [root_id]
    _TITLE_TO_ID[sid][root_title] = root_id

    agent_obj = _build_agent(cfg, sid)
    user_msg = f"用户的知识点:{question}\n\n请从 root(即该知识点本身)开始,调 expand_node 递归分解并找前置知识,完成后调 finish()。"
    if file_text:
        ft = file_text[:8000]
        user_msg = f"用户上传的文件内容(围绕其中的知识点分解):\n```\n{ft}\n```\n\n用户的知识点:{question}\n\n请从 root 开始递归分解并找前置知识,完成后调 finish()。"

    config = {"configurable": {"thread_id": f"decompose#{sid}"}}
    agent_evt_id = _new_id()
    yield {"kind": "decompose_start", "id": agent_evt_id, "parentId": None, "agent": "decompose",
           "stepId": None, "payload": {"title": f"知识分解 · {root_title}"}}
    # root 节点事件(挂在 agent_start 下)
    yield {"kind": "node", "id": _new_id(), "parentId": agent_evt_id, "agent": "decompose",
           "stepId": None, "payload": {"id": root_id, "title": root_title, "mastery": False, "depth": 0, "parent": None}}

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
                        # 先 drain _EMIT:把 tool 执行期间产生 node/edge/graph 事件挂到当前 tool_call 下
                        while _EMIT[sid]:
                            ev = _EMIT[sid].pop(0)
                            if ev["kind"] == "graph":
                                graph_emitted = True
                            ev_out = {
                                "kind": ev["kind"], "id": _new_id(),
                                "parentId": current_tc_evt, "agent": "decompose", "stepId": None,
                                "payload": ev["payload"],
                            }
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

    # 兜底:若 LLM 没调 finish(没 emit graph),补发一个完整 graph 快照
    if not graph_emitted:
        yield {"kind": "graph", "id": _new_id(), "parentId": agent_evt_id, "agent": "decompose",
               "stepId": None, "payload": _snapshot_graph(sid)}
