"""主 agent:多轮对话中枢。

升级自 outline_agent.py:不再一次性拆 list,而是和用户多轮对话,能:
- 拆知识点(add_topic,可多次,每次一个主题 → 分层 list)
- 问用户澄清问题(ask_user,用 interrupt 暂停等用户回答)
- 读用户上传的文件(read/grep,仿 Claude Code,不全量塞上下文)
- 触发某步动画生成(generate_animation,用 interrupt 暂停等 subagent 跑完)
- 调整学习深度(set_depth)

用 create_react_agent + MemorySaver(跨轮保持对话,interrupt/resume 问答)。
共享黑板:session.step_status 记录各步动画生成状态,主 agent 被唤醒时读它知情。
"""
from __future__ import annotations
from typing import Optional
from collections import defaultdict

from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command, interrupt
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from .manim_lesson import _get_runtime_cfg
from .file_tools import read_file, grep_file
from . import user_prefs
# agent.py 在模块顶层 import skill.*,为避免循环导入,这里用延迟导入(函数内 import agent)
# 见 _agent() 辅助函数。


# 每会话一份草稿(topics 在此累积,写回 session)
_DRAFTS: dict[str, dict] = defaultdict(lambda: {"topics": []})
import uuid as _uuid


def _new_id(sid: str) -> str:
    return _uuid.uuid4().hex[:12]


def _agent():
    """延迟导入 agent 模块(避免 skill <-> agent 循环导入)。"""
    import agent as _a
    return _a


# ---------- 用户偏好(全局记忆) ----------

def _load_prefs() -> str:
    try:
        return user_prefs.load_prefs()
    except Exception:
        return ""


# ---------- 系统提示词 ----------

def _build_system_prompt(depth: str = "understand") -> str:
    depth_guide = {
        "popular": ("科普:目标是直观上懂,多用类比、比喻、生活场景,少用公式;拆解粒度粗(2-4 步),"
                    "每步动画重在建立直觉,讲解避免数学细节。"),
        "understand": ("理解:懂原理、会迁移;拆解粒度适中(4-7 步),讲清来龙去脉,公式与直觉并重,"
                       "适当展示典型示例和易错点。"),
        "deep": ("深度理解:类似本科课程,要求能运用知识解题/解决实际问题;拆解可细(6-10 步),"
                 "讲清定义、定理、证明思路、计算技巧、综合应用,动画可包含较复杂的推导过程。"),
    }.get(depth, "")
    prefs = _load_prefs()
    return f"""你是教学智能体的主 agent,职责是帮用户学会 STEM 知识点。

**身份与工作方式**:
- 你和用户多轮对话。每收到用户消息,判断该做什么:问澄清问题 / 拆解知识点 / 调整深度 / 读用户上传的文件后再拆 / 触发某步动画生成。
- 通过调用工具行动,不要输出 JSON。可以输出简短自然语言和用户沟通(如"我来帮你拆解X"),但实质动作都靠工具。

**用户偏好(全局记忆)**:
{prefs or "(用户尚未设置偏好)"}

**当前学习深度**:{depth}
{depth_guide}
若用户在对话中表现出深度不合适(嫌太细/太浅),可调 set_depth 自动调整。

**核心工具**:
- add_topic(title, summary, steps):拆解一个主题为子知识点列表。每次调用追加一个主题到知识点 list。用户学新东西就调它;一个主题拆完可继续拆下一个(多主题并列)。
  - steps:子知识点标题字符串数组(10-20 字),顺序即讲解顺序。数量按深度与复杂度定。
- ask_user(question):当知识点有歧义(如"卷积"是信号系统的还是 CNN 的)或需要明确用户意图时,调此工具问用户。会暂停等用户回答。
- read(file_id, offset?, limit?):读用户上传文件的片段(带行号),offset=起始行(1-based),limit=行数(默认100)。大文件分片读。**用户上传的文件不要假设内容,用此工具按需读。**
- grep(pattern, file_id?):在文件里正则搜索,返回匹配行+行号。快速定位文件里的关键词。
- generate_animation(step_id):触发某步动画的生成(交给 subagent 在浏览器验证)。会暂停等生成完。生成结果会写共享状态,你下次被唤醒时也能从 step_status 看到各步是否已生成。
- set_depth(level):调整学习深度("popular"/"understand"/"deep")。

**文件处理**:用户上传文件后,你只在消息里看到文件名和 file_id,**不是全文**。要了解内容必须调 read/grep。不要凭文件名猜测内容。

**拆解原则**:顺序符合学习规律(直观/动机 → 定义 → 计算/示例 → 性质/陷阱 → 拓展),子知识点间逻辑连续。全程中文。
"""


