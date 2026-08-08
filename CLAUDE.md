# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

教学智能体大赛项目:用户提问一个 STEM 知识点 → **主 agent**(多轮对话中枢,可问澄清问题、读上传文件、按学习深度拆解、出考题、自选展示方式)拆成子知识点 list → 逐个用 manim-web 动画 + Markdown 讲解。三栏可拖拽 UI:左 ChatPanel(对话 + 分层多级知识点 list + 学习深度 + 文件)/ 中 StagePanel(动画 + 段间暂停 + 断点进度条;可切分解图/mermaid 图示)/ 右 ExplainPanel(讲解 + 考题)。差异化:**浏览器实时可交互**(拖滑块调参,非生成视频)+ **对话式局部重生成** + **主 agent 能问问题/读文件/多主题并列** + **多级分层知识清单 + 融合总结节点**(学完子节点后总结父知识点)+ **考题自测**(主 agent 出选择题,右边栏作答)+ **双展示方式**(manim 动画讲数学/物理,mermaid 图示讲流程/结构/分类/关系,主 agent 自选)。

## Commands

**两个服务必须同时跑**(前端 5173 + 后端 8000),通过 `.claude/launch.json` 的 `manim-agent` / `django-backend` 配置起。
- 前端:`npm run dev`(Vite,5173)
- 后端:`python backend/manage.py runserver --noreload 8000`(必须 `--noreload`,autoreload 会清空内存 session)
- 类型检查:`npm run type-check`(注意:`tsc -b` 报的 `Scene`/`ValueTracker` as type、`title unused` 是预先存在的噪音,vite dev 不跑 tsc 不挡)
- 构建:`npm run build`(tsc + vite build,产出 `dist/` 含 main + standalone + graph + **templates** 四个入口)
- 装后端依赖:`pip install -r backend/requirements.txt`(Django/openai/python-dotenv/django-cors-headers)+ langgraph/langchain-openai/langchain-core(已装,未在 requirements.txt)
- 前端依赖:`npm install`(含 `mermaid`——mermaid 图展示,动态 `import("mermaid")` 加载;`lucide-react`——开源 SVG 图标库,替代符号图标)

**改后端 .py 必须重启 Django 才生效**(`--noreload` 不自动重载)。重启会清内存 session,但 `backend/sessions/*.state.json` 会自动重建(见下)。

## 架构

### 两层 agent(都用 LangGraph create_react_agent + tool-calling + MemorySaver)

