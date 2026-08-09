// 纯函数场景校验工具:从 src/components/StagePanel.tsx 原样搬出,供主舞台与
// 独立模板检查页(src/templates/*)共用,避免两处维护同一份逻辑。
// 均为无副作用纯函数,搬移零行为变化。

// 检测场景代码是否需要 3D(含 3D 类则用 ThreeDScene,带 3D 相机+OrbitControls+光照)
// py2ts 把 Python 的 Surface 映射成 ParametricSurface,ThreeDScene 会被降级成 Scene
// (但 3D 对象类名保留),所以这里要覆盖 manim-web 3D 类名 + py2ts 转换后的别名(ParametricSurface)。
const THREE_D_CLASSES = [
  "ThreeDAxes", "ThreeDScene", "Surface3D", "ParametricSurface", "TexturedSurface",
  "Sphere", "Cube", "Box3D", "Cylinder", "Cone", "Torus", "Prism",
  "Dot3D", "Line3D", "Arrow3D", "Vector3D", "Polyhedron", "Tetrahedron", "Octahedron", "Icosahedron", "Dodecahedron",
];
export function is3DCode(code: string): boolean {
  return THREE_D_CLASSES.some((c) => code.includes(c));
}

// 遍历 scene 所有 mobject,查 MathTex 的 getRenderError()。
// manim-web 的 MathTex._renderPromise 用 .catch 吞掉 MathJax 错误(waitForRender 不抛),
// 但主舞台读几何时同步 MathJax retry 会抛 → 主舞台失败回退默认场景。这里提前暴露。
// 返回第一个 MathTex 渲染错误信息(无错误返回 "")。
export function detectMathTexError(scene: any): string {
  try {
    let firstErr = "";
    const visit = (m: any) => {
      if (!m || firstErr) return;
      // MathTex/Tex 有 getRenderError 方法
      if (typeof m?.getRenderError === "function") {
        const err = m.getRenderError();
        if (err) firstErr = String(err?.message || err);
      }
      const subs = m?.submobjects || m?._submobjects;
      if (Array.isArray(subs)) subs.forEach(visit);
    };
    const all = Array.from(scene._mobjects || []);
    all.forEach(visit);
    return firstErr;
  } catch { return ""; }
}

// 预检 TypeScript 语法:沙箱用 new AsyncFunction 跑纯 JS,TS 类型注解会
// 报 "Unexpected token ':'",对 LLM 不直观。命中时直接给出明确错误,让它
// 一轮删掉类型注解,而不是反复试。返回错误字符串(无问题返回 "")。
// 刻意只抓高置信模式,避免误伤合法 JS(如对象字面量 {a: 1}、三元 a ? b : c)。
export function detectTsSyntax(code: string): string {
  const hits: string[] = [];
  // 1) 变量/参数后跟类型注解: `: number`/`: string`/`: boolean`/`: any`/`: void`/`: unknown`/`: never`
  //    用 "标识符/反括号 + 空白 + :" 限定,避开对象字面量键(`{ a: 1 }` 键前无标识符尾)与三元。
  if (/\b(?:number|string|boolean|any|void|unknown|never|null|undefined|object)\b\s*(?=\[\]|\s|,|\)|;|=|{|$)/.test(code) &&
      /[:|]\s*(?:number|string|boolean|any|void|unknown|never|object)(?:\s*\[\s*\])?\b/.test(code)) {
    hits.push("TypeScript 类型注解(如 `(x: number)`、`const a: any[]`)");
  }
  // 2) `as` 类型断言: `x as number`(排除字符串里的 "as"——要求前是标识符/`)
  if (/\b[a-zA-Z_$\)\]]\s+as\s+[A-Z]/.test(code)) hits.push("`as` 类型断言");
  // 3) interface / type 别名声明
  if (/\binterface\s+[A-Z]/.test(code)) hits.push("`interface` 声明");
  if (/\btype\s+[A-Z]\w*\s*=/.test(code)) hits.push("`type` 别名声明");
  // 4) 泛型: `<T>` 或函数泛型 `<T>(x) =>`——只在行首/逗号后出现 `<大写字母` 且成对时粗判
  if (/\(\s*<[A-Z]\w*\s*[,>]/.test(code)) hits.push("泛型语法");
  if (!hits.length) return "";
  return `代码含 TypeScript 语法(${hits.join("、")}),但执行环境是纯 JavaScript。请删除所有类型注解、interface、type 别名、as 断言、泛型,只保留纯 ES 语法后重新提交。`;
}

