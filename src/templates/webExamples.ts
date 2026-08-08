// =============================================================================
// 网上搜集的 manim-web(非官方)example 模板库 —— 供独立审阅页(web-examples.html)逐个检查。
//
// 来源(已排除项目自带的官方 example,tools/demo/_mw_exs):
//   • GitHub maloyan/manim-web Issues 里社区贴的真实可运行代码
//   • SitePoint 教程(API 需对照 d.ts 改写)
//   • Reddit / HN 发布信息提炼的 API 用法
//
// ⚠️ 可靠性声明:每个模板都对照本项目锁定的 manim-web 0.3.24 的
//   node_modules/manim-web/dist/**/*.d.ts 校验过 API(签名真实存在才收录),
//   但「可运行」仍需在审阅页离屏渲染 + sceneCheck 验证。
//
// 两种执行模式(与 TemplateReview 一致):
//   • selfBuild=true(domain="demo") → 自由脚本:给真 #container,manim-web 导出铺全局,
//     代码自建 Scene/ThreeDScene(相机/3D/PiP 全保留)。
//   • selfBuild=false(domain="math"/"physics") → 注入 scene 的 ctx 函数体(固定舞台,
//     附带段间暂停/断点)。
// =============================================================================

export interface WebExampleParam {
  name: string; label: string; min: number; max: number; step: number; default: number;
}
export interface WebExample {
  id: string;
  source: string;        // 来源链接/出处
  domain: "math" | "physics" | "computer" | "finance" | "stats" | "demo";
  category: string;      // 手法分类:可交互 / 动画蜕变 / 几何证明 ...
  title: string;         // 中文标题
  intent: string;        // 这一镜演示什么 manim-web 能力/教学点
  is3D?: boolean;
  params?: WebExampleParam[];
  sceneCode: string;
}

import { HANDWRITTEN_WEB_EXAMPLES } from "./gen/handwritten";
import { FINANCE_WEB_EXAMPLES } from "./gen/finance";

