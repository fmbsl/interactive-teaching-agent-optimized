# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

教学智能体大赛项目:用户提问一个 STEM 知识点 → agent 拆成子知识点 list(左栏)→ 逐个用 manim-web 动画 + Markdown 讲解(中栏舞台 + 右栏讲解)。差异化:**浏览器实时可交互**(拖滑块调参,非生成视频)+ **对话式局部重生成**。三栏 UI:左 ChatPanel / 中 StagePanel / 右 ExplainPanel。

## Commands

**两个服务必须同时跑**(前端 5173 + 后端 8000),通过 `.claude/launch.json` 的 `manim-agent` / `django-backend` 配置起。
- 前端:`npm run dev`(Vite,5173)
- 后端:`python backend/manage.py runserver --noreload 8000`(必须 `--noreload`,autoreload 会清空内存 session)
- 类型检查:`npm run type-check`(注意:`tsc -b` 报的 `Scene`/`ValueTracker` as type、`title unused` 是预先存在的噪音,vite dev 不跑 tsc 不挡)
- 构建:`npm run build`(tsc + vite build,产出 `dist/` 含 main + standalone 两个入口)
- 装后端依赖:`pip install -r backend/requirements.txt`(Django/openai/python-dotenv/django-cors-headers)+ langgraph/langchain-openai/langchain-core(已装,未在 requirements.txt)

**改后端 .py 必须重启 Django 才生效**(`--noreload` 不自动重载)。重启会清内存 session,但 `backend/sessions/*.state.json` 会自动重建(见下)。

## 架构

### 两层 agent(都用 LangGraph create_react_agent + tool-calling)

- **主 agent**(`backend/skill/outline_agent.py`):拆知识点。**单个工具 `set_outline(title, summary, steps[])` 一次性给完整拆解**(不再多次 add_step)。流式发 tool_call 事件进执行树。
- **step subagent**(`backend/skill/step_agent.py`):设计单个子知识点。工具 `set_title`/`set_intent`/`set_explanation`(md,含 `$...$` 公式)/`set_params`/`add_animation(code)`/`finish`。

### 浏览器在环验证(step agent 核心)

`add_animation(code)` 内调 LangGraph `interrupt()` 暂停 agent → 后端把 code 通过 SSE `render_request` 推前端 → 前端 StagePanel 离屏跑 manim-web → POST `/api/render_result` 回传 ok/error → 后端 `Command(resume=)` 恢复 agent。**必须用 `MemorySaver` checkpointer**(无 checkpointer resume 会从头跑)。interrupt value 从 stream 末尾 `__interrupt__` chunk 取(state 可能是 list **或 tuple**)。agent 能多轮自修运行时错。

step_agent 用 `stream(stream_mode="updates")` 替代 `invoke`,逐个发 `tool_call`/`tool_result` 事件(agent=step)。主 agent 同理(agent=main)。

### 执行树(前后端共享事件模型)

事件扁平 list + `parentId` 建树:`{id,parentId,sid,ts,kind,agent,stepId,payload}`。kind:plan/step-start/agent_start/tool_call/tool_result/render_request/render_result/explain/error。id 后端 uuid 生成,SSE 带上。
- 落盘:`backend/skill/session_store.py` → `backend/sessions/<sid>.jsonl`(追加事件)+ `<sid>.state.json`(快照,覆盖写)
- 重建:`GET /api/sessions/<sid>/trace` 读 jsonl;`session_detail` 内存无则 `load_state`+`restore_session`;Django 启动 `load_sessions_on_startup()` 扫 state.json 重建 `_SESSIONS`
- 前端 `ChatPanel.renderTree` 按 parentId 建子列表 + 递归渲染 + 缩进;tool_call/render_request 默认折叠(点开看 code/args)

### LLM 配置(运行时可切换,不重启)

`backend/skill/llm_config_store.py` 存 `backend/llm_endpoints.json`(多接入点,每个 base_url/api_key/model + fallback)。`_get_runtime_cfg()` 返回当前启用接入点。前端 `SettingsPanel` 编辑。`.env` 的 `LLM_*` 仅作首次迁移默认。

### 前端执行模型

`src/components/StagePanel.tsx`:收到 `sceneCode` 用 `new AsyncFunction("ctx", code)` 沙箱执行,ctx 由 `makeManimCtx(scene, params)` 提供(`src/manimCtx.ts` 隔离 `import * as manimWeb`,避免破坏 React Fast Refresh)。3D 自动检测(`is3DCode` 正则)用 `ThreeDScene`,否则 `Scene`。验证用离屏 div + 10s 超时(避免 `scene.wait()` 无参卡死)+ 2D BB 重叠检测(开关 `bbCheckEnabled`)。

