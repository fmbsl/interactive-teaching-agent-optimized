"""Step 生成 agent:tool-calling + 浏览器在环验证。

用 LangGraph create_react_agent 编排:LLM 调 set_title/set_intent/set_explanation/set_params/
add_animation 等工具逐项设计一个教学 step。其中 add_animation(code) 通过 interrupt() 暂停,
等前端真渲染回传结果(ok/error)后 resume,LLM 据此修正 code 重调,直到跑通。

对比旧的 generate_step(一次性 JSON + 单次重试),这里是多轮 tool loop,运行时错就地修。

已实测:create_react_agent + MemorySaver + tool 内 interrupt() + Command(resume=) 全链路通
(langgraph 1.2.10 / langgraph-prebuilt 1.1.0 / langchain-openai 1.3.2)。
"""
from __future__ import annotations
from typing import Optional, Any
from collections import defaultdict

from langgraph.prebuilt import create_react_agent  # 弃用但仍可用(langchain 主包未装,无法用 langchain.agents.create_agent)
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command, interrupt
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from .manim_lesson import (
    LLMConfig, _get_runtime_cfg, _call_vision_llm,
    API_REF_BLOCK, RUNTIME_RULES_BLOCK, FEWSHOT_BLOCK, TEACHING_NORMS_BLOCK,
)
from .llm_config_store import _get_vision_cfg


# ---------- 草稿存储:每个 (sid, step_id) 一份,工具往里写 ----------

_DRAFTS: dict[tuple[str, str], dict] = defaultdict(lambda: {
    "title": "", "intent": "", "explanation": "", "formula": "", "narration": "",
    "params": [], "sceneCode": "", "renderAttempts": 0,
})

# 事件 id 生成(无 Date.now/random 限制只针对 workflow 脚本;这里是后端 Python,可用 uuid)
import uuid as _uuid


def _new_id(sid: str) -> str:
    return _uuid.uuid4().hex[:12]


# 每个 (sid, step_id) 一轮运行一个 thread_id(含 run nonce),供 MemorySaver 区分。
# 重跑同一步用新 nonce,避免旧 interrupted 状态残留导致 "tool_calls without ToolMessage"。
def _thread_id(sid: str, step_id: int, nonce: str) -> str:
    return f"{sid}#{step_id}#{nonce}"


# ---------- 系统提示词:复用 STEP_PROMPT 的 API REF / 铁律 / FEW SHOT / 教学规范 ----------

