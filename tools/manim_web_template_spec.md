# manim-web(0.3.24)模板批量生产规范

给生成 manim-web 生产模板的子 agent 用的**唯一权威规范**。产出必须遵守本文件 + 现有已验证金标准样例(library.ts / webExamples.ts 里渲染通过的那些)。

## 目标
产出**可运行、渲染能通过 sceneCheck(不 NaN / 不重叠 / 不越界)**的 manim-web TypeScript 场景模板,覆盖数学/物理/计算机/金融/概率统计等。每个=一个教学知识点。

## 两种执行模式(二选一)
- **注入 scene(ctx 风格,推荐,暂停/断点可用)**:代码开头 `const { ...你要用的标识符, params } = ctx;` 解构,用 `await scene.play(...)` / `scene.add(...)`。`scene` 已由运行时建好。**绝大多数模板用这个**。
- **自建 scene(domain="demo",仅需自定义相机/3D/PiP 时)**:代码里 `const scene = new ThreeDScene(document.getElementById('container'), {width, height, backgroundColor, phi, theta, distance, fov, enableOrbitControls});` 或 `new Scene(container, opts)`,运行时给真 #container 并铺全局导出(import 会被剥,名字仍可用)。

## sceneCode 铁律(违反=渲染失败/被打回)
1. **解构行必须列出代码里用到的所有标识符**:方向常量 `LEFT/RIGHT/UP/DOWN/UL/UR/DL/DR/ORIGIN/IN/OUT`(shift/nextTo/moveTo 用方向时)、颜色 `BLUE/RED/YELLOW/WHITE/GOLD/...`、类 `Scene/ThreeDScene/Dot/Line/Axes/Circle/Square/Text/MathTexImage/VGroup/Arrow/ThreeDAxes/Dot3D/...`、动画 `Create/Write/FadeIn/FadeOut/Transform/GrowFromCenter/Indicate/Circumscribe/AnimationGroup/LaggedStart/LaggedStartMap/ShrinkToCenter/TransformAnimations`、函数 `easeOut/linear/easeInOut`、`makeDraggable`。**漏一个=ReferenceError**。若该步无 `params`,就别写 `params`。
2. **纯 JS,零 TS**:`(x: number)`、`as T`、`interface`、泛型 — 全禁止。
3. **公式必须用 `MathTexImage`**(KaTeX,首选)或 `MathTex`/`Tex`。`await eq.waitForRender();` **只对公式对象有效**,Text/Dot/Line 等没有此方法。含 `\overrightarrow`/`\mathcal`/动态字体的命令一律 MathTexImage。
4. **所有 Text 必带 `fontFamily: '"Times New Roman","SimSun",serif'`**(中文需 SimSun,否则不显示)。
5. **禁用数组+数组算术**:`[1,2,3]+[0.6,0,0]` 是字符串拼接。逐分量算,或 `mob.shift([dx,dy,dz])`。
6. **Transform 只同类间用**(点结构匹配),跨类先 `scene.remove(old)` 再 `FadeIn(new)`。
7. **`new VGroup()` 不要在空时 getCenter/getBoundingBox**(抛错)。构造时直接传子元 `new VGroup(a,b,c)`。
8. **改透明度用 `setFillOpacity`/`mob.opacity`,`setOpacity` 禁用**;`setStrokeOpacity` 只能即时(不 `.animate`)。`withDuration` 小写 w。
9. **`waitForRender` 只用于公式**,见 3。
10. **构图相对定位,不硬算世界坐标**:`mob.nextTo(ref, dir, buff)`(dir=UP/DOWN/LEFT/RIGHT/UL..,buff≈0.1-0.3)/`toEdge(UP/DOWN)`/`toEdge(DOWN,x)`。**禁止 `toEdge(UP).shift([4.4,-0.55,0])` 或裸 `moveTo([-5.4,1.8,0])` 硬凑**——会重叠/越界被检查打回。三区分明:顶部标题、中部主体、底部说明/公式。
11. **对象必须进场景**:对 `copy()` 副本做动画前先 `scene.add` 或靠 Create/FadeIn 进场;updater 引用的 mobject 要先 add。
12. **组定位后保持整组播放**:`VGroup.arrange/moveTo` 或 `layout.place(group,...)` 后，对 group 做 `scene.add/Create/FadeIn`；不要再单独 add/play 子对象，否则子对象会重新挂载并丢失组变换。文字和公式 `fontSize >= 20`，核心公式建议 24–32。

