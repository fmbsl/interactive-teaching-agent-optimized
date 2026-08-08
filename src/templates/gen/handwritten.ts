// =============================================================================
// 主 agent 亲手整理的经典 manim 题材改写(独立文件,不与领域批次重复)。
// 这些是 3Blue1Brown 风格的硬核经典,改写为 manim-web 0.3.24 真实 API。
// =============================================================================
import type { WebExample } from "../webExamples";

export const HANDWRITTEN_WEB_EXAMPLES: WebExample[] = [
  // ================= 1. 泰勒级数:(搜索到的 3b1b 经典「微积分的本质」题材改写)=================
  {
    id: "hw-taylor-series",
    source: "经典 3Blue1Brown「微积分的本质 / Taylor series」动画题材,改写为 manim-web",
    domain: "math",
    category: "微积分",
    title: "泰勒级数:用多项式逐阶逼近函数",
    intent: "展示 e^x 附近用 0/1/2/3…阶多项式逐步逼近原函数:阶数越高,多项式在展开点附近越贴合函数 —— 直观理解泰勒展开是「用局部导数信息逐阶逼近」.",
    params: [{ name: "n", label: "最高阶数 N", min: 0, max: 6, step: 1, default: 4 }],
    sceneCode: `
const { scene, Axes, MathTexImage, Text, Create, Write, FadeIn, Indicate, BLUE, BLUE_E, BLUE_D, BLUE_C, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [-4, 4, 1], yRange: [-1.8, 1.8, 0.5], xLength: 8.4, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
const f = (x) => Math.sin(x);
const curve = axes.plot(f, { xRange: [-4, 4], color: BLUE, strokeWidth: 3 });
scene.add(axes, curve);
const title = new Text({ text: "泰勒级数:多项式逐阶逼近 sin x", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
await scene.play(new Create(curve));
// sin(x) 在 0 处展开的部分和:P1=x, P3=x-x³/6, P5=...+x⁵/120, ...
const sinTaylor = (deg) => (x) => { let s = 0; for (let i = 0; i <= deg; i++) { const m = 2 * i + 1; let term = Math.pow(x, m); let factorial = 1; for (let j = 2; j <= m; j++) factorial *= j; s += (i % 2 === 0 ? 1 : -1) * term / factorial; } return s; };
const colors = [WHITE, BLUE_E, BLUE_D, "#7aa8e0", BLUE_C, "#5f8fc4"];
let degMax = Math.max(1, Math.min(5, Math.round(params.n) || 3));
for (let deg = 0; deg < degMax; deg++) {
  const polyFn = sinTaylor(deg);
  const poly = axes.plot(polyFn, { xRange: [-4, 4], color: colors[deg % colors.length], strokeWidth: 2.5 });
  scene.add(poly);
  await scene.play(new Create(poly, { duration: 0.6 }));
  const order = 2 * deg + 1;
  const yLbl = polyFn(2.4) || 0;
  const lab = new Text({ text: "P" + order + "(x)", fontSize: 20, color: colors[deg % colors.length], fontFamily: '"Times New Roman","SimSun",serif' });
  lab.nextTo(axes.c2p(2.6, Math.max(-1.6, Math.min(1.6, yLbl))), RIGHT, 0.1);
  scene.add(lab);
  await scene.play(new Write(lab, { duration: 0.4 }));
  await scene.wait(0.25);
}
const eq = new MathTexImage({ renderer: "katex", latex: "\\sin x = x - \\frac{x^3}{3!} + \\frac{x^5}{5!} - \\cdots", fontSize: 27, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.1);
scene.add(eq);
await scene.play(new Write(eq, { duration: 0.9 }));
await scene.wait(0.5);
`,
  },

  // ================= 2. 复数单位圆 + 欧拉公式(经典)=================
  {
    id: "hw-euler-formula",
    source: "经典复数/欧拉公式教程题材,改写为 manim-web",
    domain: "math",
    category: "复数",
    title: "欧拉公式:旋转向量在单位圆上的 cos/sin 投影",
    intent: "让单位圆上以角度 θ 旋转的单位向量投影到实轴和虚轴,得到实部 cosθ、虚部 sinθ —— 直观建立 e^{iθ} = cosθ + i·sinθ 与「旋转即复数乘法」.",
    params: [{ name: "speed", label: "旋转圈数(周期数)", min: 1, max: 4, step: 1, default: 2 }],
    sceneCode: `
const { scene, Circle, Line, Dot, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, easeOut, ORIGIN, BLUE, GOLD, WHITE, UP, params } = ctx;
const c = new Circle({ radius: 2, color: "#8896a6", strokeWidth: 1.5 });
const xa = new Line({ start: [-2.7, 0, 0], end: [2.7, 0, 0], color: "#5a6a80", strokeWidth: 1 });
const ya = new Line({ start: [0, -2.7, 0], end: [0, 2.7, 0], color: "#5a6a80", strokeWidth: 1 });
const t = new ValueTracker(0.0);
const rLine = new Line({ start: ORIGIN, end: [2, 0, 0], color: GOLD, strokeWidth: 2.5 });
const p = new Dot({ point: [2, 0, 0], radius: 0.1, color: WHITE });
const cosP = new Dot({ point: [2, 0, 0], radius: 0.09, color: BLUE });
const sinP = new Dot({ point: [0, 0, 0], radius: 0.09, color: GOLD });
rLine.addUpdater(() => { const th = t.getValue(); const x = 2 * Math.cos(th), y = 2 * Math.sin(th); rLine.become(new Line({ start: ORIGIN, end: [x, y, 0], color: GOLD, strokeWidth: 2.5 })); p.moveTo([x, y, 0]); cosP.moveTo([x, 0, 0]); sinP.moveTo([0, y, 0]); });
scene.add(xa, ya, c, rLine, p, cosP, sinP);
const title = new MathTexImage({ renderer: "katex", latex: "e^{i\\theta} = \\cos\\theta + i\\,\\sin\\theta", fontSize: 34, color: WHITE });
await title.waitForRender();
title.toEdge(UP);
scene.add(title);
await scene.play(new Create(c));
await scene.play(new Create(xa), new Create(ya));
await scene.play(new Create(rLine));
// 旋转(圈数×2π)
const turns = Math.max(1, Math.round(params.speed) || 1);
await scene.play(t.animateTo(turns * 6.2832, { duration: 3.2, rateFunc: easeOut }));
await scene.wait(0.4);
const labCos = new Text({ text: "cos θ (实部)", fontSize: 20, color: BLUE, fontFamily: '"Times New Roman","SimSun",serif' });
labCos.nextTo(cosP, DOWN, 0.15);
const labSin = new Text({ text: "sin θ (虚部)", fontSize: 20, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
labSin.nextTo(sinP, RIGHT, 0.15);
scene.add(labCos, labSin);
await scene.play(new Write(labCos), new Write(labSin));
await scene.play(new Indicate(p, { color: WHITE, duration: 0.8 }));
await scene.wait(0.5);
`,
  },

  // ================= 3. 线性变换:矩阵把网格向量映到新基(经典 3b1b)=================
  {
    id: "hw-linear-transform",
    source: "经典 3Blue1Brown「线性代数的本质」题材改写(向量/基线性组合)",
    domain: "math",
    category: "线性代数",
    title: "线性变换:两个基向量如何张开新空间",
    intent: "展示基向量 e₁=(1,0)、e₂=(0,1) 经矩阵变换后变为新的两个向量,网格点随之「被拉伸」—— 直观理解线性变换 = 用新基线性组合原来的点.",
    params: [{ name: "shear", label: "剪切系数 k", min: 0, max: 1.6, step: 0.1, default: 1.2 }],
    sceneCode: `
const { scene, Line, Arrow, Dot, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, AnimationGroup, easeOut, ORIGIN, BLUE, BLUE_C, GOLD, WHITE, UP, params } = ctx;
// 坐标网格(两条虚线示意 + 单位正方形)
const gx = new Line({ start: [-3, 0, 0], end: [3, 0, 0], color: "#5a6a80", strokeWidth: 1.2 });
const gy = new Line({ start: [0, -3, 0], end: [0, 3, 0], color: "#5a6a80", strokeWidth: 1.2 });
const sq = new Line({ start: ORIGIN, end: [1, 1, 0], color: "#55647a", strokeWidth: 1.5 }); // 示意斜向
const e1 = new Line({ start: ORIGIN, end: [1, 0, 0], color: BLUE, strokeWidth: 3 });
const e2 = new Line({ start: ORIGIN, end: [0, 1, 0], color: GOLD, strokeWidth: 3 });
const t = new ValueTracker(0);
// 变换 M = [[1, k],[0, 1]]:e1'→(1,0)不变,e2'→(k,1)
const k = Math.max(0, Number(params.shear) || 1.2);
const lerp = (a, b, u) => a + (b - a) * u;
e1.addUpdater(() => { const u = t.getValue(); e1.become(new Line({ start: ORIGIN, end: [lerp(1, 1, u), lerp(0, 0, u), 0], color: BLUE, strokeWidth: 3 })); });
e2.addUpdater(() => { const u = t.getValue(); e2.become(new Line({ start: ORIGIN, end: [lerp(0, k, u), lerp(1, 1, u), 0], color: GOLD, strokeWidth: 3 })); });
scene.add(gx, gy, sq, e1, e2);
const title = new Text({ text: "线性变换:基向量的新方向", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Create(gx), new Create(gy));
await scene.play(new Create(e1), new Create(e2));
await scene.wait(0.3);
await scene.play(t.animateTo(1, { duration: 2.2, rateFunc: easeOut }));
await scene.wait(0.4);
const note = new Text({ text: "e₂ → (" + k.toFixed(1) + ", 1)", fontSize: 22, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo([1.4, 1.5, 0], UP, 0.2);
scene.add(note);
await scene.play(new Write(note));
const eq = new MathTexImage({ renderer: "katex", latex: "\\begin{pmatrix}1&" + (k.toFixed(1)) + "\\\\0&1\\end{pmatrix}", fontSize: 28, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new Write(eq, { duration: 0.8 }));
await scene.wait(0.5);
`,
  },
];