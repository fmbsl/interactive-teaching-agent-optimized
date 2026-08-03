"""教学智能体视图:基于 LangGraph agent,流式 SSE。

端点:
  POST /api/start   {question, file_text?} -> SSE: plan / step-start / explain / done / error
  POST /api/next    {session_id}            -> SSE: explain(下一步) / done
  POST /api/update  {session_id, question, file_text?} -> SSE: plan / step-start / explain / done
  POST /api/upload  multipart 文件          -> {file_text}
"""
import json
import time
from io import BytesIO

from django.http import StreamingHttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

import agent
import skill as skill_mod  # noqa: F401  (确保 skill 包可被发现)
from skill import generate_step
from skill.step_agent import run_step_agent, resume_step_agent, set_render_result
from skill.debug_log import dlog
from skill.executor import start_run, iter_events, current_run

# Django 启动时加载落盘的 session(重启不丢)
agent.load_sessions_on_startup()
from skill.llm_config_store import list_endpoints, save_endpoint, delete_endpoint, set_active, save_vision_endpoint


def _sse(event_type: str, data: dict) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _streaming_response(gen):
    resp = StreamingHttpResponse(gen, content_type="text/event-stream")
    resp["Cache-Control"] = "no-cache"
    resp["X-Accel-Buffering"] = "no"
    return resp


def _sse_kind_for(evt: dict) -> str:
    """事件 dict 的 kind 字段即 SSE event 名(执行树事件 kind 与 SSE event 一致)。"""
    return evt.get("kind", "message")


def _sse_line(evt: dict) -> str:
    """把执行树事件 dict 序列化成一行 SSE。"""
    return _sse(_sse_kind_for(evt), evt)


def _new_evt(sid: str, kind: str, payload: dict, parentId: str | None = None,
             agent_name: str = "main", stepId: int | None = None) -> dict:
    """构造执行树事件 dict(供 gen_factory 直接 yield;executor 负责落盘)。"""
    import uuid as _uuid
    return {
        "id": _uuid.uuid4().hex[:12],
        "parentId": parentId,
        "sid": sid,
        "ts": time.time() * 1000,  # 毫秒,与前端 Date.now() 对齐(否则排序错乱)
        "kind": kind,
        "agent": agent_name,
        "stepId": stepId,
        "payload": payload,
    }


def _stream_run(sid: str, run_id: str, replay: bool = False):
    """SSE 读者:从后台 run 缓冲读事件,逐个 yield SSE 行。run 结束/被取代时收尾。
    客户端断连 → 本生成器在 yield 处停(不再读),后台 run 继续跑完(到 render_request/explain)。"""
    for evt, status in iter_events(sid, run_id, replay=replay):
        if status == "live":
            yield _sse_line(evt)
        elif status == "done":
            yield _sse("done", {"message": "就绪"})
            return
        elif status == "superseded":
            # run 被新 run 取代:让前端重新拉 trace(它已在收新 run 的 SSE)
            return
        elif status == "error":
            yield _sse_line(evt)
            yield _sse("done", {"message": "就绪"})
            return
    # iter_events 自然结束(理论上不会,除非 superseded)


def health(request):
    """根路径健康检查:GET / 或 /api/health -> 200 JSON,便于确认后端在线(否则访问根路径是 Django 404)。"""
    return JsonResponse({
        "ok": True,
        "service": "manim-teaching-agent",
        "endpoints": ["api/start", "api/next", "api/prev", "api/goto",
                      "api/update", "api/regenerate", "api/upload", "api/sessions",
                      "api/llm/config"],
    })


@csrf_exempt
def llm_config(request):
    """LLM 接入点配置:GET 返回 {activeId, endpoints, visionEndpoint}(apiKey 明文,本地开发);
    POST {action: save|delete|setActive|saveVision, endpoint?, id?} -> 更新后的配置。"""
    if request.method == "GET":
        return JsonResponse(list_endpoints())
    if request.method != "POST":
        return JsonResponse({"error": "POST/GET only"}, status=405)
    try:
        body = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "非法 JSON"}, status=400)
    action = body.get("action")
    try:
        if action == "save":
            data = save_endpoint(body.get("endpoint", {}))
        elif action == "delete":
            data = delete_endpoint(body.get("id", ""))
        elif action == "setActive":
            data = set_active(body.get("id", ""))
        elif action == "saveVision":
            data = save_vision_endpoint(body.get("endpoint", {}))
        else:
            return JsonResponse({"error": f"未知 action: {action}"}, status=400)
    except Exception as e:
        dlog(f"llm_config error: {type(e).__name__}: {e}")
        return JsonResponse({"error": str(e)}, status=500)
    return JsonResponse(data)