// 只检测有几何(非空)的 mobject。返回重叠描述字符串(无重叠返回 "")。
// ⚠️ 与 detectOutOfBounds 同理:判断"是文字"用 getText()/._text 能力探测(构造名会被压缩);
//    边界用 getCenter() ± getBoundingBox() 尺寸的一半(后者返回 {width,height} 尺寸,不是 {min,max})。
// 相比早期"报第一个就停 + 只给坐标"的三处改进(针对 agent 反复盲调打回的经典死循环):
//   ① 聚合最多 3 条重叠一起报,减少来回轮数;
//   ② 报"往哪个方向移多少"(最小分离向量:沿重叠最浅的轴推出 + 边距),而非只给坐标;
//   ③ 误报过滤:只有交叠面积 > 文字面积 12% 或 文字中心压进图形 bbox(确定压住)才报。
// 实测(δ 采样/δ 逼近动画)暴露的假阳性重灾区,全部跳过作为重叠目标:
//   - 曲线/折线(getPoints 顶点 > 40):细描边,bbox 是大包络,文字在旁边不是"压住";
//   - 线段/箭头(getStart/getEnd):细描边,水平线 bbox 高为 0 本就被 collect 跳过;
//   - MathTexImage 公式(getLatex):渲染成纹理平面,验证环境下 getBoundingBox 尺寸失真
//     (实测"高度=1/ε"标签 bbox 高≈5.7 world 单位),当重叠目标必然误报;
//   - 整屏大背景(bbox 面积 > 45% 画布):文字压上去是正常布局。
// 保留:实心图形(圆/矩形/多边形/点) + 文字-文字,这两类 bbox 可靠且重叠真有意义。
export function detectOverlap(scene: any): string {
  const cam = scene?.camera;
  const frameW = typeof cam?.frameWidth === "number" ? cam.frameWidth : 14;
  const frameH = typeof cam?.frameHeight === "number" ? cam.frameHeight : 8;
  const frameArea = frameW * frameH;

  // 给非文字 mobject 分类 + 判定是否为可操作的重叠目标。构造名打包后是 t9/e62 之类,靠能力探测。
  const classify = (m: any, w: number, h: number): { label: string; skip: boolean } => {
    try {
      const pts = m.getPoints?.();
      if (Array.isArray(pts) && pts.length > 40) return { label: `曲线(${pts.length}顶点)`, skip: true };
      if (typeof m.getStart === "function" && typeof m.getEnd === "function") return { label: "线段/箭头", skip: true };
      if (typeof m.getLatex === "function") {
        let lx = "";
        try { const t = m.getLatex(); if (typeof t === "string") lx = t.slice(0, 20); } catch { /* ignore */ }
        return { label: `公式(${lx})`, skip: true };
      }
      if (w * h > 0.45 * frameArea) return { label: "大背景", skip: true };
      if (typeof m.getRadius === "function") {
        const r = m.getRadius();
        if (typeof r === "number" && isFinite(r)) return { label: `圆/弧(r≈${r.toFixed(2)})`, skip: false };
      }
      if (Array.isArray(pts) && pts.length > 0) return { label: `图形(${pts.length}顶点)`, skip: false };
      return { label: "图形对象", skip: false };
    } catch { return { label: "图形对象", skip: false }; }
  };

  const mobs: {
    label: string; isText: boolean; isAxes: boolean;
    c: { x: number; y: number };
    b: { min: { x: number; y: number }; max: { x: number; y: number } };
  }[] = [];
  try {
    const collect = (m: any) => {
      if (!m) return;
      const subs = m.submobjects || m._submobjects;
      let bb: any = null, c: any = null;
      try { bb = m.getBoundingBox?.(); } catch { /* ignore */ }
      try { c = m.getCenter?.(); } catch { /* ignore */ }
      if (c && Array.isArray(c) && bb && typeof bb.width === "number" && typeof bb.height === "number") {
        const minX = c[0] - bb.width / 2, maxX = c[0] + bb.width / 2;
        const minY = c[1] - bb.height / 2, maxY = c[1] + bb.height / 2;
        if (maxX > minX && maxY > minY) {
          const isText = typeof m.getText === "function" || typeof m._text === "string";
          // 坐标轴/数平面特有 c2p/p2c(坐标<->点转换),用它识别以忽略"轴标签相邻"误报(构造名被压缩,不能靠 name 判)
          const isAxes = typeof m.c2p === "function" || typeof m.p2c === "function";
          if (isText) {
            let label = "文字";
            try { const tx = m.getText?.(); if (typeof tx === "string") label = `文字“${tx.slice(0, 8)}”`; } catch { /* ignore */ }
            mobs.push({ label, isText, isAxes, c: { x: c[0], y: c[1] }, b: { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } } });
          } else {
            const cl = classify(m, bb.width, bb.height);
            if (cl.skip) return; // 曲线/线/公式/大背景不作重叠目标
            const cx = c[0].toFixed(1), cy = c[1].toFixed(1);
            mobs.push({ label: `${cl.label}@(${cx},${cy})`, isText, isAxes, c: { x: c[0], y: c[1] }, b: { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } } });
          }
        }
      }
      if (subs && Array.isArray(subs)) subs.forEach(collect);
    };
    (Array.from(scene._mobjects || []) as any[]).forEach(collect);
  } catch { return ""; }

  // 只报 Text 相关重叠(Text-Text 或 Text-几何),避免相邻几何误报
  const texts = mobs.filter((m) => m.isText);
  if (texts.length === 0) return "";

  const oX = (a: any, b: any) => Math.min(a.b.max.x, b.b.max.x) - Math.max(a.b.min.x, b.b.min.x);
  const oY = (a: any, b: any) => Math.min(a.b.max.y, b.b.max.y) - Math.max(a.b.min.y, b.b.min.y);
  const hit = (a: any, b: any) => oX(a, b) > 0 && oY(a, b) > 0;
  const centerInside = (a: any, b: any) => a.c.x >= b.b.min.x && a.c.x <= b.b.max.x && a.c.y >= b.b.min.y && a.c.y <= b.b.max.y;
  // 最小分离向量:沿重叠最浅的轴把文字推出 + 边距;方向 = 文字中心相对图形中心在哪侧就往哪侧继续移
  const sep = (a: any, b: any) => {
    const pX = oX(a, b), pY = oY(a, b);
    const margin = 0.15;
    if (pX <= pY) return { dirCn: a.c.x <= b.c.x ? "左" : "右", dist: pX + margin };
    return { dirCn: a.c.y <= b.c.y ? "下" : "上", dist: pY + margin };
  };

  const reports: { msg: string; sev: number }[] = [];
  const addReport = (msg: string, a: any, b: any) => {
    const areaFrac = (oX(a, b) * oY(a, b)) / ((a.b.max.x - a.b.min.x) * (a.b.max.y - a.b.min.y));
    // 文字中心压进图形 = 确定重叠(sev 更高);否则要交叠面积 > 文字面积 12% 才报,过滤"薄字形擦边"误报
    const inside = centerInside(a, b);
    if (!inside && areaFrac < 0.12) return;
    reports.push({ msg, sev: inside ? 2 + areaFrac : areaFrac });
  };

  // Text-Text 重叠
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      if (!hit(texts[i], texts[j])) continue;
      const r = sep(texts[i], texts[j]);
      addReport(`${texts[i].label} 与 ${texts[j].label} 重叠:建议往${r.dirCn}移 ${r.dist.toFixed(2)}`, texts[i], texts[j]);
    }
  }
  // Text 与非 Text 重叠(文字压在实心图形上),但忽略 axes(坐标轴常与标签相邻)
  for (const t of texts) {
    for (const m of mobs) {
      if (m.isText || m.isAxes) continue;
      if (!hit(t, m)) continue;
      const r = sep(t, m);
      addReport(`${t.label}@(≈${t.c.x.toFixed(1)},${t.c.y.toFixed(1)}) 压住 ${m.label}:建议往${r.dirCn}移 ${r.dist.toFixed(2)}`, t, m);
    }
  }
  if (!reports.length) return "";
  reports.sort((x, y) => y.sev - x.sev);
  return reports.slice(0, 3).map((r) => r.msg).join("; ");
}