STEP_AGENT_SYSTEM_PROMPT = f"""你是教学动画设计 agent。为一个子知识点逐步设计浏览器讲解:标题、意图、讲解、(可选)可调参数、动画代码。

**工作方式**:通过调用工具逐项设置,不要输出 JSON 或自然语言解释,只调工具。
- set_title:简短标题。
- set_intent:一句话教学意图(动画想让学生看到什么)。
- set_explanation:讲解正文,**Markdown 格式**,文字与公式混排。公式用 `$...$`(行内)或 `$$...$$`(独占一行),会被 KaTeX 渲染。可含标题/列表/段落。这是该步的完整讲解,讲清来龙去脉,承接上文。
- set_params:**仅当这一步确实需要用户交互调节参数时才调**(如"拖动看角度变化")。无需可调参数就跳过这个工具,不要硬凑。
- update_animation(code, old_str?, new_str?):提交或修改动画代码,浏览器真渲染验证。**一个工具两种用法**:
  - 整段提交(首次或大改):只给 `code`(完整 manim-web TS 函数体),不传 old_str/new_str。
  - 局部改(小修,省 token):传 `old_str`+`new_str`(不传 code)。在当前代码里定位 old_str(必须**唯一**匹配,含缩进,从当前代码原样复制一段),替换成 new_str(空串=删除),整段送验证。找不到/不唯一会报错——补上下文或改整段提交。
  - 返回 {{ok: true}} 渲染通过、动画定稿;{{ok: false, error}} 报错,按 error 继续调本工具。**渲染失败后必须先用 `old_str`/`new_str` 局部改**(只发改动片段,省 token),不要整段重写。只有以下情况才用整段提交(只给 code):(1) 首次提交;(2) 改动超过约 1/3 代码;(3) old_str 连续两次匹配不上(找不到/不唯一);(4) 需大范围重构。最多重试 5 次。
- read_animation():返回当前动画代码全文。做局部改(old_str)前建议先调它确认当前代码长什么样、要改哪段。
- finish():所有字段就绪且动画 ok 后收尾。

工具调用顺序自由发挥,不强制先设哪个。但动画 code 必须经 update_animation 验证通过(ok=true)才能 finish。

sceneCode 格式:manim-web TypeScript 函数体。开头 `const {{ ... }} = ctx;` 解构出用到的标识符(必含 `scene`)。用 `await scene.play(...)` / `scene.add(...)` 驱动。

⚠️ **params 解构铁律(高频错,务必遵守)**:
- 只要你调了 `set_params`,代码里就一定会用 `params.<name>` 读参数。**解构行的 `{{ }}` 里必须显式列出 `params`**,否则运行时报 `params is not defined`。
- 正确:`const {{ scene, Axes, Dot, Text, Create, params }} = ctx;` 然后 `const x = params.x;`
- 错误:解构行写了 `scene, Axes, Dot` 却漏 `params`,代码里又用 `params.x` → 报错。
- 反过来:**没调 set_params(无参数)就完全不要在代码里引用 `params`**,解构行也别写它。
- 这条是 `params is not defined` 的唯一根因,渲染失败一次就要立刻检查解构行有没有 `params`。

{API_REF_BLOCK}

{RUNTIME_RULES_BLOCK}

{FEWSHOT_BLOCK}

{TEACHING_NORMS_BLOCK}

记住:动画 code 必须先经 add_animation 验证通过(ok=true)才算数;不要凭空写完就 finish。
"""


# ---------- 工具(闭包捕获 sid/step_id,写入草稿)----------

def _run_vision_check(frame_path: str, sid: str, step_id: int) -> str:
    """读最后一帧 png → base64 → 调视觉辅助模型描述画面。返回描述(失败/未配辅助模型返回空)。
    主模型 supports_vision=True 时当前也走这里(辅助模型描述),路径 A(主模型直接看图)TODO。"""
    try:
        import base64 as _b64, os as _os
        if not _os.path.exists(frame_path):
            return ""
        with open(frame_path, "rb") as _f:
            b64 = _b64.b64encode(_f.read()).decode("ascii")
        vcfg = _get_vision_cfg()
        if vcfg is None:
            return ""  # 未配视觉辅助模型,降级:无视觉检查
        # 只做画面布局/显示品质检查(文字、图形是否重叠可读),不判断内容是否体现教学意图
        prompt = (
            "这是 manim 教学动画的最后一帧截图。请只检查画面布局与显示质量,报告是否存在:"
            "① 文字/标签互相重叠、或文字压在图形上不可读;\n"
            "② 有无明显显示问题(文字超出画布、颜色与背景混淆不可见、画面空白无内容等)。\n"
            "不要判断画面内容是否体现了教学意图或是否正确。\n"
            "用 2-4 句中文回答:有问题就指出具体是哪种重叠/显示问题;都正常就说明\"画面布局正常\"。\n"
        )
        return _call_vision_llm(prompt, b64, vcfg)
    except Exception as e:
        import sys as _sys
        print(f"[vision] _run_vision_check 失败:{type(e).__name__}: {e}", file=_sys.stderr)
        return ""


