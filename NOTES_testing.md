# 测试与代码审查 — 运行笔记

## Bug #1 【严重】restore_session 字符串 step_cache 键崩溃 【已修复 2026-08-04】
- 现象:GET /api/sessions/<topic_sid> 返回 500 ValueError `int('b8f7f543-1')`。
- 根因:agent.py restore_session 里 step_cache dict 强转 int(k);JSON 落盘后键为字符串,带 topic 的会话键形如 `b8f7f543-1`。
- 连带影响:load_sessions_on_startup 用单个 try/except 包整循环,遇到第一个 topic 会话即抛错吞掉 → 启动时该会话及其后(字母序)所有会话全部不加载。
- 修复:①restore_session 不再 int 强转,step_cache/scene_codes 键统一字符串;②get/set_step_cache、set_scene_code 访问器统一 str(step_id);③load_sessions_on_startup 逐个 session try/except。验证:133/133 加载,054dc07c/1f8379c0 均 200。
- 相关行:agent.py:142, agent.py:154, agent.py:194-201。

## Bug #2 【观察】goto 不存在 topic 的字符串 step_id
- 现象:goto step_id="no-such-topic-1" 不报错,反而触发 step_agent 跑 LLM,标题显示"第 no-such-topic-1 步"。
- 性质:无校验,浪费 LLM;非崩溃。对标 _resolve_step_info 兜底返回"第 {step_id} 步"。
## Bug #3 【严重·安全】render_result 路径穿越任意 .png 写入 【已修复】
- 现象:此前(01:38-39)已有 `RENDER_RESULT step=../../travtest ok=True frame=Y`,落地 `02145b9e_frames/travtest.png`。
- 复现:step_id='../../../trav2' + ok=true + base64 frame → 逃出 frames_dir 写到 backend/sessions/../../ 等任意目录(.png 后缀)。
- 根因:views.py render_result 把未清洗的客户端 step_id 直接拼进 open() 路径 `step_{step_id}.png`。
- 修复:文件名用白名单 `[A-Za-z0-9_-]` 清洗出 safe_id 再拼路径;原始 step_id 仍作缓存键。验证:../../../trav2 不再逃出。

## Bug #4 【中等】非法 step_id 触发 int() 500 / step_agent 空跑浪费 LLM 【已修复】
- 复现:explain/goto step_id='abc' → 500 "invalid literal for int()";step_id='no-such-topic-1' → 触发 step_agent 跑 LLM(标题"第 no-such-topic-1 步")。
- 根因:_resolve_step_info 旧流 int(step_id) 无防护;新流 topic 不存在时兜底返回"第 X 步"不校验。
- 修复:新增 _valid_step_id(session, step_id),explain/goto/regenerate 入口校验,非法直接返回干净 error。验证:abc / no-such-topic-1 均返回 "step_id 无效"。

## 前端审查修复(两个深度审查 agent 结论,已全部处理)
### Bug #5 【严重】getTrace 引用未定义变量 tree → 切流式会话必 ReferenceError 【已修复】
- llmClient.ts:174 message_delta 还原用 `tree?.id`,tree 只在 parseSSE 作用域定义 → 落盘 trace 含 message_delta 即同步抛 ReferenceError → handleSwitchSession 的 try 吞掉 → 整棵执行树重建失败、对话历史清空。
- 修复:改用 `e.id`(事件自身 id)。tsc 已无 TS2304。
### Bug #6 【严重】ParamSliders 对 undefined 调 .toFixed(2) → 整页白屏【已修复】
- StagePanel.tsx:595 `paramValues[p.name].toFixed(2)`:切到当前活动步带参数但 paramValues 无 key(switchSession 只从 lesson.params 建,不合并 topic step params)→ TypeError,无 ErrorBoundary → 白屏。
- 修复:value 用 `paramValues[p.name] ?? p.default ?? p.min ?? 0`,toFixed 用同值。
### Bug #7 【高】ChatPanel `void ask;` 未定义变量 【已修复】
- submit() 回答 pendingAsk 后 `void ask;` → 每次输入框回答必 ReferenceError(未处理 Promise 拒绝)。删除该行。
### Bug #8 【中】ask_user 选项经 handleEvent(子流)到达时丢 options 【已修复】
- ChatPanel:394 `setPendingAsk(ev.question)` 丢 options;主路径 229 传了 {question,options}。统一为传 options。
### Bug #9 【中】render_request 在 view 非 animation 时死锁"永久生成中" 【已修复】
- render_request 等 verifyResultHandler 由 StagePanel(仅 view=animation 挂载)消费;主 agent 触发时若 view=graph/mermaid,Promise 永不 resolve → loading 恒 true。
- 修复:render_request 两处(consume/handleEvent)先 setView("animation") 再 requestVerify。
### Bug #10 【中·安全】MermaidPanel securityLevel loose + dangerouslySetInnerHTML = XSS 【已修复】
- mermaid code 来自 LLM 输出,可被诱导含 `<img onerror>`;loose 不清洗,dangerouslySetInnerHTML 直接进 DOM。改 securityLevel="strict"(mermaid 内建 DOMPurify 清洗)。
### Bug #11 【轻】SSE 早退不取消底层 reader 【已修复】
- consume 提前 return(.return() 中断 for await)时 streamSSE/streamRawSSE 无 finally cancel → HTTP 连接悬挂。两处补 finally reader.cancel()。
- 注:chat 后偶发整页 reload 疑与多标签/StrictMode 相关,未能稳定复现为代码 bug,已排除 backend watch(已 ignored)。

