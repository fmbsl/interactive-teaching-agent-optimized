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
# side-channel 事件队列:工具内不能 yield,往这里 append 事件,run_main_agent 在每个 ToolMessage 前 drain yield(仿 decompose_agent)
_EMIT: dict[str, list[dict]] = defaultdict(list)
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
        "popular": "科普:目标是直观上懂,多用类比、比喻、生活场景,少用公式;拆解粒度粗,每步动画重在建立直觉,讲解避免数学细节。",
        "understand": "理解:懂原理、会迁移;拆解粒度适中,讲清来龙去脉,公式与直觉并重,适当展示典型示例和易错点。",
        "deep": "深度理解:类似本科课程,要求能运用知识解题/解决实际问题;拆解可细,讲清定义、定理、证明思路、计算技巧、综合应用,动画可包含较复杂的推导过程。",
    }.get(depth, "")
    prefs = _load_prefs()
    return f"""你是教学智能体的主 agent,职责是帮用户学会 STEM 知识点。

**你对整个系统的认知(重要)**:
- 界面是三栏:左对话栏(你和用户聊天 + 知识点清单 list)、中间舞台、右讲解栏。
- **中间舞台可切换**:展示"知识分解图"(DAG,节点是知识点、箭头是前置依赖)或"动画舞台"(manim-web 实时可交互动画 + 段间暂停 + 断点进度)。你用 `switch_stage` 工具控制中间舞台展示什么。
- 知识点清单(list)在左栏:你调 `add_topic` 拆出的子知识点会进 list,用户点击某步 → 触发 `generate_animation` 生成该步动画+讲解。
- 讲解在右栏:每步的 Markdown 讲解(文字+公式)由 `generate_animation` 的 subagent 产出,自动显示。
- 你的对话回复会**流式**显示在左栏(气泡形式,Markdown 渲染)。

**身份与工作方式**:
- 你和用户多轮对话。每收到用户消息,判断该做什么:问澄清问题 / 拆解知识点 / 调整深度 / 读文件 / 触发某步生成 / 切换舞台。
- 通过调用工具行动,不要输出 JSON。可以输出简短自然语言和用户沟通(如"我来帮你拆解X,先看下整体结构"),但实质动作都靠工具。

**用户偏好(全局记忆)**:
{prefs or "(用户尚未设置偏好)"}

**当前学习深度**:{depth}
{depth_guide}
若用户在对话中表现出深度不合适(嫌太细/太浅),可调 set_depth 自动调整。

**核心工具**:
- add_topic(title, summary, steps):拆解一个主题为子知识点列表,追加到左栏 list。用户学新东西就调它;一个主题拆完可继续拆下一个(多主题并列)。
  - steps:子知识点标题字符串数组(10-20 字),顺序即讲解顺序。数量按深度与复杂度定。返回值含各 step 的 id(形如 topicid-N),调 generate_animation 时用这个 id。
- ask_user(question, options?):向用户提一个澄清问题(歧义、确认拆解方式/粒度时)。会暂停等用户回答。**有候选选项务必传 options**(字符串数组,前端渲染成可点击按钮,用户点击即发送,降低回答成本)。
- read(file_id, offset?, limit?):读用户上传文件片段(带行号)。**文件不要假设内容,用此工具按需读。**
- grep(pattern, file_id?):在文件里正则搜索,返回匹配行+行号。
- generate_animation(step_id):触发某步的**完整讲解生成**(交 subagent 浏览器验证):含动画代码、教学意图、Markdown 讲解(文字+公式)、可调参数。会暂停等生成完。**当用户想学/看某步时调**(如"讲一下第一步""第3步""我想看X"),step_id 用 add_topic 返回的 id。已生成过的步会直接返回不重跑。**调这个等于讲完那一步(动画+讲解都在里头),不要调完又自己再讲一遍**。
- generate_quiz(step_title, question, options, answer, explanation):对某知识点出一道**选择题考察用户是否学懂**。你(主 agent)直接产题:step_title=对应知识点标题;question=题干;options=4 个选项(字符串数组);answer=正确选项下标(0-3);explanation=答案解析。会暂停等用户在右边栏作答,作答后自动判对错并把结果返回给你,你再据此鼓励用户或针对错点补讲。**用户学完某步想自测、或你说"来考你一题"时调**。一次一道题。
- generate_diagram(step_title, diagram_type, code, explanation):用 **mermaid 图**展示知识点(补 manim 之短)。你直接产 mermaid 源码。step_title=标题;diagram_type=类型(flowchart/sequenceDiagram/classDiagram/stateDiagram/mindmap/gantt);code=mermaid 源码(以 graph/flowchart/sequenceDiagram 等开头,**不要包```围栏**);explanation=Markdown 讲解。调用后自动切到图示舞台渲染。**知识点类型选择**:数学/物理/几何/动画演示→generate_animation(manim);流程/结构/分类/关系/状态/时序(生物分类、历史脉络、软件架构、状态机、协议交互、组织结构)→generate_diagram(mermaid)。两者都行时优先选更能帮用户理解的。
- graph_command(instruction):调用**知识图 agent** 操作知识谱系图(DAG,节点是知识点、箭头是前置依赖)。instruction 用自然语言描述要做什么:**还没有图**时传用户的知识点(如"帮我分解线性代数"),图 agent 递归分解+找前置自动建图;**图已存在**时描述怎么改(如"把卷积拆成 定义/计算/性质 三个子节点""去掉傅里叶级数节点""矩阵我会了")。会暂停等图 agent 跑完(几十秒~几分钟),返回图摘要(节点数/知识点/已掌握前置)。**适用于复杂体系**(线性代数/傅里叶变换这种成体系、有先后依赖的),先理清结构再 add_topic。简单单一概念(勾股定理/向量加法)不必分解,直接 add_topic。**调这个前先 `switch_stage("graph")` 切到分解图**,让用户实时看节点逐个出现。
- set_depth(level):调整学习深度("popular"/"understand"/"deep")。
- switch_stage(stage):切换中间舞台:"graph"(知识分解图)或"animation"(动画舞台)。graph_command 跑完切 graph 让用户看图;开始 generate_animation 讲解前切 animation;用户想看结构时也可主动切。

**知识点清单(list)增删查改**:list 是左栏的知识点清单,你可以查/增/删/改其中的步骤:
- search_step(query):按指令搜索某步动画,返回 {step_id, 标题, 动画代码, 讲解}。用户问"某步讲什么""某步代码怎么写的"、或要定位某步时先调它。
- delete_step(step_id):删除某步(连同动画/讲解缓存)。用户说"把这步去掉""删掉X"时调。
- rename_step(step_id, new_title):改某步标题。用户说"这步应该叫X"时调。
- add_step(topic_id, title):往某主题末尾追加一个步骤(暂无动画)。用户说"加个X""漏了X"时调。
- modify_step(step_id, feedback):**根据用户反馈修改某步的动画代码/讲解/标题**。feedback 用自然语言描述要改什么(如"把第三段动画改成红色""讲解里补个例子""标题改成X")。会暂停,把修改任务交给动画 agent(step_agent)在浏览器里改并验证,通过才生效。**你只描述用户要改什么,不要自己改代码、不关心渲染/验证细节。**用户说"改一下某步""这步动画有问题""这步换个颜色"时调。
改动画/讲解/标题一律走 modify_step(交动画 agent),不要自己直接改代码。

**拆解前必须先问用户(重要)**:收到用户要学的知识点后,**不要直接调 add_topic 或 graph_command**。先用 ask_user 问用户确认拆解方式(传 options),再据回答行动。用户回答后再调对应工具。

**文件处理**:用户上传文件后,你只在消息里看到文件名和 file_id,**不是全文**。要了解内容必须调 read/grep。不要凭文件名猜测内容。

**拆解原则**:按这个知识点本身该怎么讲就怎么拆——从学生已有的认知出发,一步步建立到目标,后一步建立在前一步之上。顺序、粒度、是否引入示例/陷阱/拓展都由你按内容定。子知识点间逻辑连续。全程中文。
"""


