import { useState, useCallback, useEffect } from "react";
import { AppProvider, useApp } from "./store";
import ChatPanel from "./components/ChatPanel";
import StagePanel from "./components/StagePanel";
import ExplainPanel from "./components/ExplainPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import GraphApp from "./graph/GraphApp";
import { applyTheme, applyCustomCss, type ThemeId } from "./theme";
import { Settings } from "lucide-react";

export default function App() {
  // 访问令牌:优先 localStorage;否则若 URL 带 ?token= 则直接用并记住(评审拿完整 URL 直接进,不用输)。
  const [token, setToken] = useState(() => {
    const stored = localStorage.getItem("access_token");
    if (stored) return stored;
    const u = new URLSearchParams(window.location.search).get("token");
    if (u) { localStorage.setItem("access_token", u); return u; }
    return "";
  });
  if (!token) {
    return (
      <AccessGate onSave={(t) => { localStorage.setItem("access_token", t); setToken(t); }} />
    );
  }
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

function AccessGate({ onSave }: { onSave: (t: string) => void }) {
  const [val, setVal] = useState("");
  return (
    <div className="grid place-items-center h-screen w-screen bg-[var(--bg-deepest)] text-[var(--text)]">
      <form
        className="max-w-md w-full mx-4 p-6 rounded-xl border border-[var(--border)] bg-[var(--bg-panel)]"
        onSubmit={(e) => { e.preventDefault(); if (val.trim()) onSave(val.trim()); }}
      >
        <div className="text-[18px] font-semibold mb-1">Manim Agent</div>
        <div className="text-[11px] text-[var(--text-mute)] mb-4">输入访问令牌以继续使用。令牌在服务端的 <code className="text-[var(--blue-strong)]">backend/access_token.txt</code>(首次启动自动生成)。</div>
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Access Token"
          className="w-full bg-[var(--bg-1)] text-[var(--text)] text-[13px] px-3 py-2 rounded-md border border-[var(--border)] outline-none focus:border-[var(--blue)]/50 mb-3"
        />
        <button type="submit" className="w-full py-2 rounded-md bg-[var(--blue)] text-[var(--on-accent)] text-[13px] font-medium hover:bg-[var(--blue-strong)]">进入</button>
        <div className="text-[9px] text-[var(--text-faint)] mt-3 leading-relaxed">令牌能阻止陌生人访问你的会话 / 刷你的 LLM 额度。若后端还没生成令牌,重启后端后查看 backend/access_token.txt。</div>
      </form>
    </div>
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
  const { view, setView, theme, customCss, loadAppSettings } = useApp();
  const [widths, setWidths] = useState(loadWidths);

  // 主题/自定义 CSS 变更时重新应用(首次渲染前 main.tsx 已应用过,这里兜底同步)
  useEffect(() => { applyTheme(theme as ThemeId); }, [theme]);
  useEffect(() => { applyCustomCss(customCss); }, [customCss]);
  // 拉取后端应用级设置(如知识分解力度档位)
  useEffect(() => { void loadAppSettings(); }, [loadAppSettings]);

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
    <div className="flex h-screen w-screen flex-col text-[var(--text)]">
      {/* 顶部 header:三段式 — 品牌(左) / 舞台切换 segmented(中) / 操作(右) */}
      <header className="flex items-center gap-3 px-5 h-12 border-b border-[var(--border)] panel shrink-0">
        {/* 品牌 */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div
            className="w-7 h-7 rounded-lg grid place-items-center text-[14px] font-bold text-[var(--on-accent)] logo-glow"
            style={{ background: "linear-gradient(135deg,var(--blue-strong),var(--blue-deep))" }}
          >∑</div>
          <div className="flex flex-col leading-tight">
            <span className="font-semibold text-[13px] tracking-tight">Manim Agent</span>
            <span className="text-[9.5px] text-[var(--text-mute)] -mt-0.5">教学可视化智能体</span>
          </div>
        </div>

        {/* 中间舞台切换:segmented control 风格,主 agent 也会自动切换,互不冲突 */}
        <div className="mx-auto flex items-center gap-1 p-0.5 rounded-lg bg-[var(--bg-1)]/70 border border-[var(--border)]">
          {([
            { v: "animation", label: "动画", tip: "中间舞台显示动画" },
            { v: "graph", label: "分解", tip: "中间舞台显示知识分解图" },
          ] as const).map((b) => (
            <button
              key={b.v}
              onClick={() => setView(b.v)}
              title={b.tip}
              className={`px-2.5 py-1 rounded-md text-[11px] transition-all duration-200 ${view === b.v ? "btn-blue shadow-sm" : "text-[var(--text-mute)] hover:text-[var(--text)] hover:bg-[var(--bg-3)]"}`}
            >
              {b.label}
            </button>
          ))}
        </div>

        {/* 操作区 */}
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="hidden md:flex items-center gap-1.5 text-[10.5px] text-[var(--text-mute)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--blue)] animate-pulse" /> 实时可交互
          </span>
          <span className="w-px h-4 bg-[var(--border)]" />
          <button className="btn-ghost px-2.5 py-1 rounded-md text-[11px] flex items-center gap-1.5" onClick={() => setShowSettings(true)}>
            <Settings size={13} /> 设置
          </button>
        </div>
      </header>

      {/* 主体:三栏常驻。中间舞台区由 view 控制——动画(StagePanel)或分解图(GraphApp)。
          主 agent 通过 switch_stage 工具切换;分解图嵌入中间区(非全屏),左对话右讲解不变。
          左右两根 splitter 可拖拽调栏宽(存 localStorage)。 */}
      <main
        className="flex-1 min-h-0 grid bg-[var(--border)] relative"
        style={{ gridTemplateColumns: `${widths.left}px 5px minmax(0,1fr) 5px ${widths.right}px` }}
      >
        <section className="min-h-0 overflow-hidden bg-[var(--bg-1)]/80 backdrop-blur-md panel-anim">
          <ChatPanel />
        </section>
        {/* 左 splitter:拖拽改左栏宽 */}
        <div
          onPointerDown={startDrag("left")}
          className="splitter w-full cursor-col-resize shrink-0 z-10"
          title="拖拽调整左栏宽度"
        />
        <section className="min-h-0 overflow-hidden bg-[var(--bg-1)]/60 backdrop-blur-md relative panel-anim">
          {view === "graph" ? <GraphApp visible={true} embedded /> : <StagePanel />}
        </section>
        {/* 右 splitter:拖拽改右栏宽 */}
        <div
          onPointerDown={startDrag("right")}
          className="splitter w-full cursor-col-resize shrink-0 z-10"
          title="拖拽调整右栏宽度"
        />
        <section className="min-h-0 overflow-hidden bg-[var(--bg-1)]/80 backdrop-blur-md panel-anim">
          <ExplainPanel />
        </section>
      </main>

      {/* 底部编排状态条 */}
      <footer className="flex items-center gap-3 px-5 h-7 border-t border-[var(--border)] panel text-[10px] text-[var(--text-mute)] shrink-0">
        <span className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-[var(--blue)]/60" />编排:主agent → 拆解 → 生成 → 校验</span>
        <span className="text-[var(--border)]">·</span>
        <span>数学/物理/几何 → manim 动画</span>
        <span className="ml-auto text-[var(--text-faint)]">manim-web · React 19 · KaTeX</span>
      </footer>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}
