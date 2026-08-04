// =============================================================================
// 人工手写第一批"好镜头" manim-web 动画模板库(供生成 agent 学习 + 独立网页逐个检查)
//
// 每个模板 = 教学意图(intent,这一镜让学生看懂什么,也作为给 LLM 的参考)
//           + 可直接运行的 sceneCode(与 step_agent 产物完全同格式:
//             开头 `const {..., params } = ctx;` 解构,用 await scene.play / scene.add 驱动)
//
// 质量标准(与 STEP_PROMPT 教学与视觉规范一致):
//   • 蓝色系梯度,禁红绿橙黄紫粉;主体 strokeWidth 3-4,辅助中性
//   • 公式用 MathTexImage(await waitForRender),Text 必带 fontFamily
//   • 相对定位(nextTo/toEdge),不手算 shift 硬凑;三区分明
//   • 进场用 Write/Create/DrawBorderThenFill/GrowArrow 而非裸 FadeIn;
//     关键量用 Indicate/Circumscribe 强调;节奏留白;结尾让结论"活"着
//   • 可交互处用 ValueTracker + addUpdater + params 滑块(实时调参)
//   • 纯 JS,无 TS 注解
//   • 解构行必须包含代码用到的所有标识符(见 manimCtx.ts 注入的 manim-web 全部导出)
// =============================================================================

export interface TemplateParam {
  name: string; label: string; min: number; max: number; step: number; default: number;
}
export interface Template {
  id: string;
  domain: "math" | "physics" | "demo";
  category: string;         // 子类:微积分/线性代数 / 力学/电磁/波动 / 演示
  title: string;            // 中文标题
  intent: string;           // 这一镜让学生看懂什么(教学意图)
  is3D?: boolean;           // 省略则运行时按 is3DCode 自动检测
  params?: TemplateParam[]; // 可调参数(滑块)
  sceneCode: string;        // manim-web 函数体
}