// 检测文字/标注是否超出画布边缘(用户高频痛点:文字飘到可视图外被裁掉)。
// 画布边界 = camera 的 frameWidth×frameHeight(默认 14×8 world 单位)包围的[-half,+half]。
// 只报文字类 mobject(曲线/图形越界常是数学上正确的延伸,不误报)。相机/尺寸缺失(如 3D)则跳过。
// ⚠️ 判断"是文字"用 getText()/._text 能力探测——manim 的构造函数名在打包后会被压缩成
// t9 之类,不能靠 constructor.name。边界用 getCenter() ± getBoundingBox() 尺寸的一半算(后者返回 {width,height} 尺寸,不是 {min,max})。
export function detectOutOfBounds(scene: any): string {
  try {
    const cam = scene?.camera;
    if (!cam) return "";
    const fw = cam.frameWidth, fh = cam.frameHeight;
    if (typeof fw !== "number" || typeof fh !== "number" || !fw || !fh) return "";
    const hw = fw / 2, hh = fh / 2;
    const margin = 0.4; // world 单位:容忍擦边/字形外扩,避免卡边即报
    const out: string[] = [];
    const visit = (m: any) => {
      if (!m) return;
      const isText = typeof m.getText === "function" || typeof m._text === "string";
      if (isText) {
        let bb: any = null, c: any = null;
        try { bb = m.getBoundingBox?.(); } catch { /* ignore */ }
        try { c = m.getCenter?.(); } catch { /* ignore */ }
        if (c && Array.isArray(c) && bb && typeof bb.width === "number" && typeof bb.height === "number") {
          const minX = c[0] - bb.width / 2, maxX = c[0] + bb.width / 2;
          const minY = c[1] - bb.height / 2, maxY = c[1] + bb.height / 2;
          const sides: string[] = [];
          if (maxX > hw + margin) sides.push("右");
          if (minX < -hw - margin) sides.push("左");
          if (maxY > hh + margin) sides.push("上");
          if (minY < -hh - margin) sides.push("下");
          if (sides.length) {
            let label = "";
            try { const tx = m.getText?.(); if (typeof tx === "string") label = `“${tx.slice(0, 10)}”`; } catch { /* ignore */ }
            out.push(`文字${label} 越界(${sides.join("/")})`);
          }
        } else if (c && Array.isArray(c) && (c[0] > hw + margin || c[0] < -hw - margin || c[1] > hh + margin || c[1] < -hh - margin)) {
          // bbox 尺寸拿不到时退回按中心粗判
          const s = c[0] > hw + margin ? "右" : c[0] < -hw - margin ? "左" : c[1] > hh + margin ? "上" : "下";
          out.push(`文字 越界(${s})`);
        }
      }
      const subs = m.submobjects || m._submobjects;
      if (Array.isArray(subs)) subs.forEach(visit);
    };
    (Array.from(scene._mobjects || []) as any[]).forEach(visit);
    if (!out.length) return "";
    return `文字/标注超出画布边缘(${out.join("、")}):把标注 moveTo/nextTo 移到画布内,或缩小字号,勿让文字飘出可视区`;
  } catch { return ""; }
}

