import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import {
  nextStep, prevStep, gotoStep,
  postRenderResult, getTrace,
  chat, chatAnswer, chatStop, uploadForSession, decompose,
  listSessions, newSession, getSession, exportSession, importSessionFromFile,
  exportSessionMarkdown,
  deleteSession, renameSession,
  explainStep,
  type ChatEvent, type AgentRole, type Topic,
} from "../data/llmClient";
import { useApp, type StepStatus } from "../store";
import {
  Menu, Plus, Paperclip, Download, Upload, Wrench, Bot,
  Code2, Play, Check, X, Loader2, Sparkles, FileText, Trash2,
} from "lucide-react";

interface RenderedItem { key: string; event: ChatEvent; collapsed: boolean; }

const COLLAPSED_BY_DEFAULT = new Set(["tool_call", "tool_result", "render_request", "render_result"]);

function makeItem(ev: ChatEvent, key: string): RenderedItem {
  // agent_start:只 subagent 的默认折叠(藏其下工具调用过程);主 agent 的 agent_start 不折叠(子节点正常显)
  let collapsed = COLLAPSED_BY_DEFAULT.has(ev.kind);
  if (ev.kind === "agent_start") {
    collapsed = ev.agent !== "main";
  }
  return { key, event: ev, collapsed };
}

const roleStyle: Record<AgentRole, { name: string; color: string; dot: string; icon: string }> = {
  user:        { name: "你",        color: "#9aa6b8", dot: "#4a5365", icon: "·" },
  orchestrator:{ name: "主 Agent",  color: "#5fb0ff", dot: "#4a9eff", icon: "◆" },
  animator:    { name: "Animator",  color: "#9aa6b8", dot: "#6b7686", icon: "▶" },
  verifier:    { name: "Verifier",  color: "#9aa6b8", dot: "#6b7686", icon: "✓" },
  narrator:    { name: "Narrator",  color: "#9aa6b8", dot: "#6b7686", icon: "✎" },
};