def _explain_event(lesson: dict, step_id: int, prev_error: str | None = None, session_id: str | None = None):
    """下游 agent:为某步设计完整讲解。生成器,yield 执行树事件 dict(executor 负责落盘)。

    缓存命中 → yield explain + done(dict)。
    否则跑 step agent(tool-calling + 浏览器在环):
      - agent 请求渲染 → yield render_request(本段结束,前端跑完 POST /api/render_result 触发新 run 续流)
      - agent 完成 → yield explain + done
      - 失败 → 回退旧 generate_step(一次性 JSON);仍失败 yield error
    """
    outline_step = _step(lesson, step_id) if not isinstance(step_id, str) else {}
    session = agent.get_session(session_id) if session_id else None
    if isinstance(step_id, str) and session:
        # 新 topic step:从 session.topics 解析标题/上一步/outline
        step_title, outline_titles, prev_step_id = _resolve_step_info(session, step_id)
    else:
        step_title = outline_step.get("title", f"第 {step_id} 步")
        prev_step_id = step_id - 1 if (not isinstance(step_id, str) and step_id > 1) else None
        outline_titles = [st.get("title", "") for st in lesson.get("steps", [])]

    # 先查缓存
    if session_id and not prev_error:
        cached = agent.get_step_cache(session_id, step_id)
        if cached and cached.get("sceneCode"):
            dlog(f"explain sid={session_id} step={step_id} HIT cache sceneCode_len={len(cached.get('sceneCode',''))}")
            yield _new_evt(session_id, "explain", {
                "stepId": step_id,
                "title": cached.get("title", step_title),
                "intent": cached.get("intent", ""),
                "formula": cached.get("formula", ""),
                "narration": cached.get("narration", ""),
                "explanation": cached.get("explanation", ""),
                "paramsUsed": [p.get("name") for p in cached.get("params", [])],
                "params": cached.get("params", []),
                "sceneCode": cached.get("sceneCode", ""),
            }, agent_name="step", stepId=step_id)
            return

    dlog(f"explain sid={session_id} step={step_id} MISS cache prev_error={prev_error}")
    prev_step = None
    if session_id and prev_step_id is not None:
        prev_step = agent.get_step_cache(session_id, prev_step_id)
    dlog(f"explain sid={session_id} step={step_id} prev_step={'yes' if prev_step else 'no'}")

    question = (session or {}).get("question", "") if session_id else ""
    prev_ctx = "（这是第一个子知识点,无上文）"
    if prev_step:
        prev_code = prev_step.get("sceneCode") or prev_step.get("pythonCode") or ""
        prev_ctx = (
            f"上一个子知识点:{prev_step.get('title','')}\n"
            f"上一步讲解:{prev_step.get('narration','')}\n"
            f"上一步动画代码:\n{prev_code}\n"
            f"请在术语和画面上承接上文。"
        )

    try:
        for ev in run_step_agent(session_id or "anon", step_id, step_title, prev_ctx, question, outline_titles):
            kind = ev.get("kind")
            if kind in ("agent_start", "tool_call", "tool_result", "render_result", "error"):
                yield ev  # step_agent 已构造好 id/parentId/agent/stepId/payload
            elif kind == "render_request":
                dlog(f"explain sid={session_id} step={step_id} render_request code_len={len(ev.get('payload',{}).get('code',''))}")
                yield ev
                return  # 本段结束,等前端 POST /api/render_result 触发新 run
            elif kind == "explain":
                sd = ev["payload"]["step"]
                sd.setdefault("title", step_title)
                if session_id:
                    agent.set_step_cache(session_id, step_id, sd)
                dlog(f"explain sid={session_id} step={step_id} OK sceneCode_len={len(sd.get('sceneCode',''))} STORED")
                yield _new_evt(session_id, "explain", {
                    "stepId": step_id,
                    "title": sd.get("title", step_title),
                    "intent": sd.get("intent", ""),
                    "formula": sd.get("formula", ""),
                    "narration": sd.get("narration", ""),
                    "explanation": sd.get("explanation", ""),
                    "paramsUsed": [p.get("name") for p in sd.get("params", [])],
                    "params": sd.get("params", []),
                    "sceneCode": sd.get("sceneCode", ""),
                }, parentId=ev.get("id"), agent_name="step", stepId=step_id)
                return
    except Exception as e:
        dlog(f"explain sid={session_id} step={step_id} step_agent EXCEPTION: {type(e).__name__}: {e} — 回退 generate_step")

    # 回退:旧一次性 generate_step
    yield from _explain_event_fallback(lesson, step_id, step_title, outline_titles, question, prev_step, prev_error, session_id)


def _explain_event_fallback(lesson, step_id, step_title, outline_titles, question, prev_step, prev_error, session_id):
    """step agent 失败时回退到旧 generate_step(一次性 JSON,无浏览器在环)。生成器 yield 事件 dict。"""
    last_err = None
    for attempt in range(3):
        try:
            sd = generate_step(step_title, outline_titles, prev_step=prev_step, question=question, prev_error=prev_error)
            sc = sd.get("sceneCode", "") if sd else ""
            dlog(f"explain sid={session_id} step={step_id} FALLBACK attempt={attempt+1} sceneCode_len={len(sc)}")
            if sd and sd.get("sceneCode"):
                if session_id:
                    agent.set_step_cache(session_id, step_id, sd)
                yield _new_evt(session_id, "explain", {
                    "stepId": step_id,
                    "title": sd.get("title", step_title),
                    "intent": sd.get("intent", ""),
                    "formula": sd.get("formula", ""),
                    "narration": sd.get("narration", ""),
                    "explanation": sd.get("explanation", ""),
                    "paramsUsed": [p.get("name") for p in sd.get("params", [])],
                    "params": sd.get("params", []),
                    "sceneCode": sd.get("sceneCode", ""),
                }, agent_name="step", stepId=step_id)
                return
            last_err = "sceneCode 为空"
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            dlog(f"explain sid={session_id} step={step_id} FALLBACK attempt={attempt+1} EXCEPTION: {last_err}")
        time.sleep(2)
    dlog(f"explain sid={session_id} step={step_id} FAILED all last_err={last_err}")
    yield _new_evt(session_id, "explain", {"stepId": step_id, "title": step_title, "intent": "", "formula": "",
                       "narration": "", "explanation": "", "paramsUsed": [], "params": [], "sceneCode": ""},
                   agent_name="step", stepId=step_id)


