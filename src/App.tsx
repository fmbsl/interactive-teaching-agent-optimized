import { useState } from "react";
import { AppProvider } from "./store";
import ChatPanel from "./components/ChatPanel";
import StagePanel from "./components/StagePanel";
import ExplainPanel from "./components/ExplainPanel";
import { SettingsPanel } from "./components/SettingsPanel";

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

function AppShell() {
  const [showSettings, setShowSettings] = useState(false);
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
          <button className="btn-ghost px-2 py-0.5 rounded text-[11px]" onClick={() => setShowSettings(true)}>⚙ LLM</button>
          <span className="text-[#1e293b]">|</span>
          <span className="text-[#9aa6b8]">MVP demo</span>
        </div>
      </header>

      {/* 三栏主体:用 gap 留呼吸感,中栏稍宽 */}
      <main className="flex-1 min-h-0 grid grid-cols-[300px_1fr_330px] gap-px bg-[#1e293b]">
        <section className="min-h-0 overflow-hidden bg-[#0b0f18]/80 backdrop-blur-md">
          <ChatPanel />
        </section>
        <section className="min-h-0 overflow-hidden bg-[#0b0f18]/60 backdrop-blur-md">
          <StagePanel />
        </section>
        <section className="min-h-0 overflow-hidden bg-[#0b0f18]/80 backdrop-blur-md">
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