## 后端补充修复
### Bug #12 【中】current_step 为字符串时 legacy next/prev 做 +1/-1 → TypeError 500 【已修复】
- topic 会话 current_step 存字符串 step_id;next_step `session["current_step"]+1` 崩。两处加 if 非数字 → 干净 error。
### Bug #13 【中】decompose_split 重启后 404 【已修复】
- views decompose_split 直接查 _GRAPHS 不 ensure_graph_loaded → 重启后 404。改为先 ensure_graph_loaded。
### Bug #14 【低】generate_quiz answer 越界/非数字 → IndexError/ValueError 崩 agent turn 【已修复】
- answer 钳制到 [0,len(options)-1],int() 容错。前端 ExplainPanel 答题路径未发现 bug。
### Bug #15 【轻】导出文件名 Content-Disposition 头注入 【已修复】
- title 清洗 `[^\w.\-]` + 截断,防引号/换行注入响应头。
### Bug #16 【轻】main_agent 陈旧 _EMIT 串到下一 run 【已修复】
- run_main_agent 开头 _EMIT.pop(sid) 清残留。

## 测试验收汇总(端到端均通过)
- 主 agent 流:chat→agent_start→message_delta 流式→ask_user(带 options)→chat_answer resume→add_topic(字符串 step_id)→persist。✅
- 浏览器在环:explain→step_agent→render_request→render_result resume→tool_result→explain 落 step_cache(sceneCode+讲解)。✅
- decompose:node/edge/node_replaced/graph 事件,最终 17 节点 41 边,持久化;to_topics → 16 步字符串 id + 融合总结 S 节点 + level 分层。✅
- 文件:upload 清洗路径成分(save_upload),存 uploads/<sid>/fid_名;file_tools read/grep/坏正则 均正常。✅
- 边界:坏 step_id(abc/no-such-topic-1/越界999)→ 干净 error 不 500 不跑 LLM;坏 JSON/缺参/不存在会话 → 干净 error;路径穿越 step_id → 不逃出。✅
- 前端:空消息忽略、新会话、会话切换、舞台切换(动画/分解/图示)空状态、ask 选项按钮、输入框答题,全程 0 console error。✅

## 遗留(未改,供知悉)
- GET /api/llm/config 明文返回 apiKey(前端 Settings 需配置,本地 demo 可接受;若暴露公网需加鉴权)。
- backend/skill/decompose_agent.py、main_agent.py、step_agent.py、executor.py 的 _GRAPHS/_EMIT/_DRAFTS/MemorySaver 均按 sid 只增不删,长跑服务内存无界增长(竞赛 demo 可接受)。
- 并发:后台线程改 session dict(_SESSIONS)与请求线程读无锁,极端并发可能丢 topic 更新(单用户 demo 低风险)。
- npm run build 在 tsc -b 阶段因预存在 TS 噪音(未用 import/Scene as type/store spread)失败;CLAUDE.md 已声明为已知噪音且 vite dev 不挡。dist/ 停留在 08-03。
- llm_endpoints.json 里残留一条测试垃圾端点( name="1" baseUrl="1" )与历史测试会话(133 个 state.json)。