def _emit_lesson_events(lesson: dict, current_step: int = 1, session_id: str | None = None):
    """plan + 第一步 explain(带场景代码)。生成器 yield 事件 dict。"""
    plan_evt = _new_evt(session_id, "plan", {
        "title": lesson.get("title", "教学脚本"),
        "summary": lesson.get("summary", ""),
        "params": lesson.get("params", []),
        "steps": lesson.get("steps", []),
    }, parentId=None, agent_name="main")
    yield plan_evt
    yield _new_evt(session_id, "step-start", {"stepId": current_step, "title": _step_title(lesson, current_step)},
                   parentId=plan_evt["id"], agent_name="main", stepId=current_step)
    time.sleep(1.5)  # lesson 刚调完 LLM,缓口气再生成场景代码,避免背靠背限流
    yield from _explain_event(lesson, current_step, session_id=session_id)


def _step(lesson: dict, step_id: int) -> dict | None:
    for s in lesson.get("steps", []):
        if s.get("id") == step_id:
            return s
    return None


def _step_title(lesson: dict, step_id) -> str:
    s = _step(lesson, step_id)
    return s.get("title", "") if s else ""


def _resolve_step_info(session: dict, step_id) -> tuple[str, list[str], object]:
    """按 step_id(旧:int 数字;新:字符串 'topicid-N')解析出 (step_title, outline_titles, prev_step_id)。
    新 topic step 从 session.topics 找;旧 lesson step 从 lesson.steps 找。"""
    sid = session.get("sid") if isinstance(session, dict) else None
    if isinstance(step_id, str) and "-" in step_id:
        # 新 topic step:在 session.topics 里定位
        topic_id, n = step_id.rsplit("-", 1)
        try: n = int(n)
        except: n = 0
        for tp in session.get("topics", []):
            if tp.get("id") == topic_id:
                steps = tp.get("steps", [])
                title = steps[n - 1].get("title", "") if 1 <= n <= len(steps) else f"第 {n} 步"
                outline_titles = [s.get("title", "") for s in steps]
                prev_id = f"{topic_id}-{n-1}" if n > 1 else None
                return title, outline_titles, prev_id
        return f"第 {step_id} 步", [], None
    # 旧 lesson step(int)
    lesson = session.get("lesson") or {}
    n = int(step_id)
    title = _step_title(lesson, n) or f"第 {n} 步"
    outline_titles = [st.get("title", "") for st in lesson.get("steps", [])]
    prev_id = n - 1 if n > 1 else None
    return title, outline_titles, prev_id



@csrf_exempt
def start(request):
    if request.method != "POST":
        return _streaming_response(iter([_sse("error", {"message": "POST only"})]))

    try:
        body = json.loads(request.body or b"{}")
        question = body.get("question", "").strip()
        file_text = body.get("file_text")
    except Exception:
        question, file_text = "", None
    if not question:
        return _streaming_response(iter([_sse("error", {"message": "缺少 question"})]))

    dlog(f"START question={question!r} has_file={bool(file_text)}")
    sid = str(__import__("uuid").uuid4())[:8]

    def gen_factory():
        try:
            yield {"kind": "session", "session_id": sid}
            # 主 agent 流式拆解(tool-calling),发 agent_start/tool_call/tool_result/outline 事件
            from skill.outline_agent import run_outline_agent
            outline = None
            for ev in run_outline_agent(sid, question, file_text):
                kind = ev.get("kind")
                if kind == "outline":
                    outline = ev["payload"]
                    yield _new_evt(sid, "plan", {
                        "title": outline.get("title", question[:20]),
                        "summary": outline.get("summary", ""),
                        "params": [],
                        "steps": outline.get("steps", []),
                    }, parentId=ev.get("id"), agent_name="main")
                elif kind in ("agent_start", "tool_call", "tool_result", "error"):
                    yield ev  # outline_agent 已构造好 id/parentId/agent/stepId/payload
            if not outline or not outline.get("steps"):
                yield _new_evt(sid, "error", {"message": "拆解失败:未生成知识点"}, agent_name="main")
                return
            agent.create_session_with_lesson(sid, question, file_text, outline)
            lesson = {"title": outline.get("title", question[:20]), "summary": outline.get("summary", ""),
                      "params": [], "steps": outline.get("steps", [])}
            dlog(f"START session={sid} steps={len(lesson['steps'])} title={lesson['title']!r}")
            # 第一步 step-start + explain
            yield _new_evt(sid, "step-start", {"stepId": 1, "title": _step_title(lesson, 1)},
                           parentId=None, agent_name="main", stepId=1)
            time.sleep(1.5)
            yield from _explain_event(lesson, 1, session_id=sid)
        except Exception as e:
            dlog(f"START EXCEPTION: {type(e).__name__}: {e}")
            yield _new_evt(sid, "error", {"message": f"生成失败: {e}"}, agent_name="main")

    run = start_run(sid, "start", gen_factory)
    return _streaming_response(_stream_run(sid, run.run_id))


@csrf_exempt
def next_step(request):
    if request.method != "POST":
        return _streaming_response(iter([_sse("error", {"message": "POST only"})]))
    try:
        body = json.loads(request.body or b"{}")
        sid = body.get("session_id", "")
    except Exception:
        sid = ""
    session = agent.get_session(sid)
    if not session:
        return _streaming_response(iter([_sse("error", {"message": "会话不存在"})]))

    lesson = session["lesson"]
    nxt = session["current_step"] + 1
    if nxt > len(lesson["steps"]):
        return _streaming_response(iter([_sse("done", {"message": "已全部完成"})]))

    session["current_step"] = nxt
    dlog(f"NEXT sid={sid} -> step={nxt}")

    def gen_factory():
        yield _new_evt(sid, "step-start", {"stepId": nxt, "title": _step_title(lesson, nxt)},
                       agent_name="main", stepId=nxt)
        yield from _explain_event(lesson, nxt, session_id=sid)

    run = start_run(sid, f"next-{nxt}", gen_factory)
    return _streaming_response(_stream_run(sid, run.run_id))


