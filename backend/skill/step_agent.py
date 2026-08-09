"""Step 生成 agent:tool-calling + 浏览器在环验证。

用 LangGraph create_react_agent 编排:LLM 调 set_step(title+讲解+可选 params)/
write(首次写)/patch(修改不提交)/commit(提交验证)/finish 等工具逐项设计一个教学 step。其中 commit() 通过 interrupt() 暂停,等前端真渲染回传结果(ok/error)后 resume,LLM 据此 patch 修正 code 重调,直到跑通。

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
    API_REF_BLOCK, RUNTIME_RULES_BLOCK, TEACHING_NORMS_BLOCK,
    RUNTIME_POWER_BLOCK, OFFICIAL_EXAMPLES_BLOCK,
)
from .llm_config_store import _get_vision_cfg


# ---------- 草稿存储:每个 (sid, step_id) 一份,工具往里写 ----------

_DRAFTS: dict[tuple[str, str], dict] = defaultdict(lambda: {
    "title": "", "intent": "", "explanation": "", "formula": "", "narration": "",
    "params": [], "sceneCode": "", "draftCode": "", "renderAttempts": 0,
})

# 事件 id 生成(无 Date.now/random 限制只针对 workflow 脚本;这里是后端 Python,可用 uuid)
import uuid as _uuid


def _new_id(sid: str) -> str:
    return _uuid.uuid4().hex[:12]


# 每个 (sid, step_id) 一轮运行一个 thread_id(含 run nonce),供 MemorySaver 区分。
# 重跑同一步用新 nonce,避免旧 interrupted 状态残留导致 "tool_calls without ToolMessage"。
def _thread_id(sid: str, step_id: int, nonce: str) -> str:
    return f"{sid}#{step_id}#{nonce}"


# ---------- 系统提示词:组合 manim_lesson 的 API REF / 铁律 / FEW SHOT / 教学规范 各独立块 ----------

STEP_AGENT_SYSTEM_PROMPT = f"""你是教学动画设计 agent。为一个子知识点逐步设计浏览器讲解:标题、讲解、(可选)可调参数、动画代码。

**工作方式**:通过调用工具逐项设置,不要输出 JSON 或自然语言解释,只调工具。
- set_step(title, explanation, params?):一次性设置本步的标题 + 讲解 + (可选)可调参数(替代分步设置,省往返)。
  - title:简短标题。
  - explanation:讲解正文,**Markdown 格式**,文字与公式混排。公式用 `$...$`(行内)或 `$$...$$`(独占一行),会被 KaTeX 渲染。可含标题/列表/段落。这是该步的完整讲解,讲清来龙去脉,承接上文。
  - params:**仅当这一步确实需要用户交互调节参数时才给**(如"拖动看角度变化"),JSON 数组字符串,每项 `{{name,label,min,max,step,default}}`,如 `[{{"name":"lr","label":"学习率","min":0.01,"max":1,"step":0.01,"default":0.1}}]`。无需参数就传 `'[]'` 或省略,不要硬凑。
- write(code):**首次写**完整动画代码(manim-web TS 函数体)到工作草稿。**只写不验证**,可先写一版再逐步改。仅在还没有代码、或要大范围重写时调用;已有代码的小改动用 patch。
- patch(old_str, new_str):**修改**工作草稿,不触发验证。在当前草稿代码里定位 old_str(必须**唯一**匹配,含缩进;old_str 可从你自己刚写的那版代码里原样复制一段,new_str 空串=删除),替换成 new_str 存回草稿。找不到/不唯一会报错——补几行上下文让它唯一。可连续 patch 多次,全部改完再统一 commit。想改的代码不在自己上下文里时,先 write 一版完整代码再 patch。
- commit():把当前工作草稿的完整代码一次性送浏览器真渲染验证。返回 {{ok: true}} 渲染通过、动画**定稿**;{{ok: false, error}} 报错,草稿仍是你送检的那版,继续用 patch 改(改完再 commit)。**必须**在 write(或首次直接给完整代码)之后才能 commit。渲染失败不要整段重写,用 patch 只发改动片段(省 token),除非改动超约 1/3 或 patch 连续两次匹配不上才 write 整段。最多重试 12 次。
- finish():所有字段就绪且动画已定稿(commit 返回 ok=true)后收尾。

