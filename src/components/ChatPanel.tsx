import { AnimationAcceptance } from "../animationAcceptance";
import { busyForEvent } from "../busyTask";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import {
  nextStep, prevStep, gotoStep,
  postRenderResult, getTrace,
  chat, chatAnswer, chatStop, uploadForSession, graphCommand,
  listSessions, newSession, getSession, exportSession, importSessionFromFile,
  exportSessionMarkdown,
  deleteSession, renameSession,
  explainStep, modifyStep,
  type ChatEvent, type AgentRole, type Topic,
} from "../data/llmClient";
import { useApp, type StepStatus } from "../store";
import {
  Menu, Plus, Paperclip, Download, Upload, Wrench, Bot,
  Code2, Play, Check, X, Loader2, FileText, Trash2,
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
  user:        { name: "你",        color: "var(--text-dim)", dot: "var(--text-faint)", icon: "·" },
  orchestrator:{ name: "主 Agent",  color: "var(--blue-strong)", dot: "var(--blue)", icon: "◆" },
  animator:    { name: "Animator",  color: "var(--text-dim)", dot: "var(--text-mute)", icon: "▶" },
  verifier:    { name: "Verifier",  color: "var(--text-dim)", dot: "var(--text-mute)", icon: "✓" },
  narrator:    { name: "Narrator",  color: "var(--text-dim)", dot: "var(--text-mute)", icon: "✎" },
};