@csrf_exempt
def prev_step(request):
    """回到上一步知识点。"""
    if request.method != "POST":
        return _streaming_response(iter([_sse("error", {"message": "POST only"})]))
    try:
        body = json.loads(request.body or b"{}")
        sid = body.get("session_id", "")
    except Exception:
        sid = ""
    session = agent.get_session(sid)
    if not session:
        return _streaming_response(iter([_sse("error", {"message": "会话不存在"})]))

    lesson = session["lesson"]
    prev = session["current_step"] - 1
    if prev < 1:
        return _streaming_response(iter([_sse("done", {"message": "已是第一步"})]))

    session["current_step"] = prev
    dlog(f"PREV sid={sid} -> step={prev}")

    def gen_factory():
        yield _new_evt(sid, "step-start", {"stepId": prev, "title": _step_title(lesson, prev)},
                       agent_name="main", stepId=prev)
        yield from _explain_event(lesson, prev, session_id=sid)

    run = start_run(sid, f"prev-{prev}", gen_factory)
    return _streaming_response(_stream_run(sid, run.run_id))


@csrf_exempt
def goto_step(request):
    """跳到任意一步(用缓存的场景代码,不重复调 LLM)。"""
    if request.method != "POST":
        return _streaming_response(iter([_sse("error", {"message": "POST only"})]))
    try:
        body = json.loads(request.body or b"{}")
        sid = body.get("session_id", "")
        raw = body.get("step_id", 1)
        # step_id:字符串(新 topic)原样;数字(旧 lesson)转 int
        step_id = raw if isinstance(raw, str) else int(raw)
    except Exception:
        sid, step_id = "", 1
    session = agent.get_session(sid)
    if not session:
        return _streaming_response(iter([_sse("error", {"message": "会话不存在"})]))

    lesson = session["lesson"]
    # 旧 lesson step 做边界检查;新 topic step 由 _explain_event 内部解析,这里跳过数值校验
    if not isinstance(step_id, str):
        if step_id < 1 or step_id > len(lesson["steps"]):
            return _streaming_response(iter([_sse("error", {"message": "step_id 越界"})]))
    session["current_step"] = step_id
    dlog(f"GOTO sid={sid} -> step={step_id}")

    def gen_factory():
        # 缓存命中(已生成过)时不发 step-start:重复跳同一已生成步不再加卡片
        cached = agent.get_step_cache(sid, step_id) if sid else None
        if not (cached and cached.get("sceneCode")):
            yield _new_evt(sid, "step-start", {"stepId": step_id, "title": _step_title(lesson, step_id)},
                           agent_name="main", stepId=step_id)
        yield from _explain_event(lesson, step_id, session_id=sid)

    run = start_run(sid, f"goto-{step_id}", gen_factory)
    return _streaming_response(_stream_run(sid, run.run_id))


@csrf_exempt
def explain(request):
    """生成某步动画(点 list 触发,不经主 agent)。step_id 可为 int(旧 lesson)或 str 'topicid-N'(新 topic)。
    走 _explain_event:缓存命中直接回 explain;否则跑 step_agent(浏览器在环)。结果写 step_cache+step_status。"""
    if request.method != "POST":
        return _streaming_response(iter([_sse("error", {"message": "POST only"})]))
    try:
        body = json.loads(request.body or b"{}")
        sid = body.get("session_id", "")
        raw = body.get("step_id", 1)
        # step_id:字符串(新 topic)原样保留;数字(旧 lesson)转 int
        step_id = raw if isinstance(raw, str) else int(raw)
    except Exception:
        sid, step_id = "", 1
    session = agent.get_session(sid)
    if not session:
        return _streaming_response(iter([_sse("error", {"message": "会话不存在"})]))
    lesson = session.get("lesson") or {}
    session["current_step"] = step_id
    dlog(f"EXPLAIN sid={sid} step={step_id}")

    def gen_factory():
        step_title, _, _ = _resolve_step_info(session, step_id)
        # 缓存命中(已生成过)时不发 step-start:首次点 list 已加过该卡片,重复点不再加(避免对话栏堆叠)
        cached = agent.get_step_cache(sid, step_id) if sid else None
        if not (cached and cached.get("sceneCode")):
            yield _new_evt(sid, "step-start", {"stepId": step_id, "title": step_title},
                           agent_name="main", stepId=step_id)
        yield from _explain_event(lesson, step_id, session_id=sid)

    run = start_run(sid, f"explain-{step_id}", gen_factory)
    return _streaming_response(_stream_run(sid, run.run_id))


@csrf_exempt
def update(request):
    if request.method != "POST":
        return _streaming_response(iter([_sse("error", {"message": "POST only"})]))
    try:
        body = json.loads(request.body or b"{}")
        sid = body.get("session_id", "")
        question = body.get("question", "").strip()
        file_text = body.get("file_text")
    except Exception:
        sid, question, file_text = "", "", None
    if not sid or not question:
        return _streaming_response(iter([_sse("error", {"message": "缺少 session_id 或 question"})]))

    dlog(f"UPDATE sid={sid} question={question!r} has_file={bool(file_text)}")

    def gen_factory():
        try:
            # 更新问题:重新 plan
            session = agent.get_session(sid)
            if not session:
                yield _new_evt(sid, "error", {"message": "会话不存在"}, agent_name="main")
                return
            lesson = agent.start_session(question, file_text)[1]
            # 复用原 sid,清空场景代码缓存(知识点变了)
            agent._SESSIONS[sid] = {**session, "question": question, "lesson": lesson, "current_step": 1, "finished": False, "step_cache": {}, "scene_codes": {}, "title": lesson.get("title", question[:20])}
            yield from _emit_lesson_events(lesson, 1, session_id=sid)
        except Exception as e:
            yield _new_evt(sid, "error", {"message": f"更新失败: {e}"}, agent_name="main")

    run = start_run(sid, "update", gen_factory)
    return _streaming_response(_stream_run(sid, run.run_id))