# ---------- 工具 ----------

def _build_tools(sid: str):
    draft = _DRAFTS[sid]

    @tool
    def add_topic(title: str, summary: str, steps: list[str]) -> str:
        """拆解一个主题为子知识点列表,追加到知识点 list。每次调用加一个主题(可多次,多主题并列)。
        title=主题名;summary=一句话概括;steps=子知识点标题数组(10-20字,顺序即讲解顺序)。"""
        topic_id = _uuid.uuid4().hex[:8]
        topic = {
            "id": topic_id,
            "title": title,
            "summary": summary,
            "steps": [{"id": f"{topic_id}-{i+1}", "title": t} for i, t in enumerate(steps or [])],
        }
        # 写回 session.topics + 草稿
        s = _agent().get_session(sid)
        if s is not None:
            s.setdefault("topics", []).append(topic)
            _agent()._persist_state(sid)
        draft.setdefault("topics", []).append(topic)
        # 立即经 _EMIT side-channel 推 topic_added 事件:下一个 ToolMessage drain 时发给前端,list 马上出现。
        # 否则 add_topic 后紧接 generate_animation 的 interrupt 会提前 return,等到 resume 段结束才发,
        # 用户看到"已放到左边"却要等第一个动画生成完 list 才刷新。
        _EMIT[sid].append({"kind": "topic_added", "payload": topic})
        # 返回各 step 的 id(形如 topicid-N)+ 标题,供主 agent 调 generate_animation(step_id) 时用
        steps_info = "; ".join(f"{st['id']}={st['title']}" for st in topic["steps"])
        return f"已添加主题「{title}」· {len(steps or [])} 步。子知识点 id(调 generate_animation 时传这个 step_id):{steps_info}"

    @tool
    def ask_user(question: str, options: list[str] = None) -> str:
        """向用户提一个澄清问题(如知识点有歧义、需明确意图、确认拆解方式时)。会暂停等用户回答,回答作为返回值。
        一次只问一个明确的问题,不要一次问多个。
        options:可选,给用户几个预设选项(如 ["A. 直接拆学习清单","B. 先跑知识图谱"]),
                 前端会渲染成可点击按钮(点击即发送该选项文本),用户也可自定义输入。能显著降低回答成本,有选项时尽量传。"""
        iv = {"kind": "ask", "question": question}
        if options:
            iv["options"] = list(options)
        result = interrupt(iv)
        # result = 用户回答的文本(点选项即选项文本,自定义即输入文本)
        return f"用户回答:{result}" if result else "用户未回答(跳过)"

    @tool
    def generate_quiz(step_title: str, question: str, options: list[str], answer: int, explanation: str) -> str:
        """对某知识点出一道选择题考察用户是否学懂。会暂停等用户作答,作答后自动判对错并返回结果。
        用户学完某步、或想自测时调。一次出一道题。
        step_title=该题对应的知识点标题;question=题干;options=4 个选项文本(数组);answer=正确选项的下标(0-3);explanation=答案解析(讲为什么对、其他为什么错)。
        前端在右边栏显示题+选项按钮,用户点选项后返回,工具自动对比 answer 判对错。"""
        # answer 是 LLM 传入的选项下标,可能越界或非数字(str/int),钳制到合法范围防 IndexError/ValueError 崩掉 agent turn
        try:
            answer_idx = int(answer)
        except (TypeError, ValueError):
            answer_idx = 0
        answer_idx = max(0, min(answer_idx, len(options) - 1)) if options else 0
        iv = {"kind": "quiz", "step_title": step_title, "question": question,
              "options": list(options), "answer": answer_idx, "explanation": explanation}
        result = interrupt(iv)
        # result = 用户选的选项下标(int)或 {"choice": idx}
        if isinstance(result, dict):
            choice = result.get("choice")
        else:
            choice = result
        try:
            choice = int(choice) if choice is not None else -1
        except (TypeError, ValueError):
            choice = -1
        correct = (choice == answer_idx)
        if choice < 0:
            return f"用户未作答(跳过)。正确答案:{chr(65+answer_idx)}. {options[answer_idx]}"
        if correct:
            return f"用户答对啦!选了 {chr(65+choice)}。解析:{explanation}"
        return f"用户答错。选了 {chr(65+choice)},正确答案是 {chr(65+answer_idx)}. {options[answer_idx]}。解析:{explanation}"

    @tool
    def generate_diagram(step_title: str, diagram_type: str, code: str, explanation: str) -> str:
        """用 mermaid 图展示某知识点(补 manim 之短,适合流程/结构/关系类)。你(主 agent)直接产 mermaid 代码。
        step_title=知识点标题;diagram_type=图类型(flowchart/sequenceDiagram/classDiagram/stateDiagram/mindmap/gantt 等,描述用即可);
        code=mermaid 源码(纯文本,以 graph/flowchart/sequenceDiagram 等开头,不要包```mermaid围栏);
        explanation=Markdown 讲解(配合图说明,可含 $...$ 公式)。
        调用后自动切到 mermaid 舞台并渲染图,前端渲染失败会提示,你可改 code 重调。
        **知识点类型判断**:数学/物理/几何/动画演示类用 generate_animation(manim);流程/结构/分类/关系/状态/时序类(生物分类、历史脉络、软件架构、状态机、协议交互)用本工具。"""
        # 先切舞台,再推 diagram 事件(前端 consume 收到 setDiagram + setView mermaid)
        _EMIT[sid].append({"kind": "stage_switch", "payload": {"stage": "mermaid"}})
        _EMIT[sid].append({"kind": "diagram", "payload": {
            "step_title": step_title, "diagram_type": diagram_type,
            "code": code, "explanation": explanation,
        }})
        return f"已生成 mermaid 图「{step_title}」({diagram_type}),中间舞台已切到图示。前端会渲染,若渲染失败会提示语法错,你可修正 code 后重调本工具。"

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
        """触发某步的完整讲解生成(动画+讲解+公式+参数,交 subagent 浏览器验证)。会暂停等生成完。
        step_id 是 add_topic 返回的子知识点 id(形如 topicid-N)。结果写共享状态 step_status。
        用户想学/看某步时调。调一次等于讲完那步,不要调完又自己再讲。"""
        # 已生成过(缓存命中):不重复跑,直接告知主 agent 该步已就绪
        sc = _agent().get_step_cache(sid, step_id)
        if sc and sc.get("sceneCode"):
            return f"第 {step_id} 步「{sc.get('title','')}」已生成过(动画+讲解就绪),无需重复生成。可直接让用户看,或问是否继续下一步。"
        # 暂停,等视图层跑 subagent 后 resume。interrupt value 传 step_id,视图层据此调 step_agent。
        result = interrupt({"kind": "generate", "step_id": step_id})
        # result 形如 {"ok":true, "step_id":...} 或 {"ok":false, "error":...}
        if isinstance(result, dict) and result.get("ok"):
            return f"第 {step_id} 步讲解(动画+讲解)已生成。"
        err = result.get("error", "未知错误") if isinstance(result, dict) else str(result)
        return f"第 {step_id} 步生成失败:{err}"

    @tool
    def graph_command(instruction: str) -> str:
        """调用知识图 agent 操作知识谱系图(DAG,节点是知识点、箭头是前置依赖)。instruction 用自然语言描述要做什么:
        - **还没有图**时:传用户的知识点(如"帮我分解线性代数"),图 agent 会递归分解并找前置,自动建图。
        - **图已存在**时:描述怎么改图(如"把卷积拆成 定义/计算/性质 三个子节点""去掉傅里叶级数节点"
          "加个拉普拉斯变换节点""特征向量是特征值的前置""矩阵我会了""把X改名为Y")。
        会暂停等图 agent 跑完(几十秒~几分钟),返回图摘要(节点数/知识点/已掌握前置)。**调这个前先 switch_stage("graph")**
        切到分解图,让用户实时看节点逐个出现。适用于复杂体系(成体系、有先后依赖的);简单单一概念不必分解,直接 add_topic。
        拿到摘要后可据此调 add_topic 按依赖顺序拆学习清单。"""
        # 暂停,等视图层跑图 agent 后 resume。interrupt value 传 instruction,视图层据此调 /api/graph_command。
        result = interrupt({"kind": "graph_command", "instruction": instruction})
        # result 形如 {"ok":true, "graph":{question,root_title,snapshot:{nodes,edges}}} 或 {"ok":false,"error":...}
        if isinstance(result, dict) and result.get("ok"):
            graph = result.get("graph") or {}
            # graph 可能是 {question,root_title,snapshot:{nodes,edges}}(session.graph 结构)
            # 或直接 {nodes,edges}(graph 流 graph 事件的 payload)。兼容两种。
            snap = graph.get("snapshot") if "snapshot" in graph else graph
            nodes = (snap or {}).get("nodes", [])
            edges = (snap or {}).get("edges", [])
            node_titles = [n.get("title", "") for n in nodes]
            mastery = [n.get("title") for n in nodes if n.get("mastery")]
            summary = f"知识图现有 {len(nodes)} 节点,{len(edges)} 条前置依赖边。"
            if node_titles:
                summary += f"知识点:{'、'.join(node_titles[:15])}{'…' if len(node_titles) > 15 else ''}。"
            if mastery:
                summary += f"已掌握前置:{'、'.join(mastery[:6])}。"
            summary += " 可据此调 add_topic 按依赖顺序拆学习清单,或继续对话。"
            return summary
        err = result.get("error", "未知错误") if isinstance(result, dict) else str(result)
        return f"图操作失败:{err}"

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

    @tool
    def switch_stage(stage: str) -> str:
        """切换中间舞台展示的内容:"graph"(知识分解图) / "animation"(动画舞台) / "mermaid"(mermaid 图示)。
        - 调 graph_command 跑完分解后,调 switch_stage("graph") 让用户看知识图谱。
        - 要开始逐个讲解(调 generate_animation 生成动画)前,调 switch_stage("animation") 切回动画舞台。
        - 调 generate_diagram 产 mermaid 图后,调 switch_stage("mermaid") 让用户看图示。
        - 用户想看分解图/图示时也可主动切。"""
        if stage not in ("graph", "animation", "mermaid"):
            return f"无效 stage {stage},可选:graph/animation/mermaid"
        _EMIT[sid].append({"kind": "stage_switch", "payload": {"stage": stage}})
        names = {"graph": "知识分解图", "animation": "动画舞台", "mermaid": "mermaid 图示"}
        return f"中间舞台已切换为:{names.get(stage, stage)}"

    # ---------- 知识点清单(list)增删查改 ----------
    # 操作 session.topics([{id,title,summary,steps:[{id,title,...}]}])与 step_cache/step_status。
    # 改动画代码/讲解/标题一律交 modify_step(step_agent 在浏览器验证),主 agent 只描述要改什么。

    @tool
    def search_step(query: str) -> str:
        """按指令搜索某步动画:在知识点清单(list)与已生成内容里匹配 query(标题/讲解/代码),返回最多 3 条
        {step_id, 标题, 动画代码(截断), 讲解(截断)}。用于定位"某步讲什么""某步代码怎么写的""我想改哪一步"。
        没生成动画的步骤返回占位信息。"""
        s = _agent().get_session(sid)
        sc = (s or {}).get("step_cache", {}) or {}
        q = (query or "").strip().lower()
        if not q:
            return "请给个搜索词(query),如'卷积的动画'或'第一步代码'。"
        hits = []
        for t in (s or {}).get("topics", []):
            for st in t.get("steps", []):
                sid_ = str(st.get("id", ""))
                data = sc.get(sid_) or {}
                hay = f"{st.get('title','')} {data.get('explanation','')} {data.get('sceneCode','')}".lower()
                if q in hay:
                    hits.append({"id": sid_, "title": st.get("title", ""),
                                 "code": (data.get("sceneCode") or "")[:600],
                                 "explanation": (data.get("explanation") or "")[:400]})
        if not hits:
            titles = "、".join(f"{st.get('id','')}:{st.get('title','')}"
                               for t in (s or {}).get("topics", []) for st in t.get("steps", []))
            return f"没搜到与「{query}」匹配的步骤。现有步骤:{titles or '(空)'}"
        lines = []
        for h in hits[:3]:
            lines.append(f"- 步骤 {h['id']}「{h['title']}」\n  代码:{h['code'] or '(未生成动画)'}\n  讲解:{h['explanation'] or '(无)'}")
        return "\n".join(lines)

    @tool
    def delete_step(step_id: str) -> str:
        """从知识点清单删除某一步(连同其已生成的动画/讲解缓存)。step_id 形如 topicid-N 或 topicid-SN。
        用于用户说"把这步去掉""删掉X这个知识点"。若删后某主题没剩步骤,整个主题也删。"""
        s = _agent().get_session(sid)
        if s is None:
            return "会话不存在"
        removed = False
        new_topics = []
        for t in s.get("topics", []):
            steps = [st for st in t.get("steps", []) if str(st.get("id", "")) != step_id]
            if len(steps) != len(t.get("steps", [])):
                removed = True
            if steps:
                new_topics.append({**t, "steps": steps})
        if not removed:
            return f"没找到步骤 {step_id}。现有步骤 id 见 search_step。"
        s["topics"] = new_topics
        s.get("step_cache", {}).pop(str(step_id), None)
        s.get("step_status", {}).pop(str(step_id), None)
        _agent()._persist_state(sid)
        return f"已删除步骤 {step_id}。"

    @tool
    def rename_step(step_id: str, new_title: str) -> str:
        """把知识点清单里某步的标题改为 new_title。step_id 形如 topicid-N。用于用户说"这步应该叫X""名字不对"时。"""
        s = _agent().get_session(sid)
        if s is None:
            return "会话不存在"
        for t in s.get("topics", []):
            for st in t.get("steps", []):
                if str(st.get("id", "")) == step_id:
                    old = st.get("title", "")
                    st["title"] = new_title
                    sc = s.get("step_cache", {}).get(str(step_id))
                    if sc:
                        sc["title"] = new_title
                    _agent()._persist_state(sid)
                    return f"已把步骤 {step_id}「{old}」改名为「{new_title}」。"
        return f"没找到步骤 {step_id}。"

    @tool
    def add_step(topic_id: str, title: str) -> str:
        """往知识点清单的某个主题(topic_id)末尾追加一个步骤。topic_id 是 add_topic 返回的主题 id(形如 8 位 hex)。
        用于用户说"加个X""漏了X"。新步骤暂无动画,用户可后续点它触发生成。"""
        s = _agent().get_session(sid)
        if s is None:
            return "会话不存在"
        for t in s.get("topics", []):
            if str(t.get("id", "")) == topic_id:
                steps = t.get("steps", [])
                max_n = 0
                for st in steps:
                    sid_ = str(st.get("id", ""))
                    if sid_.startswith(f"{topic_id}-"):
                        rest = sid_[len(topic_id) + 1:]
                        if rest.isdigit():
                            max_n = max(max_n, int(rest))
                new_id = f"{topic_id}-{max_n + 1}"
                steps.append({"id": new_id, "title": title})
                _agent()._persist_state(sid)
                return f"已给主题「{t.get('title','')}」追加步骤 {new_id}「{title}」。"
        return f"没找到主题 {topic_id}。可用 topic_id 见 add_topic 返回值。"

    @tool
    def modify_step(step_id: str, feedback: str) -> str:
        """根据用户反馈修改某步动画(动画代码 / 讲解 / 标题)。step_id 形如 topicid-N。
        feedback 用自然语言描述要改什么(如"把第三段动画改成红色""字体大一点""讲解里补个例子""标题改成X")。
        会暂停,把修改任务交给动画 agent(step_agent)在浏览器里改并验证,通过才生效。
        **你只描述用户要改什么,不要自己改代码、不关心渲染/验证细节。** 改完返回结果。"""
        sc = _agent().get_step_cache(sid, step_id)
        if not sc or not sc.get("sceneCode"):
            return f"第 {step_id} 步还没有动画可改(未生成)。先调 generate_animation 生成,或确认 step_id 对不对。"
        result = interrupt({"kind": "modify", "step_id": step_id, "feedback": feedback})
        if isinstance(result, dict) and result.get("ok"):
            return f"第 {step_id} 步已按反馈修改完成(动画已通过浏览器验证)。"
        err = result.get("error", "未知错误") if isinstance(result, dict) else str(result)
        return f"第 {step_id} 步修改失败:{err}"

    return [add_topic, ask_user, read, grep, generate_animation, generate_quiz, generate_diagram,
            graph_command, set_depth, switch_stage,
            search_step, delete_step, rename_step, add_step, modify_step]


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