# ---------- 工具 ----------

def _build_tools(sid: str):
    draft = _DRAFTS[sid]

    @tool
    def add_topic(title: str, summary: str, steps: list[str]) -> str:
        """拆解一个主题为子知识点列表,追加到知识点 list。每次调用加一个主题(可多次,多主题并列)。
        title=主题名;summary=一句话概括;steps=子知识点标题数组(10-20字,顺序即讲解顺序)。"""
        topic = {
            "id": _uuid.uuid4().hex[:8],
            "title": title,
            "summary": summary,
            "steps": [{"id": f"{topic['id']}-{i+1}", "title": t} for i, t in enumerate(steps or [])],
        }
        # 写回 session.topics + 草稿
        s = _agent().get_session(sid)
        if s is not None:
            s.setdefault("topics", []).append(topic)
            _agent()._persist_state(sid)
        draft.setdefault("topics", []).append(topic)
        return f"已添加主题:{title} · {len(steps or [])} 步"

    @tool
    def ask_user(question: str) -> str:
        """向用户提一个澄清问题(如知识点有歧义、需明确意图时)。会暂停等用户回答,回答作为返回值。
        一次只问一个明确的问题,不要一次问多个。"""
        result = interrupt({"kind": "ask", "question": question})
        # result = 用户回答的文本
        return f"用户回答:{result}" if result else "用户未回答(跳过)"

    @tool
    def read(file_id: str, offset: int = 0, limit: int = 100) -> str:
        """读用户上传文件的片段(带行号)。file_id 从用户消息里的文件信息取;offset=起始行(1-based,0=从头);limit=行数(默认100)。
        大文件用 offset 分片读。返回带行号的片段。"""
        meta = _agent().get_file_meta(sid, file_id)
        if not meta:
            return f"找不到 file_id={file_id}。可用的文件:" + ", ".join(
                f"{f['id']}({f['name']})" for f in (_agent().get_session(sid) or {}).get("files", [])
            )
        return read_file(meta["path"], offset=offset, limit=limit)

    @tool
    def grep(pattern: str, file_id: str = "") -> str:
        """在用户上传文件里正则搜索,返回匹配行+行号。pattern=正则;file_id 留空则搜该 session 所有文件。"""
        s = _agent().get_session(sid)
        files = (s or {}).get("files", [])
        if file_id:
            meta = _agent().get_file_meta(sid, file_id)
            if not meta:
                return f"找不到 file_id={file_id}"
            return grep_file(meta["path"], pattern, context=1)
        if not files:
            return "该会话没有上传文件"
        return "\n\n".join(grep_file(f["path"], pattern, context=1) for f in files)

    @tool
    def generate_animation(step_id: str) -> str:
        """触发某步动画生成(交给 subagent 在浏览器验证)。会暂停等生成完。
        step_id 是 add_topic 返回的子知识点 id(形如 topicid-N)。生成结果写共享状态 step_status。
        通常在用户明确想看某步动画、或你想基于动画讲解时调用。"""
        # 暂停,等视图层跑 subagent 后 resume。interrupt value 传 step_id,视图层据此调 step_agent。
        result = interrupt({"kind": "generate", "step_id": step_id})
        # result 形如 {"ok":true, "step_id":...} 或 {"ok":false, "error":...}
        if isinstance(result, dict) and result.get("ok"):
            return f"第 {step_id} 步动画已生成。"
        err = result.get("error", "未知错误") if isinstance(result, dict) else str(result)
        return f"第 {step_id} 步动画生成失败:{err}"

    @tool
    def set_depth(level: str) -> str:
        """调整学习深度:"popular"(科普)/"understand"(理解)/"deep"(深度理解)。根据用户表现或显式要求调整。"""
        if level not in ("popular", "understand", "deep"):
            return f"无效深度 {level},可选:popular/understand/deep"
        s = _agent().get_session(sid)
        if s is not None:
            s["depth"] = level
            _agent()._persist_state(sid)
        return f"学习深度已设为:{level}"

    return [add_topic, ask_user, read, grep, generate_animation, set_depth]


# ---------- agent 构造 ----------

_SAVER = MemorySaver()