@csrf_exempt
def regenerate(request):
    """前端执行场景代码报错 → 用错误信息重新生成该步代码。SSE: explain / error。"""
    if request.method != "POST":
        return _streaming_response(iter([_sse("error", {"message": "POST only"})]))
    try:
        body = json.loads(request.body or b"{}")
        sid = body.get("session_id", "")
        step_id = body.get("step_id")
        error = body.get("error", "")
    except Exception:
        sid, step_id, error = "", None, ""
    session = agent.get_session(sid)
    if not session or not step_id:
        return _streaming_response(iter([_sse("error", {"message": "会话或 step_id 缺失"})]))

    lesson = session["lesson"]
    dlog(f"REGENERATE sid={sid} step={step_id} error={error!r}")

    def gen_factory():
        try:
            # 手动重生成:清该步缓存,重跑 step agent(浏览器在环自修)
            # step_id 可能是 int(旧)或 str 'topicid-N'(新),统一 str(step_id) 作 cache 键
            sid_step = str(step_id)
            if sid:
                agent.set_step_cache(sid, sid_step, {"sceneCode": "", "title": "", "intent": "", "formula": "", "narration": "", "params": []})
            yield from _explain_event(lesson, sid_step, prev_error=error, session_id=sid)
        except Exception as e:
            yield _new_evt(sid, "error", {"message": f"重生成失败: {e}"}, agent_name="step", stepId=str(step_id))

    run = start_run(sid, f"regen-{step_id}", gen_factory)
    return _streaming_response(_stream_run(sid, run.run_id))


@csrf_exempt
def render_result(request):
    """前端渲染回传:body {session_id, step_id, ok, error?, frame?}。
    恢复暂停的 step agent(浏览器在环验证循环),流式返回 render_request(再次失败)/ explain(通过) / error。
    frame:ok=True 时可选,最后一帧 base64(视觉检查用),后端存 png 并把路径传给 step agent。
    """
    if request.method != "POST":
        return _streaming_response(iter([_sse("error", {"message": "POST only"})]))
    try:
        body = json.loads(request.body or b"{}")
        sid = body.get("session_id", "")
        step_id = body.get("step_id", 0)  # 可能是 int(旧)或 str(新分层 topic step_id,如 "3af9a407-1")
        ok = bool(body.get("ok", False))
        error = body.get("error", "") or ""
        frame = body.get("frame", "") or ""  # base64 PNG(无 data:image/png;base64, 前缀)
    except Exception:
        return _streaming_response(iter([_sse("error", {"message": "参数解析失败"})]))
    if not sid or not step_id:
        return _streaming_response(iter([_sse("error", {"message": "session_id/step_id 缺失"})]))
    # step_id 统一转字符串(set_render_result/resume_step_agent/step_cache 都按字符串键存)
    step_id = str(step_id)
    # ok=True 且带了 frame → 存盘,路径传给 step agent 做视觉检查
    frame_path = ""
    if ok and frame:
        try:
            import base64 as _b64, os as _os, re as _re
            frames_dir = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "sessions", f"{sid}_frames")
            _os.makedirs(frames_dir, exist_ok=True)
            # 去掉可能的 data: 前缀
            raw = _re.sub(r"^data:image/\w+;base64,", "", frame)
            with open(_os.path.join(frames_dir, f"step_{step_id}.png"), "wb") as _f:
                _f.write(_b64.b64decode(raw))
            frame_path = _os.path.join(frames_dir, f"step_{step_id}.png")
        except Exception as e:
            dlog(f"FRAME_SAVE_FAIL sid={sid} step={step_id} err={e!r}")
    dlog(f"RENDER_RESULT sid={sid} step={step_id} ok={ok} error={error!r} frame={'Y' if frame_path else 'N'}")
    set_render_result(sid, step_id, ok, error, frame_path=frame_path)

    def gen_factory():
        try:
            for ev in resume_step_agent(sid, step_id):
                kind = ev.get("kind")
                if kind in ("agent_start", "tool_call", "tool_result", "render_result", "error"):
                    yield ev
                elif kind == "render_request":
                    dlog(f"render_result sid={sid} step={step_id} -> render_request again code_len={len(ev.get('payload',{}).get('code',''))}")
                    yield ev
                    return  # 本段结束,等前端再次 POST
                elif kind == "explain":
                    sd = ev["payload"]["step"]
                    agent.set_step_cache(sid, step_id, sd)
                    dlog(f"render_result sid={sid} step={step_id} -> OK sceneCode_len={len(sd.get('sceneCode',''))} STORED")
                    yield _new_evt(sid, "explain", {
                        "stepId": step_id,
                        "title": sd.get("title", ""),
                        "intent": sd.get("intent", ""),
                        "formula": sd.get("formula", ""),
                        "narration": sd.get("narration", ""),
                        "explanation": sd.get("explanation", ""),
                        "paramsUsed": [p.get("name") for p in sd.get("params", [])],
                        "params": sd.get("params", []),
                        "sceneCode": sd.get("sceneCode", ""),
                    }, parentId=ev.get("id"), agent_name="step", stepId=step_id)
                    return
        except Exception as e:
            dlog(f"render_result sid={sid} step={step_id} EXCEPTION: {type(e).__name__}: {e}")
            yield _new_evt(sid, "error", {"message": f"恢复 agent 失败: {e}"}, agent_name="step", stepId=step_id)

    run = start_run(sid, f"resume-{step_id}", gen_factory)
    return _streaming_response(_stream_run(sid, run.run_id))


