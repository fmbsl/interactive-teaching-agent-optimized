// 主题引擎:预置多套主题 + 自定义 CSS。
//
// 前端所有"中性色 + 品牌强调色 + 错误/成功容器色"都改为 CSS 变量引用(index.css :root
// 提供基线,组件里用 `bg-[var(--bg-1)]` / `text-[var(--text)]` 等)。切换主题 =
// 给 <html> 设 data-theme,并注入一个高特异性(attribute)的 <style> 覆盖这些变量,
// 全界面即时生效。自定义 CSS 另注入一个 <style id="user-css">,让用户自由覆写。
//
// 错误/成功的纯文字标记(红/绿)属语义色在主题间稳定;这里主要换背景/文字/边框/强调色。

export type ThemeId = "deepsea" | "oled" | "paper" | "terminal" | "sakura";

export interface Theme {
  id: ThemeId;
  name: string;
  desc: string;
  /** CSS 变量覆盖:key 不带 `--` 前缀。 */
  tokens: Record<string, string>;
}

/** 所有会随主题切换的 token(须与 index.css :root 及组件里 var(--x) 一致)。 */
export const THEME_TOKEN_KEYS = [
  "bg-0", "bg-1", "bg-2", "bg-3", "bg-deepest", "bg-panel", "bg-input", "bg-row",
  "panel-bg", "panel-bg-soft",
  "border", "border-soft", "border-hover",
  "text", "text-dim", "text-mute", "text-faint",
  "code-ink", "on-accent",
  "blue", "blue-strong", "blue-deep", "blue-light",
  "blue-soft", "blue-ring", "blue-focus", "blue-glow",
  "glow-1", "glow-2", "glow-a1", "glow-a2", "bg-root",
  "danger-bg", "danger-bg-hover", "danger-border", "danger-text",
] as const;

