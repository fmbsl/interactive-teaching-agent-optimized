import { makeSelfBuildCtx, Scene, ThreeDScene } from "./manimCtx";
import { execScript } from "./runScript";
import { executeWithDeadline } from "./scriptExecution";
import { createVerificationScope } from "./verificationScope";
import { is3DCode, detectMathTexError, detectNaN } from "./sceneCheck";
import { codeVersionOf, verificationReport, type VerificationReport } from "./verificationTypes";
import { createLayoutTimeline } from './layoutTimeline';
import { prepareLayout } from './layoutGeometry';

/** Certify 2D final state and observed real-playback intervals. */
export async function verifyScene(code: string, params: Record<string, number>, options: {
  signal: AbortSignal; layout: boolean; vision: boolean; background: string; timeoutMs?: number;
}): Promise<VerificationReport> {
  const checks: string[] = [], missing: string[] = [];
  let version = "";
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:960px;height:540px";
  document.body.appendChild(host);
  const timeline = createLayoutTimeline();
  const reportOf: typeof verificationReport = (...args) => ({...verificationReport(...args), params: {...params}, sampling:timeline.coverage, layoutIssues:timeline.issues, overlapDeclarations:timeline.declarations});
  const scope = createVerificationScope({ Scene, ThreeDScene }, c => c instanceof HTMLElement && (c === host || host.contains(c)), options.layout ? timeline.boundary : undefined, options.layout ? timeline.register : undefined);
  const timer = setInterval(() => {
    if (options.layout) for (const e of scope.scenes) if (!e.disposed && e.kind !== 'ThreeDScene') timeline.sample(e.scene);
  }, 80);
  const controller = new AbortController();
  const abort = () => { clearInterval(timer); controller.abort(); scope.close(); host.remove(); };
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
      for (const e of scope.scenes) if (!e.disposed) {
        if (options.layout && e.kind !== 'ThreeDScene') await timeline.boundary(e.scene,true);
        else await prepareLayout(e.scene);
      }
    }, options.timeoutMs ?? 30000, controller.signal);
    if (!result.ok) return reportOf(result.status, result.error, version, checks, ["execution"]);
    checks.push("execution");
    if (!scope.scenes.length) return reportOf("incomplete", "未收集到场景；请使用 ctx.Scene/ctx.ThreeDScene 或提供的 scene", version, checks, ["scene-access"]);
    const trackedCanvases = new Set(scope.scenes.map(({ scene }) => scene.getCanvas?.() ?? scene.renderer?.getCanvas?.()));
    if ([...host.querySelectorAll("canvas")].some(canvas => !trackedCanvases.has(canvas))) {
      return reportOf("incomplete", "发现未收集的渲染画布，不能确认所有场景都经过检查", version, checks, ["scene-access"]);
    }
    for (const entry of scope.scenes) {
      const s = entry.scene;
      if (entry.disposed || !s._mobjects || typeof s._mobjects[Symbol.iterator] !== "function") {
        return reportOf("incomplete", "场景已释放或无法读取对象，未完成检查", version, checks, ["scene-access"]);
      }
      const tex = detectMathTexError(s), nan = detectNaN(s);
      if (tex || nan) return reportOf("failed", tex || nan, version, checks);
      const measurement = measureCoverage(s);
      if (measurement) return reportOf("incomplete", measurement, version, checks, ["measurements"]);
    }
    checks.push("scene-access", "mathtex", "nan", "measurements");
    if (options.layout && timeline.error) return reportOf('incomplete', timeline.error, version, checks, ['layout-temporal']);
    if (options.layout && timeline.failure) return reportOf('failed', `[layout] ${timeline.failure}; codeVersion=${version}`, version, checks);
    if (!options.layout) missing.push("layout-final", "bounds-final", "layout-temporal");
    for (const { kind } of scope.scenes) {
      if (kind === "ThreeDScene") {
        if (!missing.includes("layout-final")) missing.push("layout-final", "bounds-final", "layout-temporal");
        continue;
      }
    }
    if (missing.length) return reportOf("incomplete", options.layout ? "3D 已完成运行和对象检查，屏幕布局检查尚未覆盖" : "布局检查已关闭，本次不能完整验证", version, checks, missing);
    checks.push("layout-final", "bounds-final", "layout-temporal");
    const report = reportOf("passed", "", version, checks);
    report.sampling = timeline.coverage;
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
    return reportOf(controller.signal.aborted ? "cancelled" : "incomplete", String(error?.message || error), version, checks, ["verification"]);
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