@csrf_exempt
def sessions(request):
    """列会话 / 新建空会话 / 取某会话状态。"""
    if request.method == "GET":
        return JsonResponse({"sessions": agent.list_sessions()})
    if request.method == "POST":
        # 新建空会话(不调 LLM,等用户提问再 plan)
        sid = str(__import__("uuid").uuid4())[:8]
        agent._SESSIONS[sid] = {
            "question": "", "file_text": None, "lesson": None,
            "current_step": 1, "finished": False, "scene_codes": {},
            "title": "新会话",
        }
        return JsonResponse({"session_id": sid})
    return JsonResponse({"error": "GET/POST only"}, status=405)


@csrf_exempt
def session_detail(request, sid: str):
    """取某会话完整状态(供切换时恢复)。内存无则从 state.json 加载(重启后恢复)。"""
    s = agent.get_session(sid)
    if not s:
        from skill.session_store import load_state
        st = load_state(sid)
        if st:
            agent.restore_session(sid, st)
            s = agent.get_session(sid)
    if not s:
        return JsonResponse({"error": "会话不存在"}, status=404)
    lesson = s.get("lesson") or {}
    step_cache = s.get("step_cache", {}) or {}
    merged_steps = []
    for st in lesson.get("steps", []):
        sid_num = st.get("id")
        sc = step_cache.get(sid_num, {})
        merged_steps.append({
            **st,
            "narration": sc.get("narration", st.get("narration", "")),
            "formula": sc.get("formula", st.get("formula", "")),
            "explanation": sc.get("explanation", st.get("explanation", "")),
            "intent": sc.get("intent", st.get("intent", "")),
            "paramsUsed": sc.get("paramsUsed", st.get("paramsUsed", [])),
        })
    # topics 的每个子知识点合并 step_cache(按字符串 step_id),前端据此判断已缓存(有 explanation/sceneCode)
    raw_topics = s.get("topics", []) or []
    merged_topics = []
    for tp in raw_topics:
        msteps = []
        for st in tp.get("steps", []):
            sc = step_cache.get(str(st.get("id")), {})
            msteps.append({
                **st,
                "explanation": sc.get("explanation", st.get("explanation", "")),
                "intent": sc.get("intent", st.get("intent", "")),
                "narration": sc.get("narration", st.get("narration", "")),
                "formula": sc.get("formula", st.get("formula", "")),
                "paramsUsed": sc.get("paramsUsed", st.get("paramsUsed", [])),
                "sceneCode": sc.get("sceneCode", ""),
            })
        merged_topics.append({**tp, "steps": msteps})
    return JsonResponse({
        "session_id": sid,
        "question": s.get("question", ""),
        "title": s.get("title", ""),
        "current_step": s.get("current_step", 1),
        "lesson": {**lesson, "steps": merged_steps},
        "scene_codes": s.get("scene_codes", {}),
        "topics": merged_topics,
        "depth": s.get("depth", "understand"),
        "graph": s.get("graph"),
    })


@csrf_exempt
def trace(request, sid: str):
    """取某会话的执行树事件流(供前端重建 Claude Code 式可展开视图)。"""
    from skill.session_store import read_trace
    events = read_trace(sid)
    return JsonResponse({"sid": sid, "events": events})


@csrf_exempt
def export_session(request, sid: str):
    """导出某会话为 JSON(下载/归档)。GET /api/session/<sid>/export。"""
    if request.method != "GET":
        return JsonResponse({"error": "GET only"}, status=405)
    try:
        data = agent.export_session(sid)
    except KeyError as e:
        return JsonResponse({"error": str(e)}, status=404)
    resp = JsonResponse(data, json_dumps_params={"ensure_ascii": False})
    filename = (data.get("title") or sid).replace(" ", "_")[:30]
    resp["Content-Disposition"] = f'attachment; filename="{filename}.json"'
    return resp


@csrf_exempt
def import_session(request):
    """导入导出的 JSON 重建会话(不调 LLM)。POST /api/session/import, body=导出的 JSON。返回新 sid。"""
    if request.method != "POST":
        return JsonResponse({"error": "POST only"}, status=405)
    try:
        data = json.loads(request.body or b"{}")
        sid = agent.import_session(data)
        dlog(f"IMPORT new_sid={sid} steps={len(data.get('steps', []))}")
        return JsonResponse({"sessionId": sid, "title": data.get("title", "")})
    except Exception as e:
        dlog(f"IMPORT FAIL: {type(e).__name__}: {e}")
        return JsonResponse({"error": f"导入失败: {e}"}, status=400)


@csrf_exempt
def upload(request):
    """接收文件,提取文本。支持 .txt/.md/.pdf。
    新流程:若带 sid(POST 字段),存到 backend/uploads/<sid>/ 返回 file_id(主 agent 用 read/grep 读)。
    旧流程:不带 sid,返回 file_text(前端随 start/update 发,兼容)。"""
    if request.method != "POST":
        return JsonResponse({"error": "POST only"}, status=405)
    f = request.FILES.get("file")
    if not f:
        return JsonResponse({"error": "缺少 file"}, status=400)
    name = f.name.lower()
    raw = f.read()
    sid = request.POST.get("sid", "")
    # 若带 sid:存文件,返回 file_id(主 agent 按需 read/grep,不全量塞上下文)
    if sid:
        try:
            meta = agent.save_upload(sid, f.name, raw)
            return JsonResponse({"file_id": meta["id"], "name": meta["name"], "size": meta["size"]})
        except Exception as e:
            return JsonResponse({"error": f"存储失败: {e}"}, status=500)
    # 旧流程:提取文本返回(兼容 start/update 的 file_text)
    try:
        if name.endswith(".pdf"):
            from pypdf import PdfReader
            reader = PdfReader(BytesIO(raw))
            text = "\n".join((p.extract_text() or "") for p in reader.pages)
        else:
            text = raw.decode("utf-8", errors="ignore")
        return JsonResponse({"file_text": text[:8000], "filename": f.name})
    except Exception as e:
        return JsonResponse({"error": f"解析失败: {e}"}, status=500)


