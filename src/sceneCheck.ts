import { inspectLayout } from './layoutGeometry';
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

// Shared projected geometry; throwing measurements are handled as incomplete by verifyScene.
export function detectOverlap(scene: any): string {
  return inspectLayout(scene).filter(x=>x.type==='overlap').slice(0,3).map(x=>x.message).join('; ');
}
export function detectOutOfBounds(scene: any): string {
  return inspectLayout(scene).filter(x=>x.type==='bounds').slice(0,3).map(x=>x.message).join('; ');
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