export const TEMPLATES: Template[] = [
  // ---------------- 数学 · 微积分 ----------------
  {
    id: "m-derivative-tangent",
    domain: "math",
    category: "微积分",
    title: "瞬时变化率:割线 → 切线",
    intent: "动点沿曲线逼近 a,割线越来越贴近曲线,最终 h→0 时割线变成切线 —— 直观建立导数 = 切线斜率 = 瞬时变化率。",
    params: [{ name: "h", label: "割线跨度 h", min: 0.25, max: 2, step: 0.05, default: 1.3 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, BLUE_E, GRAY, WHITE, UP, DOWN, easeOut , params } = ctx;
const axes = new Axes({ xRange: [-1.8, 3, 1], yRange: [-0.5, 5.5, 1], xLength: 8, yLength: 5.2, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
const f = (x) => x * x;
const curve = axes.plot(f, { xRange: [-1.6, 2.7], color: BLUE, strokeWidth: 3 });
scene.add(axes, curve);
const title = new Text({ text: "瞬时变化率:割线 → 切线", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "f'(a)=\\lim_{h\\to 0}\\frac{f(a+h)-f(a)}{h}", fontSize: 30, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.3);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new Create(curve));
await scene.play(new FadeIn(eq, { duration: 0.8 }));

const a = 1.0;
const pointA = axes.c2p(a, f(a));
const dotA = new Dot({ point: pointA, radius: 0.1, color: BLUE_E });
const hTracker = new ValueTracker(1.3);
hTracker.setValue(params.h);
const dotP = new Dot({ point: axes.c2p(a + hTracker.getValue(), f(a + hTracker.getValue())), radius: 0.1, color: BLUE_C });
const secant = new Line({ start: pointA, end: dotP.getCenter(), color: GRAY, strokeWidth: 2.5 });
const labA = new Text({ text: "a", fontSize: 26, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
labA.nextTo(pointA, DOWN, 0.12).shift([-0.1, 0, 0]);
const labAP = new Text({ text: "a+h", fontSize: 24, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
dotP.addUpdater((d) => { d.moveTo(axes.c2p(a + hTracker.getValue(), f(a + hTracker.getValue()))); labAP.nextTo(d, DOWN, 0.12).shift([0.12, 0, 0]); });
secant.addUpdater((ln) => { ln.become(new Line({ start: pointA, end: axes.c2p(a + hTracker.getValue(), f(a + hTracker.getValue())), color: GRAY, strokeWidth: 2.5 })); });
scene.add(dotA, dotP, secant, labA, labAP);
await scene.play(new FadeIn(dotA), new FadeIn(dotP));
await scene.play(new Create(secant));
await scene.play(new FadeIn(labA), new FadeIn(labAP));
await scene.play(hTracker.animateTo(0.25, { duration: 2, rateFunc: easeOut }));
await scene.play(new Indicate(dotA, { color: BLUE_E, duration: 0.8 }));
const tangent = new Line({ start: pointA, end: axes.c2p(a + 1.2, f(a) + 2 * 1.2), color: BLUE_D, strokeWidth: 3 });
await scene.play(new Create(tangent));
const note = new Text({ text: "h→0 时,割线即切线:导数 f'(a)", fontSize: 24, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.18);
await scene.play(new Write(note));
await scene.wait(0.8);
`.trim(),
  },

  {
    id: "m-riemann-integral",
    domain: "math",
    category: "微积分",
    title: "定积分:黎曼和 → 面积",
    intent: "把区间分成 N 个矩形,矩形越细,总面积越逼近曲线下的真实面积 —— 直观建立定积分 = 面积和的极限。",
    params: [{ name: "N", label: "矩形个数 N", min: 3, max: 40, step: 1, default: 12 }],
    sceneCode: `
const { scene, Axes, MathTexImage, Create, Write, FadeIn, Indicate, AnimationGroup, BLUE, BLUE_C, WHITE, UP, DOWN, LaggedStartMap , params } = ctx;
const axes = new Axes({ xRange: [-0.4, 4, 1], yRange: [-0.4, 4, 1], xLength: 7, yLength: 5.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
const f = (x) => 4 - (x - 2) * (x - 2);
const curve = axes.plot(f, { xRange: [0.2, 3.8], color: BLUE, strokeWidth: 3 });
scene.add(axes, curve);
const title = new Text({ text: "定积分 = 矩形面积和的极限", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "\\int_0^3 f(x)\\,dx=\\lim_{N\\to\\infty}\\sum_{i=1}^{N} f(x_i)\\Delta x", fontSize: 27, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.3);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new Create(curve));
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const A = 0, B = 3, N = Math.max(2, Math.round(params.N));
const rects = [];
const dx = (B - A) / N;
for (let i = 0; i < N; i++) {
  const l = A + i * dx;
  const rect = axes.getRiemannRectangles(curve, { xRange: [l, l + dx], dx: 0.01, color: BLUE_C, fillOpacity: 0.45, strokeWidth: 0.5 });
  rects.push(rect);
}
const sumText = new Text({ text: "N = " + N + "  矩形面积和 → 曲线下面积", fontSize: 24, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
sumText.nextTo(eq, DOWN, 0.18);
scene.add(...rects, sumText);
await scene.play(new LaggedStartMap(Create, rects, { lagRatio: 0.08 }));
await scene.wait(0.5);
const more = new Text({ text: "N 越大越接近真实面积", fontSize: 24, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
more.nextTo(sumText, DOWN, 0.18);
await scene.play(new Write(more));
await scene.play(new Indicate(eq, { color: BLUE_C, duration: 0.9 }));
await scene.wait(0.8);
`.trim(),
  },

  {
    id: "m-taylor-approx",
    domain: "math",
    category: "微积分",
    title: "泰勒级数:逐项逼近函数",
    intent: "用多项式逐步逼近 eˣ 在原点的邻域:项数越多拟合越接近 —— 直观理解泰勒展开的局部近似思想。",
    params: [{ name: "order", label: "最高阶 n", min: 1, max: 8, step: 1, default: 3 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, WHITE, GRAY, UP, DOWN, easeOut , params } = ctx;
const axes = new Axes({ xRange: [-3.2, 3.2, 1], yRange: [-1, 8, 1], xLength: 8, yLength: 5.2, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
const exact = axes.plot((x) => Math.exp(x), { xRange: [-3, 3], color: WHITE, strokeWidth: 2.5 });
scene.add(axes, exact);
const title = new Text({ text: "泰勒级数:多项式逼近 eˣ", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const note = new Text({ text: "白线 = 精确 eˣ", fontSize: 20, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(title, DOWN, 0.3).shift([0.2, 0, 0]);
scene.add(title, note);
await scene.play(new Write(title));
await scene.play(new Create(exact));
function taylorPoly(n) {
  return (x) => { let term = 1, sum = 1; for (let k = 1; k <= n; k++) { term = term * x / k; sum += term; } return sum; };
}
const polyColors = [BLUE_D, BLUE, BLUE_C, "#7cc6ff"];
let n = Math.max(1, Math.round(params.order));
const orderEq = new MathTexImage({ renderer: "katex", latex: "P_n(x)=\\sum_{k=0}^{n}\\frac{x^k}{k!}", fontSize: 28, color: BLUE_C });
await orderEq.waitForRender();
orderEq.nextTo(axes, DOWN, 0.3);
scene.add(orderEq);
await scene.play(new Write(orderEq));
const polyLine = axes.plot(taylorPoly(n), { xRange: [-3, 3], color: polyColors[n % polyColors.length], strokeWidth: 3 });
scene.add(polyLine);
await scene.play(new Create(polyLine, { duration: 1 }));
const caption = new Text({ text: "n = " + n + " 阶逼近", fontSize: 24, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
caption.nextTo(orderEq, DOWN, 0.15);
scene.add(caption);
await scene.play(new Write(caption));
await scene.play(new Indicate(polyLine, { color: polyColors[n % polyColors.length], duration: 0.9 }));
await scene.wait(0.8);
`.trim(),
  },

  {
    id: "m-linear-transform",
    domain: "math",
    category: "线性代数",
    title: "线性变换:矩阵作用在网格上",
    intent: "一个 2×2 矩阵把整个坐标平面(网格)和基向量一起剪切/旋转/缩放,直观看到基向量映射与面积变化。",
    params: [{ name: "shear", label: "剪切系数 s", min: -1.5, max: 1.5, step: 0.1, default: 0.8 }],
    sceneCode: `
const { scene, NumberPlane, Arrow, Text, applyMatrix, Create, Write, GrowArrow, Indicate, AnimationGroup, BLUE, BLUE_C, BLUE_D, WHITE, UP, DOWN, easeOut , params } = ctx;
const plane = new NumberPlane({ xRange: [-4, 4, 1], yRange: [-4, 4, 1] });
scene.add(plane);
const title = new Text({ text: "矩阵 = 对整个平面的线性变换", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new Text({ text: "T(x, y) = (x + s·y, y)", fontSize: 28, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
eq.nextTo(title, DOWN, 0.35);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new Write(eq));
const e1 = new Arrow({ start: [0, 0, 0], end: [1, 0, 0], color: BLUE_D, strokeWidth: 3, tipLength: 0.22, tipWidth: 0.16 });
const e2 = new Arrow({ start: [0, 0, 0], end: [0, 1, 0], color: BLUE_C, strokeWidth: 3, tipLength: 0.22, tipWidth: 0.16 });
const lab = new Text({ text: "剪切:竖直网格线整体倾斜,面积不变(行列式=1)", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
lab.toEdge(DOWN).shift([0, 0.15, 0]);
scene.add(e1, e2, lab);
await scene.play(new GrowArrow(e1), new GrowArrow(e2));
const s = params.shear;
const M = [[1, s, 0], [0, 1, 0], [0, 0, 1]];
await scene.play(applyMatrix(plane, M, { duration: 2 }), applyMatrix(e1, M, { duration: 2 }), applyMatrix(e2, M, { duration: 2 }));
await scene.play(new Indicate(e1, { color: BLUE_D, duration: 0.7 }), new Indicate(e2, { color: BLUE_C, duration: 0.7 }));
await scene.wait(0.8);
`.trim(),
  },

  {
    id: "m-gradient-surface",
    domain: "math",
    category: "多元微积分",
    title: "梯度:山坡上最陡的方向",
    intent: "在三维抛物面上,梯度向量总是垂直于等高线、指向函数增长最快的方向 —— 建立多元函数梯度的几何直觉。",
    is3D: true,
    params: [{ name: "angle", label: "视角方位 θ°", min: 0, max: 360, step: 5, default: -45 }],
    sceneCode: `
const { scene, ThreeDAxes, Surface3D, Arrow3D, Dot3D, Text, Create, Write, WHITE, BLUE, BLUE_C , params } = ctx;
const t = params.angle * (Math.PI / 180);
scene.setCameraOrientation(65 * (Math.PI / 180), t);
const axes = new ThreeDAxes({ xRange: [-3, 3, 1], yRange: [-3, 3, 1], zRange: [0, 4, 1], axisColor: "#2b3a52", tipLength: 0.3, tipRadius: 0.12, shaftRadius: 0.008 });
const f = (x, y) => 0.35 * (x * x + y * y);
const surf = new Surface3D({ func: (u, v) => [u, v, f(u, v)], uRange: [-2.5, 2.5], vRange: [-2.5, 2.5], uResolution: 24, vResolution: 24, color: BLUE, opacity: 0.85 });
scene.add(axes, surf);
const title = new Text({ text: "梯度指向最陡上升方向", fontSize: 26, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
scene.addFixedInFrameMobjects(title);
title.moveTo([0, 3.4, 0]);
await scene.play(new Create(surf, { duration: 1.5 }));
const p = [1.2, 1.0];
const grad = [0.7 * p[0], 0.7 * p[1]];
const pt = [p[0], p[1], f(p[0], p[1])];
const dot3 = new Dot3D({ point: pt, radius: 0.08, color: WHITE, glow: true });
const vec = new Arrow3D({ start: pt, end: [p[0] + grad[0] / 2.2, p[1] + grad[1] / 2.2, f(p[0], p[1]) + 0.35], color: BLUE_C, tipLength: 0.25, tipRadius: 0.08, shaftRadius: 0.02 });
scene.add(dot3, vec);
const lab = new Text({ text: "∇f", fontSize: 26, color: "#7cc6ff", fontFamily: '"Times New Roman","SimSun",serif' });
scene.addFixedInFrameMobjects(lab);
lab.moveTo([2.4, 1.2, 0]);
await scene.play(new Create(vec, { duration: 1 }));
await scene.play(new Create(dot3, { duration: 0.6 }), new Write(lab));
const cap = new Text({ text: "梯度 ⊥ 等高线,指向最陡上升", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
scene.addFixedInFrameMobjects(cap);
cap.moveTo([0, -3.2, 0]);
await scene.play(new Write(cap));
scene.beginAmbientCameraRotation(0.05);
await scene.wait(2);
scene.stopAmbientCameraRotation();
`.trim(),
  },

  // ---------------- 物理 · 力学 ----------------
  {
    id: "p-shm",
    domain: "physics",
    category: "力学",
    title: "简谐振动:圆周投影 → 位移曲线",
    intent: "质点沿参考圆匀速运动时,其投影在竖直方向做简谐运动;把投影高度随时间展开就得到正弦曲线 —— 建立 SHM 与匀速圆周运动的联系。",
    params: [{ name: "freq", label: "角频率 ω", min: 0.3, max: 2, step: 0.1, default: 1 }],
    sceneCode: `
const { scene, Circle, Dot, Line, Axes, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GRAY, WHITE, UP, DOWN, easeOut , params } = ctx;
const center = [-3, 0.4, 0];
const R = 1.4;
const circle = new Circle({ radius: R, color: BLUE_D, strokeWidth: 2.5 });
circle.moveTo(center);
scene.add(circle);
const title = new Text({ text: "圆周运动的投影 = 简谐振动", fontSize: 27, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const axisLine = new Line({ start: [center[0] - R - 0.3, center[1], 0], end: [center[0] + R + 0.3, center[1], 0], color: GRAY, strokeWidth: 1.5 });
scene.add(title, axisLine);
await scene.play(new Write(title));
await scene.play(new Create(circle));
const eq = new MathTexImage({ renderer: "katex", latex: "x(t)=A\\cos(\\omega t)", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(circle, DOWN, 0.5);
scene.add(eq);
await scene.play(new Write(eq));

const theta = new ValueTracker(0);
const dotRef = new Dot({ point: center, radius: 0.08, color: BLUE_D });
const arcDot = new Dot({ point: [center[0] + R, center[1], 0], radius: 0.11, color: BLUE_C });
const proj = new Dot({ point: [center[0] + R, center[1], 0], radius: 0.1, color: WHITE });
scene.add(dotRef, arcDot, proj);
arcDot.addUpdater((d) => { const ang = theta.getValue(); d.moveTo([center[0] + R * Math.cos(ang), center[1] + R * Math.sin(ang), 0]); });
proj.addUpdater((d) => { const ang = theta.getValue(); d.moveTo([center[0] + R * Math.cos(ang), center[1], 0]); });
await scene.play(new FadeIn(dotRef), new FadeIn(arcDot), new FadeIn(proj));

const axes = new Axes({ xRange: [0, 8, 1], yRange: [-1.6, 1.6, 1], xLength: 6.4, yLength: 2.4, axisConfig: { color: "#2b3a52", strokeWidth: 1.5 } });
axes.moveTo([3.0, -1.7, 0]);
scene.add(axes);
const trace = axes.plot((x) => R * Math.cos(x), { xRange: [0, 8], color: BLUE_C, strokeWidth: 3 });
scene.add(trace);
await scene.play(new Create(axes), new Create(trace));
const cap = new Text({ text: "时间展开 → 正弦曲线", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(axes, UP, 0.4);
scene.add(cap);
await scene.play(new Write(cap));

const w = params.freq;
await scene.play(theta.animateTo(2 * Math.PI, { duration: Math.min(6, 2 * Math.PI / w), rateFunc: easeOut }));
await scene.play(new Indicate(proj, { color: WHITE, duration: 0.7 }));
await scene.wait(0.6);
`.trim(),
  },

  {
    id: "p-projectile",
    domain: "physics",
    category: "力学",
    title: "平抛运动:水平 + 竖直分解",
    intent: "把平抛分解成水平匀速与竖直匀加速两个独立运动,看到合位移 = 两者矢量叠加 —— 直观理解运动的分解。",
    params: [{ name: "v0", label: "水平初速 v₀", min: 0.6, max: 2.5, step: 0.1, default: 1.4 }],
    sceneCode: `
const { scene, Axes, Dot, DashedLine, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GRAY, WHITE, UP, DOWN, easeOut , params } = ctx;
const axes = new Axes({ xRange: [-0.2, 6, 1], yRange: [-0.2, 4, 1], xLength: 8, yLength: 4.6, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "平抛:水平匀速 ⊥ 竖直匀加速", fontSize: 27, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
const origin = axes.c2p(0.3, 3.4);
const g = 1.0, v0 = params.v0;
const ball = new Dot({ point: origin, radius: 0.12, color: BLUE_C });
const hline = new DashedLine({ start: origin, end: origin, color: GRAY, strokeWidth: 2, dashLength: 0.12 });
const vline = new DashedLine({ start: origin, end: origin, color: BLUE_D, strokeWidth: 2, dashLength: 0.12 });
scene.add(ball, hline, vline);
const hLab = new Text({ text: "水平:匀速 x=v₀t", fontSize: 22, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
const vLab = new Text({ text: "竖直:匀加速 y=½gt²", fontSize: 22, color: BLUE_D, fontFamily: '"Times New Roman","SimSun",serif' });
hLab.nextTo(axes, DOWN, 0.28).shift([-1.6, 0, 0]);
vLab.nextTo(hLab, DOWN, 0.2);
scene.add(hLab, vLab);
await scene.play(new Write(hLab), new Write(vLab));
const eq = new MathTexImage({ renderer: "katex", latex: "\\vec r(t)=(v_0 t)\\,\\hat x-\\tfrac{1}{2}gt^2\\,\\hat y", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(vLab, DOWN, 0.2);
scene.add(eq);
await scene.play(new Write(eq));

const tMax = 2.2;
const projPos = (t) => [origin[0] + v0 * t, origin[1] - 0.5 * g * t * t, 0];
const tick = new ValueTracker(0);
ball.addUpdater((d) => { const t = tick.getValue(); const p = projPos(t); d.moveTo(p); hline.become(new DashedLine({ start: [p[0], origin[1], 0], end: p, color: GRAY, strokeWidth: 2, dashLength: 0.12 })); vline.become(new DashedLine({ start: [origin[0], p[1], 0], end: p, color: BLUE_D, strokeWidth: 2, dashLength: 0.12 })); });
scene.add(tick);
await scene.play(tick.animateTo(tMax, { duration: 3, rateFunc: easeOut }));
await scene.play(new Indicate(ball, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.6);
`.trim(),
  },

  {
    id: "p-field-superposition",
    domain: "physics",
    category: "电磁",
    title: "库仑场:多电荷的场叠加",
    intent: "多个点电荷各自产生径向电场,空间任意点的总场 = 各电荷场的矢量叠加 —— 展示电场分布与叠加原理。",
    params: [{ name: "q1", label: "Q₁ 电量", min: -2.5, max: 2.5, step: 0.5, default: 2 }],
    sceneCode: `
const { scene, NumberPlane, Dot, Arrow, Text, Create, Write, FadeIn, AnimationGroup, BLUE, BLUE_C, BLUE_D, WHITE, UP, DOWN , params } = ctx;
const plane = new NumberPlane({ xRange: [-4.5, 4.5, 1], yRange: [-3.5, 3.5, 1] });
scene.add(plane);
const title = new Text({ text: "场强叠加原理", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const sub = new Text({ text: "E = E₁ + E₂ (矢量合成)", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
sub.nextTo(title, DOWN, 0.3);
scene.add(title, sub);
await scene.play(new Write(title));
await scene.play(new Write(sub));

const charges = [
  { p: [-1.8, 0, 0], q: params.q1 },
  { p: [1.8, 0, 0], q: 2.2 },
];
const chargeDots = [];
const signs = [];
for (const ch of charges) {
  const dot = new Dot({ point: ch.p, radius: 0.28, color: ch.q > 0 ? BLUE_D : BLUE_C });
  scene.add(dot);
  chargeDots.push(dot);
  const s = new Text({ text: (ch.q > 0 ? "+" : "−") + Math.abs(ch.q).toFixed(1) + "Q", fontSize: 18, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
  s.nextTo(dot, DOWN, 0.15);
  scene.add(s);
  signs.push(s);
}
await scene.play(new AnimationGroup(chargeDots.map((d) => new FadeIn(d)), { lagRatio: 0.3 }));
await scene.play(new AnimationGroup(signs.map((s) => new Write(s)), { lagRatio: 0.3 }));

const arrows = [];
const k = 0.9;
for (let gx = -3.6; gx <= 3.6 + 0.001; gx += 1.2) {
  for (let gy = -2.6; gy <= 2.6 + 0.001; gy += 1.2) {
    let ex = 0, ey = 0;
    for (const ch of charges) {
      const dx = gx - ch.p[0], dy = gy - ch.p[1];
      const rr = dx * dx + dy * dy;
      if (rr < 0.08) continue;
      const r = Math.sqrt(rr);
      const f = (k * ch.q) / (r * r * r);
      ex += f * dx; ey += f * dy;
    }
    const mag = Math.sqrt(ex * ex + ey * ey);
    if (mag < 0.001) continue;
    const L = 0.28;
    const p0 = [gx - ex / mag * L * 0.4, gy - ey / mag * L * 0.4, 0];
    const p1 = [gx + ex / mag * L * 0.6, gy + ey / mag * L * 0.6, 0];
    arrows.push(new Arrow({ start: p0, end: p1, color: BLUE_C, strokeWidth: 1.6, tipLength: 0.1, tipWidth: 0.08 }));
  }
}
for (const a of arrows) scene.add(a);
await scene.play(new AnimationGroup(arrows.map((a) => new FadeIn(a)), { lagRatio: 0.05 }));
await scene.wait(0.8);
`.trim(),
  },

  {
    id: "p-kepler-orbit",
    domain: "physics",
    category: "力学",
    title: "万有引力:椭圆轨道与开普勒第二定律",
    intent: "在平方反比引力下,轨道是椭圆(太阳在焦点);行星近地点快、远地点慢,但扫过面积相等 —— 直观看到开普勒第一、二定律。",
    params: [{ name: "ecc", label: "轨道离心率 e", min: 0.1, max: 0.85, step: 0.05, default: 0.55 }],
    sceneCode: `
const { scene, Ellipse, Circle, Dot, DashedLine, Text, MathTexImage, ValueTracker, Sector, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GRAY, WHITE, UP, DOWN, easeOut , params } = ctx;
const a = 3.2, e = params.ecc, b = a * Math.sqrt(1 - e * e), c = a * e;
const orbit = new Ellipse({ width: 2 * a, height: 2 * b, color: BLUE_D, strokeWidth: 2.5 });
orbit.moveTo([c, 0, 0]);
const sun = new Circle({ radius: 0.22, color: BLUE_C, fillOpacity: 1 });
sun.moveTo([0, 0, 0]);
scene.add(orbit, sun);
const title = new Text({ text: "椭圆轨道:太阳在焦点", fontSize: 27, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "r(\\theta)=\\frac{a(1-e^2)}{1+e\\cos\\theta}", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(orbit, DOWN, 0.4);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new Create(orbit));
await scene.play(new Write(eq));

const sunLab = new Text({ text: "太阳(焦点)", fontSize: 18, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
sunLab.nextTo(sun, DOWN, 0.15);
scene.add(sunLab);

// 数值积分:dθ/dt ∝ 1/r²(开普勒第二定律,近地点快)
const STEPS = 900;
const th = new Array(STEPS);
{
  let thc = 0; const K = 1.6, dt = 0.02;
  for (let i = 0; i < STEPS; i++) { th[i] = thc; const r = a * (1 - e * e) / (1 + e * Math.cos(thc)); thc += K / (r * r) * dt; }
}
const rAt = (thc) => a * (1 - e * e) / (1 + e * Math.cos(thc));
const posAt = (thc) => [c + rAt(thc) * Math.cos(thc), rAt(thc) * Math.sin(thc), 0];
const planet = new Dot({ point: posAt(0), radius: 0.12, color: BLUE_C });
scene.add(planet);
const sTrack = new ValueTracker(0);
planet.addUpdater((d) => { const i = Math.floor(sTrack.getValue()) % STEPS; d.moveTo(posAt(th[i])); });
scene.add(sTrack);

// 三个等时间间隔的扫过扇形开扇形:说明等面积
const wedges = [];
for (let t0 = 0; t0 < 3; t0++) {
  const i0 = t0 * 240;
  const thA = th[i0], thB = th[i0 + 240];
  const rmid = (rAt(thA) + rAt(thB)) / 2;
  let ang = thB - thA; if (ang < 0) ang += 2 * Math.PI;
  const w = new Sector({ radius: rmid, startAngle: thA, angle: ang, color: BLUE_C, fillOpacity: 0.28, strokeWidth: 0 });
  scene.add(w);
  wedges.push(w);
}
const keep = new Text({ text: "相等时间扫过相等面积(开普勒第二定律)", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
keep.nextTo(eq, DOWN, 0.18);
scene.add(keep);
await scene.play(new FadeIn(sun), new FadeIn(sunLab));
await scene.play(new AnimationGroup(wedges.map((w) => new FadeIn(w)), { lagRatio: 0.3 }));
await scene.play(new Write(keep));
await scene.play(sTrack.animateTo(STEPS * 1.8, { duration: 6, rateFunc: easeOut }));
await scene.wait(0.8);
`.trim(),
  },

  {
    id: "p-charge-helix",
    domain: "physics",
    category: "电磁",
    title: "匀强磁场:带电粒子螺旋运动",
    intent: "电荷进入匀强磁场时,洛伦兹力充当向心力使粒子做圆周运动;若速度还有沿场方向的分量,则叠加成螺旋 —— 3D 展示。",
    is3D: true,
    params: [{ name: "rad", label: "回旋半径 r", min: 0.4, max: 1.6, step: 0.1, default: 1 }],
    sceneCode: `
const { scene, ThreeDAxes, Dot3D, VMobject, ValueTracker, Text, Create, Write, WHITE, BLUE, BLUE_C, BLUE_D , params } = ctx;
scene.setCameraOrientation(70 * (Math.PI / 180), -55 * (Math.PI / 180));
const axes = new ThreeDAxes({ xRange: [-3, 3, 1], yRange: [-3, 3, 1], zRange: [-2.5, 2.5, 1], axisColor: "#2b3a52", tipLength: 0.26, tipRadius: 0.1, shaftRadius: 0.008 });
scene.add(axes);
const title = new Text({ text: "带电粒子在匀强磁场中的螺旋运动", fontSize: 24, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
scene.addFixedInFrameMobjects(title);
title.moveTo([0, 3.3, 0]);
await scene.play(new Write(title));
const rad = params.rad;
const pitch = 1.1;
const helixPts = [];
for (let i = 0; i <= 120; i++) { const ag = i / 120 * (18); helixPts.push([rad * Math.cos(ag), rad * Math.sin(ag), -2.2 + pitch * ag]); }
const helix = new VMobject();
helix.setPoints3D(helixPts);
helix.setColor(BLUE_C);
helix.setStrokeWidth(2.5);
scene.add(helix);
const particle = new Dot3D({ point: [rad, 0, -2.2], radius: 0.09, color: BLUE_C, glow: true });
scene.add(particle);
const tick = new ValueTracker(0);
particle.addUpdater((d) => { const ag = tick.getValue(); d.moveTo([rad * Math.cos(ag), rad * Math.sin(ag), -2.2 + pitch * ag]); });
scene.add(tick);
await scene.play(new Create(helix, { duration: 1.2 }));
const lab = new Text({ text: "F = qv × B (洛伦兹力)", fontSize: 26, color: "#7cc6ff", fontFamily: '"Times New Roman","SimSun",serif' });
scene.addFixedInFrameMobjects(lab);
lab.moveTo([2.9, 2.4, 0]);
await scene.play(new Write(lab));
await scene.play(tick.animateTo(18, { duration: 3.5, rateFunc: easeOut }));
scene.beginAmbientCameraRotation(0.06);
await scene.wait(1.5);
scene.stopAmbientCameraRotation();
`.trim(),
  },

  {
    id: "p-wave-superposition",
    domain: "physics",
    category: "波动",
    title: "两列行波叠加干涉",
    intent: "两列同频相向行波,任一点位移 = 两波位移代数相加,形成驻波/干涉 —— 直观理解波的叠加原理。",
    params: [{ name: "amp2", label: "第二列振幅", min: 0.2, max: 1.5, step: 0.1, default: 1 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, ValueTracker, Create, Write, Indicate, BLUE, BLUE_C, BLUE_D, WHITE, UP, DOWN, easeOut , params } = ctx;
const axes = new Axes({ xRange: [-6, 6, 1], yRange: [-2.6, 2.6, 1], xLength: 10, yLength: 3.6, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "波的叠加:y = y₁ + y₂", fontSize: 27, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
const eq = new MathTexImage({ renderer: "katex", latex: "y=y_1+y_2=A\\sin(kx-\\omega t)+A'\\sin(kx+\\omega t)", fontSize: 23, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.3);
scene.add(title, eq);
await scene.play(new Write(title));
await scene.play(new Write(eq));
const t = new ValueTracker(0);
const k = 1.4, wv = 1.8, A = 1.0, A2 = params.amp2;
const w1 = (x, tt) => A * Math.sin(k * x - wv * tt);
const w2 = (x, tt) => A2 * Math.sin(k * x + wv * tt);
const g1 = axes.plot((x) => w1(x, t.getValue()), { xRange: [-5.8, 5.8], color: BLUE_D, strokeWidth: 2.5 });
const g2 = axes.plot((x) => w2(x, t.getValue()), { xRange: [-5.8, 5.8], color: "#7cc6ff", strokeWidth: 2.5 });
const gsum = axes.plot((x) => w1(x, t.getValue()) + w2(x, t.getValue()), { xRange: [-5.8, 5.8], color: BLUE_C, strokeWidth: 3 });
scene.add(g1, g2, gsum);
g1.addUpdater((m) => m.become(axes.plot((x) => w1(x, t.getValue()), { xRange: [-5.8, 5.8], color: BLUE_D, strokeWidth: 2.5 })));
g2.addUpdater((m) => m.become(axes.plot((x) => w2(x, t.getValue()), { xRange: [-5.8, 5.8], color: "#7cc6ff", strokeWidth: 2.5 })));
gsum.addUpdater((m) => m.become(axes.plot((x) => w1(x, t.getValue()) + w2(x, t.getValue()), { xRange: [-5.8, 5.8], color: BLUE_C, strokeWidth: 3 })));
scene.add(t);
const leg1 = new Text({ text: "y₁ 右行", fontSize: 18, color: "#7cc6ff", fontFamily: '"Times New Roman","SimSun",serif' });
const leg2 = new Text({ text: "y₂ 左行", fontSize: 18, color: BLUE_D, fontFamily: '"Times New Roman","SimSun",serif' });
const legS = new Text({ text: "y 叠加", fontSize: 18, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
leg1.toEdge(UP).shift([-1.4, -0.7, 0]);
leg2.nextTo(leg1, DOWN, 0.15);
legS.nextTo(leg2, DOWN, 0.15);
scene.add(leg1, leg2, legS);
await scene.play(new Create(g1), new Create(g2), new Create(gsum));
await scene.play(new Write(leg1), new Write(leg2), new Write(legS));
await scene.play(t.animateTo(6, { duration: 4, rateFunc: easeOut }));
await scene.play(new Indicate(gsum, { color: BLUE_C, duration: 0.7 }));
await scene.wait(0.8);
`.trim(),
  },
];