@csrf_exempt
def chat(request):
    """主 agent 多轮对话:POST {sid, text, depth?, file_ids?} -> SSE。
    跑主 agent(run_main_agent),发 agent_start/tool_call/tool_result/ask/topic_added/animation_request/done/error。
    遇 ask/animation_request 的 interrupt,本段结束(等前端 POST /api/chat_answer resume)。"""
    if request.method != "POST":
        return _streaming_response(iter([_sse("error", {"message": "POST only"})]))
    try:
        body = json.loads(request.body or b"{}")
        sid = body.get("sid", "")
        text = body.get("text", "").strip()
        depth = body.get("depth")
        file_ids = body.get("file_ids", []) or []
    except Exception:
        sid, text, depth, file_ids = "", "", None, []
    if not text:
        return _streaming_response(iter([_sse("error", {"message": "缺少 text"})]))

    # 若 sid 不存在(首次),新建空 session
    if not sid or not agent.get_session(sid):
        sid = str(__import__("uuid").uuid4())[:8]
        agent.create_session_with_lesson(sid, text, None, {"title": text[:20], "summary": "", "params": [], "steps": []})

    # 把用户消息里的文件信息拼进给主 agent 的文本(只给 file_id+name,不给全文)
    user_msg = text
    s = agent.get_session(sid)
    if file_ids and s:
        files_info = ", ".join(f"{fid}({next((f['name'] for f in s.get('files',[]) if f['id']==fid), '?')})" for fid in file_ids)
        user_msg = f"{text}\n[用户上传文件: {files_info}。用 read/grep 工具按需读取,不要凭文件名猜测内容。]"
    if depth:
        s["depth"] = depth
        agent._persist_state(sid)

    dlog(f"CHAT sid={sid} text={text!r} depth={depth} files={file_ids}")
    from skill.main_agent import run_main_agent

    def gen_factory():
        try:
            yield {"kind": "session", "session_id": sid}
            for ev in run_main_agent(sid, user_msg, depth):
                yield ev  # main_agent 已构造好事件(id/parentId/agent/stepId/payload)
        except Exception as e:
            dlog(f"CHAT EXCEPTION: {type(e).__name__}: {e}")
            yield _new_evt(sid, "error", {"message": f"对话失败: {e}"}, agent_name="main")

    run = start_run(sid, f"chat", gen_factory)
    return _streaming_response(_stream_run(sid, run.run_id))


@csrf_exempt
def chat_answer(request):
    """前端回传对 ask_user 的回答 或 generate_animation 的结果:POST {sid, answer | result} -> SSE。
    resume 主 agent 继续跑。"""
    if request.method != "POST":
        return _streaming_response(iter([_sse("error", {"message": "POST only"})]))
    try:
        body = json.loads(request.body or b"{}")
        sid = body.get("sid", "")
        answer = body.get("answer", "")
        result = body.get("result")  # generate_animation 的结果 {ok, step_id, error?}
    except Exception:
        sid, answer, result = "", "", None
    if not sid:
        return _streaming_response(iter([_sse("error", {"message": "缺少 sid"})]))

    from skill.main_agent import set_chat_answer, resume_main_agent
    # ask 回答 / generate 结果都走 set_chat_answer(resume_main_agent 统一取)
    if result is not None:
        set_chat_answer(sid, result)
    else:
        set_chat_answer(sid, answer)
    dlog(f"CHAT_ANSWER sid={sid} answer={answer!r} result={result}")

    def gen_factory():
        try:
            for ev in resume_main_agent(sid):
                yield ev
        except Exception as e:
            yield _new_evt(sid, "error", {"message": f"续对话失败: {e}"}, agent_name="main")

    run = start_run(sid, f"chat-answer", gen_factory)
    return _streaming_response(_stream_run(sid, run.run_id))


@csrf_exempt
def user_preferences(request):
    """GET 返回用户偏好文本;POST {prefs} 保存。"""
    from skill import user_prefs
    if request.method == "GET":
        return JsonResponse({"prefs": user_prefs.load_prefs()})
    if request.method == "POST":
        try:
            body = json.loads(request.body or b"{}")
            user_prefs.save_prefs(body.get("prefs", ""))
            return JsonResponse({"ok": True})
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)
    return JsonResponse({"error": "GET/POST only"}, status=405)