export const THEMES: Theme[] = [
  {
    id: "deepsea",
    name: "深海暗蓝",
    desc: "默认 · 深蓝径向渐变底,蓝系强调",
    tokens: {
      "bg-0": "#070a12", "bg-1": "#0b0f18", "bg-2": "#111827", "bg-3": "#161f2e",
      "bg-deepest": "#0a0c14", "bg-panel": "#0d121c", "bg-input": "#0a0f1a", "bg-row": "#0f1828",
      "panel-bg": "rgba(11,15,24,0.72)", "panel-bg-soft": "rgba(11,15,24,0.60)",
      "border": "#1e293b", "border-soft": "#162032", "border-hover": "#2b3a52",
      "text": "#dfe6f0", "text-dim": "#9aa6b8", "text-mute": "#6b7686", "text-faint": "#4a5365",
      "code-ink": "#b8d4ff", "on-accent": "#070a12",
      "blue": "#4a9eff", "blue-strong": "#5fb0ff", "blue-deep": "#2b6cb0", "blue-light": "#9ec5ff",
      "blue-soft": "rgba(74,158,255,0.14)", "blue-ring": "rgba(74,158,255,0.55)",
      "blue-focus": "rgba(74,158,255,0.50)", "blue-glow": "rgba(74,158,255,0.45)",
      "glow-1": "#14233f", "glow-2": "#0f1a30", "glow-a1": "rgba(20,35,63,0)", "glow-a2": "rgba(15,26,48,0)", "bg-root": "#070a12",
      "danger-bg": "#2a1414", "danger-bg-hover": "#4a1c28", "danger-border": "#5a3a3a", "danger-text": "#f0a8a8",
    },
  },
  {
    id: "oled",
    name: "纯黑 OLED",
    desc: "全黑底,省电观感更纯粹",
    tokens: {
      "bg-0": "#000000", "bg-1": "#000000", "bg-2": "#0c0c0e", "bg-3": "#141416",
      "bg-deepest": "#000000", "bg-panel": "#050506", "bg-input": "#000000", "bg-row": "#0f0f12",
      "panel-bg": "rgba(0,0,0,0.80)", "panel-bg-soft": "rgba(0,0,0,0.62)",
      "border": "#1b1b1e", "border-soft": "#151518", "border-hover": "#2c2c31",
      "text": "#e9eaee", "text-dim": "#9aa1ab", "text-mute": "#5f6673", "text-faint": "#3a404b",
      "code-ink": "#9ec5ff", "on-accent": "#000000",
      "blue": "#4a9eff", "blue-strong": "#5fb0ff", "blue-deep": "#2b6cb0", "blue-light": "#9ec5ff",
      "blue-soft": "rgba(74,158,255,0.16)", "blue-ring": "rgba(74,158,255,0.55)",
      "blue-focus": "rgba(74,158,255,0.50)", "blue-glow": "rgba(74,158,255,0.45)",
      "glow-1": "#0c1420", "glow-2": "#080d16", "glow-a1": "rgba(14,22,34,0)", "glow-a2": "rgba(8,13,22,0)", "bg-root": "#000000",
      "danger-bg": "#271214", "danger-bg-hover": "#3f1a1d", "danger-border": "#542426", "danger-text": "#f2a5a5",
    },
  },
  {
    id: "paper",
    name: "纸面浅色",
    desc: "浅色纸面,暖白护眼,适合阅读",
    tokens: {
      "bg-0": "#f3eee3", "bg-1": "#faf7f0", "bg-2": "#ede5d6", "bg-3": "#e2d9c6",
      "bg-deepest": "#efe8d9", "bg-panel": "#fdfbf5", "bg-input": "#fffef9", "bg-row": "#f0e9da",
      "panel-bg": "rgba(250,247,240,0.84)", "panel-bg-soft": "rgba(250,247,240,0.68)",
      "border": "#d7ccb6", "border-soft": "#e2d8c2", "border-hover": "#c0b28f",
      "text": "#2d2a25", "text-dim": "#5c564c", "text-mute": "#8b8375", "text-faint": "#b3aa98",
      "code-ink": "#274d8a", "on-accent": "#ffffff",
      "blue": "#3f82c4", "blue-strong": "#2f6fae", "blue-deep": "#275a91", "blue-light": "#6aa5d8",
      "blue-soft": "rgba(63,130,196,0.14)", "blue-ring": "rgba(63,130,196,0.55)",
      "blue-focus": "rgba(63,130,196,0.30)", "blue-glow": "rgba(63,130,196,0.40)",
      "glow-1": "#e4dcc9", "glow-2": "#eae1cf", "glow-a1": "rgba(228,220,201,0)", "glow-a2": "rgba(234,225,207,0)", "bg-root": "#f3eee3",
      "danger-bg": "#f6e2df", "danger-bg-hover": "#f2d2cd", "danger-border": "#dfb3ab", "danger-text": "#a23a33",
    },
  },
  {
    id: "terminal",
    name: "终端绿",
    desc: "深色终端风,绿色强调",
    tokens: {
      "bg-0": "#05130a", "bg-1": "#07180d", "bg-2": "#0a2114", "bg-3": "#0f2b1a",
      "bg-deepest": "#03100a", "bg-panel": "#061910", "bg-input": "#041209", "bg-row": "#0c2516",
      "panel-bg": "rgba(7,24,13,0.80)", "panel-bg-soft": "rgba(7,24,13,0.62)",
      "border": "#1e3d28", "border-soft": "#16301f", "border-hover": "#2e5738",
      "text": "#c9f2d6", "text-dim": "#90cfa3", "text-mute": "#5d9371", "text-faint": "#3f6b51",
      "code-ink": "#a5eebe", "on-accent": "#04120a",
      "blue": "#34d67a", "blue-strong": "#55e99a", "blue-deep": "#1f9a58", "blue-light": "#a4eebc",
      "blue-soft": "rgba(52,214,122,0.16)", "blue-ring": "rgba(52,214,122,0.55)",
      "blue-focus": "rgba(52,214,122,0.40)", "blue-glow": "rgba(52,214,122,0.40)",
      "glow-1": "#0a2415", "glow-2": "#071c10", "glow-a1": "rgba(10,36,21,0)", "glow-a2": "rgba(7,28,16,0)", "bg-root": "#05130a",
      "danger-bg": "#2a1414", "danger-bg-hover": "#4a1c28", "danger-border": "#5a3a3a", "danger-text": "#f0a8a8",
    },
  },
  {
    id: "sakura",
    name: "樱粉浅色",
    desc: "浅暖粉,柔和治愈风",
    tokens: {
      "bg-0": "#fbf3f4", "bg-1": "#fefafb", "bg-2": "#f7e9ec", "bg-3": "#efdce2",
      "bg-deepest": "#f7ecf0", "bg-panel": "#fffbfc", "bg-input": "#fffefe", "bg-row": "#f6e6eb",
      "panel-bg": "rgba(254,250,251,0.84)", "panel-bg-soft": "rgba(254,250,251,0.68)",
      "border": "#e4cbd2", "border-soft": "#efd8df", "border-hover": "#d5aab6",
      "text": "#3b2b30", "text-dim": "#7e5f68", "text-mute": "#ab8993", "text-faint": "#cbaab4",
      "code-ink": "#9e4866", "on-accent": "#ffffff",
      "blue": "#d26a8a", "blue-strong": "#e080a0", "blue-deep": "#b04e6b", "blue-light": "#eda2b7",
      "blue-soft": "rgba(210,106,138,0.14)", "blue-ring": "rgba(210,106,138,0.55)",
      "blue-focus": "rgba(210,106,138,0.30)", "blue-glow": "rgba(210,106,138,0.40)",
      "glow-1": "#f3dde3", "glow-2": "#f6e6ea", "glow-a1": "rgba(243,221,227,0)", "glow-a2": "rgba(246,230,234,0)", "bg-root": "#fbf3f4",
      "danger-bg": "#f7e1e1", "danger-bg-hover": "#f3d0d2", "danger-border": "#e0b2b4", "danger-text": "#a83f44",
    },
  },
];

