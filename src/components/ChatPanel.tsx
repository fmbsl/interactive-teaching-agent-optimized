import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from "react";
import {
  startLesson, nextStep, prevStep, gotoStep, updateQuestion, uploadFile,
  postRenderResult, getTrace,
  listSessions, newSession, getSession, exportSession, importSessionFromFile,
  type ChatEvent, type AgentRole,
} from "../data/llmClient";
import { useApp, type StepStatus } from "../store";

interface RenderedItem { key: string; event: ChatEvent; collapsed: boolean; }

const COLLAPSED_BY_DEFAULT = new Set(["tool_call", "tool_result", "render_request", "render_result"]);

function makeItem(ev: ChatEvent, key: string): RenderedItem {
  return { key, event: ev, collapsed: COLLAPSED_BY_DEFAULT.has(ev.kind) };
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
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // session 隔离:每次 consume 抓一个 runId,切换 session 时 bump,旧 consume 检测到 runId 变了就停止写 state
  const consumeRunIdRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);

  const {
    lesson, setLesson, currentStep, setCurrentStep,
    stepStatus, markStepActive, markStepDone,
    sessionId, setSessionId, setSceneCode, mergeStepParams, updateStepContent,
    sessionList, setSessionList, switchSession, resetToEmpty,
    navRequest,
    requestVerify, verifyResultHandler,
  } = useApp();
  // 同步 sessionId 到 ref,供 consume/handleEvent 异步循环里取最新值(避免闭包陈旧)
  sessionIdRef.current = sessionId;

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

  async function refreshSessions() {
    try { setSessionList(await listSessions()); } catch { /* 忽略 */ }
  }

  async function handleUpload(f: File) {
    try {
      setLoading(true);
      const txt = await uploadFile(f);
      setFileText(txt);
      setFileName(f.name);
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
      } else {
        setItems((prev) => [...prev, makeItem(ev, String(key++))]);
      }
      if (ev.kind === "session") { setSessionId(ev.sessionId); sessionIdRef.current = ev.sessionId; }
      if (ev.kind === "plan") {
        setLesson({ title: ev.title, summary: ev.summary, params: ev.params, steps: ev.steps } as any);
        if (!opts?.isUpdate) setItems((p) => p.filter((x) => x.event.kind !== "message" || x.event.role !== "orchestrator" || !x.event.text.includes("正在分析")));
      }
      if (ev.kind === "explain") {
        setCurrentStep(ev.stepId);
        markStepActive(ev.stepId);
        setSceneCode(ev.sceneCode);
        if (ev.params) mergeStepParams(ev.params);
        updateStepContent(ev.stepId, {
          title: ev.title, narration: ev.narration, formula: ev.formula, explanation: (ev as any).explanation,
          intent: ev.intent, paramsUsed: ev.paramsUsed,
        });
      }
      if (ev.kind === "render_request") {
        // 浏览器在环验证:让 StagePanel 跑这段 code,拿结果(含可选最后一帧 frame)回传后端,继续 consume 回传流
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
      setCurrentStep(ev.stepId);
      markStepActive(ev.stepId);
      setSceneCode(ev.sceneCode);
      if (ev.params) mergeStepParams(ev.params);
      updateStepContent(ev.stepId, { title: ev.title, narration: ev.narration, formula: ev.formula, explanation: (ev as any).explanation, intent: ev.intent, paramsUsed: ev.paramsUsed });
    } else if (ev.kind === "render_request") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
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
    } else if (ev.kind === "error") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
    } else if (ev.kind === "agent_start" || ev.kind === "tool_call" || ev.kind === "tool_result" || ev.kind === "render_result") {
      setItems((prev) => [...prev, makeItem(ev, `e-${Date.now()}`)]);
    }
  }

  async function submit() {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setLoading(true);
    setItems((prev) => [...prev, makeItem({ kind: "message", role: "user", text: q } as ChatEvent, `u-${Date.now()}`)]);
    try {
      if (sessionId && lesson.steps.length > 0) {
        await consume(updateQuestion(sessionId, q, fileText ?? undefined), { isUpdate: true });
      } else {
        await consume(startLesson(q, fileText ?? undefined));
      }
    } finally {
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

  async function handleNewSession() {
    consumeRunIdRef.current++; // 作废旧 session 的 consume
    try {
      const sid = await newSession();
      resetToEmpty();
      setSessionId(sid);
      setItems([]);
      setInput("");
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
      setFileName(null);
      setFileText(null);
      setShowSessions(false);
    } catch (e: any) {
      setItems((prev) => [...prev, makeItem({ kind: "error", message: e.message }, `e-${Date.now()}`)]);
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

  async function handleImport(f: File) {
    try {
      const { sessionId: sid, title } = await importSessionFromFile(f);
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
          ☰ <span className="max-w-[80px] truncate">{sessionList.find((s) => s.session_id === sessionId)?.title || "会话"}</span>
        </button>
        <button onClick={handleNewSession} className="btn-ghost px-2 py-1 rounded-md text-[11px]" title="新建会话">+ 新建</button>
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
        <button onClick={() => fileInputRef.current?.click()} className="btn-ghost px-2 py-1 rounded-md text-[11px]" title="上传课件">
          {fileName ? fileName.slice(0, 12) : "📎"}
        </button>
        <button onClick={handleExport} disabled={!sessionId} className="btn-ghost px-2 py-1 rounded-md text-[11px] disabled:opacity-30" title="导出当前会话为 JSON">⬇ 导出</button>
        <button onClick={() => importInputRef.current?.click()} className="btn-ghost px-2 py-1 rounded-md text-[11px] ml-auto" title="导入 JSON 恢复会话">⬆ 导入</button>
        <span className="text-[10px] text-[#4a5365] flex items-center gap-1">
          {loading ? <><span className="w-1.5 h-1.5 rounded-full bg-[#4a9eff] animate-pulse" /> 生成中</> : sessionId ? <><span className="w-1.5 h-1.5 rounded-full bg-[#4a9eff]" /> 会话中</> : <><span className="w-1.5 h-1.5 rounded-full bg-[#4a5365]" /> 待输入</>}
        </span>

        {/* 会话下拉列表 */}
        {showSessions && (
          <div className="absolute top-11 left-2 z-20 w-64 rounded-md border border-[#1e293b] bg-[#0b0f18] shadow-xl py-1 max-h-72 overflow-y-auto">
            {sessionList.length === 0 && <div className="px-3 py-2 text-[11px] text-[#4a5365]">暂无会话</div>}
            {sessionList.map((s) => (
              <button
                key={s.session_id}
                onClick={() => handleSwitchSession(s.session_id)}
                className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-[#161f2e] ${s.session_id === sessionId ? "bg-[#4a9eff]/10" : ""}`}
              >
                <div className="text-[#dfe6f0] truncate">{s.title}</div>
                <div className="text-[9px] text-[#4a5365]">{s.question.slice(0, 40) || "(空)"} · 步 {s.current_step}/{s.step_count}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 知识点 list(可点击跳步) */}
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

      {/* 对话流 */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
        {items.length === 0 && !loading && (
          <div className="text-[11px] text-[#4a5365] leading-relaxed px-1">
            输入要学的 STEM 知识点(可先上传课件),我会拆成知识点 list 逐个用动画+公式+文字讲解。回车发送,←/→ 切换步骤。
          </div>
        )}
        {renderTree(items, setItems)}
      </div>

      {/* 底部:输入(无上一步/下一步按钮,改用 list 点击或键盘) */}
      <div className="p-2.5 border-t border-[#1e293b] shrink-0">
        <div className="flex items-end gap-2 rounded-lg bg-[#161f2e] border border-[#1e293b] px-2.5 py-1.5 focus-within:border-[#4a9eff]/50 transition-colors">
          <textarea
            placeholder={sessionId ? "追问或更新问题…" : "输入要学的知识点,如:梯度下降、傅里叶变换…"}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            className="flex-1 bg-transparent text-[12px] text-[#dfe6f0] resize-none outline-none placeholder:text-[#4a5365] leading-5"
          />
          <button onClick={submit} disabled={loading} className="btn-blue px-3 py-1 rounded-md text-[11px] disabled:opacity-40">{loading ? "…" : sessionId ? "更新" : "发送"}</button>
        </div>
      </div>
    </div>
  );
}

function StepBadge({ status, id }: { status: StepStatus; id: number }) {
  if (status === "done") return <span className="w-4 h-4 rounded grid place-items-center text-[9px] bg-[#4a9eff] text-[#070a12]">✓</span>;
  if (status === "active") return <span className="w-4 h-4 rounded grid place-items-center text-[9px] bg-[#4a9eff]/20 text-[#5fb0ff] border border-[#4a9eff]/40 tnum">{id}</span>;
  return <span className="w-4 h-4 rounded grid place-items-center text-[9px] text-[#4a5365] border border-[#1e293b] tnum">{id}</span>;
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
        {!it.collapsed && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };
  return <>{roots.map((it) => renderNode(it, 0))}</>;
}

function EventCard({ event, collapsed, onToggle }: { event: ChatEvent; collapsed?: boolean; onToggle?: () => void; }) {
  const collapsible = collapsed !== undefined && onToggle;
  const Twist = () => <span className={`text-[9px] text-[#53606f] transition-transform inline-block w-2 ${collapsed ? "" : "rotate-90"}}`}>▶</span>;
  switch (event.kind) {
    case "message": {
      const r = roleStyle[event.role];
      return (
        <div className="flex gap-2">
          <span className="mt-0.5 text-[10px] w-4 text-center shrink-0" style={{ color: r.dot }}>{r.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-medium mb-0.5" style={{ color: r.color }}>{r.name}</div>
            <div className="text-[12px] leading-[1.55] text-[#9aa6b8]">{event.text}</div>
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
      return <div className="flex items-center gap-1.5 text-[10.5px] text-[#6b7686] py-0.5"><span>🤖</span> {event.agent === "main" ? "主 agent · 知识点拆解" : `subagent · 设计第 ${event.stepId} 步`}</div>;
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
            {collapsible && <Twist />} <span>🔧</span> <span className="font-mono">{event.name}</span> <span className="text-[#4a5365]">{argSummary}</span>
          </div>
          {!collapsed && (
            <pre className="mt-0.5 ml-5 text-[10px] text-[#7a8696] bg-[#0a0f1a] border border-[#162032] rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
              {body}
            </pre>
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
            {collapsible && <Twist />} <span>▶</span> <span>渲染请求</span> <span className="text-[#4a5365]">code {event.code.length} 字符</span>
          </div>
          {!collapsed && (
            <pre className="mt-0.5 ml-5 text-[10px] text-[#7a8696] bg-[#0a0f1a] border border-[#162032] rounded px-2 py-1 whitespace-pre-wrap break-all max-h-60 overflow-y-auto">{event.code}</pre>
          )}
        </div>
      );
    case "render_result":
      return (
        <div className={`flex items-center gap-1.5 text-[10.5px] py-0.5 ml-2 ${event.ok ? "text-[#5fb0ff]" : "text-[#e07a5f]"}`}>
          <span>{event.ok ? "✓" : "✗"}</span> <span>{event.ok ? "渲染通过" : "渲染失败"}</span>{!event.ok && event.error && <span className="text-[#7a8696] truncate">{event.error.slice(0, 60)}</span>}
        </div>
      );
    case "explain":
      return (
        <div className="rounded-md border border-[#162032] bg-[#0d121c] px-2.5 py-1.5 my-0.5">
          <div className="text-[10px] text-[#5fb0ff] mb-0.5">✎ 讲解 · {event.title}</div>
          <div className="text-[11px] text-[#9aa6b8] leading-relaxed line-clamp-3">{event.narration}</div>
        </div>
      );
    case "done":
      return <div className="text-[11px] text-[#5fb0ff] pl-5 py-0.5">✓ {event.message}</div>;
    case "error":
      return <div className="rounded-md border border-[#2b3a52] bg-[#0f1828] px-2.5 py-1.5 text-[11px] text-[#9aa6b8]"><span className="text-[#5fb0ff]">!</span> {event.message}</div>;
    default:
      return null;
  }
}