@csrf_exempt
def decompose(request):
    """知识点分解 agent:POST {sid?, question, file_text?} -> SSE 流式知识谱系图。
    事件 kind:session / decompose_start / tool_call / tool_result / node / edge / graph / error / done。
    sid 给则用主 session(图挂到该 session);不给则先建主 session(用户答"先建 session 再分解")。
    分解事件 jsonl 落 sessions/decompose/ 子目录(与主 session 执行树 jsonl 分开)。
    每次 graph 事件(split 末尾/finish)把快照写回主 session 的 graph 字段并持久化。
    """
    if request.method != "POST":
        return _streaming_response(iter([_sse("error", {"message": "POST only"})]))
    try:
        body = json.loads(request.body or b"{}")
        sid = body.get("sid", "") or ""
        question = body.get("question", "").strip()
        file_text = body.get("file_text")
    except Exception:
        sid, question, file_text = "", "", None
    if not question:
        return _streaming_response(iter([_sse("error", {"message": "缺少 question"})]))

    # 无 sid 先建主 session(图要挂到 session 上)。
    # 用 lesson=None 的空 session(同 /api/sessions POST),不用 create_session_with_lesson
    # —— 那个给 outline 用,会建 steps 空的 lesson,前端切回时某处假设 steps 非空会崩。
    if not sid or not agent.get_session(sid):
        sid = str(__import__("uuid").uuid4())[:8]
        agent._SESSIONS[sid] = {
            "question": question, "file_text": None, "lesson": None,
            "current_step": 1, "finished": False, "scene_codes": {},
            "title": question[:20] or "知识分解",
            "conversation": [], "files": [], "depth": "understand",
            "topics": [], "step_status": {}, "graph": None,
        }
        agent._persist_state(sid)
    else:
        # session 已存在(GraphApp 先 newSession 建了空 session):补上 question/title,供会话列表识别
        s = agent.get_session(sid)
        if question and not s.get("question"):
            s["question"] = question
            s["title"] = question[:20]
            agent._persist_state(sid)

    dlog(f"DECOMPOSE sid={sid} question={question!r} has_file={bool(file_text)}")
    final_sid = sid

    def gen_factory():
        try:
            yield {"kind": "session", "session_id": final_sid}
            from skill.decompose_agent import run_decompose_agent, _snapshot_graph, _GRAPHS
            for ev in run_decompose_agent(final_sid, question, file_text):
                yield ev  # decompose_agent 已构造好 id/parentId/agent/stepId/payload
                # 每次 graph 事件把快照写回主 session(随 session 走,刷新/重启可恢复)
                if ev.get("kind") == "graph":
                    try:
                        if final_sid in _GRAPHS and _GRAPHS[final_sid].get("nodes"):
                            agent.set_graph(final_sid, {
                                "question": question,
                                "root_title": f"知识分解 · {question[:40]}",
                                "snapshot": _snapshot_graph(final_sid),
                            })
                    except Exception as e:
                        dlog(f"DECOMPOSE set_graph fail: {e!r}")
        except Exception as e:
            dlog(f"DECOMPOSE EXCEPTION: {type(e).__name__}: {e}")
            yield _new_evt(final_sid, "error", {"message": f"分解失败: {e}"}, agent_name="decompose")

    run = start_run(sid, "decompose", gen_factory, sub_dir="decompose")
    return _streaming_response(_stream_run(sid, run.run_id))


@csrf_exempt
def decompose_trace(request, sid: str):
    """取某分解会话的执行树事件流(sessions/decompose/<sid>.jsonl),供前端重建视图。"""
    from skill.session_store import read_trace
    events = read_trace(sid, sub_dir="decompose")
    return JsonResponse({"sid": sid, "events": events})


@csrf_exempt
def decompose_split(request, sid: str):
    """手动拆分某分解会话图里的一个节点。POST {target, children, prereqs?, deps?, prune?}。
    绕过 LLM 直接调 _split_replace(同样跑改接全连+剪枝+环检测)。返回更新后的 graph 快照 + 事件。
    """
    if request.method != "POST":
        return JsonResponse({"error": "POST only"}, status=405)
    try:
        body = json.loads(request.body or b"{}")
        target = (body.get("target") or "").strip()
        children = body.get("children", []) or []
        prereqs = body.get("prereqs", []) or []
        deps = body.get("deps", []) or []
        prune = bool(body.get("prune", True))
    except Exception as e:
        return JsonResponse({"error": f"bad body: {e}"}, status=400)
    if not target:
        return JsonResponse({"error": "缺少 target"}, status=400)
    dlog(f"DECOMPOSE SPLIT sid={sid} target={target!r} children={len(children)} prune={prune}")
    from skill.decompose_agent import manual_split, _GRAPHS
    if sid not in _GRAPHS or not _GRAPHS[sid].get("nodes"):
        return JsonResponse({"error": f"会话 {sid} 不存在或未初始化(先跑一次分解)"}, status=404)
    events, msg, snapshot = manual_split(sid, target, children, prereqs, deps, prune=prune)
    # 落盘拆分事件到 decompose jsonl(供 trace 重放)
    from skill.session_store import append_event
    import uuid as _u
    for ev in events:
        evt = {"id": _u.uuid4().hex[:12], "parentId": None, "sid": sid,
               "kind": ev["kind"], "agent": "decompose", "stepId": None, "payload": ev["payload"]}
        append_event(sid, evt, sub_dir="decompose")
    return JsonResponse({"sid": sid, "message": msg, "graph": snapshot, "events": events})


@csrf_exempt
def decompose_to_topics(request, sid: str):
    """把分解会话的 DAG 转成 Topic 序列(知识清单),写入该主 session 的 topics。
    POST body 可选 {question?(覆盖标题)}。返回 {session_id, topic}。
    路由参数 sid 即主 session id(分解图已挂在该 session 上)。复用字符串 step_id 通路。
    """
    if request.method != "POST":
        return JsonResponse({"error": "POST only"}, status=405)
    s = agent.get_session(sid)
    if not s:
        return JsonResponse({"error": f"会话 {sid} 不存在"}, status=404)
    from skill.decompose_agent import graph_to_topic_sequence, ensure_graph_loaded
    if not ensure_graph_loaded(sid):
        return JsonResponse({"error": "该会话尚未分解知识图谱(先在分解 tab 跑一次)"}, status=404)
    try:
        body = json.loads(request.body or b"{}") if request.body else {}
    except json.JSONDecodeError:
        body = {}
    question = body.get("question", "") or (s.get("graph") or {}).get("question", "") or s.get("question", "")
    topic = graph_to_topic_sequence(sid, question)
    if not topic or not topic.get("steps"):
        return JsonResponse({"error": "图为空或全部已掌握,无可学节点"}, status=400)
    s["topics"] = [topic]
    agent._persist_state(sid)
    dlog(f"DECOMPOSE_TO_TOPICS sid={sid} steps={len(topic['steps'])}")
    return JsonResponse({"session_id": sid, "topic": topic})
