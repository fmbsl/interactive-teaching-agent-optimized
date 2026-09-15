import { makeSelfBuildCtx, Scene, ThreeDScene } from "./manimCtx";
import { execScript } from "./runScript";
import { executeWithDeadline } from "./scriptExecution";
import { createVerificationScope } from "./verificationScope";
import { is3DCode, detectMathTexError, detectNaN, detectOverlap, detectOutOfBounds } from "./sceneCheck";
import { codeVersionOf, verificationReport, type VerificationReport } from "./verificationTypes";

/** A: certify final-state coverage only. Temporal and formula-specific layout are batch B. */
export async function verifyScene(code: string, params: Record<string, number>, options: {
  signal: AbortSignal; layout: boolean; vision: boolean; background: string; timeoutMs?: number;
}): Promise<VerificationReport> {
  const checks: string[] = [], missing: string[] = [];
  let version = "";
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:960px;height:540px";
  document.body.appendChild(host);
  const scope = createVerificationScope({ Scene, ThreeDScene }, c => c instanceof HTMLElement && (c === host || host.contains(c)));
  const controller = new AbortController();
  const abort = () => { controller.abort(); scope.close(); host.remove(); };
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  try {
    version = await codeVersionOf(code);
    const ctx: any = { ...makeSelfBuildCtx(host, params), ...scope.bindings };
    let injected: any;
    // Lazy injection lets arbitrary constructor aliases use the exact same path.
    Object.defineProperty(ctx, "scene", { get() {
      return injected ??= new scope.bindings[is3DCode(code) ? "ThreeDScene" : "Scene"](host, {
        width: 960, height: 540, backgroundColor: options.background,
      });
    } });
    const result = await executeWithDeadline(async () => {
      const execution = await execScript(ctx, code, options.timeoutMs ?? 30000, {
        signal: controller.signal, bindings: { ...scope.bindings, container: host },
      });
      if (!execution.ok) throw Object.assign(new Error(execution.error), { verificationStatus: execution.status });
      await scope.drain();
    }, options.timeoutMs ?? 30000, controller.signal);
    if (!result.ok) return verificationReport(result.status, result.error, version, checks, ["execution"]);
    checks.push("execution");
    if (!scope.scenes.length) return verificationReport("incomplete", "未收集到场景；请使用 ctx.Scene/ctx.ThreeDScene 或提供的 scene", version, checks, ["scene-access"]);
    const trackedCanvases = new Set(scope.scenes.map(({ scene }) => scene.getCanvas?.() ?? scene.renderer?.getCanvas?.()));
    if ([...host.querySelectorAll("canvas")].some(canvas => !trackedCanvases.has(canvas))) {
      return verificationReport("incomplete", "发现未收集的渲染画布，不能确认所有场景都经过检查", version, checks, ["scene-access"]);
    }
    for (const entry of scope.scenes) {
      const s = entry.scene;
      if (entry.disposed || !s._mobjects || typeof s._mobjects[Symbol.iterator] !== "function") {
        return verificationReport("incomplete", "场景已释放或无法读取对象，未完成检查", version, checks, ["scene-access"]);
      }
      const tex = detectMathTexError(s), nan = detectNaN(s);
      if (tex || nan) return verificationReport("failed", tex || nan, version, checks);
      const measurement = measureCoverage(s);
      if (measurement) return verificationReport("incomplete", measurement, version, checks, ["measurements"]);
    }
    checks.push("scene-access", "mathtex", "nan", "measurements");
    if (!options.layout) missing.push("layout-final", "bounds-final");
    for (const { scene: s, kind } of scope.scenes) {
      if (kind === "ThreeDScene") {
        if (!missing.includes("layout-final")) missing.push("layout-final", "bounds-final");
        continue;
      }
      if (!options.layout) continue;
      const overlap = detectOverlap(s), outside = detectOutOfBounds(s);
      if (overlap || outside) return verificationReport("failed", overlap || outside, version, checks);
    }
    if (missing.length) return verificationReport("incomplete", options.layout ? "3D 已完成运行和对象检查，屏幕布局检查尚未覆盖" : "布局检查已关闭，本次不能完整验证", version, checks, missing);
    checks.push("layout-final", "bounds-final");
    const report = verificationReport("passed", "", version, checks);
    if (options.vision) {
      try {
        const s = scope.scenes[0].scene;
        const canvas = s.getCanvas?.() ?? s.renderer?.getCanvas?.() ?? host.querySelector("canvas");
        report.frame = canvas?.toDataURL("image/png") || "";
      } catch { /* Optional visual assistance is not part of geometry certification. */ }
      if (!report.frame) report.missing.push("optional-visual-frame");
    }
    return report;
  } catch (error: any) {
    return verificationReport(controller.signal.aborted ? "cancelled" : "incomplete", String(error?.message || error), version, checks, ["verification"]);
  } finally {
    options.signal.removeEventListener("abort", abort);
    abort();
  }
}

/** Detect missing/throwing geometry APIs before legacy detectors can swallow them. */
export function measureCoverage(scene: any): string {
  if (![scene.camera?.frameWidth, scene.camera?.frameHeight].every(n => Number.isFinite(n) && n > 0)) return "相机尺寸不可测量";
  const objects = [...scene._mobjects];
  if (!objects.length) return "结束场景为空，无法验证布局";
  const visited = new Set<any>();
  const visit = (m: any): void => {
    if (visited.has(m)) return;
    visited.add(m);
    const bb = m.getBoundingBox?.(), center = m.getCenter?.();
    if (!bb || !Array.isArray(center) || center.length < 2 ||
      ![bb.width, bb.height, center[0], center[1]].every(Number.isFinite) || bb.width < 0 || bb.height < 0) throw new Error("对象边界不可测量");
    // Legacy detectors suppress getter errors; missing observations must not pass.
    if (typeof m.getText === "function") m.getText();
    if (typeof m.getLatex === "function") m.getLatex();
    if (typeof m.getRenderError === "function") m.getRenderError();
    for (const child of m.submobjects || m._submobjects || []) visit(child);
  };
  try { objects.forEach(visit); return ""; }
  catch (error: any) { return `测量未完成：${String(error?.message || error)}`; }
}