def _build_agent(cfg, sid: str, depth: str = "understand"):
    tools = _build_tools(sid)
    model = ChatOpenAI(base_url=cfg.base_url, api_key=cfg.api_key or "dummy", model=cfg.model, temperature=0.7)
    return create_react_agent(
        model=model, tools=tools, checkpointer=_SAVER,
        prompt=_build_system_prompt(depth),
    )


# ---------- 运行:多轮(追加消息,stream 事件) ----------

# resume 值暂存:前端 POST /api/chat_answer 时存,run_main_agent 的循环读取
_RESUMES: dict[str, dict] = {}


def set_chat_answer(sid: str, answer: str) -> None:
    """前端回传用户对 ask_user 的回答(由 /api/chat_answer 调)。"""
    _RESUMES[sid] = {"answer": answer}


def run_main_agent(sid: str, user_text: str, depth: Optional[str] = None, cfg=None):
    """运行主 agent 一轮(用户发消息)。生成器 yield 事件 dict。
    事件 kind:agent_start|tool_call|tool_result|ask|topic_added|animation_request|error|done。
    遇 ask_user/generate_animation 的 interrupt,yield 对应事件后 return(等前端 resume)。"""
    cfg = cfg or _get_runtime_cfg()
    s = _agent().get_session(sid)
    cur_depth = depth or (s.get("depth") if s else "understand")
    if s is not None:
        s["depth"] = cur_depth
        # 追加用户消息到对话历史
        s.setdefault("conversation", []).append({"role": "user", "content": user_text})
        _agent()._persist_state(sid)
    _DRAFTS[sid] = {"topics": list((s or {}).get("topics", []))}

    thread_id = f"main#{sid}"
    agent_obj = _build_agent(cfg, sid, cur_depth)
    config = {"configurable": {"thread_id": thread_id}}
    agent_evt_id = _new_id(sid)
    yield {"kind": "agent_start", "id": agent_evt_id, "parentId": None, "agent": "main",
           "stepId": None, "payload": {"title": "主 agent · 对话"}}

    tcid_to_evt: dict = {}
    current_parent = agent_evt_id
    interrupt_value = None
    try:
        for chunk in agent_obj.stream(
            {"messages": [{"role": "user", "content": user_text}]},
            config, stream_mode="updates",
        ):
            for node, state in chunk.items():
                if node == "__interrupt__":
                    ivs = state if isinstance(state, (list, tuple)) else [state]
                    for iv in ivs:
                        v = getattr(iv, "value", iv)
                        if isinstance(v, dict):
                            interrupt_value = v
                    continue
                msgs = state.get("messages", []) if isinstance(state, dict) else []
                for m in msgs:
                    nm = type(m).__name__
                    if nm == "AIMessage" and getattr(m, "tool_calls", None):
                        for tc in m.tool_calls:
                            eid = _new_id(sid)
                            tcid_to_evt[tc.get("id")] = eid
                            yield {"kind": "tool_call", "id": eid, "parentId": current_parent,
                                   "agent": "main", "stepId": None,
                                   "payload": {"name": tc.get("name"), "args": tc.get("args", {})}}
                    elif nm == "ToolMessage":
                        tcid = getattr(m, "tool_call_id", None)
                        parent = tcid_to_evt.get(tcid, current_parent)
                        out = str(getattr(m, "content", ""))[:2000]
                        yield {"kind": "tool_result", "id": _new_id(sid), "parentId": parent,
                               "agent": "main", "stepId": None,
                               "payload": {"toolCallId": tcid, "output": out}}
    except Exception as e:
        yield {"kind": "error", "id": _new_id(sid), "parentId": current_parent, "agent": "main",
               "stepId": None, "payload": {"message": f"主 agent 异常:{type(e).__name__}: {e}"}}
        return

    # 处理 interrupt(ask_user 或 generate_animation)
    if interrupt_value:
        k = interrupt_value.get("kind")
        if k == "ask":
            yield {"kind": "ask", "id": _new_id(sid), "parentId": agent_evt_id, "agent": "main",
                   "stepId": None, "payload": {"question": interrupt_value.get("question", "")}}
            return
        if k == "generate":
            yield {"kind": "animation_request", "id": _new_id(sid), "parentId": agent_evt_id,
                   "agent": "main", "stepId": interrupt_value.get("step_id"),
                   "payload": {"step_id": interrupt_value.get("step_id", "")}}
            return

    # 无 interrupt:本轮对话跑完。把草稿里新增的 topic 推 topic_added 事件(前端 list 增量)
    for topic in _DRAFTS[sid].get("topics", []):
        # 只推 session 里新于本次的(简化:全推,前端去重)
        yield {"kind": "topic_added", "id": _new_id(sid), "parentId": agent_evt_id, "agent": "main",
               "stepId": None, "payload": topic}
    yield {"kind": "done", "id": _new_id(sid), "parentId": agent_evt_id, "agent": "main",
           "stepId": None, "payload": {"message": "本轮对话结束"}}


