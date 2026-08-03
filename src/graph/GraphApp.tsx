import { useState, useRef, useCallback, useEffect } from "react";
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge, type Connection, type EdgeChange, type NodeChange, MarkerType, useNodesState, useEdgesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { uploadFile, decompose, decomposeToTopics, newSession } from "../data/llmClient";
import { useApp } from "../store";

// 深色主题。xyflow v12 的 .react-flow__edges 缺 width/height,强制铺满。
// 用默认 node(ReactFlow 内置)而非自定义 nodeTypes——自定义 node 在本环境会触发 ResizeObserver 不触发→visibility:hidden→边不画。
// 集合便签/别名塞进 data.label(React 节点),深色用 style 传。
const FLOW_CSS = `
.react-flow { background: var(--bg-0); }
.react-flow .react-flow__edges { width: 100%; height: 100%; }
.react-flow__edge-text { fill: var(--text-dim); font-size: 10px; }
.react-flow__edge-textbg { fill: transparent; }
.react-flow__controls { background: var(--bg-2); border: 1px solid var(--border); }
.react-flow__controls-button { background: var(--bg-2); color: var(--text); border-bottom: 1px solid var(--border); fill: var(--text); }
.react-flow__controls-button:hover { background: var(--bg-3); }
.react-flow__node { color: var(--text); visibility: visible !important; }
.react-flow__minimap { background: var(--bg-1); border: 1px solid var(--border); }
.react-flow__minimap svg { background: var(--bg-1); }
/* minimap 节点缩略图:确保可见(默认继承,深色底上用蓝/绿) */
.react-flow__minimap-node { fill: #4a9eff; }
`;

type LogItem = { id: string; parentId?: string | null; kind: string; text: string; depth: number };

// 分层布局:按 depth 分行(depth 0=root 最高级在最上,depth 越大越基础越往下),同层节点水平铺开。
// 列宽随该层节点数自适应,行高固定。返回 {id -> {x,y}} 位置映射。
const LAYER_ROW_H = 130;      // 行高(层间距)
const LAYER_NODE_W = 200;     // 单节点宽(含间距)
function layeredLayout(nodes: { id: string; depth: number }[]): Record<string, { x: number; y: number }> {
  // 按 depth 分组
  const byDepth = new Map<number, string[]>();
  for (const n of nodes) {
    const d = n.depth ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(n.id);
  }
  const pos: Record<string, { x: number; y: number }> = {};
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  for (const d of depths) {
    const ids = byDepth.get(d)!;
    const rowW = ids.length * LAYER_NODE_W;
    // depth 小(高级/目标/root)在上(y 小),depth 大(基础/前置)在下(y 大)。知识从下往上生长,箭头朝上。
    const y = d * LAYER_ROW_H;
    ids.forEach((id, i) => {
      // 同层水平居中铺开:第 i 个节点的 x 让整行以 0 为中心
      pos[id] = { x: i * LAYER_NODE_W - rowW / 2, y };
    });
  }
  return pos;
}

// 分解过程中增量到达的 node 事件用临时位置(等 graph 快照时统一重排)
const layoutPos = (depth: number, idx: number) => ({ x: (idx % 5) * LAYER_NODE_W - 2 * LAYER_NODE_W, y: depth * LAYER_ROW_H });