export default function ChatPanel() {
  const [items, setItems] = useState<RenderedItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // 打断:每次生成一个 AbortController;点"■ 停止"→ abort fetch + 通知后端停 run。
  const abortRef = useRef<AbortController | null>(null);
  const [pendingAsk, setPendingAsk] = useState<{ question: string; options?: string[] } | null>(null); // 主 agent 问的问题(+可选预设选项);非 null 时发送=回答该问题
  const [fileName, setFileName] = useState<string | null>(null);
  const [, setFileText] = useState<string | null>(null); // fileText 值未读(仅 setter 兼容旧接口),取值弃用
  const [showSessions, setShowSessions] = useState(false);
  const [sessionQuery, setSessionQuery] = useState("");
  // 对话栏右键菜单(导出 JSON/笔记、导入、删除当前会话):坐标或 null
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  // 右键菜单:点外部 / Escape 关闭
  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCtxMenu(null); };
    const onScroll = () => setCtxMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [ctxMenu]);

  const openCtxMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // session 隔离:每次 consume 抓一个 runId,切换 session 时 bump,旧 consume 检测到 runId 变了就停止写 state
  const consumeRunIdRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);

  const {
    lesson, setLesson, currentStep, setCurrentStep,
    stepStatus, markStepActive, markStepDone,
    sessionId, setSessionId, setSceneCode, mergeStepParams, updateStepContent, updateTopicStep,
    sessionList, setSessionList, switchSession, resetToEmpty,
    navRequest,
    requestVerify, verifyResultHandler,
    depth, setDepth, topics, addTopic, setTopics, decomposeGraph, setDecomposeGraph, setView,
    setPendingQuiz, setQuizResult,
    pendingResume, setPendingResume,
    setDiagram,
    pendingFiles, addPendingFile, removePendingFile, clearPendingFiles,
  } = useApp();
  // 同步 sessionId 到 ref,供 consume/handleEvent 异步循环里取最新值(避免闭包陈旧)
  sessionIdRef.current = sessionId;
  // decomposeGraph ref:主 agent 图编辑工具推 graph 事件时,question/root_title 从最新值继承(避免闭包陈旧)
  const decomposeGraphRef = useRef(decomposeGraph);
  decomposeGraphRef.current = decomposeGraph;

  useEffect(() => {
    refreshSessions();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items]);

  // 键盘左右箭头切换步骤
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!sessionId || loading) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
      if (e.key === "ArrowRight") { e.preventDefault(); handleNext(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); handlePrev(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionId, loading, currentStep, lesson]);

  // 舞台栏的"上一步/下一步"按钮通过 store.navRequest 触发,这里监听执行
  useEffect(() => {
    if (!navRequest) return;
    if (!sessionId || loading) return;
    if (navRequest.target === "next") handleNext();
    else if (navRequest.target === "prev") handlePrev();
    else handleGoto(navRequest.target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRequest?.nonce]);

  // 右边栏考题作答(等非 ChatPanel 发起的 resume)经 store.pendingResume 触发,这里 consume chatAnswer
  // (必须走 ChatPanel consume,主 agent 对作答的反馈才进对话栏)
  useEffect(() => {
    if (!pendingResume || !sessionIdRef.current) return;
    const sid = sessionIdRef.current;
    consumeRunIdRef.current++;
    const myRun = consumeRunIdRef.current;
    (async () => {
      try {
        const gen = pendingResume.result !== undefined
          ? chatAnswer(sid, "", pendingResume.result)
          : chatAnswer(sid, pendingResume.answer || "");
        await consume(gen);
      } finally {
        if (consumeRunIdRef.current === myRun) setPendingResume(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingResume]);

  async function refreshSessions() {
    try { setSessionList(await listSessions()); } catch { /* 忽略 */ }
  }

  async function handleUpload(f: File) {
    try {
      setLoading(true);
      // 新流程:需要 session 才能存文件。无 session 先建一个空 session。
      let sid = sessionIdRef.current;
      if (!sid) {
        sid = await newSession();
        setSessionId(sid);
        sessionIdRef.current = sid;
      }
      const meta = await uploadForSession(sid, f);
      addPendingFile({ file_id: meta.file_id, name: meta.name });
    } catch (e: any) {
      setItems((prev) => [...prev, makeItem({ kind: "error", message: e.message }, `e-${Date.now()}`)]);
    } finally {
      setLoading(false);
    }
  }

  async function consume(stream: AsyncGenerator<ChatEvent>, opts?: { isUpdate?: boolean }) {
    const myRun = consumeRunIdRef.current;
    let key = Date.now();
    for await (const ev of stream) {
      // session 已切换:旧 consume 的事件作废,不再写 state(防止串台到新 session)
      if (consumeRunIdRef.current !== myRun) return;
      // explain 事件:若该 step 已有消息则替换(不重复 append),其它事件照常 append
      if (ev.kind === "explain") {
        setItems((prev) => {
          const idx = prev.findIndex((x) => x.event.kind === "explain" && (x.event as any).stepId === ev.stepId);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], event: ev };
            return copy;
          }
          return [...prev, makeItem(ev, String(key++))];
        });
      } else if (ev.kind === "message_delta") {
        // 流式增量:找同 id 的 message item 追加 text;无则新建一条 message(用该 id,后续增量继续追加)
        setItems((prev) => {
          const idx = prev.findIndex((x) => x.event.id === ev.id && x.event.kind === "message");
          if (idx >= 0) {
            const copy = [...prev];
            const old = copy[idx].event as any;
            copy[idx] = { ...copy[idx], event: { ...old, text: (old.text || "") + ev.text } };
            return copy;
          }
          // 首个增量:建成完整 message 事件(带 id,后续增量按 id 找到它)
          return [...prev, makeItem({ kind: "message", id: ev.id, role: ev.role, text: ev.text, ts: Date.now() } as any, String(key++))];
        });
      } else {
        setItems((prev) => [...prev, makeItem(ev, String(key++))]);
      }
      if (ev.kind === "session") { setSessionId(ev.sessionId); sessionIdRef.current = ev.sessionId; }
      if (ev.kind === "plan") {
        setLesson({ title: ev.title, summary: ev.summary, params: ev.params, steps: ev.steps } as any);
        if (!opts?.isUpdate) setItems((p) => p.filter((x) => x.event.kind !== "message" || x.event.role !== "orchestrator" || !x.event.text.includes("正在分析")));
      }
      if (ev.kind === "topic_added") {
        addTopic(ev.topic);
      }
      if (ev.kind === "stage_switch") {
        // 主 agent 切换中间舞台:graph=分解图,animation=动画,mermaid=图示
        const st = (ev as any).stage;
        setView(st === "graph" ? "graph" : st === "mermaid" ? "mermaid" : "animation");
      }
      if (ev.kind === "graph") {
        // 主 agent 图编辑工具(split_graph_node/remove_graph_node/...)改图后推的快照:刷新分解图画布(不进对话栏)
        const snap = (ev as any).payload || (ev as any).snapshot;
        if (snap) {
          const prev = decomposeGraphRef.current;
          setDecomposeGraph({
            question: prev?.question || "",
            root_title: prev?.root_title || "",
            snapshot: snap,
          });
        }
      }
      if (ev.kind === "quiz") {
        // 主 agent 出的选择题:存 store.pendingQuiz,右边栏 ExplainPanel 显示题+选项。清空旧结果。
        setPendingQuiz({
          step_title: (ev as any).step_title || "",
          question: (ev as any).question || "",
          options: (ev as any).options || [],
          answer: (ev as any).answer ?? 0,
          explanation: (ev as any).explanation || "",
        });
        setQuizResult(null);
      }
      if (ev.kind === "diagram") {
        // 主 agent 产的 mermaid 图:存 store.diagram,中间舞台 MermaidPanel 渲染(stage_switch 已切 mermaid 舞台)
        setDiagram({
          step_title: (ev as any).step_title || "",
          diagram_type: (ev as any).diagram_type || "",
          code: (ev as any).code || "",
          explanation: (ev as any).explanation || "",
        });
      }
      if (ev.kind === "ask") {
        // 主 agent 问用户:记下问题(+可选预设选项),发送按钮变为"回答"(answerAsk)
        setPendingAsk({ question: ev.question, options: (ev as any).options });
      }
      if (ev.kind === "explain") {
        setCurrentStep(ev.stepId as any);
        markStepActive(ev.stepId as any);
        setSceneCode(ev.sceneCode);
        if (ev.params) mergeStepParams(ev.params);
        const content = {
          title: ev.title, narration: ev.narration, formula: ev.formula, explanation: (ev as any).explanation,
          intent: ev.intent, paramsUsed: ev.paramsUsed, params: (ev as any).params,
        };
        // 字符串 stepId(新 topic 流程)写 topics;数字 stepId(旧 lesson)写 lesson.steps
        if (typeof ev.stepId === "string") updateTopicStep(ev.stepId, content);
        else updateStepContent(ev.stepId, content);
      }
      if (ev.kind === "render_request") {
        // 浏览器在环验证:让 StagePanel 跑这段 code,拿结果(含可选最后一帧 frame)回传后端,继续 consume 回传流
        // 先切回动画舞台,保证 StagePanel 挂载消费 verifyRequest(否则 view=graph/mermaid 时 Promise 永不 resolve → 死锁)
        setView("animation");
        const ok_err_frame: { ok: boolean; error: string; frame: string } = await new Promise((resolve) => {
          verifyResultHandler.current = (ok, error, frame) => resolve({ ok, error, frame });
          requestVerify(ev.stepId, ev.code);
        });
        if (consumeRunIdRef.current !== myRun) return;
        const subStream = postRenderResult(sessionIdRef.current || "", ev.stepId, ok_err_frame.ok, ok_err_frame.error, ok_err_frame.frame);
        // 递归 consume 回传流:内联消费(不再走外层 for await,避免嵌套)
        for await (const sub of subStream) {
          if (consumeRunIdRef.current !== myRun) return;
          await handleEvent(sub, myRun);
        }
      }
      if (ev.kind === "decompose_request") {
        // 主 agent 要分解知识图谱:调 /api/decompose 跑分解 agent。每个 graph 事件实时更新分解图(用户看到节点逐个出现),
        // 跑完收最后一个 graph 快照,再 chatAnswer resume
        const sid = sessionIdRef.current || "";
        let graph: any = null, ok = false, errMsg = "";
        try {
          for await (const dev of decompose(sid, ev.question)) {
            if (consumeRunIdRef.current !== myRun) return;
            if (dev?.kind === "graph") {
              graph = dev?.payload;  // 保留最后一个 graph 快照
              // 实时更新 store.decomposeGraph:GraphApp effect 监听变化,每次 split 末尾重建画布(节点逐步增加)
              setDecomposeGraph({ question: ev.question, root_title: `知识分解 · ${ev.question}`, snapshot: graph });
            }
            if (dev?.kind === "error") errMsg = dev?.message || dev?.payload?.message || "";
          }
          ok = !!graph;
        } catch (e: any) { errMsg = e.message; }
        if (consumeRunIdRef.current !== myRun) return;
        // resume 主 agent:传 result={ok, graph, error?}
        const subStream = chatAnswer(sid, "", { ok, graph: ok ? graph : null, error: errMsg });
        for await (const sub of subStream) {
          if (consumeRunIdRef.current !== myRun) return;
          await handleEvent(sub, myRun);  // resume 后可能再来 ask/decompose_request/topic_added
        }
      }
      if (ev.kind === "animation_request") {
        // 主 agent 要生成某步动画:调 /api/explain 跑 step subagent(浏览器在环),跑完 resume 主 agent 传 {ok, step_id}
        const sid = sessionIdRef.current || "";
        const stepId = (ev as any).step_id || ev.stepId || "";
        // 先把右侧切到这一步(该步已在 topics 里有标题占位),否则讲解要等 explain 事件(动画在环验证通过后)才出现
        if (stepId) setCurrentStep(stepId as any);
        let ok = false, errMsg = "";
        try {
          for await (const sev of explainStep(sid, stepId)) {
            if (consumeRunIdRef.current !== myRun) return;
            // render_request 走 handleEvent(浏览器在环验证 + postRenderResult 递归);explain 写 store;error 记录
            await handleEvent(sev, myRun);
            if (sev.kind === "explain") ok = true;
            if (sev.kind === "error") errMsg = sev.message || "";
          }
          // 流正常结束且无 error → 视为成功(explain 可能在 handleEvent 递归的 postRenderResult 流里,外层 sev 检测不到)
          if (!errMsg) ok = true;
        } catch (e: any) { errMsg = e.message; }
        if (consumeRunIdRef.current !== myRun) return;
        // resume 主 agent:传 result={ok, step_id, error?}
        const subStream = chatAnswer(sid, "", { ok, step_id: stepId, error: errMsg });
        for await (const sub of subStream) {
          if (consumeRunIdRef.current !== myRun) return;
          await handleEvent(sub, myRun);  // resume 后可能再来 ask/animation_request/topic_added
        }
      }
    }
    refreshSessions();
  }

  // 处理单个事件(供 render_request 递归消费复用):落盘 explain/plan/session/error,render_request 递归验证
  // myRun:外层 consume 的 runId,递归中切会话时据此中断,防止回传流写到新会话(串台)
  async function handleEvent(ev: ChatEvent, myRun: number) {
    // 落盘 explain 到 store;其他事件也追加到对话树
    if (ev.kind === "explain") {
      setItems((prev) => {
        const idx = prev.findIndex((x) => x.event.kind === "explain" && (x.event as any).stepId === ev.stepId);
        if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...copy[idx], event: ev }; return copy; }
        return [...prev, makeItem(ev, `e-${Date.now()}`)];
      });
      setCurrentStep(ev.stepId as any);
      markStepActive(ev.stepId as any);
      setSceneCode(ev.sceneCode);
      if (ev.params) mergeStepParams(ev.params);
      const content = { title: ev.title, narration: ev.narration, formula: ev.formula, explanation: (ev as any).explanation, intent: ev.intent, paramsUsed: ev.paramsUsed, params: (ev as any).params, sceneCode: ev.sceneCode };
      if (typeof ev.stepId === "string") updateTopicStep(ev.stepId, content);
      else updateStepContent(ev.stepId, content);
    } else if (ev.kind === "render_request") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
      // 必须先切回动画舞台:StagePanel 挂载才有 verifyRequest 消费端;view=graph/mermaid 时无人 resolve → 永久"生成中"死锁
      setView("animation");
      const ok_err_frame: { ok: boolean; error: string; frame: string } = await new Promise((resolve) => {
        verifyResultHandler.current = (ok, error, frame) => resolve({ ok, error, frame });
        requestVerify(ev.stepId, ev.code);
      });
      if (consumeRunIdRef.current !== myRun) return;
      const subStream = postRenderResult(sessionIdRef.current || "", ev.stepId, ok_err_frame.ok, ok_err_frame.error, ok_err_frame.frame);
      for await (const sub of subStream) {
        if (consumeRunIdRef.current !== myRun) return;
        await handleEvent(sub, myRun);
      }
    } else if (ev.kind === "decompose_request") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
      const sid = sessionIdRef.current || "";
      let graph: any = null, ok = false, errMsg = "";
      try {
        for await (const dev of decompose(sid, ev.question)) {
          if (consumeRunIdRef.current !== myRun) return;
          if (dev?.kind === "graph") {
            graph = dev?.payload;
            setDecomposeGraph({ question: ev.question, root_title: `知识分解 · ${ev.question}`, snapshot: graph });  // 实时更新
          }
          if (dev?.kind === "error") errMsg = dev?.message || dev?.payload?.message || "";
        }
        ok = !!graph;
      } catch (e: any) { errMsg = e.message; }
      if (consumeRunIdRef.current !== myRun) return;
      const subStream = chatAnswer(sid, "", { ok, graph: ok ? graph : null, error: errMsg });
      for await (const sub of subStream) {
        if (consumeRunIdRef.current !== myRun) return;
        await handleEvent(sub, myRun);
      }
    } else if (ev.kind === "animation_request") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
      const sid = sessionIdRef.current || "";
      const stepId = (ev as any).step_id || ev.stepId || "";
      if (stepId) setCurrentStep(stepId as any); // 先切右侧到该步(标题占位),等 explain 填讲解
      let ok = false, errMsg = "";
      try {
        for await (const sev of explainStep(sid, stepId)) {
          if (consumeRunIdRef.current !== myRun) return;
          await handleEvent(sev, myRun);
          if (sev.kind === "explain") ok = true;
          if (sev.kind === "error") errMsg = sev.message || "";
        }
        if (!errMsg) ok = true;  // 流正常结束且无 error → 成功(explain 可能在递归流里,外层检测不到)
      } catch (e: any) { errMsg = e.message; }
      if (consumeRunIdRef.current !== myRun) return;
      const subStream = chatAnswer(sid, "", { ok, step_id: stepId, error: errMsg });
      for await (const sub of subStream) {
        if (consumeRunIdRef.current !== myRun) return;
        await handleEvent(sub, myRun);
      }
    } else if (ev.kind === "error") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
    } else if (ev.kind === "agent_start" || ev.kind === "tool_call" || ev.kind === "tool_result" || ev.kind === "render_result") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
    } else if (ev.kind === "topic_added") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
      addTopic(ev.topic);
    } else if (ev.kind === "stage_switch") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
      const st = (ev as any).stage;
      setView(st === "graph" ? "graph" : st === "mermaid" ? "mermaid" : "animation");
    } else if (ev.kind === "ask") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
      setPendingAsk({ question: ev.question, options: (ev as any).options });
    } else if (ev.kind === "done" || ev.kind === "plan" || ev.kind === "step-start") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
    }
  }

  async function submit() {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setLoading(true);
    setItems((prev) => [...prev, makeItem({ kind: "message", role: "user", text: q, ts: Date.now() } as ChatEvent, `u-${Date.now()}`)]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // 若有 pendingAsk(主 agent 问了问题),发送=回答该问题;否则正常对话
      if (pendingAsk) {
        setPendingAsk(null);
        await consume(chatAnswer(sessionIdRef.current || "", q, null, ac.signal));
      } else {
        const fileIds = pendingFiles.map((f) => f.file_id);
        clearPendingFiles();
        await consume(chat(sessionIdRef.current || "", q, depth, fileIds, ac.signal));
      }
    } catch (e: any) {
      // AbortError 已被 llmClient 转成 error 事件(不是 throw);这里兜底
      if (ac.signal.aborted) return;
      throw e;
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setLoading(false);
    }
  }

  // 打断当前 LLM 生成:abort fetch(本地立即停)+ 通知后端停 run(停推/省 token)。
  function stopGeneration() {
    abortRef.current?.abort();
    abortRef.current = null;
    consumeRunIdRef.current++; // 使当前 consume 的后续事件作废(防串台残留)
    setLoading(false);
    const sid = sessionIdRef.current;
    if (sid) void chatStop(sid);
    setItems((prev) => [...prev, makeItem({ kind: "message", role: "orchestrator", text: "⛔ 已打断生成。", ts: Date.now() } as ChatEvent, `s-${Date.now()}`)]);
  }

  // 点预设选项按钮:直接用选项文本回答主 agent(不经输入框),点击即发送
  async function answerWithOption(text: string) {
    if (loading || !pendingAsk) return;
    setLoading(true);
    setItems((prev) => [...prev, makeItem({ kind: "message", role: "user", text, ts: Date.now() } as ChatEvent, `u-${Date.now()}`)]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      setPendingAsk(null);
      await consume(chatAnswer(sessionIdRef.current || "", text, null, ac.signal));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setLoading(false);
    }
  }

  async function handleNext() {
    if (!sessionId || loading) return;
    const nxt = currentStep + 1;
    if (nxt > lesson.steps.length) return;
    setLoading(true);
    markStepDone(currentStep);
    try { await consume(nextStep(sessionId)); } finally { setLoading(false); }
  }

  async function handlePrev() {
    if (!sessionId || loading || currentStep <= 1) return;
    setLoading(true);
    try { await consume(prevStep(sessionId)); } finally { setLoading(false); }
  }

  async function handleGoto(stepId: number) {
    if (!sessionId || loading || stepId === currentStep) return;
    setLoading(true);
    try { await consume(gotoStep(sessionId, stepId)); } finally { setLoading(false); }
  }

  // 点 topic 子知识点(字符串 step_id 'topicid-N'):直触发 step_agent 生成,不经主 agent
  async function handleTopicStep(stepId: string) {
    if (!sessionId || loading) return;
    setLoading(true);
    try { await consume(explainStep(sessionId, stepId)); } finally { setLoading(false); }
  }

  async function handleNewSession() {
    consumeRunIdRef.current++; // 作废旧 session 的 consume
    try {
      const sid = await newSession();
      resetToEmpty();
      setSessionId(sid);
      sessionIdRef.current = sid;
      setItems([]);
      setInput("");
      setPendingAsk(null);
      setTopics([]);
      setDecomposeGraph(null);
      clearPendingFiles();
      setFileName(null);
      setFileText(null);
      setShowSessions(false);
      refreshSessions();
    } catch (e: any) {
      setItems((prev) => [...prev, makeItem({ kind: "error", message: e.message }, `e-${Date.now()}`)]);
    }
  }

  async function handleSwitchSession(sid: string) {
    if (sid === sessionId) { setShowSessions(false); return; }
    setSessionQuery("");
    consumeRunIdRef.current++; // 作废当前 session 的 consume,防止旧 SSE 事件串台
    try {
      const detail = await getSession(sid);
      switchSession({
        sessionId: sid,
        lesson: detail.lesson ? {
          title: detail.lesson.title, summary: detail.lesson.summary,
          params: detail.lesson.params, steps: detail.lesson.steps,
        } as any : null,
        currentStep: detail.current_step,
        sceneCode: detail.scene_codes?.[detail.current_step] || "",
      });
      // 从后端 trace 重建对话执行树
      try {
        const trace = await getTrace(sid);
        setItems(trace.map((ev, i) => makeItem(ev, `t-${i}`)));
      } catch {
        setItems([]);
      }
      setTopics((detail as any).topics || []);
      setDecomposeGraph((detail as any).graph || null);
      setPendingAsk(null);
      clearPendingFiles();
      setFileName(null);
      setFileText(null);
      setShowSessions(false);
    } catch (e: any) {
      setItems((prev) => [...prev, makeItem({ kind: "error", message: e.message }, `e-${Date.now()}`)]);
    }
  }

  // 删除会话:确认 → 调后端删除实现(清内存/缓存/文件) → 刷新列表;若删的是当前会话则回空态
  async function handleDeleteSession(sid: string) {
    if (!window.confirm("删除该会话?此操作会连同其缓存与文件一并清除,不可恢复。")) return;
    try {
      await deleteSession(sid);
      setShowSessions(false);
      setSessionQuery("");
      if (sid === sessionId) resetToEmpty();
      await refreshSessions();
    } catch (e: any) {
      window.alert(`删除失败:${e.message}`);
    }
  }

  // 重命名会话:prompt 输入新标题 → 调后端 → 刷新列表
  async function handleRenameSession(sid: string, cur: string) {
    const title = window.prompt("输入新的会话标题:", cur)?.trim();
    if (!title) return;
    try {
      await renameSession(sid, title);
      await refreshSessions();
    } catch (e: any) {
      window.alert(`重命名失败:${e.message}`);
    }
  }

  async function handleExport() {
    if (!sessionId) return;
    try {
      await exportSession(sessionId);
    } catch (e: any) {
      setItems((prev) => [...prev, makeItem({ kind: "error", message: e.message }, `e-${Date.now()}`)]);
    }
  }

  async function handleExportMd() {
    if (!sessionId) return;
    try {
      await exportSessionMarkdown(sessionId);
    } catch (e: any) {
      setItems((prev) => [...prev, makeItem({ kind: "error", message: e.message }, `e-${Date.now()}`)]);
    }
  }

  async function handleImport(f: File) {
    try {
      const { sessionId: sid } = await importSessionFromFile(f);
      const detail = await getSession(sid);
      switchSession({
        sessionId: sid,
        lesson: detail.lesson ? {
          title: detail.lesson.title, summary: detail.lesson.summary,
          params: detail.lesson.params, steps: detail.lesson.steps,
        } as any : null,
        currentStep: detail.current_step,
        sceneCode: detail.scene_codes?.[detail.current_step] || "",
      });
      setItems([]);
      refreshSessions();
    } catch (e: any) {
      setItems((prev) => [...prev, makeItem({ kind: "error", message: e.message }, `e-${Date.now()}`)]);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏:会话切换 + 上传 */}
      <div className="flex items-center gap-2 px-3 h-11 border-b border-[#1e293b] shrink-0 relative">
        <button onClick={() => setShowSessions((v) => !v)} className="btn-ghost px-2.5 py-1 rounded-md text-[11px] flex items-center gap-1.5">
          <Menu size={13} /> <span className="max-w-[80px] truncate">{sessionList.find((s) => s.session_id === sessionId)?.title || "会话"}</span>
        </button>
        <button onClick={handleNewSession} className="btn-ghost px-2 py-1 rounded-md text-[11px] flex items-center gap-1" title="新建会话"><Plus size={13} /> 新建</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }}
        />
        <input
          ref={importInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ""; }}
        />
        <button onClick={() => fileInputRef.current?.click()} className="btn-ghost px-2 py-1 rounded-md text-[11px] flex items-center gap-1" title="上传课件">
          {fileName ? <><Paperclip size={13} /> {fileName.slice(0, 12)}</> : <Paperclip size={13} />}
        </button>
        <span className="text-[10px] text-[#4a5365] flex items-center gap-1 ml-auto" title="右键对话区可导出/笔记/导入/删除会话">
          {loading ? <><span className="w-1.5 h-1.5 rounded-full bg-[#4a9eff] animate-pulse" /> 生成中</> : sessionId ? <><span className="w-1.5 h-1.5 rounded-full bg-[#4a9eff]" /> 会话中</> : <><span className="w-1.5 h-1.5 rounded-full bg-[#4a5365]" /> 待输入</>}
        </span>

        {/* 会话下拉列表(搜索/切换/重命名/删除) */}
        {showSessions && (
          <div className="absolute top-11 left-2 z-20 w-72 rounded-md border border-[#1e293b] bg-[#0b0f18] shadow-xl max-h-80 overflow-hidden flex flex-col">
            <div className="px-2 pt-1.5 pb-1.5 border-b border-[#1e293b] shrink-0">
              <input
                value={sessionQuery}
                onChange={(e) => setSessionQuery(e.target.value)}
                placeholder="搜索标题或问题…"
                className="w-full bg-[#0b0f18] text-[#dfe6f0] text-[11px] px-2 py-1 rounded border border-[#1e293b] outline-none placeholder-[#4a5365] focus:border-[#4a9eff]/50"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {(() => {
                const q = sessionQuery.trim().toLowerCase();
                const list = (sessionList || []).filter((s) =>
                  !q || (s.title || "").toLowerCase().includes(q) || (s.question || "").toLowerCase().includes(q));
                if (list.length === 0) return <div className="px-3 py-2 text-[11px] text-[#4a5365]">无匹配会话</div>;
                return list.map((s) => (
                  <div key={s.session_id} className={`flex items-stretch group hover:bg-[#161f2e] ${s.session_id === sessionId ? "bg-[#4a9eff]/10" : ""}`}>
                    <button
                      onClick={() => handleSwitchSession(s.session_id)}
                      className="flex-1 min-w-0 text-left px-3 py-1.5 text-[11px]"
                    >
                      <div className="text-[#dfe6f0] truncate">{s.title}</div>
                      <div className="text-[9px] text-[#4a5365]">{(s.question || "(空)").slice(0, 34)} · 步 {s.current_step}/{s.step_count}</div>
                    </button>
                    <div className="flex items-center pr-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <span onClick={() => handleRenameSession(s.session_id, s.title)} title="重命名" className="cursor-pointer px-1 py-1 text-[10px] text-[#6b7686] hover:text-[#5fb0ff]">✎</span>
                      <span onClick={() => handleDeleteSession(s.session_id)} title="删除" className="cursor-pointer px-1 py-1 text-[10px] text-[#6b7686] hover:text-[#fca5a5]">✕</span>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}
      </div>

      {/* 分层知识点 list(新:多主题并列,每个主题可展开看子知识点) */}
      {topics.length > 0 && (
        <div className="px-3 py-2 border-b border-[#1e293b] bg-[#0b0f18]/60 shrink-0">
          <div className="flex items-center mb-1">
            <span className="text-[10px] text-[#4a5365] uppercase tracking-wider">知识点 · {topics.length} 个主题</span>
          </div>
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {topics.map((tp) => (
              <TopicNode key={tp.id} topic={tp} onStepClick={handleTopicStep} loading={loading} />
            ))}
          </div>
        </div>
      )}

      {/* 知识点 list(旧:单主题 lesson.steps,兼容旧 session) */}
      {lesson.steps.length > 0 && (
        <div className="px-3 py-2.5 border-b border-[#1e293b] bg-[#0b0f18]/60 shrink-0">
          <div className="flex items-center mb-1.5">
            <span className="text-[10px] text-[#4a5365] uppercase tracking-wider">知识点 · {lesson.title}</span>
            <span className="ml-auto text-[9px] text-[#4a5365]">←/→ 切换 · 点击跳步</span>
          </div>
          <ol className="space-y-0.5 max-h-44 overflow-y-auto">
            {lesson.steps.map((s) => {
              const st = stepStatus[s.id] || "pending";
              return (
                <li
                  key={s.id}
                  onClick={() => handleGoto(s.id)}
                  className={`flex items-center gap-2 text-[11px] py-0.5 px-1 rounded cursor-pointer hover:bg-[#161f2e] ${st === "active" ? "bg-[#4a9eff]/10" : ""}`}
                >
                  <StepBadge status={st} id={s.id} />
                  <span className={st === "done" ? "text-[#6b7686]" : st === "active" ? "text-[#dfe6f0]" : "text-[#9aa6b8]"}>{s.title}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* 对话流(右键弹出导出/笔记/导入/删除菜单) */}
      <div ref={scrollRef} onContextMenu={openCtxMenu} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
        {items.length === 0 && !loading && (
          <div className="empty-state mt-6">
            <div className="empty-icon"><Sparkles size={30} /></div>
            <div className="text-[12px] text-[#6b7686]">输入要学的 STEM 知识点开始对话</div>
            <div className="text-[10.5px] text-[#4a5365] max-w-[260px]">可先上传课件。我会拆成知识点 list 逐个用动画 + 公式 + 图文讲解,还能出题考你</div>
          </div>
        )}
        {renderTree(items, setItems)}
        {loading && (
          <div className="flex items-center gap-2 text-[11px] text-[#6b7686] px-1 py-1 thinking-dot">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4a9eff]" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#4a9eff]" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#4a9eff]" />
            </span>
            <Loader2 size={12} className="animate-spin text-[#5fb0ff]" />
            <span>主 agent 正在思考…</span>
          </div>
        )}
      </div>

      {/* 对话栏右键菜单:导出 JSON / 导出笔记 / 导入 / 删除当前会话 */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-50 w-48 rounded-md border border-[#1e293b] bg-[#0b0f18] shadow-xl py-1"
          style={{
            left: Math.min(ctxMenu.x, window.innerWidth - 210),
            top: Math.min(ctxMenu.y, window.innerHeight - 200),
          }}
        >
          <MenuRow
            icon={Download}
            label="导出 JSON"
            disabled={!sessionId}
            onClick={() => { setCtxMenu(null); handleExport(); }}
            title="导出当前会话为 JSON"
          />
          <MenuRow
            icon={FileText}
            label="导出学习笔记(.md)"
            disabled={!sessionId}
            onClick={() => { setCtxMenu(null); handleExportMd(); }}
            title="导出当前会话为 Markdown 学习笔记"
          />
          <div className="my-1 border-t border-[#1e293b]" />
          <MenuRow
            icon={Upload}
            label="导入 JSON 恢复会话"
            onClick={() => { setCtxMenu(null); importInputRef.current?.click(); }}
            title="从 JSON 文件恢复一个会话"
          />
          <MenuRow
            icon={Trash2}
            label="删除当前会话"
            disabled={!sessionId}
            onClick={() => { setCtxMenu(null); if (sessionId) void handleDeleteSession(sessionId); }}
            title="删除当前会话(不可恢复)"
            danger
          />
        </div>
      )}

      {/* 底部:输入(无上一步/下一步按钮,改用 list 点击或键盘) */}
      <div className="p-2.5 border-t border-[#1e293b] shrink-0 space-y-1.5">
        {/* 深度选择 + 待发文件 chip */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={depth}
            onChange={(e) => setDepth(e.target.value as any)}
            className="text-[10px] bg-[#161f2e] border border-[#1e293b] rounded px-1.5 py-0.5 text-[#9aa6b8] outline-none"
            title="学习深度:影响主 agent 拆解粒度与讲解风格"
          >
            <option value="popular">科普</option>
            <option value="understand">理解</option>
            <option value="deep">深度理解</option>
          </select>
          {pendingFiles.map((f) => (
            <span key={f.file_id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[#4a9eff]/10 text-[#5fb0ff] border border-[#4a9eff]/20">
              <Paperclip size={11} /> {f.name}
              <button onClick={() => removePendingFile(f.file_id)} className="text-[#5fb0ff]/60 hover:text-[#5fb0ff]"><X size={11} /></button>
            </span>
          ))}
        </div>
        {/* 主 agent 提问的预设选项按钮(ask_user 带 options 时):点击即发送该选项文本作回答 */}
        {pendingAsk?.options && pendingAsk.options.length > 0 && (
          <div className="flex flex-col gap-1 py-1">
            {pendingAsk.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => answerWithOption(opt)}
                disabled={loading}
                className="text-left text-[11px] px-2.5 py-1.5 rounded-md bg-[#0d121c] border border-[#1e293b] hover:border-[#4a9eff]/50 hover:bg-[#4a9eff]/10 text-[#9aa6b8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="点击即发送此选项作回答"
              >
                {opt}
              </button>
            ))}
            <span className="text-[9px] text-[#4a5365] px-1">点选项发送,或在下方输入框自定义回答</span>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-lg bg-[#161f2e] border border-[#1e293b] px-2.5 py-1.5 focus-within:border-[#4a9eff]/50 transition-colors">
          <textarea
            placeholder={pendingAsk ? "回答主 agent 的问题…" : sessionId ? "追问或更新问题…" : "输入要学的知识点,如:梯度下降、傅里叶变换…"}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            className="flex-1 bg-transparent text-[12px] text-[#dfe6f0] resize-none outline-none placeholder:text-[#4a5365] leading-5"
          />
          {loading ? (
            <button
              onClick={stopGeneration}
              className="px-3 py-1 rounded-md text-[11px] font-medium bg-[#3a1620] text-[#f87171] border border-[#5a2430] hover:bg-[#4a1c28]"
              title="打断当前 LLM 生成"
            >■ 停止</button>
          ) : (
            <button onClick={submit} disabled={loading} className="btn-blue px-3 py-1 rounded-md text-[11px] disabled:opacity-40">{pendingAsk ? "回答" : "发送"}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepBadge({ status, id }: { status: StepStatus; id: number }) {
  if (status === "done") return <span className="w-4 h-4 rounded grid place-items-center bg-[#4a9eff] text-[#070a12]"><Check size={11} /></span>;
  if (status === "active") return <span className="w-4 h-4 rounded grid place-items-center text-[9px] bg-[#4a9eff]/20 text-[#5fb0ff] border border-[#4a9eff]/40 tnum">{id}</span>;
  return <span className="w-4 h-4 rounded grid place-items-center text-[9px] text-[#4a5365] border border-[#1e293b] tnum">{id}</span>;
}

// 分层知识点主题节点:可折叠,展开显示子知识点(点子知识点触发生成动画)
function TopicNode({ topic, onStepClick, loading }: { topic: Topic; onStepClick: (stepId: string) => void; loading: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-md border border-[#162032] bg-[#0d121c]/60">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-1.5 px-2 py-1 text-left">
        <span className={`text-[9px] text-[#53606f] transition-transform inline-block w-2 ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="text-[11px] font-medium text-[#dfe6f0] truncate">{topic.title}</span>
        <span className="ml-auto chip">{topic.steps.length} 步</span>
      </button>
      {open && (
        <ol className="px-2 pb-1.5 pl-3 space-y-0.5">
          {topic.steps.map((s, i) => {
            const generated = !!(s as any).explanation || !!(s as any).sceneCode;  // 已缓存(跑过 step agent)
            const lvl = (s as any).level ?? 0;            // 层级深度(0=顶层)
            const isSum = !!(s as any).is_summary;        // 融合总结节点
            return (
              <li
                key={s.id}
                onClick={() => onStepClick(s.id)}
                style={{ paddingLeft: 4 + lvl * 14 }}
                className={`group flex items-center gap-2 text-[10.5px] py-1 px-1.5 rounded cursor-pointer border border-transparent hover:bg-[#161f2e] hover:border-[#2b3a52] hover:translate-x-0.5 transition-all duration-150 ${loading ? "opacity-50 pointer-events-none" : ""} ${isSum ? "border-t border-[#1e293b] mt-1 pt-1.5 hover:bg-[#2b6cb0]/8 hover:border-[#2b6cb0]/40" : ""}`}
              >
                <span className={`w-4 h-4 rounded grid place-items-center text-[9px] shrink-0 tnum transition-transform group-hover:scale-110 ${generated ? "bg-[#4a9eff] text-[#070a12]" : isSum ? "bg-[#2b6cb0]/30 text-[#9ec5ff] border border-[#2b6cb0]" : "text-[#4a5365] border border-[#1e293b] group-hover:border-[#4a9eff]/40 group-hover:text-[#5fb0ff]"}`}>{generated ? <Check size={11} /> : isSum ? "Σ" : i + 1}</span>
                <span className={`truncate ${generated ? "text-[#9aa6b8]" : isSum ? "text-[#9ec5ff] font-medium" : "text-[#7a8696] group-hover:text-[#9aa6b8]"}`}>{s.title}</span>
                {generated && <span className="ml-auto text-[9px] text-[#4a5365] shrink-0">已生成</span>}
                {isSum && !generated && <span className="ml-auto text-[9px] text-[#4a5365] shrink-0">融合</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function renderTree(items: RenderedItem[], setItems: Dispatch<SetStateAction<RenderedItem[]>>) {
  // 按 parentId 建子列表;无 parentId 或 parentId 不在 items 里的当根
  const byId = new Map<string, RenderedItem>();
  items.forEach((it) => { if (it.event.id) byId.set(it.event.id, it); });
  const childrenOf = new Map<string | null, RenderedItem[]>();
  for (const it of items) {
    const pid = (it.event.parentId && byId.has(it.event.parentId)) ? it.event.parentId : null;
    const arr = childrenOf.get(pid) || [];
    arr.push(it);
    childrenOf.set(pid, arr);
  }
  const roots = (childrenOf.get(null) || []).slice().sort((a, b) => (a.event.ts ?? 0) - (b.event.ts ?? 0));
  const toggle = (key: string) => setItems((prev) => prev.map((it) => it.key === key ? { ...it, collapsed: !it.collapsed } : it));
  const renderNode = (it: RenderedItem, depth: number): ReactNode => {
    const kids = (childrenOf.get(it.event.id!) || []).slice().sort((a, b) => (a.event.ts ?? 0) - (b.event.ts ?? 0));
    return (
      <div key={it.key} style={{ paddingLeft: depth * 14 }}>
        <EventCard event={it.event} collapsed={it.collapsed} onToggle={() => toggle(it.key)} />
        {!it.collapsed && renderKids(kids, depth + 1)}
      </div>
    );
  };
  // 渲染一组 children:把连续的 tool_call 聚合成 ToolGroup(一行"Wrench t1 → t2 · N 个",点开逐个展开)
  const renderKids = (kids: RenderedItem[], depth: number): ReactNode => {
    const out: ReactNode[] = [];
    let group: RenderedItem[] = [];
    const flush = () => {
      if (group.length === 0) return;
      if (group.length === 1) {
        out.push(renderNode(group[0], depth));
      } else {
        out.push(<ToolGroup key={`tg-${group[0].key}`} items={group} depth={depth} renderNode={renderNode} />);
      }
      group = [];
    };
    for (const k of kids) {
      if (k.event.kind === "tool_call") {
        group.push(k);
      } else {
        flush();
        out.push(renderNode(k, depth));
      }
    }
    flush();
    return <>{out}</>;
  };
  return <>{roots.map((it) => renderNode(it, 0))}</>;
}

// 连续多个 tool_call 的聚合视图:一行"Wrench t1 → t2 → ... · N 个工具",点开逐个展开(每个 tool_call 再点开看 args)
function ToolGroup({ items, depth, renderNode }: { items: RenderedItem[]; depth: number; renderNode: (it: RenderedItem, d: number) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const names = items.map((it) => (it.event as any).name).join(" → ");
  return (
    <div style={{ paddingLeft: depth * 0 }}>
      <div onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-[10.5px] py-0.5 cursor-pointer hover:text-[#9aa6b8] text-[#6b7686]">
        <span className={`text-[9px] text-[#53606f] transition-transform inline-block w-2 ${open ? "rotate-90" : ""}`}>▶</span>
        <Wrench size={12} /> <span className="font-mono">{names}</span> <span className="text-[#4a5365]">· {items.length} 个工具</span>
      </div>
      {open && items.map((it) => renderNode(it, depth))}
    </div>
  );
}

function EventCard({ event, collapsed, onToggle }: { event: ChatEvent; collapsed?: boolean; onToggle?: () => void; }) {
  const collapsible = collapsed !== undefined && onToggle;
  const Twist = () => <span className={`text-[9px] text-[#53606f] transition-transform inline-block w-2 ${collapsed ? "" : "rotate-90"}}`}>▶</span>;
  switch (event.kind) {
    case "message": {
      const r = roleStyle[event.role];
      const isUser = event.role === "user";
      return (
        <div className={`flex ${isUser ? "justify-end" : "justify-start"} my-0.5`}>
          <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[12px] leading-[1.55] transition-shadow duration-200 ${
            isUser
              ? "bg-[#4a9eff]/15 border border-[#4a9eff]/35 text-[#dfe6f0] shadow-[0_1px_8px_-2px_rgba(74,158,255,0.25)]"
              : "bg-[#0d121c] border border-[#1e293b] text-[#9aa6b8] hover:border-[#2b3a52] hover:bg-[#101725]"
          }`}>
            {!isUser && <div className="text-[10px] font-medium mb-0.5 flex items-center gap-1.5" style={{ color: r.color }}>
              <span className="w-1 h-1 rounded-full" style={{ background: r.color }} />{r.name}
            </div>}
            {isUser
              ? <div className="whitespace-pre-wrap">{event.text}</div>
              : <div className="md-prose"><ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{event.text}</ReactMarkdown></div>}
          </div>
        </div>
      );
    }
    case "plan":
      return (
        <div className="rounded-lg border border-[#1e293b] bg-[#111827] p-2.5 my-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#5fb0ff] mb-1">
            <span>◆</span> {event.title}
            <span className="ml-auto chip">{event.steps.length} 步</span>
          </div>
          {event.summary && <div className="text-[10.5px] text-[#6b7686] leading-relaxed">{event.summary}</div>}
        </div>
      );
    case "step-start":
      return <div className="flex items-center gap-1.5 text-[11px] text-[#5fb0ff] py-0.5"><span className="w-1.5 h-1.5 rounded-full bg-[#4a9eff] animate-pulse" /> 第 {event.stepId} 步 · {event.title}</div>;
    case "agent_start":
      // 主 agent 的 agent_start 不显示(文本消息已带"主 Agent"名,这里冗余);
      // subagent(设计某步动画)的默认折叠,只显一行摘要,点开看工具调用过程(set_title/.../update_animation/渲染结果)
      if (event.agent === "main") return null;
      return (
        <div onClick={onToggle} className="flex items-center gap-1.5 text-[10.5px] text-[#6b7686] py-0.5 cursor-pointer hover:text-[#9aa6b8]">
          {collapsible && <span className={`text-[9px] text-[#53606f] transition-transform inline-block w-2 ${collapsed ? "" : "rotate-90"}`}>▶</span>}
          <Bot size={12} /> <span>{`设计第 ${event.stepId} 步`}</span>
          <span className="text-[#4a5365] text-[9px]">{collapsed ? "点击展开工具过程" : ""}</span>
        </div>
      );
    case "tool_call": {
      const a = event.args as any;
      let argSummary: string;
      let body: string;
      if (event.name === "update_animation") {
        // 合并工具:传 old_str = 局部改,否则 = 整段提交
        if (a.old_str) {
          const o = String(a.old_str ?? ""), n = String(a.new_str ?? "");
          argSummary = `(局部改: ${o.length}字 → ${n.length}字)`;
          body = `- old_str:\n${a.old_str}\n\n+ new_str:\n${a.new_str}`;
        } else {
          argSummary = `(整段: ${a.code ? `${a.code.length} 字符` : "无"})`;
          body = a.code ?? "(空)";
        }
      } else {
        argSummary = `(${Object.values(a).map((v: any) => JSON.stringify(v)).slice(0, 2).join(", ")})`;
        body = JSON.stringify(a, null, 2);
      }
      return (
        <div className="my-0.5">
          <div onClick={onToggle} className={`flex items-center gap-1.5 text-[10.5px] py-0.5 cursor-pointer hover:text-[#9aa6b8] ${collapsed ? "text-[#6b7686]" : "text-[#9aa6b8]"}`}>
            {collapsible && <Twist />} <Wrench size={12} /> <span className="font-mono">{event.name}</span>
          </div>
          {!collapsed && (
            <div className="mt-0.5 ml-5">
              <div className="text-[10px] text-[#4a5365] mb-0.5">{argSummary}</div>
              <pre className="text-[10px] text-[#7a8696] bg-[#0a0f1a] border border-[#162032] rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                {body}
              </pre>
            </div>
          )}
        </div>
      );
    }
    case "tool_result": {
      const ok = !/失败|错误|error/i.test(event.output);
      return (
        <div className="my-0.5">
          <div onClick={onToggle} className={`flex items-center gap-1.5 text-[10.5px] py-0.5 cursor-pointer hover:text-[#9aa6b8] ${collapsed ? "text-[#6b7686]" : "text-[#9aa6b8]"}`}>
            {collapsible && <Twist />} <span>{ok ? "↳" : "⚠"}</span> <span className="text-[#4a5365]">结果:</span> <span className="truncate">{event.output.slice(0, 60)}</span>
          </div>
          {!collapsed && (
            <pre className="mt-0.5 ml-5 text-[10px] text-[#7a8696] bg-[#0a0f1a] border border-[#162032] rounded px-2 py-1 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">{event.output}</pre>
          )}
        </div>
      );
    }
    case "render_request":
      return (
        <div className="my-0.5">
          <div onClick={onToggle} className="flex items-center gap-1.5 text-[10.5px] py-0.5 cursor-pointer text-[#5fb0ff] hover:text-[#9aa6b8]">
            {collapsible && <Twist />} <Code2 size={12} /> <span>渲染请求</span> <span className="text-[#4a5365]">code {event.code.length} 字符</span>
          </div>
          {!collapsed && (
            <pre className="mt-0.5 ml-5 text-[10px] text-[#7a8696] bg-[#0a0f1a] border border-[#162032] rounded px-2 py-1 whitespace-pre-wrap break-all max-h-60 overflow-y-auto">{event.code}</pre>
          )}
        </div>
      );
    case "render_result":
      return (
        <div className={`flex items-center gap-1.5 text-[10.5px] py-0.5 ml-2 ${event.ok ? "text-[#5fb0ff]" : "text-[#e07a5f]"}`}>
          <span>{event.ok ? <Check size={12} /> : <X size={12} />}</span> <span>{event.ok ? "渲染通过" : "渲染失败"}</span>{!event.ok && event.error && <span className="text-[#7a8696] truncate">{event.error.slice(0, 60)}</span>}
        </div>
      );
    case "explain":
      return (
        <div className="rounded-md border border-[#162032] bg-[#0d121c] px-2.5 py-1.5 my-0.5">
          <div className="text-[10px] text-[#5fb0ff] mb-0.5">✎ 讲解 · {event.title}</div>
          <div className="text-[11px] text-[#9aa6b8] leading-relaxed line-clamp-3">{event.narration}</div>
        </div>
      );
    case "ask":
      return (
        <div className="rounded-md border border-[#4a9eff]/40 bg-[#4a9eff]/5 px-2.5 py-1.5 my-0.5">
          <div className="text-[10px] text-[#5fb0ff] mb-0.5">❓ 主 agent 想确认</div>
          <div className="text-[11.5px] text-[#dfe6f0] leading-relaxed whitespace-pre-wrap">{event.question}</div>
          <div className="text-[9px] text-[#4a5365] mt-1">{event.options?.length ? "点下方选项按钮或自定义回答" : "在下方输入框回答后发送"}</div>
        </div>
      );
    case "topic_added":
      return (
        <div className="rounded-md border border-[#162032] bg-[#0d121c] px-2.5 py-1 my-0.5">
          <div className="text-[10px] text-[#5fb0ff] mb-0.5">📚 新增主题 · {event.topic.title}</div>
          <div className="text-[10.5px] text-[#6b7686]">{event.topic.steps.length} 步:{event.topic.steps.map((s) => s.title).join(" / ")}</div>
        </div>
      );
    case "decompose_request":
      return (
        <div className="rounded-md border border-[#162032] bg-[#0d121c] px-2.5 py-1 my-0.5">
          <div className="text-[10px] text-[#5fb0ff] mb-0.5">🧩 分解知识图谱 · {event.question}</div>
          <div className="text-[9px] text-[#4a5365]">主 agent 触发分解 agent,正在跑…</div>
        </div>
      );
    case "animation_request":
      return (
        <div className="rounded-md border border-[#162032] bg-[#0d121c] px-2.5 py-1 my-0.5">
          <div className="text-[10px] text-[#5fb0ff] flex items-center gap-1"><Play size={11} /> 生成动画 · 第 {(event as any).step_id || event.stepId} 步</div>
          <div className="text-[9px] text-[#4a5365]">主 agent 触发 subagent,浏览器在环验证中…</div>
        </div>
      );
    case "stage_switch":
      return (
        <div className="text-[10px] text-[#6b7686] py-0.5 pl-1">
          🔄 切换中间舞台 → {(event as any).stage === "graph" ? "知识分解图" : "动画舞台"}
        </div>
      );
    case "done":
      return null;
    case "error":
      return <div className="rounded-md border border-[#2b3a52] bg-[#0f1828] px-2.5 py-1.5 text-[11px] text-[#9aa6b8]"><span className="text-[#5fb0ff]">!</span> {event.message}</div>;
    default:
      return null;
  }
}


// 对话栏右键菜单行:图标 + 文字;disabled 置灰;danger 红色(用于删除)
function MenuRow({ icon: Icon, label, onClick, disabled, title, danger }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string; onClick: () => void; disabled?: boolean; title?: string; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 disabled:opacity-30
        ${danger ? "text-[#fca5a5] hover:bg-[#ef4444]/10" : "text-[#dfe6f0] hover:bg-[#161f2e]"}`}
    >
      <Icon size={12} className={danger ? "text-[#fca5a5]" : "text-[#6b7686]"} />
      {label}
    </button>
  );
}
