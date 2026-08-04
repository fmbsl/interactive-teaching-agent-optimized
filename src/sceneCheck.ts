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
export function detectOverlap(scene: any): string {
  const mobs: { name: string; isText: boolean; b: { min: { x: number; y: number }; max: { x: number; y: number } } }[] = [];
  try {
    const collect = (m: any) => {
      if (!m) return;
      const subs = m.submobjects || m._submobjects;
      let b: any = null;
      try { b = m.getBoundingBox?.() ?? m.getBounds?.(); } catch { /* empty mobject */ }
      if (b && b.min && b.max && (b.max.x > b.min.x) && (b.max.y > b.min.y)) {
        const nm = m.constructor?.name || "";
        const isText = /Text|Tex|MathTex|Label/i.test(nm);
        mobs.push({ name: nm, isText, b: { min: { x: b.min.x, y: b.min.y }, max: { x: b.max.x, y: b.max.y } } });
      }
      if (subs && Array.isArray(subs)) subs.forEach(collect);
    };
    const all = Array.from(scene._mobjects || []);
    all.forEach(collect);
  } catch { return ""; }
  // 只报 Text 相关重叠(Text-Text 或 Text-几何),避免相邻几何误报
  const texts = mobs.filter((m) => m.isText);
  if (texts.length === 0) return "";
  const overlap = (a: any, b: any) =>
    a.min.x < b.max.x && a.max.x > b.min.x && a.min.y < b.max.y && a.max.y > b.min.y;
  // Text-Text 重叠
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      if (overlap(texts[i].b, texts[j].b)) return `${texts[i].name} 与 ${texts[j].name} 重叠`;
    }
  }
  // Text 与非 Text 重叠(文字压在图形上),但忽略 axes(坐标轴常与标签相邻)
  for (const t of texts) {
    for (const m of mobs) {
      if (m.isText) continue;
      if (/Axes|NumberPlane|Axis/i.test(m.name)) continue;
      if (overlap(t.b, m.b)) return `${t.name} 与 ${m.name} 重叠`;
    }
  }
  return "";
}