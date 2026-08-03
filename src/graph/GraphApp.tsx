import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { ReactFlow, Background, Controls, MiniMap, Position, SelectionMode, type Node, type Edge, type Connection, type EdgeChange, type NodeChange, MarkerType, useNodesState, useEdgesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { uploadFile, decompose, decomposeToTopics, decomposeEdit, decomposeAutoSplit, newSession } from "../data/llmClient";
import { useApp } from "../store";
import { Wrench, Paperclip, ListPlus, Pencil, Trash2, GraduationCap, Split, Merge, Plus, X } from "lucide-react";

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

// 拓扑分层布局:用 edges 算每个节点的依赖层级,基础(入度 0)在最下层,沿依赖向上递增,
// 高级目标(被依赖最多的)在最上层。箭头 from(基础,下)->to(高级,上)自然朝上。
// 不用 depth 字段:depth 是递归拆解深度,children 和 prereqs 共用同一 new_depth,
// 导致基础和高级混在同一层,无法靠 depth 区分。拓扑层级才是真正的"基础/高级"序。
// level = 该节点到任意入度 0 基础节点的最长路径长度。入度 0 -> level 0(最下)。
const LAYER_ROW_H = 130;      // 行高(层间距)
const LAYER_NODE_W = 200;     // 单节点宽(含间距)
function layeredLayout(nodes: { id: string }[], edges: { from: string; to: string }[]): Record<string, { x: number; y: number }> {
  // 拓扑最长路径求 level(DAG)。入度 0 的 level=0(最基础,最下),其余 level = max(前驱 level)+1。
  const ids = new Set(nodes.map((n) => n.id));
  const inDeg: Record<string, number> = {};
  const outAdj: Record<string, string[]> = {};
  for (const id of ids) { inDeg[id] = 0; outAdj[id] = []; }
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    // 防重复边累加入度
    if (!outAdj[e.from].includes(e.to)) {
      outAdj[e.from].push(e.to);
      inDeg[e.to] += 1;
    }
  }
  // Kahn,同时算最长路径 level
  const level: Record<string, number> = {};
  let queue: string[] = [];
  for (const id of ids) if (inDeg[id] === 0) { level[id] = 0; queue.push(id); }
  let processed = 0;
  while (queue.length) {
    const next: string[] = [];
    for (const n of queue) {
      processed += 1;
      for (const m of outAdj[n]) {
        level[m] = Math.max(level[m] ?? 0, level[n] + 1);
        inDeg[m] -= 1;
        if (inDeg[m] === 0) next.push(m);
      }
    }
    queue = next;
  }
  // 环或断裂的残留节点(没被 Kahn 处理):兜底 level=已分配的最大 level,放最上层防丢
  if (processed < ids.size) {
    const maxL = Object.values(level).reduce((a, b) => Math.max(a, b), 0);
    for (const id of ids) if (!(id in level)) level[id] = maxL;
  }

  // 按 level 分组,同层水平居中铺开
  const byLevel = new Map<number, string[]>();
  for (const n of nodes) {
    const l = level[n.id] ?? 0;
    if (!byLevel.has(l)) byLevel.set(l, []);
    byLevel.get(l)!.push(n.id);
  }
  const pos: Record<string, { x: number; y: number }> = {};
  for (const l of byLevel.keys()) {
    const ids2 = byLevel.get(l)!;
    const rowW = ids2.length * LAYER_NODE_W;
    // level 0(基础)在下(y 大),level 大(高级)在上(y 小)。y = -level * 行高,基础在正 y。
    const y = -l * LAYER_ROW_H;
    ids2.forEach((id, i) => {
      pos[id] = { x: i * LAYER_NODE_W - rowW / 2, y };
    });
  }
  return pos;
}

// 分解过程中增量到达的 node 事件用临时位置(按到达序铺一行);每步 expand_node 后会发 graph 快照统一拓扑重排
const layoutPos = (_depth: number, idx: number) => ({ x: (idx % 5) * LAYER_NODE_W - 2 * LAYER_NODE_W, y: 0 });

