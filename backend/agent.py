"""LangGraph 教学智能体。

状态机:
  plan        -> 调 generate_lesson skill 拆出知识点 list (lesson.steps)
  explain     -> 取当前步,产动画意图+公式+讲解事件
  (等用户)    -> human-in-the-loop:下一步 / 更新问题

用 LangGraph 的 StateGraph 编排;manim 生成复用 skill.as_langchain_tool()。
会话状态存内存(竞赛 demo 足够);可扩展到 checkpointer 持久化。
"""
from __future__ import annotations
import uuid
from typing import TypedDict, Optional, Any

from langgraph.graph import StateGraph, START, END

from skill import generate_outline, generate_step, as_langchain_tool, LLMConfig


# ---------- 状态 ----------

class AgentState(TypedDict):
    question: str
    file_text: Optional[str]
    lesson: Optional[dict]          # 完整 Lesson JSON
    current_step: int               # 1-based
    finished: bool


# ---------- 节点 ----------

def plan_node(state: AgentState) -> AgentState:
    """主 agent:只拆知识点 outline(title + steps[{id,title}]),不设计动画。"""
    lesson = generate_outline(state["question"], state.get("file_text"))
    return {**state, "lesson": lesson, "current_step": 1, "finished": False, "step_cache": {}}


def explain_node(state: AgentState) -> AgentState:
    """当前步讲解:从 step_cache 取下游已设计的完整 step;无则标记待设计。"""
    return state


def advance_node(state: AgentState) -> AgentState:
    """推进到下一步。"""
    lesson = state["lesson"]
    if not lesson:
        return state
    nxt = state["current_step"] + 1
    if nxt > len(lesson["steps"]):
        return {**state, "finished": True}
    return {**state, "current_step": nxt}


# ---------- 图 ----------

def build_graph():
    g = StateGraph(AgentState)
    g.add_node("plan", plan_node)
    g.add_node("explain", explain_node)
    g.add_node("advance", advance_node)

    g.add_edge(START, "plan")
    g.add_edge("plan", "explain")
    # explain 后结束本轮(等用户);advance 由外部显式触发再回 explain
    g.add_edge("explain", END)
    g.add_edge("advance", "explain")
    return g.compile()


_GRAPH = build_graph()


# ---------- 会话管理(内存,竞赛 demo)----------

from skill.run_control import SessionRegistry, session_write
_SESSIONS: dict[str, dict] = SessionRegistry()


def start_session(question: str, file_text: Optional[str] = None) -> tuple[str, dict]:
    """新建会话:主 agent 只拆 outline,返回 (session_id, outline lesson)。
    下游 step 设计在切到某步时按需生成并缓存到 step_cache。"""
    sid = str(uuid.uuid4())[:8]
    init: AgentState = {"question": question, "file_text": file_text, "lesson": None, "current_step": 1, "finished": False}
    result = _GRAPH.invoke(init)
    result["step_cache"] = {}  # step_id -> 下游设计的完整 step {title,intent,formula,narration,params,sceneCode}
    result["scene_codes"] = {}  # 兼容旧代码
    result["title"] = result["lesson"].get("title", question[:20]) if result.get("lesson") else question[:20]
    _SESSIONS[sid] = result
    _persist_state(sid)
    return sid, result["lesson"]


def create_session_with_lesson(sid: str, question: str, file_text: Optional[str], lesson: dict) -> None:
    """用已有 outline dict 建会话(不调 LLM),供 outline_agent 流式拆解后用。"""
    # 补全 lesson 字段(同 generate_outline 的校验逻辑)
    lesson.setdefault("title", question[:20])
    lesson.setdefault("summary", "")
    lesson.setdefault("params", [])
    for i, st in enumerate(lesson.get("steps", []), 1):
        st.setdefault("id", i)
        st.setdefault("title", f"第 {i} 步")
        st.setdefault("intent", "")
        st.setdefault("formula", "")
        st.setdefault("narration", "")
        st.setdefault("explanation", "")
        st.setdefault("paramsUsed", [])
    _SESSIONS[sid] = {
        "question": question, "file_text": file_text, "lesson": lesson,
        "current_step": 1, "finished": False,
        "step_cache": {}, "scene_codes": {},
        "title": lesson.get("title", question[:20]),
        # 新:主 agent 多轮对话 + 分层 list + 文件 + 深度 + 步骤状态黑板
        "conversation": [],       # [{role,content,files:[file_id]}] 主 agent 对话历史
        "files": [],              # [{id,name,path,size}] 上传文件元数据
        "depth": "understand",    # popular | understand | deep
        "topics": [],             # [{id,title,summary,steps:[{id,title}]}] 分层知识点(多主题并列)
        "step_status": {},        # step_id(全局唯一) -> pending|generating|done|error 共享黑板
        "graph": None,            # 知识分解图快照 {question,root_title,snapshot} 或 None(该 session 未跑分解)
    }
    _persist_state(sid)


