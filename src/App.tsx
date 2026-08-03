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
      {/* 顶部 header */}
      <header className="flex items-center gap-3 px-5 h-12 border-b border-[#1e293b] panel shrink-0">
        <div className="flex items-center gap-2.5">
          <div
            className="w-6 h-6 rounded-md grid place-items-center text-[13px] font-bold text-[#070a12]"
            style={{ background: "linear-gradient(135deg,#4a9eff,#2b6cb0)" }}
          >∑</div>
          <span className="font-semibold text-[13px] tracking-tight">Manim Agent</span>
          <span className="chip">教学可视化智能体</span>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-[#6b7686]">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4a9eff]" /> 实时可交互 · 对话式重生成
          </span>
          <span className="text-[#1e293b]">|</span>
          {/* 中间舞台手动切换:动画 / 分解图。主 agent 也会自动切换,两者都设 view,互不冲突 */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[#4a5365] mr-1">舞台</span>
            <button
              onClick={() => setView("animation")}
              className={`px-2 py-0.5 rounded text-[11px] ${view === "animation" ? "btn-blue" : "btn-ghost"}`}
              title="中间舞台显示动画"
            >动画</button>
            <button
              onClick={() => setView("graph")}
              className={`px-2 py-0.5 rounded text-[11px] ${view === "graph" ? "btn-blue" : "btn-ghost"}`}
              title="中间舞台显示知识分解图"
            >分解</button>
            <button
              onClick={() => setView("mermaid")}
              className={`px-2 py-0.5 rounded text-[11px] ${view === "mermaid" ? "btn-blue" : "btn-ghost"}`}
              title="中间舞台显示 mermaid 图(流程/结构/关系类知识点)"
            >图示</button>
          </div>
          <span className="text-[#1e293b]">|</span>
          <button className="btn-ghost px-2 py-0.5 rounded text-[11px]" onClick={() => setShowSettings(true)}>⚙ LLM</button>
          <span className="text-[#1e293b]">|</span>
          <span className="text-[#9aa6b8]">MVP demo</span>
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
          className="w-full cursor-col-resize bg-[#1e293b] hover:bg-[#4a9eff]/50 active:bg-[#4a9eff]/80 transition-colors shrink-0 z-10"
          title="拖拽调整左栏宽度"
        />
        <section className="min-h-0 overflow-hidden bg-[#0b0f18]/60 backdrop-blur-md relative panel-anim">
          {view === "graph" ? <GraphApp visible={true} embedded /> : view === "mermaid" ? <MermaidPanel /> : <StagePanel />}
        </section>
        {/* 右 splitter:拖拽改右栏宽 */}
        <div
          onPointerDown={startDrag("right")}
          className="w-full cursor-col-resize bg-[#1e293b] hover:bg-[#4a9eff]/50 active:bg-[#4a9eff]/80 transition-colors shrink-0 z-10"
          title="拖拽调整右栏宽度"
        />
        <section className="min-h-0 overflow-hidden bg-[#0b0f18]/80 backdrop-blur-md panel-anim">
          <ExplainPanel />
        </section>
      </main>

      {/* 底部编排状态条 */}
      <footer className="flex items-center gap-3 px-5 h-7 border-t border-[#1e293b] panel text-[10px] text-[#6b7686] shrink-0">
        <span>编排:主agent → 拆解 → 生成 → 校验</span>
        <span className="text-[#1e293b]">|</span>
        <span>知识类型:数学/算法 · 计算流程</span>
        <span className="ml-auto text-[#4a5365]">manim-web · React 19 · KaTeX</span>
      </footer>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}
