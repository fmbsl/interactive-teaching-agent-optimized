// =============================================================================
// 计算机科学教学 manim-web 模板库 —— 20 个可运行场景(注入 scene ctx 风格)
//
// 题材覆盖:排序 / 搜索 / 数据结构 / 递归 / 图论 / 分形 / 复杂度。
// 铁律遵守:解构行含所有标识符 · 纯 JS · MathTexImage 公式(await waitForRender)·
//   Text 带 SimSun fontFamily · 禁数组算术 · 相对定位(nextTo/toEdge/arrange)·
//   对象进场景 · 不 NaN/不重叠/不越界。
// 计算机图形技巧:矩形柱 / 圆形节点 / 箭头大量出现,用 VGroup 分组、按序触发动画,
//   避免一次性全堆造成重叠拥挤;用 Text 标注指针 / 索引 / 指针位置。
// =============================================================================
import type { WebExample } from "../webExamples";

export const COMPUTER_WEB_EXAMPLES: WebExample[] = [
  // ================= 1. 冒泡排序 =================
  {
    id: "computer-bubble-sort",
    source: "经典 CS 教学动画改写(冒泡排序相邻比较交换)",
    domain: "computer",
    category: "排序",
    title: "冒泡排序:相邻比较,大数上浮",
    intent: "相邻元素两两比较,若逆序则交换位置,一趟把最大数'冒泡'到末尾。反复多趟直到有序,凸显 O(n²) 的成对比较与交换过程。",
    params: [{ name: "speed", label: "动画速度", min: 0.5, max: 2, step: 0.1, default: 1 }],
    sceneCode: `
const { scene, Rectangle, Text, MathTexImage, VGroup, AnimationGroup, Indicate, Circumscribe, Write, FadeIn, BLUE_C, BLUE_E, GOLD, GREEN, WHITE, UP, DOWN, params } = ctx;
const title = new Text({ text: "冒泡排序:相邻比较,大数上浮", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const vals = [5, 2, 8, 1, 7, 3, 6, 4];
const n = vals.length;
const W = 0.62, gap = 0.14, baseY = -1.5, H = 0.22;
const bars = [];
const x0 = -((n - 1) * (W + gap)) / 2;
for (let i = 0; i < n; i++) {
  const h = vals[i] * H;
  const bar = new Rectangle({ width: W, height: h, color: BLUE_C, strokeWidth: 2, fillOpacity: 0.55 });
  const lab = new Text({ text: String(vals[i]), fontSize: 18, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
  bar.moveTo([x0 + i * (W + gap), baseY - 0.4 + h / 2, 0]);
  lab.moveTo([x0 + i * (W + gap), baseY - 0.4 - h / 2 - 0.25, 0]);
  const vg = new VGroup(bar, lab);
  scene.add(vg);
  bars.push({ vg, value: vals[i], x: x0 + i * (W + gap) });
}

const eq = new MathTexImage({ renderer: "katex", latex: "O(n^2)", fontSize: 28, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.6 }));

const sp = Math.max(0.5, params.speed);
for (let pass = 0; pass < n - 1; pass++) {
  for (let i = 0; i < n - 1 - pass; i++) {
    const a = bars[i], b = bars[i + 1];
    await scene.play(new Indicate(a.vg, { color: GOLD, duration: 0.25 / sp }));
    await scene.play(new Indicate(b.vg, { color: GOLD, duration: 0.25 / sp }));
    if (a.value > b.value) {
      const dx = (b.x - a.x) / 2;
      await scene.play(new AnimationGroup([
        a.vg.animate.shift([dx, 0, 0]),
        b.vg.animate.shift([-dx, 0, 0]),
      ], { duration: 0.5 / sp }));
      const tx = a.x; a.x = b.x; b.x = tx;
      const tv = a.value; a.value = b.value; b.value = tv;
    }
  }
  await scene.play(bars[n - 1 - pass].vg.animate.setColor(GREEN));
}
await scene.play(new Circumscribe(eq, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 2. 选择排序 =================
  {
    id: "computer-selection-sort",
    source: "经典 CS 教学动画改写(选择排序找最小逐个归位)",
    domain: "computer",
    category: "排序",
    title: "选择排序:每趟挑出最小者放到最前",
    intent: "每趟扫描未排序区,找出最小元素记录其位置,一趟结束与当前开头交换。突出'线性扫描 + 一次交换'的模式,与冒泡的'每次相邻交换'形成对比。",
    sceneCode: `
const { scene, Rectangle, Text, MathTexImage, VGroup, AnimationGroup, Indicate, Write, FadeIn, BLUE_C, BLUE_D, BLUE_E, GOLD, GREEN, WHITE, UP, DOWN } = ctx;
const title = new Text({ text: "选择排序:每趟挑出最小者放到最前", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const vals = [7, 2, 9, 1, 6, 4, 8, 3];
const n = vals.length;
const W = 0.62, gap = 0.14, baseY = -1.5, H = 0.22;
const bars = [];
const x0 = -((n - 1) * (W + gap)) / 2;
for (let i = 0; i < n; i++) {
  const h = vals[i] * H;
  const bar = new Rectangle({ width: W, height: h, color: BLUE_C, strokeWidth: 2, fillOpacity: 0.55 });
  const lab = new Text({ text: String(vals[i]), fontSize: 18, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
  bar.moveTo([x0 + i * (W + gap), baseY - 0.4 + h / 2, 0]);
  lab.moveTo([x0 + i * (W + gap), baseY - 0.4 - h / 2 - 0.25, 0]);
  const vg = new VGroup(bar, lab);
  scene.add(vg);
  bars.push({ vg, value: vals[i], x: x0 + i * (W + gap) });
}

const eq = new MathTexImage({ renderer: "katex", latex: "O(n^2)", fontSize: 28, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.6 }));

for (let i = 0; i < n - 1; i++) {
  let minIdx = i;
  for (let j = i + 1; j < n; j++) {
    await scene.play(new Indicate(bars[j].vg, { color: GOLD, duration: 0.22 }));
    if (bars[j].value < bars[minIdx].value) {
      await scene.play(new Indicate(bars[minIdx].vg, { color: BLUE_D, duration: 0.18 }));
      minIdx = j;
    }
  }
  if (minIdx !== i) {
    const a = bars[i], b = bars[minIdx];
    const dx = (b.x - a.x) / 2;
    await scene.play(new AnimationGroup([
      a.vg.animate.shift([dx, 0, 0]),
      b.vg.animate.shift([-dx, 0, 0]),
    ], { duration: 0.45 }));
    const tx = a.x; a.x = b.x; b.x = tx;
    const tv = a.value; a.value = b.value; b.value = tv;
  }
  await scene.play(bars[i].vg.animate.setColor(GREEN));
}
await scene.play(bars[n - 1].vg.animate.setColor(GREEN));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 3. 插入排序 =================
  {
    id: "computer-insertion-sort",
    source: "经典 CS 教学动画改写(插入排序摸牌整理)",
    domain: "computer",
    category: "排序",
    title: "插入排序:如同理牌,逐张插入已排序区",
    intent: "把数组看成'已排序区 + 待插元素',每个新元素向左扫描直到找到合适位置插入。类比打牌理牌,凸显对已近似有序数据的高效。",
    sceneCode: `
const { scene, Rectangle, Text, MathTexImage, VGroup, Indicate, Write, FadeIn, BLUE_C, BLUE_E, GOLD, GREEN, WHITE, UP, DOWN } = ctx;
const title = new Text({ text: "插入排序:如同理牌,逐张插入已排序区", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const vals = [6, 3, 8, 2, 7, 4, 5];
const n = vals.length;
const W = 0.66, gap = 0.18, baseY = -1.4, H = 0.22;
let cells = [];
const x0 = -((n - 1) * (W + gap)) / 2;
function makeCell(value, i, color) {
  const h = value * H;
  const bar = new Rectangle({ width: W, height: h, color: color, strokeWidth: 2, fillOpacity: 0.55 });
  const lab = new Text({ text: String(value), fontSize: 18, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
  bar.moveTo([x0 + i * (W + gap), baseY - 0.4 + h / 2, 0]);
  lab.moveTo([x0 + i * (W + gap), baseY - 0.4 - h / 2 - 0.25, 0]);
  return new VGroup(bar, lab);
}
for (let i = 0; i < n; i++) { const c = makeCell(vals[i], i, BLUE_C); scene.add(c); cells.push(c); }

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{最好 }O(n)\\qquad \\text{平均 }O(n^2)", fontSize: 27, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.6 }));

for (let i = 1; i < n; i++) {
  const key = vals[i];
  await scene.play(new Indicate(cells[i], { color: GOLD, duration: 0.3 }));
  let j = i - 1;
  const shifts = [];
  while (j >= 0 && vals[j] > key) { shifts.push(j); j--; }
  for (const s of shifts) {
    await scene.play(cells[s].animate.shift([W + gap, 0, 0]));
    vals[s + 1] = vals[s];
  }
  vals[j + 1] = key;
  const fresh = makeCell(key, j + 1, GOLD);
  scene.add(fresh);
  cells[j + 1] = fresh;
  await scene.play(new FadeIn(fresh, { duration: 0.3 }));
}
await scene.play(cells[0].animate.setColor(GREEN));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 4. 快速排序 =================
  {
    id: "computer-quicksort",
    source: "经典 CS 教学动画改写(快速排序选枢纽分区)",
    domain: "computer",
    category: "排序",
    title: "快速排序:选枢纽,分区,分治",
    intent: "一趟以枢纽值为界把数组分成'小于'与'大于'两区,随后递归对每区重复。直观建立分治思想与平均 O(n log n),展示枢纽选取与指针扫描。",
    sceneCode: `
const { scene, Rectangle, Text, MathTexImage, VGroup, Circumscribe, Write, FadeIn, BLUE_C, BLUE_D, GOLD, GREEN, RED, WHITE, UP, DOWN } = ctx;
const title = new Text({ text: "快速排序:选枢纽,分区,分治", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const arr = [3, 7, 2, 8, 5, 1, 6, 4];
const n = arr.length;
const W = 0.66, gap = 0.18, baseY = -1.4;
const cells = [];
const x0 = -((n - 1) * (W + gap)) / 2;
for (let i = 0; i < n; i++) {
  const box = new Rectangle({ width: W, height: W, color: BLUE_C, strokeWidth: 2, fillOpacity: 0.3 });
  const lab = new Text({ text: String(arr[i]), fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
  box.moveTo([x0 + i * (W + gap), baseY, 0]);
  lab.moveTo([x0 + i * (W + gap), baseY, 0]);
  const vg = new VGroup(box, lab);
  scene.add(vg);
  cells.push(vg);
}

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{平均 }O(n\\log n)", fontSize: 28, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.6 }));

await scene.play(new Circumscribe(cells[n - 1], { color: RED, duration: 0.7 }));
const note = new Text({ text: "枢纽 = 4:< 4 归左,> 4 留右", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, UP, 0.3);
scene.add(note);
await scene.play(new Write(note));
for (let i = 0; i < n - 1; i++) {
  await scene.play(cells[i].animate.setColor(arr[i] < 4 ? GREEN : BLUE_D));
}
await scene.play(new Circumscribe(eq, { color: BLUE_C, duration: 0.8 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 5. 归并排序(合并两个有序序列) =================
  {
    id: "computer-merge-sort",
    source: "经典 CS 教学动画改写(归并:合并两个有序序列)",
    domain: "computer",
    category: "排序",
    title: "归并:合并两个有序序列",
    intent: "归并排序的核心步骤:两个已分别有序的序列,各取队首较小者依次放入结果,得到一个有序的合并序列。拆解'每次比两段头部'这一关键循环。",
    sceneCode: `
const { scene, Rectangle, Text, MathTexImage, VGroup, Indicate, Write, FadeIn, BLUE_C, BLUE_D, BLUE_E, GOLD, GREEN, WHITE, UP, DOWN, LEFT, RIGHT } = ctx;
const title = new Text({ text: "归并:合并两个有序序列", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const A = [2, 4, 7], B = [1, 3, 6];
const cellW = 0.62, gap = 0.16;
const topY = 1.0, midY = 0.25, botY = -1.9;
function rowGroups(vals, y, color) {
  const x0r = -((vals.length - 1) * (cellW + gap)) / 2;
  const gs = [];
  for (let i = 0; i < vals.length; i++) {
    const box = new Rectangle({ width: cellW, height: cellW, color: color, strokeWidth: 2, fillOpacity: 0.3 });
    const lab = new Text({ text: String(vals[i]), fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
    box.moveTo([x0r + i * (cellW + gap), y, 0]);
    lab.moveTo([x0r + i * (cellW + gap), y, 0]);
    const vg = new VGroup(box, lab);
    scene.add(vg);
    gs.push(vg);
  }
  return { gs, x0: x0r };
}
const rowA = rowGroups(A, topY, BLUE_C);
const rowB = rowGroups(B, midY, BLUE_D);
const labA = new Text({ text: "L", fontSize: 20, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
labA.nextTo(rowA.gs[0], LEFT, 0.3);
const labB = new Text({ text: "R", fontSize: 20, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
labB.nextTo(rowB.gs[0], LEFT, 0.3);
scene.add(labA, labB);
await scene.play(new FadeIn(labA), new FadeIn(labB));

const resNote = new Text({ text: "归并结果(每次取两段头部较小者)", fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
resNote.nextTo(rowA.gs[0], UP, 1.2);
scene.add(resNote);
await scene.play(new Write(resNote));

let ia = 0, ib = 0, k = 0;
const total = A.length + B.length;
const outX0 = -((total - 1) * (cellW + gap)) / 2;
while (ia < A.length || ib < B.length) {
  let takeA;
  if (ia >= A.length) takeA = false;
  else if (ib >= B.length) takeA = true;
  else takeA = A[ia] <= B[ib];
  const src = takeA ? rowA.gs[ia] : rowB.gs[ib];
  await scene.play(new Indicate(src, { color: GOLD, duration: 0.25 }));
  const val = takeA ? A[ia] : B[ib];
  ia += takeA ? 1 : 0; ib += takeA ? 0 : 1;
  const box = new Rectangle({ width: cellW, height: cellW, color: GREEN, strokeWidth: 2, fillOpacity: 0.3 });
  const lab = new Text({ text: String(val), fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
  box.moveTo([outX0 + k * (cellW + gap), botY, 0]);
  lab.moveTo([outX0 + k * (cellW + gap), botY, 0]);
  const vg = new VGroup(box, lab);
  scene.add(vg);
  await scene.play(new FadeIn(vg, { duration: 0.25 }));
  k++;
}
const eq = new MathTexImage({ renderer: "katex", latex: "O(n)\\ \\text{一次合并}", fontSize: 28, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.15);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.6 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 6. 二分查找 =================
  {
    id: "computer-binary-search",
    source: "经典 CS 教学动画改写(有序数组二分查找)",
    domain: "computer",
    category: "搜索",
    title: "二分查找:每次砍半,log₂n 次命中",
    intent: "在有序数组里不断取中位数比较,小于则弃右半、大于则弃左半,每步把搜索区间减半。直观理解 O(log n) 的对数威力。",
    params: [{ name: "target", label: "目标值", min: 2, max: 16, step: 2, default: 14 }],
    sceneCode: `
const { scene, Rectangle, Text, MathTexImage, VGroup, Indicate, Write, FadeIn, FadeOut, Arrow, BLUE_C, BLUE_D, BLUE_E, GOLD, GREEN, RED, WHITE, UP, DOWN, params } = ctx;
const title = new Text({ text: "二分查找:每次砍半,log₂n 次命中", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const arr = [2, 4, 6, 8, 10, 12, 14, 16];
const n = arr.length;
const target = Math.max(2, Math.min(16, Math.round(params.target / 2) * 2));
const W = 0.66, gap = 0.18, baseY = 0.3;
const cells = [];
const x0 = -((n - 1) * (W + gap)) / 2;
for (let i = 0; i < n; i++) {
  const box = new Rectangle({ width: W, height: W, color: BLUE_C, strokeWidth: 2, fillOpacity: 0.3 });
  const lab = new Text({ text: String(arr[i]), fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
  box.moveTo([x0 + i * (W + gap), baseY, 0]);
  lab.moveTo([x0 + i * (W + gap), baseY, 0]);
  const vg = new VGroup(box, lab);
  scene.add(vg);
  cells.push(vg);
}

const arrowY = baseY - 1.05;
const lowArrow = new Arrow({ start: [x0 - 0.25, arrowY, 0], end: [x0, arrowY, 0], color: BLUE_D, strokeWidth: 2, tipLength: 0.15 });
const highArrow = new Arrow({ start: [x0 + (n - 1) * (W + gap) + 0.25, arrowY, 0], end: [x0 + (n - 1) * (W + gap), arrowY, 0], color: BLUE_D, strokeWidth: 2, tipLength: 0.15 });
scene.add(lowArrow, highArrow);

const eq = new MathTexImage({ renderer: "katex", latex: "\\log_2 n\\ \\text{次比较}", fontSize: 27, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.6 }));

const foundLine = new Text({ text: "查找目标 " + target, fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
foundLine.nextTo(eq, UP, 0.3);
scene.add(foundLine);
await scene.play(new Write(foundLine));

let lo = 0, hi = n - 1, found = false;
while (lo <= hi && !found) {
  const mid = Math.floor((lo + hi) / 2);
  const midVg = cells[mid];
  const idxLab = new Text({ text: "mid", fontSize: 18, color: RED, fontFamily: '"Times New Roman","SimSun",serif' });
  idxLab.nextTo(midVg, UP, 0.18);
  scene.add(idxLab);
  await scene.play(new FadeIn(idxLab, { duration: 0.15 }));
  await scene.play(new Indicate(midVg, { color: GOLD, duration: 0.35 }));
  if (arr[mid] === target) {
    await scene.play(midVg.animate.setColor(GREEN));
    found = true;
  } else if (arr[mid] < target) {
    lo = mid + 1;
    await scene.play(lowArrow.animate.shift([(mid - lo + 1) * (W + gap), 0, 0]));
  } else {
    hi = mid - 1;
    await scene.play(highArrow.animate.shift([-(hi + 1 - mid) * (W + gap), 0, 0]));
  }
  await scene.play(new FadeOut(idxLab, { duration: 0.1 }));
}
const note2 = new Text({ text: found ? "已找到 " + target : "未找到 " + target, fontSize: 22, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
note2.nextTo(foundLine, UP, 0.18);
scene.add(note2);
await scene.play(new Write(note2));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 7. 线性搜索 =================
  {
    id: "computer-linear-search",
    source: "经典 CS 教学动画改写(线性搜索从头扫到尾)",
    domain: "computer",
    category: "搜索",
    title: "线性搜索:逐个比对,最坏扫完全部",
    intent: "从头到尾逐个元素与目标比对,遇到即停。与二分查找对照,展示无序数据只能线性遍历、最坏 O(n) 的道理。",
    params: [{ name: "target", label: "目标值", min: 1, max: 9, step: 1, default: 7 }],
    sceneCode: `
const { scene, Rectangle, Text, MathTexImage, VGroup, Indicate, Write, FadeIn, Arrow, BLUE_C, BLUE_D, BLUE_E, GOLD, GREEN, RED, WHITE, UP, DOWN, params } = ctx;
const title = new Text({ text: "线性搜索:逐个比对,最坏 O(n)", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const arr = [5, 3, 8, 1, 9, 2, 7, 4];
const n = arr.length;
const target = Math.max(1, Math.min(9, Math.round(params.target)));
const W = 0.66, gap = 0.18, baseY = 0.3;
const cells = [];
const x0 = -((n - 1) * (W + gap)) / 2;
for (let i = 0; i < n; i++) {
  const box = new Rectangle({ width: W, height: W, color: BLUE_C, strokeWidth: 2, fillOpacity: 0.3 });
  const lab = new Text({ text: String(arr[i]), fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
  box.moveTo([x0 + i * (W + gap), baseY, 0]);
  lab.moveTo([x0 + i * (W + gap), baseY, 0]);
  const vg = new VGroup(box, lab);
  scene.add(vg);
  cells.push(vg);
}

const eq = new MathTexImage({ renderer: "katex", latex: "O(n)", fontSize: 28, color: BLUE_D });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.6 }));

const aimLine = new Text({ text: "目标 " + target, fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
aimLine.nextTo(eq, UP, 0.3);
scene.add(aimLine);
await scene.play(new Write(aimLine));

// 移动的指针箭头
const ptr = new Arrow({ start: [x0 - 0.2, baseY + 1.0, 0], end: [x0, baseY + 1.0, 0], color: GOLD, strokeWidth: 2, tipLength: 0.15 });
scene.add(ptr);
let found = -1;
for (let i = 0; i < n; i++) {
  await scene.play(ptr.animate.moveTo([x0 + i * (W + gap) - 0.2, baseY + 1.0, 0]));
  await scene.play(new Indicate(cells[i], { color: GOLD, duration: 0.25 }));
  if (arr[i] === target) { found = i; break; }
}
if (found >= 0) {
  await scene.play(cells[found].animate.setColor(GREEN));
} else {
  const miss = new Text({ text: "未找到", fontSize: 24, color: RED, fontFamily: '"Times New Roman","SimSun",serif' });
  miss.nextTo(aimLine, UP, 0.18);
  scene.add(miss);
  await scene.play(new Write(miss));
}
await scene.wait(0.8);
`.trim(),
  },

  // ================= 8. 二叉树前序遍历 =================
  {
    id: "computer-tree-preorder",
    source: "经典 CS 教学动画改写(二叉树前序/中序/后序:根-左-右)",
    domain: "computer",
    category: "数据结构",
    title: "二叉树遍历:根 → 左 → 右(前序)",
    intent: "对每个子树按'根先、再左、再右'访问,递归展开整个树。用高亮节点访问顺序 + 下方输出串展示递归调用的轨迹。",
    sceneCode: `
const { scene, Circle, Line, Text, MathTexImage, VGroup, Indicate, Write, FadeIn, BLUE_C, BLUE_D, GOLD, GREEN, RED, WHITE, UP, DOWN, LEFT, RIGHT } = ctx;
const title = new Text({ text: "二叉树前序遍历:根 → 左 → 右", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

// 手动布局一棵小树(节点用圆,边用线段)
const P = (x, y) => [x, y, 0];
const nodes = {
  a: { p: P(0, 1.6), lab: "A" },
  b: { p: P(-1.6, 0.2), lab: "B" },
  c: { p: P(1.6, 0.2), lab: "C" },
  d: { p: P(-2.6, -1.2), lab: "D" },
  e: { p: P(-0.6, -1.2), lab: "E" },
  f: { p: P(0.6, -1.2), lab: "F" },
  g: { p: P(2.6, -1.2), lab: "G" },
};
const edges = [["a", "b"], ["a", "c"], ["b", "d"], ["b", "e"], ["c", "f"], ["c", "g"]];
const edgeObjs = [];
for (const [u, v] of edges) {
  const ln = new Line({ start: nodes[u].p, end: nodes[v].p, color: "#3a4a5a", strokeWidth: 2 });
  scene.add(ln);
  edgeObjs.push(ln);
}
const nodeObj = {};
for (const k of Object.keys(nodes)) {
  const c = new Circle({ radius: 0.34, color: BLUE_C, strokeWidth: 2, fillOpacity: 0.35 });
  const t = new Text({ text: nodes[k].lab, fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
  const vg = new VGroup(c, t);
  c.moveTo(nodes[k].p); t.moveTo(nodes[k].p);
  scene.add(vg);
  nodeObj[k] = vg;
}

// 访问输出串(右下角,横着排)
const outNote = new Text({ text: "访问顺序:", fontSize: 20, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
outNote.toEdge(DOWN, 0.7).shift([-4.2, 0, 0]);
scene.add(outNote);

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{前序:根—左—右}", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.18);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.5 }));

const order = ["a", "b", "d", "e", "c", "f", "g"];
const seq = [];
for (let i = 0; i < order.length; i++) {
  const k = order[i];
  await scene.play(new Indicate(nodeObj[k], { color: GOLD, duration: 0.35 }));
  const ch = new Text({ text: nodes[k].lab, fontSize: 22, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
  ch.nextTo(outNote, RIGHT, i * 0.55 + 0.5).shift([0.55 * i, 0, 0]);
  scene.add(ch);
  await scene.play(new FadeIn(ch, { duration: 0.15 }));
  seq.push(ch);
  await scene.play(nodeObj[k].animate.setColor(BLUE_D));
}
await scene.play(new Indicate(eq, { color: BLUE_C, duration: 0.7 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 9. 二叉树插入 =================
  {
    id: "computer-tree-insert",
    source: "经典 CS 教学动画改写(二叉查找树插入新节点)",
    domain: "computer",
    category: "数据结构",
    title: "二叉查找树插入:比根小走左,大走右",
    intent: "插入一个值从根出发,全程与当前节点比较:小则进左子树、大则进右子树,直到空位挂上新节点。识别 BST 的搜索树结构约束。",
    sceneCode: `
const { scene, Circle, Line, Text, MathTexImage, VGroup, Indicate, FadeIn, Write, GrowFromCenter, BLUE_C, BLUE_D, BLUE_E, GOLD, GREEN, WHITE, UP, DOWN, LEFT, RIGHT } = ctx;
const title = new Text({ text: "二叉查找树插入:小走左,大走右", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const P = (x, y) => [x, y, 0];
const nodes = {
  r: { p: P(0, 1.7), lab: "50", lc: "l", rc: "r2" },
  l: { p: P(-1.9, 0.3), lab: "30", lc: null, rc: null },
  r2: { p: P(1.9, 0.3), lab: "70", lc: "ll", rc: null },
  ll: { p: P(-3.0, -1.1), lab: "10", lc: null, rc: null },
};
const edges = [["r", "l"], ["r", "r2"], ["l", "ll"]];
for (const [u, v] of edges) {
  const ln = new Line({ start: nodes[u].p, end: nodes[v].p, color: "#3a4a5a", strokeWidth: 2 });
  scene.add(ln);
}
const nodeObj = {};
for (const k of Object.keys(nodes)) {
  const c = new Circle({ radius: 0.34, color: BLUE_C, strokeWidth: 2, fillOpacity: 0.35 });
  const t = new Text({ text: nodes[k].lab, fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
  const vg = new VGroup(c, t);
  c.moveTo(nodes[k].p); t.moveTo(nodes[k].p);
  scene.add(vg);
  nodeObj[k] = vg;
}

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{插入 40}", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.5 }));

// 40 从根找路:50 > 40 → 左 → 30 < 40 → 右(空,挂到 30 的右下)
const path = ["r", "l"];
for (const k of path) {
  await scene.play(new Indicate(nodeObj[k], { color: GOLD, duration: 0.4 }));
}
const newP = P(-0.55, -1.2); // 30 的右下空位
const newEdge = new Line({ start: nodes.l.p, end: newP, color: GOLD, strokeWidth: 2 });
scene.add(newEdge);
const cNew = new Circle({ radius: 0.34, color: GREEN, strokeWidth: 2, fillOpacity: 0.5 });
const tNew = new Text({ text: "40", fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
const vgNew = new VGroup(cNew, tNew);
cNew.moveTo(newP); tNew.moveTo(newP);
scene.add(vgNew);
await scene.play(new GrowFromCenter(vgNew, { duration: 0.5 }));
const note = new Text({ text: "40 < 50 走左,40 > 30 走右,落到空位", fontSize: 21, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, UP, 0.3);
scene.add(note);
await scene.play(new Write(note));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 10. 栈(后进先出) =================
  {
    id: "computer-stack",
    source: "经典 CS 教学动画改写(栈 push/pop 后进先出)",
    domain: "computer",
    category: "数据结构",
    title: "栈:后进先出 LIFO,push/pop",
    intent: "元素从栈顶放入(push)、从栈顶取出(pop),最后放入的最先被取出。用纵向堆叠 + 栈顶指针展示 LIFO 语义,是函数调用的底层模型。",
    sceneCode: `
const { scene, Rectangle, Text, MathTexImage, VGroup, Indicate, Write, FadeIn, FadeOut, Arrow, BLUE_C, BLUE_D, BLUE_E, GOLD, WHITE, UP, DOWN, RIGHT } = ctx;
const title = new Text({ text: "栈:后进先出 LIFO", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

// 栈容器(空矩形)在左侧
const boxW = 1.5, boxH = 3.6;
const box = new Rectangle({ width: boxW, height: boxH, color: BLUE_C, strokeWidth: 2, fillOpacity: 0.05 }).shift([-3.0, 0.2, 0]);
scene.add(box);
const boxLab = new Text({ text: "栈", fontSize: 20, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
boxLab.nextTo(box, UP, 0.2);
scene.add(boxLab);

const topArrow = new Arrow({ start: [-3.0, box.getRight()[1] + 0.3, 0], end: [-3.0, box.getRight()[1] - boxH + 0.6, 0], color: GOLD, strokeWidth: 2, tipLength: 0.12 });
const topLab = new Text({ text: "top", fontSize: 18, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
topLab.nextTo(topArrow, RIGHT, 0.15);
scene.add(topArrow, topLab);

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{push/pop 都在栈顶}", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.5 }));

const items = [];
const insert = ["A", "B", "C"];
async function pushOne(labTy) {
  const cell = new Rectangle({ width: boxW - 0.25, height: 0.85, color: BLUE_D, strokeWidth: 2, fillOpacity: 0.4 });
  const t = new Text({ text: labTy, fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
  const vg = new VGroup(cell, t);
  const y = box.getTop()[1] - 0.4 - items.length * 0.95;
  cell.moveTo([box.getRight()[0], y, 0]);
  t.moveTo([box.getRight()[0], y, 0]);
  scene.add(vg);
  await scene.play(new FadeIn(vg, { duration: 0.3 }));
  await scene.play(vg.animate.shift([0, 0, 0]));
  items.push(vg);
  await scene.play(topArrow.animate.shift([0, -0.95, 0]));
  await scene.play(topLab.animate.shift([0, -0.95, 0]));
}
const actionLab = new Text({ text: "push → top", fontSize: 22, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
actionLab.nextTo(box, RIGHT, 1.1);
scene.add(actionLab);
await scene.play(new Write(actionLab));
for (const s of insert) {
  await pushOne(s);
}
// pop 一个:从顶部移出
const last = items.pop();
await scene.play(last.animate.shift([2.4, 0, 0]));
await scene.play(new FadeOut(last, { duration: 0.25 }));
await scene.play(topArrow.animate.shift([0, 0.95, 0]));
await scene.play(topLab.animate.shift([0, 0.95, 0]));
const note = new Text({ text: "pop 取出 C(最后放入,最先取出)", fontSize: 20, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, UP, 0.3);
scene.add(note);
await scene.play(new Write(note));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 11. 队列(先进先出) =================
  {
    id: "computer-queue",
    source: "经典 CS 教学动画改写(队列 FIFO 入队出队)",
    domain: "computer",
    category: "数据结构",
    title: "队列:先进先出 FIFO,入队/出队",
    intent: "元素从队尾入队(enqueue)、从队首出队(dequeue),先来的先走,如同排队。展示 head/tail 指针移动与 FIFO 语义。",
    sceneCode: `
const { scene, Rectangle, Text, MathTexImage, VGroup, Indicate, Write, FadeIn, FadeOut, Arrow, BLUE_C, BLUE_D, BLUE_E, GOLD, WHITE, UP, DOWN } = ctx;
const title = new Text({ text: "队列:先进先出 FIFO", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const lane = new Rectangle({ width: 5.6, height: 1.5, color: BLUE_C, strokeWidth: 2, fillOpacity: 0.05 });
scene.add(lane);
const laneLab = new Text({ text: "队列", fontSize: 20, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
laneLab.nextTo(lane, UP, 0.15);
scene.add(laneLab);

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{enqueue 尾}\\quad\\text{dequeue 头}", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.5 }));

const leftX = lane.getLeft()[0] + 0.4, y = lane.getTop()[1] - 0.75;
const headArrow = new Arrow({ start: [leftX, lane.getBottom()[1] - 0.35, 0], end: [leftX, lane.getTop()[1] - 1.2, 0], color: GOLD, strokeWidth: 2, tipLength: 0.12 });
const headLab = new Text({ text: "head", fontSize: 18, color: GOLD, fontFamily: '"Times New Roman","SimSun",serif' });
headLab.nextTo(headArrow, DOWN, 0.08);
scene.add(headArrow, headLab);

const tailArrow = new Arrow({ start: [lane.getRight()[0] - 0.4, lane.getBottom()[1] + 0.35, 0], end: [lane.getRight()[0] - 0.4, lane.getTop()[1] + 0.35, 0], color: BLUE_D, strokeWidth: 2, tipLength: 0.12 });
const tailLab = new Text({ text: "tail", fontSize: 18, color: BLUE_D, fontFamily: '"Times New Roman","SimSun",serif' });
tailLab.nextTo(tailArrow, DOWN, 0.08);
scene.add(tailArrow, tailLab);

const items = [];
const q = ["A", "B", "C"];
for (let i = 0; i < q.length; i++) {
  const cell = new Rectangle({ width: 1.3, height: 1.1, color: BLUE_D, strokeWidth: 2, fillOpacity: 0.4 });
  const t = new Text({ text: q[i], fontSize: 24, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
  const vg = new VGroup(cell, t);
  const x = leftX + i * 1.5;
  cell.moveTo([x, y, 0]); t.moveTo([x, y, 0]);
  scene.add(vg);
  await scene.play(new FadeIn(vg, { duration: 0.25 }));
  items.push(vg);
}
await scene.play(headArrow.animate.shift([1.5, 0, 0]));
await scene.play(headLab.animate.shift([1.5, 0, 0]));
// 出队队首 A
const front = items.shift();
await scene.play(front.animate.shift([-2.0, -0.2, 0]));
await scene.play(new FadeOut(front, { duration: 0.25 }));
const note = new Text({ text: "出队 A:先来先走", fontSize: 20, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, UP, 0.3);
scene.add(note);
await scene.play(new Write(note));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 12. 链表插入 =================
  {
    id: "computer-linked-list",
    source: "经典 CS 教学动画改写(单链表插入新节点)",
    domain: "computer",
    category: "数据结构",
    title: "单链表插入:改两个指针即可",
    intent: "在链表中插入节点只需把前驱的 next 指向新节点、新节点的 next 指向后继,无需移动元素。凸显链式存储插入的 O(1) 开销与指针操作。",
    sceneCode: `
const { scene, Rectangle, Text, MathTexImage, Arrow, VGroup, Indicate, Write, FadeIn, GrowFromCenter, BLUE_C, BLUE_D, BLUE_E, GOLD, GREEN, WHITE, UP, DOWN, RIGHT } = ctx;
const title = new Text({ text: "单链表插入:改两个指针即可", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

// 三个既有节点(方块 + 数值),横向排,中间留空位
const nW = 0.95, y = 0.4;
const xa = -3.0, xc = 2.4;
function nodeAt(x, lab, color) {
  const box = new Rectangle({ width: nW, height: nW, color: color, strokeWidth: 2, fillOpacity: 0.4 });
  const t = new Text({ text: lab, fontSize: 24, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
  box.moveTo([x, y, 0]); t.moveTo([x, y, 0]);
  const vg = new VGroup(box, t);
  scene.add(vg);
  return vg;
}
const nodeA = nodeAt(xa, "A", BLUE_C);
const nodeC = nodeAt(xc, "C", BLUE_C);
const arrAC = new Arrow({ start: [xa + nW / 2 + 0.1, y, 0], end: [xc - nW / 2 - 0.1, y, 0], color: BLUE_D, strokeWidth: 2, tipLength: 0.18 });
scene.add(arrAC);

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{插入 }O(1)\\ \\text{指针操作}", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.5 }));

// 新节点 B(top-billboard)放上方,再落到中间
const xb = -0.3;
const bB = nodeAt(xb, "B", GREEN);
await scene.play(new GrowFromCenter(bB, { duration: 0.4 }));
// 断旧边,连两条新边
await scene.play(arrAC.animate.setColor("#2a3040"));
const edgeAB = new Arrow({ start: [xa + nW / 2 + 0.1, y, 0], end: [xb - nW / 2 - 0.1, y, 0], color: GOLD, strokeWidth: 2, tipLength: 0.18 });
const edgeBC = new Arrow({ start: [xb + nW / 2 + 0.1, y, 0], end: [xc - nW / 2 - 0.1, y, 0], color: BLUE_D, strokeWidth: 2, tipLength: 0.18 });
scene.add(edgeAB, edgeBC);
await scene.play(new GrowFromCenter(edgeAB, { duration: 0.3 }), new GrowFromCenter(edgeBC, { duration: 0.3 }));
const note = new Text({ text: "A→B→C:只改 A.next 与 B.next", fontSize: 21, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, UP, 0.3);
scene.add(note);
await scene.play(new Write(note));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 13. 递归:阶乘的栈帧 =================
  {
    id: "computer-recursion-factorial",
    source: "经典 CS 教学动画改写(递归阶乘的调用栈)",
    domain: "computer",
    category: "递归",
    title: "递归阶乘:每层调用压栈,回溯求值",
    intent: "fact(4) 逐层压入栈帧直到基例,再逐层弹出回溯相乘。把'递归 = 系统用栈管理调用'可视化,解释递推与回代的本质。",
    params: [{ name: "n", label: "阶乘 n", min: 3, max: 5, step: 1, default: 4 }],
    sceneCode: `
const { scene, Rectangle, Text, MathTexImage, VGroup, Write, FadeIn, Indicate, BLUE_C, BLUE_D, BLUE_E, GOLD, WHITE, UP, DOWN, params } = ctx;
const title = new Text({ text: "递归阶乘:调用栈的压栈与回溯", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const n = Math.max(3, Math.min(5, Math.round(params.n)));
const boxW = 2.2, boxH = 0.95, y0 = -1.2;
// 自顶向下画调用栈每一格(调用顺序:fact(n)...fact(1))
const frames = [];
for (let k = n; k >= 0; k--) {
  const cell = new Rectangle({ width: boxW, height: boxH, color: k === 0 ? BLUE_D : BLUE_C, strokeWidth: 2, fillOpacity: 0.3 });
  const bt = k === 0 ? "fact(0) = 1  基例" : "fact(" + k + ") = " + k + " * fact(" + (k - 1) + ")";
  const t = new Text({ text: bt, fontSize: 20, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
  const y = y0 + (n - k) * (boxH + 0.18);
  cell.moveTo([0, y, 0]); t.moveTo([0, y, 0]);
  const vg = new VGroup(cell, t);
  scene.add(vg);
  frames.push(vg);
  await scene.play(new FadeIn(vg, { duration: 0.2 }));
}
const stackLab = new Text({ text: "调用栈(自上而下逐层压入)", fontSize: 20, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
stackLab.nextTo(frames[0], UP, 0.5);
scene.add(stackLab);
await scene.play(new Write(stackLab));

const eq = new MathTexImage({ renderer: "katex", latex: "n! = n\\cdot(n-1)!", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.16);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.5 }));

// 回溯:从基例自下而上高亮,表示逐层返回结果
for (let i = frames.length - 1; i >= 0; i--) {
  await scene.play(new Indicate(frames[i], { color: GOLD, duration: 0.35 }));
}
let fact = 1; for (let f = 2; f <= n; f++) fact *= f;
const ans = new Text({ text: n + "! = " + fact, fontSize: 22, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
ans.nextTo(eq, UP, 0.3);
scene.add(ans);
await scene.play(new Write(ans));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 14. 科赫雪花 =================
  {
    id: "computer-koch-snowflake",
    source: "经典 CS 教学动画改写(科赫雪花分形曲线)",
    domain: "computer",
    category: "分形",
    title: "科赫雪花:一条边递归锯齿化",
    intent: "把每条线段三等分,中间一段换成向上凸起的折线,递归加深。展示分形的'自相似 + 无限细节'与递归生成,曼德博分形的经典入门。",
    params: [{ name: "depth", label: "递归深度", min: 0, max: 4, step: 1, default: 3 }],
    sceneCode: `
const { scene, Line, Text, MathTexImage, VGroup, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, WHITE, UP, DOWN, params } = ctx;
const title = new Text({ text: "科赫雪花:一条边递归锯齿化", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const eq = new MathTexImage({ renderer: "katex", latex: "L_n = (4/3)^n \\cdot L_0", fontSize: 26, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.5 }));

// 一条从 (-4.5,0) 到 (4.5,0) 的边,递归 koch 化
const depth = Math.max(0, Math.min(4, Math.round(params.depth)));
function koch(p1, p2, k) {
  if (k === 0) { return [p1, p2]; }
  const x1 = p1[0] + (p2[0] - p1[0]) / 3, y1 = p1[1] + (p2[1] - p1[1]) / 3;
  const x3 = p1[0] + 2 * (p2[0] - p1[0]) / 3, y3 = p1[1] + 2 * (p2[1] - p1[1]) / 3;
  const dx = x3 - x1, dy = y3 - y1;
  const mx = (x1 + x3) / 2 - dy * (Math.sqrt(3) / 2) * 0.5, my = (y1 + y3) / 2 + dx * (Math.sqrt(3) / 2) * 0.5;
  const mid = [mx, my, 0];
  const pts = [];
  pts.push.apply(pts, koch(p1, [x1, y1, 0], k - 1));
  pts.push.apply(pts, koch([x1, y1, 0], mid, k - 1));
  pts.push.apply(pts, koch(mid, [x3, y3, 0], k - 1));
  pts.push.apply(pts, koch([x3, y3, 0], p2, k - 1));
  return pts;
}
const pts = koch([-4.3, 0, 0], [4.3, 0, 0], depth);
const sub = [];
for (let i = 0; i < pts.length - 1; i++) {
  const seg = new Line({ start: pts[i], end: pts[i + 1], color: BLUE_C, strokeWidth: 3 });
  scene.add(seg);
  sub.push(seg);
}
await scene.play(new Create(sub[0], { duration: 0.5 }));
for (let i = 1; i < sub.length; i++) {
  await scene.play(new Create(sub[i], { duration: 0.06 }));
}
const note = new Text({ text: "深度 " + depth + ":总长 = (4/3)^" + depth + " 倍,周长无限", fontSize: 20, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, UP, 0.3);
scene.add(note);
await scene.play(new Write(note));
await scene.play(new Indicate(eq, { color: BLUE_C, duration: 0.7 }));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 15. 谢尔宾斯基三角形 =================
  {
    id: "computer-sierpinski",
    source: "经典 CS 教学动画改写(谢尔宾斯基三角形递归挖空)",
    domain: "computer",
    category: "分形",
    title: "谢尔宾斯基三角形:递归挖掉中心",
    intent: "把等边三角形分成 4 个小三角形,挖掉中心的那个,再对剩下 3 个递归重复。展示自相似缩放与'面积趋于 0、周长趋于无限'的反直觉结论。",
    params: [{ name: "depth", label: "递归深度", min: 0, max: 4, step: 1, default: 3 }],
    sceneCode: `
const { scene, Polygon, Text, MathTexImage, VGroup, Create, Write, FadeIn, Indicate, BLUE, BLUE_C, WHITE, UP, DOWN, params } = ctx;
const title = new Text({ text: "谢尔宾斯基三角形:递归挖空中心", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{面积 }\\to 0,\\ \\text{周长 }\\to\\infty", fontSize: 25, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.5 }));

const depth = Math.max(0, Math.min(4, Math.round(params.depth)));
const tris = [];
// 递归画实心三角形(深度>0 时只画留空的那几个子三角)
function draw(p1, p2, p3, k) {
  const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
  if (k === 0) {
    const poly = new Polygon({ vertices: [p1, p2, p3], color: BLUE_C, strokeWidth: 1.5, fillOpacity: 0.55 });
    scene.add(poly);
    tris.push(poly);
    return;
  }
  // 中点
  const a12 = [mx, my, 0];
  const a23 = [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2, 0];
  const a31 = [(p3[0] + p1[0]) / 2, (p3[1] + p1[1]) / 2, 0];
  draw(p1, a12, a31, k - 1);
  draw(a12, p2, a23, k - 1);
  draw(a31, a23, p3, k - 1);
}
draw([-4.4, -1.4, 0], [4.4, -1.4, 0], [0, 2.9, 0], depth);
await scene.play(new Create(tris[0], { duration: 1.2 }));
for (let i = 1; i < tris.length; i++) {
  await scene.play(new Create(tris[i], { duration: 0.05 }));
}
const note = new Text({ text: "深度 " + depth + ":三角形个数 3^" + depth, fontSize: 20, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, UP, 0.3);
scene.add(note);
await scene.play(new Write(note));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 16. 分形树 =================
  {
    id: "computer-fractal-tree",
    source: "经典 CS 教学动画改写(递归分形树,不断分叉)",
    domain: "computer",
    category: "分形",
    title: "递归分形树:主干分两枝,层层变细",
    intent: "一条主干分成左右两枝,每枝再各自分成两枝,递归到基例。展示递归的树状展开与自然界结构(树干、树枝)的自相似几何。",
    params: [{ name: "depth", label: "递归深度", min: 1, max: 5, step: 1, default: 4 }],
    sceneCode: `
const { scene, Line, Text, MathTexImage, VGroup, Create, Write, FadeIn, BLUE, BLUE_C, BLUE_D, BLUE_E, WHITE, UP, DOWN, params } = ctx;
const title = new Text({ text: "递归分形树:主干分两枝,层层变细", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{每层 }\\times 2\\ \\text{分支}", fontSize: 25, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.24);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.5 }));

const depth = Math.max(1, Math.min(5, Math.round(params.depth)));
const base = [0, -2.6, 0];
const segs = [];
function branch(p, len, angle, k) {
  const ex = p[0] + len * Math.cos(angle), ey = p[1] + len * Math.sin(angle);
  const end = [ex, ey, 0];
  const ln = new Line({ start: p, end: end, color: k <= 1 ? BLUE_D : (k === 2 ? BLUE : BLUE_C), strokeWidth: Math.max(1, k * 1.4) });
  scene.add(ln);
  segs.push(ln);
  if (k > 1) {
    branch(end, len * 0.7, angle + 0.5, k - 1);
    branch(end, len * 0.7, angle - 0.5, k - 1);
  }
}
branch(base, 1.6, Math.PI / 2, depth);
await scene.play(new Create(segs[0], { duration: 0.5 }));
for (let i = 1; i < segs.length; i++) {
  await scene.play(new Create(segs[i], { duration: 0.04 }));
}
const note = new Text({ text: "深度 " + depth + ":树枝总数随深度指数增长", fontSize: 20, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, UP, 0.3);
scene.add(note);
await scene.play(new Write(note));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 17. 图 BFS 广度优先 =================
  {
    id: "computer-graph-bfs",
    source: "经典 CS 教学动画改写(图的广度优先搜索)",
    domain: "computer",
    category: "图论",
    title: "图的 BFS:一层一层向外扩散",
    intent: "从起点出发,先访问所有邻居(第一层),再访问邻居的邻居(第二层),按层推进,天然得到到各点的最短步数。用队列 FIFO 实现。",
    sceneCode: `
const { scene, Circle, Line, Text, MathTexImage, VGroup, Indicate, Write, FadeIn, BLUE_C, BLUE_D, BLUE_E, GOLD, GREEN, RED, WHITE, UP, DOWN } = ctx;
const title = new Text({ text: "图的 BFS:一层一层向外扩散", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const P = (x, y) => [x, y, 0];
const pos = {
  s: P(0, 1.8), a: P(-1.7, 0.4), b: P(1.7, 0.4),
  c: P(-2.6, -1.3), d: P(-0.5, -1.3), e: P(2.6, -1.3),
};
const edges = [["s", "a"], ["s", "b"], ["a", "c"], ["a", "d"], ["b", "d"], ["b", "e"]];
for (const [u, v] of edges) {
  const ln = new Line({ start: pos[u], end: pos[v], color: "#3a4a5a", strokeWidth: 2 });
  scene.add(ln);
}
const nodeObj = {};
for (const k of Object.keys(pos)) {
  const c = new Circle({ radius: 0.32, color: BLUE_C, strokeWidth: 2, fillOpacity: 0.35 });
  const t = new Text({ text: k, fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
  const vg = new VGroup(c, t);
  c.moveTo(pos[k]); t.moveTo(pos[k]);
  scene.add(vg);
  nodeObj[k] = vg;
}

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{BFS 用队列,按层推进}", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.5 }));

// BFS 层序:s → a,b → c,d,e
const layers = [["s"], ["a", "b"], ["c", "d", "e"]];
const layerLab = new Text({ text: "第 0 层", fontSize: 20, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
layerLab.nextTo(eq, UP, 0.32);
scene.add(layerLab);
for (let L = 0; L < layers.length; L++) {
  await scene.play(new Write(new Text({ text: "第 " + L + " 层: " + layers[L].join(" "), fontSize: 20, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' }).nextTo(eq, UP, 0.32)));
  for (const k of layers[L]) {
    await scene.play(new Indicate(nodeObj[k], { color: L === 0 ? RED : GOLD, duration: 0.35 }));
    await scene.play(nodeObj[k].animate.setColor(GREEN));
  }
}
await scene.wait(0.8);
`.trim(),
  },

  // ================= 18. 图 DFS 深度优先 =================
  {
    id: "computer-graph-dfs",
    source: "经典 CS 教学动画改写(图的深度优先搜索)",
    domain: "computer",
    category: "图论",
    title: "图的 DFS:一条道走到黑,再回溯",
    intent: "从起点深入一条分支到底,无路可走再回溯换一条分支。用栈(或递归)实现,访问顺序与 BFS 的层序截然不同。",
    sceneCode: `
const { scene, Circle, Line, Text, MathTexImage, VGroup, Indicate, Write, FadeIn, BLUE_C, BLUE_D, BLUE_E, GOLD, GREEN, WHITE, UP, DOWN, RIGHT } = ctx;
const title = new Text({ text: "图的 DFS:一条道走到黑,再回溯", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

const P = (x, y) => [x, y, 0];
const pos = {
  s: P(0, 2.0), a: P(-2.0, 0.5), b: P(2.0, 0.5),
  c: P(-2.8, -1.3), d: P(0, -1.3), e: P(2.8, -1.3),
};
const edges = [["s", "a"], ["s", "b"], ["a", "c"], ["a", "d"], ["b", "d"], ["b", "e"], ["c", "d"]];
for (const [u, v] of edges) {
  const ln = new Line({ start: pos[u], end: pos[v], color: "#3a4a5a", strokeWidth: 2 });
  scene.add(ln);
}
const nodeObj = {};
for (const k of Object.keys(pos)) {
  const c = new Circle({ radius: 0.32, color: BLUE_C, strokeWidth: 2, fillOpacity: 0.35 });
  const t = new Text({ text: k, fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
  const vg = new VGroup(c, t);
  c.moveTo(pos[k]); t.moveTo(pos[k]);
  scene.add(vg);
  nodeObj[k] = vg;
}

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{DFS 用栈,深入优先}", fontSize: 24, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.5 }));

// DFS 顺序:s→a→c→d→b→e
const order = ["s", "a", "c", "d", "b", "e"];
const seqTexts = [];
const sqNote = new Text({ text: "访问顺序:", fontSize: 20, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
sqNote.nextTo(eq, UP, 0.32);
scene.add(sqNote);
for (let i = 0; i < order.length; i++) {
  const k = order[i];
  await scene.play(new Indicate(nodeObj[k], { color: GREEN, duration: 0.35 }));
  await scene.play(nodeObj[k].animate.setColor(GREEN));
  const ch = new Text({ text: k, fontSize: 22, color: GREEN, fontFamily: '"Times New Roman","SimSun",serif' });
  ch.nextTo(sqNote, RIGHT, i * 0.5 + 0.6).shift([0.5 * i, 0, 0]);
  scene.add(ch);
  await scene.play(new FadeIn(ch, { duration: 0.12 }));
  seqTexts.push(ch);
}
await scene.wait(0.8);
`.trim(),
  },

  // ================= 19. 最短路径(Dijkstra 直观) =================
  {
    id: "computer-dijkstra",
    source: "经典 CS 教学动画改写(Dijkstra 最短路径)",
    domain: "computer",
    category: "图论",
    title: "Dijkstra:贪心选定已知最短的顶点",
    intent: "带权图中从源点起,每次挑当前距离最小的未定顶点将其'确定',并松弛其邻居。直观展示贪心 + 松弛如何逐步得到到各点的最短路径。",
    sceneCode: `
const { scene, Circle, Line, Text, MathTexImage, VGroup, Indicate, Write, FadeIn, BLUE_C, BLUE_D, BLUE_E, GOLD, GREEN, RED, WHITE, UP, DOWN } = ctx;
const title = new Text({ text: "Dijkstra:贪心选定距离最小的顶点", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

// 带权无向图:边中点标权
const P = (x, y) => [x, y, 0];
const pos = { s: P(-2.6, 1.1), a: P(0, 1.6), b: P(2.6, 1.1), c: P(-1.5, -1.3), d: P(1.5, -1.3), t: P(3.6, -1.0) };
const edges = [
  ["s", "a", 4], ["s", "c", 2], ["a", "b", 1], ["a", "c", 5], ["b", "t", 3], ["c", "d", 2], ["d", "t", 1], ["b", "d", 2],
];
for (const [u, v, w] of edges) {
  const ln = new Line({ start: pos[u], end: pos[v], color: "#3a4a5a", strokeWidth: 2 });
  scene.add(ln);
  const mid = [(pos[u][0] + pos[v][0]) / 2, (pos[u][1] + pos[v][1]) / 2, 0];
  const wt = new Text({ text: String(w), fontSize: 18, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
  wt.moveTo([mid[0] + 0.12 * (pos[v][0] - pos[u][0]), mid[1] + 0.12 * (pos[v][1] - pos[u][1]) + 0.15, 0]);
  scene.add(wt);
}
const nodeObj = {};
for (const k of Object.keys(pos)) {
  const c = new Circle({ radius: 0.34, color: BLUE_C, strokeWidth: 2, fillOpacity: 0.35 });
  const t = new Text({ text: k, fontSize: 22, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
  const vg = new VGroup(c, t);
  c.moveTo(pos[k]); t.moveTo(pos[k]);
  scene.add(vg);
  nodeObj[k] = vg;
}

const eq = new MathTexImage({ renderer: "katex", latex: "O(V^2)\\ \\text{或堆优化 }O(E\\log V)", fontSize: 23, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.5 }));

// 简短演示:源点 s 先确定(距离 0),松弛邻居 a/c
await scene.play(nodeObj.s.animate.setColor(RED));
const note = new Text({ text: "s 的距离=0,先确定;松弛邻居 a、c", fontSize: 20, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, UP, 0.32);
scene.add(note);
await scene.play(new Write(note));
await scene.play(new Indicate(nodeObj.a, { color: GOLD, duration: 0.4 }));
await scene.play(new Indicate(nodeObj.c, { color: GOLD, duration: 0.4 }));
const dLab = new Text({ text: "d(s)=0", fontSize: 18, color: RED, fontFamily: '"Times New Roman","SimSun",serif' });
dLab.nextTo(nodeObj.s, UP, 0.18);
scene.add(dLab);
await scene.play(new Write(dLab));
await scene.wait(0.8);
`.trim(),
  },

  // ================= 20. 哈希表 =================
  {
    id: "computer-hash-table",
    source: "经典 CS 教学动画改写(哈希表:数组 + 散列函数)",
    domain: "computer",
    category: "数据结构",
    title: "哈希表:散列函数定位,平均 O(1) 查找",
    intent: "用散列函数把键映射到数组下标,直接落到对应槽位。展示'键 → 下标 → 存储'的映射,解释哈希表平均 O(1) 而最坏退化为链表的原理。",
    sceneCode: `
const { scene, Rectangle, Text, MathTexImage, VGroup, Arrow, Indicate, Write, FadeIn, BLUE_C, BLUE_D, BLUE_E, GOLD, WHITE, UP, DOWN } = ctx;
const title = new Text({ text: "哈希表:散列函数定位下标", fontSize: 30, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new Write(title));

// 键(key)在上,数组槽位在下,中间一条 arrow 表示 hash 映射
const keys = ["A", "B", "C", "D"];
const hash = (c) => { const m = { A: 2, B: 0, C: 2, D: 3 }; return m[c] !== undefined ? m[c] : 1; };
const slotCount = 4;
const slotW = 1.1, slotH = 1.1;
const keyObjs = [];
const keyY = 1.6, slotY = -1.4;
const slotX0 = -((slotCount - 1) * (slotW + 0.35)) / 2;
// 槽位数组
const slots = [];
for (let i = 0; i < slotCount; i++) {
  const box = new Rectangle({ width: slotW, height: slotH, color: BLUE_C, strokeWidth: 2, fillOpacity: 0.15 });
  const t = new Text({ text: String(i), fontSize: 20, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
  box.moveTo([slotX0 + i * (slotW + 0.35), slotY, 0]);
  t.moveTo([slotX0 + i * (slotW + 0.35), slotY + slotH / 2 + 0.28, 0]);
  scene.add(box, t);
  slots.push(box);
}

// 键排列
const keysX0 = -((keys.length - 1) * 1.2) / 2;
for (let i = 0; i < keys.length; i++) {
  const bx = new Rectangle({ width: 0.9, height: 0.9, color: BLUE_D, strokeWidth: 2, fillOpacity: 0.4 });
  const t = new Text({ text: keys[i], fontSize: 24, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
  bx.moveTo([keysX0 + i * 1.2, keyY, 0]);
  t.moveTo([keysX0 + i * 1.2, keyY, 0]);
  const vg = new VGroup(bx, t);
  scene.add(vg);
  keyObjs.push({ vg, key: keys[i] });
}

const eq = new MathTexImage({ renderer: "katex", latex: "\\text{平均 }O(1)\\quad\\text{最坏 }O(n)", fontSize: 25, color: BLUE_C });
await eq.waitForRender();
eq.toEdge(DOWN, 0.2);
scene.add(eq);
await scene.play(new FadeIn(eq, { duration: 0.5 }));

const hashLab = new Text({ text: "hash(key) → 下标", fontSize: 20, color: BLUE_E, fontFamily: '"Times New Roman","SimSun",serif' });
hashLab.moveTo([3.2, (keyY + slotY) / 2, 0]);
scene.add(hashLab);
await scene.play(new Write(hashLab));

// 逐个键画映射箭头并落到对应槽
for (const ko of keyObjs) {
  const idx = hash(ko.key);
  const start = ko.vg.getCenter();
  const end = slots[idx].getCenter();
  const ar = new Arrow({ start: [start[0], start[1] - 0.5, 0], end: [end[0], end[1] + 0.5, 0], color: GOLD, strokeWidth: 2, tipLength: 0.12 });
  scene.add(ar);
  await scene.play(new Indicate(ko.vg, { color: GOLD, duration: 0.25 }));
  await scene.play(new Indicate(slots[idx], { color: GOLD, duration: 0.25 }));
}
const note = new Text({ text: "A 与 C 冲突(同一槽) → 需链表/开放寻址", fontSize: 20, color: "#a8c8e8", fontFamily: '"Times New Roman","SimSun",serif' });
note.nextTo(eq, UP, 0.32);
scene.add(note);
await scene.play(new Write(note));
await scene.wait(0.8);
`.trim(),
  },
];