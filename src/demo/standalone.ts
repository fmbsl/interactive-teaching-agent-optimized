// 独立 3D 转换器演示页:不依赖 React/Django,直接用 manim-web ThreeDScene 渲染
// tools/demo/build.py 生成的 SCENE_CODE(由 py2ts.py 从 demo3d.py 转换)。
// 渲染套路同 src/components/StagePanel.tsx:ThreeDScene + ctx = {...manimWeb, matMul, scene, params} + AsyncFunction。
import * as manimWeb from "manim-web";
import { SCENE_CODE } from "./sceneCode";
import { np } from "../numpyPolyfill";
import "../manimPolyfill";

// matMul:与 src/manimCtx.ts 一致(转换器路线下 A @ B -> matMul(A,B))。
function matMul(a: number[] | number[][], b: number[] | number[][]): number[] | number[][] {
  const isVec = (x: any) => !Array.isArray(x[0]);
  if (isVec(b)) {
    const M = a as number[][];
    const v = b as number[];
    return M.map((row) => row.reduce((s, m, i) => s + m * v[i], 0));
  }
  const M = a as number[][];
  const N = b as number[][];
  return M.map((row) =>
    N[0].map((_, j) => row.reduce((s, m, i) => s + m * N[i][j], 0))
  );
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const container = document.getElementById("stage") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;
const reloadBtn = document.getElementById("reload") as HTMLButtonElement;

function size() {
  return { w: Math.max(320, window.innerWidth), h: Math.max(240, window.innerHeight) };
}

let current: any = null;

async function build() {
  try {
    if (current) {
      try { current.dispose?.(); } catch { /* ignore */ }
      current = null;
    }
    container.innerHTML = "";
    const { w, h } = size();
    const is3D = /ThreeDAxes|Surface3D|ParametricSurface|\bSphere\b|\bCube\b|\bCone\b|\bTorus\b|Dot3D|Line3D|Arrow3D|ThreeDScene/.test(SCENE_CODE);
    const SceneCtor = is3D ? (manimWeb as any).ThreeDScene : (manimWeb as any).Scene;
    const scene = new SceneCtor(container, {
      backgroundColor: "#0a0c14",
      width: w,
      height: h,
    });
    current = scene;
    (window as any).__scene = scene;
    const alwaysRedraw = (fn: any) => fn();
    const ctx: any = { ...manimWeb, matMul, np, alwaysRedraw, scene, params: {} };
    const fn = new AsyncFunction("ctx", SCENE_CODE);
    statusEl.textContent = "运行中…";
    await fn(ctx);
    statusEl.textContent = is3D ? "完成 · 可拖拽旋转 / 滚轮缩放" : "完成";
  } catch (e: any) {
    console.error("[demo] 执行失败:", e);
    statusEl.textContent = "错误: " + (e?.message || e);
  }
}

reloadBtn.addEventListener("click", build);

let resizeTimer: any;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(build, 350);
});

build();
