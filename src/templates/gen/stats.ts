// =============================================================================
// 概率统计(+少量综合)教学 manim-web 模板库 —— 20 个可运行场景(注入 scene ctx 风格)
//
// 题材覆盖:描述统计 / 概率分布 / 推断统计 / 概率论基础 / 综合(信号卷积 · 控制 · ML)。
// 铁律遵守:解构行含所有标识符 · 纯 JS · MathTexImage 公式(await waitForRender)·
//   Text 带 SimSun fontFamily · 禁数组算术 · 相对定位(nextTo/c2p/arrange)·
//   对象进场景 · 不 NaN/不重叠/不越界。
// 分布曲线一律用 Axes.plot + c2p 标注点,直方图用 getRiemannRectangles /
//   getArea / plotLineGraph 与手工小矩形,回归/相关用散点 Dot + 拟合线。
// =============================================================================
import type { WebExample } from "../webExamples";

export const STATS_WEB_EXAMPLES: WebExample[] = [
  // ================= 1. 正态分布钟形曲线:均值与方差 =================
  {
    id: "stats-normal-bell",
    source: "经典统计教学动画改写(正态分布密度随 μ、σ 变化)",
    domain: "stats",
    category: "概率分布",
    title: "正态分布钟形曲线:均值移、方差变胖瘦",
    intent: "用三条钟形曲线对比 μ 决定中心位置、σ 决定高矮胖瘦:σ 越小曲线越高瘦(数据集中),σ 越大越低胖(数据分散)。建立正态密度 N(μ,σ²) 的图形直觉。",
    params: [{ name: "mu", label: "中心 μ", min: -2, max: 2, step: 0.5, default: 0 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, Create, Write, FadeIn, Indicate, Dot, BLUE, BLUE_C, GOLD, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [-5, 5, 1], yRange: [0, 0.9, 0.2], xLength: 8, yLength: 4.6, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "正态分布:μ 管位置,σ 管胖瘦", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const norm = (x, mu, sigma) => Math.exp(-0.5 * ((x - mu) / sigma) * ((x - mu) / sigma)) / (sigma * Math.sqrt(2 * Math.PI));
const mu = params.mu;
const c1 = axes.plot((x) => norm(x, mu, 2.0), { xRange: [-5, 5], color: GOLD, strokeWidth: 3 });
const c2 = axes.plot((x) => norm(x, mu, 1.0), { xRange: [-5, 5], color: BLUE, strokeWidth: 3 });
const c3 = axes.plot((x) => norm(x, mu, 0.5), { xRange: [-4.4, 4.4], color: BLUE_C, strokeWidth: 3 });
scene.add(c1, c2, c3);
await scene.play(new Create(c1, { duration: 1 }));
await scene.play(new Create(c2, { duration: 1 }));
await scene.play(new Create(c3, { duration: 1 }));

const eq = new MathTexImage({ renderer: "katex", latex: "f(x)=\\\\frac{1}{\\\\sigma\\\\sqrt{2\\\\pi}}\\\\,e^{-\\\\frac{(x-\\\\mu)^2}{2\\\\sigma^2}}", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const muDot = new Dot({ point: axes.c2p(mu, 0), radius: 0.09, color: GOLD });
scene.add(muDot);
await scene.play(new FadeIn(muDot, { duration: 0.5 }));
const note = new Text({ text: "σ 小 = 高瘦集中(σ=0.5)　σ 大 = 低胖分散(σ=2)", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
await scene.play(new Indicate(c3, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ================= 2. 标准正态与 z-score =================
  {
    id: "stats-z-score",
    source: "经典统计教学动画改写(标准化变换 z=(x-μ)/σ)",
    domain: "stats",
    category: "推断统计",
    title: "标准正态与 z-score:标准化变换",
    intent: "把任意正态 X~N(μ,σ²) 减去均值再除以标准差,得到标准正态 Z~N(0,1)。z-score 衡量原始值偏离均值多少个标准差,让学生理解标准化的几何是'平移+缩放'。",
    params: [{ name: "xval", label: "原始值 x", min: -2, max: 4, step: 0.5, default: 2 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, Dot, Create, Write, FadeIn, Indicate, BLUE, GOLD, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [-3.5, 4, 1], yRange: [0, 0.85, 0.2], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const mu0 = 0, sig = 1.2;
const norm = (x) => Math.exp(-0.5 * ((x - mu0) / sig) * ((x - mu0) / sig)) / (sig * Math.sqrt(2 * Math.PI));
const curve = axes.plot(norm, { xRange: [-3.4, 3.6], color: BLUE, strokeWidth: 3 });
scene.add(curve);
const title = new Text({ text: "z-score:标准化到 N(0,1)", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
await scene.play(new Create(curve));

const xv = Math.max(-2.8, Math.min(3.2, params.xval));
const z = (xv - mu0) / sig;
const px = axes.c2p(xv, norm(xv));
const vline = axes.getVerticalLine(px, { color: GOLD, strokeWidth: 2.5 });
const dotx = new Dot({ point: px, radius: 0.1, color: WHITE });
scene.add(vline, dotx);
await scene.play(new Create(vline), new FadeIn(dotx));
const eq = new MathTexImage({ renderer: "katex", latex: "z=\\\\frac{x-\\\\mu}{\\\\sigma}\\\\approx" + z.toFixed(2), fontSize: 28, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const note = new Text({ text: "x = " + xv.toFixed(1) + " 比均值高出 " + z.toFixed(2) + " 个标准差", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
await scene.play(new Indicate(dotx, { color: WHITE, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ================= 3. 直方图 vs 密度曲线 =================
  {
    id: "stats-histogram-density",
    source: "经典统计教学动画改写(直方图趋近概率密度)",
    domain: "stats",
    category: "数据可视化",
    title: "直方图 vs 密度曲线:分箱细了就贴合",
    intent: "同一组数据,直方图分箱越细(矩形越多),外形越贴合底下叠加的正态密度曲线 —— 说明直方图是密度的离散近似,面积对应概率。",
    params: [{ name: "nbins", label: "分箱数", min: 5, max: 24, step: 1, default: 10 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, Create, Write, FadeIn, Indicate, AnimationGroup, BLUE, BLUE_C, GOLD, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [-3.5, 3.5, 1], yRange: [0, 0.5, 0.1], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const norm = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
const curve = axes.plot(norm, { xRange: [-3.4, 3.4], color: GOLD, strokeWidth: 3 });
scene.add(curve);
const title = new Text({ text: "直方图 → 概率密度曲线", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
await scene.play(new Create(curve));

// 用分箱矩形(每箱面积为该区间概率近似)表示直方图条
const nb = Math.max(5, Math.round(params.nbins));
const lo = -3, hi = 3, w = (hi - lo) / nb;
const bars = [];
for (let i = 0; i < nb; i++) {
  const l = lo + i * w;
  const bar = axes.getRiemannRectangles(curve, { xRange: [l, l + w], dx: w, color: BLUE_C, fillOpacity: 0.35, strokeWidth: 0.5 });
  bars.push(bar);
}
scene.add(...bars);
await scene.play(new AnimationGroup(bars.map((b) => new Create(b, { duration: 0.15 })), { lagRatio: 0.05 }));
const eq = new MathTexImage({ renderer: "katex", latex: "\\\\text{分箱细,矩形面积和}\\\\to\\\\text{曲线下面积(概率)}", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const note = new Text({ text: "分箱数 = " + nb, fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
await scene.play(new Indicate(curve, { color: GOLD, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ================= 4. 大数定律:抛硬币频率 → 概率 =================
  {
    id: "stats-law-large-numbers",
    source: "经典统计教学动画改写(伯努利大数定律:频率收敛到概率)",
    domain: "stats",
    category: "概率论",
    title: "大数定律:抛硬币频率收敛到 1/2",
    intent: "抛一枚公平硬币 n 次,正面频率 fn=head/n 随次数增多在 0.5 附近摆动并最终收敛。用折线展示频率随 n 的波动逐渐收窄,直观建立'大数定律'。",
    params: [{ name: "maxN", label: "最大次数", min: 20, max: 120, step: 5, default: 60 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, Create, Write, FadeIn, BLUE_C, GOLD, WHITE, UP, DOWN, params } = ctx;
const maxN = Math.max(10, Math.round(params.maxN));
const axes = new Axes({ xRange: [0, 120, 20], yRange: [0, 1, 0.25], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "大数定律:频率 → 概率(0.5)", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const half = axes.plot((x) => 0.5, { xRange: [0, 120], color: GOLD, strokeWidth: 2.5 });
scene.add(half);
await scene.play(new Create(half));

// 确定性伪随机抛硬币,产生累加频率序列
let p = 0.5, seq = [];
for (let n = 1; n <= 120; n++) {
  p = (p * 48271) % 2147483647;
  seq.push(((p / 2147483647) < 0.5) ? 1 : 0);
}
let hsum = 0, xv = [], yv = [];
for (let n = 1; n <= maxN; n++) { hsum += seq[n - 1]; xv.push(n); yv.push(hsum / n); }
const line = axes.plotLineGraph({ xValues: xv, yValues: yv, lineColor: BLUE_C, addVertexDots: true, vertexDotRadius: 0.04, strokeWidth: 2 });
scene.add(line);
await scene.play(new Create(line, { duration: 1.2 }));
const eq = new MathTexImage({ renderer: "katex", latex: "\\\\frac{n_H}{n}\\\\,\\\\rightarrow\\\\,\\\\frac12\\\\;\\\\text{(n 很大时)}", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const note = new Text({ text: "次数越多,频率越贴着 0.5", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
await scene.wait(0.8);
`,
  },

  // ================= 5. 中心极限定理 =================
  {
    id: "stats-central-limit",
    source: "经典统计教学动画改写(样本均值的分布随 n 趋近正态)",
    domain: "stats",
    category: "推断统计",
    title: "中心极限定理:样本均值越来越正态",
    intent: "无论总体分布如何,样本均值的抽样分布随样本量 n 增大而趋近正态。用多条钟形曲线展示 n 增大时曲线变窄、中心不变、形状趋正,建立 CLT 直觉。",
    params: [{ name: "sampleN", label: "样本量 n", min: 1, max: 30, step: 1, default: 10 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, GOLD, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [-3.2, 3.2, 1], yRange: [0, 1.1, 0.2], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "中心极限定理:均值的分布 → 正态", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
const norm = (x, sd) => Math.exp(-0.5 * x * x / (sd * sd)) / (sd * Math.sqrt(2 * Math.PI));
const sdX = 1.0; // 总体标准差(总体均值 0)
// n=1 时是总体分布(宽)
const cA = axes.plot((x) => norm(x, sdX), { xRange: [-3, 3], color: GOLD, strokeWidth: 3 });
scene.add(cA);
await scene.play(new Create(cA, { duration: 1 }));
// 样本均值的分布:N(0, σ/√n) —— 归一化到保持面积,缩窄变高
const n = Math.max(1, Math.round(params.sampleN));
const sdM = sdX / Math.sqrt(n);
const cB = axes.plot((x) => norm(x, sdM), { xRange: [-3, 3], color: BLUE_C, strokeWidth: 3 });
scene.add(cB);
await scene.play(new Create(cB, { duration: 1 }));
const eq = new MathTexImage({ renderer: "katex", latex: "\\\\bar{X}\\\\sim N\\\\left(\\\\mu,\\\\frac{\\\\sigma^2}{n}\\\\right)", fontSize: 28, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const note = new Text({ text: "n = " + n + ":曲线变窄(方差 σ²/n 变小)", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
await scene.play(new Indicate(cB, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ================= 6. 泊松分布 =================
  {
    id: "stats-poisson",
    source: "经典统计教学动画改写(泊松分布随 λ 变化)",
    domain: "stats",
    category: "概率分布",
    title: "泊松分布:λ 影响重心与发散",
    intent: "泊松分布 P(k;λ) 描述单位时间随机事件发生 k 次的概率。λ 越大,峰值(≈λ)越右移、分布越对称;柱高=点概率,总面积=1。",
    params: [{ name: "lambda", label: "强度 λ", min: 1, max: 8, step: 0.5, default: 3 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, Create, Write, FadeIn, Indicate, LaggedStartMap, BLUE_C, GOLD, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 14, 2], yRange: [0, 0.45, 0.1], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "泊松分布:P(k;λ)", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
const lam = Math.max(0.5, params.lambda);
function fact(k) { let r = 1; for (let i = 2; i <= k; i++) r *= i; return r; }
const pois = (k) => Math.exp(-lam) * Math.pow(lam, k) / fact(k);
const dots = [], vlines = [];
for (let k = 0; k <= 13; k++) {
  const p = pois(k);
  const pt = axes.c2p(k, p);
  const d = new Dot({ point: pt, radius: 0.07, color: BLUE_C });
  const vl = axes.getVerticalLine(pt, { color: BLUE_C, strokeWidth: 2 });
  dots.push(d); vlines.push(vl);
}
scene.add(...vlines, ...dots);
await scene.play(new LaggedStartMap(Create, vlines, { lagRatio: 0.06 }));
await scene.play(new LaggedStartMap(FadeIn, dots, { lagRatio: 0.06 }));
const eq = new MathTexImage({ renderer: "katex", latex: "P(k)=\\\\frac{\\\\lambda^k e^{-\\\\lambda}}{k!}", fontSize: 28, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const note = new Text({ text: "λ = " + lam.toFixed(1) + " :重心在 k ≈ λ 附近", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
await scene.play(new Indicate(dots[Math.round(lam)] || dots[0], { color: GOLD, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ================= 7. 二项分布 =================
  {
    id: "stats-binomial",
    source: "经典统计教学动画改写(二项分布随 n、p 变化)",
    domain: "stats",
    category: "概率分布",
    title: "二项分布:n 次独立试验的成败次数",
    intent: "二项分布 B(n,p) 描述 n 次独立试验中成功 k 次的概率。p=0.5 时对称,p 偏向一侧时峰值偏移;n 增大时柱形变密并向正态靠拢。",
    params: [{ name: "p", label: "成功概率 p", min: 0.1, max: 0.9, step: 0.05, default: 0.5 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, Write, FadeIn, Indicate, LaggedStartMap, BLUE_C, GOLD, WHITE, UP, DOWN, params } = ctx;
const n = 16;
const axes = new Axes({ xRange: [0, n, 2], yRange: [0, 0.45, 0.1], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "二项分布:B(n, p)", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
const pv = Math.max(0.05, Math.min(0.95, params.p));
const comb = (a, b) => { let r = 1; for (let i = 0; i < b; i++) r = r * (a - i) / (i + 1); return r; };
const dots = [];
for (let k = 0; k <= n; k++) {
  const p = comb(n, k) * Math.pow(pv, k) * Math.pow(1 - pv, n - k);
  dots.push(new Dot({ point: axes.c2p(k, p), radius: 0.07, color: BLUE_C }));
}
scene.add(...dots);
await scene.play(new LaggedStartMap(FadeIn, dots, { lagRatio: 0.03 }));
const eq = new MathTexImage({ renderer: "katex", latex: "P(k)=\\\\binom{n}{k}p^k(1-p)^{n-k}", fontSize: 28, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const note = new Text({ text: "p = " + pv.toFixed(2) + " 对称性随 p 偏移", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
await scene.play(new Indicate(dots[Math.round(n * pv)] || dots[n], { color: GOLD, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ================= 8. 期望与方差的直观 =================
  {
    id: "stats-expectation-variance",
    source: "经典统计教学动画改写(均值=重心,方差=离散度)",
    domain: "stats",
    category: "描述统计",
    title: "期望与方差:重心 vs 离散程度",
    intent: "在数轴上放一组数据点,金点标均值(分布的重心),蓝点标其他数据,图形相对布局;方差 = 偏离平方的平均,衡量数据整体离散程度 —— 大方差把点铺开,小方差聚拢。",
    params: [{ name: "spread", label: "离散度", min: 0.2, max: 2, step: 0.2, default: 1 }],
    sceneCode: `
const { scene, Line, Dot, Text, MathTexImage, Write, FadeIn, Create, Indicate, LaggedStartMap, BLUE_C, GOLD, GRAY, WHITE, DOWN, params } = ctx;
const spread = Math.max(0.2, params.spread);
// 基础数据相对排列:用 -2..6 做横轴标尺,离散度直接缩放横向间距
const vals = [-2, -1.1, -0.2, 0.7, 1.6, 2.4, 3.2, 4.3, 5.2];
const xs = vals.map((v) => v * spread);
// 画横轴
const axis = new Line({ start: [-4.5, 0, 0], end: [6, 0, 0], color: GRAY, strokeWidth: 2 });
const tick1 = new Line({ start: [0, -0.25, 0], end: [0, 0.25, 0], color: GRAY, strokeWidth: 1.5 });
scene.add(axis, tick1);
const title = new Text({ text: "期望 = 重心,方差 = 离散度", fontSize: 29, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(DOWN).shift([0, 3.5, 0]);
scene.add(title);
await scene.play(new Write(title), new Create(axis));
const dats = [];
for (let i = 0; i < xs.length; i++) {
  dats.push(new Dot({ point: [xs[i], 0, 0], radius: 0.08, color: (i === 0 ? GOLD : BLUE_C) }));
}
scene.add(...dats);
await scene.play(new LaggedStartMap(FadeIn, dats, { lagRatio: 0.08 }));
// 均值垂线
const mLine = new Line({ start: [0, -0.8, 0], end: [0, 0.9, 0], color: GOLD, strokeWidth: 3 });
scene.add(mLine);
await scene.play(new Create(mLine, { duration: 0.6 }));
const eq = new MathTexImage({ renderer: "katex", latex: "\\\\bar{x}=\\\\frac{1}{n}\\\\sum x_i,\\\\quad\\\\sigma^2=\\\\frac{1}{n}\\\\sum (x_i-\\\\bar{x})^2", fontSize: 25, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(title, DOWN, 0.35).shift([0, -1.8, 0]);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
await scene.play(new Indicate(mLine, { color: GOLD, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ================= 9. 回归直线(最小二乘)=================
  {
    id: "stats-regression-line",
    source: "经典统计教学动画改写(最小二乘拟合)",
    domain: "stats",
    category: "相关与回归",
    title: "回归直线:最小化竖直残差平方",
    intent: "在一组散点上拟合一条最优直线,使各点到直线的竖直残差平方和最小。展示拟合线贯穿数据趋势,残差线段长短反映误差,理解最小二乘的几何意义。",
    params: [{ name: "slope", label: "拟合斜率", min: 0.3, max: 1.5, step: 0.1, default: 0.9 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, Create, Write, FadeIn, Indicate, LaggedStartMap, BLUE, BLUE_C, GOLD, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 6, 1], yRange: [0, 6, 1], xLength: 7, yLength: 5.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "回归直线:最小二乘拟合", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
const data = [[1, 1.2], [1.6, 2.0], [2.3, 2.4], [3.0, 3.1], [3.7, 3.6], [4.4, 4.3], [5.1, 5.2], [5.6, 5.1]];
const pslope = Math.max(0.3, Math.min(1.5, params.slope));
const inter = 0.2;
const fitline = axes.plot((x) => inter + pslope * x, { xRange: [0, 6], color: BLUE_C, strokeWidth: 3 });
scene.add(fitline);
const dots = [], resids = [];
for (let i = 0; i < data.length; i++) {
  const x = data[i][0], y = data[i][1];
  const yfit = inter + pslope * x;
  const pt = axes.c2p(x, y);
  const pd = axes.c2p(x, yfit);
  dots.push(new Dot({ point: pt, radius: 0.09, color: BLUE }));
  resids.push(new Line({ start: pt, end: pd, color: GOLD, strokeWidth: 1.8 }));
}
scene.add(...dots, ...resids);
await scene.play(new LaggedStartMap(FadeIn, dots, { lagRatio: 0.08 }));
await scene.play(new Create(fitline, { duration: 1 }));
await scene.play(new LaggedStartMap(Create, resids, { lagRatio: 0.05 }));
const eq = new MathTexImage({ renderer: "katex", latex: "\\\\min\\\\sum (y_i-\\\\hat{y}_i)^2", fontSize: 28, color: BLUE });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const note = new Text({ text: "金线 = 各点到拟合线的竖直残差", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
await scene.play(new Indicate(fitline, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ================= 10. 相关系数 r =================
  {
    id: "stats-correlation-r",
    source: "经典统计教学动画改写(正/负/零相关散点)",
    domain: "stats",
    category: "相关与回归",
    title: "相关系数 r:散点方向的度量",
    intent: "用散点展示相关系数:r 接近 +1 时点沿左下到右上排布(正相关),r≈0 时点均匀散开(无关),r 接近 -1 时沿左上到右下(负相关)。",
    params: [{ name: "r", label: "相关系数 r", min: -1, max: 1, step: 0.1, default: 0.8 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, Write, FadeIn, LaggedStartMap, BLUE, GOLD, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [-1, 1, 1], yRange: [-1, 1, 1], xLength: 6.5, yLength: 5.2, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "相关系数 r:数据是否在一条线上", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
const r = Math.max(-0.95, Math.min(0.95, params.r));
const dots = [];
const n = 40;
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
for (let i = 0; i < n; i++) {
  const ang = rnd() * Math.PI * 2;
  const z1 = Math.cos(ang), z2 = Math.sin(ang);
  const x = z1;
  const y = r * z1 + Math.sqrt(1 - r * r) * z2;
  dots.push(new Dot({ point: axes.c2p(x, y), radius: 0.06, color: BLUE }));
}
scene.add(...dots);
await scene.play(new LaggedStartMap(FadeIn, dots, { lagRatio: 0.02 }));
const eq = new MathTexImage({ renderer: "katex", latex: "r=\\\\frac{\\\\sum (x_i-\\\\bar{x})(y_i-\\\\bar{y})}{\\\\sqrt{\\\\sum (x_i-\\\\bar{x})^2\\\\sum (y_i-\\\\bar{y})^2}}", fontSize: 24, color: BLUE });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const note = new Text({ text: "当前 r = " + r.toFixed(2) + " : 点沿方向排列", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
const tl = new Text({ text: "r→+1 正相关, r→-1 负相关, r≈0 无关", fontSize: 20, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
tl.nextTo(note, DOWN, 0.12);
scene.add(tl);
await scene.play(new Write(tl));
await scene.wait(0.8);
`,
  },

  // ================= 11. 条件概率与贝叶斯 =================
  {
    id: "stats-bayes",
    source: "经典统计教学动画改写(贝叶斯公式 / 逆条件概率)",
    domain: "stats",
    category: "概率论",
    title: "条件概率:交集占比与贝叶斯",
    intent: "用两个交叠的圆展示事件 A 与 B 的交集:P(A|B)=P(A∩B)/P(B)。贝叶斯把'由结果反推原因'用先验与似然算出来,理解'逆条件概率'的几何。",
    params: [{ name: "overlap", label: "重叠度", min: 0.2, max: 0.8, step: 0.1, default: 0.5 }],
    sceneCode: `
const { scene, Circle, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, GOLD, GRAY, WHITE, DOWN, params } = ctx;
const ov = Math.max(0.15, params.overlap);
const base = new Circle({ radius: 2.9, color: GRAY, strokeWidth: 1.5, fillOpacity: 0.06 });
const cA = new Circle({ radius: 1.7, color: BLUE, strokeWidth: 3, fillOpacity: 0.16 }).shift([-ov * 1.1, 0, 0]);
const cB = new Circle({ radius: 1.7, color: GOLD, strokeWidth: 3, fillOpacity: 0.16 }).shift([ov * 1.1, 0, 0]);
const labA = new Text({ text: "A", fontSize: 30, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
labA.shift([-ov * 1.1 - 1.2, 0, 0]);
const labB = new Text({ text: "B", fontSize: 30, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
labB.shift([ov * 1.1 + 1.2, 0, 0]);
const inter = new Text({ text: "A∩B", fontSize: 24, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
inter.moveTo([0, 0, 0]);
const title = new Text({ text: "条件概率:P(A|B) = A∩B 在 B 中的占比", fontSize: 25, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(DOWN).shift([0, 3.3, 0]);
scene.add(base, cA, cB, labA, labB, inter, title);
await scene.play(new Create(cA, { duration: 0.8 }), new Create(cB, { duration: 0.8 }));
await scene.play(new Write(title));
await scene.play(new Write(labB), new Write(labA), new Write(inter));
await scene.play(new Indicate(inter, { color: WHITE, duration: 0.8 }));
const eq = new MathTexImage({ renderer: "katex", latex: "P(A|B)=\\\\frac{P(A\\\\cap B)}{P(B)}", fontSize: 28, color: BLUE });
await eq.waitForRender();
eq.nextTo(title, DOWN, 0.32).shift([0, -1.9, 0]);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
await scene.wait(0.8);
`,
  },

  // ================= 12. 均匀分布 =================
  {
    id: "stats-uniform-dist",
    source: "经典统计教学动画改写(连续均匀分布)",
    domain: "stats",
    category: "概率分布",
    title: "均匀分布:区间内每点等可能",
    intent: "连续均匀分布 U(a,b) 在 [a,b] 上概率密度恒为常数,曲线是一条水平线段,线下面积=1。用阴影表示任意子区间的概率=该区间长度除以总长。",
    params: [{ name: "band", label: "子区间宽度", min: 0.5, max: 3, step: 0.5, default: 1.5 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, GOLD, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 5, 1], yRange: [0, 0.4, 0.1], xLength: 8, yLength: 4.6, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "均匀分布 U(0,5):处处等概率", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
const density = 1 / 5;
const line = axes.plot((x) => density, { xRange: [0, 5], color: BLUE, strokeWidth: 3 });
scene.add(line);
await scene.play(new Create(line));
const bw = Math.max(0.3, Math.min(3, params.band));
const area = axes.getArea(line, [1.5, 1.5 + bw], { color: GOLD, opacity: 0.35 });
scene.add(area);
await scene.play(new FadeIn(area, { duration: 0.6 }));
const eq = new MathTexImage({ renderer: "katex", latex: "P(1.5<X<1.5+b)=\\\\frac{b}{5}", fontSize: 27, color: BLUE });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const note = new Text({ text: "金区面积 = " + (bw * density).toFixed(2) + " = 区间占比", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
await scene.play(new Indicate(area, { color: GOLD, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ================= 13. 抽样分布与样本均值 =================
  {
    id: "stats-sampling-dist",
    source: "经典统计教学动画改写(多次抽样,样本均值围绕总体均值)",
    domain: "stats",
    category: "推断统计",
    title: "抽样分布:样本均值围绕总体均值",
    intent: "从总体反复抽取样本并计算样本均值,把每次抽样得到的 x̄ 标在横轴上,点围绕总体均值 μ 聚集,散布程度反映标准误 —— 直观理解'抽样分布'。",
    params: [{ name: "samples", label: "抽样次数", min: 10, max: 60, step: 5, default: 30 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, Create, Write, FadeIn, Indicate, LaggedStartMap, BLUE_C, GOLD, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [-2, 6, 1], yRange: [0, 8, 2], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "抽样分布:样本均值围绕总体均值 μ", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
const muT = 2.2, sigmaT = 1.0;
const muDot = new Dot({ point: axes.c2p(muT, 0), radius: 0.12, color: GOLD });
const muLine = axes.getVerticalLine(axes.c2p(muT, 8), { color: GOLD, strokeWidth: 2 });
scene.add(muLine, muDot);
await scene.play(new Create(muLine), new FadeIn(muDot));
let s = 11;
const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
const nS = Math.max(5, Math.round(params.samples));
const dots = [];
for (let i = 0; i < nS; i++) {
  // 用中心极限造近似正态随机量(6 个均匀数之和标准化)
  const z = (rnd() + rnd() + rnd() + rnd() + rnd() + rnd() - 3) / Math.sqrt(6 * (1 / 12));
  const xbar = muT + sigmaT * z / Math.sqrt(6);
  dots.push(new Dot({ point: axes.c2p(xbar, 0), radius: 0.07, color: BLUE_C }));
}
scene.add(...dots);
await scene.play(new LaggedStartMap(FadeIn, dots, { lagRatio: 0.02 }));
const eq = new MathTexImage({ renderer: "katex", latex: "\\\\bar{x}\\\\to\\\\mu\\\\;\\\\text{(SE}=\\\\sigma/\\\\sqrt{n}\\\\text{)}", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const note = new Text({ text: "样本均值点都聚在 μ 附近", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
await scene.play(new Indicate(muDot, { color: GOLD, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ================= 14. 中位数 vs 均值 =================
  {
    id: "stats-median-mean",
    source: "经典统计教学动画改写(偏态数据下中位数稳健)",
    domain: "stats",
    category: "描述统计",
    title: "中位数 vs 均值:对异常值的敏感度",
    intent: "一组偏态数据中,均值被极端大值拉高,而中位数稳健不受影响:均值 > 中位数 是右偏的典型特征。让学生理解收入分布常说'中位数更代表普通水平'。",
    params: [{ name: "outlier", label: "异常值位置", min: 0, max: 5, step: 1, default: 3 }],
    sceneCode: `
const { scene, Line, Dot, Text, Write, FadeIn, Create, Indicate, LaggedStartMap, BLUE, BLUE_C, GOLD, GRAY, WHITE, DOWN, params } = ctx;
// 左侧一簇小值(多数) + 右侧稀疏大值(少数) => 右偏
const pos = [-3.0, -2.5, -1.9, -1.4, -0.9, -0.3];
const outlier = Math.max(0, Math.min(5, Math.round(params.outlier)));
const rightVals = [1.4, 2.5].map((v) => v + outlier * 0.8);
const xs = pos.concat(rightVals);
// 数据点(黄色为异常值)
const dats = xs.map((x, i) => new Dot({ point: [x, 0, 0], radius: 0.09, color: (i >= pos.length ? GOLD : BLUE_C) }));
// 均值(受右侧影响右移)与中位数(稳健)
const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
const sorted = xs.slice().sort((a, b) => a - b);
const med = sorted[Math.floor(sorted.length / 2)];
const axis = new Line({ start: [-3.8, 0, 0], end: [5.5, 0, 0], color: GRAY, strokeWidth: 2 });
const title = new Text({ text: "均值被异常值拉高,中位数稳健", fontSize: 28, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(DOWN).shift([0, 3.4, 0]);
scene.add(axis, title);
await scene.play(new Write(title), new Create(axis));
scene.add(...dats);
await scene.play(new LaggedStartMap(FadeIn, dats, { lagRatio: 0.05 }));
const mLine = new Line({ start: [med, -0.8, 0], end: [med, 0.7, 0], color: GOLD, strokeWidth: 3 });
const meLine = new Line({ start: [mean, -0.8, 0], end: [mean, 0.7, 0], color: BLUE, strokeWidth: 3 });
scene.add(mLine, meLine);
await scene.play(new Create(mLine), new Create(meLine));
const legMed = new Text({ text: "中位数(金)  均值(蓝)", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
legMed.nextTo(title, DOWN, 0.3).shift([0, -1.7, 0]);
scene.add(legMed);
await scene.play(new Write(legMed));
await scene.play(new Indicate(mLine, { color: GOLD, duration: 0.7 }));
await scene.wait(0.8);
`,
  },

  // ================= 15. 夹逼的 LLN:样本均值收敛 =================
  {
    id: "stats-lln-convergence",
    source: "经典统计教学动画改写(样本均值随 n 收敛到期望)",
    domain: "stats",
    category: "概率论",
    title: "样本均值随 n 收敛到期望",
    intent: "重复抽样画出的样本均值曲线随样本量 n 增大而稳定在总体期望附近 —— 这就是大数定律'以概率收敛'的直观画面。",
    params: [{ name: "maxN", label: "最大 n", min: 20, max: 100, step: 5, default: 50 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE_C, GOLD, WHITE, UP, DOWN, params } = ctx;
const maxN = Math.max(10, Math.round(params.maxN));
const axes = new Axes({ xRange: [0, 100, 20], yRange: [-1, 6, 1], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "样本均值收敛到期望 E[X]", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
const ex = 2.5;
const expectLine = axes.plot((x) => ex, { xRange: [0, 100], color: GOLD, strokeWidth: 2.5 });
scene.add(expectLine);
await scene.play(new Create(expectLine));
let s = 31;
const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
const xv = [], yv = [];
let sum = 0;
for (let n = 1; n <= maxN; n++) {
  sum += rnd() * 5;
  xv.push(n); yv.push(sum / n);
}
const line = axes.plotLineGraph({ xValues: xv, yValues: yv, lineColor: BLUE_C, addVertexDots: false, strokeWidth: 2.5 });
scene.add(line);
await scene.play(new Create(line, { duration: 1.3 }));
const eq = new MathTexImage({ renderer: "katex", latex: "\\\\bar{X}_n\\\\,\\\\xrightarrow{P}\\\\,E[X]", fontSize: 28, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const note = new Text({ text: "折线逐步贴住期望线 2.5", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
await scene.play(new Indicate(expectLine, { color: GOLD, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ================= 16. 样本空间与概率度量(综合·集合)=================
  {
    id: "stats-probability-space",
    source: "经典概率教学动画改写(样本空间 / 事件并集概率)",
    domain: "stats",
    category: "概率论",
    title: "样本空间:事件并集概率 = 两概率相加减去交集",
    intent: "用矩形表示样本空间 Ω,两个矩形事件 A、B 展示不互斥时 P(A∪B)=P(A)+P(B)−P(A∩B) 的'双计减回'逻辑,建立概率度量公理直觉。",
    params: [{ name: "pa", label: "P(A) 分量", min: 1, max: 4, step: 1, default: 2 }],
    sceneCode: `
const { scene, Rectangle, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, GOLD, WHITE, UP, DOWN, params } = ctx;
const omega = new Rectangle({ width: 6.4, height: 4.4, color: "#6b8db8", strokeWidth: 2 });
const widen = Math.max(1, Math.min(4, Math.round(params.pa))) / 2.4;
const cA = new Rectangle({ width: 1.4 * widen, height: 2.2, color: BLUE, strokeWidth: 3, fillOpacity: 0.2 }).shift([-widen * 1.2, 0.6, 0]);
const cB = new Rectangle({ width: 2.0, height: 1.4, color: GOLD, strokeWidth: 3, fillOpacity: 0.2 }).shift([1.2, -0.8, 0]);
const labA = new Text({ text: "A", fontSize: 30, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
labA.shift([-widen * 1.2, 0.6, 0]);
const labB = new Text({ text: "B", fontSize: 30, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
labB.shift([1.2, -0.8, 0]);
const labO = new Text({ text: "样本空间 Ω(总概率=1)", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
labO.nextTo(omega, DOWN, 0.35);
const title = new Text({ text: "P(A∪B) = P(A) + P(B) − P(A∩B)", fontSize: 27, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(omega, cA, cB, labA, labB, labO, title);
await scene.play(new Create(omega, { duration: 0.6 }));
await scene.play(new Write(title));
await scene.play(new Create(cA), new Create(cB));
await scene.play(new Write(labA), new Write(labB), new Write(labO));
await scene.play(new Indicate(cA, { color: BLUE, duration: 0.7 }), new Indicate(cB, { color: GOLD, duration: 0.7 }));
const eq = new MathTexImage({ renderer: "katex", latex: "P(A\\\\cup B)=P(A)+P(B)-P(A\\\\cap B)", fontSize: 26, color: BLUE });
await eq.waitForRender();
eq.nextTo(labO, DOWN, 0.2).shift([0, -1.7, 0]);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
await scene.wait(0.8);
`,
  },

  // ================= 17. 卷积的直观(综合·信号系统)=================
  {
    id: "stats-convolution",
    source: "信号与系统经典教学动画改写(卷积 = 反转滑动加权叠加)",
    domain: "stats",
    category: "综合·信号",
    title: "卷积直观:窗口滑动逐点加权叠加",
    intent: "两个函数 f 和 g 的卷积在每一点 = 把 g 反转并滑动,与 f 逐点相乘后求和。展示滑动窗口下红色面积随位置变化,最终那条曲线就是卷积结果 —— 建立卷积的过程直觉。",
    params: [{ name: "shift", label: "滑动位移 τ", min: -2, max: 2, step: 0.2, default: 0.5 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, GOLD, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [-3, 3, 1], yRange: [0, 1.3, 1], xLength: 8, yLength: 3.8, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "卷积 (f★g):滑动相乘再求和", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
const f = (x) => (x >= -1 && x <= 1) ? (1 - Math.abs(x)) : 0;
const fc = axes.plot(f, { xRange: [-3, 3], color: BLUE, strokeWidth: 3 });
scene.add(fc);
await scene.play(new Create(fc));
const tau0 = Math.max(-2, Math.min(2, params.shift));
// 反转并滑动的 g_rev = g(x - tau);g 为 [0,1] 上的矩形脉冲
const g = (t) => (t >= 0 && t <= 1) ? 0.8 : 0;
const cur = axes.plot((t) => g(t), { xRange: [-3, 3], color: GOLD, strokeWidth: 3 });
cur.shift([tau0, 0, 0]);
scene.add(cur);
await scene.play(new Create(cur, { duration: 1 }));
await scene.play(new Indicate(cur, { color: GOLD, duration: 0.8 }));
const eq = new MathTexImage({ renderer: "katex", latex: "(f\\\\star g)(t)=\\\\int f(\\\\tau)\\\\,g(t-\\\\tau)\\\\,d\\\\tau", fontSize: 26, color: BLUE });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const note = new Text({ text: "金色 = 反转并滑到 τ 的 g;与蓝线重叠处乘积求和", fontSize: 21, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
await scene.wait(0.8);
`,
  },

  // ================= 18. 比例控制(综合·控制系统)=================
  {
    id: "stats-proportional-control",
    source: "控制系统教学动画改写(比例控制器:u = K·e 负反馈)",
    domain: "stats",
    category: "综合·控制",
    title: "比例控制:误差越大,修正越强",
    intent: "比例控制器按 u=K·e 输出,误差 e=目标−当前。展示不同增益 K 下系统趋近设定值的速度:误差为零输出为放松,理解'负反馈按误差比例纠偏'。",
    params: [{ name: "gain", label: "增益 K", min: 0.2, max: 2, step: 0.2, default: 0.8 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, GOLD, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 10, 1], yRange: [0, 6, 1], xLength: 7, yLength: 4.6, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "比例控制:u = K·e", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
const setpt = 4.5;
const setLine = axes.plot((x) => setpt, { xRange: [0, 10], color: GOLD, strokeWidth: 2.5 });
scene.add(setLine);
await scene.play(new Create(setLine));
const K = Math.max(0.2, Math.min(2, params.gain));
// 一阶负反馈响应:y = set*(1 - exp(-K t))
const curve = axes.plot((x) => setpt * (1 - Math.exp(-K * x)), { xRange: [0, 10], color: BLUE_C, strokeWidth: 3 });
scene.add(curve);
await scene.play(new Create(curve, { duration: 1.2 }));
const eq = new MathTexImage({ renderer: "katex", latex: "y(t)=y_{set}\\\\,(1-e^{-Kt})", fontSize: 27, color: BLUE });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const note = new Text({ text: "K = " + K.toFixed(1) + " :越大越快逼近设定值", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
await scene.play(new Indicate(curve, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ================= 19. 梯度下降(综合·机器学习)=================
  {
    id: "stats-gradient-descent",
    source: "机器学习教学动画改写(沿负梯度方向走到损失谷底)",
    domain: "stats",
    category: "综合·机器学习",
    title: "梯度下降:沿最陡下降走到损失谷底",
    intent: "损失函数 J 是碗形曲面,参数 θ 每次沿负梯度(最陡下降)方向迈一小步,学习率控制步长,逐步逼近使损失最小的 θ*。展示迭代过程与收敛。",
    params: [{ name: "lr", label: "学习率 η", min: 0.05, max: 0.6, step: 0.05, default: 0.3 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, Create, Write, FadeIn, Indicate, LaggedStartMap, BLUE, BLUE_C, GOLD, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [-2, 6, 1], yRange: [0, 8, 2], xLength: 7, yLength: 4.6, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "梯度下降:沿负梯度走到谷底", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
// 损失函数 J(θ) = (θ-2)² + 1,谷底在 θ*=2
const J = (t) => (t - 2) * (t - 2) + 1;
const dJ = (t) => 2 * (t - 2);
const curve = axes.plot(J, { xRange: [-2, 6], color: BLUE, strokeWidth: 3 });
scene.add(curve);
await scene.play(new Create(curve));
const lr = Math.max(0.05, Math.min(0.6, params.lr));
let th = 5.2;
const traj = [];
for (let i = 0; i < 12; i++) {
  traj.push(axes.c2p(th, J(th)));
  th = th - lr * dJ(th);
}
traj.push(axes.c2p(th, J(th)));
const dots = traj.map((pt, i) => new Dot({ point: pt, radius: 0.11, color: (i === 0 ? GOLD : BLUE_C) }));
scene.add(...dots);
await scene.play(new LaggedStartMap(FadeIn, dots, { lagRatio: 0.15 }));
const eq = new MathTexImage({ renderer: "katex", latex: "\\\\theta_{t+1}=\\\\theta_t-\\\\eta\\\\,\\\\nabla J", fontSize: 27, color: BLUE });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const note = new Text({ text: "η = " + lr.toFixed(2) + " :点在曲线上逐步滚向谷底", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
await scene.play(new Indicate(dots[dots.length - 1], { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`,
  },

  // ================= 20. 68-95-99.7 法则(标准正态对称)=================
  {
    id: "stats-empirical-rule",
    source: "经典统计教学动画改写(68-95-99.7 经验法则,区间面积)",
    domain: "stats",
    category: "概率分布",
    title: "68-95-99.7:正态分布的经验法则",
    intent: "正态分布中约 68% 的数据落在 μ±σ 内,95% 在 μ±2σ,99.7% 在 μ±3σ。用三条不同宽度的区间带把钟形曲线下面积分层上色,直观对应累积概率。",
    params: [{ name: "sigma", label: "σ(区间宽度)", min: 1, max: 3, step: 1, default: 1 }],
    sceneCode: `
const { scene, Axes, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, GOLD, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [-4, 4, 1], yRange: [0, 0.5, 0.1], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "68-95-99.7 经验法则", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));
const norm = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
const curve = axes.plot(norm, { xRange: [-4, 4], color: BLUE, strokeWidth: 3 });
scene.add(curve);
await scene.play(new Create(curve));
const s = Math.max(1, Math.min(3, Math.round(params.sigma)));
const area = axes.getArea(curve, [-s, s], { color: GOLD, opacity: 0.4 });
scene.add(area);
await scene.play(new FadeIn(area, { duration: 0.7 }));
const pct = s === 1 ? "68%" : s === 2 ? "95%" : "99.7%";
const eq = new MathTexImage({ renderer: "katex", latex: "\\\\mu\\\\pm " + s + "\\\\sigma\\\\;\\\\approx\\\\;" + pct, fontSize: 27, color: GOLD });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const note = new Text({ text: "μ ± " + s + "σ 覆盖约 " + pct + " 数据", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Write(note));
await scene.play(new Indicate(area, { color: GOLD, duration: 0.8 }));
await scene.wait(0.8);
`,
  },
];