## Bug #17 【部署阻断】npm run build 因预存在 TS 噪音失败 【已修复】
- 之前 tsc -b 报 34 个 TS 错误(未用 import/var、Scene/ValueTracker 值当类型用、store.tsx spread 覆盖警告),`npm run build`(tsc -b && vite build)在 tsc 阶段失败,产出不了 dist/(停在 08-03)。CLAUDE.md 曾把部分当"噪音"跳过,但它们实际挡住构建。
- 修复(全部行为不变):①删未用 import(startLesson/updateQuestion/uploadFile/ChevronRight/Wrench/X/Connection/EdgeChange/NodeChange)与未用 var(fileText 取值、title、toggle、isVGroup、timeoutHit);②`Scene`/`ValueTracker` 用 `InstanceType<typeof X>` 作类型;③store.tsx 默认值改整体 spread 合并消 TS2783。
- 验证:npx tsc -b exit 0;npm run build exit 0 产出 dist/;**附带修正** StagePanel 220 行只写不读的 timeoutHit + 一条过期注释(超时实际按"通过"处理)。

## 第二轮追加修复(继续深挖)
### Bug #18 【部署阻断·继续】npm run build 已修通(详见 Bug #17),dist/ 全新产出
- 修复后验证:npx tsc -b exit 0;npm run build exit 0;dist/ 全新 main/manim/mermaid 等资源。浏览器 reload 0 console error。
### Bug #19 【中】step_agent _DRAFTS/_RESUMES 键 int/str 不一致 → 旧整数流 resume 失效 【已修复】
- run_step_agent 用"原样 step_id"作 _DRAFTS 键(旧流 int),而 render_result 统一 str(step_id) 后 resume_step_agent 用 str 键 → 旧整数流 resume 时 _DRAFTS/_RESUMES 双向 miss,浏览器在环无法恢复。新 topic 流因字符串天然一致未暴露。
- 修复:run_step_agent / set_render_result / resume_step_agent 三入口统一 str(step_id)(对齐 agent.py 的 str 键方案);_DRAFTS/_RESUMES 类型提示改 (str,str)。
### Bug #20 【轻·并发】run_decompose_agent 复位 _GRAPHS/_EMIT 无锁 【已修复】
- reset 整图在 `with _LOCKS[sid]:` 内进行(swap 瞬间短暂持锁,不阻塞后续 edit 工具),防与并行编辑竞态。
### 清理:删除 llm_endpoints.json 里坏掉的测试端点(name="1" baseUrl="1"),保留 default + ustc107。
### 测试补充
- 重新拆解 /api/update:plan→step-start→step_agent 正常,不崩。
- 出题 E2E(浏览器):请求出题→generate_quiz 产 4 选项→点 B.2→按钮标"正确"+ 本地判分→setPendingResume→chatAnswer resume→主 agent tool_result("用户答对啦!选了 B")→Markdown+KaTeX 反馈,0 console error。✅ 验证 generate_quiz 钳制 + 答题路径两处修复。
- 说明:对"已缓存/无活跃暂停 agent"的 step 人工 POST render_result 会超时(真实路径只在收到 render_request/有活跃暂停时才 POST),属预期。

## Bug #21 【严重】出题悬空时发新消息 → main agent 崩 INVALID_CHAT_HISTORY 【已修复】
- 现象:generate_quiz 用 interrupt() 暂停后(题目显示在右侧待答),用户在输入框发一条新消息 → 主 agent 抛
  `ValueError: Found AIMessages with tool_calls that do not have a corresponding ToolMessage`。
- 根因:①setPendingQuiz(null) 从未被清除 → pendingQuiz 悬空;②ChatPanel submit() 只挡 pendingAsk,不挡 pendingQuiz →
  pendingQuiz 时发新消息走 /api/chat → run_main_agent 在同一 MemorySaver 线程注入新 user 消息,而上回合的 generate_quiz
  tool_call 因 interrupt 未完成没有 ToolMessage → langgraph 校验历史失败崩溃。