工具调用顺序自由发挥,不强制先设哪个。工作流:**write**(首次整段)→ 反复 `patch` 改 → `commit` 验证定稿 → `finish`。动画 code 必须经 commit 验证通过(ok=true)写入定稿才能 finish。

sceneCode 格式:manim-web TypeScript 函数体。开头 `const {{ ... }} = ctx;` 解构出用到的标识符(必含 `scene`)。用 `await scene.play(...)` / `scene.add(...)` 驱动。

⚠️ **params 解构铁律(高频错,务必遵守)**:
- 只要你在 `set_step` 里给了 `params`,代码里就一定会用 `params.<name>` 读参数。**解构行的 `{{ }}` 里必须显式列出 `params`**,否则运行时报 `params is not defined`。
- 正确:`const {{ scene, Axes, Dot, Text, Create, params }} = ctx;` 然后 `const x = params.x;`
- 错误:解构行写了 `scene, Axes, Dot` 却漏 `params`,代码里又用 `params.x` → 报错。
- 反过来:**`set_step` 里没给 params(无参数)就完全不要在代码里引用 `params`**,解构行也别写它。
- 这条是 `params is not defined` 的唯一根因,渲染失败一次就要立刻检查解构行有没有 `params`。

{API_REF_BLOCK}

{RUNTIME_RULES_BLOCK}

{RUNTIME_POWER_BLOCK}

{TEACHING_NORMS_BLOCK}

═══ 官方 manim-web 示例参考(约 50%,自建 scene 风格;运行时已支持 TS/自建)═══
下方是 manim-web 官方 example 原文。它们自带 Scene/相机、可能写 TS/多色,是 API 用法参考。
你可以照抄其 API(坐标轴/曲线/ValueTracker/3D 相机/公式),但输出时仍需守上面的教学规范
(配色可丰富/fontFamily 中文/教学公式);需要 3D 相机或多视角时可按官方样式在代码里 `new ThreeDScene(container,...)` 自建 scene。
{OFFICIAL_EXAMPLES_BLOCK}