## 常用 API 签名(照抄,勿自己编)
- `new Axes({ xRange:[xmin,xmax,step], yRange:[...], xLength, yLength, tips:false, axisConfig:{color,strokeWidth} })`
- `axes.plot(fn, { xRange:[a,b], color, strokeWidth })`;`axes.c2p(x,y)` 数据坐标→场景坐标;`axes.getAxisLabels(xLabel, yLabel)`;`axes.getRiemannRectangles(curve, {xRange, dx, color, fillOpacity, strokeWidth})`
- `new Dot({ point:[x,y,z], radius, color })`;`new Line({ start:[..], end:[..], color, strokeWidth })`;`new Arrow({ start, end, color, strokeWidth, tipLength })`;`new Circle({ radius, color, strokeWidth, fillOpacity? })`;`new Square({ sideLength, color, strokeWidth, fillOpacity })`;`new Polygon({ vertices:[[..],[..],[..]], color, strokeWidth, fillOpacity })`;`new Text({ text, fontSize, color, fontFamily })`;`new MathTexImage({ renderer:"katex", latex, fontSize, color })`;`new VGroup(a,b,c)`/`.arrange(DOWN)`;`new Matrix(...)`
- 动画:`new Create(mob,{duration})`(描线/轮廓首选)、`new Write(mob,{duration})`(文字)、`new FadeIn/FadeOut(mob,{duration})`、`new GrowFromCenter`、`new Transform(a,b,{dur})`、`new Indicate(mob,{color})`、`new Circumscribe(mob,{color})`、`new AnimationGroup([...], {lagRatio})`、`new ShrinkToCenter`、`new TransformAnimations(anim1,anim2,{duration})`
- 交互:`new ValueTracker(init)`;`tracker.setValue(v)`;`tracker.animateTo(v,{duration,rateFunc})`;`mob.addUpdater((m)=>{...})`;`axes.c2p(...)`
- 3D:`new ThreeDScene(container,{width,height,backgroundColor,phi,theta,distance,fov,enableOrbitControls})`;`new Dot3D({radius,color})`;`new ThreeDAxes({xRange,yRange,zRange,axisColor,tipLength,tipRadius,shaftRadius})`;`new Sphere({radius,resolution,color,opacity})`;`new Arrow3D/Line3D({start,end,color})`;`scene.addFixedInFrameMobjects(text)`(Text/MathTex 可,3D 对象不可);`makeDraggable(mob,scene,{constrainX,Y,Z,onDrag,autoRender})`
- 常用色:BLUE/BLUE_C/BLUE_D/BLUE_E/GOLD/YELLOW/RED/GREEN/WHITE/GRAY/#hex。**3D 实体透明用 `opacity`**,2D 填充用 `fillOpacity`。

## 每个 Templates 条目结构(参照 webExamples.ts 的 WebExample)
```ts
{
  id: "域名-slug",           // 唯一,如 "math-taylor-series"
  source: "原生 manim-web 或 Python manim 改写(写明:如 'Python Manim 经典题材改写' / 'manim-web issue #198' 等)",
  domain: "math"|"physics"|"computer"|"finance"|"stats"|"demo",
  category: "子类(微积分/线性代数/力学/电磁/数据结构/算法/理财/概率...)",
  title: "中文标题",
  intent: "这一镜让学生看懂什么(2-3 句教学意图)",
  is3D?: true|false,
  params?: [{ name, label, min, max, step, default }],
  sceneCode: `...`,
}
```
若题目是自建 scene 的(domain 用 demo),is3D 也要给 true。

## 题材建议(可自由发挥,但要真教学点)
- **数学**:导数/积分/泰勒级数/傅里叶级数/线性变换(旋转缩放投影)/矩阵/特征向量/极限/连续/复数/向量点积叉积/参数曲线/极坐标/级数/双曲等。
- **物理**:简谐运动/单摆/弹簧振子/阻尼振动/波动(横波纵波)/声波干涉/电磁波/轨迹(抛体)/圆周运动/引力/电场磁场线/热传导/流体。
- **计算机**:排序(冒泡/快排/归并)/二叉树遍历/递归(分形如科赫雪花、谢尔宾斯基)/栈队列/链表/搜索(BFS/DFS 图)/二分查找/大O复杂度示意/进程调度。
- **金融**:复利/现值贴现/年化收益/最大回撤(drawdown)/夏普比率/蒙特卡洛模拟/资产配置/波动率/期权。
- **概率统计**:正态分布/大数定律/中心极限定理/直方图/期望方差/回归/检验/泊松分布/贝叶斯。

## 质量底线
- 至少要 1 个 Text(标题/标注)+ 尽量 1 个 MathTexImage(公式),不能用纯几何。
- 主体必须剖析一个教学点,有"开场→展开→强调/结论"的节奏,结尾保留关键结论。
- 识别主体是什么对象,别把文本/其他对象堆在同一点。**用 c2p/nextTo/toEdge 而非裸 moveTo 码坐标**。

## 文档:请先读这些再动手
- `node_modules/manim-web/dist/**/*.d.ts`(真实签名,带 doc 注释)
- 现有已验证样例:`src/templates/webExamples.ts`(非官方 3 个)和 `src/templates/library.ts` 开头几个(math 微积分),它们渲染是通的,参考其写法。

## 额外搜集的 API/题材参考(可选扩充,仍须先核对 d.ts)
- **角度演示**:`new Angle({ line1, line2, ... })`(两个 `Line` 之间画角)+ `ValueTracker` + `addUpdater` 可做"旋转角 theta 变化→ cos/sin 投影"。官方 example 有 `Angle + FadeToColor + ValueTracker` 组合。`FadeToColor(mob, { color, duration })` 存在。
- **矢量/坐标**:`addVec`/`subVec`/`scaleVec`(数学工具函数);`MathTexImage({ latex: "\\vec{v}", ... })`。
- **3b1b 经典题材(可做线性变换/傅里叶等)**:NumberPlane 风格网格、单位向量变换、`LinearTransformationScene`(python 版概念,web 版用自建函数把网格点投到矩阵变换后). 傅里叶:用 `ValueTracker(theta)` + `addUpdater` 让若干旋转向量求和画圆/轨迹。泰勒:叠加 n 次项画逼近曲线。
- **3D**:`Sphere({ radius, resolution, color, opacity })`、`Cone`/`Cylinder`、Lorenz 吸引子可用 `addUpdater` 逐步描 3D 轨迹(自建 ThreeDScene)。
- **概率**:用 `getRiemannRectangles` 近似直方图;多条 `plot(fn)` 叠加不同参数(如正态 σ)。