// 计算节点的所有祖先(前置上游)和后代(后续下游),用于点击高亮。
// edges: from(基础) -> to(高级)。父=上游(to==当前 的 from,递归),子=下游(from==当前 的 to,递归)。
function relatives(id: string, edges: { from: string; to: string }[]): { ancestors: Set<string>; descendants: Set<string> } {
  const ancestors = new Set<string>();
  const descendants = new Set<string>();
  const adjTo: Record<string, string[]> = {};  // to -> [from,...]
  const adjFrom: Record<string, string[]> = {};  // from -> [to,...]
  for (const e of edges) {
    (adjTo[e.to] = adjTo[e.to] || []).push(e.from);
    (adjFrom[e.from] = adjFrom[e.from] || []).push(e.to);
  }
  const walk = (start: string, adj: Record<string, string[]>, acc: Set<string>) => {
    const stack = [start];
    while (stack.length) {
      const n = stack.pop()!;
      for (const m of adj[n] || []) {
        if (!acc.has(m)) { acc.add(m); stack.push(m); }
      }
    }
  };
  walk(id, adjTo, ancestors);
  walk(id, adjFrom, descendants);
  return { ancestors, descendants };
}

// 节点 label(React 节点):标题 + mastery✓ + 别名 + 集合便签
// 边的出入锚点由节点的 sourcePosition=Top / targetPosition=Bottom 控制(见 snapshotToNodesEdges),
// 让每条边从下面节点的顶边出、到上面节点的底边入,箭头统一朝上。
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
const edgeStyleDim = { stroke: "#1e293b", strokeWidth: 1 };
const edgeStyleHi = { stroke: "#5fb0ff", strokeWidth: 2.2 };
const edgeLabelStyle = { fill: "var(--text-dim)", fontSize: 10 };
const edgeLabelBgStyle = { fill: "transparent" };