def _build_tools(sid: str, step_id: int):
    draft = _DRAFTS[(sid, step_id)]

    @tool
    def set_title(title: str) -> str:
        """设置该步标题(简短,如"正弦函数的定义")。"""
        draft["title"] = title
        return f"标题已设:{title}"

    @tool
    def set_intent(intent: str) -> str:
        """设置该步教学意图(一句话,这一步要让学生理解什么)。"""
        draft["intent"] = intent
        return "意图已设"

    @tool
    def set_explanation(explanation: str) -> str:
        """设置讲解正文,Markdown 格式,文字与公式混排。公式用 $...$ 行内或 $$...$$ 独占行(KaTeX 渲染)。可含标题/列表/段落。讲清来龙去脉,承接上文。"""
        draft["explanation"] = explanation
        # 兼容旧字段:从 explanation 提取首个 $...$/$$...$$ 作 formula,纯文本作 narration
        import re as _re
        fm = _re.search(r'\$\$?(.+?)\$\$?', explanation, _re.S)
        draft["formula"] = fm.group(1).strip() if fm else ""
        draft["narration"] = _re.sub(r'\$\$?.+?\$\$?', '', explanation).strip()
        return "讲解已设"

    @tool
    def set_params(params_json: str) -> str:
        """设置可调参数,JSON 数组字符串,每项 {{name,label,min,max,step,default}}。**仅当该步确实需要用户调参时才调**;无需参数就跳过本工具或传 '[]'。"""
        import json as _json
        try:
            draft["params"] = _json.loads(params_json)
        except Exception as e:
            return f"参数 JSON 解析失败:{e}"
        return f"参数已设:{len(draft['params'])} 个"

    @tool
    def update_animation(code: str = "", old_str: str = "", new_str: str = "") -> str:
        """提交或修改动画代码(manim-web TS 函数体),浏览器真渲染验证。两种用法:

        1) **整段提交**:只给 `code`(完整函数体),不传 old_str/new_str。**仅用于**:首次提交、改动超 1/3 代码、old_str 连续两次匹配不上、或大范围重构。
        2) **局部改**(默认首选,省 token):传 `old_str` + `new_str`(不传 code)。在当前代码里定位 old_str(必须**唯一**匹配,含缩进),替换成 new_str,整段送验证。
           - **渲染失败后必须先用本方式局部改**,不要整段重写。
           - old_str 要从当前代码里**原样复制一段**(带足够上下文保证唯一),new_str 是替换后内容(空串=删除)。
           - 找不到/不唯一/无变化会报错——补上下文让它唯一;连续两次匹配不上再改用整段提交(只给 code)。

        返回:ok=true 渲染通过、动画定稿;ok=false 给出 error,按错误继续调本工具修(优先局部改)。
        最多重试 5 次。"""
        # 决定本次提交的完整代码:传了 old_str 走局部改,否则用 code 整段
        if old_str:
            current = draft.get("sceneCode") or draft.get("_lastSubmittedCode") or ""
            if not current:
                return "渲染失败:当前没有可局部改的代码(还没提交过)。改用整段提交:只给 code,不传 old_str。"
            n = current.count(old_str)
            if n == 0:
                return f"渲染失败:old_str 在当前代码里找不到。检查缩进/拼写,或调 read_animation 看当前代码,或改用整段提交(只给 code)。"
            if n > 1:
                return f"渲染失败:old_str 在代码里出现 {n} 次,不唯一。多带几行上下文让它唯一,或改用整段提交(只给 code)。"
            new_code = current.replace(old_str, new_str, 1)
            if new_code == current:
                return "渲染失败:替换后代码无变化(old_str == new_str?)。"
        else:
            new_code = code
            if not new_code:
                return "渲染失败:既没给 code(整段),也没给 old_str(局部改)。二选一。"
            # 整段提交:new_code 就是全新当前代码,失败也以它为准(下次 edit 基于它)。提前设。
            draft["_lastSubmittedCode"] = new_code

        draft["renderAttempts"] += 1
        # 落盘每次提交的完整代码(临时调试:看 LLM 实际生成/合成什么)
        try:
            import os as _os, datetime as _dt
            _p = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "step_codes.log")
            with open(_p, "a", encoding="utf-8") as _f:
                _f.write(f"\n===== {_dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} sid={sid} step={step_id} attempt={draft['renderAttempts']} code_len={len(new_code)} mode={'edit' if old_str else 'full'} =====\n")
                _f.write(new_code)
                _f.write("\n")
        except Exception:
            pass
        # ⚠️ 不能在 interrupt 前就把 _lastSubmittedCode 设成 new_code!
        # langgraph resume 会从工具入口重跑(不是从 interrupt 处继续),重跑时 current=_lastSubmittedCode,
        # 若已是替换后的 new_code,old_str 已被换掉 → count=0 报"找不到"(实测高频 bug)。
        # 所以 _lastSubmittedCode 只在渲染**通过**时才更新(sceneCode 同)。失败时保持旧版,重跑/重试都基于旧版。
        # 暂停,等前端渲染回传。interrupt 的值会作为 SSE render_request 推给前端。
        result = interrupt({"code": new_code})
        if isinstance(result, dict) and result.get("ok"):
            draft["sceneCode"] = new_code
            draft["_lastSubmittedCode"] = new_code  # 通过才更新:下次 edit/read 基于定稿版
            # 视觉检查(仅提示不阻塞):若前端截了最后一帧(framePath),调视觉辅助模型描述画面。
            # 主模型 supports_vision 时本可直接看图,但 langchain tool 返回是字符串,当下走辅助模型描述。
            frame_path = result.get("framePath", "")
            vision_desc = ""
            if frame_path:
                vision_desc = _run_vision_check(frame_path, sid, step_id)
            if vision_desc:
                return (f"渲染通过,动画已定稿。视觉检查(辅助模型看最后一帧):{vision_desc}\n"
                        f"如发现文字重叠、动画没真正实现(关键对象没进场景/没动)、或效果差,**可再调 update_animation 修改**(局部改用 old_str/new_str);否则可 finish。")
            return "渲染通过,动画已定稿。可以继续设其它字段或 finish。"
        err = result.get("error", "未知错误") if isinstance(result, dict) else str(result)
        # waitForRender 错误常是 manim-web 内部抛的(非你代码直接调),给针对性指引
        if "waitForRender" in err:
            err += "。这是 manim-web 内部渲染错,常见原因:(1)对 Text/Dot/Arrow 等非公式对象调了 waitForRender(只有 MathTexImage/MathTex/Variable 有此方法,删掉该调用);(2)MathTexImage/MathTex 构造失败(检查 latex 字符串是否合法、解构行是否含 MathTexImage);(3)mobject 构造后状态异常。尝试简化:去掉可疑的 waitForRender 调用,或减少当步 mobject 数。"
        return f"渲染失败:{err}。**下一步必须先用 old_str/new_str 局部改**(只发改动片段,从当前代码原样复制 old_str),不要整段重写;除非改动超 1/3 或 old_str 两次匹配不上才用整段提交(只给 code)。"

    @tool
    def read_animation() -> str:
        """返回当前动画代码全文(渲染通过版 sceneCode,或最近一次提交但未通过的版本)。当你不确定当前代码长什么样、要改哪一段时调用;update_animation 做局部改(old_str)前建议先调它确认当前代码。"""
        return draft.get("sceneCode") or draft.get("_lastSubmittedCode") or "(尚无动画代码,先调 update_animation 只给 code 提交完整代码)"

    @tool
    def finish() -> str:
        """所有字段就绪且动画已验证通过后调用,结束本步设计。"""
        missing = [k for k in ("title", "explanation") if not draft.get(k)]
        if not draft.get("sceneCode"):
            return "尚未通过动画验证(update_animation 未返回 ok=true),不能 finish。先调 update_animation。"
        if missing:
            return f"缺少必填字段:{missing},请先设置。"
        return "FINISHED"

    return [set_title, set_intent, set_explanation, set_params, update_animation, read_animation, finish]