// 检测画面是否含 NaN(标签文字或对象坐标)。常见于角度/参数计算错:ValueTracker 未初始化、
// 弧度换算缺 Math.PI/180、除零、np 向量化误用等。NaN 会让标签显示 "NaN°" 或对象消失,
// agent 不自查很难发现--这里主动报出来给明确方向,避免反复盲试(实测案例:转角 NaN° 打回多次)。
export function detectNaN(scene: any): string {
  try {
    const out: string[] = [];
    const visit = (m: any) => {
      if (!m) return;
      try {
        const c = m.getCenter?.();
        if (c && Array.isArray(c) && (Number.isNaN(c[0]) || Number.isNaN(c[1]) || Number.isNaN(c[2]))) {
          out.push("某对象坐标为 NaN");
        }
      } catch { /* ignore */ }
      if (typeof m.getText === "function") {
        try {
          const tx = m.getText();
          if (typeof tx === "string" && /NaN/i.test(tx)) out.push(`标签含 NaN(“${tx.slice(0, 20)}”)`);
        } catch { /* ignore */ }
      }
      const subs = m.submobjects || m._submobjects;
      if (Array.isArray(subs)) subs.forEach(visit);
    };
    (Array.from(scene._mobjects || []) as any[]).forEach(visit);
    if (!out.length) return "";
    return `画面含 NaN(${out.join("、")}):通常是角度/参数计算错误--检查 ValueTracker 是否已初始化、弧度换算(Math.PI/180)、除数与 np 向量化,确保为有限值`;
  } catch { return ""; }
}