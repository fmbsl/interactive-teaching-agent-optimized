"""主 agent:知识点拆解 tool-calling。

用 create_react_agent 编排:LLM 调 set_lesson_title / add_step / set_summary / finish_outline
逐个加知识点,流式发 tool_call/tool_result 事件进执行树(像 Claude Code)。

对比旧 generate_outline(一次性 JSON),这里 LLM 逐步拆,树里能看到它怎么拆。
无 interrupt(主 agent 不做浏览器验证,直接跑完)。
"""
from __future__ import annotations
from typing import Optional
from collections import defaultdict

from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from .manim_lesson import _get_runtime_cfg, OUTLINE_PROMPT


# 每会话一份草稿
_DRAFTS: dict[str, dict] = defaultdict(lambda: {"title": "", "summary": "", "steps": []})
import uuid as _uuid


def _new_id(sid: str) -> str:
    return _uuid.uuid4().hex[:12]


OUTLINE_AGENT_PROMPT = """你是教学知识点拆解 agent。把用户的 STEM 知识点拆成一系列递进的子知识点,**一次性**调用 set_outline 给出完整拆解结果。

**工作方式**:只调工具,不要输出 JSON 或自然语言解释。只调用一次 set_outline 即完成拆解。
- set_outline:一次性给出完整知识点拆解。参数:
  - title:知识点总称。
  - summary:一句话概括。
  - steps:子知识点标题列表(字符串数组),顺序即讲解顺序。每项简短标题 10-20 字,如"矩阵乘法的定义"。

拆解原则:
- 子知识点数量由知识点复杂度决定:简单概念 2-4 步即可,复杂体系 7-9 步。不要为凑数硬拆,也不要漏关键环节。
- 顺序符合学习规律(直观/动机 → 定义 → 计算/示例 → 性质/陷阱 → 拓展),但不强制每步都要有,按需取舍。
- 子知识点间逻辑连续,后一个建立在前一个之上。
- 全程中文。
"""


def _build_tools(sid: str):
    draft = _DRAFTS[sid]

    @tool
    def set_outline(title: str, summary: str, steps: list[str]) -> str:
        """一次性设置完整知识点拆解:title=总称,summary=一句话概括,steps=子知识点标题字符串数组(顺序即讲解顺序)。整个拆解结果在这一步全部给出,不要分多次调用。"""
        draft["title"] = title
        draft["summary"] = summary
        draft["steps"] = [{"id": i + 1, "title": t} for i, t in enumerate(steps or [])]
        return f"拆解已设:{title} · {len(draft['steps'])} 步"

    return [set_outline]


_SAVER = MemorySaver()


def _build_agent(cfg, sid: str):
    tools = _build_tools(sid)
    model = ChatOpenAI(base_url=cfg.base_url, api_key=cfg.api_key or "dummy", model=cfg.model, temperature=0.7)
    return create_react_agent(model=model, tools=tools, checkpointer=_SAVER, prompt=OUTLINE_AGENT_PROMPT)


def run_outline_agent(sid: str, question: str, file_text: Optional[str] = None, cfg=None):
    """运行主 agent 拆解。生成器 yield 事件 dict:
    {kind: agent_start|tool_call|tool_result|outline|error, id, parentId, agent=main, payload}。
    无 interrupt,一次跑完。最终 yield outline(含 title/steps)。
    """
    cfg = cfg or _get_runtime_cfg()
    _DRAFTS[sid] = {"title": "", "summary": "", "steps": []}
    agent_obj = _build_agent(cfg, sid)
    user_msg = question
    if file_text:
        ft = file_text[:8000]
        user_msg = f"用户上传的文件内容(围绕其中的知识点拆解):\n```\n{ft}\n```\n\n用户的问题:{question}"
    else:
        user_msg = f"用户的问题:{question}\n\n请调用 set_outline 一次性给出完整拆解(总称、概括、子知识点标题列表)。"

    config = {"configurable": {"thread_id": f"outline#{sid}"}}
    agent_evt_id = _new_id(sid)
    yield {"kind": "agent_start", "id": agent_evt_id, "parentId": None, "agent": "main",
           "stepId": None, "payload": {"title": "主 agent · 知识点拆解"}}

    tcid_to_evt: dict = {}
    current_parent = agent_evt_id
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
               "stepId": None, "payload": {"message": f"主 agent 异常:{type(e).__name__}: {e}"}}
        return

    draft = _DRAFTS[sid]
    if draft["steps"]:
        yield {"kind": "outline", "id": _new_id(sid), "parentId": agent_evt_id, "agent": "main",
               "stepId": None,
               "payload": {"title": draft["title"] or question[:20], "summary": draft["summary"],
                           "steps": draft["steps"]}}
    else:
        yield {"kind": "error", "id": _new_id(sid), "parentId": agent_evt_id, "agent": "main",
               "stepId": None, "payload": {"message": "主 agent 未生成任何子知识点"}}