export const WEB_EXAMPLES: WebExample[] = [
  // ================= 1. 3D 可拖拽向量点(来源:GitHub Issue #198,社区实测代码)=================
  {
    id: "web-3d-draggable-dot",
    source: "maloyan/manim-web Issue #198(社区实测可跑,https://github.com/maloyan/manim-web/issues/198)",
    domain: "demo",
    category: "可交互 · 3D",
    title: "3D 空间点可拖拽 + 实时 3D 坐标",
    intent: "在 ThreeDScene 里放一个 Dot3D,用 makeDraggable 让它可被鼠标拖拽,旁边 Text 实时显示 3D 坐标；再加 ThreeDAxes 与固定屏幕角度的标题文字。演示「浏览器实时可交互」与 3D 相机(distance/fov/phi/theta)的配合。",
    is3D: true,
    sceneCode: `
// —— 自建 ThreeDScene(自由脚本模式):真 #container + 铺全局导出。Source: GitHub Issue #198 ——
const scene = new ThreeDScene(document.getElementById('container'), {
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#191919',
  phi: 75 * (Math.PI / 180),
  theta: -45 * (Math.PI / 180),
  distance: 20,
  fov: 30,
  enableOrbitControls: false,
});
const dot = new Dot3D({ radius: 0.2, color: YELLOW });
scene.add(dot);
makeDraggable(dot, scene);
// Dummy updater —— tricks the scene into keeping its render loop alive
dot.addUpdater(() => {});
const axes = new ThreeDAxes({
  xRange: [-6, 6, 1],
  yRange: [-5, 5, 1],
  zRange: [-4, 4, 1],
  axisColor: '#ffffff',
  tipLength: 0.3,
  tipRadius: 0.12,
  shaftRadius: 0.008,
});
const text3d = new Text({ text: '3D 可拖拽点(拖动物体试试)', fontSize: 26, color: '#ffffff', fontFamily: '"Times New Roman","SimSun",serif' });
scene.addFixedInFrameMobjects(text3d);
text3d.toCorner(UL);
scene.add(axes);
await scene.wait(999999);
`,
  },

  // ================= 2. TransformAnimations:一个动画蜕变成另一个(来源:Issue #157)=================
  {
    id: "web-transform-animations",
    source: "maloyan/manim-web Issue #157(transform 模块,TransformAnimations meta-animation,https://github.com/maloyan/manim-web/issues/157)",
    domain: "math",
    category: "动画蜕变",
    title: "TransformAnimations:动画 ⇄ 动画 平滑蜕变",
    intent: "演示 manim-web 的 meta-animation TransformAnimations:把「展开一个圆」的 Create 动画平滑蜕变成「把它收成一个点」的 ShrinkToCenter 动画,中间经过插值。这是官方 example 之外的进阶动画组合手法。",
    params: [{ name: "dur", label: "蜕变时长", min: 1, max: 4, step: 0.2, default: 2 }],
    sceneCode: `
const { scene, Circle, Dot, Text, Create, ShrinkToCenter, TransformAnimations, FadeIn, FadeOut, GOLD, BLUE, WHITE, UP, params } = ctx;
const title = new Text({ text: "TransformAnimations:Create ⇄ ShrinkToCenter", fontSize: 26, color: WHITE, fontFamily: '"Times New Roman","SimSun",serif' });
title.toEdge(UP);
scene.add(title);
await scene.play(new FadeIn(title, { duration: 0.5 }));

const circle = new Circle({ radius: 1.6, color: BLUE, strokeWidth: 3 });
const dot = new Dot({ radius: 0.12, color: GOLD });
scene.add(circle);
scene.add(dot);

const createAnim = new Create(circle, { duration: params.dur });
const shrinkAnim = new ShrinkToCenter(dot, { duration: params.dur });
// 把"描绘圆"的动画平滑蜕变成"把点收成中心"的动画
const metaAnim = new TransformAnimations(createAnim, shrinkAnim, { duration: params.dur });
await scene.play(metaAnim);
await scene.wait(0.8);
await scene.play(new FadeOut(circle, { duration: 0.6 }));
await scene.play(new FadeOut(title, { duration: 0.4 }));
`,
  },

  // ================= 3. 勾股定理证明(来源:SitePoint 教程,已对照 d.ts 改写为真实 ctx API)=================
  {
    id: "web-pythagorean",
    source: "SitePoint《Manim-Web in React》(分镜思路;原作者自述 API 为综合占位,此处按本项目 manim-web 0.3.24 d.ts 改写,https://www.sitepoint.com/manim-web-3blue1brown-mathematical-animations-react)",
    domain: "math",
    category: "几何证明",
    title: "勾股定理:三边构造正方形 → 面积切割证明 a² + b² = c²",
    intent: "直角三角形的三边各构造一个正方形,用 GrowFromCenter/Write 展示面积,最后 Indicate 强调 直角边上两正方形面积之和等于斜边正方形 —— 视觉化证明勾股定理。教学分镜结构与 SitePoint 一致。",
    params: [{ name: "sideA", label: "直角边 a", min: 2, max: 4, step: 0.25, default: 3 }],
    sceneCode: `
const { scene, Polygon, Square, Line, Text, MathTexImage, VGroup, GrowFromCenter, Write, FadeIn, Indicate, AnimationGroup, WHITE, BLUE, GOLD, RED, UP, DOWN, LEFT, RIGHT, ORIGIN, params } = ctx;
const S = 0.55; // 整体缩放,保证整幅拼图在 14×8 大画布内不越界
const a = params.sideA * S;
const b = a * 0.75;
const c = Math.sqrt(a * a + b * b);

// 直角三角形顶点(直角在左下)
const tri = new Polygon({ vertices: [[0, 0, 0], [a, 0, 0], [0, b, 0]], color: WHITE, strokeWidth: 2.5, fillOpacity: 0.12 });
scene.add(tri);

// 三边正方形(边向下 / 向左 / 斜边旋转)
const sqA = new Square({ sideLength: a, color: BLUE, strokeWidth: 2, fillOpacity: 0.25 }).moveTo([a / 2, -a / 2, 0]);
const sqB = new Square({ sideLength: b, color: GOLD, strokeWidth: 2, fillOpacity: 0.25 }).moveTo([-b / 2, b / 2, 0]);
const hypMid = [a / 2, b / 2, 0];
const angle = Math.atan2(b, a);
const sqC = new Square({ sideLength: c, color: RED, strokeWidth: 2, fillOpacity: 0.25 });
sqC.rotate(angle);
sqC.moveTo([hypMid[0] + (c / 2) * Math.sin(angle), hypMid[1] + (c / 2) * Math.cos(angle), 0]);

scene.add(sqA, sqB, sqC);
await scene.play(new GrowFromCenter(sqA, { duration: 0.8 }));
await scene.play(new GrowFromCenter(sqB, { duration: 0.8 }));
await scene.play(new GrowFromCenter(sqC, { duration: 0.8 }));

// 强调:两小正方形面积和 = 大正方形(勾股定理)
await scene.play(new Indicate(sqA, { color: GOLD }));
await scene.play(new Indicate(sqB, { color: GOLD }));
await scene.play(new Indicate(sqC, { color: RED }));

const eq = new MathTexImage({ renderer: "katex", latex: "a^2+b^2 = c^2", fontSize: 28, color: WHITE });
await eq.waitForRender();
eq.toEdge(DOWN, 0.1);
scene.add(eq);
await scene.play(new Write(eq, { duration: 0.9 }));
await scene.wait(0.6);
`,
  },
];

// ---- 聚合:主 agent 手工精修 + 各领域批量产出的模板(其余领域文件生成后追加)----
WEB_EXAMPLES.push(...HANDWRITTEN_WEB_EXAMPLES);
WEB_EXAMPLES.push(...FINANCE_WEB_EXAMPLES);