# ---------- agent 构造(每会话每步一个,带 MemorySaver)----------

_SAVER = MemorySaver()  # 全局共享 checkpointer,按 thread_id 区分各 step 的暂停状态

def _build_agent(cfg: LLMConfig, sid: str, step_id: int):
    tools = _build_tools(sid, step_id)
    model = ChatOpenAI(
        base_url=cfg.base_url, api_key=cfg.api_key or "dummy",
        model=cfg.model, temperature=0.7,
    )
    return create_react_agent(
        model=model, tools=tools, checkpointer=_SAVER,
        prompt=STEP_AGENT_SYSTEM_PROMPT,
    )


# ---------- 运行:返回事件生成器(处理 interrupt/resume)----------

# resume 值暂存:前端 POST /api/render_result 时存进来,run_step_agent 的循环读取
_RESUMES: dict[tuple[str, str], dict] = {}


def set_render_result(sid: str, step_id, ok: bool, error: str = "", frame_path: str = "") -> None:
    """前端渲染回传结果(由 /api/render_result 调用)。
    frame_path:若 ok=True 且前端截了最后一帧(视觉检查用),为图片存盘路径;否则空。"""
    # 键统一为字符串:run 与 resume 都 str(step_id),防旧整数流 int/str 键不匹配 → resume 失效
    key = (sid, str(step_id))
    _RESUMES[key] = {"ok": ok, "error": error, "framePath": frame_path}


