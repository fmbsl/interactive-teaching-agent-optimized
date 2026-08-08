// =============================================================================
// 物理领域 manim-web 教学模板库(批量生产,20 个教学点)
//
// 每个模板 = 一个物理教学知识点,有"开场→展开→强调/结论"节奏,结尾保留关键结论。
// 执行模式:
//   • 绝大多数用注入 scene 的 ctx 风格(domain="physics",附带段间暂停/断点)。
//   • 需 3D 相机的模板(电磁波传播、角动量/陀螺)用自建 ThreeDScene,
//     domain 设为 "demo" 以走自由脚本路径(给真 #container + 铺全局导出),
//     is3D=true。注意:domain 决定审阅页执行路径——自建 scene 必须 domain="demo"。
//
// 铁律遵守:解构行含全部标识符、纯 JS、MathTexImage 公式 + await waitForRender、
// Text 带 SimSun fontFamily、禁数组算术、相对定位(nextTo/toEdge)、对象进场景、
// 不 NaN/不重叠/不越界、3D 实体透明用 opacity(2D 用 fillOpacity)。
// =============================================================================

import type { WebExample } from "../webExamples";

export const PHYSICS_WEB_EXAMPLES: WebExample[] = [
  // ============ 1. 力学 · 简谐运动:位移-速度-加速度相位 ============
  {
    id: "phy-shm-phase",
    source: "经典 manim 动画题材改写(简谐运动 x-v-a 相位图)",
    domain: "physics",
    category: "力学 · 振动",
    title: "简谐运动:位移-速度-加速度的相位关系",
    intent: "让相位小球在 x、v、a 三条随时间的正弦/余弦曲线上同步扫过,直观看到:位移 x 与速度 v 相位差 π/2,且加速度 a 总与位移 x 相反(反相)。建立简谐运动 a = -ω²x 的物理图像。",
    params: [{ name: "om", label: "角频率 ω", min: 0.8, max: 3, step: 0.1, default: 2 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, ValueTracker, VGroup, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, BLUE_E, GOLD, GRAY, WHITE, UP, DOWN, LEFT, easeInOut, params } = ctx;
const title = new Text({ text: "简谐运动:位移 / 速度 / 加速度的相位", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const om = params.om, A = 1, tmax = 2 * Math.PI;
function mkAxes() {
  return new Axes({ xRange: [0, tmax, Math.PI / 2], yRange: [-1.5, 1.5, 1], xLength: 7.4, yLength: 1.7, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
}
const axX = mkAxes(), axV = mkAxes(), axA = mkAxes();
const curX = axX.plot((t) => A * Math.cos(om * t), { xRange: [0, tmax], color: BLUE, strokeWidth: 2.6 });
const curV = axV.plot((t) => -A * om * Math.sin(om * t), { xRange: [0, tmax], color: BLUE_C, strokeWidth: 2.6 });
const curA = axA.plot((t) => -A * om * om * Math.cos(om * t), { xRange: [0, tmax], color: BLUE_D, strokeWidth: 2.6 });
scene.add(axX, curX, axV, curV, axA, curA);

const labX = new Text({ text: "位移 x", fontSize: 20, color: BLUE, fontFamily: '"Times New Roman","SimSun",serif' });
const labV = new Text({ text: "速度 v", fontSize: 20, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
const labA = new Text({ text: "加速度 a", fontSize: 20, color: BLUE_D, fontFamily: '"Times New Roman","SimSun",serif' });
labX.nextTo(axX, LEFT, 0.15);
labV.nextTo(axV, LEFT, 0.15);
labA.nextTo(axA, LEFT, 0.15);
scene.add(labX, labV, labA);
await scene.play(new Create(curX), new Create(curV), new Create(curA));

// 三行曲线垂直排布(相对定位,不硬算坐标)
const g = new VGroup(axX, axV, axA).arrange(DOWN, 0.18);
g.moveTo([0, 0.15, 0]);

const ph = new ValueTracker(0);
const dX = new Dot({ point: axX.c2p(0, A), radius: 0.07, color: BLUE_E });
const dV = new Dot({ point: axV.c2p(0, 0), radius: 0.07, color: BLUE_E });
const dA = new Dot({ point: axA.c2p(0, -A * om * om), radius: 0.07, color: BLUE_E });
dX.addUpdater((d) => { const t = ph.getValue(); d.moveTo(axX.c2p(t, A * Math.cos(om * t))); });
dV.addUpdater((d) => { const t = ph.getValue(); d.moveTo(axV.c2p(t, -A * om * Math.sin(om * t))); });
dA.addUpdater((d) => { const t = ph.getValue(); d.moveTo(axA.c2p(t, -A * om * om * Math.cos(om * t))); });
scene.add(dX, dV, dA);
await scene.play(ph.animateTo(tmax, { duration: 3.2, rateFunc: easeInOut }));

const eq = new MathTexImage({ renderer: "katex", latex: "x=A\\cos\\omega t,\\quad v=-A\\omega\\sin\\omega t,\\quad a=-\\omega^2 x", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.1);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.8 }));
const note = new Text({ text: "位移与速度差 π/2,加速度 a 恒与 x 相反", fontSize: 21, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, UP, 0.14);
await scene.play(new Write(note));
await scene.play(new Indicate(dX, { color: GOLD }));
await scene.wait(0.8);
`,
  },

  // ============ 2. 力学 · 单摆与恢复力 ============
  {
    id: "phy-pendulum",
    source: "经典 manim 动画题材改写(单摆与恢复力)",
    domain: "physics",
    category: "力学 · 振动",
    title: "单摆:恢复力沿弧切线方向",
    intent: "摆锤沿圆弧摆动时,重力的分量沿弧切线提供恢复力 F=-mg·sinθ,使摆来回摆动。画出恢复力箭头并强调小角度 sinθ≈θ 才得到简谐近似与周期公式。",
    params: [{ name: "amp", label: "振幅角度(°)", min: 10, max: 50, step: 2, default: 30 }],
    sceneCode: `
const { scene, Dot, Line, Arc, Arrow, DashedLine, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, RED, GRAY, WHITE, UP, DOWN, easeInOut, params } = ctx;
const title = new Text({ text: "单摆:恢复力沿弧线切线", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const pivot = [0, 2.4, 0];
const L = 3.2;
const thet = new ValueTracker(params.amp * Math.PI / 180);
const equilibrium = [pivot[0], pivot[1] - L, 0];
const vline = new DashedLine({ start: pivot, end: equilibrium, color: GRAY, strokeWidth: 1.5 });
scene.add(vline);
await scene.play(new Create(vline));

const swingEnd = (th) => [pivot[0] + L * Math.sin(th), pivot[1] - L * Math.cos(th), 0];
const rod = new Line({ start: pivot, end: swingEnd(thet.getValue()), color: WHITE, strokeWidth: 3 });
const bob = new Dot({ radius: 0.22, color: BLUE_C });
bob.moveTo(swingEnd(thet.getValue()));
// 恢复力:沿水平方向指向平衡位置(弧切线的水平分量)
const fRest = new Arrow({ start: bob.getCenter(), end: [bob.getCenter()[0] - 0.9, bob.getCenter()[1], 0], color: RED, strokeWidth: 3, tipLength: 0.18 });
const arc = new Arc({ radius: L, startAngle: -Math.PI / 2 - params.amp * Math.PI / 180, endAngle: -Math.PI / 2 + params.amp * Math.PI / 180, color: BLUE, strokeWidth: 2 });
arc.moveTo(pivot);
scene.add(rod, bob, fRest, arc);
await scene.play(new Create(arc));
rod.addUpdater((r) => { r.become(new Line({ start: pivot, end: swingEnd(thet.getValue()), color: WHITE, strokeWidth: 3 })); });
bob.addUpdater((b) => { b.moveTo(swingEnd(thet.getValue())); });
fRest.addUpdater((m) => { const p = swingEnd(thet.getValue()); m.become(new Arrow({ start: p, end: [p[0] - 0.9, p[1], 0], color: RED, strokeWidth: 3, tipLength: 0.18 })); });
await scene.play(thet.animateTo(-params.amp * Math.PI / 180, { duration: 1.4, rateFunc: easeInOut }));
await scene.play(thet.animateTo(params.amp * Math.PI / 180, { duration: 1.4, rateFunc: easeInOut }));
await scene.play(thet.animateTo(0, { duration: 1.1, rateFunc: easeInOut }));

const eq = new MathTexImage({ renderer: "katex", latex: "T=2\\pi\\sqrt{\\frac{L}{g}}", fontSize: 28, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.12);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.8 }));
const note = new Text({ text: "恢复力 ∝ sinθ;小角度 sinθ≈θ", fontSize: 21, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, UP, 0.14);
await scene.play(new Write(note));
await scene.play(new Indicate(fRest, { color: RED, duration: 0.9 }));
await scene.wait(0.8);
`,
  },

  // ============ 3. 力学 · 弹簧振子动能/势能转化 ============
  {
    id: "phy-spring-energy",
    source: "经典 manim 动画题材改写(弹簧振子动能/势能转化)",
    domain: "physics",
    category: "力学 · 振动",
    title: "弹簧振子:动能与弹性势能互相转化",
    intent: "水平弹簧振子来回振动:过平衡点速度最大(动能最大、势能最小),两端速度为零(势能最大)。用两条能量条的高度直观展示 K 与 U 的此消彼长,强调总机械能守恒。",
    params: [{ name: "A", label: "振幅 A", min: 0.6, max: 2.0, step: 0.1, default: 1.6 }],
    sceneCode: `
const { scene, Line, Square, Dot, Rectangle, Text, MathTexImage, ValueTracker, VGroup, Write, FadeIn, FadeOut, BLUE, BLUE_C, GOLD, GRAY, WHITE, UP, DOWN, easeInOut, params } = ctx;
const title = new Text({ text: "弹簧振子:动能与势能互相转化", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const A = params.A;
const wall = [-4.6, 0, 0];
const block = new Square({ sideLength: 0.9, color: BLUE_C, strokeWidth: 2.5, fillOpacity: 0.35 });
block.moveTo([A + 0.6, 0, 0]);
const xT = new ValueTracker(A);
function springSegs(lx) {
  const segs = [];
  const n = Math.max(3, Math.round((lx - 0.6) / 0.22));
  let px = wall[0] + 0.3;
  for (let i = 0; i < n; i++) {
    const y0 = (i % 2 === 0) ? 0.16 : -0.16;
    const t1 = px + (lx - 0.3) / n;
    segs.push(new Line({ start: [px, 0, 0], end: [t1, y0, 0], color: GRAY, strokeWidth: 2 }));
    px = t1;
  }
  return segs;
}
let springV = new VGroup(...springSegs(A));
springV.addUpdater((s) => { s.become(new VGroup(...springSegs(xT.getValue()))); });
scene.add(springV);
block.addUpdater((b) => { b.moveTo([xT.getValue() + 0.6, 0, 0]); });

// 能量条:底部固定,高度随能量变化
const kbar = new Rectangle({ width: 0.9, height: 0.2, color: BLUE, strokeWidth: 2, fillOpacity: 0.4 });
const ubar = new Rectangle({ width: 0.9, height: 0.2, color: GOLD, strokeWidth: 2, fillOpacity: 0.4 });
const kBottom = -2.1, kx = -3.2, ux = -1.9;
function energyBar(rect, px, h) {
  rect.setHeight(h);
  rect.moveTo([px, kBottom + h / 2, 0]);
}
kbar.addUpdater((r) => { const s = Math.abs(xT.getValue()) / A; energyBar(r, kx, 0.2 + 1.8 * (1 - s * s)); });
ubar.addUpdater((r) => { const s = Math.abs(xT.getValue()) / A; energyBar(r, ux, 0.2 + 1.8 * (s * s)); });
const klab = new Text({ text: "动能 K", fontSize: 19, color: BLUE, fontFamily: '"Times New Roman","SimSun",serif' });
const ulab = new Text({ text: "势能 U", fontSize: 19, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
klab.nextTo([kx, kBottom - 0.35, 0], DOWN, 0.05);
ulab.nextTo([ux, kBottom - 0.35, 0], DOWN, 0.05);
scene.add(kbar, ubar, klab, ulab);
await scene.play(new FadeIn(klab), new FadeIn(ulab));

await scene.play(xT.animateTo(-A, { duration: 2, rateFunc: easeInOut }));
await scene.play(xT.animateTo(A, { duration: 2, rateFunc: easeInOut }));

const eq = new MathTexImage({ renderer: "katex", latex: "E=\\frac{1}{2}mv^2+\\frac{1}{2}kx^2=\\text{const}", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.12);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ============ 4. 力学 · 阻尼振动 ============
  {
    id: "phy-damped",
    source: "经典 manim 动画题材改写(阻尼振动衰减包络)",
    domain: "physics",
    category: "力学 · 振动",
    title: "阻尼振动:振幅指数衰减",
    intent: "受阻尼的振动振幅按 e^(-βt) 指数衰减,周期基本不变但振幅越来越小。画出衰减包络线与振动曲线,并与无阻尼曲线对比,理解阻尼耗散能量。",
    params: [{ name: "beta", label: "阻尼系数 β", min: 0.1, max: 0.9, step: 0.05, default: 0.4 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GRAY, WHITE, UP, DOWN, params } = ctx;
const title = new Text({ text: "阻尼振动:振幅指数衰减", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const beta = params.beta, om0 = 3, tmax = 6;
const axes = new Axes({ xRange: [0, tmax, 1], yRange: [-1.6, 1.6, 0.5], xLength: 9.5, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
await scene.play(new Create(axes), { duration: 0.4 });
const damped = axes.plot((t) => Math.exp(-beta * t) * Math.cos(om0 * t), { xRange: [0, tmax], color: BLUE, strokeWidth: 2.8 });
const envP = axes.plot((t) => Math.exp(-beta * t), { xRange: [0, tmax], color: BLUE_D, strokeWidth: 2 });
const envM = axes.plot((t) => -Math.exp(-beta * t), { xRange: [0, tmax], color: BLUE_D, strokeWidth: 2 });
scene.add(envP, envM, damped);
await scene.play(new Create(envP), new Create(envM));
await scene.play(new Create(damped));

const eq = new MathTexImage({ renderer: "katex", latex: "x(t)=A_0e^{-\\beta t}\\cos(\\omega t+\\varphi)", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.28);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.8 }));
const note = new Text({ text: "包络线 = e^{-βt}:振幅随时间指数变小", fontSize: 20, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.14);
await scene.play(new Write(note));
await scene.play(new Indicate(envP, { color: BLUE_D, duration: 1 }));
await scene.wait(0.8);
`,
  },

  // ============ 5. 力学 · 受迫振动与共振 ============
  {
    id: "phy-resonance",
    source: "经典 manim 动画题材改写(受迫振动共振峰)",
    domain: "physics",
    category: "力学 · 受迫振动",
    title: "受迫振动:共振峰",
    intent: "受迫振动稳态振幅随驱动频率变化,在固有频率 ω₀ 附近振幅达到峰值——共振。画出『振幅-驱动频率』曲线并在共振处强调,联系荡秋千与桥梁共振。",
    params: [{ name: "damp", label: "阻尼 γ", min: 0.1, max: 1, step: 0.05, default: 0.5 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, Line, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GOLD, GRAY, WHITE, UP, DOWN, params } = ctx;
const title = new Text({ text: "受迫振动:共振峰", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const gam = params.damp, omN = 3, wmax = 6.4, amax = 1.6;
const axes = new Axes({ xRange: [0, wmax, 1], yRange: [0, amax, 0.5], xLength: 9.5, yLength: 4.2, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
await scene.play(new Create(axes), { duration: 0.4 });
// 受迫振动稳态振幅 A = 1 / sqrt((omN^2-om^2)^2 + (2 gamma om)^2)
function ampAt(om) { return 1 / Math.sqrt(Math.pow(omN * omN - om * om, 2) + Math.pow(2 * gam * om, 2)); }
const curve = axes.plot(ampAt, { xRange: [0.1, wmax], color: BLUE, strokeWidth: 3 });
scene.add(curve);
await scene.play(new Create(curve));

let bestOm = 1, bestA = 0;
for (let o = 0.1; o < wmax; o += 0.01) { const a = ampAt(o); if (a > bestA) { bestA = a; bestOm = o; } }
const peak = new Dot({ point: axes.c2p(bestOm, bestA), radius: 0.1, color: GOLD });
const vline = new Line({ start: axes.c2p(bestOm, 0), end: axes.c2p(bestOm, bestA), color: GOLD, strokeWidth: 2, strokeOpacity: 0.7 });
scene.add(vline, peak);
await scene.play(new Create(vline));
await scene.play(new FadeIn(peak, { duration: 0.4 }));
await scene.play(new Indicate(peak, { color: GOLD, duration: 1 }));

const eq = new MathTexImage({ renderer: "katex", latex: "\\omega_{\\text{res}}\\approx\\omega_0=\\sqrt{k/m}", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.26);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const note = new Text({ text: "驱动频率≈固有频率时振幅最大 = 共振", fontSize: 21, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.14);
await scene.play(new Write(note));
await scene.wait(0.8);
`,
  },

  // ============ 6. 波动 · 横波与纵波 ============
  {
    id: "phy-transverse-longitudinal",
    source: "经典 manim 动画题材改写(横波/纵波质点振动)",
    domain: "physics",
    category: "波动",
    title: "横波与纵波:质点振动方向",
    intent: "对比两种波:横波质点垂直于传播方向振动,纵波质点沿传播方向做疏密振动。让两排质点各自同步振动,『振动⊥传播(横)、∥传播(纵)』一目了然。",
    params: [{ name: "A", label: "振幅 A", min: 0.2, max: 0.8, step: 0.05, default: 0.5 }],
    sceneCode: `
const { scene, Dot, Text, MathTexImage, ValueTracker, Write, FadeIn, AnimationGroup, BLUE, BLUE_C, GRAY, WHITE, UP, DOWN, easeInOut, params } = ctx;
const title = new Text({ text: "横波 ⊥ 传播   vs   纵波 ∥ 传播", fontSize: 26, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const A = params.A, N = 24;
// 横波质点排(沿 x,竖直(y)振动)
const transDots = [];
const tx = [];
for (let i = 0; i < N; i++) { const x0 = -3 + i * 0.25; const d = new Dot({ radius: 0.09, color: BLUE_C }); d.moveTo([x0, 0.7, 0]); tx.push(x0); transDots.push(d); scene.add(d); }
const tT = new ValueTracker(0);
for (let i = 0; i < N; i++) { transDots[i].addUpdater((d) => { d.moveTo([tx[i], 0.7 + A * Math.sin(i * 0.9 - 2.6 * tT.getValue()), 0]); }); }
const tlab = new Text({ text: "横波:质点上下振动(⊥ 传播)", fontSize: 20, color: BLUE, fontFamily: '"Times New Roman","SimSun",serif' });
tlab.moveTo([0, 1.5, 0]);
scene.add(tlab);
await scene.play(new Write(tlab));
await scene.play(tT.animateTo(4, { duration: 2.4, rateFunc: easeInOut }));

// 纵波质点排(沿 x,水平(x)疏密振动)
const lonDots = [];
const lx = [];
for (let i = 0; i < N; i++) { const x0 = -3 + i * 0.45; const d = new Dot({ radius: 0.09, color: BLUE }); d.moveTo([x0, -2.3, 0]); lx.push(x0); lonDots.push(d); scene.add(d); }
const sT = new ValueTracker(0);
for (let i = 0; i < N; i++) { lonDots[i].addUpdater((d) => { const x0 = lx[i]; d.moveTo([x0 + A * Math.sin(i * 1.2 - 2.6 * sT.getValue()), -2.3, 0]); }); }
const slab = new Text({ text: "纵波:质点左右疏密振动(∥ 传播)", fontSize: 20, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
slab.moveTo([0, -3.1, 0]);
scene.add(slab);
await scene.play(new Write(slab));
await scene.play(sT.animateTo(4, { duration: 2.4, rateFunc: easeInOut }));

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{横波:}\\perp\\quad\\text{纵波:}\\parallel", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.1);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
await scene.wait(0.8);
`,
  },

  // ============ 7. 波动 · 叠加干涉 ============
  {
    id: "phy-superposition",
    source: "经典 manim 动画题材改写(两列波叠加相长/相消)",
    domain: "physics",
    category: "波动 · 干涉",
    title: "波的叠加:同相相长 / 反相相消",
    intent: "两列同频同幅波叠加:同相时合成振幅加倍(相长干涉),反相时相互抵消(相消干涉)。画出两列波与合成波,拖动相位差滑块看结果变化。",
    params: [{ name: "phase", label: "相位差(π 的倍数)", min: 0, max: 2, step: 0.1, default: 0 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, RED, GOLD, GRAY, WHITE, UP, DOWN, params } = ctx;
const title = new Text({ text: "波的叠加:同相相长 / 反相相消", fontSize: 27, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const dphi = params.phase * Math.PI;
const axes = new Axes({ xRange: [0, 2 * Math.PI, Math.PI / 2], yRange: [-2.6, 2.6, 1], xLength: 9, yLength: 4.2, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
await scene.play(new Create(axes), { duration: 0.4 });
const w1 = axes.plot((x) => 1.1 * Math.sin(x), { xRange: [0, 2 * Math.PI], color: BLUE, strokeWidth: 2.4 });
const w2 = axes.plot((x) => 1.1 * Math.sin(x + dphi), { xRange: [0, 2 * Math.PI], color: BLUE_C, strokeWidth: 2.4 });
scene.add(w1, w2);
await scene.play(new Create(w1), new Create(w2));
const sum = axes.plot((x) => 1.1 * Math.sin(x) + 1.1 * Math.sin(x + dphi), { xRange: [0, 2 * Math.PI], color: RED, strokeWidth: 3 });
scene.add(sum);
await scene.play(new Create(sum));

const eq = new MathTexImage({ renderer: "katex", latex: "y=y_1+y_2", fontSize: 26, color: RED });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.26);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const near = (a, b) => Math.abs(a - b) < 0.15;
const tag = near(dphi, 0) || near(dphi, 2 * Math.PI)
  ? new Text({ text: "同相 → 相长干涉(振幅加倍)", fontSize: 21, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' })
  : (near(dphi, Math.PI) ? new Text({ text: "反相 → 相消干涉(相互抵消)", fontSize: 21, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' })
    : new Text({ text: "中间相位差:合成部分相消", fontSize: 21, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' }));
tag.nextTo(eq, DOWN, 0.14);
scene.add(tag);
await scene.play(new Write(tag));
await scene.play(new Indicate(sum, { color: RED, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ============ 8. 波动 · 驻波 ============
  {
    id: "phy-standing-wave",
    source: "经典 manim 动画题材改写(驻波节点/波腹)",
    domain: "physics",
    category: "波动 · 驻波",
    title: "驻波:节点与波腹",
    intent: "两列振幅相同、方向相反的波叠加成驻波:某些点永远不动(节点),某些点振幅最大(波腹)。画出驻波含有的各相位粒子,标出节点与波腹位置,理解『原地振动、不传播』。",
    params: [{ name: "n", label: "半波数目", min: 1, max: 4, step: 1, default: 3 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, AnimationGroup, BLUE, BLUE_C, GOLD, WHITE, GRAY, UP, DOWN, easeInOut, params } = ctx;
const title = new Text({ text: "驻波:节点(不动)与波腹(最大振幅)", fontSize: 26, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const n = params.n;
const axes = new Axes({ xRange: [-0.3, Math.PI * 2 + 0.3, 1], yRange: [-2.2, 2.2, 1], xLength: 9, yLength: 4.0, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
await scene.play(new Create(axes), { duration: 0.4 });

// 用采样粒子画驻波 y = sin(n x) cos(t)(随时间在波腹处上下振动,节点处不动)
const tT = new ValueTracker(0);
const half = 2 * Math.PI;
const M = 60;
for (let i = 0; i <= M; i++) {
  const x = (i / M) * half;
  const d = new Dot({ radius: 0.05, color: BLUE_C });
  d.addUpdater((dd) => { dd.moveTo(axes.c2p(x, Math.sin(n * x) * Math.cos(tT.getValue()))); });
  scene.add(d);
}
await scene.play(tT.animateTo(2 * Math.PI, { duration: 2.6, rateFunc: easeInOut }));

// 节点:x = 2π*m / (2n)? 节点在 sin(nx)=0 → x = (m π)/n,局限在 [0, 2π] 内
const nodeDots = [];
for (let m = 0; m <= 2 * n; m++) {
  const x = (m * Math.PI) / n;
  if (x < -0.01 || x > half + 0.01) continue;
  const nd = new Dot({ point: axes.c2p(x, 0), radius: 0.12, color: WHITE });
  nodeDots.push(nd);
  scene.add(nd);
}
await scene.play(new AnimationGroup(nodeDots.map((d) => new FadeIn(d, { duration: 0.25 })), { lagRatio: 0.05 }));

const note = new Text({ text: "白点 = 节点(始终不动);蓝点 = 随波腹上下振动", fontSize: 20, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(axes, DOWN, 0.28);
scene.add(note);
await scene.play(new Write(note));
const eq = new MathTexImage({ renderer: "katex", latex: "y=2A\\sin(kx)\\cos(\\omega t)", fontSize: 25, color: BLUE });
await eq.waitForRender();
eq.nextTo(note, DOWN, 0.14);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
await scene.wait(0.8);
`,
  },

  // ============ 9. 电磁 · 电磁波传播(3D 自建 scene)============
  {
    id: "phy-em-wave",
    source: "经典 manim 动画题材改写(电磁波 E 与 B 垂直传播;Python manim 高频演示题材,自建 ThreeDScene)",
    domain: "demo",
    category: "电磁 · 电磁波",
    title: "电磁波:E 与 B 相互垂直并垂直于传播方向",
    intent: "3D 相机展示电磁波一帧快照:电场 E(蓝)与磁场 B(金)相互垂直,且都垂直于传播方向 x。学生从立体图直观理解电磁波是横波、E 与 B 同相且成 ∥ 关系。",
    is3D: true,
    sceneCode: `
// —— 自建 ThreeDScene(domain=demo 走自由脚本:真 #container + 铺全局导出)——
const scene = new ThreeDScene(document.getElementById('container'), {
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#0b1420',
  phi: 62 * (Math.PI / 180),
  theta: -35 * (Math.PI / 180),
  distance: 15,
  fov: 34,
  enableOrbitControls: true,
});
const axes = new ThreeDAxes({ xRange: [-6, 6, 1], yRange: [-3, 3, 1], zRange: [-3, 3, 1], axisColor: '#556', tipLength: 0.3, tipRadius: 0.1, shaftRadius: 0.008 });
scene.add(axes);
const k = 1.5, NR = 26;
for (let i = 0; i <= NR; i++) {
  const x = -5.5 + (i / NR) * 11;
  const val = Math.sin(k * x);
  const E = new Arrow3D({ start: [x, 0, 0], end: [x, 2.2 * val, 0], color: '#4da3ff', tipLength: 0.12, tipRadius: 0.05, shaftRadius: 0.015 });
  const B = new Arrow3D({ start: [x, 0, 0], end: [x, 0, 2.2 * val], color: '#ffc94d', tipLength: 0.12, tipRadius: 0.05, shaftRadius: 0.015 });
  scene.add(E, B);
}
const title = new Text({ text: '电磁波:E(蓝)⊥ B(金) ⊥ 传播方向 x', fontSize: 26, color: '#ffffff', fontFamily: '"Times New Roman","SimSun",serif' });
scene.addFixedInFrameMobjects(title);
title.toCorner(UL);
const cap = new Text({ text: '横波:沿 x 传播,E 沿 y 振动,B 沿 z 振动', fontSize: 22, color: '#9fc5e8', fontFamily: '"Times New Roman","SimSun",serif' });
scene.addFixedInFrameMobjects(cap);
cap.toCorner(DR);
await scene.wait(2);
`,
  },

  // ============ 10. 力学 · 抛体运动与速度分解 ============
  {
    id: "phy-projectile",
    source: "经典 manim 动画题材改写(抛体运动与速度分解)",
    domain: "physics",
    category: "力学 · 运动学",
    title: "抛体运动:轨迹 + 速度的水平/竖直分解",
    intent: "小球沿抛物线飞行时,把每个时刻速度分解为水平分量与竖直分量:水平匀速、竖直受重力匀变速。学生看到水平分量不变、竖直分量线性变化,理解抛体运动是两个独立分运动的叠加。",
    params: [{ name: "v0", label: "初速度 v0", min: 4, max: 8, step: 0.2, default: 6 }],
    sceneCode: `
const { scene, Axes, Dot, Arrow, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, BLUE, BLUE_D, GOLD, GRAY, WHITE, UP, DOWN, easeInOut, params } = ctx;
const title = new Text({ text: "抛体运动:vx 不变,vy 受重力改变", fontSize: 27, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const v0 = params.v0, g = 9.8, th = 55 * Math.PI / 180;
const R = (v0 * v0 * Math.sin(2 * th)) / g;
const H = (v0 * v0 * Math.sin(th) * Math.sin(th)) / (2 * g);
const axes = new Axes({ xRange: [0, R * 1.05, R / 4], yRange: [0, H * 1.2, H / 2], xLength: 9.5, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
const traj = axes.plot((x) => x * Math.tan(th) - (g * x * x) / (2 * v0 * v0 * Math.cos(th) * Math.cos(th)), { xRange: [0, R], color: BLUE, strokeWidth: 3 });
scene.add(axes, traj);
await scene.play(new Create(axes), { duration: 0.4 });
await scene.play(new Create(traj));

const xT = new ValueTracker(0.2);
function trajY(x) { return x * Math.tan(th) - (g * x * x) / (2 * v0 * v0 * Math.cos(th) * Math.cos(th)); }
const ball = new Dot({ point: axes.c2p(0.2, trajY(0.2)), radius: 0.1, color: BLUE_D });
const vxArr = new Arrow({ start: ball.getCenter(), end: [ball.getCenter()[0] + 0.9, ball.getCenter()[1], 0], color: GOLD, strokeWidth: 3, tipLength: 0.15 });
const vyArr = new Arrow({ start: ball.getCenter(), end: [ball.getCenter()[0], ball.getCenter()[1] - 0.9, 0], color: BLUE, strokeWidth: 3, tipLength: 0.15 });
ball.addUpdater((b) => { const x = xT.getValue(); b.moveTo(axes.c2p(x, trajY(x))); });
vxArr.addUpdater((a) => { const x = xT.getValue(); const p = axes.c2p(x, trajY(x)); a.become(new Arrow({ start: p, end: [p[0] + 0.9, p[1], 0], color: GOLD, strokeWidth: 3, tipLength: 0.15 })); });
vyArr.addUpdater((a) => { const x = xT.getValue(); const p = axes.c2p(x, trajY(x)); const vy = v0 * Math.sin(th) - g * (x / (v0 * Math.cos(th))); a.become(new Arrow({ start: p, end: [p[0], p[1] + 0.14 * vy, 0], color: BLUE, strokeWidth: 3, tipLength: 0.15 })); });
scene.add(ball, vxArr, vyArr);
await scene.play(xT.animateTo(R, { duration: 3, rateFunc: easeInOut }));

const eq = new MathTexImage({ renderer: "katex", latex: "v_x=v_0\\cos\\theta,\\quad v_y=v_0\\sin\\theta-gt", fontSize: 25, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.24);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const leg = new Text({ text: "金 = vx(水平不变);蓝 = vy(竖直改变)", fontSize: 20, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
leg.nextTo(eq, DOWN, 0.14);
scene.add(leg);
await scene.play(new Write(leg));
await scene.wait(0.8);
`,
  },

  // ============ 11. 力学 · 圆周运动与向心加速度 ============
  {
    id: "phy-centripetal",
    source: "经典 manim 动画题材改写(匀速圆周运动向心加速度)",
    domain: "physics",
    category: "力学 · 圆周运动",
    title: "匀速圆周运动:向心加速度总指向圆心",
    intent: "质点在圆周上匀速转动,同时画出位置矢量 r、速度 v(切向)与向心加速度 a(指向圆心)。学生理解速度大小不变但方向时刻改变,必须有指向圆心的向心加速度 a = v²/r。",
    params: [{ name: "spd", label: "角速度 ω", min: 1, max: 3, step: 0.2, default: 2 }],
    sceneCode: `
const { scene, Circle, Dot, Arrow, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, BLUE, BLUE_D, GOLD, RED, GRAY, WHITE, UP, DOWN, easeInOut, params } = ctx;
const title = new Text({ text: "匀速圆周运动:向心加速度指向圆心", fontSize: 26, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const R = 2.2, om = params.spd;
const center = [0, -0.4, 0];
const circle = new Circle({ radius: R, color: BLUE, strokeWidth: 2.5 });
circle.moveTo(center);
scene.add(circle);
await scene.play(new Create(circle));

const ball = new Dot({ radius: 0.12, color: BLUE_D });
const rVec = new Arrow({ start: center, end: [center[0] + R, center[1], 0], color: RED, strokeWidth: 3, tipLength: 0.15 });
const vVec = new Arrow({ start: [center[0] + R, center[1], 0], end: [center[0] + R, center[1] + 0.8, 0], color: GOLD, strokeWidth: 3, tipLength: 0.15 });
const aVec = new Arrow({ start: [center[0] + R, center[1], 0], end: [center[0] + R - 0.9, center[1], 0], color: BLUE, strokeWidth: 3, tipLength: 0.15 });
const tT = new ValueTracker(0);
const posAt = (t) => [center[0] + R * Math.cos(om * t), center[1] + R * Math.sin(om * t), 0];
ball.addUpdater((b) => b.moveTo(posAt(tT.getValue())));
rVec.addUpdater((a) => { const p = posAt(tT.getValue()); a.become(new Arrow({ start: center, end: p, color: RED, strokeWidth: 3, tipLength: 0.15 })); });
vVec.addUpdater((a) => { const p = posAt(tT.getValue()); const t = tT.getValue(); const v = [-R * om * Math.sin(om * t), R * om * Math.cos(om * t), 0]; const vl = Math.hypot(v[0], v[1]); const s = 0.4 / vl; a.become(new Arrow({ start: p, end: [p[0] + s * v[0], p[1] + s * v[1], 0], color: GOLD, strokeWidth: 3, tipLength: 0.15 })); });
aVec.addUpdater((a) => { const p = posAt(tT.getValue()); const d = [center[0] - p[0], center[1] - p[1], 0]; const dl = Math.hypot(d[0], d[1]); a.become(new Arrow({ start: p, end: [p[0] + (0.5 / dl) * d[0], p[1] + (0.5 / dl) * d[1], 0], color: BLUE, strokeWidth: 3, tipLength: 0.15 })); });
scene.add(ball, rVec, vVec, aVec);
await scene.play(tT.animateTo(Math.PI * 1.5, { duration: 3, rateFunc: easeInOut }));

const eq = new MathTexImage({ renderer: "katex", latex: "a=\\frac{v^2}{r}=\\omega^2 r", fontSize: 27, color: BLUE_D });
await eq.waitForRender();
eq.toEdge(DOWN, 0.12);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const leg = new Text({ text: "红 = 位置 r;金 = 速度 v;蓝 = 向心加速度 a", fontSize: 19, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
leg.nextTo(eq, UP, 0.14);
await scene.play(new Write(leg));
await scene.play(new Indicate(aVec, { color: BLUE, duration: 0.9 }));
await scene.wait(0.8);
`,
  },

  // ============ 12. 力学 · 万有引力行星轨道 ============
  {
    id: "phy-orbit",
    source: "经典 manim 动画题材改写(万有引力与行星椭圆轨道)",
    domain: "physics",
    category: "力学 · 万有引力",
    title: "行星轨道:万有引力始终指向太阳",
    intent: "行星沿椭圆轨道绕太阳运行,太阳位于焦点,任一时刻引力方向都指向太阳。画出轨道、太阳与运动中的引力矢量,联系开普勒第二定律:靠近太阳时速度快。",
    params: [{ name: "e", label: "轨道离心率 e", min: 0.1, max: 0.8, step: 0.05, default: 0.5 }],
    sceneCode: `
const { scene, Ellipse, Dot, Arrow, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, BLUE, BLUE_D, GOLD, RED, GRAY, WHITE, UP, DOWN, easeInOut, params } = ctx;
const title = new Text({ text: "椭圆轨道:引力恒指向太阳(焦点)", fontSize: 26, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const e = params.e, a = 2.6, b = a * Math.sqrt(1 - e * e), c = e * a;
const sunP = [-c, 0, 0];
const sun = new Dot({ radius: 0.26, color: GOLD });
sun.moveTo(sunP);
const orbit = new Ellipse({ width: a * 2, height: b * 2, color: BLUE, strokeWidth: 2.5 });
orbit.moveTo([0, 0, 0]);
scene.add(orbit, sun);
await scene.play(new Create(orbit), { duration: 0.8 });
await scene.play(new FadeIn(sun, { duration: 0.4 }));

const tT = new ValueTracker(0);
const planet = new Dot({ radius: 0.13, color: BLUE_D });
const posAt = (t) => [c * Math.cos(t) + sunP[0], b * Math.sin(t), 0]; // 以焦点为几何中心近似
const fVec = new Arrow({ start: sunP, end: [sunP[0] + a, sunP[1], 0], color: RED, strokeWidth: 2.5, tipLength: 0.14 });
planet.addUpdater((p) => p.moveTo(posAt(tT.getValue())));
fVec.addUpdater((v) => { const p = posAt(tT.getValue()); const d = [sunP[0] - p[0], sunP[1] - p[1], 0]; const dl = Math.hypot(d[0], d[1]) || 1; v.become(new Arrow({ start: p, end: [p[0] + (d[0] / dl) * 1.3, p[1] + (d[1] / dl) * 1.3, 0], color: RED, strokeWidth: 2.5, tipLength: 0.14 })); });
scene.add(planet, fVec);
await scene.play(tT.animateTo(Math.PI * 3.2, { duration: 3.6, rateFunc: easeInOut }));

const eq = new MathTexImage({ renderer: "katex", latex: "F=G\\frac{Mm}{r^2}", fontSize: 27, color: BLUE_D });
await eq.waitForRender();
eq.toEdge(DOWN, 0.12);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const leg = new Text({ text: "红 = 指向太阳的引力;越靠近太阳速度越快", fontSize: 20, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
leg.nextTo(eq, UP, 0.14);
await scene.play(new Write(leg));
await scene.play(new Indicate(fVec, { color: RED, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ============ 13. 电磁 · 点电荷电场线 ============
  {
    id: "phy-e-field",
    source: "经典 manim 动画题材改写(正/负点电荷电场线)",
    domain: "physics",
    category: "电磁 · 静电场",
    title: "点电荷电场线:径向发散/收敛 + 疏密表强弱",
    intent: "正电荷电场线向外辐射、负电荷向里汇聚,越靠近电荷电场线越密(场强越大,远离按 1/r² 减弱)。让学生从电力线方向与疏密直观理解 E ∝ 1/r²。",
    params: [{ name: "q", label: "电荷(正负)", min: -1, max: 1, step: 1, default: 1 }],
    sceneCode: `
const { scene, Dot, Arrow, Text, MathTexImage, AnimationGroup, FadeIn, Write, Indicate, BLUE, RED, WHITE, GRAY, UP, DOWN, params } = ctx;
const title = new Text({ text: "点电荷电场线:方向与疏密", fontSize: 27, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const q = params.q >= 0 ? 1 : -1;
const center = [0, 0.2, 0];
const charge = new Dot({ radius: 0.32, color: q > 0 ? RED : BLUE });
charge.moveTo(center);
scene.add(charge);
const sign = new Text({ text: q > 0 ? "＋" : "－", fontSize: 40, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
sign.moveTo(center);
scene.add(sign);
await scene.play(new FadeIn(charge, { duration: 0.4 }), new FadeIn(sign, { duration: 0.4 }));

const arrows = [];
const nR = 12;
const rad = 0.7;
for (let i = 0; i < nR; i++) {
  const th = (i / nR) * 2 * Math.PI;
  const dirx = Math.cos(th), diry = Math.sin(th);
  for (let r = rad; r <= 1.8; r += 0.55) {
    const sx = center[0] + r * dirx, sy = center[1] + r * diry;
    const ex = q > 0 ? center[0] + (r + 0.5) * dirx : center[0] + (r - 0.5) * dirx;
    const ey = q > 0 ? center[1] + (r + 0.5) * diry : center[1] + (r - 0.5) * diry;
    const ar = new Arrow({ start: [sx, sy, 0], end: [ex, ey, 0], color: q > 0 ? RED : BLUE, strokeWidth: 2.4, tipLength: 0.13 });
    scene.add(ar);
    arrows.push(ar);
  }
}
await scene.play(new AnimationGroup(arrows.map((a) => new FadeIn(a, { duration: 0.35 })), { lagRatio: 0.04 }));

const eq = new MathTexImage({ renderer: "katex", latex: "\\vec{E}=\\frac{kQ}{r^2}\\hat r", fontSize: 27, color: BLUE });
await eq.waitForRender();
eq.toEdge(DOWN, 0.12);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const leg = new Text({ text: q > 0 ? "正电荷:电场线向外辐射" : "负电荷:电场线向里汇聚", fontSize: 21, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
leg.nextTo(eq, UP, 0.14);
await scene.play(new Write(leg));
await scene.play(new Indicate(charge, { color: q > 0 ? RED : BLUE, duration: 0.9 }));
await scene.wait(0.8);
`,
  },

  // ============ 14. 电磁 · 磁感线与安培定则 ============
  {
    id: "phy-magnetic-field",
    source: "经典 manim 动画题材改写(直线电流安培定则/右手螺旋)",
    domain: "physics",
    category: "电磁 · 磁场",
    title: "直线电流磁场:安培定则(右手螺旋)",
    intent: "竖直导线通电流向上时,周围磁场是同心圆,方向由右手定则决定。画出同心圆磁场线并加方向箭头,配合『右手握导线,拇指指电流,四指即磁场』的口诀。",
    sceneCode: `
const { scene, Line, Text, MathTexImage, Circle, Arrow, Create, Write, FadeIn, Indicate, AnimationGroup, BLUE, BLUE_C, BLUE_D, GOLD, GRAY, WHITE, UP, params } = ctx;
const title = new Text({ text: "直线电流磁场:右手螺旋定则", fontSize: 27, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const wire = new Line({ start: [0, 2.2, 0], end: [0, -2.2, 0], color: GOLD, strokeWidth: 5 });
scene.add(wire);
await scene.play(new Create(wire), { duration: 0.5 });
const iLab = new Text({ text: "I(向上)", fontSize: 20, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
iLab.nextTo([0, 2.2, 0], UP, 0.1);
scene.add(iLab);
await scene.play(new Write(iLab));

const rings = [];
for (const r of [1.0, 1.7]) {
  const c = new Circle({ radius: r, color: BLUE, strokeWidth: 2 });
  scene.add(c);
  rings.push(c);
}
await scene.play(new Create(rings[0], { duration: 0.6 }), new Create(rings[1], { duration: 0.6 }));

const arrows = [];
for (const r of [1.0, 1.7]) {
  for (const th of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const px = r * Math.cos(th), py = r * Math.sin(th);
    const tx = -Math.sin(th), ty = Math.cos(th);
    const ar = new Arrow({ start: [px - 0.18 * tx, py - 0.18 * ty, 0], end: [px + 0.18 * tx, py + 0.18 * ty, 0], color: BLUE_C, strokeWidth: 2.2, tipLength: 0.12 });
    scene.add(ar);
    arrows.push(ar);
  }
}
await scene.play(new AnimationGroup(arrows.map((a) => new FadeIn(a, { duration: 0.35 })), { lagRatio: 0.05 }));

const eq = new MathTexImage({ renderer: "katex", latex: "B=\\frac{\\mu_0 I}{2\\pi r}", fontSize: 27, color: BLUE_D });
await eq.waitForRender();
eq.toEdge(DOWN, 0.12);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const leg = new Text({ text: "右手握导线、拇指指电流 → 四指即磁场(逆时针)", fontSize: 20, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
leg.nextTo(eq, UP, 0.14);
await scene.play(new Write(leg));
await scene.play(new Indicate(iLab, { color: GOLD, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ============ 15. 电磁 · LC 振荡电路 ============
  {
    id: "phy-lc-oscillation",
    source: "经典 manim 动画题材改写(LC 振荡电荷/电流互换)",
    domain: "physics",
    category: "电磁 · 振荡电路",
    title: "LC 振荡:电荷 q 与电流 i 此消彼长",
    intent: "LC 电路里电容放电→电感储能→反向充电周期性往复,电荷 q 与电流 i 随时间按正弦关系变化且相差 π/2。用两条曲线展示并给出角频率 ω = 1/√(LC)。",
    params: [{ name: "LC", label: "1/√(LC) 频率", min: 1, max: 3, step: 0.2, default: 2 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, ValueTracker, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GRAY, WHITE, UP, DOWN, easeInOut, params } = ctx;
const title = new Text({ text: "LC 振荡:电荷 q 与电流 i 差 π/2", fontSize: 26, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const om = params.LC, tmax = 2 * Math.PI;
const axes = new Axes({ xRange: [0, tmax, Math.PI / 2], yRange: [-1.6, 1.6, 1], xLength: 9.4, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
await scene.play(new Create(axes), { duration: 0.4 });
const cq = axes.plot((t) => Math.cos(om * t), { xRange: [0, tmax], color: BLUE_D, strokeWidth: 3 });
const ci = axes.plot((t) => -Math.sin(om * t), { xRange: [0, tmax], color: BLUE_C, strokeWidth: 2.6 });
scene.add(cq, ci);
await scene.play(new Create(cq), new Create(ci));

const tT = new ValueTracker(0);
const dq = new Dot({ point: axes.c2p(0, 1), radius: 0.08, color: BLUE_D });
const di = new Dot({ point: axes.c2p(0, 0), radius: 0.08, color: BLUE_C });
dq.addUpdater((d) => { const t = tT.getValue(); d.moveTo(axes.c2p(t, Math.cos(om * t))); });
di.addUpdater((d) => { const t = tT.getValue(); d.moveTo(axes.c2p(t, -Math.sin(om * t))); });
scene.add(dq, di);
await scene.play(tT.animateTo(tmax, { duration: 3, rateFunc: easeInOut }));

const eq = new MathTexImage({ renderer: "katex", latex: "\\omega=\\frac{1}{\\sqrt{LC}}", fontSize: 27, color: BLUE_D });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.24);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const leg = new Text({ text: "q 最大时 i=0:能量在电容与电感间互换", fontSize: 20, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
leg.nextTo(eq, DOWN, 0.14);
await scene.play(new Write(leg));
await scene.play(new Indicate(dq, { color: BLUE_D, duration: 0.8 }), new Indicate(di, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ============ 16. 热力学 · 等温与绝热过程 ============
  {
    id: "phy-pv-diagram",
    source: "经典 manim 动画题材改写(理想气体 PV 图等温/绝热)",
    domain: "physics",
    category: "热力学",
    title: "PV 图:等温(PV=const)与绝热(PV^γ=const)",
    intent: "在压强-体积图上画出从同一起点出发的等温线 PV=nRT 与绝热线 PV^γ=const,直观看到绝热线更陡(γ>1)。学生理解等温(温度不变)与绝热(无热交换)的区别及形态差异。",
    params: [{ name: "gamma", label: "比热比 γ", min: 1.2, max: 1.7, step: 0.05, default: 1.4 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, RED, GRAY, WHITE, UP, DOWN, RIGHT, params } = ctx;
const title = new Text({ text: "PV 图:等温与绝热过程", fontSize: 26, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const gam = params.gamma;
const axes = new Axes({ xRange: [0.4, 3.6, 0.5], yRange: [0.2, 8, 1], xLength: 8.2, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
await scene.play(new Create(axes), { duration: 0.4 });
const P0 = 6, V0 = 0.6;
const isotherm = axes.plot((V) => (P0 * V0) / V, { xRange: [V0, 3.4], color: BLUE_D, strokeWidth: 3 });
const adiabat = axes.plot((V) => P0 * Math.pow(V0, gam) / Math.pow(V, gam), { xRange: [V0, 2.5], color: RED, strokeWidth: 3 });
scene.add(isotherm, adiabat);
await scene.play(new Create(isotherm));
await scene.play(new Create(adiabat));

const labIso = new Text({ text: "等温 PV=const", fontSize: 19, color: BLUE_D, fontFamily: '"Times New Roman","SimSun",serif' });
labIso.nextTo(axes.c2p(2.6, (P0 * V0) / 2.6), RIGHT, 0.12);
const labAd = new Text({ text: "绝热:更陡", fontSize: 19, color: RED, fontFamily: '"Times New Roman","SimSun",serif' });
labAd.nextTo(axes.c2p(1.25, P0 * Math.pow(V0, gam) / Math.pow(1.25, gam)), RIGHT, 0.12);
scene.add(labIso, labAd);
await scene.play(new Write(labIso), new Write(labAd));

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{等温}:PV=\\text{const},\\quad\\text{绝热}:PV^\\gamma=\\text{const}", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.24);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const leg = new Text({ text: "γ>1 → 绝热线比等温线更陡", fontSize: 20, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
leg.nextTo(eq, DOWN, 0.12);
await scene.play(new Write(leg));
await scene.play(new Indicate(adiabat, { color: RED, duration: 1 }));
await scene.play(new Indicate(isotherm, { color: BLUE_D, duration: 1 }));
await scene.wait(0.8);
`,
  },

  // ============ 17. 力学 3D · 角动量与转盘 ============
  {
    id: "phy-angular-momentum",
    source: "经典 manim 动画题材改写(转动圆环角动量矢量;Python manim 3D 题材,自建 ThreeDScene)",
    domain: "demo",
    category: "力学 · 角动量",
    title: "3D 角动量:转动体的 L 沿转轴(右手定则)",
    intent: "用 3D 相机展示绕轴转动的圆环,并用 3D 箭头画出色角动量矢量 L 沿转轴、位置矢量 r。学生从立体视角看清角动量方向由 L = r×p 及右手定则确定。",
    is3D: true,
    sceneCode: `
// —— 自建 ThreeDScene(domain=demo 走自由脚本:真 #container + 铺全局导出)——
const scene = new ThreeDScene(document.getElementById('container'), {
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#0b1420',
  phi: 58 * (Math.PI / 180),
  theta: -40 * (Math.PI / 180),
  distance: 13,
  fov: 34,
  enableOrbitControls: true,
});
// 转盘:圆环(Torus),旋转后法向沿 y → 角动量 L 沿 y
const wheel = new Torus({ radius: 2.0, tube: 0.28, opacity: 0.9 });
wheel.rotate(Math.PI / 2, [1, 0, 0]);
scene.add(wheel);
const hub = new Sphere({ radius: 0.3, color: '#6fb7ff', opacity: 0.95 });
scene.add(hub);
const Lv = new Arrow3D({ start: [0, -2.2, 0], end: [0, 2.2, 0], color: '#ffc94d', tipLength: 0.3, tipRadius: 0.12, shaftRadius: 0.06 });
scene.add(Lv);
const rvec = new Arrow3D({ start: [0, 0, 0], end: [1.8, 0, 0.6], color: '#4da3ff', tipLength: 0.2, tipRadius: 0.08, shaftRadius: 0.04 });
scene.add(rvec);
const axes = new ThreeDAxes({ xRange: [-2.5, 2.5, 1], yRange: [-2.5, 2.5, 1], zRange: [-2.5, 2.5, 1], axisColor: '#445', tipLength: 0.3, tipRadius: 0.1, shaftRadius: 0.008 });
scene.add(axes);
const title = new Text({ text: '角动量 L = r×p(沿转轴,右手定则)', fontSize: 26, color: '#ffffff', fontFamily: '"Times New Roman","SimSun",serif' });
scene.addFixedInFrameMobjects(title);
title.toCorner(UL);
const cap = new Text({ text: '金色 = 角动量 L,蓝色 = 位置矢量 r', fontSize: 22, color: '#9fc5e8', fontFamily: '"Times New Roman","SimSun",serif' });
scene.addFixedInFrameMobjects(cap);
cap.toCorner(DR);
await scene.wait(2);
`,
  },

  // ============ 18. 光学 · 双缝干涉 ============
  {
    id: "phy-double-slit",
    source: "经典 manim 动画题材改写(杨氏双缝干涉条纹)",
    domain: "physics",
    category: "光学 · 干涉",
    title: "双缝干涉:明暗条纹来自光程差",
    intent: "两条狭缝发出相干波,屏上某点光程差 Δ = d·sinθ 决定亮暗:Δ 为整数倍波长→亮纹,半整数倍→暗纹。画出双缝、往外扩散的波前与屏幕上的明暗条纹,并给条纹间距公式。",
    params: [{ name: "d", label: "缝距 d", min: 1, max: 3, step: 0.1, default: 2 }],
    sceneCode: `
const { scene, Line, Circle, Dot, Text, MathTexImage, AnimationGroup, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, GOLD, GRAY, WHITE, UP, DOWN, params } = ctx;
const title = new Text({ text: "双缝干涉:明暗条纹与光程差", fontSize: 27, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const s1 = [0, 0.5, 0], s2 = [0, -0.5, 0];
const slit1 = new Line({ start: [0, 1.1, 0], end: [0, 0.72, 0], color: WHITE, strokeWidth: 4 });
const slit2 = new Line({ start: [0, -0.1, 0], end: [0, -0.48, 0], color: WHITE, strokeWidth: 4 });
scene.add(slit1, slit2);
await scene.play(new Write(slit1), new Write(slit2));

const wfs = [];
for (const s of [s1, s2]) {
  for (let r = 0.8; r <= 4.4; r += 0.7) {
    const arc = new Circle({ radius: r, color: BLUE_C, strokeWidth: 1.2 });
    arc.moveTo(s);
    scene.add(arc);
    wfs.push(arc);
  }
}
await scene.play(new AnimationGroup(wfs.map((a) => new FadeIn(a, { duration: 0.25 })), { lagRatio: 0.04 }));

const screen = new Line({ start: [6.2, -3, 0], end: [6.2, 3, 0], color: GRAY, strokeWidth: 3 });
scene.add(screen);
await scene.play(new Create(screen), { duration: 0.5 });
for (const yy of [2.5, 1.4, 0.3, -0.8, -1.9, -3.0]) {
  const bright = new Line({ start: [6.2, yy - 0.28, 0], end: [6.2, yy + 0.28, 0], color: BLUE, strokeWidth: 4 });
  scene.add(bright);
  await scene.play(new FadeIn(bright, { duration: 0.2 }));
}

const eq = new MathTexImage({ renderer: "katex", latex: "\\Delta y=\\frac{\\lambda L}{d}", fontSize: 27, color: BLUE_D });
await eq.waitForRender();
eq.toEdge(DOWN, 0.12);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const leg = new Text({ text: "Δ=整数λ→亮纹,半整数λ→暗纹", fontSize: 20, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
leg.nextTo(eq, UP, 0.14);
await scene.play(new Write(leg));
await scene.play(new Indicate(screen, { color: GOLD, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ============ 19. 波动 · 多普勒效应 ============
  {
    id: "phy-doppler",
    source: "经典 manim 动画题材改写(运动声源的多普勒效应)",
    domain: "physics",
    category: "波动 · 多普勒",
    title: "多普勒效应:运动声源前方波前密、后方疏",
    intent: "声源向右运动时每一刻释放的波前都以当时位置为中心扩散,导致前方波面被压缩(波长变短、频率升高),后方被拉伸(波长变长、频率降低)。结合公式说明听者频率变化。",
    params: [{ name: "vs", label: "声源速度 vs", min: 0.1, max: 0.6, step: 0.05, default: 0.35 }],
    sceneCode: `
const { scene, Dot, Text, MathTexImage, ValueTracker, VGroup, Write, FadeIn, Indicate, RED, BLUE_C, GRAY, WHITE, UP, DOWN, easeInOut, params } = ctx;
const title = new Text({ text: "多普勒效应:前方密、后方疏", fontSize: 27, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const vs = params.vs;
const src = new Dot({ radius: 0.22, color: RED });
const sT = new ValueTracker(-2.4);
src.addUpdater((d) => d.moveTo([sT.getValue(), 0, 0]));
scene.add(src);
await scene.play(new FadeIn(src, { duration: 0.3 }));

// 声源每移动一步在"当时位置"留下一个以声速 1 扩散的波前
const FIRE = 10;
const firePos = [];
for (let i = 0; i < FIRE; i++) { firePos.push(-2.4 + (i / FIRE) * 4.8 * vs); }
function rings() {
  const now = sT.getValue();
  const out = [];
  for (let i = 0; i < FIRE; i++) {
    const fx = firePos[i];
    if (fx > now) continue;
    const age = now - fx;
    const c = new Circle({ radius: age, color: BLUE_C, strokeWidth: 1.2 });
    c.moveTo([fx, 0, 0]);
    out.push(c);
  }
  return out;
}
let ringV = new VGroup(...rings());
scene.add(ringV);
ringV.addUpdater((g) => {
  const rg = rings();
  if (rg.length) g.become(new VGroup(...rg));
});
await scene.play(sT.animateTo(2.4, { duration: 2.6, rateFunc: easeInOut }));

const eq = new MathTexImage({ renderer: "katex", latex: "f'=f\\frac{v}{v\\mp v_s}", fontSize: 27, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.12);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const leg = new Text({ text: "前方(右)波前被压缩→频率高;后方拉伸→频率低", fontSize: 20, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
leg.nextTo(eq, UP, 0.14);
await scene.play(new Write(leg));
await scene.play(new Indicate(src, { color: RED, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ============ 20. 流体 · 连续性方程 ============
  {
    id: "phy-continuity",
    source: "经典 manim 动画题材改写(流体连续性方程 A·v=const)",
    domain: "physics",
    category: "流体力学",
    title: "流体连续性:管径变细流速加快 A·v=const",
    intent: "不可压缩流体在粗细变化的管道里流动:细管处流速快、粗管处流速慢,满足 A₁v₁=A₂v₂。用流动箭头(细段更长更密)直观展示体积流量守恒。",
    params: [{ name: "ratio", label: "面积比(粗/细)", min: 1.2, max: 4, step: 0.2, default: 2 }],
    sceneCode: `
const { scene, Line, Arrow, Text, MathTexImage, Write, FadeIn, Indicate, AnimationGroup, BLUE, BLUE_D, WHITE, GRAY, UP, DOWN, params } = ctx;
const title = new Text({ text: "连续性方程:细管流速快 A·v=const", fontSize: 26, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const ratio = params.ratio;
// 管道:左侧粗(y∈[-1,1]),右侧细(y∈[-1/ratio,1/ratio])
const half = 1.0, nhalf = 1.0 / ratio;
const topW = new Line({ start: [-4.6, half, 0], end: [0, half, 0], color: WHITE, strokeWidth: 3 });
const botW = new Line({ start: [-4.6, -half, 0], end: [0, -half, 0], color: WHITE, strokeWidth: 3 });
const topN = new Line({ start: [0, nhalf, 0], end: [4.6, nhalf, 0], color: WHITE, strokeWidth: 3 });
const botN = new Line({ start: [0, -nhalf, 0], end: [4.6, -nhalf, 0], color: WHITE, strokeWidth: 3 });
scene.add(topW, botW, topN, botN);
await scene.play(new Write(topW), new Write(botW), new Write(topN), new Write(botN));

// 粗段流速箭头(短)与细段流速箭头(长):长度与 1/A 成正比
const arrows = [];
for (const y of [-0.5, 0, 0.5]) {
  arrows.push(new Arrow({ start: [-1.4, y, 0], end: [-0.4, y, 0], color: BLUE_D, strokeWidth: 3, tipLength: 0.14 }));
}
for (const y of [-0.5, 0, 0.5]) {
  arrows.push(new Arrow({ start: [-0.4, y / ratio, 0], end: [0.4 + 0.8 * ratio, y / ratio, 0], color: BLUE, strokeWidth: 3, tipLength: 0.14 }));
}
scene.add(...arrows);
await scene.play(new AnimationGroup(arrows.map((a) => new FadeIn(a, { duration: 0.3 })), { lagRatio: 0.04 }));

const labW = new Text({ text: "粗段:流速慢", fontSize: 18, color: BLUE_D, fontFamily: '"Times New Roman","SimSun",serif' });
labW.nextTo([-1.9, 1.5, 0], DOWN, 0.05);
const labN = new Text({ text: "细段:流速快", fontSize: 18, color: BLUE, fontFamily: '"Times New Roman","SimSun",serif' });
labN.nextTo([2.0, 1.5, 0], DOWN, 0.05);
scene.add(labW, labN);
await scene.play(new Write(labW), new Write(labN));

const eq = new MathTexImage({ renderer: "katex", latex: "A_1v_1=A_2v_2\\quad(v\\propto 1/A)", fontSize: 26, color: BLUE_D });
await eq.waitForRender();
eq.toEdge(DOWN, 0.12);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const leg = new Text({ text: "不可压缩流体:管细处流速快、管粗处流速慢", fontSize: 20, color: GRAY, fontFamily: '"Times New Roman","SimSun",serif' });
leg.nextTo(eq, UP, 0.14);
await scene.play(new Write(leg));
await scene.play(new Indicate(arrows[5], { color: BLUE, duration: 0.8 }));
await scene.wait(0.8);
`,
  },
];