// 共享脚本执行层(自由脚本运行时)。
// 让运行时"整套厨房"地执行 sceneCode:支持 TS+JS、import 剥除、自建 scene、helper/数据。
// 供模板检查页(src/templates/*)与主应用 StagePanel 共用,统一超时/错误处理。
//
// 为什么需要这里:
//  - `new AsyncFunction` 只认纯 JS(浏览器无法原生跑带类型的 TS);
//  - LLM / 官方 example 可能写 TS、带 import、自己 new Scene(container, {...相机}),
//    这些都在运行字符串里,没有构建期。所以运行时做:
//      剥 import/export(标识符由 manimCtx 铺到全局可用)→ 尝试直跑 → 语法错(含 TS)则
//      懒加载 typescript 转译剥类型后重跑。

const AsyncFunctionCtor = Object.getPrototypeOf(async function () {}).constructor;

/** 剥掉 `import ... from '...'` 与 `export` 前缀(跨行 import 也处理)。manim-web 导出已铺全局。 */
export function stripBareImports(code: string): string {
  let s = code;
  // import { ... } from '...'; 或 import * as X from '...'; 或 import X from '...'; 可能跨行
  s = s.replace(/\bimport\s+[\s\S]*?from\s*['"][^'"]*['"]\s*;?/g, (m) => {
    // 保留其中的纯类型/空,但整段 import 剥掉(名字已在全局)
    return "";
  });
  // 残余的裸 import(未匹配 from 的)
  s = s.replace(/^[ \t]*import\s+[^\n]*$/gm, "");
  // export const / export function / export default / export ... (去掉 export 前缀)
  s = s.replace(/^[ \t]*export\s+(?=(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class)\b)/gm, "");
  s = s.replace(/^[ \t]*export\s+default\s+/gm, "");
  return s;
}

/** 用 typescript transpileModule 把 TS 剥成(基本)纯 JS:精确去类型,不用正则,安全处理对象字面量/三元等。 */
export async function transpileTS(code: string, callBackup?: (fn: () => void) => void): Promise<string> {
  const ts: any = await import("typescript");
  const out = ts.transpileModule(code, {
    fileName: "scene.ts",
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      isolatedModules: true,
      reportDiagnostics: false,
      jsx: ts.JsxEmit.None,
    },
    reportDiagnostics: false,
  });
  return out.outputText ?? code;
}

/** 是否"自建场景"代码:代码里自己 new Scene/ThreeDScene(而非用注入的 scene)。
 * 自建场景时用自由脚本模式(给真 container + 全局导出),暂停/断点降级为连播。 */
export function isSelfBuildCode(code: string): boolean {
  return /new\s+(?:Scene|ThreeDScene)\s*\(/.test(code);
}

export type ExecResult =
  | { ok: true; timedOut?: boolean; code: string }
  | { ok: false; error: string; code?: string };

/**
 * 执行一段脚本。流程:剥 import → 先按纯 JS 用 AsyncFunction 直跑(快路径,不加载 TS 编译器)
 * → 若语法错(极可能是带类型注解),懒加载 typescript 转译后重跑。
 * @param ctx 传给代码的上下文(模板检查页:self-build 传 {container, params,...};主应用传注入 scene 的 ctx)
 * @param code 脚本字符串
 * @param timeoutMs 超时(长动画/卡死的兜底;超时视为通过,仅标记 timedOut)
 */
export async function execScript(ctx: any, code: string, timeoutMs = 40000): Promise<ExecResult> {
  let js = stripBareImports(code);
  let fn: any;
  try {
    fn = new AsyncFunctionCtor("ctx", js);
  } catch (e: any) {
    // 直跑语法错(多半带 TS 注解)→ 转译后重试
    let tjs: string;
    try {
      tjs = await transpileTS(js);
    } catch (te: any) {
      return { ok: false, error: "TS 转译失败: " + String(te?.message || te), code: js };
    }
    try {
      fn = new AsyncFunctionCtor("ctx", tjs);
    } catch (e2: any) {
      return { ok: false, error: "代码(转译后)仍非合法 JS,无法执行: " + String(e2?.message || e2), code: tjs };
    }
    js = tjs;
  }
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("__exec_timeout__")), timeoutMs));
  try {
    await Promise.race([fn(ctx), timeout]);
    return { ok: true, code: js };
  } catch (e: any) {
    if (String(e?.message) === "__exec_timeout__") return { ok: true, timedOut: true, code: js };
    return { ok: false, error: String(e?.message || e), code: js };
  }
}