记住:动画 code 必须先经 commit 验证通过(ok=true)定稿才算数;不要凭空写完就 finish。
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
    def set_step(title: str, explanation: str, params_json: str = "[]") -> str:
        """一次性设置本步的标题 + 讲解 + (可选)可调参数(替代分步 set_title/set_explanation/set_params,省往返)。
        - title:简短标题,如"正弦函数的定义"。
        - explanation:讲解正文,Markdown 格式,文字与公式混排。公式用 $...$ 行内或 $$...$$ 独占行(KaTeX 渲染)。可含标题/列表/段落。讲清来龙去脉,承接上文。
        - params_json:可调参数 JSON 数组字符串,每项 {name,label,min,max,step,default}。**仅当该步确实需要用户调参时才给**;无需参数传 '[]' 或省略。"""
        draft["title"] = title
        draft["explanation"] = explanation
        import re as _re
        fm = _re.search(r'\$\$?(.+?)\$\$?', explanation, _re.S)
        draft["formula"] = fm.group(1).strip() if fm else ""
        draft["narration"] = _re.sub(r'\$\$?.+?\$\$?', '', explanation).strip()
        if params_json and params_json != "[]":
            import json as _json
            try:
                draft["params"] = _json.loads(params_json)
            except Exception as e:
                return f"标题/讲解已设,但参数 JSON 解析失败:{e}"
        return f"已设置:标题={title[:20]}…,讲解 {len(explanation)} 字"

    @tool
    def write(code: str) -> str:
        """**首次写**完整动画代码(manim-web TS 函数体)到工作草稿,不触发验证。可整段覆盖草稿。
        仅在还没有代码、或要大范围重写时调用;已有代码的小改动请用 patch。"""
        if not code:
            return "write 失败:code 为空。请传入完整的 manim-web TS 函数体。"
        draft["draftCode"] = code
        return f"已写入工作草稿(code_len={len(code)})。可先 patch 修改再 commit,或直接 commit 提交验证。"

    @tool
    def patch(old_str: str, new_str: str = "") -> str:
        """**修改**工作草稿,不触发验证。在当前草稿代码里定位 old_str(必须**唯一**匹配,含缩进,
        old_str 从你写的最近一版代码里原样复制一段),替换成 new_str(空串=删除),存回草稿。
        找不到/不唯一会报错——补几行上下文让它唯一。可连续 patch 多次,全部改完再统一 commit。"""
        current = draft.get("draftCode") or ""
        if not current:
            return "patch 失败:工作草稿为空,还没有可改的代码。先调 write(code) 写一版完整代码。"
        if not old_str:
            return "patch 失败:old_str 为空。请从当前草稿代码里原样复制一段要替换的内容。"
        n = current.count(old_str)
        if n == 0:
            return f"patch 失败:old_str 在当前草稿里找不到。检查缩进/拼写,或把整段代码用 write 重写一版再 patch。"
        if n > 1:
            return f"patch 失败:old_str 在草稿里出现 {n} 次,不唯一。多带几行上下文让它唯一,或改用 write 整段重写。"
        new_code = current.replace(old_str, new_str, 1)
        if new_code == current:
            return "patch 失败:替换后代码无变化(old_str == new_str?)。"
        draft["draftCode"] = new_code
        return f"patch 已生效(draftCode 已更新,code_len={len(new_code)})。未触发验证,可继续 patch 或调 commit 提交验证。"

    @tool
    def commit() -> str:
        """把当前工作草稿的完整代码一次性送浏览器真渲染验证。返回 {{ok: true}} 渲染通过、动画**定稿**;
        {{ok: false, error}} 报错,草稿仍是送检的那版,继续用 patch 改(改完再 commit)。
        必须在 write 之后才能 commit。渲染失败不要整段重写,用 patch 只发改动片段;
        仅当改动超约 1/3 或 patch 连续两次匹配不上时才 write 整段。最多重试 12 次。"""
        new_code = draft.get("draftCode") or ""
        if not new_code:
            return "commit 失败:工作草稿为空,没东西可提交。先调 write(code) 写一版完整代码。"
        draft["renderAttempts"] += 1
        # 落盘每次提交的完整代码(临时调试:看 LLM 实际生成/合成什么)
        try:
            import os as _os, datetime as _dt
            _p = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "step_codes.log")
            with open(_p, "a", encoding="utf-8") as _f:
                _f.write(f"\n===== {_dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} sid={sid} step={step_id} attempt={draft['renderAttempts']} code_len={len(new_code)} mode=commit =====\n")
                _f.write(new_code)
                _f.write("\n")
        except Exception:
            pass
        # ⚠️ 不要在 interrupt 前改动 draftCode/sceneCode!
        # langgraph resume 会从 commit 工具入口重跑(不是从 interrupt 处继续),重跑时仍读同样的 draftCode,
        # 直接送同一段代码验证,无副作用;定稿状态只在渲染**通过**后(interrupt 返回)才写 sceneCode。
        # 暂停,等前端渲染回传。interrupt 的值会作为 SSE render_request 推给前端。
        result = interrupt({"code": new_code})
        if isinstance(result, dict) and result.get("ok"):
            draft["sceneCode"] = new_code  # 定稿:与工作草稿一致
            # 视觉检查(仅提示不阻塞):若前端截了最后一帧(framePath),调视觉辅助模型描述画面。
            # 主模型 supports_vision 时本可直接看图,但 langchain tool 返回是字符串,当下走辅助模型描述。
            frame_path = result.get("framePath", "")
            vision_desc = ""
            if frame_path:
                vision_desc = _run_vision_check(frame_path, sid, step_id)
            if vision_desc:
                return (f"commit 通过,动画已定稿。视觉检查(辅助模型看最后一帧):{vision_desc}\n"
                        f"如发现文字重叠、动画没真正实现(关键对象没进场景/没动)、或效果差,**可再 patch 修改**(改完再 commit);否则可 finish。")
            return "commit 通过,动画已定稿。可以继续设其它字段或 finish。"
        err = result.get("error", "未知错误") if isinstance(result, dict) else str(result)
        # waitForRender 错误常是 manim-web 内部抛的(非你代码直接调),给针对性指引
        if "waitForRender" in err:
            err += "。这是 manim-web 内部渲染错,常见原因:(1)对 Text/Dot/Arrow 等非公式对象调了 waitForRender(只有 MathTexImage/MathTex/Variable 有此方法,删掉该调用);(2)MathTexImage/MathTex 构造失败(检查 latex 字符串是否合法、解构行是否含 MathTexImage);(3)mobject 构造后状态异常。尝试简化:去掉可疑的 waitForRender 调用,或减少当步 mobject 数。"
        return f"commit 失败:{err}。草稿仍是送检那版,**下一步先用 patch 局部改**(从草稿原样复制 old_str),改完再 commit;仅当改动超 1/3 或 patch 两次匹配不上才用 write 整段重写。"

    @tool
    def finish() -> str:
        """所有字段就绪且动画已定稿(commit 返回 ok=true)后调用,结束本步设计。"""
        missing = [k for k in ("title", "explanation") if not draft.get(k)]
        if not draft.get("sceneCode"):
            return "尚未动画定稿(commit 未返回 ok=true),不能 finish。先调 commit。"
        if missing:
            return f"缺少必填字段:{missing},请先设置。"
        if draft.get("draftCode") != draft.get("sceneCode"):
            return "工作草稿与定稿不一致(你在最近一次 commit 后又 patch 改了代码未重新 commit),不能 finish。先调 commit 提交最新草稿。"
        return "FINISHED"

    return [set_step, write, patch, commit, finish]