// 节点 label(React 节点):标题 + mastery✓ + 别名 + 集合便签
function nodeLabel(title: string, mastery: boolean, sets: string[], aliases: string[]) {
  return (
    <div style={{ padding: "4px 8px", fontSize: 12, maxWidth: 180 }}>
      <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}{mastery ? " ✓" : ""}</div>
      {aliases.length > 0 && <div style={{ fontSize: 10, color: "var(--text-mute)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>亦称:{aliases.join(" / ")}</div>}
      {sets.length > 0 && <div style={{ fontSize: 10, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sets.join(" › ")}</div>}
    </div>
  );
}

// 按 depth 色阶:depth 小(高级/目标/root)深蓝,depth 大(基础)浅青。mastery 已掌握用绿。
function depthColor(depth: number): { bg: string; border: string } {
  // 色相 215(深蓝)→175(青),随 depth 偏移明显;饱和度 75→50 降;亮度 28→58 升(越基础越浅)
  const d = Math.min(depth, 5);
  const h = 215 - d * 8;       // 215→175
  const s = 75 - d * 5;        // 75→50
  const l = 28 + d * 6;        // 28→58
  return { bg: `hsla(${h},${s}%,${l}%,0.20)`, border: `hsl(${h},${s}%,${l + 18}%)` };
}
function nodeStyle(mastery: boolean, depth: number = 0): React.CSSProperties {
  if (mastery) return { background: "rgba(22,163,74,0.16)", border: "1px solid #16a34a", borderRadius: 6, color: "var(--text)" };
  const c = depthColor(depth);
  return { background: c.bg, border: `1px solid ${c.border}`, borderRadius: 6, color: "var(--text)" };
}

const edgeStyle = { stroke: "var(--blue)", strokeWidth: 1.5 };
const edgeLabelStyle = { fill: "var(--text-dim)", fontSize: 10 };
const edgeLabelBgStyle = { fill: "transparent" };

function snapshotToNodesEdges(snap: any) {
  const raw: any[] = snap?.nodes ?? [];
  // 最终分层布局:按 depth 分行(root 最上,基础最下),同层水平铺开
  const pos = layeredLayout(raw.map((n) => ({ id: n.id, depth: n.depth ?? 0 })));
  const nodes: Node[] = raw.map((n: any) => ({
    id: n.id,
    data: { label: nodeLabel(n.title, !!n.mastery, n.sets ?? [], n.aliases ?? []) },
    position: pos[n.id] ?? { x: 0, y: 0 },
    style: nodeStyle(!!n.mastery, n.depth ?? 0),
    draggable: true,  // 允许用户拖拽节点调整位置(布局是初始建议,用户可自由重排)
    // 显式宽高:ReactFlow v12 的 minimap 依赖节点 measured 维度画缩略图,而 measured 由
    // ResizeObserver 异步填充。本环境/某些场景 RO 不触发 → measured 空 → minimap 不画节点。
    // 给 width/height 让 ReactFlow 直接用,不依赖 RO。与 nodeLabel 的 maxWidth:180 对齐。
    width: 180, height: 54,
  }));
  const edges: Edge[] = (snap?.edges ?? []).map((e: any) => ({
    id: `${e.from}-${e.to}`, source: e.from, target: e.to, type: "bezier",
    style: edgeStyle, labelStyle: edgeLabelStyle, labelBgStyle: edgeLabelBgStyle,
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--blue)", width: 18, height: 18 },
  }));
  return { nodes, edges };
}

export default function GraphApp({ visible = true, embedded = false }: { visible?: boolean; embedded?: boolean }) {
  const [question, setQuestion] = useState("");
  const [fileText, setFileText] = useState<string | undefined>(undefined);
  const [fileName, setFileName] = useState("");
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [log, setLog] = useState<LogItem[]>([]);
  const [rootTitle, setRootTitle] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [converting, setConverting] = useState(false);
  const [done, setDone] = useState(false);  // 分解是否跑完(允许转清单)
  const consumeRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { sessionId, setSessionId, setTopics, setView, decomposeGraph, setDecomposeGraph } = useApp();
  // sid 直接用 store.sessionId(图随 session 走);本地不再单独存 sid

  // 挂载/切会话/分解实时更新:store.decomposeGraph 变化即重建画布(分解过程中每次 graph 事件触发,节点逐步增加)
  useEffect(() => {
    if (decomposeGraph && decomposeGraph.snapshot) {
      const { nodes, edges } = snapshotToNodesEdges(decomposeGraph.snapshot);
      setRfNodes(nodes);
      setRfEdges(edges);
      setRootTitle(decomposeGraph.root_title || "");
      setQuestion(decomposeGraph.question || "");
      setDone(true);  // 已有图,允许直接转清单
    }
    // 切到无图的 session:清空画布
    if (!decomposeGraph && rfNodes.length > 0 && !busy) {
      setRfNodes([]); setRfEdges([]); setRootTitle(""); setDone(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decomposeGraph]);

  // 视图从 hidden 切到可见时:GraphApp 常驻 DOM,但 hidden(display:none) 下 ReactFlow 的
  // ResizeObserver 不触发 → 节点没测量 → minimap 不画节点缩略图。切可见后 dispatch resize
  // 让 ReactFlow 重算节点尺寸 + 重画 minimap。
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    return () => clearTimeout(t);
  }, [visible]);

  const run = useCallback(async () => {
    if (!question.trim() || busy) return;
    // 确保 session 存在(图要挂到 session 上);无 sessionId 先建
    let sid = sessionId;
    if (!sid) {
      try { sid = await newSession(); setSessionId(sid); }
      catch (e: any) { setLog((prev) => [...prev, { id: String(prev.length), kind: "error", text: `建会话失败: ${e.message}`, depth: 0 }]); return; }
    }
    setBusy(true); setDone(false); setRfNodes([]); setRfEdges([]); setLog([]);
    const myRun = ++consumeRef.current;
    const gen = decompose(sid, question, fileText);
    for await (const ev of gen) {
      if (consumeRef.current !== myRun) return;
      const kind = ev?.kind; const p = ev?.payload ?? {};
      switch (kind) {
        case "decompose_start":
          setRootTitle(p.title ?? "知识分解");
          setLog((prev) => [...prev, { id: ev.id ?? String(prev.length), parentId: ev.parentId, kind, text: p.title ?? "知识分解", depth: 0 }]);
          break;
        case "node":
          setRfNodes((prev) => {
            if (prev.some((n) => n.id === p.id)) {
              return prev.map((n) => n.id === p.id ? { ...n, data: { label: nodeLabel(p.title, !!p.mastery, p.sets ?? [], p.aliases ?? []) }, style: nodeStyle(!!p.mastery, p.depth ?? 0) } : n);
            }
            const idx = prev.length;
            return [...prev, { id: p.id, data: { label: nodeLabel(p.title, !!p.mastery, p.sets ?? [], p.aliases ?? []) }, position: layoutPos(p.depth ?? 0, idx), style: nodeStyle(!!p.mastery, p.depth ?? 0), draggable: true, width: 180, height: 54 }];
          });
          break;
        case "node_replaced":
          setRfNodes((prev) => prev.filter((n) => n.id !== p.removed));
          setRfEdges((prev) => prev.filter((e) => e.source !== p.removed && e.target !== p.removed));
          setLog((prev) => [...prev, { id: ev.id ?? String(prev.length), parentId: ev.parentId, kind, text: `✂ 替换「${p.title}」-> ${p.children?.length ?? 0} 子节点`, depth: 1 }]);
          break;
        case "edge":
          setRfEdges((prev) => { const eid = `${p.from}-${p.to}`; return prev.some((e) => e.id === eid) ? prev : [...prev, { id: eid, source: p.from, target: p.to, type: "bezier", style: edgeStyle, labelStyle: edgeLabelStyle, labelBgStyle: edgeLabelBgStyle, markerEnd: { type: MarkerType.ArrowClosed, color: "var(--blue)", width: 18, height: 18 } }]; });
          break;
        case "edge_removed":
          setRfEdges((prev) => prev.filter((e) => !(e.source === p.from && e.target === p.to)));
          break;
        case "graph": {
          const { nodes, edges } = snapshotToNodesEdges(p);
          setRfNodes(nodes); setRfEdges(edges);
          // 同步到 store.decomposeGraph(随 session 持久化,刷新/切会话可恢复)
          setDecomposeGraph({ question, root_title: rootTitle || `知识分解 · ${question.slice(0, 40)}`, snapshot: p });
          break;
        }
        case "tool_call":
          setLog((prev) => [...prev, { id: ev.id ?? String(prev.length), parentId: ev.parentId, kind, text: `🔧 ${p.name}(${JSON.stringify(p.args ?? {}).slice(0, 120)})`, depth: 1 }]);
          break;
        case "tool_result":
          setLog((prev) => [...prev, { id: ev.id ?? String(prev.length), parentId: ev.parentId, kind, text: `↳ ${String(p.output ?? "").slice(0, 160)}`, depth: 2 }]);
          break;
        case "error":
          setLog((prev) => [...prev, { id: ev.id ?? String(prev.length), kind, text: ev.message ?? p.message ?? "错误", depth: 0 }]);
          break;
        default: break;
      }
    }
    setBusy(false);
    setDone(true);  // 流结束(无论 LLM 是否调 finish),允许转清单
  }, [question, fileText, busy, sessionId, rootTitle, setSessionId, setDecomposeGraph]);

  // 把分解 DAG 转成学习清单,写入该 session 的 topics,切到教学视图
  const toTopics = useCallback(async () => {
    if (!sessionId || converting) return;
    setConverting(true);
    try {
      const { topic } = await decomposeToTopics(sessionId, rootTitle.replace(/^知识分解 · /, ""));
      setTopics([topic]);
      setView("animation");
    } catch (err: any) {
      setLog((prev) => [...prev, { id: String(prev.length), kind: "error", text: `转清单失败: ${err.message}`, depth: 0 }]);
    } finally {
      setConverting(false);
    }
  }, [sessionId, converting, rootTitle, setTopics, setView]);

  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const txt = await uploadFile(f); setFileText(txt); setFileName(f.name); }
    catch (err: any) { setLog((prev) => [...prev, { id: String(prev.length), kind: "error", text: `上传失败: ${err.message}`, depth: 0 }]); }
  }, []);

  const inputStyle: React.CSSProperties = { background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px" };

  return (
    <div className="stage-transition" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", overflow: "hidden", color: "var(--text)" }}>
      <style>{FLOW_CSS}</style>
      <header className="panel" style={{ flex: "0 0 auto", padding: embedded ? "4px 8px" : "8px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {!embedded && <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>知识点分解</span>}
        <input style={{ ...inputStyle, flex: 1, minWidth: 120 }} value={question} onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }} placeholder="输入 STEM 知识点" disabled={busy} />
        <input type="file" accept=".pdf,.txt,.md" ref={fileInputRef} onChange={onFile} className="hidden" />
        {!embedded && <button className="btn-ghost" style={{ padding: "4px 10px", fontSize: 13, borderRadius: 4 }} onClick={() => fileInputRef.current?.click()} disabled={busy}>{fileName ? `📄 ${fileName.slice(0, 16)}` : "📄 附件"}</button>}
        <button className="btn-blue" style={{ padding: "4px 12px", borderRadius: 4, fontSize: 13 }} onClick={run} disabled={busy || !question.trim()}>{busy ? "分解中…" : "分解"}</button>
        <button className="btn-blue" style={{ padding: "4px 10px", borderRadius: 4, fontSize: 13 }} onClick={toTopics} disabled={converting || !done || rfNodes.length === 0} title="把分解图按前置依赖拓扑排序,生成学习清单">{converting ? "转换中…" : "转为学习清单 →"}</button>
      </header>
      {rootTitle && !embedded && (
        <div style={{ flex: "0 0 auto", padding: "6px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-1)", fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>分解目标:</span>
          <span style={{ color: "var(--text)" }}>{rootTitle.replace(/^知识分解 · /, "")}</span>
          <span style={{ color: "var(--text-mute)", marginLeft: "auto" }}>双击节点手动拆分</span>
        </div>
      )}
      <div className="flex-1 flex min-h-0" style={{ flex: "1 1 0", minHeight: 0 }}>
        <div className="flex-1 relative min-w-0" style={{ flex: "1 1 0", position: "relative", minWidth: 0, minHeight: 0 }}>
          <ReactFlow nodes={rfNodes} edges={rfEdges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView proOptions={{ hideAttribution: true }} style={{ width: "100%", height: "100%" }}>
            <Background color="#1e293b" gap={20} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n: any) => {
              const bg = String((n.style as any)?.background || "");
              if (bg.includes("163,74")) return "#16a34a";  // mastery 绿
              // 提取 hsla 里的色相,映射到纯色供 minimap 显示
              const m = bg.match(/hsla\((\d+)/);
              if (m) { const h = +m[1]; return `hsl(${h},65%,50%)`; }
              return "#4a9eff";
            }} />
          </ReactFlow>
          {sessionId && (
            <div style={{ position: "absolute", top: 8, left: 8, fontSize: 11, fontFamily: "monospace", color: "var(--text-mute)", background: "rgba(7,10,18,0.7)", padding: "4px 8px", borderRadius: 4, pointerEvents: "none" }}>
              节点 {rfNodes.length} · 边 {rfEdges.length}
              <br /><span style={{ color: "#16a34a" }}>■</span> 已掌握 &nbsp;<span style={{ color: "var(--blue)" }}>■</span> 待学 &nbsp;<span style={{ color: "var(--blue)" }}>─</span> 前置
            </div>
          )}
        </div>
        {!embedded && (
          <aside style={{ flex: "0 0 20rem", width: 320, borderLeft: "1px solid var(--border)", overflow: "auto", padding: 8, fontSize: 12, fontFamily: "monospace", background: "var(--bg-1)" }}>
            <div style={{ color: "var(--text-mute)", marginBottom: 4 }}>执行流</div>
            {log.length === 0 && <div style={{ color: "var(--text-mute)" }}>点击「分解」开始…</div>}
            {log.map((l, i) => (
              <div key={l.id ?? i} style={{ paddingLeft: l.depth * 14, padding: "2px 0", wordBreak: "break-all" }}>
                <span style={{ color: "var(--text-mute)" }}>[{l.kind}]</span>{" "}
                <span style={{ color: l.kind === "error" ? "#f87171" : l.kind === "node_replaced" || l.kind === "split" ? "var(--blue-strong)" : "var(--text-dim)" }}>{l.text}</span>
              </div>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}