function snapshotToNodesEdges(snap: any, selectedId: string | null = null) {
  const raw: any[] = snap?.nodes ?? [];
  const rawEdges: { from: string; to: string }[] = (snap?.edges ?? []).map((e: any) => ({ from: e.from, to: e.to }));
  // 拓扑分层:按 edges 算依赖层级,基础(入度 0)最下,高级目标最上,箭头自然朝上
  const pos = layeredLayout(raw.map((n) => ({ id: n.id })), rawEdges);
  // 点击高亮:选中节点 + 其祖先(父/前置) + 后代(子/后续)。其余节点淡化。
  let hiSet: Set<string> | null = null;
  if (selectedId) {
    const { ancestors, descendants } = relatives(selectedId, rawEdges);
    hiSet = new Set([selectedId, ...ancestors, ...descendants]);
  }
  const nodes: Node[] = raw.map((n: any) => {
    const dim = hiSet ? !hiSet.has(n.id) : false;
    return {
      id: n.id,
      data: { label: nodeLabel(n.title, !!n.mastery, n.sets ?? [], n.aliases ?? []) },
      position: pos[n.id] ?? { x: 0, y: 0 },
      style: { ...nodeStyle(!!n.mastery, n.depth ?? 0), ...(dim ? { opacity: 0.3 } : {}),
               ...(selectedId === n.id ? { boxShadow: "0 0 0 2px #5fb0ff", zIndex: 10 } : {}) },
      sourcePosition: Position.Top,
      targetPosition: Position.Bottom,
      draggable: true,
      width: 180, height: 54,
    };
  });
  const edges: Edge[] = (snap?.edges ?? []).map((e: any) => {
    const involved = hiSet ? (hiSet.has(e.from) && hiSet.has(e.to)) : false;
    const dim = hiSet ? !involved : false;
    return {
      id: `${e.from}-${e.to}`, source: e.from, target: e.to, type: "bezier",
      style: hiSet ? (involved ? edgeStyleHi : edgeStyleDim) : edgeStyle,
      labelStyle: edgeLabelStyle, labelBgStyle: edgeLabelBgStyle,
      markerEnd: { type: MarkerType.ArrowClosed, color: involved ? "#5fb0ff" : "var(--blue)", width: 18, height: 18 },
      ...(dim ? { animated: false } : {}),
    };
  });
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
  const [selectedId, setSelectedId] = useState<string | null>(null);  // 点击高亮的节点 id(高亮其父/子)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeIds: string[] } | null>(null);  // 右键菜单(单/多选)
  const consumeRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef<string | null>(null);  // 高亮节点的 ref(effect 内读,不进依赖)
  selectedIdRef.current = selectedId;
  const selectedNodesRef = useRef<Set<string>>(new Set());  // 框选多选(右键菜单用)
  const { sessionId, setSessionId, setTopics, setView, decomposeGraph, setDecomposeGraph } = useApp();
  // sid 直接用 store.sessionId(图随 session 走);本地不再单独存 sid

  // 挂载/切会话/分解实时更新:store.decomposeGraph 变化即重建画布(分解过程中每次 graph 事件触发,节点逐步增加)
  useEffect(() => {
    if (decomposeGraph && decomposeGraph.snapshot) {
      const { nodes, edges } = snapshotToNodesEdges(decomposeGraph.snapshot, selectedIdRef.current);
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

  // 点击高亮:selectedId 变化时,重算节点/边样式(高亮选中+父+子,淡化其余)。不重排位置,只改 style。
  useEffect(() => {
    if (!decomposeGraph?.snapshot) return;
    const { nodes, edges } = snapshotToNodesEdges(decomposeGraph.snapshot, selectedId);
    setRfNodes(nodes);
    setRfEdges(edges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

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
          const { nodes, edges } = snapshotToNodesEdges(p, selectedIdRef.current);
          setRfNodes(nodes); setRfEdges(edges);
          // 同步到 store.decomposeGraph(随 session 持久化,刷新/切会话可恢复)
          setDecomposeGraph({ question, root_title: rootTitle || `知识分解 · ${question.slice(0, 40)}`, snapshot: p });
          break;
        }
        case "tool_call":
          setLog((prev) => [...prev, { id: ev.id ?? String(prev.length), parentId: ev.parentId, kind, text: `工具 ${p.name}(${JSON.stringify(p.args ?? {}).slice(0, 120)})`, depth: 1 }]);
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

  // 右键菜单操作:调后端 edit/auto_split 端点(绕过 LLM 即时改图),成功后刷新画布
  const applyEdit = useCallback(async (op: string, params: Record<string, any>) => {
    if (!sessionId) return;
    try {
      const data = op === "auto_split"
        ? await decomposeAutoSplit(sessionId, params.target)
        : await decomposeEdit(sessionId, op, params);
      const snap = (data as any).graph;
      if (snap) {
        const prev = decomposeGraph;
        setDecomposeGraph({ question: prev?.question || "", root_title: prev?.root_title || "", snapshot: snap });
      }
      // add_to_topics 要刷新 store.topics(后端已追加,前端需重新拉 session)
      if (op === "add_to_topics") {
        // 简化:提示用户切到对话栏看(主 agent 下次对话会带最新 topics)。或主动拉 session_detail。
        setLog((prev) => [...prev, { id: String(prev.length), kind: "tool_result", text: (data as any).message, depth: 0 }]);
      }
    } catch (e: any) {
      setLog((prev) => [...prev, { id: String(prev.length), kind: "error", text: `${op} 失败: ${e.message}`, depth: 0 }]);
    }
  }, [sessionId, decomposeGraph, setDecomposeGraph]);

  // 右键菜单点击处理。inputValue 用于修改/合并/添加(由 ContextMenu 内置弹窗提供,非 window.prompt)
  const onMenu = useCallback(async (action: string, ids: string[], inputValue?: string) => {
    setContextMenu(null);
    if (!sessionId) return;
    const snap = decomposeGraph?.snapshot;
    const titleOf = (id: string) => (snap?.nodes?.find((n: any) => n.id === id)?.title) || "";
    const ts = ids.map(titleOf).filter(Boolean);
    if (action === "add") {
      // 空白右键添加:ids 为空,inputValue 是新标题
      if (inputValue && inputValue.trim()) await applyEdit("add", { title: inputValue.trim(), mastery: false });
    } else if (ids.length === 0) {
      return;
    } else if (action === "remove") {
      for (const t of ts) await applyEdit("remove", { title: t });
    } else if (action === "set_mastered") {
      for (const t of ts) await applyEdit("set_mastered", { title: t, mastered: true });
    } else if (action === "unset_mastered") {
      for (const t of ts) await applyEdit("set_mastered", { title: t, mastered: false });
    } else if (action === "add_to_topics") {
      await applyEdit("add_to_topics", { titles: ts });
    } else if (action === "split" && ts.length === 1) {
      await applyEdit("auto_split", { target: ts[0] });
    } else if (action === "rename" && ts.length === 1) {
      if (inputValue && inputValue.trim()) await applyEdit("rename", { title: ts[0], new_title: inputValue.trim() });
    } else if (action === "merge" && ts.length >= 2) {
      if (inputValue && inputValue.trim()) await applyEdit("merge", { titles: ts, new_title: inputValue.trim() });
    }
  }, [sessionId, decomposeGraph, applyEdit]);

  const inputStyle: React.CSSProperties = { background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px" };

  return (
    <div className="stage-transition" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", overflow: "hidden", color: "var(--text)" }}>
      <style>{FLOW_CSS}</style>
      {/* embedded(中间舞台):无顶栏,画布占满;分解由主 agent 对话触发。非 embedded(独立页)保留输入框+分解按钮 */}
      {!embedded && (
        <header className="panel" style={{ flex: "0 0 auto", padding: "8px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>知识点分解</span>
          <input style={{ ...inputStyle, flex: 1, minWidth: 120 }} value={question} onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }} placeholder="输入 STEM 知识点" disabled={busy} />
          <input type="file" accept=".pdf,.txt,.md" ref={fileInputRef} onChange={onFile} className="hidden" />
          <button className="btn-ghost inline-flex items-center gap-1" style={{ padding: "4px 10px", fontSize: 13, borderRadius: 4 }} onClick={() => fileInputRef.current?.click()} disabled={busy}><Paperclip size={13} /> {fileName ? fileName.slice(0, 16) : "附件"}</button>
          <button className="btn-blue" style={{ padding: "4px 12px", borderRadius: 4, fontSize: 13 }} onClick={run} disabled={busy || !question.trim()}>{busy ? "分解中…" : "分解"}</button>
        </header>
      )}
      {rootTitle && !embedded && (
        <div style={{ flex: "0 0 auto", padding: "6px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-1)", fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>分解目标:</span>
          <span style={{ color: "var(--text)" }}>{rootTitle.replace(/^知识分解 · /, "")}</span>
        </div>
      )}
      <div className="flex-1 flex min-h-0" style={{ flex: "1 1 0", minHeight: 0 }}>
        <div className="flex-1 relative min-w-0" style={{ flex: "1 1 0", position: "relative", minWidth: 0, minHeight: 0 }}>
          <ReactFlow
            nodes={rfNodes} edges={rfEdges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onNodeClick={(_e, node) => setSelectedId((cur) => cur === node.id ? null : node.id)}
            onPaneClick={() => setSelectedId(null)}
            onNodeContextMenu={(e, node) => {
              e.preventDefault();
              const ids = selectedNodesRef.current.has(node.id) && selectedNodesRef.current.size > 1
                ? [...selectedNodesRef.current] : [node.id];
              setContextMenu({ x: e.clientX, y: e.clientY, nodeIds: ids });
            }}
            onPaneContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, nodeIds: [] });  // 空白右键:添加节点
            }}
            onSelectionChange={({ nodes: sel }) => { selectedNodesRef.current = new Set(sel.map((n) => n.id)); }}
            selectionOnDrag selectionMode={SelectionMode.Partial} multiSelectionKeyCode="Shift" panOnDrag={false}
            fitView proOptions={{ hideAttribution: true }} style={{ width: "100%", height: "100%" }}>
            <Background color="#1e293b" gap={20} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n: any) => {
              const bg = String((n.style as any)?.background || "");
              if (bg.includes("163,74")) return "#16a34a";
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
          {/* 悬浮:全部导入知识清单(右下角)。分解完成后可用 */}
          {sessionId && rfNodes.length > 0 && (
            <button
              onClick={toTopics}
              disabled={converting || !done}
              title="把整张分解图按前置依赖拓扑排序,生成学习清单"
              className="btn-blue flex items-center gap-1.5 shadow-lg"
              style={{ position: "absolute", right: 14, bottom: 14, padding: "8px 14px", borderRadius: 8, fontSize: 13, opacity: converting || !done ? 0.5 : 1 }}>
              <ListPlus size={15} /> {converting ? "导入中…" : "全部导入知识清单"}
            </button>
          )}
        </div>
        {!embedded && (
          <aside style={{ flex: "0 0 20rem", width: 320, borderLeft: "1px solid var(--border)", overflow: "auto", padding: 8, fontSize: 12, fontFamily: "monospace", background: "var(--bg-1)" }}>
            <div style={{ color: "var(--text-mute)", marginBottom: 4 }}>执行流</div>
            {log.length === 0 && <div style={{ color: "var(--text-mute)" }}>在对话栏让主 agent 分解知识点…</div>}
            {log.map((l, i) => (
              <div key={l.id ?? i} style={{ paddingLeft: l.depth * 14, padding: "2px 0", wordBreak: "break-all" }}>
                <span style={{ color: "var(--text-mute)" }}>[{l.kind}]</span>{" "}
                <span style={{ color: l.kind === "error" ? "#f87171" : l.kind === "node_replaced" || l.kind === "split" ? "var(--blue-strong)" : "var(--text-dim)" }}>{l.text}</span>
              </div>
            ))}
          </aside>
        )}
      </div>
      {/* 右键菜单:节点(单/多选)或空白(添加)。portal 到 body,定位不受祖先影响 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y} nodeIds={contextMenu.nodeIds}
          masteredMap={Object.fromEntries((decomposeGraph?.snapshot?.nodes || []).map((n: any) => [n.id, !!n.mastery]))}
          onAction={(action, ids, val) => onMenu(action, ids, val)}
          onClose={() => setContextMenu(null)} />
      )}
    </div>
  );
}

// 右键菜单组件:portal 到 body(不受祖先 transform/onClick 影响,定位准)。
// nodeIds 空=空白右键(添加);单选=修改/删除/已学习切换/拆分/加入清单;多选=删除/已学习切换/合并/加入清单。
// masteredMap: id->mastery,决定"标记/取消已学习"的文案。输入类操作(修改/合并/添加)用内置弹窗,不用 window.prompt。
function ContextMenu({ x, y, nodeIds, masteredMap, onAction, onClose }: {
  x: number; y: number; nodeIds: string[];
  masteredMap: Record<string, boolean>;
  onAction: (action: string, ids: string[], inputValue?: string) => void;
  onClose: () => void;
}) {
  const [prompting, setPrompting] = useState<{ label: string; action: string; def: string } | null>(null);
  const [inputVal, setInputVal] = useState("");
  const multi = nodeIds.length > 1;
  const empty = nodeIds.length === 0;
  // 选中节点的 mastery:全已掌握->显示"取消已学习",否则"标记已学习"
  const allMastered = nodeIds.length > 0 && nodeIds.every((id) => masteredMap[id]);
  const masteredLabel = allMastered ? "取消已学习" : "标记已学习";
  const masteredAction = allMastered ? "unset_mastered" : "set_mastered";
  const items: { action: string; label: string; icon: any; danger?: boolean; needInput?: string }[] = empty
    ? [{ action: "add", label: "添加知识点", icon: Plus, needInput: "输入新知识点标题:" }]
    : multi
      ? [
          { action: "remove", label: "删除选中", icon: Trash2, danger: true },
          { action: masteredAction, label: masteredLabel, icon: GraduationCap },
          { action: "merge", label: "合并选中…", icon: Merge, needInput: `合并 ${nodeIds.length} 个节点为新节点,标题:` },
          { action: "add_to_topics", label: "加入至知识清单", icon: ListPlus },
        ]
      : [
          { action: "rename", label: "修改…", icon: Pencil, needInput: "修改为:" },
          { action: "remove", label: "删除", icon: Trash2, danger: true },
          { action: masteredAction, label: masteredLabel, icon: GraduationCap },
          { action: "split", label: "拆分(agent自动)", icon: Split },
          { action: "add_to_topics", label: "加入至知识清单", icon: ListPlus },
        ];
  // 防菜单超出视口/负坐标
  const left = Math.max(8, Math.min(x, window.innerWidth - 210));
  const top = Math.max(8, Math.min(y, window.innerHeight - items.length * 34 - 16));
  const menu = (
    <div onClick={(e) => e.stopPropagation()} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{ position: "fixed", left, top, zIndex: 9999, minWidth: 190, background: "rgba(11,15,24,0.97)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", padding: 4, backdropFilter: "blur(8px)" }}>
      {items.map((it) => (
        <button key={it.action}
          onClick={() => {
            if (it.needInput) {
              setPrompting({ label: it.needInput, action: it.action, def: it.action === "rename" ? (masteredMap[nodeIds[0]] != null ? "" : "") : "" });
              setInputVal("");
            } else {
              onAction(it.action, nodeIds);
            }
          }}
          className={`w-full flex items-center gap-2 text-left text-[12px] px-2.5 py-1.5 rounded transition-colors ${it.danger ? "text-[#fca5a5] hover:bg-[#ef4444]/12" : "text-[#dfe6f0] hover:bg-[#161f2e]"}`}>
          <it.icon size={14} /> {it.label}
        </button>
      ))}
      {prompting && (
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{prompting.label}</div>
          <input autoFocus value={inputVal} onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && inputVal.trim()) { onAction(prompting.action, nodeIds, inputVal.trim()); } else if (e.key === "Escape") setPrompting(null); }}
            placeholder="标题" style={{ background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 6px", fontSize: 12, outline: "none" }} />
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => { if (inputVal.trim()) onAction(prompting.action, nodeIds, inputVal.trim()); }}
              className="btn-blue" style={{ flex: 1, padding: "3px 6px", borderRadius: 4, fontSize: 11 }}>确定</button>
            <button onClick={() => setPrompting(null)} className="btn-ghost" style={{ flex: 1, padding: "3px 6px", borderRadius: 4, fontSize: 11 }}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
  // 点菜单外关闭:用一个全屏透明层捕获点击。菜单用 portal 渲染到 body,不受祖先 transform/onClick 影响。
  return createPortal(
    <>
      <div onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}
        style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
      {menu}
    </>,
    document.body,
  );
}
