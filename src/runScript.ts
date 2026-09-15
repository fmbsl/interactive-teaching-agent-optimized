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

import { adaptColorLiterals } from "./themeColor";
import { ensureManimGlobals } from "./manimCtx";
import { executeWithDeadline, type ExecutionOutcome } from "./scriptExecution";

const AsyncFunctionCtor = Object.getPrototypeOf(async function () {}).constructor;

/** 剥掉 `import ... from '...'` 与 `export` 前缀(跨行 import 也处理)。manim-web 导出已铺全局。 */
export function stripBareImports(code: string): string {
  let s = code;
  // import { ... } from '...'; 或 import * as X from '...'; 或 import X from '...'; 可能跨行
  s = s.replace(/\bimport\s+[\s\S]*?from\s*['"][^'"]*['"]\s*;?/g, () => {
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

/** 用 sucrase 把 TS 剥成(基本)纯 JS:精确去类型、安全处理对象字面量/三元等。
 * 比 typescript 轻(纯 JS 浏览器可用、体积小一个量级、更快);只处理"剥类型+少量 TS 语法",
 * 输入已是 stripBareImports 后的代码,不含 import。 */
export async function transpileTS(code: string, _callBackup?: (fn: () => void) => void): Promise<string> {
  const { transform } = await import("sucrase");
  const out = transform(code, { transforms: ["typescript"], production: true });
  return out.code ?? code;
}

/** 是否"自建场景"代码:代码里自己 new Scene/ThreeDScene(而非用注入的 scene)。
 * 自建场景时用自由脚本模式(给真 container + 全局导出),暂停/断点降级为连播。 */
export function isSelfBuildCode(code: string): boolean {
  if (/new\s+(?:(?:ctx|window)\.)?(?:Scene|ThreeDScene)\s*\(/.test(code)) return true;
  // Playback routing hint only; validation collects real constructors independently.
  const aliases = [
    ...code.matchAll(/\b(?:Scene|ThreeDScene)\s*:\s*([A-Za-z_$][\w$]*)/g),
    ...code.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*ctx\.(?:Scene|ThreeDScene)\b/g),
  ];
  return aliases.some(match => {
    const alias = match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\bnew\\s+${alias}\\s*\\(`).test(code);
  });
}

export type ExecResult = ExecutionOutcome & { code?: string };
export interface ExecOptions { signal?: AbortSignal; bindings?: Record<string, unknown> }

/**
 * 执行一段脚本。流程:剥 import → 先按纯 JS 用 AsyncFunction 直跑(快路径,不加载 TS 编译器)
 * → 若语法错(极可能是带类型注解),懒加载 typescript 转译后重跑。
 * @param ctx 传给代码的上下文(模板检查页:self-build 传 {container, params,...};主应用传注入 scene 的 ctx)
 * @param code 脚本字符串
 * @param timeoutMs 协作式截止时间；超时为未完成，不算通过，也不能抢占同步死循环。
 */
export async function execScript(ctx: any, code: string, timeoutMs = 40000, options: ExecOptions = {}): Promise<ExecResult> {
  // 兜底:把 manim-web 导出铺到 window 全局,LLM 忘在解构行列出 LEFT/RIGHT/DOWN/UP/颜色/类名时能从全局拿到
  ensureManimGlobals();
  // 颜色字面量浅色兜底(adaptColorLiterals 内部会判断是否浅色背景;非浅色则原样返回)
  let js = stripBareImports(adaptColorLiterals(code));
  let fn: any;
  // Lexical bindings avoid mutating global constructors while multiple scenes run.
  const compile = (source: string) => {
    const bindings = options.bindings || {};
    return new Function(...Object.keys(bindings), `return async function(ctx) {\n${source}\n}`)(...Object.values(bindings));
  };
  try {
    fn = options.bindings ? compile(js) : new AsyncFunctionCtor("ctx", js);
  } catch (e: any) {
    // 直跑语法错(多半带 TS 注解)→ 转译后重试
    let tjs: string;
    try {
      tjs = await transpileTS(js);
    } catch (te: any) {
      return { ok: false, status: "failed", error: "TS 转译失败: " + String(te?.message || te), code: js };
    }
    try {
      fn = options.bindings ? compile(tjs) : new AsyncFunctionCtor("ctx", tjs);
    } catch (e2: any) {
      return { ok: false, status: "failed", error: "代码(转译后)仍非合法 JS,无法执行: " + String(e2?.message || e2), code: tjs };
    }
    js = tjs;
  }
  return { ...await executeWithDeadline(() => fn(ctx), timeoutMs, options.signal), code: js };
}
