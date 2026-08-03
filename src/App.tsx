import { useState, useCallback } from "react";
import { AppProvider, useApp } from "./store";
import ChatPanel from "./components/ChatPanel";
import StagePanel from "./components/StagePanel";
import ExplainPanel from "./components/ExplainPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import GraphApp from "./graph/GraphApp";
import MermaidPanel from "./components/MermaidPanel";

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

// 三栏可拖拽分隔:左栏宽度 / 右栏宽度存 state,两根 splitter(mousedown 拖拽)。
// 持久化到 localStorage,刷新后保留用户偏好。clamp 防过窄/过宽。
const LEFT_MIN = 220, LEFT_MAX = 560, RIGHT_MIN = 240, RIGHT_MAX = 620;
function loadWidths(): { left: number; right: number } {
  try {
    const raw = localStorage.getItem("panel-widths");
    if (raw) {
      const p = JSON.parse(raw);
      return {
        left: Math.min(LEFT_MAX, Math.max(LEFT_MIN, p.left ?? 300)),
        right: Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, p.right ?? 330)),
      };
    }
  } catch { /* ignore */ }
  return { left: 300, right: 330 };
}

function AppShell() {
  const [showSettings, setShowSettings] = useState(false);
  const { view, setView } = useApp();
  const [widths, setWidths] = useState(loadWidths);

  const startDrag = useCallback((side: "left" | "right") => (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === "left" ? widths.left : widths.right;
    const onMove = (ev: PointerEvent) => {
      if (side === "left") {
        const w = Math.min(LEFT_MAX, Math.max(LEFT_MIN, startW + (ev.clientX - startX)));
        setWidths((p) => ({ ...p, left: w }));
      } else {
        const w = Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, startW - (ev.clientX - startX)));
        setWidths((p) => ({ ...p, right: w }));
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidths((p) => { try { localStorage.setItem("panel-widths", JSON.stringify(p)); } catch { /* ignore */ } return p; });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [widths.left, widths.right]);

  return (
    <div className="flex h-screen w-screen flex-col text-[#dfe6f0]">
      {/* 顶部 header:三段式 — 品牌(左) / 舞台切换 segmented(中) / 操作(右) */}
      <header className="flex items-center gap-3 px-5 h-12 border-b border-[#1e293b] panel shrink-0">
        {/* 品牌 */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div
            className="w-7 h-7 rounded-lg grid place-items-center text-[14px] font-bold text-[#070a12] logo-glow"
            style={{ background: "linear-gradient(135deg,#5fb0ff,#2b6cb0)" }}
          >∑</div>
          <div className="flex flex-col leading-tight">
            <span className="font-semibold text-[13px] tracking-tight">Manim Agent</span>
            <span className="text-[9.5px] text-[#53606f] -mt-0.5">教学可视化智能体</span>
          </div>
        </div>

        {/* 中间舞台切换:segmented control 风格,主 agent 也会自动切换,互不冲突 */}
        <div className="mx-auto flex items-center gap-1 p-0.5 rounded-lg bg-[#0b0f18]/70 border border-[#1e293b]">
          {([
            { v: "animation", label: "动画", icon: "🎬", tip: "中间舞台显示动画" },
            { v: "graph", label: "分解", icon: "🕸", tip: "中间舞台显示知识分解图" },
            { v: "mermaid", label: "图示", icon: "📊", tip: "中间舞台显示 mermaid 图(流程/结构/关系类知识点)" },
          ] as const).map((b) => (
            <button
              key={b.v}
              onClick={() => setView(b.v)}
              title={b.tip}
              className={`px-2.5 py-1 rounded-md text-[11px] flex items-center gap-1 transition-all duration-200 ${view === b.v ? "btn-blue shadow-sm" : "text-[#6b7686] hover:text-[#dfe6f0] hover:bg-[#161f2e]"}`}
            >
              <span className="text-[10px] opacity-80">{b.icon}</span>{b.label}
            </button>
          ))}
        </div>

        {/* 操作区 */}
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="hidden md:flex items-center gap-1.5 text-[10.5px] text-[#53606f]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4a9eff] animate-pulse" /> 实时可交互
          </span>
          <span className="w-px h-4 bg-[#1e293b]" />
          <button className="btn-ghost px-2.5 py-1 rounded-md text-[11px] flex items-center gap-1" onClick={() => setShowSettings(true)}>
            <span className="text-[12px]">⚙</span>LLM
          </button>
        </div>
      </header>

      {/* 主体:三栏常驻。中间舞台区由 view 控制——动画(StagePanel)或分解图(GraphApp)。
          主 agent 通过 switch_stage 工具切换;分解图嵌入中间区(非全屏),左对话右讲解不变。
          左右两根 splitter 可拖拽调栏宽(存 localStorage)。 */}
      <main
        className="flex-1 min-h-0 grid bg-[#1e293b] relative"
        style={{ gridTemplateColumns: `${widths.left}px 5px minmax(0,1fr) 5px ${widths.right}px` }}
      >
        <section className="min-h-0 overflow-hidden bg-[#0b0f18]/80 backdrop-blur-md panel-anim">
          <ChatPanel />
        </section>
        {/* 左 splitter:拖拽改左栏宽 */}
        <div
          onPointerDown={startDrag("left")}
          className="splitter w-full cursor-col-resize shrink-0 z-10"
          title="拖拽调整左栏宽度"
        />
        <section className="min-h-0 overflow-hidden bg-[#0b0f18]/60 backdrop-blur-md relative panel-anim">
          {view === "graph" ? <GraphApp visible={true} embedded /> : view === "mermaid" ? <MermaidPanel /> : <StagePanel />}
        </section>
        {/* 右 splitter:拖拽改右栏宽 */}
        <div
          onPointerDown={startDrag("right")}
          className="splitter w-full cursor-col-resize shrink-0 z-10"
          title="拖拽调整右栏宽度"
        />
        <section className="min-h-0 overflow-hidden bg-[#0b0f18]/80 backdrop-blur-md panel-anim">
          <ExplainPanel />
        </section>
      </main>

      {/* 底部编排状态条 */}
      <footer className="flex items-center gap-3 px-5 h-7 border-t border-[#1e293b] panel text-[10px] text-[#53606f] shrink-0">
        <span className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-[#4a9eff]/60" />编排:主agent → 拆解 → 生成 → 校验</span>
        <span className="text-[#1e293b]">·</span>
        <span>数学/物理 → manim · 流程/结构 → mermaid</span>
        <span className="ml-auto text-[#4a5365]">manim-web · React 19 · KaTeX · Mermaid</span>
      </footer>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}
