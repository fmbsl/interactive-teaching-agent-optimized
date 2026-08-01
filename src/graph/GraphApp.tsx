import { useState, useRef, useCallback } from "react";
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { uploadFile, streamRawSSE } from "../data/llmClient";

// xyflow v12 的 .react-flow__edges 只设了 position:absolute,缺 width/height,导致边容器 0 尺寸不画边。强制铺满。
// 另外 preview 窗口可能 viewport 0×0(vh 失效),用 fixed/inset:0 兜底,不依赖 h-screen(100vh)。
const FLOW_CSS = `.react-flow .react-flow__edges { width: 100%; height: 100%; }`;

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://localhost:8000";

type LogItem = { id: string; parentId?: string | null; kind: string; text: string; depth: number };

export default function GraphApp() {
  const [question, setQuestion] = useState("");
  const [fileText, setFileText] = useState<string | undefined>(undefined);
  const [fileName, setFileName] = useState("");
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);
  const [log, setLog] = useState<LogItem[]>([]);
  const [sid, setSid] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const consumeRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const layoutPos = (depth: number, idx: number) => ({
    x: depth * 240 + (idx % 4) * 38,
    y: idx * 78,
  });

  const run = useCallback(async () => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setRfNodes([]);
    setRfEdges([]);
    setLog([]);
    const myRun = ++consumeRef.current;
    const gen = streamRawSSE(`${API_BASE}/api/decompose`, { question, file_text: fileText ?? null });
    for await (const ev of gen) {
      if (consumeRef.current !== myRun) return; // stale 流守卫
      const kind = ev?.kind;
      const p = ev?.payload ?? {};
      switch (kind) {
        case "session":
          setSid(ev.session_id);
          break;
        case "decompose_start":
          setLog((prev) => [...prev, { id: ev.id ?? String(prev.length), parentId: ev.parentId, kind, text: p.title ?? "知识分解", depth: 0 }]);
          break;
        case "node": {
          setRfNodes((prev) => {
            if (prev.some((n) => n.id === p.id)) {
              // 已存在:升级 mastery 样式
              return prev.map((n) => (n.id === p.id ? { ...n, style: { ...n.style, background: p.mastery ? "#dcfce7" : n.style?.background, border: p.mastery ? "1px solid #16a34a" : n.style?.border } } : n));
            }
            const idx = prev.length;
            const pos = layoutPos(p.depth ?? 0, idx);
            return [...prev, {
              id: p.id,
              data: { label: p.title + (p.mastery ? " ✓" : "") },
              position: pos,
              style: p.mastery
                ? { background: "#dcfce7", border: "1px solid #16a34a", borderRadius: 6, fontSize: 12 }
                : { background: "#eef2ff", border: "1px solid #6366f1", borderRadius: 6, fontSize: 12 },
            }];
          });
          break;
        }
        case "edge": {
          setRfEdges((prev) => {
            const eid = `${p.from}-${p.to}`;
            if (prev.some((e) => e.id === eid)) return prev;
            return [...prev, {
              id: eid,
              source: p.from,
              target: p.to,
              label: p.type === "prerequisite_of" ? "前置" : "",
              animated: p.type === "decomposes_into",
              style: { stroke: p.type === "prerequisite_of" ? "#f59e0b" : "#6366f1" },
            }];
          });
          break;
        }
        case "graph": {
          // 最终完整图:替换当前 state(修正流式增量错位)
          const nodes: Node[] = (p.nodes ?? []).map((n: any, i: number) => ({
            id: n.id,
            data: { label: n.title + (n.mastery ? " ✓" : "") },
            position: layoutPos(n.depth ?? 0, i),
            style: n.mastery
              ? { background: "#dcfce7", border: "1px solid #16a34a", borderRadius: 6, fontSize: 12 }
              : { background: "#eef2ff", border: "1px solid #6366f1", borderRadius: 6, fontSize: 12 },
          }));
          const edges: Edge[] = (p.edges ?? []).map((e: any) => ({
            id: `${e.from}-${e.to}`,
            source: e.from,
            target: e.to,
            label: e.type === "prerequisite_of" ? "前置" : "",
            animated: e.type === "decomposes_into",
            style: { stroke: e.type === "prerequisite_of" ? "#f59e0b" : "#6366f1" },
          }));
          setRfNodes(nodes);
          setRfEdges(edges);
          break;
        }
        case "tool_call":
          setLog((prev) => [...prev, {
            id: ev.id ?? String(prev.length), parentId: ev.parentId, kind,
            text: `🔧 ${p.name}(${JSON.stringify(p.args ?? {}).slice(0, 100)})`, depth: 1,
          }]);
          break;
        case "tool_result":
          setLog((prev) => [...prev, {
            id: ev.id ?? String(prev.length), parentId: ev.parentId, kind,
            text: `↳ ${String(p.output ?? "").slice(0, 140)}`, depth: 2,
          }]);
          break;
        case "error":
          setLog((prev) => [...prev, { id: ev.id ?? String(prev.length), kind, text: ev.message ?? p.message ?? "错误", depth: 0 }]);
          break;
        case "done":
          break;
        default:
          break;
      }
    }
    setBusy(false);
  }, [question, fileText, busy]);

  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const txt = await uploadFile(f);
      setFileText(txt);
      setFileName(f.name);
    } catch (err: any) {
      setLog((prev) => [...prev, { id: String(prev.length), kind: "error", text: `上传失败: ${err.message}`, depth: 0 }]);
    }
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{FLOW_CSS}</style>
      <header className="p-3 border-b border-slate-200 flex gap-2 items-center bg-white" style={{ flex: "0 0 auto" }}>
        <span className="font-semibold text-slate-700 whitespace-nowrap">知识点分解</span>
        <input
          className="border border-slate-300 rounded px-2 py-1 flex-1 min-w-0"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          placeholder="输入 STEM 知识点,如 线性代数 / 什么是旋度"
          disabled={busy}
        />
        <input type="file" accept=".pdf,.txt,.md" ref={fileInputRef} onChange={onFile} className="hidden" />
        <button
          className="px-2 py-1 border border-slate-300 rounded text-sm text-slate-600 hover:bg-slate-50"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          title="上传 PDF/txt/md(可选)"
        >{fileName ? `📄 ${fileName.slice(0, 16)}` : "📄 附件"}</button>
        <button
          className="px-4 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          onClick={run}
          disabled={busy || !question.trim()}
        >{busy ? "分解中…" : "分解"}</button>
      </header>
      <div className="flex-1 flex min-h-0" style={{ flex: "1 1 0", minHeight: 0 }}>
        <div className="flex-1 relative min-w-0" style={{ flex: "1 1 0", position: "relative", minWidth: 0 }}>
          <ReactFlow nodes={rfNodes} edges={rfEdges} fitView proOptions={{ hideAttribution: true }} style={{ width: "100%", height: "100%" }}>
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
          {sid && (
            <div className="absolute top-2 left-2 text-xs font-mono text-slate-400 bg-white/70 px-2 py-1 rounded pointer-events-none">
              sid: {sid} · 节点 {rfNodes.length} · 边 {rfEdges.length}
              <br />
              <span style={{ color: "#16a34a" }}>■</span> 已掌握(高中) &nbsp;
              <span style={{ color: "#6366f1" }}>■</span> 待学 &nbsp;
              <span style={{ color: "#f59e0b" }}>─</span> 前置
            </div>
          )}
        </div>
        <aside className="w-80 border-l border-slate-200 overflow-auto p-2 text-xs font-mono bg-slate-50">
          <div className="text-slate-400 mb-1">执行流</div>
          {log.length === 0 && <div className="text-slate-400">点击「分解」开始…</div>}
          {log.map((l, i) => (
            <div key={l.id ?? i} style={{ paddingLeft: l.depth * 14 }} className="py-0.5 break-all">
              <span className="text-slate-400">[{l.kind}]</span>{" "}
              <span className={l.kind === "error" ? "text-red-600" : "text-slate-700"}>{l.text}</span>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