def _persist_state(sid: str) -> None:
    """把内存 session 状态落盘到 sessions/<sid>.state.json(重启不丢)。"""
    from skill.session_store import save_state
    s = _SESSIONS.get(sid)
    if s:
        save_state(sid, s)


def restore_session(sid: str, state: dict) -> None:
    """从落盘的 state.json 重建内存 session(重启后或切回旧会话时)。"""
    _SESSIONS[sid] = {
        "question": state.get("question", ""),
        "file_text": state.get("file_text"),
        "lesson": state.get("lesson"),
        "current_step": state.get("current_step", 1),
        "finished": state.get("finished", False),
        "title": state.get("title", ""),
        # step_cache 键统一为字符串:旧 lesson 流的整数 id 与 topic 流的字符串 id(topicid-N / topicid-SN)
        # 都经 JSON 落地为字符串。不能 int() 强转——topic id 形如 `b8f7f543-1`,强转会 500(见 accessor 统一 str 键)。
        "step_cache": dict(state.get("step_cache") or {}),
        "step_drafts": dict(state.get("step_drafts") or {}),
        "revision": state.get("revision", 0),
        "scene_codes": {},
        # 新字段(旧 state.json 没有则空默认)
        "conversation": state.get("conversation", []),
        "files": state.get("files", []),
        "depth": state.get("depth", "understand"),
        "topics": state.get("topics", []),
        "step_status": state.get("step_status", {}),
        "graph": state.get("graph"),
    }
    # 重建 scene_codes(兼容),键与 step_cache 一致(字符串)
    for k, v in _SESSIONS[sid]["step_cache"].items():
        _SESSIONS[sid]["scene_codes"][k] = v.get("sceneCode", "")


# ---------- 文件存储 ----------

import os as _os

def _uploads_dir(sid: str) -> str:
    """session 的上传文件目录。"""
    base = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "uploads", sid)
    _os.makedirs(base, exist_ok=True)
    return base


def save_upload(sid: str, name: str, data: bytes) -> dict:
    """存上传文件,返回元数据 {id,name,path,size}。id 用于 read/grep 工具引用。"""
    fid = uuid.uuid4().hex[:8]
    safe_name = "".join(c for c in name if c.isalnum() or c in "._-") or "file"
    path = _os.path.join(_uploads_dir(sid), f"{fid}_{safe_name}")
    with open(path, "wb") as f:
        f.write(data)
    meta = {"id": fid, "name": name, "path": path, "size": len(data)}
    s = _SESSIONS.get(sid)
    if s is not None:
        s.setdefault("files", []).append(meta)
        _persist_state(sid)
    return meta


def get_file_meta(sid: str, file_id: str) -> Optional[dict]:
    """按 file_id 取文件元数据(含 path)。"""
    s = _SESSIONS.get(sid)
    if not s:
        return None
    for f in s.get("files", []):
        if f.get("id") == file_id:
            return f
    return None


def load_sessions_on_startup() -> None:
    """Django 启动时调:扫 sessions/*.state.json 重建 _SESSIONS。
    逐个 session try/except——单个坏会话(如旧格式/缺字段)不能拖垮整批加载。"""
    try:
        from skill.session_store import load_all_states
    except Exception:
        return
    loaded = failed = 0
    for sid, st in load_all_states().items():
        try:
            restore_session(sid, st)
            loaded += 1
        except Exception as e:
            failed += 1
            print(f"[load_sessions_on_startup] skip {sid}: {type(e).__name__}: {e}", file=__import__("sys").stderr)
    if failed:
        print(f"[load_sessions_on_startup] loaded={loaded} failed={failed}", file=__import__("sys").stderr)