export const DEFAULT_THEME: ThemeId = "deepsea";

export function resolveTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function getThemeName(id: string | null | undefined): string {
  return resolveTheme(id).name;
}

// ---------- localStorage 持久化 ----------
const THEME_KEY = "theme-id";
const CUSTOM_CSS_KEY = "theme-custom-css";

export function loadTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved && THEMES.some((t) => t.id === saved)) return saved as ThemeId;
  } catch { /* ignore */ }
  return DEFAULT_THEME;
}
export function saveTheme(id: ThemeId): void {
  try { localStorage.setItem(THEME_KEY, id); } catch { /* ignore */ }
}
export function loadCustomCss(): string {
  try { return localStorage.getItem(CUSTOM_CSS_KEY) ?? ""; } catch { return ""; }
}
export function saveCustomCss(css: string): void {
  try { localStorage.setItem(CUSTOM_CSS_KEY, css); } catch { /* ignore */ }
}

// ---------- 应用 ----------
const STYLE_ID = "theme-override";

/** 应用主题:给 <html> 设 data-theme 并注入/更新高特异性变量覆盖 <style>。 */
export function applyTheme(id: ThemeId): void {
  const theme = resolveTheme(id);
  document.documentElement.setAttribute("data-theme", theme.id);
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  const vars = Object.entries(theme.tokens)
    .map(([k, v]) => `  --${k}: ${v};`)
    .join("\n");
  el.textContent = `:root[data-theme="${theme.id}"] {\n${vars}\n}`;
  try { saveTheme(theme.id); } catch { /* ignore */ }
}

const USER_STYLE_ID = "user-css";

/** 应用自定义 CSS:注入/更新 <style id="user-css">;为空则移除。 */
export function applyCustomCss(css: string): void {
  let el = document.getElementById(USER_STYLE_ID) as HTMLStyleElement | null;
  if (!css.trim()) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = USER_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
  try { saveCustomCss(css); } catch { /* ignore */ }
}