def resume_main_agent(sid: str, cfg=None):
    """前端回传 ask 回答 / generate 结果后,恢复主 agent 继续跑。生成器 yield 同 run_main_agent。"""
    cfg = cfg or _get_runtime_cfg()
    s = _agent().get_session(sid)
    cur_depth = (s or {}).get("depth", "understand")
    thread_id = f"main#{sid}"
    agent_obj = _build_agent(cfg, sid, cur_depth)
    config = {"configurable": {"thread_id": thread_id}}

    # 取 resume 值:ask 的回答 或 generate 的结果
    ans = _RESUMES.pop(sid, None)
    if ans is None:
        yield {"kind": "error", "id": _new_id(sid), "parentId": None, "agent": "main",
               "stepId": None, "payload": {"message": "无待处理的回答/结果"}}
        return
    # generate 的结果形如 {ok, step_id, error?};ask 的结果是 {answer}
    resume_val = ans.get("answer") if "answer" in ans else ans

    agent_evt_id = _new_id(sid)
    yield {"kind": "agent_start", "id": agent_evt_id, "parentId": None, "agent": "main",
           "stepId": None, "payload": {"title": "主 agent · 续对话"}}
    tcid_to_evt: dict = {}
    current_parent = agent_evt_id
    interrupt_value = None
    try:
        for chunk in agent_obj.stream(Command(resume=resume_val), config, stream_mode="updates"):
            for node, state in chunk.items():
                if node == "__interrupt__":
                    ivs = state if isinstance(state, (list, tuple)) else [state]
                    for iv in ivs:
                        v = getattr(iv, "value", iv)
                        if isinstance(v, dict):
                            interrupt_value = v
                    continue
                msgs = state.get("messages", []) if isinstance(state, dict) else []
                for m in msgs:
                    nm = type(m).__name__
                    if nm == "AIMessage" and getattr(m, "tool_calls", None):
                        for tc in m.tool_calls:
                            eid = _new_id(sid)
                            tcid_to_evt[tc.get("id")] = eid
                            yield {"kind": "tool_call", "id": eid, "parentId": current_parent,
                                   "agent": "main", "stepId": None,
                                   "payload": {"name": tc.get("name"), "args": tc.get("args", {})}}
                    elif nm == "ToolMessage":
                        tcid = getattr(m, "tool_call_id", None)
                        parent = tcid_to_evt.get(tcid, current_parent)
                        yield {"kind": "tool_result", "id": _new_id(sid), "parentId": parent,
                               "agent": "main", "stepId": None,
                               "payload": {"toolCallId": tcid, "output": str(getattr(m, "content", ""))[:2000]}}
    except Exception as e:
        yield {"kind": "error", "id": _new_id(sid), "parentId": current_parent, "agent": "main",
               "stepId": None, "payload": {"message": f"resume 异常:{type(e).__name__}: {e}"}}
        return

    if interrupt_value:
        k = interrupt_value.get("kind")
        if k == "ask":
            yield {"kind": "ask", "id": _new_id(sid), "parentId": agent_evt_id, "agent": "main",
                   "stepId": None, "payload": {"question": interrupt_value.get("question", "")}}
            return
        if k == "generate":
            yield {"kind": "animation_request", "id": _new_id(sid), "parentId": agent_evt_id,
                   "agent": "main", "stepId": interrupt_value.get("step_id"),
                   "payload": {"step_id": interrupt_value.get("step_id", "")}}
            return

    for topic in _DRAFTS[sid].get("topics", []):
        yield {"kind": "topic_added", "id": _new_id(sid), "parentId": agent_evt_id, "agent": "main",
               "stepId": None, "payload": topic}
    yield {"kind": "done", "id": _new_id(sid), "parentId": agent_evt_id, "agent": "main",
           "stepId": None, "payload": {"message": "本轮对话结束"}}
