// =============================================================================
// 金融教学 manim-web 模板库 —— 20 个可运行场景(注入 scene ctx 风格)
//
// 题材覆盖:理财 / 投资 / 风险管理 / 随机过程。
// 铁律遵守:解构行含所有标识符 · 纯 JS · MathTexImage 公式(await waitForRender)·
//   Text 带 SimSun fontFamily · 禁数组算术 · 相对定位(nextTo/c2p/arrange)·
//   对象进场景 · 不 NaN/不重叠/不越界。
// 曲线一律用 Axes.plot + c2p 标注点,蒙特卡洛用多曲线 + 手工 Legend。
// =============================================================================
import type { WebExample } from "../webExamples";

export const FINANCE_WEB_EXAMPLES: WebExample[] = [
  // ================= 1. 复利 vs 单利 =================
  {
    id: "finance-compound-vs-simple",
    source: "金融教学示例改写(复利利滚利 vs 单利,银行定存经典对比)",
    domain: "finance",
    category: "理财",
    title: "复利 vs 单利:利滚利的加速曲线",
    intent: "本金随时间按两种计息方式增长:单利线性增长,复利指数增长。让学生直观看到时间越长复利越拉开差距,'利滚利'的加速效应。",
    params: [{ name: "years", label: "年数", min: 5, max: 30, step: 1, default: 15 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GOLD, GRAY, RED, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 30, 5], yRange: [0, 8, 2], xLength: 8, yLength: 4.6, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "复利 vs 单利:利滚利加速增长", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const P = 1, r = 0.10;
const simple = (t) => P * (1 + r * t);
const compound = (t) => P * Math.pow(1 + r, t);
const lineSimple = axes.plot(simple, { xRange: [0, 30], color: GOLD, strokeWidth: 3 });
const lineCompound = axes.plot(compound, { xRange: [0, 30], color: BLUE_C, strokeWidth: 3 });
scene.add(lineSimple, lineCompound);
await scene.play(new Create(lineSimple));
await scene.play(new Create(lineCompound, { duration: 1.2 }));

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{单利: }P(1+rt) \\qquad \\text{复利: }P(1+r)^t", fontSize: 27, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const tY = params.years;
const dY = Math.max(6, Math.min(30, tY));
const pSimple = simple(dY);
const pComp = compound(dY);
const dotS = new Dot({ point: axes.c2p(dY, pSimple), radius: 0.09, color: GOLD });
const dotC = new Dot({ point: axes.c2p(dY, pComp), radius: 0.09, color: BLUE_C });
scene.add(dotS, dotC);
await scene.play(new FadeIn(dotS), new FadeIn(dotC));

const gap = new Line({ start: axes.c2p(dY, pSimple), end: axes.c2p(dY, pComp), color: RED, strokeWidth: 2, dashArray: [0.15, 0.12] });
gap.addUpdater((ln) => { ln.become(new Line({ start: axes.c2p(dY, pSimple), end: axes.c2p(dY, pComp), color: RED, strokeWidth: 2, dashArray: [0.15, 0.12] })); });
scene.add(gap);
const note = new Text({ text: "t = " + dY + " 年:复利已大幅拉开差距", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Indicate(dotC, { color: BLUE_C, duration: 0.8 }));
await scene.play(new Indicate(dotS, { color: GOLD, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 2. 有效年利率 EAR =================
  {
    id: "finance-ear",
    source: "金融教学示例改写(名义利率 vs 有效年利率,复利频率效应)",
    domain: "finance",
    category: "理财",
    title: "有效年利率 EAR:复利频率越高年化越高",
    intent: "名义利率相同,一年内复利次数 n 越多,有效年利率越高。曲线刻画 EAR 随复利频率趋近连续复利,揭示'谁在说广告利率'的陷阱。",
    params: [{ name: "nomRate", label: "名义利率", min: 0.02, max: 0.2, step: 0.01, default: 0.12 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 12, 2], yRange: [0, 1.0, 0.25], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "有效年利率 EAR:复利频率的影响", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const r = params.nomRate;
const EAR = (n) => Math.pow(1 + r / n, n) - 1;
const line = axes.plot(EAR, { xRange: [0.2, 12], color: BLUE_C, strokeWidth: 3 });
scene.add(line);
await scene.play(new Create(line, { duration: 1.2 }));

const eq = new MathTexImage({ renderer: "katex", latex: "EAR=\\left(1+\\frac{r}{n}\\right)^{n}-1", fontSize: 27, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const cap = new Text({ text: "n 越大(复利越频繁),EAR 越高、趋近连续复利", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.15);
scene.add(cap);
await scene.play(new Write(cap));

const dN = 4;
const dot = new Dot({ point: axes.c2p(dN, EAR(dN)), radius: 0.09, color: BLUE_D });
scene.add(dot);
await scene.play(new FadeIn(dot, { duration: 0.5 }));
const lab = new Text({ text: "n=4 季复利", fontSize: 20, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
lab.nextTo(dot, DOWN, 0.12).shift([-0.1, 0, 0]);
scene.add(lab);
await scene.play(new FadeIn(lab, { duration: 0.4 }));
const vCap = new Text({ text: "EAR = " + (EAR(dN) * 100).toFixed(2) + "%(名义 " + (r * 100).toFixed(0) + "%)", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
vCap.nextTo(dot, UP, 0.12);
scene.add(vCap);
await scene.play(new Write(vCap));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 3. 现值 / 折现 =================
  {
    id: "finance-present-value",
    source: "金融教学示例改写(折现现金流,现值 = 未来值打折)",
    domain: "finance",
    category: "投资",
    title: "现值 PV:未来的钱要打折",
    intent: "同一笔未来现金流,距离现在越远、折现率越高,其现值越低。用衰减曲线展示货币的时间价值——明天的 100 元不如今天的 100 元。",
    params: [{ name: "discRate", label: "折现率", min: 0.02, max: 0.2, step: 0.01, default: 0.10 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, BLUE_E, GOLD, WHITE, UP, DOWN, LEFT, params } = ctx;
const axes = new Axes({ xRange: [0, 30, 5], yRange: [0, 1.1, 0.25], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "现值 PV:未来的钱随时间衰减", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const rate = params.discRate;
const pv = (t) => Math.pow(1 + rate, -t);
const line = axes.plot(pv, { xRange: [0, 30], color: BLUE_C, strokeWidth: 3 });
scene.add(line);
await scene.play(new Create(line, { duration: 1.2 }));

const eq = new MathTexImage({ renderer: "katex", latex: "PV = \\frac{FV}{(1+r)^t}", fontSize: 28, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const tA = 0, tB = 5, tC = 20;
const dA = new Dot({ point: axes.c2p(tA, pv(tA)), radius: 0.09, color: GOLD });
const dB = new Dot({ point: axes.c2p(tB, pv(tB)), radius: 0.09, color: BLUE_D });
const dC = new Dot({ point: axes.c2p(tC, pv(tC)), radius: 0.09, color: BLUE_E });
scene.add(dA, dB, dC);
await scene.play(new FadeIn(dA), new FadeIn(dB), new FadeIn(dC));

const lab0 = new Text({ text: "今天 1 元(PV=1)", fontSize: 20, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
lab0.nextTo(dA, LEFT, 0.1).shift([0.05, 0, 0]);
const labB = new Text({ text: "5 年后(" + (pv(tB) * 100).toFixed(0) + "分)", fontSize: 20, color: BLUE_D, fontFamily: '"Times New Roman","SimSun",serif' });
labB.nextTo(dB, UP, 0.1);
const labC = new Text({ text: "20 年后(" + (pv(tC) * 100).toFixed(0) + "分)", fontSize: 20, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
labC.nextTo(dC, DOWN, 0.12).shift([0.2, 0, 0]);
scene.add(lab0, labB, labC);
await scene.play(new FadeIn(lab0), new FadeIn(labB), new FadeIn(labC));

const note = new Text({ text: "同样 1 元,越晚拿到越不值钱(贴现值越低)", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new Indicate(eq, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 4. 终值与现值公式化 =================
  {
    id: "finance-fv-pv-flow",
    source: "金融教学示例改写(终值/现值公式对照,资金时间价值基础式)",
    domain: "finance",
    category: "理财",
    title: "终值 FV 与现值 PV:一枚硬币的两面",
    intent: "一个式子同时表达'钱按 r 增长到未来值'与'未来钱按 r 折回现值'。通过 FV = PV(1+r)^t 的本质,理解复利正反两向。",
    params: [{ name: "t", label: "年限 t", min: 1, max: 15, step: 0.5, default: 5 }],
    sceneCode: `
const { scene, Text, MathTexImage, VGroup, Write, FadeIn, Indicate, AnimationGroup, BLUE, BLUE_C, BLUE_D, GOLD, WHITE, UP, DOWN, LEFT, RIGHT, Arrow, params } = ctx;
const title = new Text({ text: "资金时间价值:FV = 现值,PV = 终值", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const eqMain = new MathTexImage({ renderer: "katex", latex: "FV = PV\\,(1+r)^t", fontSize: 32, color: BLUE_C });
await eqMain.waitForRender();
eqMain.nextTo(title, DOWN, 0.5);
scene.add(eqMain);
await scene.play(new Write(eqMain, { duration: 0.8 }));

const arrow = new Arrow({ start: [eqMain.getCenter()[0] - 0.1, eqMain.getCenter()[1] + 0.0, 0], end: [eqMain.getCenter()[0] - 0.1, eqMain.getCenter()[1] + 0.6, 0], color: GOLD, strokeWidth: 2.5 });
scene.add(arrow);
await scene.play(new FadeIn(arrow, { duration: 0.5 }));

const t = params.t;
const r = 0.08;
const pvVal = 1000;
const fvVal = pvVal * Math.pow(1 + r, t);
const boxP = new Text({ text: "PV = " + pvVal + " 元(现值)", fontSize: 24, color: BLUE_D, fontFamily: '"Times New Roman","SimSun",serif' });
boxP.nextTo(eqMain, LEFT, 0.8).shift([0, 0.4, 0]);
const boxF = new Text({ text: "FV = " + fvVal.toFixed(0) + " 元(" + t + " 年后)", fontSize: 24, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
boxF.nextTo(eqMain, RIGHT, 0.8).shift([0, 0.4, 0]);
scene.add(boxP, boxF);
await scene.play(new FadeIn(boxP), new FadeIn(boxF));

const eq2 = new MathTexImage({ renderer: "katex", latex: "PV = \\frac{FV}{(1+r)^t}", fontSize: 28, color: BLUE_C });
await eq2.waitForRender();
eq2.toEdge(DOWN, 0.35);
scene.add(eq2);
await scene.play(new Write(eq2, { duration: 0.8 }));

const note = new Text({ text: "r@8%,t=" + t + " :1000 元 今天 与 " + fvVal.toFixed(0) + " 元" + t + " 年后价值相同", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq2, DOWN, 0.15);
scene.add(note);
await scene.play(new FadeIn(note, { duration: 0.6 }));
await scene.play(new Indicate(eqMain, { color: GOLD, duration: 0.9 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 5. 年化收益率 =================
  {
    id: "finance-annualized-return",
    source: "金融教学示例改写(持有期收益 vs 年化收益,时间归一化对比)",
    domain: "finance",
    category: "投资",
    title: "年化收益率:把不同期限拉平比较",
    intent: "6 个月赚 50% 和 2 年赚 50% 不能直接比。年化收益率把任何持有期收益折算成'一年能赚多少',用几何平均(非简单平均)计算。",
    params: [{ name: "years2", label: "持有年数", min: 0.5, max: 6, step: 0.5, default: 2 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GOLD, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 6, 1], yRange: [0, 2.0, 0.5], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "年化收益率:总收益按年折算", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const total = 0.5; // 总收益 50%
const annual = (t) => Math.pow(1 + total, 1 / t) - 1;
const line = axes.plot(annual, { xRange: [0.4, 6], color: BLUE_C, strokeWidth: 3 });
scene.add(line);
await scene.play(new Create(line, { duration: 1.1 }));

const eq = new MathTexImage({ renderer: "katex", latex: "r_{ann} = (1+R_{tot})^{\\frac{1}{t}}-1", fontSize: 27, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const t = Math.max(0.5, params.years2);
const dot = new Dot({ point: axes.c2p(t, annual(t)), radius: 0.09, color: GOLD });
scene.add(dot);
await scene.play(new FadeIn(dot, { duration: 0.5 }));
const lab = new Text({ text: "t=" + t + " 年 → 年化 " + (annual(t) * 100).toFixed(1) + "%", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
lab.nextTo(dot, UP, 0.12).shift([0.1, 0.05, 0]);
scene.add(lab);
await scene.play(new Write(lab));
const note = new Text({ text: "持有越久,同样的总收益拆到每年的年化越低", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.12);
scene.add(note);
await scene.play(new Indicate(eq, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 6. CAGR 复合年均增长率 =================
  {
    id: "finance-cagr",
    source: "金融教学示例改写(复合年均增长率:几何平均不简单平均)",
    domain: "finance",
    category: "投资",
    title: "复合年均增长率 CAGR",
    intent: "一笔钱从起点涨到终点,CAGR 是'若每年匀速复利增长'的那个等效应年化率。关键:是几何平均,不是把各年增长率简单平均。",
    params: [{ name: "start", label: "初始投资(千元)", min: 1, max: 10, step: 1, default: 5 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GOLD, WHITE, UP, DOWN, LEFT, RIGHT, params } = ctx;
const axes = new Axes({ xRange: [0, 10, 2], yRange: [0, 12, 2], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "复合年均增长率 CAGR(几何平均)", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const s0 = params.start;
const sT = 10;
const n = 10;
const cagr = Math.pow(sT / s0, 1 / n) - 1;
const cagrLine = axes.plot((t) => s0 * Math.pow(1 + cagr, t), { xRange: [0, 10], color: BLUE_C, strokeWidth: 3 });
scene.add(cagrLine);
await scene.play(new Create(cagrLine, { duration: 1.2 }));

const eq = new MathTexImage({ renderer: "katex", latex: "CAGR=(\\tfrac{FV}{PV})^{\\frac{1}{n}}-1", fontSize: 28, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const d0 = new Dot({ point: axes.c2p(0, s0), radius: 0.1, color: GOLD });
const dT = new Dot({ point: axes.c2p(n, sT), radius: 0.1, color: BLUE_D });
scene.add(d0, dT);
await scene.play(new FadeIn(d0), new FadeIn(dT));
const l0 = new Text({ text: "起点 " + s0 + ",000", fontSize: 20, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
l0.nextTo(d0, LEFT, 0.1).shift([0.1, 0, 0]);
const lT = new Text({ text: "10 年 → " + sT + ",000", fontSize: 20, color: BLUE_D, fontFamily: '"Times New Roman","SimSun",serif' });
lT.nextTo(dT, RIGHT, 0.1).shift([-0.1, 0, 0]);
scene.add(l0, lT);
await scene.play(new FadeIn(l0), new FadeIn(lT));
const cap = new Text({ text: "CAGR = " + (cagr * 100).toFixed(1) + "%/年:" + s0 + "000 → " + sT + "000(10 年)", fontSize: 23, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.15);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(cagrLine, { color: BLUE_C, duration: 0.9 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 7. 最大回撤 drawdown =================
  {
    id: "finance-max-drawdown",
    source: "金融教学示例改写(净值曲线 + 峰值河谷,最大回撤定义)",
    domain: "finance",
    category: "风险管理",
    title: "最大回撤 max drawdown:从峰值跌到谷底",
    intent: "净值曲线上找出从历史最高点(峰值)跌到随后的最低点(谷底)的最大跌幅。用走低的净值曲线+峰值谷底线+回撤区间高亮,让学生看懂'最大回撤'其实是最大潜在亏损。",
    params: [{ name: "vol", label: "波动强度", min: 0.2, max: 1.5, step: 0.05, default: 0.8 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GOLD, RED, GRAY, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 40, 5], yRange: [0, 1.8, 0.5], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "最大回撤:从峰值到谷底的最大跌幅", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const vol = params.vol;
// 确定性净值路径:先升到历史峰值,再回撤到谷底,最后部分修复(vol 只加小幅波动)
const navFn = (t) => 1 + 0.68 * (1 - Math.exp(-t / 7)) * (1 - 0.55 * Math.exp(-((t - 24) * (t - 24)) / 130)) + 0.03 * vol * Math.sin(t * 1.4);
let peakVal = 0, maxDD = 0, peakAt = 0, troughAt = 0, pk = 1, pv = 1;
for (let i = 0; i <= 400; i++) {
  const ti = i / 10;
  const v = navFn(ti);
  if (v > peakVal) { peakVal = v; peakAt = ti; pk = v; }
  const dd = (v - peakVal) / peakVal;
  if (dd < maxDD) { maxDD = dd; troughAt = ti; pv = v; }
}
const nav = axes.plot(navFn, { xRange: [0, 40], color: BLUE_C, strokeWidth: 3 });
scene.add(nav);
await scene.play(new Create(nav, { duration: 1.6 }));
const eq = new MathTexImage({ renderer: "katex", latex: "DD_t = \\frac{NAV_t - \\text{Peak}_t}{\\text{Peak}_t}", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const dPeak = new Dot({ point: axes.c2p(peakAt, pk), radius: 0.1, color: GOLD });
const dTrough = new Dot({ point: axes.c2p(troughAt, pv), radius: 0.1, color: RED });
scene.add(dPeak, dTrough);
await scene.play(new FadeIn(dPeak), new FadeIn(dTrough));
const lPeak = new Text({ text: "峰值", fontSize: 22, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
lPeak.nextTo(dPeak, UP, 0.1).shift([-0.05, 0, 0]);
const lTrough = new Text({ text: "谷底", fontSize: 22, color: RED, fontFamily: '"Times New Roman","SimSun",serif' });
lTrough.nextTo(dTrough, DOWN, 0.1);
scene.add(lPeak, lTrough);
await scene.play(new FadeIn(lPeak), new FadeIn(lTrough));
const cap = new Text({ text: "最大回撤 = " + (maxDD * 100).toFixed(1) + "%(峰值之后最大跌幅)", fontSize: 23, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.12);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(dPeak, { color: GOLD, duration: 0.8 }), new Indicate(dTrough, { color: RED, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 8. 夏普比率 =================
  {
    id: "finance-sharpe-ratio",
    source: "金融教学示例改写(风险调整收益:每单位风险换多少超额收益)",
    domain: "finance",
    category: "风险管理",
    title: "夏普比率:每承担一单位风险赚多少",
    intent: "只比收益不公平——高收益可能伴高风险。夏普比率 = (收益 - 无风险利率) / 波动率,衡量每单位波动换取多少超额回报。标注风险与收益两轴。",
    params: [{ name: "rf", label: "无风险利率", min: 0.0, max: 0.05, step: 0.005, default: 0.02 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GOLD, GRAY, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 0.3, 0.05], yRange: [0, 0.25, 0.05], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "夏普比率:风险调整后收益", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const rf = params.rf;
const asset1 = { vol: 0.15, ret: 0.18 };
const asset2 = { vol: 0.05, ret: 0.05 };
const sharpe = (vol, ret) => (ret - rf) / vol;
const line = new Line({ start: axes.c2p(0, rf), end: axes.c2p(0.30, rf + sharpe(asset1.vol, asset1.ret) * 0.30), color: BLUE_D, strokeWidth: 3 });
scene.add(line);
await scene.play(new Create(line, { duration: 1.2 }));

const eq = new MathTexImage({ renderer: "katex", latex: "S = \\frac{R_p - R_f}{\\sigma_p}", fontSize: 28, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const d1 = new Dot({ point: axes.c2p(asset1.vol, asset1.ret), radius: 0.1, color: GOLD });
const d2 = new Dot({ point: axes.c2p(asset2.vol, asset2.ret), radius: 0.1, color: BLUE_C });
scene.add(d1, d2);
await scene.play(new FadeIn(d1), new FadeIn(d2));
const l1 = new Text({ text: "高波动 18%", fontSize: 20, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
l1.nextTo(d1, UP, 0.12);
const l2 = new Text({ text: "低波动 5%", fontSize: 20, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
l2.nextTo(d2, DOWN, 0.12).shift([0, -0.05, 0]);
scene.add(l1, l2);
await scene.play(new FadeIn(l1), new FadeIn(l2));
const cap = new Text({ text: "斜率 = 夏普。低波动资产夏普 " + sharpe(asset2.vol, asset2.ret).toFixed(1) + " 反而更高", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.12);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(line, { color: BLUE_D, duration: 0.9 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 9. 波动率 volatility =================
  {
    id: "finance-volatility",
    source: "金融教学示例改写(收益率散布大小 = 波动率,标准差刻画风险)",
    domain: "finance",
    category: "风险管理",
    title: "波动率:收益的散布程度",
    intent: "两只资产平均收益相近,但价格路径一条平稳一条剧烈震荡。波动率(标准差)衡量围绕均值的散布:波动越大,路径越陡峭、风险越高。",
    params: [{ name: "vol2", label: "波动率 σ", min: 0.05, max: 0.5, step: 0.01, default: 0.2 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GOLD, GRAY, WHITE, UP, DOWN, RIGHT, params } = ctx;
const axes = new Axes({ xRange: [0, 60, 10], yRange: [-0.4, 0.4, 0.2], xLength: 8, yLength: 4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "波动率:收益率的散布程度(标准差)", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const sigma = params.vol2;
const mean = 0.0;
const gen = (seed) => (x) => {
  const t = (x + seed) % 1.0;
  return mean + sigma * Math.sin(t * Math.PI * 2 * 3) * 0.6 * (1 / (1 + t * t * 0.02));
};
const lineCalm = axes.plot((x) => mean + 0.05 * Math.sin(x * 0.4), { xRange: [0, 60], color: BLUE_D, strokeWidth: 2.5 });
const lineWild = axes.plot((x) => mean + sigma * Math.sin(x * 0.6) + sigma * 0.5 * Math.sin(x * 1.7), { xRange: [0, 60], color: BLUE_C, strokeWidth: 3 });
scene.add(lineCalm, lineWild);
await scene.play(new Create(lineCalm, { duration: 1 }), new Create(lineWild, { duration: 1.4 }));

const eq = new MathTexImage({ renderer: "katex", latex: "\\sigma = \\sqrt{\\frac{1}{N}\\sum (r_i - \\bar{r})^2}", fontSize: 27, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const cap1 = new Text({ text: "低波动(平稳)", fontSize: 20, color: BLUE_D, fontFamily: '"Times New Roman","SimSun",serif' });
cap1.toEdge(UP).shift([1.5, -0.6, 0]);
const cap2 = new Text({ text: "高波动(剧烈震荡)", fontSize: 20, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
cap2.nextTo(cap1, RIGHT, 0.6);
scene.add(cap1, cap2);
await scene.play(new FadeIn(cap1), new FadeIn(cap2));
const note = new Text({ text: "σ 大 → 路径起伏大 → 风险高", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.12);
scene.add(note);
await scene.play(new Indicate(lineWild, { color: BLUE_C, duration: 0.9 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 10. 蒙特卡洛模拟 =================
  {
    id: "finance-monte-carlo",
    source: "金融教学示例改写(随机游走多路径 → 终端分布,蒙特卡洛法)",
    domain: "finance",
    category: "随机过程",
    title: "蒙特卡洛模拟:多路径随机游走",
    intent: "未来价格高度不确定,蒙特卡洛生成上千条可能的随机路径,看到它们围绕期望漂移展开。展示'模拟仿真'如何量化不确定性的分布。",
    params: [{ name: "nPaths", label: "路径数", min: 3, max: 20, step: 1, default: 6 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, Create, Write, FadeIn, Indicate, LaggedStartMap, BLUE, BLUE_C, BLUE_D, GOLD, GRAY, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 50, 10], yRange: [0.6, 1.5, 0.2], xLength: 8, yLength: 4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "蒙特卡洛模拟:上千条可能的未来路径", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const sigma = 0.12, mu = 0.05;
const nP = Math.max(2, Math.round(params.nPaths));
const scheme = (seed) => (x) => {
  if (x <= 0) return 1;
  let v = 1;
  for (let k = 1; k <= x; k++) {
    const step = (Math.sin(k * 12.9898 + seed * 78.233) * 43758.5453) % 1.0;
    const z = (step * 2 - 1);
    v = v * (1 + mu / 50 + sigma * z * 0.55);
  }
  return v;
};
const lines = [];
for (let s = 0; s < nP; s++) {
  const ln = axes.plot(scheme(s + 1), { xRange: [0, 50], color: s === 0 ? BLUE_D : (s % 2 ? BLUE_C : BLUE), strokeWidth: 2 });
  lines.push(ln);
}
scene.add(...lines);
await scene.play(new LaggedStartMap(Create, lines, { lagRatio: 0.06 }));

const expectLine = axes.plot((x) => Math.exp(mu), { xRange: [0, 50], color: GOLD, strokeWidth: 3 });
scene.add(expectLine);
await scene.play(new Create(expectLine, { duration: 0.8 }));

const eq = new MathTexImage({ renderer: "katex", latex: "S_{t+1}=S_t\\,e^{(\\mu-\\frac{\\sigma^2}{2})\\Delta t+\\sigma\\epsilon\\sqrt{\\Delta t}}", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const cap = new Text({ text: "金线 = 期望路径;灰蓝 = 单次随机模拟", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.12);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(expectLine, { color: GOLD, duration: 0.9 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 11. 资产配置 / 分散化 =================
  {
    id: "finance-diversification",
    source: "金融教学示例改写(分散化降低风险,组合波动 < 单一资产)",
    domain: "finance",
    category: "投资",
    title: "分散化:组合波动低于任一成份",
    intent: "把资金拆到多个不完全相关的资产上,总波动(风险)会下降。用'两资产按权重混合、组合标准差随权重变化'的曲线,展示分散化降险。",
    params: [{ name: "w1", label: "资产 A 权重 w1", min: 0, max: 1, step: 0.05, default: 0.5 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GOLD, GRAY, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 1, 0.2], yRange: [0, 0.3, 0.05], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "分散化:权重混合如何降波动", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const sA = 0.28, sB = 0.16, rho = 0.0;
const port = (w) => Math.sqrt(w * w * sA * sA + (1 - w) * (1 - w) * sB * sB + 2 * w * (1 - w) * sA * sB * rho);
const line = axes.plot(port, { xRange: [0, 1], color: BLUE_C, strokeWidth: 3 });
scene.add(line);
await scene.play(new Create(line, { duration: 1.2 }));
const eq = new MathTexImage({ renderer: "katex", latex: "\\sigma_p=\\sqrt{w^2\\sigma_A^2+(1-w)^2\\sigma_B^2+2w(1-w)\\rho\\,\\sigma_A\\sigma_B}", fontSize: 22, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.3);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const w = params.w1;
const dot = new Dot({ point: axes.c2p(w, port(w)), radius: 0.1, color: GOLD });
scene.add(dot);
await scene.play(new FadeIn(dot, { duration: 0.5 }));
const lab = new Text({ text: "w1=" + w + " → σp=" + (port(w) * 100).toFixed(1) + "%", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
lab.nextTo(dot, UP, 0.12).shift([0.1, 0, 0]);
scene.add(lab);
await scene.play(new Write(lab));
const cap = new Text({ text: "组合波动可低于两个单独资产的波动(不相关时最明显)", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.12);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(line, { color: BLUE_C, duration: 0.9 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 12. 均值-方差 =================
  {
    id: "finance-mean-variance",
    source: "金融教学示例改写(有效前沿由最优历史稳定组合连成,语文均方差权衡)",
    domain: "finance",
    category: "投资",
    title: "均值-方差:风险与收益的权衡",
    intent: "资产分布在(风险,收益)平面上。理性投资者在同风险下选更高收益、同收益下选更低风险的组合,连成的上沿叫有效前沿。",
    params: [{ name: "spread", label: "资产分散度", min: 0.3, max: 1.2, step: 0.05, default: 0.8 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, Create, Write, FadeIn, Indicate, LaggedStartMap, AnimationGroup, BLUE, BLUE_C, BLUE_D, GOLD, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 0.3, 0.05], yRange: [0, 0.3, 0.05], xLength: 8, yLength: 5, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "均值-方差:风险-收益权衡", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const k = params.spread;
const pts = [[0.05, 0.05], [0.10, 0.09], [0.12, 0.14], [0.16, 0.16], [0.20, 0.21], [0.24, 0.25]].map((p) => [p[0] * k, Math.min(0.28, p[1] * k * 1.1)]);
const dots = pts.map((p) => new Dot({ point: axes.c2p(p[0], p[1]), radius: 0.07, color: BLUE_C }));
scene.add(...dots);
await scene.play(new LaggedStartMap(FadeIn, dots, { lagRatio: 0.1 }));

const frontier = axes.plot((x) => 0.06 + 0.9 * x, { xRange: [0, 0.27], color: GOLD, strokeWidth: 3 });
scene.add(frontier);
await scene.play(new Create(frontier, { duration: 0.8 }));

const eq = new MathTexImage({ renderer: "katex", latex: "\\min_{\\mathbf{w}}\\ \\tfrac{1}{2}\\mathbf{w}^T\\Sigma\\mathbf{w}\\ \\ s.t.\\ \\mathbf{w}^T\\mathbf{r}=R", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const cap = new Text({ text: "金线 = 有效前沿:同风险下收益最优的资产组合", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.12);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(frontier, { color: GOLD, duration: 0.9 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 13. 无风险利率与夏普(资本配置线) =================
  {
    id: "finance-rf-capital-allocation",
    source: "金融教学示例改写(无风险资产与风险资产的组合 = 资本配置线)",
    domain: "finance",
    category: "投资",
    title: "无风险利率与资本配置线",
    intent: "把资金分给无风险资产(如国债)与风险组合,可得收益随风险线性上升——从 (0, Rf) 出发的直线。无风险利率越高,资本配置线起点越高。",
    params: [{ name: "rf3", label: "无风险利率 Rf", min: 0.0, max: 0.06, step: 0.01, default: 0.03 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GOLD, GRAY, WHITE, UP, DOWN, LEFT, params } = ctx;
const axes = new Axes({ xRange: [0, 0.3, 0.05], yRange: [0, 0.3, 0.05], xLength: 8, yLength: 5, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "资本配置线:无风险 + 风险组合", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const rf = params.rf3;
const riskP = { vol: 0.20, ret: 0.16 };
const calLine = new Line({ start: axes.c2p(0, rf), end: axes.c2p(riskP.vol, riskP.ret), color: BLUE_C, strokeWidth: 3 });
scene.add(calLine);
await scene.play(new Create(calLine, { duration: 1.2 }));

const dRf = new Dot({ point: axes.c2p(0, rf), radius: 0.1, color: GOLD });
const dRisk = new Dot({ point: axes.c2p(riskP.vol, riskP.ret), radius: 0.1, color: BLUE_D });
scene.add(dRf, dRisk);
await scene.play(new FadeIn(dRf), new FadeIn(dRisk));
const lRf = new Text({ text: "无风险资产 (" + (rf * 100).toFixed(0) + "%)", fontSize: 20, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
lRf.nextTo(dRf, LEFT, 0.1).shift([0.15, 0, 0]);
const lRisk = new Text({ text: "风险组合 (16%)", fontSize: 20, color: BLUE_D, fontFamily: '"Times New Roman","SimSun",serif' });
lRisk.nextTo(dRisk, UP, 0.1).shift([0, 0, 0]);
scene.add(lRf, lRisk);
await scene.play(new FadeIn(lRf), new FadeIn(lRisk));

const eq = new MathTexImage({ renderer: "katex", latex: "R_p = R_f + y\\,(R_{risky}-R_f)", fontSize: 27, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const cap = new Text({ text: "斜线 y 份配风险资产,y 越大收益越高、风险也越高", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.12);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(dRf, { color: GOLD, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 14. 债券久期 =================
  {
    id: "finance-bond-duration",
    source: "金融教学示例改写(久期 = 加权平均回款时间,价格对利率敏感度)",
    domain: "finance",
    category: "风险管理",
    title: "债券久期:回款时间的加权平均",
    intent: "债券现金流分摊在多个未来时刻,久期是把它们按现值加权后的'平均回款时间'(年)。久期越长,价格对利率越敏感。曲线展示价格随利率下降而上升。",
    params: [{ name: "coupon", label: "票息率", min: 0.0, max: 0.10, step: 0.01, default: 0.05 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, Create, Write, FadeIn, Indicate, LaggedStartMap, BarChart, BLUE, BLUE_C, BLUE_D, GOLD, WHITE, UP, LEFT, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 10, 2], yRange: [0, 1.6, 0.4], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "债券久期:现金流按现值加权平均回款时间", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const r = 0.04, face = 1, T = 6, coupon = params.coupon;
const cashflows = [];
let pvSum = 0, weightedSum = 0;
for (let t = 1; t <= T; t++) {
  const cf = (t === T ? face + coupon : coupon);
  const pv = cf / Math.pow(1 + r, t);
  cashflows.push(pv);
  pvSum += pv;
  weightedSum += t * pv;
}
const duration = weightedSum / pvSum;
const barData = cashflows.map((pv) => pv / Math.max(pvSum, 1e-6));
const bars = [];
for (let i = 0; i < T; i++) {
  const x0 = i + 1;
  const hgt = barData[i];
  const p1 = axes.c2p(x0 - 0.25, 0);
  const p2 = axes.c2p(x0 + 0.25, 0);
  const bar = new Line({ start: [p1[0], p1[1], 0], end: [p1[0], p1[1] + hgt * 4.0, 0], color: BLUE_C, strokeWidth: 8 });
  scene.add(bar);
  bars.push(bar);
}
await scene.play(new LaggedStartMap(Create, bars, { lagRatio: 0.08 }));

const eq = new MathTexImage({ renderer: "katex", latex: "D = \\frac{\\sum t\\cdot PV(cf_t)}{\\sum PV(cf_t)}", fontSize: 27, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.4);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const cap = new Text({ text: "久期 ≈ " + duration.toFixed(2) + " 年:加权平均回款时间", fontSize: 23, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.12);
scene.add(cap);
await scene.play(new Write(cap));
const note = new Text({ text: "久期越长,利率变动对债券价格影响越大", fontSize: 21, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(cap, DOWN, 0.1);
scene.add(note);
await scene.play(new FadeIn(note, { duration: 0.6 }));
await scene.play(new Indicate(eq, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 15. 杠杆与爆仓风险 =================
  {
    id: "finance-leverage-liquidation",
    source: "金融教学示例改写(杠杆放大盈亏与强平线,爆仓原理)",
    domain: "finance",
    category: "风险管理",
    title: "杠杆放大盈亏:爆仓线在哪里",
    intent: "用杠杆买入,本金以小博大:上涨收益放大、下跌亏损也放大。当标的跌到某价位,保证金不足被强平(爆仓)。用净值曲线展示不同杠杆下的爆仓距离。",
    params: [{ name: "leverage", label: "杠杆倍数", min: 1, max: 10, step: 1, default: 5 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GOLD, RED, GRAY, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [-30, 30, 10], yRange: [-1.5, 1.5, 0.5], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "杠杆:放大盈亏,也放大爆仓风险", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const lev = Math.max(1, Math.round(params.leverage));
const zeroLine = new Line({ start: axes.c2p(-30, 0), end: axes.c2p(30, 0), color: GRAY, strokeWidth: 1.5 });
scene.add(zeroLine);
const retLine = axes.plot((x) => lev * (x / 100), { xRange: [-30, 30], color: BLUE_C, strokeWidth: 3 });
scene.add(retLine);
await scene.play(new Create(retLine, { duration: 1.2 }));
const liqX = -100 / lev;
const liqDot = new Dot({ point: axes.c2p(liqX, -1.0), radius: 0.1, color: RED });
scene.add(liqDot);
await scene.play(new FadeIn(liqDot, { duration: 0.5 }));

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{爆仓点:}\\;\\Delta S = -\\frac{100\\%}{L}\\;\\text{(保证金被跌穿)}", fontSize: 22, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.3);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.8 }));

const cap = new Text({ text: "L=" + lev + "×:标的跌 " + (100 / lev).toFixed(0) + "% 即爆仓(红线为强平点)", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.15);
scene.add(cap);
await scene.play(new Write(cap));
const lLiq = new Text({ text: "强平", fontSize: 20, color: RED, fontFamily: '"Times New Roman","SimSun",serif' });
lLiq.nextTo(liqDot, DOWN, 0.1).shift([-0.1, 0, 0]);
scene.add(lLiq);
await scene.play(new FadeIn(lLiq, { duration: 0.4 }));
await scene.play(new Indicate(liqDot, { color: RED, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 16. 复利 vs 指数衰减 =================
  {
    id: "finance-decay-vs-compound",
    source: "金融教学示例改写(指数增长 vs 指数衰减两大金融曲线)",
    domain: "finance",
    category: "理财",
    title: "指数增长与指数衰减:复利的另一面",
    intent: "复利是指数增长;但资产贬值的复利效应(如按年贬值)是指数衰减。一条上升一条下降,对照揭示'同样的指数律,方向相反'。",
    params: [{ name: "rateDecay", label: "衰减率", min: 0.03, max: 0.2, step: 0.01, default: 0.10 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GOLD, GRAY, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 20, 5], yRange: [0, 6, 1], xLength: 8, yLength: 4.2, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "指数增长 vs 指数衰减", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const g = 0.09, d = params.rateDecay;
const lineGrow = axes.plot((t) => Math.pow(1 + g, t), { xRange: [0, 20], color: BLUE_C, strokeWidth: 3 });
const lineDecay = axes.plot((t) => Math.pow(1 - d, t), { xRange: [0, 20], color: GOLD, strokeWidth: 3 });
scene.add(lineGrow, lineDecay);
await scene.play(new Create(lineGrow, { duration: 1.1 }), new Create(lineDecay, { duration: 1.1 }));

const eq = new MathTexImage({ renderer: "katex", latex: "A^+:(1+g)^t \\qquad A^-:(1-d)^t", fontSize: 28, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const cap1 = new Text({ text: "蓝:增值复利(g=" + (g * 100).toFixed(0) + "%)", fontSize: 20, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
cap1.toEdge(DOWN, 0.15).shift([0, 1.15, 0]);
const cap2 = new Text({ text: "金:贬值复利(d=" + (d * 100).toFixed(0) + "%),长期趋近 0 而非负", fontSize: 20, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
cap2.nextTo(cap1, DOWN, 0.15);
scene.add(cap1, cap2);
await scene.play(new FadeIn(cap1), new FadeIn(cap2));
const note = new Text({ text: "注:指数衰减永远不到 0(趋近 0)", fontSize: 21, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, DOWN, 0.15);
scene.add(note);
await scene.play(new FadeIn(note, { duration: 0.6 }));
await scene.play(new Indicate(lineDecay, { color: GOLD, duration: 0.9 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 17. 通胀 / 购买力 =================
  {
    id: "finance-inflation-purchasing",
    source: "金融教学示例改写(名义增长 vs 实际购买力,通胀侵蚀)",
    domain: "finance",
    category: "理财",
    title: "通胀与购买力:钱在悄悄贬值",
    intent: "名义金额增长不等于购买力增长。同样的钱随通胀每年购买力缩水,实际购买力按(1-通胀率)衰减。对照名义值与真实购买力,理解通胀税。",
    params: [{ name: "infl", label: "通胀率", min: 0.01, max: 0.15, step: 0.01, default: 0.05 }],
    sceneCode: `
const { scene, Axes, Dot, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GOLD, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 30, 5], yRange: [0, 2.0, 0.5], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "通胀侵蚀购买力", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const cpiG = 0.02, infl = params.infl;
const lineNom = axes.plot((t) => Math.pow(1 + cpiG, t), { xRange: [0, 30], color: BLUE_D, strokeWidth: 2.5 });
const linePurch = axes.plot((t) => Math.pow((1 + cpiG) / (1 + infl), t), { xRange: [0, 30], color: BLUE_C, strokeWidth: 3 });
scene.add(lineNom, linePurch);
await scene.play(new Create(lineNom, { duration: 1 }), new Create(linePurch, { duration: 1.4 }));

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{实际购买力} = \\left(\\frac{1+g}{1+i}\\right)^t", fontSize: 27, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const cap1 = new Text({ text: "蓝(浅):实际购买力,通胀 i=" + (infl * 100).toFixed(0) + "%", fontSize: 20, color: BLUE_C, fontFamily: '"Times New Roman","SimSun",serif' });
cap1.nextTo(eq, DOWN, 0.12);
const cap2 = new Text({ text: "深蓝:名义增长(账面),不等于购买力增长", fontSize: 20, color: BLUE_D, fontFamily: '"Times New Roman","SimSun",serif' });
cap2.nextTo(cap1, DOWN, 0.12);
scene.add(cap1, cap2);
await scene.play(new FadeIn(cap1), new FadeIn(cap2));
const note = new Text({ text: "i 越高,实际购买力衰减越陡", fontSize: 21, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(cap2, DOWN, 0.12);
scene.add(note);
await scene.play(new FadeIn(note, { duration: 0.4 }));
await scene.play(new Indicate(linePurch, { color: BLUE_C, duration: 0.9 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 18. 期望收益 =================
  {
    id: "finance-expected-return",
    source: "金融教学示例改写(概率加权平均:期望收益 vs 单一结果)",
    domain: "finance",
    category: "投资",
    title: "期望收益:概率加权的平均结果",
    intent: "投资有多种可能结果,每个带概率。期望收益 = Σ(结果 × 概率),不是最可能结果,而是长期重复的平均。用分布条+期望标注展示。",
    params: [{ name: "pWin", label: "盈利概率 p", min: 0.1, max: 0.9, step: 0.05, default: 0.6 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, Create, Write, FadeIn, Indicate, LaggedStartMap, BLUE, BLUE_C, BLUE_D, GOLD, GRAY, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 3, 0.5], yRange: [0, 1.1, 0.25], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "期望收益:结果 × 概率求和", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const p = params.pWin;
const winR = 0.5, loseR = -0.3;
const expRet = p * winR + (1 - p) * loseR;
const outcomes = [
  { label: "赢(+50%)", value: winR, prob: p, color: BLUE_C },
  { label: "输(-30%)", value: loseR, prob: 1 - p, color: BLUE_D },
];
const bars = [];
for (let i = 0; i < outcomes.length; i++) {
  const o = outcomes[i];
  const x0 = i === 0 ? 0.8 : 2.0;
  const p0 = axes.c2p(x0 - 0.25, 0);
  const p1 = axes.c2p(x0 + 0.25, 0);
  const barH = o.prob;
  const bar = new Line({ start: [p0[0], p0[1], 0], end: [p0[0], p0[1] + barH * 4.0, 0], color: o.color, strokeWidth: 26 });
  scene.add(bar);
  bars.push(bar);
  const lab = new Text({ text: o.label + " " + (o.value * 100).toFixed(0) + "% (p=" + o.prob.toFixed(2) + ")", fontSize: 18, color: o.color, fontFamily: '"Times New Roman","SimSun",serif' });
  lab.nextTo(bar, DOWN, 0.1);
  scene.add(lab);
}
await scene.play(new LaggedStartMap(Create, bars, { lagRatio: 0.15 }));

const eq = new MathTexImage({ renderer: "katex", latex: "E[R] = \\sum_i p_i\\, R_i", fontSize: 28, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));
const cap = new Text({ text: "E[R] = " + p.toFixed(2) + "×50% + " + (1 - p).toFixed(2) + "×(" + (loseR * 100).toFixed(0) + "%) = " + (expRet * 100).toFixed(1) + "%", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.12);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(eq, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 19. 期权到期收益(buy call) =================
  {
    id: "finance-option-call-payoff",
    source: "金融教学示例改写(buy call 到期损益:行权价、盈亏平衡点、最大亏损)",
    domain: "finance",
    category: "投资",
    title: "买入看涨期权到期损益",
    intent: "买 call 花权利金,到期时市值高于行权价才盈利。损益曲线在行权价下方是一条水平亏损线(最大亏损=权利金),上方 45°上升。行权价与盈亏平衡点清晰标注。",
    params: [{ name: "strike", label: "行权价 K", min: 80, max: 120, step: 5, default: 100 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GOLD, RED, GRAY, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [70, 130, 10], yRange: [-20, 30, 10], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "买入看涨期权到期损益(buy call)", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const K = params.strike, prem = 8;
const payoff = (S) => (S - K > 0 ? S - K - prem : -prem);
const line = axes.plot(payoff, { xRange: [70, 130], color: BLUE_C, strokeWidth: 3 });
scene.add(line);
await scene.play(new Create(line, { duration: 1.2 }));

const eq = new MathTexImage({ renderer: "katex", latex: "P(S)=\\max(S-K,\\,0)-\\text{premium}", fontSize: 27, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const kDot = new Dot({ point: axes.c2p(K, -prem), radius: 0.09, color: RED });
scene.add(kDot);
await scene.play(new FadeIn(kDot, { duration: 0.5 }));
const lK = new Text({ text: "行权价 K=" + K, fontSize: 20, color: RED, fontFamily: '"Times New Roman","SimSun",serif' });
lK.nextTo(kDot, DOWN, 0.1).shift([0, -0.08, 0]);
scene.add(lK);
await scene.play(new FadeIn(lK, { duration: 0.4 }));
const B = K + prem;
const bDot = new Dot({ point: axes.c2p(B, 0), radius: 0.09, color: GOLD });
scene.add(bDot);
await scene.play(new FadeIn(bDot, { duration: 0.5 }));
const lB = new Text({ text: "盈亏平衡 " + B, fontSize: 20, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
lB.nextTo(bDot, UP, 0.12).shift([0.1, 0, 0]);
scene.add(lB);
await scene.play(new FadeIn(lB, { duration: 0.4 }));

const cap = new Text({ text: "最大亏损 = 权利金(" + prem + "),上涨收益无上限", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.15);
scene.add(cap);
await scene.play(new Write(cap));
await scene.play(new Indicate(line, { color: BLUE_C, duration: 0.9 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 20. 汇率购买力平价 =================
  {
    id: "finance-ppp-exchange",
    source: "金融教学示例改写(购买力平价:通胀差决定长期汇率变动)",
    domain: "finance",
    category: "投资",
    title: "购买力平价 PPP:汇率与通胀差",
    intent: "长期看,两国货币汇率变动大致等于两国通胀率之差——高通胀国家货币相对贬值。用相对购买力曲线展示'通胀差 → 汇率的长期走势'。",
    params: [{ name: "inflDiff", label: "通胀差(外-内)", min: -0.05, max: 0.15, step: 0.01, default: 0.04 }],
    sceneCode: `
const { scene, Axes, Dot, Line, Text, MathTexImage, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, BLUE_D, GOLD, GRAY, WHITE, UP, DOWN, params } = ctx;
const axes = new Axes({ xRange: [0, 20, 5], yRange: [0.4, 1.7, 0.2], xLength: 8, yLength: 4.4, axisConfig: { color: "#2b3a52", strokeWidth: 2 } });
scene.add(axes);
const title = new Text({ text: "购买力平价:通胀差决定汇率", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const diff = params.inflDiff; // 外国通胀 - 本国通胀
const eRate = (t) => Math.pow(1 + diff, t);
const line = axes.plot(eRate, { xRange: [0, 20], color: BLUE_C, strokeWidth: 3 });
scene.add(line);
await scene.play(new Create(line, { duration: 1.2 }));

const eq = new MathTexImage({ renderer: "katex", latex: "\\frac{e_{t+1}}{e_t} = \\frac{1+\\pi_{\\text{外}}}{1+\\pi_{\\text{内}}}", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.nextTo(axes, DOWN, 0.35);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.7 }));

const d1 = new Dot({ point: axes.c2p(0, 1), radius: 0.09, color: GOLD });
scene.add(d1);
await scene.play(new FadeIn(d1, { duration: 0.4 }));
const l1 = new Text({ text: "初始汇率", fontSize: 20, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
l1.nextTo(d1, DOWN, 0.12).shift([0, -0.08, 0]);
scene.add(l1);
await scene.play(new FadeIn(l1, { duration: 0.4 }));

const cap = new Text({ text: diff >= 0 ? "外国通胀 +" + (diff * 100).toFixed(0) + "% > 本国 → 外币贬值(汇率上移)" : "外国通胀低 → 外币升值", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
cap.nextTo(eq, DOWN, 0.15);
scene.add(cap);
await scene.play(new Write(cap));
const note = new Text({ text: "高通胀国家货币长期贬值(购买力下降)", fontSize: 21, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(cap, DOWN, 0.12);
scene.add(note);
await scene.play(new FadeIn(note, { duration: 0.5 }));
await scene.play(new Indicate(line, { color: BLUE_C, duration: 0.9 }));
await scene.wait(0.8);
`.trim(),
  },
];