- 修复:
  - 后端 main_agent.run_main_agent 开局用 get_state 检测"孤儿 tool_call"(无对应 ToolMessage)的 AIMessage;
    命中则 yield 干净 error("先完成待办/点跳过"),不再让 langgraph 抛异常。(单测:孤儿 True、已答完 False、纯文本 False)
  - 前端 ExplainPanel 加「跳过此题,继续对话」按钮:setPendingResume({answer:"-1"}) → resume generate_quiz
    (工具判"未作答"补上 ToolMessage)→ 后续新消息不再崩溃。
- 其它 interrupt 工具(ask_user/generate_animation/decompose_knowledge)的同类悬空同样被后端护栏兜住。

## 压力/并发/负载测试(结构性,非仅功能)
无现成压测工具(无 ab/wrk/hey),用 Python ThreadPoolExecutor 并发压真实端点。方案与结论:
- **HTTP 瞬时突发**:/api/sessions、/api/llm/config、/api/sessions/<sid>/trace、/api/sessions/<sid> 各 300 次并发40 → **0 错误/500**,p50~10ms,p95~530ms
- **同会话并发(压 executor supersede + 锁)**:80 次并发缓存 explain(HIT)、120 次并发图编辑、200 次混合读/写/编辑、200 次 trace 连接洪泛、200 次并发坏输入(run supersede 不串台、_LOCKS 编辑不加锁崩溃)→ **全部 0 错误/500**
- **并发后数据完整性**:图仍为合法 DAG(17节点/47边,无环、无悬挂边)✓
- **慢客户端/连接**:连 SSE 只读一小段就掐断 ×25 → 0 错误,后台 run 不阻塞(design:断连不停 worker)
- **超大输入**:2MB JSON → /api/sessions 不崩;50KB question → /api/chat 不崩
- **并发上传 ×25**:0 错误,文件正确落盘
- **并行真实 agent 负载**:6 个 decompose agent 同线程并行跑(每 run 一个后台 thread),全 200、各自建成有效 DAG → 多会话并行 + 共享 session 状态无崩溃
- **全程后端日志 0 个 500 / 0 Traceback / 0 INVALID_CHAT_HISTORY**;内存稳定 ~400MB;后端响应 p99 <1.1s
- 遗留/如实说明:dev server 是 Django runserver(非生产 WSGI),未测超大规模 RPS(无工具);并行 LLM 负载压到 6 个以控成本;模块级 _GRAPHS/_EMIT/_DRAFTS/MemorySaver 按 sid 只增不删,长跑内存无界(已记录为已知限制)。压测新增 ~7 个测试会话不影响功能。

## 改进实施(2026-08-04,来自上一轮提的建议,均已实现+验证+提交)
### 工程类
- P0#2 安全:LLM API key 不再明文下发前端 —— GET /api/llm/config 全掩码(••••后4位);保存时空/掩码 key 保留服务端真 key;真实 key 只存服务端。验证:GET 掩码、存掩码保留 len25 真 key、vision 也掩码。
- P0#3 自动化测试:新增 backend/tests/ pytest 第一层 15 用例(step_id 校验 5、孤儿 tool_call 4、安全 3、会话 3),`python -m pytest backend/tests/` → 15 passed。把之前人肉打过的边界固化成回归。
- P1#7 前端 ErrorBoundary:顶层边界,渲染异常不再白屏,给可恢复面板。已在 FileText 渲染崩溃中实证生效(接住异常显示面板)。
- P1#5 会话生命周期:新增 delete/rename 会话(清内存/缓存/落盘文件,幂等,404 兜底)。
### 功能类
- 功能#2 会话列表:搜索(标题/问题过滤)+ 重命名 + 删除,直击 150+ 会话无搜索/无生命周期痛点。搜索已验证(输入"加法" 150→20)。
- 功能#9 Markdown 学习笔记导出:export_session_md(原理+公式+讲解,合并 step_cache),GET /api/session/<sid>/export_md;前端「笔记」按钮下载 .md。验证:含意图+讲解+公式。

## 未实施(较大,留待后续)
- MemorySaver→SqliteSaver(agent 记忆跨重启,改动大需慎测)
- 学习进度/掌握状态跨会话持久化 + 全局已学地图
- 错题重练/间隔复习;PDF 图片/公式视觉理解;URL 深链刷新恢复