export default function ChatPanel() {
  const [items, setItems] = useState<RenderedItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // 打断:每次生成一个 AbortController;点"■ 停止"→ abort fetch + 通知后端停 run。
  const abortRef = useRef<AbortController | null>(null);
  const [pendingAsk, setPendingAsk] = useState<{ question: string; options?: string[] } | null>(null); // 主 agent 问的问题(+可选预设选项);非 null 时发送=回答该问题
  // 每个 session 的待回答问题:切走再切回仍可见(用户可自由忽略/作答/跳过),发新消息时自动放弃
  const pendingAskBySid = useRef<Record<string, { question: string; options?: string[] }>>({});
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
  const acceptedRef = useRef(new AnimationAcceptance());
  const sessionIdRef = useRef<string | null>(null);

  const {
    lesson, setLesson, currentStep, setCurrentStep,
    stepStatus, markStepActive, markStepDone,
    sessionId, setSessionId, setSceneCode, mergeStepParams, updateStepContent, updateTopicStep,
    sessionList, setSessionList, switchSession, resetToEmpty,
    navRequest,
    requestVerify, cancelVerification,
    depth, setDepth, topics, addTopic, setTopics, decomposeGraph, setDecomposeGraph,
    setStageOpen, setExplainOpen, setGraphOpen, closeAllWindows,
    setPendingQuiz, setQuizResult,
    pendingResume, setPendingResume,
    setBusyTask, clearBusyTask,
    pendingFiles, addPendingFile, removePendingFile, clearPendingFiles,
  } = useApp();
  // 同步 sessionId 到 ref,供 consume/handleEvent 异步循环里取最新值(避免闭包陈旧)
  sessionIdRef.current = sessionId;
  // decomposeGraph ref:主 agent 图编辑工具推 graph 事件时,question/root_title 从最新值继承(避免闭包陈旧)
  const decomposeGraphRef = useRef(decomposeGraph);
  decomposeGraphRef.current = decomposeGraph;

  // 兜底:agent 只 add_topic(没跑 graph_command 建真实图谱)时,从主题步骤推导一条学习路径图,
  // 让分解图窗在讲解时必有内容(与动画并存)。已有真实图谱则不覆盖。
  const ensureDecomposeFromTopic = (topic: Topic) => {
    if (decomposeGraphRef.current?.snapshot?.nodes?.length) return;
    const steps = topic.steps || [];
    const nodes: any[] = [
      { id: topic.id, title: topic.title, mastery: false, depth: 0, sets: [], aliases: [] },
      ...steps.map((s: any) => ({ id: s.id, title: s.title, mastery: false, depth: 1, sets: [topic.title], aliases: [] })),
    ];
    const edges = steps.map((s: any, i: number) => ({
      from: i === 0 ? topic.id : steps[i - 1].id,
      to: s.id,
      type: "prerequisite_of",
    }));
    setDecomposeGraph({ question: topic.title, root_title: `知识分解 · ${topic.title}`, snapshot: { nodes, edges } });
  };

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
    cancelVerification();
    const myRun = consumeRunIdRef.current + 1;
    (async () => {
      try {
        setLoading(true);
        const gen = pendingResume.result !== undefined
          ? chatAnswer(sid, "", pendingResume.result)
          : chatAnswer(sid, pendingResume.answer || "");
        await consume(gen);
      } finally {
        if (consumeRunIdRef.current === myRun) { setLoading(false); setPendingResume(null); }
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
    const myRun = ++consumeRunIdRef.current;
    acceptedRef.current.clear();
    setBusyTask({kind: "agent", label: "正在处理…", runId: myRun});
    try {
      await consumeRun(stream, myRun, opts);
    } finally { clearBusyTask(myRun); }
  }

  async function consumeRun(stream: AsyncGenerator<ChatEvent>, myRun: number, opts?: { isUpdate?: boolean }) {
    let key = Date.now();
    for await (const ev of stream) {
      // session 已切换:旧 consume 的事件作废,不再写 state(防止串台到新 session)
      if (consumeRunIdRef.current !== myRun) return;
      observeBusy(ev, myRun);
      acceptedRef.current.observe(myRun, ev);
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
        ensureDecomposeFromTopic(ev.topic);
        setGraphOpen(true); // 讲解时分解图必现(与动画并存)
      }
      if (ev.kind === "stage_switch") {
        // 主 agent 切换展示:graph=分解图窗,其它=动画窗(mermaid 已弃)
        const st = (ev as any).stage;
        if (st === "graph") setGraphOpen(true);
        else setStageOpen(true);
      }
      if (ev.kind === "graph") {
        // 图 agent(经 graph_command)改图后推的快照:刷新分解图画布(不进对话栏),并打开分解图窗
        const snap = (ev as any).payload || (ev as any).snapshot;
        if (snap) {
          const prev = decomposeGraphRef.current;
          setDecomposeGraph({
            question: prev?.question || "",
            root_title: prev?.root_title || "",
            snapshot: snap,
          });
        }
        setGraphOpen(true);
      }
      if (ev.kind === "quiz") {
        // 主 agent 出的选择题:存 store.pendingQuiz,讲解窗显示题+选项。清空旧结果。
        setPendingQuiz({
          step_title: (ev as any).step_title || "",
          question: (ev as any).question || "",
          options: (ev as any).options || [],
          answer: (ev as any).answer ?? 0,
          explanation: (ev as any).explanation || "",
        });
        setQuizResult(null);
        setExplainOpen(true);
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
        // 一步讲解完成:动画窗 + 讲解窗都弹出,让用户看到画面和讲解(可独立关闭)
        setStageOpen(true);
        setExplainOpen(true);
      }
      if (ev.kind === "render_request") {
        // 浏览器在环验证:让 StagePanel 跑这段 code,拿结果(含可选最后一帧 frame)回传后端,继续 consume 回传流
        // 先打开动画窗保证 StagePanel 可见消费 verifyRequest(否则 Promise 永不 resolve → 死锁)
        setStageOpen(true);
        const ok_err_frame = await requestVerify(ev.stepId, ev.code, myRun, (ev as any).params || {});
        if (ok_err_frame.status === "cancelled") return;
        if (consumeRunIdRef.current !== myRun) return;
        const subStream = postRenderResult(sessionIdRef.current || "", ev.stepId, ok_err_frame.ok, ok_err_frame.error, ok_err_frame.frame, (ev as any).nonce || "", ok_err_frame);
        // 递归 consume 回传流:内联消费(不再走外层 for await,避免嵌套)
        for await (const sub of subStream) {
          if (consumeRunIdRef.current !== myRun) return;
          await handleEvent(sub, myRun);
        }
      }
      if (ev.kind === "graph_command_request") {
        // 主 agent 调图 agent(分解建图 / 编辑改图):调 /api/graph_command。每个 graph 事件实时更新分解图,
        // 跑完收最后一个 graph 快照,再 chatAnswer resume
        setGraphOpen(true);
        const sid = sessionIdRef.current || "";
        const instruction = (ev as any).instruction || "";
        const prevRoot = decomposeGraphRef.current?.root_title || "";
        let graph: any = null, ok = false, errMsg = "";
        try {
          for await (const dev of graphCommand(sid, instruction)) {
            if (consumeRunIdRef.current !== myRun) return;
            if (dev?.kind === "graph") {
              graph = dev?.payload;
              // 实时更新 store.decomposeGraph:GraphApp effect 监听变化重建画布;编辑模式保留原 root_title
              setDecomposeGraph({ question: prevRoot || instruction, root_title: prevRoot || `知识分解 · ${instruction.slice(0, 20)}`, snapshot: graph });
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
          await handleEvent(sub, myRun);  // resume 后可能再来 ask/graph_command_request/topic_added
        }
      }
      if (ev.kind === "animation_request") {
        // 主 agent 要生成某步动画:调 /api/explain 跑 step subagent(浏览器在环),跑完 resume 主 agent 传 {ok, step_id}
        setStageOpen(true); // 弹动画窗让用户看实时渲染
        const sid = sessionIdRef.current || "";
        const stepId = (ev as any).step_id || ev.stepId || "";
        // 先把右侧切到这一步(该步已在 topics 里有标题占位),否则讲解要等 explain 事件(动画在环验证通过后)才出现
        if (stepId) setCurrentStep(stepId as any);
        const beforeAccepted = acceptedRef.current.version(myRun, stepId);
        let ok = false, errMsg = "";
        try {
          for await (const sev of explainStep(sid, stepId)) {
            if (consumeRunIdRef.current !== myRun) return;
            // render_request 走 handleEvent(浏览器在环验证 + postRenderResult 递归);explain 写 store;error 记录
            const r = await handleEvent(sev, myRun);
            if (r?.error) errMsg = r.error;
            if (sev.kind === "error") errMsg = sev.message || "";
          }
          // 只有本次任务收到 explain 才算成功，包括递归回传流
          ok = acceptedRef.current.completed(myRun, stepId, beforeAccepted, errMsg);
          if (!ok && !errMsg) errMsg = "任务结束但未收到已验证的动画结果，请重试。";
        } catch (e: any) { errMsg = e.message; }
        if (consumeRunIdRef.current !== myRun) return;
        // resume 主 agent:传 result={ok, step_id, error?}
        const subStream = chatAnswer(sid, "", { ok, step_id: stepId, error: errMsg });
        for await (const sub of subStream) {
          if (consumeRunIdRef.current !== myRun) return;
          await handleEvent(sub, myRun);  // resume 后可能再来 ask/animation_request/topic_added
        }
      }
      if (ev.kind === "modify_request") {
        // 主 agent 改某步动画:调 /api/modify_step 跑 step_agent 修改模式(浏览器在环),跑完 resume 主 agent 传 {ok, step_id}
        setStageOpen(true); // 弹动画窗让用户看改后的渲染
        const sid = sessionIdRef.current || "";
        const stepId = (ev as any).step_id || ev.stepId || "";
        const feedback = (ev as any).feedback || "";
        if (stepId) setCurrentStep(stepId as any);
        const beforeAccepted = acceptedRef.current.version(myRun, stepId);
        let ok = false, errMsg = "";
        try {
          for await (const sev of modifyStep(sid, stepId, feedback)) {
            if (consumeRunIdRef.current !== myRun) return;
            const r = await handleEvent(sev, myRun);
            if (r?.error) errMsg = r.error;
            if (sev.kind === "error") errMsg = sev.message || "";
          }
          ok = acceptedRef.current.completed(myRun, stepId, beforeAccepted, errMsg);
          if (!ok && !errMsg) errMsg = "任务结束但未收到已验证的动画结果，请重试。";
        } catch (e: any) { errMsg = e.message; }
        if (consumeRunIdRef.current !== myRun) return;
        const subStream = chatAnswer(sid, "", { ok, step_id: stepId, error: errMsg });
        for await (const sub of subStream) {
          if (consumeRunIdRef.current !== myRun) return;
          await handleEvent(sub, myRun);
        }
      }
    }
    refreshSessions();
  }

  function observeBusy(ev: ChatEvent, myRun: number) {
    const next = busyForEvent(ev, myRun);
    if (next !== undefined) {
      if (next === null) clearBusyTask(myRun);
      else setBusyTask(next);
    }
  }

  // 处理单个事件(供 render_request 递归消费复用):落盘 explain/plan/session/error,render_request 递归验证
  // myRun:外层 consume 的 runId,递归中切会话时据此中断,防止回传流写到新会话(串台)
  async function handleEvent(ev: ChatEvent, myRun: number): Promise<{ error: string } | undefined> {
    if (consumeRunIdRef.current !== myRun) return;
    observeBusy(ev, myRun);
    acceptedRef.current.observe(myRun, ev);
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
      setStageOpen(true);
      setExplainOpen(true);
    } else if (ev.kind === "render_request") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
      // 先打开动画窗:StagePanel 有 verifyRequest 消费端;窗口关着时 Promise 永不 resolve → 永久"生成中"死锁
      setStageOpen(true);
      const ok_err_frame = await requestVerify(ev.stepId, ev.code, myRun, (ev as any).params || {});
      if (ok_err_frame.status === "cancelled") return;
      // 脚本已实际运行、只是布局检查未完全通过时，先自动展示草稿，后台仍继续有限修复。
      const runnableChecks = new Set(ok_err_frame.checks || []);
      if (!ok_err_frame.ok && ["execution", "scene-access", "measurements", "mathtex", "nan"].every(check => runnableChecks.has(check))) {
        setSceneCode(ev.code);
      }
      if (consumeRunIdRef.current !== myRun) return;
      const subStream = postRenderResult(sessionIdRef.current || "", ev.stepId, ok_err_frame.ok, ok_err_frame.error, ok_err_frame.frame, (ev as any).nonce || "", ok_err_frame);
      let subErr = "";
      for await (const sub of subStream) {
        if (consumeRunIdRef.current !== myRun) return;
        const r = await handleEvent(sub, myRun);
        if (r?.error) subErr = r.error;
      }
      // 把本段(含递归渲染回传流)遇到的 error 冒泡给上层(animation_request),避免"验证失败超限"被误判成功
      if (subErr) return { error: subErr };
    } else if (ev.kind === "graph_command_request") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
      setGraphOpen(true);
      const sid = sessionIdRef.current || "";
      const instruction = (ev as any).instruction || "";
      const prevRoot = decomposeGraphRef.current?.root_title || "";
      let graph: any = null, ok = false, errMsg = "";
      try {
        for await (const dev of graphCommand(sid, instruction)) {
          if (consumeRunIdRef.current !== myRun) return;
          if (dev?.kind === "graph") {
            graph = dev?.payload;
            setDecomposeGraph({ question: prevRoot || instruction, root_title: prevRoot || `知识分解 · ${instruction.slice(0, 20)}`, snapshot: graph });  // 实时更新
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
    } else if (ev.kind === "modify_request") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
      setStageOpen(true);
      const sid = sessionIdRef.current || "";
      const stepId = (ev as any).step_id || ev.stepId || "";
      const feedback = (ev as any).feedback || "";
      if (stepId) setCurrentStep(stepId as any);
      const beforeAccepted = acceptedRef.current.version(myRun, stepId);
      let ok = false, errMsg = "";
      try {
        for await (const sev of modifyStep(sid, stepId, feedback)) {
          if (consumeRunIdRef.current !== myRun) return;
          const r = await handleEvent(sev, myRun);
          if (r?.error) errMsg = r.error;
          if (sev.kind === "error") errMsg = sev.message || "";
        }
        ok = acceptedRef.current.completed(myRun, stepId, beforeAccepted, errMsg);
        if (!ok && !errMsg) errMsg = "任务结束但未收到已验证的动画结果，请重试。";
      } catch (e: any) { errMsg = e.message; }
      if (consumeRunIdRef.current !== myRun) return;
      const subStream = chatAnswer(sid, "", { ok, step_id: stepId, error: errMsg });
      for await (const sub of subStream) {
        if (consumeRunIdRef.current !== myRun) return;
        await handleEvent(sub, myRun);
      }
    } else if (ev.kind === "animation_request") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
      setStageOpen(true);
      const sid = sessionIdRef.current || "";
      const stepId = (ev as any).step_id || ev.stepId || "";
      if (stepId) setCurrentStep(stepId as any); // 先切右侧到该步(标题占位),等 explain 填讲解
      const beforeAccepted = acceptedRef.current.version(myRun, stepId);
      let ok = false, errMsg = "";
      try {
        for await (const sev of explainStep(sid, stepId)) {
          if (consumeRunIdRef.current !== myRun) return;
          const r = await handleEvent(sev, myRun);
          if (r?.error) errMsg = r.error;
          if (sev.kind === "error") errMsg = sev.message || "";
        }
        ok = acceptedRef.current.completed(myRun, stepId, beforeAccepted, errMsg);
        if (!ok && !errMsg) errMsg = "任务结束但未收到已验证的动画结果，请重试。";
      } catch (e: any) { errMsg = e.message; }
      if (consumeRunIdRef.current !== myRun) return;
      const subStream = chatAnswer(sid, "", { ok, step_id: stepId, error: errMsg });
      for await (const sub of subStream) {
        if (consumeRunIdRef.current !== myRun) return;
        await handleEvent(sub, myRun);
      }
      // 若本段渲染失败(超 6 次未通过等),把 error 冒泡给更上层调用方(resume_main_agent 递归),别被"无 error 即成功"吞掉
      if (errMsg) return { error: errMsg };
    } else if (ev.kind === "error") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
      // 把 error 冒泡给上层调用方(render_request/animation_request 递归):渲染验证失败超限等若被吞,
      // 外层 animation_request 的"流正常结束且无 error 即成功"会把失败误判成功
      return { error: ev.message || "" };
    } else if (ev.kind === "agent_start" || ev.kind === "tool_call" || ev.kind === "tool_result" || ev.kind === "render_result") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
    } else if (ev.kind === "quiz") {
      setItems(prev => [...prev, makeItem(ev, `e-${Date.now()}`)]);
      setPendingQuiz({step_title: ev.step_title, question: ev.question, options: ev.options, answer: ev.answer, explanation: ev.explanation});
      setQuizResult(null);
      setExplainOpen(true);
    } else if (ev.kind === "topic_added") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
      addTopic(ev.topic);
      ensureDecomposeFromTopic(ev.topic);
      setGraphOpen(true); // 讲解时分解图必现(与动画并存)
    } else if (ev.kind === "stage_switch") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
      const st = (ev as any).stage;
      if (st === "graph") setGraphOpen(true);
      else setStageOpen(true);
    } else if (ev.kind === "ask") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
      const pa = { question: ev.question, options: (ev as any).options };
      const sid = sessionIdRef.current;
      if (sid) pendingAskBySid.current[sid] = pa;
      setPendingAsk(pa);
    } else if (ev.kind === "done" || ev.kind === "plan" || ev.kind === "step-start") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
    }
  }

  // 清掉当前 session 的待回答问题(状态 + 按 session 的记忆):作答/跳过/发新消息时都清,防切回后又冒出来
  const clearPendingAsk = () => {
    const sid = sessionIdRef.current;
    if (sid) delete pendingAskBySid.current[sid];
    setPendingAsk(null);
  };

  // 显式"跳过"主 agent 的问题:发空 answer 让 ask_user 工具返回"用户未回答(跳过)",agent 继续
  async function skipQuestion() {
    const sid = sessionIdRef.current;
    if (!sid || loading) return;
    setLoading(true);
    clearPendingAsk();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await consume(chatAnswer(sid, "", null, ac.signal));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setLoading(false);
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
        clearPendingAsk();
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
    consumeRunIdRef.current++;
    setBusyTask(null);
    cancelVerification(); // 使当前 consume 的后续事件作废(防串台残留)
    setLoading(false);
    const sid = sessionIdRef.current;
    if (sid) void chatStop(sid).catch(() => {
      setItems(prev => [...prev, makeItem({ kind: "error", message: "本地已停止，但后端未确认取消，请检查连接。" } as ChatEvent, `stop-error-${Date.now()}`)]);
    });
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
      clearPendingAsk();
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
    setStageOpen(true); // 弹动画窗展示该步动画
    setLoading(true);
    try { await consume(explainStep(sessionId, stepId)); } finally { setLoading(false); }
  }

  const lastRender = [...items].reverse().find(item => item.event.kind === 'render_result')?.event;
  const layoutRetry = lastRender?.kind === 'render_result' && String(lastRender.stepId) === String(currentStep) && !lastRender.ok && lastRender.error.includes('[layout]') ? lastRender : null;
  async function retryLayout() {
    if (!sessionId || loading || !layoutRetry) return;
    setLoading(true);
    try { await consume(modifyStep(sessionId, String(layoutRetry.stepId), `根据布局反馈局部修复，保留核心公式和参数，修复后重新验证整个场景：${layoutRetry.error}`)); }
    finally { setLoading(false); }
  }

  async function handleNewSession() {
    consumeRunIdRef.current++;
    cancelVerification(); // 作废旧 session 的 consume
    abortRef.current?.abort(); // 取消旧 SSE reader:后台生成由 executor 解耦继续跑(不调 chatStop,勿停旧生成)
    abortRef.current = null;
    setLoading(false); // 新会话立刻可输入(旧生成残留的 loading 不冻结新会话)
    setBusyTask(null); // 旧会话的忙碌指示一并作废(切换后面板不再显示旧任务)
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
      // 考题/待作答都是按 session 的:切走即清,防旧 session 的题串台到新会话
      setPendingQuiz(null);
      setQuizResult(null);
      setPendingResume(null);
      closeAllWindows(); // 新会话是空的,浮窗全关回纯对话
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
    consumeRunIdRef.current++;
    cancelVerification(); // 作废当前 session 的 consume,防止旧 SSE 事件串台
    abortRef.current?.abort(); // 取消旧 SSE reader:后台生成由 executor 解耦继续跑(不调 chatStop,勿停旧生成)
    abortRef.current = null;
    setLoading(false); // 新会话立刻可输入(旧生成残留的 loading 不冻结新会话)
    setBusyTask(null); // 旧会话的长任务指示作废(切走即清,防旧任务状态残留)
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
      // 恢复该 session 的待回答问题(若之前问过且没作答),切走再切回不丢
      setPendingAsk(pendingAskBySid.current[sid] ?? null);
      // 考题/待作答都是按 session 的:切走即清,防 A 的题串台到 B(作答会把答案 resume 到 B 的主 agent)
      setPendingQuiz(null);
      setQuizResult(null);
      setPendingResume(null);
      closeAllWindows(); // 切会话:浮窗全关,回对话优先布局
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
      <div className="flex items-center gap-2 px-3 h-11 border-b border-[var(--border)] shrink-0 relative">
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
        <span className="text-[10px] text-[var(--text-faint)] flex items-center gap-1 ml-auto" title="右键对话区可导出/笔记/导入/删除会话">
          {loading ? <><span className="w-1.5 h-1.5 rounded-full bg-[var(--blue)] animate-pulse" /> 生成中</> : sessionId ? <><span className="w-1.5 h-1.5 rounded-full bg-[var(--blue)]" /> 会话中</> : <><span className="w-1.5 h-1.5 rounded-full bg-[var(--text-faint)]" /> 待输入</>}
        </span>

        {/* 会话下拉列表(搜索/切换/重命名/删除) */}
        {showSessions && (
          <div className="absolute top-11 left-2 z-20 w-72 rounded-md border border-[var(--border)] bg-[var(--bg-1)] shadow-xl max-h-80 overflow-hidden flex flex-col">
            <div className="px-2 pt-1.5 pb-1.5 border-b border-[var(--border)] shrink-0">
              <input
                value={sessionQuery}
                onChange={(e) => setSessionQuery(e.target.value)}
                placeholder="搜索标题或问题…"
                className="w-full bg-[var(--bg-1)] text-[var(--text)] text-[11px] px-2 py-1 rounded border border-[var(--border)] outline-none placeholder-[var(--text-faint)] focus:border-[var(--blue)]/50"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {(() => {
                const q = sessionQuery.trim().toLowerCase();
                const list = (sessionList || []).filter((s) =>
                  !q || (s.title || "").toLowerCase().includes(q) || (s.question || "").toLowerCase().includes(q));
                if (list.length === 0) return <div className="px-3 py-2 text-[11px] text-[var(--text-faint)]">无匹配会话</div>;
                return list.map((s) => (
                  <div key={s.session_id} className={`flex items-stretch group hover:bg-[var(--bg-3)] ${s.session_id === sessionId ? "bg-[var(--blue)]/10" : ""}`}>
                    <button
                      onClick={() => handleSwitchSession(s.session_id)}
                      className="flex-1 min-w-0 text-left px-3 py-1.5 text-[11px]"
                    >
                      <div className="text-[var(--text)] truncate">{s.title}</div>
                      <div className="text-[9px] text-[var(--text-faint)]">{(s.question || "(空)").slice(0, 34)} · 步 {s.current_step}/{s.step_count}</div>
                    </button>
                    <div className="flex items-center pr-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <span onClick={() => handleRenameSession(s.session_id, s.title)} title="重命名" className="cursor-pointer px-1 py-1 text-[10px] text-[var(--text-mute)] hover:text-[var(--blue-strong)]">✎</span>
                      <span onClick={() => handleDeleteSession(s.session_id)} title="删除" className="cursor-pointer px-1 py-1 text-[10px] text-[var(--text-mute)] hover:text-[#fca5a5]">✕</span>
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
        <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-1)]/60 shrink-0">
          <div className="flex items-center mb-1">
            <span className="text-[10px] text-[var(--text-faint)] uppercase tracking-wider">知识点 · {topics.length} 个主题</span>
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
        <div className="px-3 py-2.5 border-b border-[var(--border)] bg-[var(--bg-1)]/60 shrink-0">
          <div className="flex items-center mb-1.5">
            <span className="text-[10px] text-[var(--text-faint)] uppercase tracking-wider">知识点 · {lesson.title}</span>
            <span className="ml-auto text-[9px] text-[var(--text-faint)]">←/→ 切换 · 点击跳步</span>
          </div>
          <ol className="space-y-0.5 max-h-44 overflow-y-auto">
            {lesson.steps.map((s) => {
              const st = stepStatus[s.id] || "pending";
              return (
                <li
                  key={s.id}
                  onClick={() => handleGoto(s.id)}
                  className={`flex items-center gap-2 text-[11px] py-0.5 px-1 rounded cursor-pointer hover:bg-[var(--bg-3)] ${st === "active" ? "bg-[var(--blue)]/10" : ""}`}
                >
                  <StepBadge status={st} id={s.id} />
                  <span className={st === "done" ? "text-[var(--text-mute)]" : st === "active" ? "text-[var(--text)]" : "text-[var(--text-dim)]"}>{s.title}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* 对话流(右键弹出导出/笔记/导入/删除菜单) */}
      <div ref={scrollRef} onContextMenu={openCtxMenu} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
        {renderTree(items, setItems)}
        {loading && (
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-mute)] px-1 py-1 thinking-dot">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--blue)]" />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--blue)]" />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--blue)]" />
            </span>
            <Loader2 size={12} className="animate-spin text-[var(--blue-strong)]" />
            <span>主 agent 正在思考…</span>
          </div>
        )}
      </div>

      {/* 对话栏右键菜单:导出 JSON / 导出笔记 / 导入 / 删除当前会话 */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-50 w-48 rounded-md border border-[var(--border)] bg-[var(--bg-1)] shadow-xl py-1"
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
          <div className="my-1 border-t border-[var(--border)]" />
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
      <div className="p-2.5 border-t border-[var(--border)] shrink-0 space-y-1.5">
        {layoutRetry && <button className="btn-ghost text-xs" disabled={loading || !sessionId} onClick={() => void retryLayout()}>重试修复本步布局</button>}
        {/* 深度选择 + 待发文件 chip */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={depth}
            onChange={(e) => setDepth(e.target.value as any)}
            className="text-[10px] bg-[var(--bg-3)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--text-dim)] outline-none"
            title="学习深度:影响主 agent 拆解粒度与讲解风格"
          >
            <option value="popular">科普</option>
            <option value="understand">理解</option>
            <option value="deep">深度理解</option>
          </select>
          {pendingFiles.map((f) => (
            <span key={f.file_id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--blue)]/10 text-[var(--blue-strong)] border border-[var(--blue)]/20">
              <Paperclip size={11} /> {f.name}
              <button onClick={() => removePendingFile(f.file_id)} className="text-[var(--blue-strong)]/60 hover:text-[var(--blue-strong)]"><X size={11} /></button>
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
                className="text-left text-[11px] px-2.5 py-1.5 rounded-md bg-[var(--bg-panel)] border border-[var(--border)] hover:border-[var(--blue)]/50 hover:bg-[var(--blue)]/10 text-[var(--text-dim)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="点击即发送此选项作回答"
              >
                {opt}
              </button>
            ))}
            <span className="text-[9px] text-[var(--text-faint)] px-1">点选项发送,或在下方输入框自定义回答</span>
          </div>
        )}
        {/* 跳过按钮:用户可自由忽视任何问题,点它即显式放弃当前问题继续对话 */}
        {pendingAsk && (
          <div className="flex items-center justify-end px-1 pb-0.5">
            <button
              onClick={skipQuestion}
              disabled={loading}
              className="text-[10px] text-[var(--text-faint)] hover:text-[var(--text-dim)] underline-offset-2 hover:underline transition-colors disabled:opacity-40"
              title="忽略这个问题,直接继续对话"
            >跳过这个问题 →</button>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-lg bg-[var(--bg-3)] border border-[var(--border)] px-2.5 py-1.5 focus-within:border-[var(--blue)]/50 transition-colors">
          <textarea
            placeholder={pendingAsk ? "回答主 agent 的问题…" : sessionId ? "追问或更新问题…" : "输入要学的知识点,如:梯度下降、傅里叶变换…"}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            className="flex-1 bg-transparent text-[12px] text-[var(--text)] resize-none outline-none placeholder:text-[var(--text-faint)] leading-5"
          />
          {loading ? (
            <button
              onClick={stopGeneration}
              className="px-3 py-1 rounded-md text-[11px] font-medium bg-[var(--danger-bg)] text-[var(--danger-text)] border border-[var(--danger-border)] hover:bg-[var(--danger-bg-hover)]"
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
  if (status === "done") return <span className="w-4 h-4 rounded grid place-items-center bg-[var(--blue)] text-[var(--on-accent)]"><Check size={11} /></span>;
  if (status === "active") return <span className="w-4 h-4 rounded grid place-items-center text-[9px] bg-[var(--blue)]/20 text-[var(--blue-strong)] border border-[var(--blue)]/40 tnum">{id}</span>;
  return <span className="w-4 h-4 rounded grid place-items-center text-[9px] text-[var(--text-faint)] border border-[var(--border)] tnum">{id}</span>;
}

// 分层知识点主题节点:可折叠,展开显示子知识点(点子知识点触发生成动画)
function TopicNode({ topic, onStepClick, loading }: { topic: Topic; onStepClick: (stepId: string) => void; loading: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-md border border-[var(--border-soft)] bg-[var(--bg-panel)]/60">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-1.5 px-2 py-1 text-left">
        <span className={`text-[9px] text-[var(--text-mute)] transition-transform inline-block w-2 ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="text-[11px] font-medium text-[var(--text)] truncate">{topic.title}</span>
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
                className={`group flex items-center gap-2 text-[10.5px] py-1 px-1.5 rounded cursor-pointer border border-transparent hover:bg-[var(--bg-3)] hover:border-[var(--border-hover)] hover:translate-x-0.5 transition-all duration-150 ${loading ? "opacity-50 pointer-events-none" : ""} ${isSum ? "border-t border-[var(--border)] mt-1 pt-1.5 hover:bg-[var(--blue-deep)]/8 hover:border-[var(--blue-deep)]/40" : ""}`}
              >
                <span className={`w-4 h-4 rounded grid place-items-center text-[9px] shrink-0 tnum transition-transform group-hover:scale-110 ${generated ? "bg-[var(--blue)] text-[var(--on-accent)]" : isSum ? "bg-[var(--blue-deep)]/30 text-[var(--blue-light)] border border-[var(--blue-deep)]" : "text-[var(--text-faint)] border border-[var(--border)] group-hover:border-[var(--blue)]/40 group-hover:text-[var(--blue-strong)]"}`}>{generated ? <Check size={11} /> : isSum ? "Σ" : i + 1}</span>
                <span className={`truncate ${generated ? "text-[var(--text-dim)]" : isSum ? "text-[var(--blue-light)] font-medium" : "text-[var(--text-mute)] group-hover:text-[var(--text-dim)]"}`}>{s.title}</span>
                {generated && <span className="ml-auto text-[9px] text-[var(--text-faint)] shrink-0">已生成</span>}
                {isSum && !generated && <span className="ml-auto text-[9px] text-[var(--text-faint)] shrink-0">融合</span>}
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
      <div onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-[10.5px] py-0.5 cursor-pointer hover:text-[var(--text-dim)] text-[var(--text-mute)]">
        <span className={`text-[9px] text-[var(--text-mute)] transition-transform inline-block w-2 ${open ? "rotate-90" : ""}`}>▶</span>
        <Wrench size={12} /> <span className="font-mono">{names}</span> <span className="text-[var(--text-faint)]">· {items.length} 个工具</span>
      </div>
      {open && items.map((it) => renderNode(it, depth))}
    </div>
  );
}

function EventCard({ event, collapsed, onToggle }: { event: ChatEvent; collapsed?: boolean; onToggle?: () => void; }) {
  const collapsible = collapsed !== undefined && onToggle;
  const Twist = () => <span className={`text-[9px] text-[var(--text-mute)] transition-transform inline-block w-2 ${collapsed ? "" : "rotate-90"}}`}>▶</span>;
  switch (event.kind) {
    case "message": {
      const r = roleStyle[event.role];
      const isUser = event.role === "user";
      return (
        <div className={`flex ${isUser ? "justify-end" : "justify-start"} my-0.5`}>
          <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[12px] leading-[1.55] transition-shadow duration-200 ${
            isUser
              ? "bg-[var(--blue)]/15 border border-[var(--blue)]/35 text-[var(--text)] shadow-[0_1px_8px_-2px_var(--blue-glow)]"
              : "bg-[var(--bg-panel)] border border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-2)]"
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
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-2)] p-2.5 my-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--blue-strong)] mb-1">
            <span>◆</span> {event.title}
            <span className="ml-auto chip">{event.steps.length} 步</span>
          </div>
          {event.summary && <div className="text-[10.5px] text-[var(--text-mute)] leading-relaxed">{event.summary}</div>}
        </div>
      );
    case "step-start":
      return <div className="flex items-center gap-1.5 text-[11px] text-[var(--blue-strong)] py-0.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--blue)] animate-pulse" /> 第 {event.stepId} 步 · {event.title}</div>;
    case "agent_start":
      // 主 agent 的 agent_start 不显示(文本消息已带"主 Agent"名,这里冗余);
      // subagent(设计某步动画)的默认折叠,只显一行摘要,点开看工具调用过程(set_title/.../update_animation/渲染结果)
      if (event.agent === "main") return null;
      return (
        <div onClick={onToggle} className="flex items-center gap-1.5 text-[10.5px] text-[var(--text-mute)] py-0.5 cursor-pointer hover:text-[var(--text-dim)]">
          {collapsible && <span className={`text-[9px] text-[var(--text-mute)] transition-transform inline-block w-2 ${collapsed ? "" : "rotate-90"}`}>▶</span>}
          <Bot size={12} /> <span>{`设计第 ${event.stepId} 步`}</span>
          <span className="text-[var(--text-faint)] text-[9px]">{collapsed ? "点击展开工具过程" : ""}</span>
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
          <div onClick={onToggle} className={`flex items-center gap-1.5 text-[10.5px] py-0.5 cursor-pointer hover:text-[var(--text-dim)] ${collapsed ? "text-[var(--text-mute)]" : "text-[var(--text-dim)]"}`}>
            {collapsible && <Twist />} <Wrench size={12} /> <span className="font-mono">{event.name}</span>
          </div>
          {!collapsed && (
            <div className="mt-0.5 ml-5">
              <div className="text-[10px] text-[var(--text-faint)] mb-0.5">{argSummary}</div>
              <pre className="text-[10px] text-[var(--text-mute)] bg-[var(--bg-input)] border border-[var(--border-soft)] rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
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
          <div onClick={onToggle} className={`flex items-center gap-1.5 text-[10.5px] py-0.5 cursor-pointer hover:text-[var(--text-dim)] ${collapsed ? "text-[var(--text-mute)]" : "text-[var(--text-dim)]"}`}>
            {collapsible && <Twist />} <span>{ok ? "↳" : "⚠"}</span> <span className="text-[var(--text-faint)]">结果:</span> <span className="truncate">{event.output.slice(0, 60)}</span>
          </div>
          {!collapsed && (
            <pre className="mt-0.5 ml-5 text-[10px] text-[var(--text-mute)] bg-[var(--bg-input)] border border-[var(--border-soft)] rounded px-2 py-1 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">{event.output}</pre>
          )}
        </div>
      );
    }
    case "render_request":
      return (
        <div className="my-0.5">
          <div onClick={onToggle} className="flex items-center gap-1.5 text-[10.5px] py-0.5 cursor-pointer text-[var(--blue-strong)] hover:text-[var(--text-dim)]">
            {collapsible && <Twist />} <Code2 size={12} /> <span>渲染请求</span> <span className="text-[var(--text-faint)]">code {event.code.length} 字符</span>
          </div>
          {!collapsed && (
            <pre className="mt-0.5 ml-5 text-[10px] text-[var(--text-mute)] bg-[var(--bg-input)] border border-[var(--border-soft)] rounded px-2 py-1 whitespace-pre-wrap break-all max-h-60 overflow-y-auto">{event.code}</pre>
          )}
        </div>
      );
    case "render_result":
      return (
        <div className={`flex items-center gap-1.5 text-[10.5px] py-0.5 ml-2 ${event.ok ? "text-[var(--blue-strong)]" : "text-[#e07a5f]"}`}>
          <span>{event.ok ? <Check size={12} /> : <X size={12} />}</span> <span>{event.verification?.status === "incomplete" ? "验证未完成，正在修复" : event.verification?.status === "cancelled" ? "验证已取消" : event.ok ? (event.verification?.checks?.includes("layout-warning") ? "基础检查通过，布局有提示" : event.verification?.checks?.includes("display-fallback") ? "已展示可运行草稿" : event.verification?.checks?.includes("3d-layout-skipped") ? "3D 基础检查通过" : event.verification?.checks?.includes("layout-temporal") ? "布局采样检查通过" : "基础检查通过") : "验证失败，正在修复"}</span>{!event.ok && event.error && <span className="text-[var(--text-mute)] truncate">{event.error.slice(0, 60)}</span>}
        </div>
      );
    case "explain":
      return (
        <div className="rounded-md border border-[var(--border-soft)] bg-[var(--bg-panel)] px-2.5 py-1.5 my-0.5">
          <div className="text-[10px] text-[var(--blue-strong)] mb-0.5">✎ 讲解 · {event.title}</div>
          <div className="text-[11px] text-[var(--text-dim)] leading-relaxed line-clamp-3">{event.narration}</div>
        </div>
      );
    case "ask":
      return (
        <div className="rounded-md border border-[var(--blue)]/40 bg-[var(--blue)]/5 px-2.5 py-1.5 my-0.5">
          <div className="text-[10px] text-[var(--blue-strong)] mb-0.5">❓ 主 agent 想确认</div>
          <div className="text-[11.5px] text-[var(--text)] leading-relaxed whitespace-pre-wrap">{event.question}</div>
          <div className="text-[9px] text-[var(--text-faint)] mt-1">{event.options?.length ? "点下方选项按钮或自定义回答" : "在下方输入框回答后发送"}</div>
        </div>
      );
    case "topic_added":
      return (
        <div className="rounded-md border border-[var(--border-soft)] bg-[var(--bg-panel)] px-2.5 py-1 my-0.5">
          <div className="text-[10px] text-[var(--blue-strong)] mb-0.5">📚 新增主题 · {event.topic.title}</div>
          <div className="text-[10.5px] text-[var(--text-mute)]">{event.topic.steps.length} 步:{event.topic.steps.map((s) => s.title).join(" / ")}</div>
        </div>
      );
    case "decompose_request":
      return (
        <div className="rounded-md border border-[var(--border-soft)] bg-[var(--bg-panel)] px-2.5 py-1 my-0.5">
          <div className="text-[10px] text-[var(--blue-strong)] mb-0.5">🧩 分解知识图谱 · {event.question}</div>
          <div className="text-[9px] text-[var(--text-faint)]">主 agent 触发分解 agent,正在跑…</div>
        </div>
      );
    case "animation_request":
      return (
        <div className="rounded-md border border-[var(--border-soft)] bg-[var(--bg-panel)] px-2.5 py-1 my-0.5">
          <div className="text-[10px] text-[var(--blue-strong)] flex items-center gap-1"><Play size={11} /> 生成动画 · 第 {(event as any).step_id || event.stepId} 步</div>
          <div className="text-[9px] text-[var(--text-faint)]">主 agent 触发 subagent,浏览器在环验证中…</div>
        </div>
      );
    case "stage_switch":
      return (
        <div className="text-[10px] text-[var(--text-mute)] py-0.5 pl-1">
          🔄 切换中间舞台 → {(event as any).stage === "graph" ? "知识分解图" : "动画舞台"}
        </div>
      );
    case "done":
      return null;
    case "error":
      return <div className="rounded-md border border-[var(--border-hover)] bg-[var(--bg-row)] px-2.5 py-1.5 text-[11px] text-[var(--text-dim)]"><span className="text-[var(--blue-strong)]">!</span> {event.message}</div>;
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
        ${danger ? "text-[#fca5a5] hover:bg-[#ef4444]/10" : "text-[var(--text)] hover:bg-[var(--bg-3)]"}`}
    >
      <Icon size={12} className={danger ? "text-[#fca5a5]" : "text-[var(--text-mute)]"} />
      {label}
    </button>
  );
}