def _has_orphan_tool_call(messages) -> bool:
    """检测消息历史里是否有"孤儿 tool_call":AIMessage 带 tool_calls 但其后没有对应 ToolMessage。

    interrupt() 工具(ask_user/generate_quiz/animation/decompose)暂停后若用户直接发新消息(没 resume),
    会留下这种孤儿 tool_call。此时 langgraph 再注入新 user 消息会抛
    INVALID_CHAT_HISTORY("Found AIMessages with tool_calls that do not have a corresponding ToolMessage")。
    返回 True 表示存在,主 agent 应先提示用户完成待办,而非崩掉。"""
    for i, m in enumerate(messages):
        if type(m).__name__ == "AIMessage" and getattr(m, "tool_calls", None):
            ids = {tc.get("id") for tc in m.tool_calls}
            has_tm = any(getattr(x, "tool_call_id", None) in ids
                         for x in messages[i + 1:] if type(x).__name__ == "ToolMessage")
            if not has_tm:
                return True
    return False


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
    # 清掉上个 run 残留的 _EMIT 事件(上个 run 若在工具 append 后异常/被 supersede 才可能在该 run 开头被误 drain → 串台误触发 stage_switch/graph)。
    # 本 run 全新开始,不应带旧事件。
    _EMIT.pop(sid, None)

    thread_id = f"main#{sid}"
    agent_obj = _build_agent(cfg, sid, cur_depth)
    config = {"configurable": {"thread_id": thread_id}}
    # 用户可自由忽视任何问题:若上一回合有孤儿 tool_call(ask_user/生成题/动画/分解用 interrupt()
    # 暂停后,用户没 resume 而是切走/直接发了条新消息),不再报错挡住,而是自动跳过该 interrupt
    # 并注入新消息。空串 resume 让被 interrupt 的工具安全收尾(ask_user→"用户未回答(跳过)"、
    # quiz→"未作答(跳过)"、generate/decompose→返回失败串),Command.update 把新消息追加进对话,
    # agent 下一轮就能看到并正常回应,且不抛 INVALID_CHAT_HISTORY。
    # (机制已用独立脚本 + 真实 langgraph 验证:孤儿 tool_call 被 ToolMessage 闭环、新消息进历史、agent 正常回应)
    skip_orphan = False
    try:
        _st = agent_obj.get_state(config)
        _hist = ((_st.values or {}).get("messages") or []) if _st else []
        skip_orphan = _has_orphan_tool_call(_hist)
    except Exception:
        pass  # get_state 失败不阻塞主流程
    agent_evt_id = _new_id(sid)
    yield {"kind": "agent_start", "id": agent_evt_id, "parentId": None, "agent": "main",
           "stepId": None, "payload": {"title": "主 agent · 对话"}}

    tcid_to_evt: dict = {}
    current_parent = agent_evt_id
    interrupt_value = None
    # 流式输出:用 messages 模式拿 LLM token 增量(纯文本回复边产边推),updates 模式拿 tool_call/interrupt。
    # 多 stream_mode 时 chunk 是 (mode, data) 元组。messages data 是 (AIMessageChunk, metadata)。
    streaming_msg_id = None  # 当前正在流式的 message id(同 id 增量追加,前端不重复建项)
    try:
        # 孤儿 interrupt:Command(resume="", update={messages:[新消息]}) 一次完成"跳过旧问题 + 注入新消息";
        # 正常情况直接注入新消息
        agent_input = (Command(resume="", update={"messages": [{"role": "user", "content": user_text}]})
                       if skip_orphan else {"messages": [{"role": "user", "content": user_text}]})
        for mode, data in agent_obj.stream(
            agent_input,
            config, stream_mode=["messages", "updates"],
        ):
            if mode == "messages":
                # LLM token 增量:只推纯文本 content,工具调用 chunk 跳过(updates 模式拿完整 tool_call)
                msg_chunk, _meta = data if isinstance(data, tuple) and len(data) == 2 else (data, {})
                # 只处理 AIMessageChunk(跳过 HumanMessage 等);且无 tool_call_chunks 的才推文本
                if type(msg_chunk).__name__ != "AIMessageChunk":
                    continue
                if getattr(msg_chunk, "tool_call_chunks", None):
                    continue  # 工具调用增量,updates 模式拿完整 tool_call,这里跳过
                delta = str(getattr(msg_chunk, "content", "") or "")
                if not delta:
                    continue
                if streaming_msg_id is None:
                    streaming_msg_id = _new_id(sid)
                yield {"kind": "message_delta", "id": streaming_msg_id, "parentId": None,
                       "agent": "main", "stepId": None,
                       "payload": {"role": "orchestrator", "text": delta}}
                continue
            # mode == "updates"
            for node, state in data.items():
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
                        # 有工具调用:文本(若有)已由 messages 模式流式推过,这里只发 tool_call
                        # 重置流式 id:下一轮 LLM 文本用新 id(避免和工具调用前的文本混)
                        streaming_msg_id = None
                        for tc in m.tool_calls:
                            eid = _new_id(sid)
                            tcid_to_evt[tc.get("id")] = eid
                            yield {"kind": "tool_call", "id": eid, "parentId": current_parent,
                                   "agent": "main", "stepId": None,
                                   "payload": {"name": tc.get("name"), "args": tc.get("args", {})}}
                    elif nm == "AIMessage":
                        # 纯文本回复:已由 messages 模式流式推过,这里不重发。仅重置流式 id
                        streaming_msg_id = None
                    elif nm == "ToolMessage":
                        # 先 drain _EMIT:把工具执行期间产生的事件(如 switch_stage 的 stage_switch)挂到当前 tool_call 下
                        while _EMIT[sid]:
                            ev = _EMIT[sid].pop(0)
                            yield {"kind": ev["kind"], "id": _new_id(sid), "parentId": current_parent,
                                   "agent": "main", "stepId": None, "payload": ev["payload"]}
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
            ask_payload = {"question": interrupt_value.get("question", "")}
            if interrupt_value.get("options"):
                ask_payload["options"] = interrupt_value.get("options")
            yield {"kind": "ask", "id": _new_id(sid), "parentId": None, "agent": "main",
                   "stepId": None, "payload": ask_payload}
            return
        if k == "generate":
            yield {"kind": "animation_request", "id": _new_id(sid), "parentId": agent_evt_id,
                   "agent": "main", "stepId": interrupt_value.get("step_id"),
                   "payload": {"step_id": interrupt_value.get("step_id", "")}}
            return
        if k == "graph_command":
            yield {"kind": "graph_command_request", "id": _new_id(sid), "parentId": agent_evt_id,
                   "agent": "main", "stepId": None,
                   "payload": {"instruction": interrupt_value.get("instruction", "")}}
            return
        if k == "modify":
            yield {"kind": "modify_request", "id": _new_id(sid), "parentId": agent_evt_id,
                   "agent": "main", "stepId": interrupt_value.get("step_id"),
                   "payload": {"step_id": interrupt_value.get("step_id", ""),
                               "feedback": interrupt_value.get("feedback", "")}}
            return
        if k == "quiz":
            yield {"kind": "quiz", "id": _new_id(sid), "parentId": agent_evt_id,
                   "agent": "main", "stepId": None,
                   "payload": {"step_title": interrupt_value.get("step_title", ""),
                               "question": interrupt_value.get("question", ""),
                               "options": interrupt_value.get("options", []),
                               "answer": interrupt_value.get("answer", 0),
                               "explanation": interrupt_value.get("explanation", "")}}
            return
        if k == "quiz":
            yield {"kind": "quiz", "id": _new_id(sid), "parentId": agent_evt_id,
                   "agent": "main", "stepId": None,
                   "payload": {"step_title": interrupt_value.get("step_title", ""),
                               "question": interrupt_value.get("question", ""),
                               "options": interrupt_value.get("options", []),
                               "answer": interrupt_value.get("answer", 0),
                               "explanation": interrupt_value.get("explanation", "")}}
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
    streaming_msg_id = None
    try:
        for mode, data in agent_obj.stream(Command(resume=resume_val), config, stream_mode=["messages", "updates"]):
            if mode == "messages":
                msg_chunk, _meta = data if isinstance(data, tuple) and len(data) == 2 else (data, {})
                if type(msg_chunk).__name__ != "AIMessageChunk":
                    continue
                if getattr(msg_chunk, "tool_call_chunks", None):
                    continue
                delta = str(getattr(msg_chunk, "content", "") or "")
                if not delta:
                    continue
                if streaming_msg_id is None:
                    streaming_msg_id = _new_id(sid)
                yield {"kind": "message_delta", "id": streaming_msg_id, "parentId": None,
                       "agent": "main", "stepId": None,
                       "payload": {"role": "orchestrator", "text": delta}}
                continue
            for node, state in data.items():
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
                        streaming_msg_id = None
                        for tc in m.tool_calls:
                            eid = _new_id(sid)
                            tcid_to_evt[tc.get("id")] = eid
                            yield {"kind": "tool_call", "id": eid, "parentId": current_parent,
                                   "agent": "main", "stepId": None,
                                   "payload": {"name": tc.get("name"), "args": tc.get("args", {})}}
                    elif nm == "AIMessage":
                        streaming_msg_id = None  # 已由 messages 模式流式推过
                    elif nm == "ToolMessage":
                        while _EMIT[sid]:
                            ev = _EMIT[sid].pop(0)
                            yield {"kind": ev["kind"], "id": _new_id(sid), "parentId": current_parent,
                                   "agent": "main", "stepId": None, "payload": ev["payload"]}
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
            ask_payload = {"question": interrupt_value.get("question", "")}
            if interrupt_value.get("options"):
                ask_payload["options"] = interrupt_value.get("options")
            yield {"kind": "ask", "id": _new_id(sid), "parentId": None, "agent": "main",
                   "stepId": None, "payload": ask_payload}
            return
        if k == "generate":
            yield {"kind": "animation_request", "id": _new_id(sid), "parentId": agent_evt_id,
                   "agent": "main", "stepId": interrupt_value.get("step_id"),
                   "payload": {"step_id": interrupt_value.get("step_id", "")}}
            return
        if k == "graph_command":
            yield {"kind": "graph_command_request", "id": _new_id(sid), "parentId": agent_evt_id,
                   "agent": "main", "stepId": None,
                   "payload": {"instruction": interrupt_value.get("instruction", "")}}
            return
        if k == "modify":
            yield {"kind": "modify_request", "id": _new_id(sid), "parentId": agent_evt_id,
                   "agent": "main", "stepId": interrupt_value.get("step_id"),
                   "payload": {"step_id": interrupt_value.get("step_id", ""),
                               "feedback": interrupt_value.get("feedback", "")}}
            return
        if k == "quiz":
            yield {"kind": "quiz", "id": _new_id(sid), "parentId": agent_evt_id,
                   "agent": "main", "stepId": None,
                   "payload": {"step_title": interrupt_value.get("step_title", ""),
                               "question": interrupt_value.get("question", ""),
                               "options": interrupt_value.get("options", []),
                               "answer": interrupt_value.get("answer", 0),
                               "explanation": interrupt_value.get("explanation", "")}}
            return

    for topic in _DRAFTS[sid].get("topics", []):
        yield {"kind": "topic_added", "id": _new_id(sid), "parentId": agent_evt_id, "agent": "main",
               "stepId": None, "payload": topic}
    yield {"kind": "done", "id": _new_id(sid), "parentId": agent_evt_id, "agent": "main",
           "stepId": None, "payload": {"message": "本轮对话结束"}}