def export_session(sid: str) -> dict:
    """导出 session 为可序列化 dict(用于下载/归档)。不含内部运行态字段。"""
    s = _SESSIONS.get(sid)
    if not s:
        raise KeyError(f"session {sid} 不存在")
    lesson = s.get("lesson", {})
    return {
        "version": 1,
        "title": lesson.get("title", s.get("title", "")),
        "summary": lesson.get("summary", ""),
        "question": s.get("question", ""),
        "params": lesson.get("params", []),
        "steps": [
            {
                "id": st.get("id", i + 1),
                "title": st.get("title", ""),
                "intent": st.get("intent", ""),
                "formula": st.get("formula", ""),
                "narration": st.get("narration", ""),
                "paramsUsed": st.get("paramsUsed", []),
                # 附上已设计的完整动画代码(若该步已生成);step_cache 键为字符串
                "pythonCode": (s.get("step_cache", {}).get(str(st.get("id", i + 1))) or {}).get("pythonCode", ""),
                "sceneCode": (s.get("step_cache", {}).get(str(st.get("id", i + 1))) or {}).get("sceneCode", ""),
            }
            for i, st in enumerate(lesson.get("steps", []))
        ],
    }


def import_session(data: dict) -> str:
    """从导出的 dict 重建 session(不调 LLM),返回新 sid。"""
    sid = str(uuid.uuid4())[:8]
    lesson = {
        "title": data.get("title", ""),
        "summary": data.get("summary", ""),
        "params": data.get("params", []),
        "steps": [
            {
                "id": st.get("id", i + 1),
                "title": st.get("title", ""),
                "intent": st.get("intent", ""),
                "formula": st.get("formula", ""),
                "narration": st.get("narration", ""),
                "paramsUsed": st.get("paramsUsed", []),
            }
            for i, st in enumerate(data.get("steps", []))
        ],
    }
    result = {
        "question": data.get("question", data.get("title", "")),
        "file_text": None,
        "lesson": lesson,
        "current_step": 1,
        "finished": False,
        "step_cache": {},
        "scene_codes": {},
        "title": lesson["title"],
    }
    # 把每步已设计的动画代码填进 step_cache(键统一字符串)
    for st in data.get("steps", []):
        step_id = str(st.get("id"))
        sc = st.get("sceneCode", "")
        py = st.get("pythonCode", "")
        if sc or py:
            result["step_cache"][step_id] = {
                "title": st.get("title", ""),
                "intent": st.get("intent", ""),
                "formula": st.get("formula", ""),
                "narration": st.get("narration", ""),
                "params": [p for p in data.get("params", []) if p.get("name") in (st.get("paramsUsed") or [])],
                "pythonCode": py,
                "sceneCode": sc,
            }
            result["scene_codes"][step_id] = sc
    _SESSIONS[sid] = result
    return sid


def export_session_md(sid: str) -> str:
    """把会话导出为 Markdown 学习笔记(原理+公式+讲解,可下载/打印)。不触 LLM。"""
    s = _SESSIONS.get(sid)
    if not s:
        raise KeyError(f"session {sid} 不存在")
    lines: list[str] = []
    title = s.get("title") or (s.get("lesson") or {}).get("title", "") or "学习笔记"
    question = s.get("question", "")
    lines.append(f"# {title}")
    lines.append("")
    if question:
        lines.append(f"> 学习主题:{question}")
        lines.append("")

    def _step_block(step: dict, label: str, sc: str = "") -> None:
        lines.append(f"### {label}:{(step.get('title') or '')}")
        lines.append("")
        intent = step.get("intent") or ""
        if intent:
            lines.append("**意图**:")
            lines.append(intent)
            lines.append("")
        expl = step.get("explanation") or step.get("narration") or ""
        formula = step.get("formula") or ""
        body = expl
        if not expl and formula:
            body = f"$${formula}$$"
        if body:
            lines.append("**讲解**:")
            lines.append(body)
            lines.append("")
        used = step.get("paramsUsed") or []
        if used:
            lines.append(f"**可调参数**:{'、'.join(str(u) for u in used)}")
            lines.append("")
        if sc:
            lines.append("<details>")
            lines.append("<summary>动画代码</summary>")
            lines.append("")
            lines.append("```ts")
            lines.append(sc)
            lines.append("```")
            lines.append("</details>")
            lines.append("")

    topics = s.get("topics") or []
    if topics:
        lines.append("## 学习清单")
        for tp in topics:
            lines.append(f"### 📚 {tp.get('title') or '(未命名主题)'}")
            if tp.get("summary"):
                lines.append(tp["summary"])
                lines.append("")
            for st in tp.get("steps", []):
                sid_ = st.get("id")
                # 讲解/意图存于 step_cache(键字符串),合并才导出完整讲解
                cache = s.get("step_cache", {}).get(str(sid_)) or {}
                sc = st.get("sceneCode") or cache.get("sceneCode", "")
                _step_block({**st, **cache}, f"{sid_} 步", sc)
    # 旧 lesson 流
    lesson = s.get("lesson") or {}
    steps = lesson.get("steps", [])
    if steps and not topics:
        lines.append("## 学习清单")
        for st in steps:
            cache = s.get("step_cache", {}).get(str(st.get("id"))) or {}
            sc = st.get("sceneCode") or cache.get("sceneCode", "")
            _step_block({**st, **cache}, f"第 {st.get('id')} 步", sc)
    return "\n".join(lines).rstrip() + "\n"


