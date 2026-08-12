import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { AppProvider, useApp } from "./store";
import ChatPanel from "./components/ChatPanel";
import StagePanel from "./components/StagePanel";
import ExplainPanel from "./components/ExplainPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import GraphApp from "./graph/GraphApp";
import { applyTheme, applyCustomCss, type ThemeId } from "./theme";
import { Settings, Play, FileText, Network } from "lucide-react";

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

function AppShell() {
  const [showSettings, setShowSettings] = useState(false);
  const { stageOpen, setStageOpen, explainOpen, setExplainOpen, graphOpen, setGraphOpen, theme, customCss, loadAppSettings } = useApp();
  // 平铺排布:主 agent 对话恒在最左;中列 = 动画(上)+ 分解图(下),右列 = 讲解。打开哪些窗口自由组合,互不遮挡。
  const anyWindow = stageOpen || explainOpen || graphOpen;
  const middleHas = stageOpen || graphOpen;   // 中列存在条件
  const rightHas = explainOpen;               // 右列(讲解)存在条件

  // 列宽可拖拽:聊天列 / 讲解列宽度存 state + localStorage(推拉自由裁量),动画中列 flex 填充。
  const CHAT_MIN = 300, CHAT_MAX = 640, RIGHT_MIN = 280, RIGHT_MAX = 560;
  const loadW = (side: "left" | "right", def: number) => {
    try {
      const p = JSON.parse(localStorage.getItem("panel-widths") || "{}");
      const v = side === "left" ? p.left : p.right;
      if (typeof v === "number") return Math.min(side === "left" ? CHAT_MAX : RIGHT_MAX, Math.max(side === "left" ? CHAT_MIN : RIGHT_MIN, v));
    } catch { /* ignore */ }
    return def;
  };
  const [chatW, setChatW] = useState(() => loadW("left", 420));
  const [rightW, setRightW] = useState(() => loadW("right", 340));
  const chatWRef = useRef(chatW); chatWRef.current = chatW;
  const rightWRef = useRef(rightW); rightWRef.current = rightW;
  const startDrag = (which: "chat" | "right") => (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = which === "chat" ? chatWRef.current : rightWRef.current;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (which === "chat") {
        const v = Math.min(CHAT_MAX, Math.max(CHAT_MIN, startW + dx));
        chatWRef.current = v; setChatW(v);
      } else {
        const v = Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, startW - dx));
        rightWRef.current = v; setRightW(v);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem("panel-widths", JSON.stringify({ left: chatWRef.current, right: rightWRef.current })); } catch { /* ignore */ }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // 主题/自定义 CSS 变更时重新应用(首次渲染前 main.tsx 已应用过,这里兜底同步)
  useEffect(() => { applyTheme(theme as ThemeId); }, [theme]);
  useEffect(() => { applyCustomCss(customCss); }, [customCss]);
  // 拉取后端应用级设置(如知识分解力度档位)
  useEffect(() => { void loadAppSettings(); }, [loadAppSettings]);

  // 聊天列 FLIP:开窗/关窗时聊天列的位置/宽度会瞬跳(居中 ↔ 左侧窄列),用 CSS 动画 + 变量重触发
  // 平滑"推"到左边(或回中)。先移除旧动画→reflow 量干净的新布局→注入 --flip-* 变量→加回类重放。
  // ⚠️ before/after 必须在"无动画"时量(getBoundingClientRect 会包含动画 transform/width):
  //   曾因在动画启动瞬间记录,量到首帧位置而非稳定终态,导致下一次切换 dx=0 被跳过、动画不触发。
  const chatRef = useRef<HTMLElement | null>(null);
  const chatFlipBefore = useRef<{ x: number; w: number } | null>(null);
  const chatFlipKey = useRef("");
  useLayoutEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const key = `${anyWindow ? 1 : 0}${middleHas ? 1 : 0}`;
    const before = chatFlipBefore.current;
    if (before && chatFlipKey.current !== key) {
      // 停掉旧动画(若有),量干净的新布局
      el.classList.remove("chat-push");
      const after = el.getBoundingClientRect();   // 读取本身强制 reflow,此时无动画
      const dx = before.x - after.x;
      const dw = before.w - after.width;
      if (Math.abs(dx) > 0.5 || Math.abs(dw) > 0.5) {
        el.style.setProperty("--flip-dx", `${dx}px`);
        el.style.setProperty("--flip-w", `${before.w}px`);
        el.style.setProperty("--flip-w2", `${after.width}px`);
        void el.offsetWidth;                       // 提交变量后再触发,保证动画从头播
        el.classList.add("chat-push");
      }
      // 用干净的新布局作为下一次切换的"前状态"(不能量动画中的 getBoundingClientRect)
      chatFlipBefore.current = { x: after.x, w: after.width };
      chatFlipKey.current = key;
      return;
    }
    chatFlipKey.current = key;
    chatFlipBefore.current = { x: el.getBoundingClientRect().x, w: el.getBoundingClientRect().width };
  }, [anyWindow, middleHas, chatW, rightW]);

  return (
    <div className="flex h-screen w-screen flex-col text-[var(--text)]">
      {/* 顶部 header:品牌(左) / 窗口开关(中) / 操作(右) */}
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

        {/* 窗口开关:动画 / 讲解 / 分解图,打开哪些自由组合(并排平铺,主 agent 也会按需自动开) */}
        <div className="mx-auto flex items-center gap-1 p-0.5 rounded-lg bg-[var(--bg-1)]/70 border border-[var(--border)]">
          {([
            { key: "stage", label: "动画", tip: "开/关动画列(中列上部)", open: stageOpen, on: () => setStageOpen(true), off: () => setStageOpen(false), icon: <Play size={11} /> },
            { key: "explain", label: "讲解", tip: "开/关讲解列(最右,含考题)", open: explainOpen, on: () => setExplainOpen(true), off: () => setExplainOpen(false), icon: <FileText size={11} /> },
            { key: "graph", label: "分解", tip: "开/关分解图列(中列下部)", open: graphOpen, on: () => setGraphOpen(true), off: () => setGraphOpen(false), icon: <Network size={11} /> },
          ] as const).map((b) => (
            <button
              key={b.key}
              onClick={() => (b.open ? b.off() : b.on())}
              title={b.tip}
              className={`px-2.5 py-1 rounded-md text-[11px] flex items-center gap-1 transition-all duration-200 ${b.open ? "btn-blue shadow-sm open-pop" : "text-[var(--text-mute)] hover:text-[var(--text)] hover:bg-[var(--bg-3)]"}`}
            >
              {b.icon} {b.label}
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

      {/* 主体:对话优先,并排平铺。打开窗口时主 agent 对话框被推到最左,动画/分解/讲解按格位摆放,互不遮挡。
          左=主 agent 对话(恒在,可拖宽);中列=动画(上)+ 分解图(下,并存时上下堆叠);右列=讲解(含考题,可拖宽)。
          两根分隔条拖拽调列宽(聊天列 / 讲解列),localStorage 持久化。 */}
      <main className="flex-1 min-h-0 flex bg-[var(--bg-deepest)]">
        {/* 主 agent 对话列:无窗口时居中(限宽 860);有窗口时缩为左侧窄列(有中列时固定宽 chatW,可拖拽调宽) */}
        <section ref={chatRef} className={[
          "min-h-0 overflow-hidden bg-[var(--bg-1)]/80 backdrop-blur-md panel-anim",
          anyWindow
            ? (middleHas
                ? "shrink-0 border-r border-[var(--border)]"
                : "flex-1 min-w-[320px] border-r border-[var(--border)]")
            : "shrink-0 w-[min(860px,100%)] mx-auto border-x border-[var(--border)]",
        ].join(" ")} style={anyWindow && middleHas ? { width: chatW } : undefined}>
          <ChatPanel />
        </section>

        {/* 分隔条:聊天|中列,拖拽调聊天列宽 */}
        {middleHas && (
          <div onPointerDown={startDrag("chat")} className="splitter w-[5px] shrink-0 cursor-col-resize z-10 fade-soft" title="拖拽调整聊天列宽度" />
        )}

        {/* 中列:动画(上)+ 分解图(下)。无中列窗口时整列隐藏,但 StagePanel 常驻挂载(浏览器在环验证 + 场景不因关列而坏) */}
        <section className={`${middleHas ? "flex-1" : "hidden"} min-w-0 min-h-0 flex flex-col bg-[var(--bg-1)]/60 backdrop-blur-md col-enter`}>
          <div className={`${stageOpen ? "flex-1" : "hidden"} min-h-0`}>
            <StagePanel />
          </div>
          {stageOpen && graphOpen && <div className="h-px shrink-0 bg-[var(--border)] fade-soft" />}
          {graphOpen && (
            <div className="flex-1 min-h-0 relative">
              {/* relative:GraphApp 根是 absolute inset:0,需在父元素上建定位上下文。
                  否则 backdrop-filter(中列 section 的 backdrop-blur)会作为包含块,
                  让整张图画布铺满整个中列、盖住上方动画列。 */}
              <GraphApp visible embedded />
            </div>
          )}
        </section>

        {/* 分隔条:中列|右列(无中列时为 聊天|右列),拖拽调讲解列宽 */}
        {rightHas && (
          <div onPointerDown={startDrag("right")} className="splitter w-[5px] shrink-0 cursor-col-resize z-10" title="拖拽调整讲解列宽度" />
        )}

        {/* 右列:讲解(含考题)。无讲解时不显示,宽度 rightW 可拖拽调 */}
        {rightHas && (
          <section style={{ width: rightW }} className="shrink-0 min-h-0 overflow-hidden bg-[var(--bg-1)]/80 backdrop-blur-md col-enter border-l border-[var(--border)]">
            <ExplainPanel />
          </section>
        )}
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