`src/components/ExplainPanel.tsx`:用 `react-markdown`+`remark-math`+`rehype-katex` 渲染 `explanation`(md,文字+`$...$`/`$$...$$`公式)。

`src/store.tsx`:React Context + useState(无 zustand),`useApp()` 消费。state 平铺,`useMemo` 依赖数组控制 context 重建。

### 后端编排(`backend/api/views.py`)

所有端点返回 `StreamingHttpResponse` SSE,但 **agent 生成与 SSE 连接解耦**(见下"后台执行器")。`_explain_event` 是**生成器**(yield 执行树事件 dict,executor 负责落盘),可能先 yield render_request 结束本段,最终 yield explain。`_new_evt` 构造事件 dict(id/parentId/sid/ts/kind/agent/stepId/payload)。`_explain_event_fallback` 用旧一次性 `generate_step` 作 agent 失败回退。

### 后台执行器(`backend/skill/executor.py`)—— 生成与 SSE 解耦

agent 生成器不再直接接到 SSE:每个视图构造 `gen_factory`(yield 事件 dict)→ `start_run(sid, label, gen_factory)` 在**后台 daemon 线程**跑,事件 push 进每 session 的 `Run` 内存缓冲 + 落盘 jsonl。SSE 视图 `_stream_run(sid, run_id)` 只是缓冲的读者。
- **客户端断连不影响后端**:SSE 读者停,后台线程继续跑到本段结束(explain 或 render_request),结果已落盘 step_cache/jsonl。
- 每 session 同一时刻一个 run,后到 run 取代前一个(旧 run `finish()`,旧读者收 `superseded` 收尾)。`run_id` 区分批次。
- `iter_events(sid, run_id, replay)` 生成器 yield `(evt, status)`,status ∈ live/done/superseded/error。
- 浏览器在环的 render_request 仍需前端 POST `/api/render_result` 触发新 run(resume 段);前端关闭则该段停在 render_request,重开重新导航会起新 run(新 runNonce),不卡死。

## 关键约束(踩过的坑)

- **字体**:所有 `new Text` 必带 `fontFamily: '"Times New Roman","SimSun",serif'`(英文 Times New Roman,中文 fallback SimSun;manim-web Text 用 Canvas fillText,无 fontFamily 中文不显示)。
- **公式**:数学公式必须用 `MathTex`/`Tex`(真 LaTeX),不要塞进 Text。`await eq.waitForRender()` 后再 add/play。
- **sceneCode 格式**:manim-web TS 函数体,开头 `const { scene, ..., params } = ctx;` 解构(用到 `params.xxx` 必须把 `params` 加进解构,否则 `params is not defined`)。
- **manim-web 0.3.24** = GitHub `maloyan/manim-web`(0.3.24 是最新)。API 文档 `https://maloyan.github.io/manim-web/api`,d.ts 在 `node_modules/manim-web/dist/**/*.d.ts`(带 doc 注释,**优先读 d.ts**)。3D 实体透明用 `opacity` 不是 `fillOpacity`;VGroup 取子元素用 `.get(i)` 不是 `[i]`;`Transform` 只同类间用。
- **React 闭包陈旧**:异步循环(consume)里用 `sessionIdRef.current` 不用闭包 `sessionId`;`session` 事件要直接 `sessionIdRef.current = ev.sessionId`(不等重渲染)。
- **禁向量算术**:JS `[1,2,3]+[4,5,6]` 是字符串拼接(喂给 Arrow3D/Line3D 会静默擦除网格)。逐分量或 `mob.shift`。
- **转换器路线已废弃**:`tools/py2ts.py` + `backend/skill/py2ts_adapter.py` + `*.bak*` 是旧 Python Manim CE → TS 转换器,保留作备份,**当前 A 方案是 LLM 直写 manim-web TS**,不要恢复转换器链路。

## 验证规则

- **不截图不读 PNG**:验证渲染只用 `preview_snapshot`(无障碍树)/`preview_console_logs`/`preview_inspect`/`preview_logs`,绝不用 `preview_screenshot` 或 Read PNG/JPG(用户明确要求)。
- 网页搜索优先 Tavily MCP(`mcp__tavily__*`),不用内置 WebSearch。

## 日志

- `backend/debug.log`:流程时序(START/render_request/RENDER_RESULT/STORED 等),`dlog()` 写。
- `backend/llm_responses.log`:走 `_call_llm` 的完整 LLM 回复(outline + 旧 generate_step fallback)。**step_agent 的 tool-call 不进这里**(create_react_agent 直接调 ChatOpenAI)。
- `backend/sessions/<sid>.jsonl`:执行树原始事件(唯一能看 step agent 实际生成动画代码的地方——`step_agent.py` 的 `add_animation` 工具落盘每次提交的 code)。