def get_step_cache(sid: str, step_id) -> Optional[dict]:
    """从会话缓存取某步的完整设计(下游 agent 产出)。键统一为字符串(int id 与 str id 通吃)。"""
    s = _SESSIONS.get(sid)
    if not s:
        return None
    return s.get("step_cache", {}).get(str(step_id))


@session_write
def set_step_cache(sid: str, step_id, step_data: dict) -> None:
    """缓存某步的完整设计。键统一为字符串。"""
    s = _SESSIONS.get(sid)
    if not s:
        return
    s.setdefault("step_cache", {})[str(step_id)] = step_data
    # 同步 scene_codes(兼容)
    s.setdefault("scene_codes", {})[str(step_id)] = step_data.get("sceneCode", "")
    # 同步 step_status 黑板:有 sceneCode 即视为 done
    s.setdefault("step_status", {})[str(step_id)] = "done" if step_data.get("sceneCode") else "error"
    _persist_state(sid)


def accept_step(sid: str, step_id, step_data: dict) -> None:
    """Generated candidates can only replace a saved step after full verification."""
    from skill.run_control import writing
    from skill.verification import normalize_verification
    from skill.step_agent import default_params
    with writing(sid):
        code = step_data.get("sceneCode", "")
        report = normalize_verification(step_data.get("verification"), expected_code=code)
        if (not code or not report["ok"] or code != step_data.get("draftCode")
                or report.get("params", {}) != default_params(step_data)):
            raise ValueError("候选动画未通过当前代码和参数的完整验证")
        state = _SESSIONS.get(sid)
        previous = {key: dict(state.get(key, {})) for key in ("step_cache", "scene_codes", "step_status")} if state else {}
        try:
            set_step_cache(sid, step_id, step_data)
        except Exception:
            if state is not None:
                state.update(previous)
            raise


@session_write
def set_step_status(sid: str, step_id: int, status: str) -> None:
    """更新某步动画生成状态(共享黑板):pending/generating/done/error。"""
    s = _SESSIONS.get(sid)
    if not s:
        return
    s.setdefault("step_status", {})[str(step_id)] = status
    _persist_state(sid)


@session_write
def set_graph(sid: str, graph: dict | None) -> None:
    """保存该 session 的知识分解图快照(随 session 走)。供 decompose 流写回用。
    graph 形如 {question, root_title, snapshot:{nodes,edges}};None 表示清除。"""
    s = _SESSIONS.get(sid)
    if not s:
        return
    s["graph"] = graph
    _persist_state(sid)


def get_scene_code(sid: str, step_id: int) -> Optional[str]:
    """从会话缓存取某步场景代码;无则 None。"""
    st = get_step_cache(sid, step_id)
    return st.get("sceneCode") if st else None


def set_scene_code(sid: str, step_id, code: str) -> None:
    """把场景代码存入会话缓存。键统一为字符串。"""
    s = _SESSIONS.get(sid)
    if not s:
        return
    s.setdefault("scene_codes", {})[str(step_id)] = code
    sc = s.setdefault("step_cache", {})
    if str(step_id) in sc:
        sc[str(step_id)]["sceneCode"] = code