def run_step_agent(sid: str, step_id: int, step_title: str, prev_ctx: str,
                   question: str, outline_titles: list, cfg: Optional[LLMConfig] = None):
    """运行 step agent,生成器 yield 事件 dict。
    流程:
      1. 首次 invoke → 若 agent 在 add_animation 处 interrupt,yield {"kind":"render_request","code":...}
         并等待(生成器暂停);外部拿到前端回传后调 resume_step_agent 传入结果,再 next() 推进。
      2. 若 agent 跑完(无 interrupt),yield {"kind":"explain","step": <草稿>}。
      3. 若超 max_attempts 或异常,yield {"kind":"error","message":...}。
    """
    cfg = cfg or _get_runtime_cfg()
    # step_id 键统一为字符串(旧整数流是 int,新 topic 流是 str),run 与 resume 一致才能命中 _DRAFTS/_RESUMES
    step_id = str(step_id)
    # 重置草稿
    _DRAFTS[(sid, step_id)] = {
        "title": step_title, "intent": "", "explanation": "", "formula": "", "narration": "",
        "params": [], "sceneCode": "", "renderAttempts": 0, "failCount": 0,
    }
    run_nonce = _uuid.uuid4().hex[:8]
    _DRAFTS[(sid, step_id)]["runNonce"] = run_nonce
    tid = _thread_id(sid, step_id, run_nonce)
    agent_obj = _build_agent(cfg, sid, step_id)
    user_msg = (
        f"用户要学的总知识点:{question}\n"
        f"整体知识点拆解:{outline_titles}\n"
        f"现在设计第 {step_id} 步:{step_title}\n\n"
        f"上文上下文:\n{prev_ctx}\n\n"
        f"请逐步调用工具设计这一步。先设标题/意图/公式/讲解/参数,再 add_animation 验证动画,最后 finish。"
    )

    config = {"configurable": {"thread_id": tid}}
    # yield agent_start(本步 subagent 开始),作为后续 tool_call 的父
    agent_evt_id = _new_id(sid)
    _DRAFTS[(sid, step_id)]["agentEvtId"] = agent_evt_id
    yield {"kind": "agent_start", "id": agent_evt_id, "parentId": None,
           "agent": "step", "stepId": step_id, "payload": {"title": step_title}}
    # 跟踪 tool_call_id(langgraph)→ 事件 id 的映射,以便 tool_result 挂到对应 tool_call 下
    tcid_to_evt: dict = {}
    current_parent = agent_evt_id  # tool_call 默认挂在 agent_start 下

    # 首次:用 stream(stream_mode="updates") 边跑边发 tool_call/tool_result
    interrupt_value = None
    try:
        for chunk in agent_obj.stream({"messages": [{"role": "user", "content": user_msg}]}, config, stream_mode="updates"):
            for node, state in chunk.items():
                if node == "__interrupt__":
                    # stream 末尾的 interrupt chunk:state 是 Interrupt 的 list/tuple
                    ivs = state if isinstance(state, (list, tuple)) else [state]
                    for iv in ivs:
                        v = getattr(iv, "value", iv)
                        if isinstance(v, dict) and "code" in v:
                            interrupt_value = v
                    continue
                msgs = state.get("messages", []) if isinstance(state, dict) else []
                for m in msgs:
                    nm = type(m).__name__
                    if nm == "AIMessage" and getattr(m, "tool_calls", None):
                        for tc in m.tool_calls:
                            evt_id = _new_id(sid)
                            tcid_to_evt[tc.get("id")] = evt_id
                            yield {"kind": "tool_call", "id": evt_id, "parentId": current_parent,
                                   "agent": "step", "stepId": step_id,
                                   "payload": {"name": tc.get("name"), "args": tc.get("args", {})}}
                    elif nm == "ToolMessage":
                        tcid = getattr(m, "tool_call_id", None)
                        parent = tcid_to_evt.get(tcid, current_parent)
                        yield {"kind": "tool_result", "id": _new_id(sid), "parentId": parent,
                               "agent": "step", "stepId": step_id,
                               "payload": {"toolCallId": tcid, "output": str(getattr(m, "content", ""))[:2000]}}
    except Exception as e:
        yield {"kind": "error", "id": _new_id(sid), "parentId": current_parent,
               "agent": "step", "stepId": step_id, "payload": {"message": f"agent 异常:{type(e).__name__}: {e}"}}
        return

    # 处理 interrupt(从 stream 末尾 chunk 取)
    if interrupt_value and "code" in interrupt_value:
        rr_parent = list(tcid_to_evt.values())[-1] if tcid_to_evt else current_parent
        yield {"kind": "render_request", "id": _new_id(sid), "parentId": rr_parent,
               "agent": "step", "stepId": step_id, "payload": {"code": interrupt_value["code"]}}
        return
    # 若 interrupt 但无 code(异常)
    if interrupt_value is not None:
        yield {"kind": "error", "id": _new_id(sid), "parentId": current_parent,
               "agent": "step", "stepId": step_id, "payload": {"message": "interrupt 无 code"}}
        return

    # 无 interrupt:agent 跑完
    draft = _DRAFTS[(sid, step_id)]
    if draft.get("sceneCode"):
        yield {"kind": "explain", "id": _new_id(sid), "parentId": agent_evt_id,
               "agent": "step", "stepId": step_id, "payload": {"step": dict(draft)}}
        return
    yield {"kind": "error", "id": _new_id(sid), "parentId": agent_evt_id,
           "agent": "step", "stepId": step_id, "payload": {"message": "agent 结束但未生成通过的动画"}}


