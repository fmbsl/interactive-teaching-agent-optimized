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
export function detectOverlap(scene: any): string {
  const mobs: { label: string; isText: boolean; isAxes: boolean; b: { min: { x: number; y: number }; max: { x: number; y: number } } }[] = [];
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
          // 非文字没有可读名(构造名会被压缩成 t9/e62 之类),统一报"图形对象";文字带内容
          let label = isText ? "文字" : "图形对象";
          if (isText) { try { const tx = m.getText?.(); if (typeof tx === "string") label = `文字“${tx.slice(0, 8)}”`; } catch { /* ignore */ } }
          mobs.push({ label, isText, isAxes, b: { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } } });
        }
      }
      if (subs && Array.isArray(subs)) subs.forEach(collect);
    };
    (Array.from(scene._mobjects || []) as any[]).forEach(collect);
  } catch { return ""; }
  // 只报 Text 相关重叠(Text-Text 或 Text-几何),避免相邻几何误报
  const texts = mobs.filter((m) => m.isText);
  if (texts.length === 0) return "";
  const overlap = (a: any, b: any) =>
    a.min.x < b.max.x && a.max.x > b.min.x && a.min.y < b.max.y && a.max.y > b.min.y;
  // Text-Text 重叠
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      if (overlap(texts[i].b, texts[j].b)) return `${texts[i].label} 与 ${texts[j].label} 重叠`;
    }
  }
  // Text 与非 Text 重叠(文字压在图形上),但忽略 axes(坐标轴常与标签相邻)
  for (const t of texts) {
    for (const m of mobs) {
      if (m.isText) continue;
      if (m.isAxes) continue;
      if (overlap(t.b, m.b)) {
        // 报出文字的中心坐标,让 agent 知道往哪个方向挪(盲调坐标轴标签是反复打回的经典死循环)
        const cx = ((t.b.min.x + t.b.max.x) / 2).toFixed(1);
        const cy = ((t.b.min.y + t.b.max.y) / 2).toFixed(1);
        return `${t.label}@(≈${cx},${cy}) 与 ${m.label} 重叠`;
      }
    }
  }
  return "";
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