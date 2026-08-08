// 颜色自适应工具:浅色主题(paper/sakura)下把"亮色"压暗但保留色相,
// 让模型用白/浅色做的文字在浅背景可读;深色主题保持原样。
// 供 manimCtx(命名色常量如 WHITE 展开时覆盖)与 runScript(代码里字面量 #ffffff/"white" 兜底)共用。
// 无 manim-web 依赖,避免在纯逻辑模块里引入大包。

/** 解析 #RGB / #RRGGBB(带不带 # 都行)为 [r,g,b] 0..255。非法回黑。 */
export function hexToRgb(hex: string): [number, number, number] {
  let h = (hex || "").trim();
  if (h[0] === "#") h = h.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 感知亮度 0..1(近似 ITU-R BT.601)。 */
export function luminanceOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** 当前是否浅色背景(读 --bg-deepest 的亮度判断)。无 DOM/取不到回 false(按深色处理)。 */
export function hasLightBackground(): boolean {
  try {
    const c = getComputedStyle(document.documentElement).getPropertyValue("--bg-deepest").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(c)) return luminanceOf(c) > 0.5;
  } catch { /* ignore */ }
  return false;
}

/**
 * 返回 hex 在当前主题下"应呈现"的颜色:
 * - 浅色背景 + 亮度>0.5 的亮色 → 压暗到 ~20%(保留色相:WHITE→#333333, YELLOW→#333300, 浅蓝→深蓝…)
 * - 否则原样(深色背景不过滤;本来就深的颜色不动)。
 * 输入可为 #RGB 或 #RRGGBB,输出统一 #RRGGBB(小写)。
 */
export function adaptHex(hex: string): string {
  if (!hasLightBackground()) return hex;
  if (luminanceOf(hex) <= 0.5) return hex;
  const [r, g, b] = hexToRgb(hex);
  const f = 0.2; // 压暗系数
  const h = (n: number) => Math.round(n * f).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** 浅色背景下常见"命名色字面量"(如 color:"white")→ 深色对应。键小写。 */
const NAMED_LIGHT_MAP: Record<string, string> = {
  white: "#333333",
  lightgray: "#4a4a4a",
  lightgrey: "#4a4a4a",
  yellow: "#7a7a00",
  lightblue: "#245a7d",
  orange: "#8a4a00",
};

/**
 * 浅色主题兜底:把代码里"作为字符串字面量的颜色"(color:"#ffffff" / "white")压暗。
 * 命名色常量(WHITE 等无引号)已由 manimCtx 展开时覆盖;这里补代码里直接写的字面量。
 * 深色主题下原样返回,不改动代码。
 */
export function adaptColorLiterals(code: string): string {
  if (!hasLightBackground()) return code;
  let s = code;
  // 十六进制 #RGB / #RRGGBB 字面量(仅当是字符串值)
  s = s.replace(/(["'])(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\1/g, (_m, q, hex) => `${q}${adaptHex(hex)}${q}`);
  // 常见亮色命名字面量(不匹配 function/var 等 js 关键字;只处理字符串值)
  s = s.replace(/(["'])(white|lightgray|lightgrey|yellow|lightblue|orange)\1/gi, (_m, q, name) => {
    const key = name.toLowerCase();
    return NAMED_LIGHT_MAP[key] ? `${q}${NAMED_LIGHT_MAP[key]}${q}` : _m;
  });
  return s;
}