# ---------- agent 构造(每会话每步一个,带 MemorySaver)----------

_SAVER = MemorySaver()  # 全局共享 checkpointer,按 thread_id 区分各 step 的暂停状态

def _build_agent(cfg: LLMConfig, sid: str, step_id: int):
    tools = _build_tools(sid, step_id)
    model = ChatOpenAI(
        base_url=cfg.base_url, api_key=cfg.api_key or "dummy",
        model=cfg.model, temperature=0.7,
        extra_body={"thinking": {"type": "enabled"}},
        reasoning_effort="high",
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
      1. 首次 invoke → 若 agent 在 commit 处 interrupt,yield {"kind":"render_request","code":...}
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
        "params": [], "sceneCode": "", "draftCode": "", "renderAttempts": 0, "failCount": 0,
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
        f"请逐步调用工具设计这一步。先 set_step 设标题/讲解/参数,再 write 写动画代码并(必要时)patch 修改,最后 commit 验证定稿,再 finish。"
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
    # 失败计数:只在回传 ok=False 时累计,> 12 次拦截(避免 renderAttempts 被 resume 重复执行 tool 翻倍)
    if not result.get("ok", False):
        draft["failCount"] = draft.get("failCount", 0) + 1
    if draft.get("failCount", 0) > 12:
        yield {"kind": "error", "id": _new_id(sid), "parentId": draft.get("agentEvtId"),
               "agent": "step", "stepId": step_id, "payload": {"message": "动画验证失败超过 12 次仍未通过"}}
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