- **主 agent**(`backend/skill/main_agent.py`):**多轮对话中枢**。只在用户发消息时跑(`/api/chat`);点 list/看动画/调参绕过它。工具:
  - `add_topic(title, summary, steps[])` —— 拆解一个主题为子知识点列表,追加到 session.topics(多主题并列)。step_id 格式 `topicid-N`(字符串)。返回值含各 step 的 id+标题(供 generate_animation 用)。
  - `ask_user(question, options?)` —— 向用户提问(如"卷积是信号系统还是 CNN?")。**interrupt()** 暂停,前端展示问题 + 可选预设选项按钮(用户点击即发送)、用户答后 `/api/chat_answer` resume。`options` 是字符串数组,前端渲染成可点击按钮(降低回答成本)。
  - `read(file_id, offset=0, limit=100)` —— 读上传文件片段(仿 Claude Code Read,带行号,分片)。
  - `grep(pattern, file_id?)` —— 正则搜文件内容(仿 Claude Code Grep,返回匹配行+行号)。
  - `generate_animation(step_id)` —— 触发 subagent 生成某步的**完整讲解**(动画代码 + 教学意图 + Markdown 讲解 + 公式 + 可调参数)。**interrupt()** 暂停等 subagent 跑完(浏览器在环验证),结果写 step_cache+step_status。已生成过的步直接返回不重跑(查 step_cache)。调一次等于讲完那一步,不要调完又自己讲。
  - `decompose_knowledge(question)` —— 触发知识分解 agent 跑知识图谱(递归分解+找前置,产出 DAG)。**interrupt()** 暂停等分解完。返回图摘要。**调前先 `switch_stage("graph")`** 让用户实时看节点逐个出现。
  - `switch_stage(stage)` —— 切换中间舞台:`"graph"`(分解图)/`"animation"`(动画舞台)/`"mermaid"`(mermaid 图示)。工具内往 `_EMIT[sid]`(side-channel)append `stage_switch` 事件,`run_main_agent`/`resume_main_agent` 在每个 ToolMessage 前 drain yield(仿 decompose_agent)。
  - `set_depth(level)` —— 调整学习深度(科普/理解/深度理解)。
  - `generate_quiz(step_title, question, options, answer, explanation)` —— 出选择题考察用户。主 agent 直接产题(题干+4选项+正确答案下标+解析),**interrupt()** 暂停,前端右边栏 ExplainPanel 显示题+选项按钮,用户点选项 → `/api/chat_answer` 带 `answer=idx` resume,工具对比 answer 判对错返回给主 agent,主 agent 据此反馈。answer 传字符串下标,后端 `set_chat_answer(sid, idx)` → `Command(resume=idx)` → 工具 `interrupt()` 返回 idx。
  - `generate_diagram(step_title, diagram_type, code, explanation)` —— 用 **mermaid 图**展示知识点(补 manim 之短,适合流程/结构/分类/关系/状态/时序类:生物分类、历史脉络、软件架构、状态机)。主 agent 直接产 mermaid 源码(`code` 以 `graph`/`flowchart`/`sequenceDiagram`/`mindmap` 等开头,**不要包```围栏**)+ Markdown 讲解。工具内 `_EMIT` append `stage_switch(mermaid)` + `diagram` 事件(前端 consume setDiagram,MermaidPanel 渲染)。**不走 interrupt**(无需用户交互,主 agent 一次产完)。渲染失败前端显示语法错,主 agent 可改 code 重调。**知识点类型选择**:数学/物理/几何→`generate_animation`(manim);流程/结构/分类/关系→`generate_diagram`(mermaid)。
  - **分解图编辑(8 工具,复用 `decompose_agent` 的 `edit_*` 核心函数)**:`split_graph_node(target, children, prereqs?)` 拆节点、`remove_graph_node(title)` 删节点(连边一起删)、`add_graph_node(title, mastery?, aliases?)` 加节点、`rename_graph_node(title, new_title)` 改名、`add_graph_dependency(from_title, to_title)` 加依赖边(带环检测)、`remove_graph_dependency(from_title, to_title)` 删边、`set_graph_mastered(title, mastered)` 标记已掌握/取消、`list_graph_nodes()` 列所有节点(改图前先调,防 MemorySaver 上下文记错幻觉)。每个改图工具(除 list)开头先 `switch_stage("graph")` 往 `_EMIT` append stage_switch,再调 `edit_*` 拿快照,最后 `_push_graph(msg, snapshot)`:写回 `session.graph`(持久化)+ 往 `_EMIT` append `graph` 事件(前端 consume 收到刷新画布)。返回工具结果给 LLM。
  - 系统提示词:身份 + **系统认知**(三栏 UI/中间舞台可切换/典型工作流)+ 用户偏好(`backend/user_prefs.json`)+ depth 指引 + 工具说明 + "拆解前必须先问用户(传 options)" + "文件不给全文,用 read/grep 按需读"。
  - **流式回复**:用 `stream(stream_mode=["messages","updates"])` 多模式。messages 模式拿 LLM token 增量,yield `message_delta` 事件(同 id,增量 text);updates 模式拿 tool_call/interrupt,文本不重发(已流式)。前端 consume 收到 message_delta 找同 id 的 message item 追加 text(无则新建)。
- **step subagent**(`backend/skill/step_agent.py`):设计单个子知识点。工具 `set_title`/`set_intent`/`set_explanation`(md,含 `$...$` 公式)/`set_params`/`update_animation(code, old_str, new_str)`(合并的提交+局部改,见下)/`read_animation`/**`lookup_example(query)`**(在范例库检索与本镜最相关的手写/官方示例代码,学习其 API/交互/分镜手法后再写)/`finish`。

### 浏览器在环验证(step agent 核心)

`update_animation(code, old_str, new_str)` 不传 old_str = 整段提交;传 old_str+new_str = 局部改(唯一匹配替换,省 token)。内调 LangGraph `interrupt()` 暂停 → 后端把 code 通过 SSE `render_request` 推前端 → 前端 StagePanel 离屏跑 manim-web → POST `/api/render_result` 回传 ok/error(+可选最后一帧 frame)→ 后端 `Command(resume=)` 恢复 agent。**必须用 `MemorySaver` checkpointer**。interrupt value 从 stream 末尾 `__interrupt__` chunk 取(state 可能是 list **或 tuple**)。agent 能多轮自修运行时错。

**验证检测项**(`src/sceneCheck.ts`,渲染成功后依次跑,任一失败即 `reportVerifyResult(false, 原因)` 打回 agent 自修):
1. **MathTex 渲染错**(`detectMathTexError`):MathJax 异步字体加载失败,提示改 MathTexImage。
2. **NaN 检测**(`detectNaN`,硬错误、不受 BB 开关控制):标签文字含 `NaN` 或对象坐标为 NaN -> 报"角度/参数计算错,检查 ValueTracker/弧度换算/除数/np 向量化"。由来:实测某步"转角 NaN°"反复打回 6 次,加这个后 agent 一次拿到可操作原因。
3. **2D BB 重叠**(`detectOverlap`,开关 `bbCheckEnabled`):文字-文字 / 文字-图形重叠;忽略坐标轴。
4. **文字越界**(`detectOutOfBounds`):文字飘出 camera `frameWidth×frameHeight` 边界 -> 报哪段文字越界(右/上/…)。
5. **视觉检查**(`visionCheckEnabled`):截末帧给视觉辅助模型描述,仅提示不阻塞。

⚠️ **manim 构造名会被压缩**:打包后 `constructor.name` 是 `t9`/`e62` 之类,不能靠它判"是文字 / 坐标轴"。检测器统一用能力探测:文字 = `getText()/._text`、坐标轴 = `c2p/p2c`、边界 = `getCenter() ± getBoundingBox() 尺寸/2`(getBoundingBox 返回 `{width,height}` 尺寸,不是 `{min,max}`)。重叠/越界报错里非文字统一写"图形对象"(不显压缩名),文字带内容,方便 agent 定位。

⚠️ **langgraph resume 会从工具入口重跑整个工具函数**(不是从 interrupt 处继续)。所以工具里在 interrupt **前**不能改会被重跑逻辑依赖的状态(如 `_lastSubmittedCode` 只能在渲染通过后才设,否则重跑时 old_str 在已替换的代码里找不到)。

⚠️ **step_id 兼容**:分层 list 后 step_id 是字符串(`topicid-N`)。所有接 step_id 的端点(`render_result`/`goto`/`regenerate`/`explain`)都要兼容字符串,**不能 `int()` 强转**——漏一个就 ValueError 卡死。

step_agent 用 `stream(stream_mode="updates")` 替代 `invoke`,逐个发 `tool_call`/`tool_result` 事件(agent=step)。主 agent 同理(agent=main)。

**生成提示词能力(`backend/skill/manim_lesson.py` 的 `RUNTIME_POWER_BLOCK` 等)**:step_agent 系统提示词已放开——①「可交互对象」:教它用 `makeDraggable(mob,scene,{onDrag})`/`makeClickable(mob,scene,{onClick})`/`ValueTracker+addUpdater`,让动画可拖/可点;②「分镜导演权」:让它自己规划 2-4 个镜头、用 `Succession`/`AnimationGroup` 编排、关键量 `Indicate`/`Circumscribe`;③ 配色放开(多色更好);④ TS 容忍 + 可自建 scene(见前端执行模型)。`lookup_example(query)` 可检索范例库取参考。

### 共享 session 状态(`agent.py` 的 `_SESSIONS[sid]`)

字段:`question/lesson/current_step/step_cache/scene_codes/title`(旧)+ `conversation`(主 agent 对话历史)+ `files`(上传文件元数据,存 `backend/uploads/<sid>/`)+ `depth`(学习深度)+ `topics`(分层 list,多主题并列)+ `step_status`(各步动画生成状态黑板:pending/generating/done/error)。

⚠️ **`save_state`(`session_store.py`)必须同步存所有新字段**——加字段后漏存,重启后 state.json 里缺失,`restore_session` 的默认值会掩盖,要查 state.json 实际内容才能发现。

### 执行树(前后端共享事件模型)

事件扁平 list + `parentId` 建树:`{id,parentId,sid,ts,kind,agent,stepId,payload}`。kind:session/agent_start/tool_call/tool_result/topic_added/ask/render_request/render_result/explain/step-start/stage_switch/graph/quiz/diagram/done/error。id 后端 uuid 生成,SSE 带上。
- 落盘:`backend/skill/session_store.py` → `backend/sessions/<sid>.jsonl`(追加事件)+ `<sid>.state.json`(快照,覆盖写,含所有新字段)
- 重建:`GET /api/sessions/<sid>/trace` 读 jsonl;`session_detail` 内存无则 `load_state`+`restore_session`;Django 启动 `load_sessions_on_startup()` 扫 state.json 重建 `_SESSIONS`
- 前端 `ChatPanel.renderTree` 按 parentId 建子列表 + 递归渲染 + 缩进;tool_call/render_request 默认折叠(点开看 code/args)

### 端点(`backend/api/views.py` + `backend/urls.py`)

- **新主流程**:`/api/chat`(用户发消息,跑主 agent,带 depth+file_ids)、`/api/chat_answer`(回答 ask_user 或回传 generate_animation 结果,resume 主 agent)、`/api/upload`(传文件返回 file_id)
- **点 list 生动画**(不经主 agent):`/api/explain`(step_id 可 int 或 str `topicid-N`,跑 step_agent,结果写 step_cache+step_status)
- **浏览器在环**:`/api/render_result`(前端回传渲染结果,字符串 step_id,恢复 step_agent)
- **打断生成**:`/api/chat_stop`(POST `{sid}` → `current_run(sid).finish()` 停推 SSE;配合前端 AbortController 让对话框生成可被打断)
- **旧/兼容**:`/api/start`/`/api/next`/`/api/prev`/`/api/goto`/`/api/update`/`/api/regenerate`(旧 lesson 数字 step 流程,保留)、`/api/sessions`/`/api/sessions/<sid>`/`/api/sessions/<sid>/trace`、`/api/llm/config`、`/api/user_prefs`、`/api/decompose`(知识谱系图,独立功能)

### 知识分解 agent(接入主应用,中间舞台可切换,图随 session)

知识分解:用户输入 STEM 知识点 → agent ①判断是否需分解(原子概念如旋度不拆,复杂体系如线性代数拆成子概念)②递归找每个节点的前置知识直到命中"高中已掌握清单"(烘焙进 system prompt)③输出**知识谱系图 DAG**。**已接入主应用**:不再是独立 graph.html,主 agent 通过 `decompose_knowledge` 工具触发,中间舞台切换显示分解图。

**核心语义(节点替换 + 全连剪枝):**
- 图里**只有一种边 `prerequisite_of`**(A→B = 先学 A 才能学 B,from=基础前置, to=高级后续),**没有包含关系**。
- 分解 = 节点替换:概念 X 拆成子概念 {c1,c2,...} 后 X 从图里删除,变**集合标签**贴在子节点身上(`sets` 继承 X.sets + [X.title])。X 的入/出边全连到子节点(Y→X 变 Y→c1,Y→c2,...;X→Z 变 c1→Z,c2→Z,...),再让 LLM 剪掉语义不成立的冗余边(`_prune_edges`,但每个上游/下游至少留 1 条防丢依赖)。原子概念(旋度)不拆,留作叶节点。root 是普通节点,拆则消失变集合,不拆则留作叶。
- **depth 语义**:`depth 0 = root = 用户问的知识点(最高级目标)`,分解时子节点 `depth = parent+1`,**depth 越大越基础**。⚠️ **depth 不可靠用于基础/高级排序**(children 和 prereqs 共用同一 new_depth,基础和高级可能混在同一层)。布局改用**拓扑分层**(见下 `layeredLayout`)。
- **同物异名**:children/prereqs 带可选 `aliases`,去重按 标题+别名 匹配(`_resolve_existing` 查 `title_index`),合并时 sets/aliases 取并集、mastery 只升不降。
- **环检测**:每条边加入前 `_has_path(G, to, from)` 检查(to 已能到 from 则成环,拒加),最终图保证 DAG。
- **手动拆分**:`POST /api/decompose/<sid>/split` body `{target, children, prereqs?, deps?, prune?}`,绕过 LLM 直接调核心函数 `_split_replace`(与 LLM 工具共用)。
- **图编辑核心函数(`decompose_agent.py` 的 `edit_*`)**:`edit_remove_node`/`edit_add_node`/`edit_rename_node`/`edit_add_edge`/`edit_remove_edge`/`edit_set_mastered`/`edit_list_nodes`。每个 `ensure_graph_loaded(sid)` → `with _LOCKS[sid]:` 改图 → 返回 `(msg, _snapshot_graph(sid))`。**主 agent 的 8 个图编辑工具复用这些**(不重复实现),见主 agent 工具列表。
- **图转知识清单(多级分层 + 融合总结)**:`graph_to_topic_sequence` 产出多级树 + 融合总结节点。**多级分层**:节点 `sets` 链(被拆分父节点标题继承链)决定层级,`level=len(sets)`(sets=["微积分"]→L1,sets=["线性代数","向量"]→L2),`parent_title=sets[-1]`。**融合总结**:被拆分消失的父标题(在某节点 sets 里出现但已不是任何节点 title)= 融合总结候选,在其**所有后代**(sets 含 P 任意位置)都学完后插入"总结:P"步骤(`is_summary=True`,step_id `{topicid-SN}`),让用户学完子知识点后融合起来懂父知识点。step_id:普通 `{topicid-N}`,融合总结 `{topicid-SN}`(S 前缀防冲突)。TopicStep 加 `level?`/`parent_title?`/`is_summary?` 字段。⚠️ `_resolve_step_info` 要按 id 精确匹配(不能 `int(n)` 强转 SN)。

**图随 session 走(一 session 一图):**
- 主 session 加 `graph` 字段 = `{question, root_title, snapshot:{nodes,edges}} | None`,进 `save_state`/`restore_session`/`session_detail` 返回 → state.json 持久化。
- `decompose` 端点接收主 sid(不自建 dsid),用 `lesson=None` 的空 session(同 `/api/sessions POST`,**不用 `create_session_with_lesson`**——那个建 steps 空 lesson,前端切回崩);每次 `graph` 事件把 `_snapshot_graph(sid)` 写回 `agent.set_graph(sid,...)` + 持久化。
- `decompose_to_topics` 用主 sid 不新建 session,直接 `s["topics"]=[topic]`。
- `ensure_graph_loaded(sid)`:`_GRAPHS[sid]` 空时从主 session 的 graph 快照重建 nodes/edges/title_index(frontier 置空,只能 split 不能续 expand);`manual_split` 开头调它(重启后仍可拆分)。

**中间舞台切换(主 agent 控制 + 用户手动):**
- store 的 `view: "animation" | "graph"`(默认 animation)只控**中间舞台区**(三栏常驻,左 ChatPanel 右 ExplainPanel 不变)。
- 主 agent 加 `switch_stage(stage)` 工具切舞台。工具内往 `_EMIT[sid]`(side-channel)append `stage_switch` 事件,`run_main_agent`/`resume_main_agent` 在每个 ToolMessage 前 drain yield(仿 decompose_agent 的 `_EMIT` 模式)。
- 前端 consume 收到 `stage_switch` 事件调 `setView`。header 有"舞台:动画/分解"两个手动按钮(用户也能切),与主 agent 自动切互不冲突(都设 view)。
- 中间 section `{view === "graph" ? <GraphApp embedded /> : <StagePanel />}`,外包 `<div key={view} className="stage-transition">`(CSS `stageFadeIn` 0.32s 淡入 + translateY 8px→0)做切换过渡动画。

**主 agent 系统认知(提示词):**
- 系统提示词让主 agent 了解:三栏 UI、中间舞台可切换(自己用 switch_stage 控制)、分解/动画/讲解能力、典型工作流(ask_user → switch_stage graph → decompose_knowledge → add_topic → switch_stage animation → generate_animation)。
- `decompose_knowledge` 前先 `switch_stage("graph")` 让用户实时看节点逐个出现(分解过程可视化)。

**文件:**
- 后端核心:`backend/skill/decompose_agent.py`。模块级 `_GRAPHS`/`_EMIT`/`_LOCKS`。工具 `expand_node`/`finish`。`_split_replace` 共用。`MAX_DEPTH=4`、`MAX_NODES=80`、**`MAX_EXPAND=8`**(单次分解的 `expand_node` 调用次数上限,每轮=一次 LLM 调用,触顶清空 frontier 提示 finish 收尾,限时用;图表状态含 `expand_count`)。`thread_id=f"decompose#{sid}"`。`ensure_graph_loaded` 从快照重建。
- 后端端点(`backend/api/views.py`):`decompose`(POST,接收主 sid)、`decompose_trace`(GET)、`decompose_split`(POST)、`decompose_to_topics`(POST,用主 sid 不新建)。路由 `backend/backend/urls.py`。
- 前端:`src/graph/GraphApp.tsx`(用 `@xyflow/react` ReactFlow 画图,嵌入中间区时 `embedded` prop:去掉 minWidth/aside 执行流、顶栏紧凑)。`layeredLayout` **按 edges 拓扑分层**(Kahn + 最长路径,不用 depth 字段——depth 是递归拆解深度,children/prereqs 共用 new_depth 导致基础和高级混层):入度 0 的节点 level=0(最基础,最下 y=0),沿依赖向上 level 递增,高级目标(被依赖最多)在最上(y=-level*LAYER_ROW_H)。同层水平居中铺开。基础(下)→高级(上),边自然朝上。`depthColor` 色阶(深蓝→浅青,mastery 绿)。边 `type:"bezier"` + `markerEnd` 箭头;**边锚点**:节点 `sourcePosition: Position.Top`(从顶边出,指向更高级)/ `targetPosition: Position.Bottom`(从底边入,来自更基础),边不指定 handle 即用这两个默认 handle。节点 `width:180,height:54` 显式给(ReactFlow v12 minimap 依赖 measured,RO 在 preview 不触发 → 显式尺寸不依赖 RO)。
- jsonl 子目录隔离:事件落 `backend/sessions/decompose/<sid>.jsonl`(`sub_dir="decompose"`),与主 agent 的 `backend/sessions/<sid>.jsonl` 分开。**不写 `_SESSIONS`、不调 `save_state`**(轻量 session,但 graph 快照写主 session 的 state.json)。
- 前端 SSE:`src/data/llmClient.ts` 的 `streamRawSSE`(原始 dict)。`decompose(sid, question, fileText?)` 加 sid 参数。

### LLM 配置(运行时可切换,不重启)

`backend/skill/llm_config_store.py` 存 `backend/llm_endpoints.json`:多接入点(每个 base_url/api_key/model + fallback + `supportsVision`)+ 顶层 `visionEndpoint`(视觉辅助模型,主模型无视觉时用)。`_get_runtime_cfg()` 返回当前启用接入点;`_get_vision_cfg()` 返回视觉辅助模型。前端 `SettingsPanel` 编辑。`.env` 的 `LLM_*` 仅作首次迁移默认。

### 应用级设置(`/api/settings`)与主题

- **设置面板**:头部 `设置` 按钮打开 `src/components/SettingsPanel.tsx` 的 **多 Tab 弹窗**(模型 / 偏好 / 主题 / 知识分解 / 其它)。模型 tab = 原有 LLM 接入点 + 视觉辅助;偏好 tab = 用户偏好文本(user_prefs);知识分解 tab = 力度档位;其它 tab = BB 重叠检测 / 视觉检查开关。
- **应用级设置存储 `backend/skill/app_settings.py`** → `backend/app_settings.json`。端点 `GET/POST /api/settings`。目前唯一大类设置是 `decompose_effort`(low/mid/high),由 `EFFORT_PRESETS` 一键映射 decompose 三预算(深度/节点数/单次展开上限)。**decompose_agent** 在两处建图时把 `G["budget"]` 种子进图状态,`_split_replace`/`expand_node` 读 `G["budget"]`(缺省回模块常量 `MAX_DEPTH`/`MAX_NODES`/`MAX_EXPAND`)。
- **主题引擎 `src/theme.ts`**:前端中性色+强调色+错误/成功容器色全部改为 CSS 变量(基线在 `index.css` `:root`,组件用 `bg-[var(--bg-1)]` / `text-[var(--text)]` 等)。切换主题 = 给 `<html>` 设 `data-theme` + 注入高特异性 `:root[data-theme="id"]` 覆盖 `<style>`;`main.tsx` 模块加载即 `applyTheme(loadTheme())` 防首帧闪跳;自定义 CSS 存 `#user-css`(用户覆写主题变量要用 `:root[data-theme="paper"]{...}` 才压过内置)。预置 5 套:deepsea/oled/paper/terminal/sakura。
- ⚠️ **manim-web/three 不吃 CSS var()**:喂给 manim-web mobject 或 `Scene` 的 `color`/`backgroundColor` 参数不能用 `"var(--blue)"`,必须解析成实际颜色——`StagePanel` 里用模块级 `cssVar("--blue")`(读 getComputedStyle)包一层。否则 three.js 报 `THREE.Color: Unknown color model` 且颜色失效。
- **浅色主题下 manim 颜色自动压暗(双保险)**:浅色背景(paper/sakura,判断 `--bg-deepest` 感知亮度>0.5)下的亮色(亮度>0.5)会被压暗到 ~20% 但保留色相(WHITE→#333333、YELLOW→#333300)。两处生效,共用 `src/themeColor.ts`(无 manim-web 依赖):① `makeManimCtx`/`exposeManimGlobals` 展开命名色常量时覆盖(WHITE/BLACK/RED… 大写 `#hex`),② `runScript.execScript` 在进入前对**字面量** `color:"#ffffff"`/`"white"`/`"yellow"` 等做字符串替换兜底(`adaptColorLiterals`,不误伤纯文本内容,深色主题下原样)。深色主题保持原样。

### 前端执行模型

**共享执行层 `src/runScript.ts`**:所有 sceneCode 统一经它执行 —— `execScript(ctx, code, timeoutMs)` 先按纯 JS 用 `new AsyncFunction("ctx", code)` 直跑,若语法错(含 TS 注解如 `: number`/`as T`)就用 `ts.transpileModule` **懒加载剥掉类型**后重跑(**运行时兼容 TS**,不再整段拒绝);`stripBareImports` 剥 `import/export`(manim-web 导出已铺全局,见下);带超时防卡死。这是主应用 StagePanel 与模板检查页共用的执行入口(替代旧的 `detectTsSyntax` 打回)。

`src/manimCtx.ts`:隔离 `import * as manimWeb`(避免破坏 React Fast Refresh)。`makeManimCtx(scene, params)` 做注入 scene 的 ctx;新增 `exposeManimGlobals(container)` 把 manim-web 全部导出 + `container` 铺到 `window` 全局(自由脚本可 `new Scene(container,{相机})` 自建 scene、`import` 也可用)。

`src/components/StagePanel.tsx`:收到 `sceneCode` 后**自动分两种模式**——常规代码用注入 `scene`(主舞台有暂停/断点);代码若**自建 scene**(含 `new Scene(`/`new ThreeDScene(`),走自由脚本模式(给真 `#container` + 铺全局 + `execScript`,暂停/断点降级为连播)。离屏浏览器在环验证同样支持 TS 容忍 + 自建 scene;3D 自动检测(`is3DCode`)决定注入 scene 类型;验证带 **30s 超时**(长动画覆盖结尾 Indicate/Pulse)+ 2D BB 重叠检测 + 视觉检查(截末帧给视觉辅助模型,仅提示不阻塞)。

**模板库与检查页**:`src/templates/library.ts`(人工手写教学范例)+ `src/templates/official.ts`(由 `tools/gen_official_templates.py` 从 maloyan/manim-web 官方 example 生成,自建 scene 风格)。独立检查页 `templates.html`(Vite 入口已加)逐个渲染/检查。后端 `backend/skill/examples.json` 由这两个 TS 库导出,供 step_agent 的 `lookup_example` 检索。

**动画段间暂停**:主舞台 `runSceneCode` 包装 `scene.play`/`scene.wait`,每个动画段后调 `waitIfPaused()`。`pauseCtrl` ref(`{paused, resume, stepOnce}`):播放=解除暂停连播;暂停=下个段末停;⏭下一段=`stepOnce` 走一段再停;⏮=回开头(bumpStageReset)。**断点进度条**:预扫 `await scene.play/wait` 个数 = 断点数,`currentBp` 在 waitIfPaused 递增,UI 横条(已过亮/当前发光/未到暗)+ "X/总数"。
**动画导出(控制栏)**:①截图 = `scene.renderer.getCanvas().toDataURL('image/png')` 下载当前帧;②录制 WebM = `canvas.captureStream(30)` + `MediaRecorder`(先 vp9 后 vp8),**录制期间用 rAF 每帧调 `scene.render()` 强制重绘**,否则静止 WebGL 的 captureStream 录到空(110B 头)。`stageCanvas` 对自建场景取 container 里 canvas,但自建场景脚本自己驱动绘制、无法强制重绘(录制依赖其自身)。

`src/components/ExplainPanel.tsx`:用 `react-markdown`+`remark-math`+`rehype-katex` 渲染 `explanation`(md,文字+`$...$`/`$$...$$`公式),`.md-prose` 容器(手写 CSS,无 typography 插件)。**考题区**:底部渲染 `store.pendingQuiz`(主 agent 出的选择题)——题干+4 选项按钮,用户点选项 → 本地判对错(正确绿框✓/错误红框✗)+ 显示解析 + `setPendingResume({answer})` 触发 ChatPanel resume。已作答禁用重复点。无论有无 step 都显示考题区(step null 时只显示考题)。

`src/components/ChatPanel.tsx`:**对话气泡 + 流式 + 工具折叠**。
- 消息渲染:用户消息右气泡(蓝边)、agent 左气泡(灰边),agent 回复用 `react-markdown`+`remark-math`+`remark-gfm`+`rehype-katex` 渲染(支持公式/表格/列表)。
- 流式:`consume` 收 `message_delta` 事件(同 id 增量)找同 id 的 message item 追加 text(无则新建带 id 的 message)。parseSSE 有 `message_delta` case(streamSSE 用)。
- ask_user 选项:收到 `ask` 事件(带 `options?`)记 `pendingAsk={question,options}`,输入框上方渲染可点击选项按钮(点击即发送该选项文本,`answerWithOption`),也可自定义输入。
- 分层 topics list:`TopicNode` 可折叠,子知识点按 `explanation||sceneCode` 判断已缓存(✓ 蓝底 + "已生成"标记)vs 未生成(数字灰边)。**多级缩进**:`step.level`(sets 链长)控制 paddingLeft(level 0=4px,每级 +14px)。**融合总结节点**(`is_summary`):badge 显示 `Σ`,标题"总结:XXX",上方分隔线,"融合"标记,蓝边样式。点击 → `handleTopicStep` → `/api/explain`(已缓存 HIT cache 不重跑,后端缓存命中时不发 step-start 不重复加卡片)。
- 工具调用折叠:`makeItem` 对 subagent 的 `agent_start` 默认折叠(藏其下 tool_call 组),主 agent 的不折叠。tool_call collapsed 只显 `Wrench 图标 + 工具名`(藏 argSummary,展开看 args)。连续 tool_call 用 `ToolGroup` 聚合成一行"Wrench t1 → t2 · N 个工具"。step subagent 段整体折叠成一行"Bot 图标 + 设计第 X 步",点开看工具过程。图标用 `lucide-react`(Wrench/Bot/Code2/Play/Check/X/Menu/Plus/Paperclip/Download/Upload/Settings/SkipBack/Play/Pause/SkipForward/RotateCcw/Sparkles/Loader2)。
- **思考动效**:`loading` 时对话末尾显示 `.thinking-dot`(三点错峰脉冲 + 旋转 Loader2 + "主 agent 正在思考…"),表示等 LLM 回答/拆解/生成。
- **打断生成**:`loading` 时输入栏发送按钮变「■ 停止」,点击 → `abortRef.current.abort()` 立即停流(AbortController 传入 `chat`/`chatAnswer` 的 signal)+ `chatStop(sid)`(POST `/api/chat_stop` 让后端停推)+ 清 loading + 对话加"⛔ 已打断生成"。
- `consume` 处理 `stage_switch`(setView,支持 graph/animation/mermaid)、`graph`(主 agent 图编辑工具改图后推的快照,调 `setDecomposeGraph` 刷新画布,不进对话栏)、`quiz`(主 agent 出题,`setPendingQuiz` 存 store,右边栏显示)、`diagram`(主 agent 产 mermaid 图,`setDiagram` 存 store,MermaidPanel 渲染)、`decompose_request`(调 `/api/decompose` 跑分解 agent,每个 graph 事件实时 setDecomposeGraph,跑完 chatAnswer resume)、`animation_request`(调 `explainStep` 跑 step subagent,流正常结束即 ok=true resume)。`consumeRunIdRef` 防 session 串台。
- ⚠️ **非 ChatPanel 发起的 resume(右边栏考题作答)经 `store.pendingResume`**:ExplainPanel 点选项 → `setQuizResult`(本地判对错)+ `setPendingResume({answer})`;ChatPanel useEffect 监听 pendingResume → `consume(chatAnswer(sid, answer))`(主 agent 反馈才进对话栏)→ 清空。不能在 ExplainPanel 直接 consume(事件不进 ChatPanel 对话栏)。
- ⚠️ **graph 事件分支必须在 `consume` 里(不是 `handleEvent`)**:`consume` 是主 agent `/api/chat` 流的消费者,主 agent 图编辑工具推的 `graph` 事件走这里。`handleEvent` 只处理子流递归(render_request/decompose_request/animation_request 的回传流),里面的 graph 分支轮不到。曾误加在 handleEvent 导致画布不刷新。`consume` 用独立 `if (ev.kind === "graph")`(在 stage_switch 之后,和 session/plan/ask 等同级),非 `else if`。
- 学习深度下拉 + 文件 chip + 内联渲染。

`src/store.tsx`:React Context + useState(无 zustand),`useApp()` 消费。state 平铺,`useMemo` 依赖数组控制 context 重建。关键字段:`view`("animation"|"graph"|"mermaid",中间舞台,主 agent switch_stage + 用户手动按钮都设)、`decomposeGraph`({question,root_title,snapshot}|null,当前 session 分解图快照,ChatPanel 切会话从 session_detail.graph 写入,GraphApp effect 监听重建画布)、`pendingQuiz`(主 agent 出的当前选择题|null,ExplainPanel 渲染)、`quizResult`(用户作答结果|null,显示对错+解析)、`pendingResume`(非 ChatPanel 发起的 resume 如考题作答|null,ChatPanel useEffect 监听 consume chatAnswer)、`diagram`(mermaid 图快照|null,MermaidPanel 渲染)、`topics`/`pendingFiles`/`depth` 等。`switchSession` 兜底 `info.lesson?.steps ?? []`/`lesson?.params ?? []`(空 lesson session 不崩)。

`src/App.tsx`:三栏常驻(左 ChatPanel / 中舞台 / 右 ExplainPanel)。**三栏可拖拽**:`leftWidth`/`rightWidth` state(localStorage 持久化 `panel-widths`,clamp 220-560/240-620),grid `gridTemplateColumns` 用 state,左/右两根 splitter(`.splitter` class,`onPointerDown` → window `pointermove`/`pointerup` 监听改宽度,hover/拖拽时蓝光高亮)。中间 section `{view==="graph" ? <GraphApp embedded /> : view==="mermaid" ? <MermaidPanel /> : <StagePanel />}`,外包 `<div key={view} className="stage-transition">`(CSS `stageFadeIn` 0.32s 淡入过渡)。**header 三段式**:品牌(logo `.logo-glow` 呼吸光晕 + 标题/副标题)| 居中舞台 segmented control(动画/分解/图示,带图标)| 操作(LLM)。`panel-anim` CSS 类给三栏内容淡入。`empty-state` CSS class(图标 `.empty-icon` 浮动动画 + 引导文案)用于各栏空状态。

`src/components/MermaidPanel.tsx`:mermaid 图展示(补 manim 之短)。`import("mermaid")` 动态加载(`initialize({theme:"dark",securityLevel:"loose"})`),`mermaid.render(id, code)` 产 SVG `dangerouslySetInnerHTML`。监听 `store.diagram.code` 变化重渲染(seq ref 防竞态)。渲染失败显示语法错。下方讲解区(`explanation`,react-markdown)+ 可折叠 mermaid 源码。无图时显示提示。**不走浏览器在环验证**(mermaid 渲染失败前端直接显错,主 agent 改 code 重调)。

### 后端编排(`backend/api/views.py`)

所有端点返回 `StreamingHttpResponse` SSE,但 **agent 生成与 SSE 连接解耦**(见下"后台执行器")。`_explain_event` 是**生成器**(yield 执行树事件 dict,executor 负责落盘),可能先 yield render_request 结束本段,最终 yield explain。`_new_evt` 构造事件 dict。`_resolve_step_info(session, step_id)` 按字符串/数字 step_id 解析标题/上一步/outline。

### 后台执行器(`backend/skill/executor.py`)—— 生成与 SSE 解耦

agent 生成器不再直接接到 SSE:每个视图构造 `gen_factory`(yield 事件 dict)→ `start_run(sid, label, gen_factory)` 在**后台 daemon 线程**跑,事件 push 进每 session 的 `Run` 内存缓冲 + 落盘 jsonl。SSE 视图 `_stream_run(sid, run_id)` 只是缓冲的读者。
- **客户端断连不影响后端**:SSE 读者停,后台线程继续跑到本段结束(explain 或 render_request),结果已落盘 step_cache/jsonl。
- 每 session 同一时刻一个 run,后到 run 取代前一个(旧 run `finish()`,旧读者收 `superseded` 收尾)。`run_id` 区分批次。
- `iter_events(sid, run_id, replay)` 生成器 yield `(evt, status)`,status ∈ live/done/superseded/error。
- 浏览器在环的 render_request 仍需前端 POST `/api/render_result` 触发新 run(resume 段)。

## 关键约束(踩过的坑)

- **字体**:所有 `new Text` 必带 `fontFamily: '"Times New Roman","SimSun",serif'`(英文 Times New Roman,中文 fallback SimSun;manim-web Text 用 Canvas fillText,无 fontFamily 中文不显示)。
- **公式**:`MathTexImage`(KaTeX)首选,稳定;`MathTex`/`Tex`(MathJax)慎用——`\overrightarrow`/`\mathcal` 等需动态字体的命令在浏览器里触发 MathJax retry,错误被静默吞,主舞台读几何时才抛。含这类命令一律用 MathTexImage。`await eq.waitForRender()` 后再 add/play。
- **sceneCode 兼容 TS(运行时剥类型)**:沙箱 `new AsyncFunction` 本质跑纯 JS,但 runner([src/runScript.ts](src/runScript.ts))现在会在语法错时用 `ts.transpileModule` **自动剥掉 TS 注解**(`(x: number)`、`as T`、`interface` 等)后重跑,不再整段拒绝。TS 注解会白耗 token,提示词仍建议写清晰纯 JS,但偶发带上不会崩。**事件/`detectTsSyntax` 打回已废弃**,改为转译容错。
- **sceneCode 格式**:开头 `const { scene, ..., params } = ctx;` 解构(用到 `params.xxx` 必须把 `params` 加进解构;**局部改引入新标识符也要同步加进解构行**,否则 `XXX is not defined`)。
- **改透明度**:统一 `setFillOpacity`(动画 `mob.animate.setFillOpacity(o)`、即时 `mob.setFillOpacity(o)` 都行)。`setStrokeOpacity` 只能即时(不在 `.animate` 链)。`setOpacity` **两处都不能用**(普通 mobject 无此方法;AnimateProxy 转发报 not found)。`withDuration` 小写 `w`。
- **动画 API 签名**(易错,照 d.ts 核实过):`ApplyFunction(mob, {func, duration})`(func 在 options 里);`ApplyPointwiseFunction` 已从提示词移除(别用,易和 ApplyFunction 混)。`AnimationGroup`/`LaggedStart`/`Succession` 接 `(animations数组, options)`——传数组不要 `...spread`。`Angle({line1, line2})` 的 line1/line2 必须是 `Line` 不是 `Arrow`。
- **对象必须进场景**:`ApplyFunction`/`Transform`/`.animate` 只对已在场景的 mobject 有效。`copy()` 出副本要立刻 `scene.add` 或进场动画,否则对副本做动画屏幕看不到(逻辑空动画,验证器抓不到)。
- **manim-web 0.3.24** = GitHub `maloyan/manim-web`(0.3.24 是最新)。API 文档 `https://maloyan.github.io/manim-web/api`,d.ts 在 `node_modules/manim-web/dist/**/*.d.ts`(带 doc 注释,**优先读 d.ts**)。3D 实体透明用 `opacity` 不是 `fillOpacity`;VGroup 取子元素用 `.get(i)` 不是 `[i]`;`Transform` 只同类间用。
- **React 闭包陈旧**:异步循环(consume)里用 `sessionIdRef.current` 不用闭包 `sessionId`;`session` 事件要直接 `sessionIdRef.current = ev.sessionId`(不等重渲染)。
- **禁向量算术**:JS `[1,2,3]+[4,5,6]` 是字符串拼接(喂给 Arrow3D/Line3D 会静默擦除网格)。逐分量或 `mob.shift`。
- **Vite watch**:`vite.config.ts` 的 `server.watch.ignored` 必须含 `**/backend/**`——后端运行时写 `sessions/*.jsonl` 等会触发 Vite 整页 reload。
- **转换器路线已废弃**:`tools/py2ts.py` + `backend/skill/py2ts_adapter.py` + `*.bak*` 是旧 Python Manim CE → TS 转换器,保留作备份,**当前 A 方案是 LLM 直写 manim-web TS**,不要恢复转换器链路。
- **流式 message_delta**:后端用 `stream_mode=["messages","updates"]` 多模式,messages 模式 yield `message_delta` 事件(同 id 增量)。**`parseSSE`(streamSSE 用的,在 llmClient.ts)必须 有 `case "message_delta"`**——曾漏加导致前端收不到流式回复(主 agent 回复不显示)。getTrace 的内联 switch 也要加。
- **空 lesson session 崩**:decompose 建空 session 用 `lesson=None`(同 `/api/sessions POST`),**不用 `create_session_with_lesson`**(那个传 steps=[] 会建空 lesson,`session_detail` 返回 lesson=`{steps:[]}` 非 null,`switchSession` 里 `for (const p of lesson.params)` 崩 `params is not iterable`)。`switchSession`/`StagePanel.ParamSliders`/`ExplainPanel` 都要兜底 `lesson?.steps ?? []`/`lesson?.params ?? []`。
- **animation_request resume ok=False**:前端 `animation_request` 处理跑 `explainStep`,explain 事件可能在 `handleEvent` 递归的 `postRenderResult` 流里(不在外层 sev),`if (sev.kind==="explain") ok=true` 检测不到。修:流正常结束且无 error 即 `ok=true`。
- **waitForRender 只用于公式**:`waitForRender()` 只有 `MathTexImage`/`MathTex`/`Tex`/`Variable` 有(异步 LaTeX 渲染)。`Text`/`Dot`/`Arrow` 等普通 mobject 没有,对它们调报 `Cannot read properties of undefined (reading 'waitForRender')`。提示词铁律 14 明确。
- **step_id 字符串**:`add_topic` 返回值含各 step 的 id(形如 `topicid-N`),主 agent 调 `generate_animation` 用这个 id。曾因返回值只说"N 步"主 agent 编 `1-1` 导致缓存 MISS 重生成。`generate_animation` 工具内查 step_cache,已生成直接返回不重跑。
- **ReactFlow v12 嵌入**:GraphApp 嵌入中间区用 `embedded` prop(去 minWidth/aside)。节点给显式 `width:180,height:54`(minimap 依赖 measured,RO 在 preview 不触发 → 显式尺寸不依赖 RO)。常驻 hidden 容器初始化会导致 RO 不触发 → 边/minimap 不画,**条件渲染**(view=graph 才挂载)而非 hidden 常驻。
- **step-start 重复加卡片**:`explain`/`goto` 端点 gen_factory 里**缓存命中(已生成)时不 yield step-start**(查 step_cache),只有 MISS 才发。重复点已生成的子知识点不在对话栏堆叠 step-start 卡片。
- **graph 事件分支位置**:`consume`(主 agent `/api/chat` 流消费者)和 `handleEvent`(子流递归)是**两个独立函数**,各有自己的 if/else if 链。主 agent 图编辑工具推的 `graph` 事件走 `consume`,**必须在 `consume` 的独立 `if` 链加分支**(和 stage_switch/session/ask 同级,在 130 行的 explain/message_delta 主链之后)。曾误加在 `handleEvent` 的 else if 链里,导致 126 行调试 log 打了 `ev.kind= graph` 但画布不刷新(事件在 consume 里被忽略,没到 handleEvent)。改图后画布实时刷新 = consume graph 分支 → `setDecomposeGraph` → GraphApp effect 监听 `decomposeGraph` 重建画布。
- **改图前先 list_graph_nodes**:主 agent 的 MemorySaver 上下文会"记住"旧图状态,直接让它删/改节点可能幻觉(回复"已删除"但没调工具,因为上下文里图是空的)。系统提示词要求改图前先调 `list_graph_nodes()` 拿当前真实图,再操作。

## 验证规则

- **不截图不读 PNG**:验证渲染只用 `preview_snapshot`(无障碍树)/`preview_console_logs`/`preview_inspect`/`preview_logs`,绝不用 `preview_screenshot` 或 Read PNG/JPG(用户明确要求)。
- 网页搜索优先 Tavily MCP(`mcp__tavily__*`),不用内置 WebSearch。

## 日志

- `backend/debug.log`:流程时序(START/render_request/RENDER_RESULT/STORED 等),`dlog()` 写。
- `backend/llm_responses.log`:走 `_call_llm` 的完整 LLM 回复(outline + 旧 generate_step fallback)。**step_agent 的 tool-call 不进这里**(create_react_agent 直接调 ChatOpenAI)。
- `backend/sessions/<sid>.jsonl`:执行树原始事件(唯一能看 step agent 实际生成动画代码的地方——`step_agent.py` 的 `add_animation` 工具落盘每次提交的 code)。

## 公网部署与访问令牌鉴权(2026-08 新增·踩坑)

**⚠️ 访问令牌鉴权当前已关闭**:`backend/middleware.py` 的 `AccessTokenMiddleware.__call__` 现直接 `return self.get_response(request)`,对所有 `/api` 放行、不自动生成 token。要恢复公网鉴权:把 `__call__` 改回检查 `Authorization: Bearer`/`?token=` 的逻辑(见 git 历史或文件内注释)。此前机制(可安全公网暴露):所有 `/api/` 请求(除 `/api/health`)须带 `Authorization: Bearer <token>` 或 `?token=<token>`;token 存 `backend/access_token.txt`(Django 首启自动生成);前端 URL 带 `?token=` 自动写入 localStorage 直接进入。

**前端同源 API(最容易踩的坑!)**:
- `src/data/llmClient.ts` 的 `API_BASE` 默认**空串** → 走相对 `/api`(同源)。dev 由 `vite.config` 的 `server.proxy['/api']→8000` 转发。
- ⚠️ **绝不能设 `VITE_API_BASE=http://localhost:8000`(不管在 .env 还是构建环境)**:Vite 会把它**硬编码进 bundle**,公网上评审浏览器把 API 打到**评审自己机器**的 localhost → 必现 `Failed to fetch`(还伴随 CORS preflight 打到 localhost)。症状即"页面能开、一调 API 就 Failed"。要同源就把 .env 里该行删掉再 `npm run build`。

**公网部署形态(一台服务器即可)**:
- nginx:静态 `dist/` + `location /api/ { proxy_pass http://127.0.0.1:8000; ... }`。
  - 必须 `proxy_set_header Authorization $http_authorization;`(nginx 默认不透传该头→后端 401)。
  - 必须 `proxy_buffering off; proxy_read_timeout 600s;`(SSE 流式聊天不断流)。
- 后端:`python manage.py runserver 0.0.0.0:8000`(并发要求不高够用)。
- 评审访问 `http://<ip>:8080/?token=...`。**不要**用自写 `tools/serve_public.py`(它对本机 curl 正常但对**浏览器**兼容差,会 `Connection reset by peer` → Failed to fetch);本地测试可用,公网入口一律用 nginx。

**LLM 接入点地域注意**:后端从**服务器本地**读 `llm_endpoints.json` 直调 LLM base_url,**服务器网络必须能连到该 LLM API**。实例:韩国(Azure)服务器连不上中国科大 `api.llm.ustc.edu.cn`(DNS 解析到国内 IP,跨网超时),但能连 `api.deepseek.com` → 该服务器 active 必须切到 deepseek 才能用。切换:`POST /api/llm/config {"action":"setActive","id":"default"}`。
