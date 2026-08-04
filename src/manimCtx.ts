// 隔离 manim-web 全量导入,避免在 React 组件文件里 `import * as manimWeb`
// 破坏 React Fast Refresh(manymon-web 导出大量非组件函数/常量,Fast Refresh 失去边界,
// 导致 store 的 useState 更新不触发渲染)。
// 把 namespace import 留在本模块内部,只导出函数 + buildDefaultScene 需要的具名类,
// 不导出 namespace 对象本身,切断 manim-web HMR 对 React 树的污染。
import * as manimWeb from "manim-web";
import { np } from "./numpyPolyfill";
import "./manimPolyfill";

export type SceneLike = import("manim-web").Scene;

/** 构造前端执行 ctx:manim-web 全部命名导出 + scene + params + matMul。
 * 转换器路线下,后端 code 开头 `const {...} = ctx;` 解构出它 import 的标识符。 */
export function makeManimCtx(scene: SceneLike, params: Record<string, number>) {
  const alwaysRedraw = (fn: any) => fn(); // manim CE always_redraw 简化:取首帧静态(非每帧重算)
  return { ...manimWeb, matMul, np, alwaysRedraw, scene, params };
}

/** 自由脚本运行时:把 manim-web 全部导出 + 一个容器铺到 window 全局,
 * 让 `import {X} from 'manim-web'`(被剥掉后)的名字与 `container` 在脚本里直接可用,
 * 代码可自己 new Scene(container, {相机...}) 建场景,不必受注入 scene 约束。
 * 顶多执行一次(幂等)。在 manimCtx 内部做,保持 namespace import 的 Fast Refresh 隔离。 */
export function exposeManimGlobals(container: HTMLElement) {
  const w = window as any;
  w.container = container;
  for (const k of Object.keys(manimWeb)) {
    try { w[k] = (manimWeb as any)[k]; } catch { /* 个别只读/符号跳过 */ }
  }
  w.matMul = matMul;
  w.np = np;
}

/** 矩阵乘法:支持矩阵×矩阵、矩阵×向量(JS 没有 @ 运算符,py2ts 也不转,
 * 转换器路线下 LLM 常写 A @ B,适配层把 ` @ ` 替换成 matMul 调用)。
 * M 为二维数组,v 为一维数组。 */
export function matMul(a: number[] | number[][], b: number[] | number[][]): number[] | number[][] {
  const isVec = (x: any) => !Array.isArray(x[0]);
  if (isVec(b)) {
    // 矩阵 × 向量
    const M = a as number[][];
    const v = b as number[];
    return M.map((row) => row.reduce((s, m, i) => s + m * v[i], 0));
  }
  // 矩阵 × 矩阵
  const M = a as number[][];
  const N = b as number[][];
  return M.map((row) =>
    N[0].map((_, j) => row.reduce((s, m, i) => s + m * N[i][j], 0))
  );
}

// buildDefaultScene 用的具名类(从 namespace 里挑出,避免组件文件直接 import 整包)
export const {
  Scene, ThreeDScene, Axes, Dot, Line, Text, ValueTracker, Create, FadeIn,
} = manimWeb;