def resume_step_agent(sid: str, step_id, cfg: Optional[LLMConfig] = None):
    """前端回传渲染结果后,恢复 agent 继续跑。生成器 yield 同 run_step_agent。"""
    cfg = cfg or _get_runtime_cfg()
    step_id = str(step_id)  # 与 run_step_agent/set_render_result 键一致(统一字符串)
    draft0 = _DRAFTS.get((sid, step_id), {})
    tid = _thread_id(sid, step_id, draft0.get("runNonce", "0"))
    result = _RESUMES.pop((sid, step_id), None)
    if result is None:
        yield {"kind": "error", "id": _new_id(sid), "parentId": None,
               "agent": "step", "stepId": step_id, "payload": {"message": "无待处理的渲染结果"}}
        return
    agent_obj = _build_agent(cfg, sid, step_id)
    config = {"configurable": {"thread_id": tid}}
    draft = _DRAFTS[(sid, step_id)]
    # 失败计数:只在回传 ok=False 时累计,> 6 次拦截(避免 renderAttempts 被 resume 重复执行 tool 翻倍)
    if not result.get("ok", False):
        draft["failCount"] = draft.get("failCount", 0) + 1
    if draft.get("failCount", 0) > 6:
        yield {"kind": "error", "id": _new_id(sid), "parentId": draft.get("agentEvtId"),
               "agent": "step", "stepId": step_id, "payload": {"message": "动画验证失败超过 6 次仍未通过"}}
        return

    agent_evt_id = draft.get("agentEvtId")
    tcid_to_evt: dict = {}
    current_parent = agent_evt_id
    # 先发 render_result 事件(本次回传的渲染结果),挂在之前的 render_request 下
    # (render_request 的 id 在前端已有,resume 时前端会带上来?为简化,这里挂 agent_start)
    yield {"kind": "render_result", "id": _new_id(sid), "parentId": agent_evt_id,
           "agent": "step", "stepId": step_id,
           "payload": {"ok": result.get("ok", False), "error": result.get("error", "")}}

    interrupt_value = None
    try:
        for chunk in agent_obj.stream(Command(resume=result), config, stream_mode="updates"):
            for node, state in chunk.items():
                if node == "__interrupt__":
                    ivs = state if isinstance(state, (list, tuple)) else [state]
                    for iv in ivs:
                        v = getattr(iv, "value", iv)
                        if isinstance(v, dict) and "code" in v:
                            interrupt_value = v
                    continue
                msgs = state.get("messages", []) if isinstance(state, dict) else []
                for m in msgs:
                    nm = type(m).__name__
                    if nm == "AIMessage" and getattr(m, "tool_calls", None):
                        for tc in m.tool_calls:
                            evt_id = _new_id(sid)
                            tcid_to_evt[tc.get("id")] = evt_id
                            yield {"kind": "tool_call", "id": evt_id, "parentId": current_parent,
                                   "agent": "step", "stepId": step_id,
                                   "payload": {"name": tc.get("name"), "args": tc.get("args", {})}}
                    elif nm == "ToolMessage":
                        tcid = getattr(m, "tool_call_id", None)
                        parent = tcid_to_evt.get(tcid, current_parent)
                        yield {"kind": "tool_result", "id": _new_id(sid), "parentId": parent,
                               "agent": "step", "stepId": step_id,
                               "payload": {"toolCallId": tcid, "output": str(getattr(m, "content", ""))[:2000]}}
    except Exception as e:
        yield {"kind": "error", "id": _new_id(sid), "parentId": current_parent,
               "agent": "step", "stepId": step_id, "payload": {"message": f"resume 异常:{type(e).__name__}: {e}"}}
        return

    if interrupt_value and "code" in interrupt_value:
        rr_parent = list(tcid_to_evt.values())[-1] if tcid_to_evt else current_parent
        yield {"kind": "render_request", "id": _new_id(sid), "parentId": rr_parent,
               "agent": "step", "stepId": step_id, "payload": {"code": interrupt_value["code"]}}
        return
    if interrupt_value is not None:
        yield {"kind": "error", "id": _new_id(sid), "parentId": current_parent,
               "agent": "step", "stepId": step_id, "payload": {"message": "resume 后 interrupt 无 code"}}
        return
    if draft.get("sceneCode"):
        yield {"kind": "explain", "id": _new_id(sid), "parentId": agent_evt_id,
               "agent": "step", "stepId": step_id, "payload": {"step": dict(draft)}}
        return
    yield {"kind": "error", "id": _new_id(sid), "parentId": agent_evt_id,
           "agent": "step", "stepId": step_id, "payload": {"message": "agent 结束但未生成通过的动画"}}
