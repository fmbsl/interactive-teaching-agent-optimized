import * as manimWeb from "manim-web";
import { np } from "../../src/numpyPolyfill";
import "../../src/manimPolyfill";

function matMul(a, b) {
  const isVec = (x) => !Array.isArray(x[0]);
  if (isVec(b)) { const M = a, v = b; return M.map((row) => row.reduce((s, m, i) => s + m * v[i], 0)); }
  const M = a, N = b;
  return M.map((row) => N[0].map((_, j) => row.reduce((s, m, i) => s + m * N[i][j], 0)));
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function runOne(name, code) {
  const is3D = /ThreeDAxes|Surface3D|ParametricSurface|\bSphere\b|\bCube\b|\bCone\b|\bTorus\b|Dot3D|Line3D|Arrow3D|ThreeDScene/.test(code);
  const SceneCtor = is3D ? manimWeb.ThreeDScene : manimWeb.Scene;
  let scene;
  try {
    scene = SceneCtor.createHeadless ? SceneCtor.createHeadless({ width: 800, height: 600 }) : new SceneCtor(null, { width: 800, height: 600 });
  } catch (e) {
    return { name, ok: false, err: "scene-create: " + (e?.message || String(e)).slice(0, 150) };
  }
  const alwaysRedraw = (fn) => fn();
  const ctx = { ...manimWeb, matMul, np, alwaysRedraw, scene, params: {} };
  try {
    const fn = new AsyncFunction("ctx", code);
    const p = fn(ctx);
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout-8s")), 8000));
    await Promise.race([p, timeout]);
    let meshCount = 0;
    if (scene._threeScene) scene._threeScene.traverse((o) => { if (o.isMesh) meshCount++; });
    const mobCount = scene._mobjects ? (scene._mobjects.length ?? 0) : 0;
    return { name, ok: true, is3D, meshCount, mobCount };
  } catch (e) {
    return { name, ok: false, err: (e?.message || String(e)).slice(0, 200) };
  } finally {
    try { scene.dispose?.(); } catch {}
  }
}

const target = process.argv[2];
const code = await import("fs").then((fs) => fs.readFileSync(`tools/demo/_exs_ts/${target}.ts`, "utf-8"));
const res = await runOne(target, code);
console.log(JSON.stringify(res));