def list_sessions() -> list:
    """列出所有会话摘要(供前端会话列表)。"""
    out = []
    for sid, s in _SESSIONS.items():
        lesson = s.get("lesson") or {}
        out.append({
            "session_id": sid,
            "title": s.get("title") or lesson.get("title", "未命名"),
            "question": s.get("question", ""),
            "current_step": s.get("current_step", 1),
            "step_count": len(lesson.get("steps", [])) if lesson else 0,
        })
    return out


@session_write
def rename_session(sid: str, new_title: str) -> bool:
    """重命名会话标题(会话列表用)。返回是否成功。"""
    s = _SESSIONS.get(sid)
    if not s:
        return False
    title = (new_title or "").strip()[:60]
    if not title:
        return False
    s["title"] = title
    lesson = s.get("lesson") or {}
    if lesson and not lesson.get("title"):
        lesson["title"] = title
    _persist_state(sid)
    return True


@session_write
def delete_session(sid: str) -> bool:
    """删除会话:从内存移除 + 清掉各 agent 模块级缓存(图/草稿/事件/暂停)+ 删除落盘文件。
    若 MemorySaver 还有该 sid 的 checkpoint,一并清(尽力,删不了也继续)。返回是否"找到了要删的"。"""
    existed = sid in _SESSIONS or _path_exists(sid)
    from skill.executor import current_run
    run = current_run(sid)
    if run is not None:
        run.cancel()
    if sid in _SESSIONS:
        del _SESSIONS[sid]
    # 清各 agent 的按 sid 缓存
    for mod_name in ("skill.decompose_agent", "skill.main_agent", "skill.step_agent"):
        try:
            m = __import__(mod_name, fromlist=["x"])
            for attr in ("_GRAPHS", "_EMIT", "_LOCKS", "_DRAFTS", "_RESUMES"):
                if hasattr(m, attr):
                    try:
                        getattr(m, attr).pop(sid, None)
                    except (KeyError, TypeError):
                        pass
        except Exception:
            pass
    # step_agent 的 _DRAFTS/_RESUMES 键是 (sid, step, ...) 元组,上面 pop(sid) 清不到,显式扫删
    try:
        from skill.step_agent import clear_session
        clear_session(sid)
    except Exception:
        pass
    try:
        from skill.session_store import delete_session_files
        delete_session_files(sid)
    except Exception:
        pass
    return existed


_OSEXISTS = __import__("os").path.exists


def _path_exists(sid: str) -> bool:
    """判断该 sid 是否有任何落盘痕迹(state.json / jsonl / uploads / frames / decompose)。"""
    try:
        base = (__import__("os").path.join(
            __import__("os").path.dirname(__import__("os").path.abspath(__file__)), "sessions"))
        ul = (__import__("os").path.join(
            __import__("os").path.dirname(__import__("os").path.abspath(__file__)), "uploads", sid))
        return (_OSEXISTS(__import__("os").path.join(base, f"{sid}.state.json")) or
                _OSEXISTS(__import__("os").path.join(base, f"{sid}.jsonl")) or
                _OSEXISTS(__import__("os").path.join(base, "decompose", f"{sid}.jsonl")) or
                _OSEXISTS(__import__("os").path.join(base, f"{sid}_frames")) or
                _OSEXISTS(ul))
    except Exception:
        return False


def advance_session(sid: str, new_question: Optional[str] = None) -> dict:
    """推进会话:下一步。若给 new_question,则更新问题并重新 plan。"""
    state = _SESSIONS.get(sid)
    if not state:
        raise KeyError(f"会话 {sid} 不存在")
    if new_question:
        state = {**state, "question": new_question}
        result = _GRAPH.invoke(state, config={"configurable": {"thread_id": sid}})
    else:
        result = _GRAPH.invoke({**state}, config={"configurable": {"thread_id": sid}})
        # 简化:手动推进
        lesson = state["lesson"]
        nxt = state["current_step"] + 1
        if nxt > len(lesson["steps"]):
            state["finished"] = True
        else:
            state["current_step"] = nxt
        result = state
    _SESSIONS[sid] = result
    return result


def get_session(sid: str) -> Optional[dict]:
    return _SESSIONS.get(sid)


# 暴露 langchain tool(供未来更复杂的 agent 直接用)
manim_tool = as_langchain_tool()
