// =============================================================================
// 数学领域 manim-web 教学模板库(20 个) —— 供独立检查页逐个渲染 + sceneCheck。
//
// 风格:绝大多数用「注入 scene 的 ctx 函数」(domain="math",暂停/断点可用);
//     3D(叉积 / 方向导数)与金标准 library.ts 的 m-gradient-surface 一致,
//         用注入 scene + setCameraOrientation(is3D:true),不自建 Scene。
// 铁律遵守:解构行含全部标识符、纯 JS 无 TS、公式 MathTexImage + await waitForRender、
//          Text 带 "Times New Roman","SimSun" fontFamily、禁数组+数组算术、
//          Transform 只同类、相对定位(nextTo/toEdge/c2p)不裸 moveTo 硬凑、
//          三区分明(顶部标题 / 中部主体 / 底部公式说明)、对象进场景。
// 每条 = 一个清晰教学点,有「开场→展开→强调/结论」节奏,结尾保留关键结论。
// =============================================================================

import type { WebExample } from "../webExamples";

export const MATH_WEB_EXAMPLES: WebExample[] = [
  // ================= 1. 导数 = 切线斜率(立方曲线)=================
  {
    id: "math-derivative-cubic-tangent",
    source: "经典 manim 动画题材改写(Python Manim 割线→切线)",
    domain: "math",
    category: "微积分",
    title: "导数的几何意义:割线 → 切线的斜率",
    intent: "动点沿三次曲线逼近定点,割线越来越贴近曲线,跨度 h→0 时割线斜率等于切线斜率 —— 直观建立「导数 = 切线斜率 = 瞬时变化率」,并演示离切点越近近似越好。",
    params: [{ name: "h", label: "割线跨度 h", min: 0.15, max: 1.6, step: 0.05, default: 1.0 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, BLUE_E, GRAY, WHITE, UP, DOWN, easeOut , params } = ctx;
const axes = new Axes({ xRange: [-2, 2.4, 1], yRange: [-1.2, 3.4, 1], xLength: 7.6, yLength: 5.0, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
const f = (x) => x * x * x - x;
const curve = axes.plot(f, { xRange: [-1.9, 2.3], color: BLUE, strokeWidth: 3 });
scene.add(axes, curve);
const title = new Text({ text: "导数 = 切线斜率 = 瞬时变化率", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "f'(a)=\\lim_{h\\to 0}\\frac{f(a+h)-f(a)}{(a+h)-a}", fontSize: 25, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.25);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new Create(curve));
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const a = 0.7;
const fA = f(a);
const pointA = axes.c2p(a, fA);
const hT = new ValueTracker(params.h);
const pointP = function () { return axes.c2p(a + hT.getValue(), f(a + hT.getValue())); };
const dotA = new Dot({ point: pointA, radius: 0.09, color: BLUE_E });
const dotP = new Dot({ point: pointP(), radius: 0.09, color: BLUE_C });
const secant = new Line({ start: pointA, end: pointP(), color: GRAY, strokeWidth: 2.5 });
scene.add(dotA, dotP, secant);
dotP.addUpdater((d) => d.moveTo(pointP()));
secant.addUpdater((ln) => ln.become(new Line({ start: pointA, end: pointP(), color: GRAY, strokeWidth: 2.5 })));
const labA = new Text({ text: "a", fontSize: 24, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
const labH = new Text({ text: "a+h", fontSize: 22, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
labA.nextTo(pointA, DOWN, 0.12).shift([-0.08, -0.2, 0]);
labH.nextTo(pointP(), DOWN, 0.12).shift([0.14, -0.2, 0]);
scene.add(labA, labH);
await scene.play(new FadeIn(dotA), new FadeIn(dotP));
await scene.play(new Create(secant));
await scene.play(new FadeIn(labA), new FadeIn(labH));

const slopeText = new Text({ text: "割线斜率 = 两端差商", fontSize: 22, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
slopeText.nextTo(eq, DOWN, 0.18);
scene.add(slopeText);
await scene.play(new Write(slopeText));
await scene.play(hT.animateTo(0.15, { duration: 2, rateFunc: easeOut }));

const tangent = new Line({ start: pointA, end: axes.c2p(a + 1.1, fA + (3 * a * a - 1) * 1.1), color: BLUE_D, strokeWidth: 3.2 });
await scene.play(new Create(tangent));
const note = new Text({ text: "h→0: 割线变切线,斜率即 f'(a)", fontSize: 23, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(slopeText, DOWN, 0.16);
await scene.play(new Write(note));
await scene.play(new Indicate(tangent, { color: BLUE_D, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 2. 定积分 = 黎曼和逼近面积(中点法)=================
  {
    id: "math-riemann-area-midpoint",
    source: "经典 manim 动画题材改写(Riemann 矩形逼近面积)",
    domain: "math",
    category: "微积分",
    title: "定积分:矩形越细面积越精确(中点黎曼和)",
    intent: "把曲线下面积切成 N 个矩形,用每个小区间中点的函数值作高;N 越大总面积越逼近真实积分 —— 直观理解黎曼和与定积分的极限定义,并演示中点法收敛更快。",
    params: [{ name: "N", label: "矩形个数 N", min: 3, max: 42, step: 1, default: 10 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, WHITE, UP, DOWN, LaggedStartMap, easeOut , params } = ctx;
const axes = new Axes({ xRange: [-0.3, 3.3, 1], yRange: [-0.3, 3.2, 1], xLength: 7, yLength: 4.6, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
const f = (x) => 0.9 * x * x;
const curve = axes.plot(f, { xRange: [0.1, 3.1], color: BLUE, strokeWidth: 3 });
scene.add(axes, curve);
const title = new Text({ text: "定积分 = 矩形面积和的极限", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "\\int_a^b f(x)\\,dx=\\lim_{N\\to\\infty}\\frac{b-a}{N}\\sum_{i=1}^{N}f(x_i^*)", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.28);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new Create(curve));
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const A = 0.4, B = 3.0;
const N = Math.max(2, Math.round(params.N));
const dx = (B - A) / N;
const rectVT = new ValueTracker(N);
const rects = [];
function rebuild() {
  for (let i = rects.length - 1; i >= 0; i--) scene.remove(rects[i]);
  rects.length = 0;
  const n = Math.max(2, Math.round(rectVT.getValue()));
  const ddx = (B - A) / n;
  for (let i = 0; i < n; i++) {
    const mid = A + (i + 0.5) * ddx;
    const left = A + i * ddx;
    const w = axes.getRiemannRectangles(curve, { xRange: [left, left + ddx], dx: 0.01, color: BLUE_C, fillOpacity: 0.42, strokeWidth: 0.5 });
    rects.push(w);
    scene.add(w);
  }
}
rebuild();
const cap = new Text({ text: "取中点函数值作矩形高(中点法则)", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.16);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(rectVT.animateTo(Math.max(N, 24), { duration: 2.5, rateFunc: easeOut }));
rebuild();
const more = new Text({ text: "N 越大 → 面积越接近真实积分", fontSize: 23, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
more.nextTo(cap, DOWN, 0.16);
await scene.play(new Write(more));
await scene.play(new Indicate(eq, { color: BLUE_C, duration: 0.9 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 3. 泰勒级数逼近 sin(x)=================
  {
    id: "math-taylor-sin",
    source: "原生 manim-web:Axes.plot 函数绘制(Python Manim 经典题材改写)",
    domain: "math",
    category: "微积分",
    title: "泰勒级数逐项逼近 sin x",
    intent: "sin x 的泰勒多项式在原点展开,项数越多拟合范围越广、越贴精确曲线 —— 直观看到「局部多项式近似全局函数」的泰勒思想,每一项贡献一个特征拐点。",
    params: [{ name: "term", label: "项数 n(奇次项数)", min: 1, max: 6, step: 1, default: 3 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, WHITE, GRAY, UP, DOWN , params } = ctx;
const axes = new Axes({ xRange: [-4.2, 4.2, 1], yRange: [-1.8, 1.8, 1], xLength: 8.4, yLength: 3.6, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
const exact = axes.plot((x) => Math.sin(x), { xRange: [-4, 4], color: WHITE, strokeWidth: 2.5 });
scene.add(axes, exact);
const title = new Text({ text: "泰勒级数:多项式逼近 sin x", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const leg = new Text({ text: "白 = 精确 sin x", fontSize: 19, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
leg.nextTo(title, DOWN, 0.28).shift([0.2, 0, 0]);
scene.add(title, leg);
await scene.play(new Write(title));
await scene.play(new Create(exact));
function taylorSin(n) {
  return (x) => { let s = 0, term = x, k = 1; for (let i = 0; i < n; i++) { s += term; term = -term * x * x / ((k + 1) * (k + 2)); k += 2; } return s; };
}
const eq = new MathTexImage({ renderer: "katex", latex: "\\sin x=x-\\frac{x^3}{3!}+\\frac{x^5}{5!}-\\frac{x^7}{7!}+\\cdots", fontSize: 22, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.25);
scene.add(eq);
await scene.play(new Write(eq));
let n = Math.max(1, Math.round(params.term));
const colors = [BLUE_D, BLUE, BLUE_C, "#7cc6ff"];
const poly = axes.plot(taylorSin(n), { xRange: [-4, 4], color: colors[n % colors.length], strokeWidth: 3 });
scene.add(poly);
await scene.play(new Create(poly, { duration: 1 }));
const cap = new Text({ text: "用到前 " + n + " 个奇次项,近似从原点向外扩展", fontSize: 23, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.15);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(poly, { color: colors[n % colors.length], duration: 0.9 }));
const conclude = new Text({ text: "项越多→拟合范围越大", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
conclude.nextTo(cap, DOWN, 0.14);
await scene.play(new Write(conclude));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 4. 傅里叶级数:谐波合成方波 =================
  {
    id: "math-fourier-square-wave",
    source: "经典 manim/3b1b 动画题材改写(傅里叶级数叠加谐波)",
    domain: "math",
    category: "微积分/序列分析",
    title: "傅里叶级数:谐波叠加逐级近似方波",
    intent: "方波(不连续)能表示为无穷正弦谐波的叠加;每加一高阶奇次谐波,拟合的波形越逼近方波、跳变沿越陡 —— 直观理解傅里叶把周期函数分解为正弦基。",
    params: [{ name: "kmax", label: "最高谐波次数", min: 1, max: 12, step: 1, default: 5 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, WHITE, UP, DOWN , params } = ctx;
const axes = new Axes({ xRange: [-6, 6, 1], yRange: [-1.6, 1.6, 1], xLength: 10, yLength: 3.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "傅里叶级数:谐波合成方波", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "f(x)\\approx\\frac{4}{\\pi}\\sum_{k=1}^{N}\\frac{\\sin((2k-1)x)}{2k-1}", fontSize: 23, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.25);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new Write(eq));
function fourierSum(x, N) { let s = 0; for (let k = 1; k <= N; k++) s += Math.sin((2 * k - 1) * x) / (2 * k - 1); return (4 / Math.PI) * s; }
const t = new ValueTracker(params.kmax);
const g = axes.plot((x) => fourierSum(x, t.getValue()), { xRange: [-5.9, 5.9], color: BLUE_C, strokeWidth: 3 });
scene.add(g);
g.addUpdater((m) => m.become(axes.plot((x) => fourierSum(x, t.getValue()), { xRange: [-5.9, 5.9], color: BLUE_C, strokeWidth: 3 })));
scene.add(t);
await scene.play(new Create(g, { duration: 1 }));
const cap = new Text({ text: "已叠加 " + Math.round(params.kmax) + " 个奇次谐波", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.15);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(t.animateTo(10, { duration: 2.5 }));
const note = new Text({ text: "谐波越多 → 越逼近方波", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(cap, DOWN, 0.14);
await scene.play(new Write(note));
await scene.play(new Indicate(g, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 5. 线性变换:旋转矩阵作用于平面 =================
  {
    id: "math-rotation-matrix",
    source: "经典 3b1b/manim 动画题材改写(基向量随旋转矩阵变化)",
    domain: "math",
    category: "线性代数",
    title: "旋转矩阵:整个坐标平面跟着转",
    intent: "2×2 旋转矩阵把向量 (x,y) 映射到旋转后的位置,基向量 ı̂、ĵ 各自旋转 θ —— 直观理解「矩阵决定列向量去向」与旋转矩阵的行列式为 1(面积不变)。",
    params: [{ name: "deg", label: "旋转角度 θ°", min: 0, max: 360, step: 5, default: 60 }],
    sceneCode: `
const { scene, NumberPlane, Arrow, Text, MathTexImage, Create, Write, GrowArrow, Indicate, applyMatrix, BLUE, BLUE_C, BLUE_D, WHITE, UP, DOWN , params } = ctx;
const plane = new NumberPlane({ xRange: [-4, 4, 1], yRange: [-4, 4, 1] });
scene.add(plane);
const title = new Text({ text: "旋转矩阵把整个平面转动", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "R(\\theta)=\\begin{pmatrix}\\cos\\theta&-\\sin\\theta\\\\\\sin\\theta&\\cos\\theta\\end{pmatrix}", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(plane, DOWN, 0.25);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new Write(eq));
const e1 = new Arrow({ start: [0, 0, 0], end: [1, 0, 0], color: BLUE_D, strokeWidth: 3, tipLength: 0.22, tipWidth: 0.16 });
const e2 = new Arrow({ start: [0, 0, 0], end: [0, 1, 0], color: BLUE_C, strokeWidth: 3, tipLength: 0.22, tipWidth: 0.16 });
scene.add(e1, e2);
await scene.play(new GrowArrow(e1), new GrowArrow(e2));
const rad = params.deg * (Math.PI / 180);
const M = [[Math.cos(rad), -Math.sin(rad), 0], [Math.sin(rad), Math.cos(rad), 0], [0, 0, 1]];
await scene.play(applyMatrix(plane, M, { duration: 2 }), applyMatrix(e1, M, { duration: 2 }), applyMatrix(e2, M, { duration: 2 }));
const cap = new Text({ text: "基向量 ı̂、ĵ 各转 " + Math.round(params.deg) + "° → 整张网格跟着转(行列式=1 面积不变)", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.17);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(e1, { color: BLUE_D, duration: 0.8 }), new Indicate(e2, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 6. 矩阵乘法 = 两次线性变换合成 =================
  {
    id: "math-matrix-composition",
    source: "经典 3b1b 动画题材改写(两个线性变换的合成 = 矩阵相乘)",
    domain: "math",
    category: "线性代数",
    title: "矩阵乘法:两次线性变换的合成",
    intent: "先旋转再剪切 vs 先剪切再旋转的结果不同;矩阵乘法 A·B 表示「先应用 B 再应用 A」(从右往左读)—— 直观建立矩阵乘法的几何意义与不可交换性。",
    params: [{ name: "angle", label: "旋转角 θ°", min: 0, max: 120, step: 2, default: 45 }],
    sceneCode: `
const { scene, NumberPlane, Arrow, Text, Create, Write, GrowArrow, FadeIn, applyMatrix, BLUE, BLUE_C, BLUE_D, WHITE, UP, DOWN , params } = ctx;
const plane = new NumberPlane({ xRange: [-4, 4, 1], yRange: [-4, 4, 1] });
scene.add(plane);
const title = new Text({ text: "A·B = 先 B 后 A(两次变换合成)", fontSize: 27, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const steps = new Text({ text: "① 先剪切 ② 再旋转 —— 变换顺序会改变结果", fontSize: 23, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
steps.nextTo(title, DOWN, 0.28).shift([0.2, 0, 0]);
scene.add(title, steps);
await scene.play(new Write(title));
await scene.play(new Write(steps));
const e1 = new Arrow({ start: [0, 0, 0], end: [1, 0, 0], color: BLUE_D, strokeWidth: 3, tipLength: 0.2, tipWidth: 0.14 });
const e2 = new Arrow({ start: [0, 0, 0], end: [0, 1, 0], color: BLUE_C, strokeWidth: 3, tipLength: 0.2, tipWidth: 0.14 });
scene.add(e1, e2);
await scene.play(new GrowArrow(e1), new GrowArrow(e2));
await scene.wait(0.3);
const shear = [[1, 0.8, 0], [0, 1, 0], [0, 0, 1]];
await scene.play(applyMatrix(plane, shear, { duration: 1.6 }), applyMatrix(e1, shear, { duration: 1.6 }), applyMatrix(e2, shear, { duration: 1.6 }));
const doneShear = new Text({ text: "变换 1:剪切(基向量 ĵ 右倾)", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
doneShear.nextTo(steps, DOWN, 0.5);
scene.add(doneShear);
await scene.play(new Write(doneShear));
const aRad = params.angle * (Math.PI / 180);
const rot = [[Math.cos(aRad), -Math.sin(aRad), 0], [Math.sin(aRad), Math.cos(aRad), 0], [0, 0, 1]];
await scene.play(applyMatrix(plane, rot, { duration: 1.6 }), applyMatrix(e1, rot, { duration: 1.6 }), applyMatrix(e2, rot, { duration: 1.6 }));
const doneRot = new Text({ text: "变换 2:再旋转 " + Math.round(params.angle) + "° → 合成 = A·B", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
doneRot.nextTo(doneShear, DOWN, 0.5);
scene.add(doneRot);
await scene.play(new Write(doneRot));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 7. 特征向量:沿特定方向只缩放 =================
  {
    id: "math-eigenvector",
    source: "经典 3b1b 动画题材改写(特征向量方向的几何直觉)",
    domain: "math",
    category: "线性代数",
    title: "特征向量:方向上只被拉伸不改变朝向",
    intent: "对线性变换而言,存在一些特殊方向(特征向量),变换仅是沿该方向整体拉伸 λ 倍、方向不变 —— 这是理解矩阵本质(沿特征方向的缩放)的最直观入口。",
    sceneCode: `
const { scene, NumberPlane, Arrow, DashedLine, Text, MathTexImage, Create, Write, FadeIn, GrowArrow, Indicate, applyMatrix, AnimationGroup, BLUE, BLUE_C, BLUE_D, WHITE, GRAY, UP, DOWN , params } = ctx;
const plane = new NumberPlane({ xRange: [-4.6, 4.6, 1], yRange: [-4.6, 4.6, 1] });
scene.add(plane);
const title = new Text({ text: "特征向量:变换后方向不变", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "A\\vec v=\\lambda\\vec v", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(plane, DOWN, 0.25);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new Write(eq));
// M = [[1.5,0.5],[0.5,1.5]]:特征向量 v=[1,1](λ=2)、[1,-1](λ=1)
const M = [[1.5, 0.5, 0], [0.5, 1.5, 0], [0, 0, 1]];
const e1 = new Arrow({ start: [0, 0, 0], end: [1, 0, 0], color: BLUE_D, strokeWidth: 3, tipLength: 0.2, tipWidth: 0.14 });
const e2 = new Arrow({ start: [0, 0, 0], end: [0, 1, 0], color: BLUE_C, strokeWidth: 3, tipLength: 0.2, tipWidth: 0.14 });
scene.add(e1, e2);
await scene.play(new GrowArrow(e1), new GrowArrow(e2));
const vEnd = [1.4, 1.4, 0];
const guide = new DashedLine({ start: [-2.6, -2.6, 0], end: [2.6, 2.6, 0], color: GRAY, strokeWidth: 1.5, dashLength: 0.12 });
const vArr = new Arrow({ start: [0, 0, 0], end: vEnd, color: WHITE, strokeWidth: 3.2, tipLength: 0.2, tipWidth: 0.14 });
scene.add(guide, vArr);
await scene.play(new Create(guide));
await scene.play(new GrowArrow(vArr));
const lv = new Text({ text: "v (特征向量)", fontSize: 21, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
lv.nextTo(vEnd, UP, 0.12).shift([0.2, 0, 0]);
scene.add(lv);
await scene.play(new Write(lv));
await scene.play(applyMatrix(plane, M, { duration: 2 }), applyMatrix(e1, M, { duration: 2 }), applyMatrix(e2, M, { duration: 2 }), applyMatrix(vArr, M, { duration: 2 }));
const cap = new Text({ text: "变换后 v 仍在虚线(同一直线)→ 只被拉伸 λ 倍,方向不变", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.17);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(vArr, { color: WHITE, duration: 0.9 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 8. 序列极限:ε-N 收敛到 0 =================
  {
    id: "math-sequence-limit",
    source: "经典 manim 动画题材改写(序列逐项逼近极限)",
    domain: "math",
    category: "实数/分析",
    title: "数列极限:1/n 无限逼近 0",
    intent: "数列 a_n = 1/n 的项随着 n 增大越来越趋近 0,但永远不到 0;用红点逐项落点看到「任意给定 ε,都存在 N 使 n>N 时 |a_n-0|<ε」的收敛本质。",
    params: [{ name: "maxn", label: "显示项数", min: 5, max: 40, step: 1, default: 20 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, AnimationGroup, BLUE, BLUE_C, BLUE_D, GRAY, WHITE, UP, DOWN, LaggedStartMap , params } = ctx;
const axes = new Axes({ xRange: [0, 22, 2], yRange: [-0.1, 1.3, 0.2], xLength: 9, yLength: 4.2, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "数列极限:1/n 收敛到 0", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "\\lim_{n\\to\\infty}\\frac{1}{n}=0", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.25);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new Write(eq));
const line0 = axes.plot((x) => 0, { xRange: [0, 22], color: BLUE_D, strokeWidth: 2 });
scene.add(line0);
await scene.play(new Create(line0));
let maxn = Math.round(params.maxn);
const dots = [];
for (let n = 1; n <= maxn; n++) dots.push(new Dot({ point: axes.c2p(n, 1 / n), radius: 0.06, color: BLUE_C }));
for (const d of dots) scene.add(d);
await scene.play(new LaggedStartMap(FadeIn, dots, { lagRatio: 0.12 }));
const epsLine = axes.plot((x) => 0.12, { xRange: [0, 22], color: GRAY, strokeWidth: 1.5, dashLength: 0.12 });
scene.add(epsLine);
const cap = new Text({ text: "灰色虚线 = ε 带:之后所有项都落进带内", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.18);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(dots[dots.length - 1], { color: BLUE_C, duration: 0.7 }));
const note = new Text({ text: "n 越大越贴近 0(但永不为 0)", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(cap, DOWN, 0.14);
await scene.play(new Write(note));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 9. 函数连续 vs 间断点 =================
  {
    id: "math-continuity",
    source: "原生 manim-web:Axes.plot 函数绘制(Python Manim 经典题材改写)",
    domain: "math",
    category: "实数/分析",
    title: "连续与间断:可去间断点",
    intent: "函数在某点左极限=右极限但无定义(或值与极限不同)时出现可去间断点;补上该点值即连续 —— 直观理解「连续 = 极限值等于函数值」。",
    params: [{ name: "show", label: "补点连续", min: 0, max: 1, step: 1, default: 0 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GRAY, WHITE, UP, DOWN , params } = ctx;
const axes = new Axes({ xRange: [-2.4, 3, 1], yRange: [-0.6, 3.4, 1], xLength: 7, yLength: 5.0, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "连续:极限值 = 函数值", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "\\lim_{x\\to a}f(x)=f(a)", fontSize: 25, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.25);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new Write(eq));
// f(x) = (x^2 - 1)/(x - 1),在 x=1 处无定义(可去间断),极限 = 2
const f = (x) => (x * x - 1) / (x - 1);
const curve = axes.plot((x) => { if (Math.abs(x - 1) < 0.12) return NaN; return f(x); }, { xRange: [-2.2, 2.9], color: BLUE, strokeWidth: 3 });
scene.add(curve);
await scene.play(new Create(curve));
const hole = new Dot({ point: axes.c2p(1, 2), radius: 0.055, color: WHITE });
scene.add(hole);
const labH = new Text({ text: "x=1 无定义(空心)", fontSize: 21, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
labH.nextTo(axes.c2p(1, 2), UP, 0.2).shift([0.4, 0, 0]);
scene.add(labH);
const limD = new Dot({ point: axes.c2p(1, 2), radius: 0.13, color: BLUE_C });
scene.add(limD);
await scene.play(new Indicate(limD, { color: BLUE_C, duration: 0.8 }));
const cap = new Text({ text: "左右极限 = 2,但函数在此处无值 → 可去间断", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.18);
scene.add(cap);
await scene.play(new Write(cap));
await scene.wait(0.5);
if (Math.round(params.show) === 1) {
  const fill = new Dot({ point: axes.c2p(1, 2), radius: 0.13, color: BLUE_C });
  scene.add(fill);
  await scene.play(new FadeIn(fill));
  await scene.remove(hole);
  const note = new Text({ text: "补上 f(1)=2 就连续了 ✓", fontSize: 23, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
  note.nextTo(cap, DOWN, 0.15);
  await scene.play(new Write(note));
  await scene.wait(0.6);
}
await scene.wait(0.6);
`.trim(),
  },

  // ================= 10. 复数与单位圆:e^{iθ} 旋转 =================
  {
    id: "math-complex-unit-circle",
    source: "原生 manim-web:ComplexPlane/基于 pr2pt 的极坐标(Python Manim/3b1b 经典题材改写)",
    domain: "math",
    category: "复数",
    title: "单位圆上复数:e^{iθ} 绕一圈",
    intent: "在复平面上,单位圆上的点 e^{iθ} 随 θ 增大绕原点旋转;旋转即乘以单位模复数 —— 直观看到复指数与旋转的对应,理解欧拉公式的几何意义。",
    params: [{ name: "rev", label: "圈数", min: 1, max: 3, step: 0.5, default: 1 }],
    sceneCode: `
const { scene, ComplexPlane, Circle, Dot, Line, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GRAY, WHITE, UP, DOWN, easeOut , params } = ctx;
const plane = new ComplexPlane({ xRange: [-3, 3, 1], yRange: [-3, 3, 1] });
scene.add(plane);
const unit = new Circle({ radius: 2.5, color: BLUE_D, strokeWidth: 2.5 });
unit.moveTo([0, 0, 0]);
scene.add(unit);
const title = new Text({ text: "复数在单位圆上旋转:e^{iθ}", fontSize: 27, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "e^{i\\theta}=\\cos\\theta+i\\sin\\theta", fontSize: 25, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(unit, DOWN, 0.3);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new Create(unit));
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const th = new ValueTracker(0);
const z = new Dot({ point: [2.5, 0, 0], radius: 0.13, color: BLUE_C });
const arm = new Line({ start: [0, 0, 0], end: [2.5, 0, 0], color: BLUE_D, strokeWidth: 2.5 });
z.addUpdater((d) => { const a = th.getValue(); d.moveTo([2.5 * Math.cos(a), 2.5 * Math.sin(a), 0]); });
arm.addUpdater((ln) => { const a = th.getValue(); ln.become(new Line({ start: [0, 0, 0], end: [2.5 * Math.cos(a), 2.5 * Math.sin(a), 0], color: BLUE_D, strokeWidth: 2.5 })); });
scene.add(arm, z);
const labZ = new Text({ text: "z = cosθ + i·sinθ", fontSize: 21, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
z.addUpdater(() => labZ.nextTo(z.getCenter(), UP, 0.18).shift([0.2, 0, 0]));
scene.add(labZ);
await scene.play(new Create(arm));
await scene.play(new FadeIn(z));
const cap = new Text({ text: "θ 变化 → 复数值绕单位圆旋转", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.18);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(th.animateTo(2 * Math.PI * params.rev, { duration: 3.5, rateFunc: easeOut }));
await scene.play(new Indicate(z, { color: BLUE_C, duration: 0.7 }));
await scene.wait(0.6);
`.trim(),
  },

  // ================= 11. 向量点积:投影 × 长度 =================
  {
    id: "math-dot-product",
    source: "经典 manim 动画题材改写(点积 = 投影)",
    domain: "math",
    category: "线性代数/向量",
    title: "点积:一向量在另一向量上的投影",
    intent: "a·b = |a||b|cosθ,等价于 |b| 乘以 a 在 b 方向上的投影;θ=90° 时点积为 0(垂直)→ 这是「点积度量共线程度」的几何直觉。",
    params: [{ name: "angle", label: "夹角 θ°", min: 0, max: 170, step: 5, default: 50 }],
    sceneCode: `
const { scene, Axes, Arrow, Dot, Text, MathTexImage, DashedLine, Create, Write, FadeIn, GrowArrow, Indicate, LaggedStartMap, BLUE, BLUE_C, BLUE_D, GRAY, WHITE, UP, DOWN , params } = ctx;
const axes = new Axes({ xRange: [0, 4.9, 1], yRange: [0, 4.9, 1], xLength: 4.9, yLength: 4.9, axisConfig: { color: "#2b3a52", strokeWidth: 1.5 } });
scene.add(axes);
const title = new Text({ text: "点积 = 投影长 × 模长", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "a\\cdot b=|a||b|\\cos\\theta", fontSize: 25, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.25);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new Write(eq));
const o = [1.4, 1.1, 0];
const aEnd = [4.3, 1.1, 0];
const aVec = new Arrow({ start: o, end: aEnd, color: BLUE_D, strokeWidth: 3.5, tipLength: 0.2, tipWidth: 0.14 });
scene.add(aVec);
const ang = Math.min(1.65, params.angle * (Math.PI / 180));
const bLen = 3.4;
const bEnd = [o[0] + bLen * Math.cos(ang), o[1] + bLen * Math.sin(ang), 0];
const bVec = new Arrow({ start: o, end: bEnd, color: BLUE_C, strokeWidth: 3.5, tipLength: 0.2, tipWidth: 0.14 });
scene.add(bVec);
await scene.play(new GrowArrow(aVec), new GrowArrow(bVec));
// 投影:b 起点到水平轴,a 方向分量(先用 2D 平面坐标,把 axes 数据坐标当场景坐标:o/a 用场景坐标手摆)
// 用纯场景坐标逐分量计算(不用 axes,避免 c2p 混淆),水平为 a
const projLen = bLen * Math.cos(ang);
const projEnd = [o[0] + projLen, o[1], 0];
const drop = new DashedLine({ start: bEnd, end: [bEnd[0], o[1], 0], color: GRAY, strokeWidth: 2, dashLength: 0.12 });
const projArr = new Arrow({ start: o, end: projEnd, color: "#a8c8e8", strokeWidth: 2.6, tipLength: 0.14, tipWidth: 0.1 });
scene.add(drop, projArr);
await scene.play(new LaggedStartMap(FadeIn, [drop, projArr], { lagRatio: 0.25 }));
const la = new Text({ text: "a", fontSize: 22, color: BLUE_D, fontFamily: '"Times New Roman","SimSun",serif' });
const lb = new Text({ text: "b", fontSize: 22, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
const lp = new Text({ text: "b 的投影", fontSize: 19, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
la.nextTo(aEnd, UP, 0.1).shift([0.1, 0, 0]);
lb.nextTo(bEnd, UP, 0.1).shift([0.15, 0, 0]);
lp.nextTo(projEnd, DOWN, 0.1).shift([0.1, 0, 0]);
scene.add(la, lb, lp);
await scene.play(new Write(la), new Write(lb));
await scene.play(new Write(lp));
const cap = new Text({ text: "投影长 = |b|cosθ", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.18);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(projArr, { color: "#a8c8e8", duration: 0.8 }));
const val = new Text({ text: "θ=90° 时 cosθ=0 → 点积为 0(垂直)", fontSize: 21, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
val.nextTo(cap, DOWN, 0.14);
scene.add(val);
await scene.play(new Write(val));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 12. 向量叉积:3D 平行四边形面积 =================
  {
    id: "math-cross-product-3d",
    source: "经典 manim/3b1b 动画题材改写(3D 叉积 = 垂直向量 + 面积)",
    domain: "math",
    category: "线性代数/向量",
    title: "叉积:结果向量的方向与面积",
    intent: "两向量的叉积 a×b 是一个垂直于 a、b 的向量,其模长等于 a、b 张成的平行四边形面积 —— 3D 视角展示方向(右手定则)与面积意义。",
    params: [{ name: "rot", label: "展示旋转", min: 0, max: 1, step: 1, default: 1 }],
    is3D: true,
    sceneCode: `
const { scene, ThreeDAxes, Arrow3D, Dot3D, Polygon, Text, MathTexImage, Create, Write, FadeIn, Indicate, WHITE, BLUE, BLUE_C, BLUE_D, GOLD, UP , params } = ctx;
scene.setCameraOrientation(62 * (Math.PI / 180), -50 * (Math.PI / 180));
const axes = new ThreeDAxes({ xRange: [-2, 3.4, 1], yRange: [-2, 3.4, 1], zRange: [-1.5, 3.4, 1], axisColor: "#2b3a52", tipLength: 0.26, tipRadius: 0.1, shaftRadius: 0.008 });
scene.add(axes);
const title = new Text({ text: "叉积 a×b:垂直 + 面积", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
scene.addFixedInFrameMobjects(title);
title.moveTo([0, 3.2, 0]);
const eq = new MathTexImage({ renderer: "katex", latex: "|a\\times b|=|a||b|\\sin\\theta", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
scene.addFixedInFrameMobjects(eq);
eq.moveTo([0, -2.9, 0]);
await scene.play(new Write(title));
const aEnd = [2.4, 0.6, 0.2];
const bEnd = [0.3, 2.2, 0.9];
const aV = new Arrow3D({ start: [0, 0, 0], end: aEnd, color: BLUE_D, tipLength: 0.25, tipRadius: 0.08, shaftRadius: 0.02 });
const bV = new Arrow3D({ start: [0, 0, 0], end: bEnd, color: BLUE_C, tipLength: 0.25, tipRadius: 0.08, shaftRadius: 0.02 });
scene.add(aV, bV);
await scene.play(new Create(aV, { duration: 0.7 }), new Create(bV, { duration: 0.7 }));
const cross = [aEnd[1] * bEnd[2] - aEnd[2] * bEnd[1], aEnd[2] * bEnd[0] - aEnd[0] * bEnd[2], aEnd[0] * bEnd[1] - aEnd[1] * bEnd[0]];
const crossLen = Math.sqrt(cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]);
const unit = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen];
const cv = new Arrow3D({ start: [0, 0, 0], end: [unit[0] * 2.4, unit[1] * 2.4, unit[2] * 2.4], color: GOLD, tipLength: 0.25, tipRadius: 0.08, shaftRadius: 0.02 });
scene.add(cv);
await scene.play(new Create(cv, { duration: 1 }));
const la = new Text({ text: "a", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
const lb = new Text({ text: "b", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
scene.addFixedInFrameMobjects(la, lb);
la.moveTo([2.9, 0.7, 0.3]);
lb.moveTo([0.4, 2.4, 1.1]);
await scene.play(new Write(la), new Write(lb));
const cap = new Text({ text: "金色 = a×b ⊥ a,b;模长 = 平行四边形面积", fontSize: 20, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
scene.addFixedInFrameMobjects(cap);
cap.moveTo([0, -2.2, 0]);
await scene.play(new Write(cap));
if (Math.round(params.rot) === 1) { scene.beginAmbientCameraRotation(0.04); }
await scene.wait(2);
if (Math.round(params.rot) === 1) { scene.stopAmbientCameraRotation(); }
await scene.play(new Write(eq));
await scene.wait(0.6);
`.trim(),
  },

  // ================= 13. 参数曲线:利萨茹 =================
  {
    id: "math-lissajous-parametric",
    source: "原生 manim-web:ParametricFunction 绘制",
    domain: "math",
    category: "参数曲线",
    title: "参数曲线:利萨茹图形",
    intent: "x=a·cos(mt)、y=b·cos(nt) 这样的参数方程把时间 t 同时喂给两个坐标,得到封闭的利萨茹曲线 —— 直观理解参数方程「两个坐标由一个参数共同驱动」的本质。",
    params: [{ name: "m", label: "频率比 m", min: 1, max: 6, step: 1, default: 3 }],
    sceneCode: `
const { scene, Axes, ParametricFunction, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE_C, WHITE, UP, DOWN , params } = ctx;
const axes = new Axes({ xRange: [-1.6, 1.6, 1], yRange: [-1.6, 1.6, 1], xLength: 6.5, yLength: 6, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "参数曲线:利萨茹 x=cos(mt), y=sin(nt)", fontSize: 25, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
const m = Math.max(1, Math.round(params.m));
const n = m === 1 ? 2 : m + 1;
const curve = new ParametricFunction({
  func: (t) => axes.c2p(Math.cos(m * t), Math.sin(n * t)),
  tRange: [0, 2 * Math.PI],
  color: BLUE_C,
  strokeWidth: 3,
  numSamples: 400
});
scene.add(curve);
await scene.play(new Create(curve, { duration: 1.5 }));
const eq = new MathTexImage({ renderer: "katex", latex: "\\vec r(t)=(\\cos(" + m + "t),\\,\\sin(" + n + "t))", fontSize: 22, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.28);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.6 }));
const cap = new Text({ text: "参数 t 同时驱动 x、y,曲线形状由频率比 m:n 决定", fontSize: 23, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.16);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(curve, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 14. 极坐标:玫瑰线 =================
  {
    id: "math-polar-rose",
    source: "原生 manim-web:PolarPlane + ParametricFunction(Python Manim 经典题材改写)",
    domain: "math",
    category: "极坐标",
    title: "极坐标玫瑰线 r = a·cos(kθ)",
    intent: "极坐标用半径与角度描述点;r(θ)=a·cos(kθ) 因角度周期产生花瓣 —— 直观理解极坐标方程的周期性、当 k 为奇数/偶数时花瓣数与 k 的关系。",
    params: [{ name: "k", label: "花数参数 k", min: 1, max: 8, step: 1, default: 4 }],
    sceneCode: `
const { scene, PolarPlane, ParametricFunction, Dot, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, WHITE, UP, DOWN , params } = ctx;
const plane = new PolarPlane({ radius: 3, size: 6.4, radialDivisions: 3, angularDivisions: 12, gridColor: "#2b3a52", gridStrokeWidth: 1, labelFontSize: 16, labelColor: WHITE });
scene.add(plane);
const title = new Text({ text: "极坐标玫瑰线 r = a·cos(kθ)", fontSize: 27, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
let k = Math.max(1, Math.round(params.k));
const a = 2.6;
const rose = new ParametricFunction({
  func: (t) => plane.pr2pt(a * Math.cos(k * t), t),
  tRange: [0, 2 * Math.PI],
  color: BLUE_C,
  strokeWidth: 3,
  numSamples: 500
});
scene.add(rose);
await scene.play(new Write(title));
await scene.play(new Create(rose, { duration: 1.6 }));
const eq = new MathTexImage({ renderer: "katex", latex: "r=" + a + "\\cos(" + k + "\\theta)", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(plane, DOWN, 0.3);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.6 }));
const petal = (k % 2 === 0) ? (k + 2) : k;
const cap = new Text({ text: "k=" + k + ":当 k 为偶数花瓣 = " + petal + ",奇数花瓣 = " + petal + " 个", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.16);
scene.add(cap);
await scene.play(new Write(cap));
const note = new Text({ text: "θ 扫一圈 r 的正负形成对称花瓣", fontSize: 21, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(cap, DOWN, 0.13);
await scene.play(new Write(note));
await scene.play(new Indicate(rose, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 15. 几何级数:收敛=有穷和 =================
  {
    id: "math-geometric-series",
    source: "经典 manim 动画题材改写(几何级数收敛)",
    domain: "math",
    category: "级数",
    title: "几何级数:公比 |r|<1 时部分和收敛",
    intent: "1 + r + r² + ... 当 |r|<1 时部分和收敛到 1/(1-r),|r|≥1 时发散 —— 直观理解「级数是否收敛取决于相邻项之比是否趋于 0」。",
    params: [{ name: "r", label: "公比 r", min: 0.2, max: 0.9, step: 0.05, default: 0.6 }],
    sceneCode: `
const { scene, Axes, Rectangle, Dot, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, AnimationGroup, BLUE, BLUE_C, BLUE_D, WHITE, UP, DOWN, LaggedStartMap , params } = ctx;
const axes = new Axes({ xRange: [0, 24, 2], yRange: [-0.2, 2.2, 0.4], xLength: 9, yLength: 4.6, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "几何级数:部分和收敛到 1/(1-r)", fontSize: 26, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "\\sum_{n=0}^{\\infty}r^n=\\frac{1}{1-r} \\quad(|r|<1)", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.28);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new Write(eq));
const r = params.r;
const limitY = 1 / (1 - r);
const limLine = axes.plot((x) => limitY, { xRange: [0, 24], color: BLUE_D, strokeWidth: 2 });
scene.add(limLine);
await scene.play(new Create(limLine));
const maxn = 22;
const terms = [];
let partial = 0;
for (let i = 0; i <= maxn; i++) { partial += Math.pow(r, i); terms.push(new Dot({ point: axes.c2p(i, partial), radius: 0.08, color: BLUE_C })); }
for (const d of terms) scene.add(d);
await scene.play(new LaggedStartMap(FadeIn, terms, { lagRatio: 0.1 }));
const cap = new Text({ text: "各红点 = 前 n 项部分和,逼近虚线 y=1/(1-r)", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.16);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(terms[terms.length - 1], { color: BLUE_C, duration: 0.7 }));
const note = new Text({ text: "|r| < 1 → 收敛;|r| ≥ 1 → 发散", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(cap, DOWN, 0.13);
await scene.play(new Write(note));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 16. 双曲函数:单位双曲线 =================
  {
    id: "math-hyperbolic",
    source: "原生 manim-web:ParametricFunction 绘制(Python Manim 经典题材改写)",
    domain: "math",
    category: "微积分/函数",
    title: "双曲函数 cosh、sinh 与单位双曲线",
    intent: "(cosh t, sinh t) 落在单位双曲线 x²−y²=1 上,类比 (cos θ, sin θ) 在单位圆 —— 直观理解双曲三角函数是双曲线的参数化,与指数函数 e^t 的联系。",
    params: [{ name: "tmax", label: "参数 t 最大值", min: 1, max: 2.6, step: 0.2, default: 1.8 }],
    sceneCode: `
const { scene, Axes, ParametricFunction, Dot, DashedLine, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GRAY, WHITE, UP, DOWN , params } = ctx;
const axes = new Axes({ xRange: [-0.3, 2.8, 0.5], yRange: [-2.2, 2.2, 0.5], xLength: 6.4, yLength: 5.2, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "双曲函数:(cosh t, sinh t) 在单位双曲线上", fontSize: 24, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const right = axes.plot((x) => { const v = x * x - 1; return v < 0 ? NaN : Math.sqrt(v); }, { xRange: [0, 2.7], color: BLUE_D, strokeWidth: 2.5 });
const left = axes.plot((x) => { const v = x * x - 1; return v < 0 ? NaN : -Math.sqrt(v); }, { xRange: [0, 2.7], color: BLUE_D, strokeWidth: 2.5 });
scene.add(right, left);
await scene.play(new Write(title));
await scene.play(new Create(right), new Create(left));
const eq = new MathTexImage({ renderer: "katex", latex: "\\cosh^2 t-\\sinh^2 t=1", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.28);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.6 }));
const tV = new ValueTracker(params.tmax);
const P = function () { const t = tV.getValue(); return axes.c2p(Math.cosh(t), Math.sinh(t)); };
const dot = new Dot({ point: P(), radius: 0.11, color: BLUE_C });
const arm = new DashedLine({ start: axes.c2p(0, 0), end: P(), color: GRAY, strokeWidth: 2, dashLength: 0.1 });
dot.addUpdater((d) => d.moveTo(P()));
arm.addUpdater((ln) => ln.become(new DashedLine({ start: axes.c2p(0, 0), end: P(), color: GRAY, strokeWidth: 2, dashLength: 0.1 })));
scene.add(dot, arm);
await scene.play(new FadeIn(dot));
await scene.play(new Create(arm));
const lab = new Text({ text: "(cosh t, sinh t)", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
lab.nextTo(P(), UP, 0.15).shift([0.25, 0, 0]);
scene.add(lab);
await scene.play(new Write(lab));
const note = new Text({ text: "类比单位圆 (cosθ, sinθ),但这里参数是双曲角 t", fontSize: 21, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.16);
scene.add(note);
await scene.play(new Write(note));
await scene.play(tV.animateTo(0.8, { duration: 2 }));
await scene.play(new Indicate(dot, { color: BLUE_C, duration: 0.7 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 17. 方向导数:曲面沿某方向的坡度 =================
  {
    id: "math-directional-derivative",
    source: "经典 manim 动画题材改写(3D 方向导数,金标准 m-gradient-surface 同款)",
    domain: "math",
    category: "多元微积分",
    title: "方向导数:沿指定方向的瞬时变化率",
    intent: "在曲面上取一点,沿一个方向切一刀得到一条曲线,其斜线斜率就是该方向的方向导数 D_uf = ∇f·u —— 梯度是「所有方向导数的最大方向」。",
    is3D: true,
    params: [{ name: "az", label: "方位角 θ°", min: 0, max: 90, step: 5, default: 45 }],
    sceneCode: `
const { scene, ThreeDAxes, Surface3D, Dot3D, Line3D, Text, MathTexImage, ParametricFunction, Create, Write, Indicate, WHITE, BLUE, BLUE_C, GOLD , params } = ctx;
scene.setCameraOrientation(60 * (Math.PI / 180), -40 * (Math.PI / 180));
const axes = new ThreeDAxes({ xRange: [-3, 3, 1], yRange: [-3, 3, 1], zRange: [0, 4, 1], axisColor: "#2b3a52", tipLength: 0.26, tipRadius: 0.1, shaftRadius: 0.008 });
const f = (x, y) => 0.3 * (x * x + y * y);
const surf = new Surface3D({ func: (u, v) => [u, v, f(u, v)], uRange: [-2.4, 2.4], vRange: [-2.4, 2.4], uResolution: 22, vResolution: 22, color: BLUE, opacity: 0.85 });
scene.add(axes, surf);
const title = new Text({ text: "方向导数:曲面沿某方向的坡度", fontSize: 24, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
scene.addFixedInFrameMobjects(title);
title.moveTo([0, 3.2, 0]);
const eq = new MathTexImage({ renderer: "katex", latex: "D_{\\hat u}f=\\nabla f\\cdot \\hat u", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
scene.addFixedInFrameMobjects(eq);
eq.moveTo([0, -2.9, 0]);
await scene.play(new Write(title));
await scene.play(new Create(surf, { duration: 1.4 }));
const az = params.az * (Math.PI / 180);
const p = [1.2, 0.6];
const u = [Math.cos(az), Math.sin(az)];
const tRange = 1.6;
const line3 = new Line3D({ start: [p[0] - u[0] * tRange, p[1] - u[1] * tRange, f(p[0] - u[0] * tRange, p[1] - u[1] * tRange)], end: [p[0] + u[0] * tRange, p[1] + u[1] * tRange, f(p[0] + u[0] * tRange, p[1] + u[1] * tRange)], color: GOLD, strokeWidth: 2.5 });
scene.add(line3);
await scene.play(new Create(line3, { duration: 1.2 }));
const pt = [p[0], p[1], f(p[0], p[1])];
const dot3 = new Dot3D({ point: pt, radius: 0.08, color: WHITE, glow: true });
const grad = [0.6 * p[0], 0.6 * p[1]];
const along = [grad[0] + 2.2 * u[0], grad[1] + 2.2 * u[1]];
const dirV = new Dot3D({ point: [pt[0] + u[0] * 1.1, pt[1] + u[1] * 1.1, f(pt[0] + u[0] * 1.1, pt[1] + u[1] * 1.1)], radius: 0.07, color: BLUE_C, glow: true });
scene.add(dot3, dirV);
await scene.play(new Create(dot3, { duration: 0.6 }));
const cap = new Text({ text: "金色曲线斜率 = 沿 ŵ 的方向导数", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
scene.addFixedInFrameMobjects(cap);
cap.moveTo([0, -2.2, 0]);
await scene.play(new Write(cap));
await scene.play(new Indicate(line3, { color: GOLD, duration: 0.9 }));
scene.beginAmbientCameraRotation(0.04);
await scene.wait(2);
scene.stopAmbientCameraRotation();
await scene.play(new Write(eq));
await scene.wait(0.6);
`.trim(),
  },

  // ================= 18. 凹凸性与二阶导 =================
  {
    id: "math-concavity-second-derivative",
    source: "原生 manim-web:二阶导符号与凹凸(Python Manim 经典题材改写)",
    domain: "math",
    category: "微积分",
    title: "函数凹凸性:f'' 的符号",
    intent: "f''>0 时函数下凸(开口向上、斜率递增),f''<0 时上凸;二阶导符号翻转处即拐点 —— 直观理解二阶导与凹凸性的关系。",
    params: [{ name: "infl", label: "拐点位置", min: 0, max: 1, step: 0.05, default: 0.5 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GRAY, WHITE, UP, DOWN , params } = ctx;
const axes = new Axes({ xRange: [-3.4, 3.4, 1], yRange: [-1.6, 2.4, 0.5], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "凹凸性:由二阶导符号决定", fontSize: 27, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "f''(x)>0\\;\\text{下凸},\\quad f''(x)<0\\;\\text{上凸}", fontSize: 23, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.28);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new FadeIn(eq, { duration: 0.6 }));
// f(x) = (x^3/6) - x, f'' = x;拐点 x=0
const f = (x) => x * x * x / 6 - x;
const curve = axes.plot(f, { xRange: [-3.2, 3.2], color: BLUE, strokeWidth: 3 });
scene.add(curve);
await scene.play(new Create(curve));
const infPt = axes.c2p(0, f(0));
const inflDot = new Dot({ point: infPt, radius: 0.12, color: BLUE_C });
scene.add(inflDot);
await scene.play(new FadeIn(inflDot));
const l1 = axes.c2p(-2.2, f(-2.2));
const l2 = axes.c2p(2.2, f(2.2));
const concUp = new Text({ text: "x<0:f''<0 上凸", fontSize: 22, color: BLUE_D, fontFamily: '"Times New Roman","SimSun",serif' });
const concDn = new Text({ text: "x>0:f''>0 下凸", fontSize: 22, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
concDn.nextTo(axes.c2p(1.4, f(1.4)), DOWN, 0.3);
concUp.nextTo(axes.c2p(-1.4, f(-1.4)), UP, 0.2);
scene.add(concUp, concDn);
await scene.play(new Write(concUp), new Write(concDn));
const cap = new Text({ text: "f'' 变号处 = 拐点(蓝点,二阶导为 0)", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.16);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(inflDot, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 19. 积分换元 u-substitution 可视化 =================
  {
    id: "math-integration-substitution",
    source: "原生 manim-web:getArea/曲线下区域(Python Manim 经典题材改写)",
    domain: "math",
    category: "微积分",
    title: "积分换元:u=2x 把区间与面积归一化",
    intent: "换元 u=g(x) 改变自变量刻度,面积在 x 与 u 两种坐标下的图形被拉伸/压缩,但换元公式保证积分值不变 —— 直观理解凑微分/换元法背后的几何。",
    params: [{ name: "k", label: "换元系数 k", min: 1, max: 4, step: 0.5, default: 2 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, Create, Write, FadeIn, Indicate, AnimationGroup, BLUE, BLUE_C, BLUE_D, WHITE, UP, DOWN , params } = ctx;
const axes1 = new Axes({ xRange: [-0.2, 3.2, 1], yRange: [-0.2, 4.4, 1], xLength: 5.4, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
axes1.moveTo([-3.2, 0, 0]);
const f = (x) => x * x;
const g1 = axes1.plot(f, { xRange: [0, 2.0], color: BLUE, strokeWidth: 3 });
const area1 = axes1.getArea(g1, [0.3, 1.9], { color: BLUE_C, opacity: 0.35, strokeWidth: 0 });
const axes2 = new Axes({ xRange: [-0.2, 6.4, 1], yRange: [-0.2, 4.4, 1], xLength: 5.6, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
axes2.moveTo([3.2, 0, 0]);
const k = Math.max(1, Math.min(3, params.k));
const g2 = axes2.plot((u) => (u / k) * (u / k), { xRange: [0, k * 2.0], color: BLUE_C, strokeWidth: 3 });
const area2 = axes2.getArea(g2, [k * 0.3, k * 1.9], { color: BLUE_D, opacity: 0.35, strokeWidth: 0 });
scene.add(axes1, g1, area1, axes2, g2, area2);
const title = new Text({ text: "积分换元:u = kx 拉伸坐标轴", fontSize: 27, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "\\int f(x)\\,dx\\;\\xrightarrow{u=kx}\\;\\frac{1}{k}\\int f(u)\\,du", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes1, DOWN, 0.35);
const cap1 = new Text({ text: "左侧:x 坐标的曲线", fontSize: 21, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
cap1.nextTo(axes1, DOWN, 0.15);
const cap2 = new Text({ text: "右侧:u=kx 坐标拉宽", fontSize: 21, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
cap2.nextTo(axes2, DOWN, 0.15);
scene.add(title, eq, cap1, cap2);
await scene.play(new Write(title));
await scene.play(new Create(g1), new Create(g2));
await scene.play(new FadeIn(area1), new FadeIn(area2));
await scene.play(new FadeIn(eq, { duration: 0.6 }));
await scene.play(new Write(cap1), new Write(cap2));
const note = new Text({ text: "右侧面积 ×(1/k)+源自 dx=(1/k)du,积分值不变", fontSize: 21, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
await scene.play(new Indicate(eq, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 20. 复数乘法几何:旋转 + 缩放 =================
  {
    id: "math-complex-multiplication-geometry",
    source: "经典 3b1b 动画题材改写(复数乘法 = 旋转×缩放)",
    domain: "math",
    category: "复数",
    title: "复数相乘 = 角度相加、长度相乘",
    intent: "两复数相乘时,模长相乘、辐角相加;乘以 e^{iθ} 相当于把整个平面旋转 θ —— 直观建立复数乘法的几何意义(旋转 + 缩放)。",
    params: [{ name: "scale", label: "缩放倍数", min: 0.4, max: 2.2, step: 0.1, default: 1.5 }],
    sceneCode: `
const { scene, ComplexPlane, Circle, Line, Arrow, Dot, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, GrowArrow, AnimationGroup, BLUE, BLUE_C, BLUE_D, GRAY, WHITE, UP, DOWN , params } = ctx;
const plane = new ComplexPlane({ xRange: [-3, 3, 1], yRange: [-3, 3, 1] });
scene.add(plane);
const title = new Text({ text: "复数乘法:角度相加、长度相乘", fontSize: 26, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "(r_1e^{i\\theta_1})(r_2e^{i\\theta_2})=r_1r_2e^{i(\\theta_1+\\theta_2)}", fontSize: 23, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(plane, DOWN, 0.3);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new FadeIn(eq, { duration: 0.6 }));
const z1 = [2.2, 0.6, 0];        // z1 = r1 e^{iθ1}
const r1 = Math.sqrt(z1[0] * z1[0] + z1[1] * z1[1]);
const th1 = Math.atan2(z1[1], z1[0]);
const th2 = 0.9;                 // z2 = s·e^{iθ2}
const s = params.scale;
// 结果 z = z1 * z2:模长 r1*s,角度 th1+th2
const rz = r1 * s;
const res = [rz * Math.cos(th1 + th2), rz * Math.sin(th1 + th2), 0];
const a1 = new Arrow({ start: [0, 0, 0], end: z1, color: BLUE_D, strokeWidth: 3, tipLength: 0.2, tipWidth: 0.14 });
const a2 = new Arrow({ start: [0, 0, 0], end: [s * Math.cos(th2), s * Math.sin(th2), 0], color: BLUE_C, strokeWidth: 3, tipLength: 0.2, tipWidth: 0.14 });
const aR = new Arrow({ start: [0, 0, 0], end: res, color: "#a8c8e8", strokeWidth: 3.2, tipLength: 0.2, tipWidth: 0.14 });
scene.add(a1, a2, aR);
await scene.play(new GrowArrow(a1), new GrowArrow(a2));
const l1 = new Text({ text: "z₁", fontSize: 21, color: BLUE_D, fontFamily: '"Times New Roman","SimSun",serif' });
const l2 = new Text({ text: "z₂", fontSize: 21, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
const lR = new Text({ text: "z₁·z₂", fontSize: 20, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
l1.nextTo(z1, UP, 0.12).shift([0.15, 0, 0]);
l2.nextTo([s * Math.cos(th2), s * Math.sin(th2), 0], UP, 0.12).shift([0.15, 0, 0]);
lR.nextTo(res, UP, 0.12).shift([0.15, 0, 0]);
scene.add(l1, l2, lR);
await scene.play(new Write(l1), new Write(l2));
await scene.play(new GrowArrow(aR));
await scene.play(new Write(lR));
const cap = new Text({ text: "结果方向 = θ₁+θ₂,长度 = r₁×r₂", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.17);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(aR, { color: "#a8c8e8", duration: 0.9 }));
await scene.wait(0.8);
`.trim(),
  },
];