import { AnimationGroup } from "manim-web";
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
  signal: AbortSignal; vision: boolean; background: string;
  checks: {
    sceneAccess: boolean; measurements: boolean; mathtex: boolean; nan: boolean;
    finalLayout: boolean; temporalLayout: boolean;
  };
  skip3DLayout?: boolean; timeoutMs?: number;
}): Promise<VerificationReport> {
  const checks: string[] = [], missing: string[] = [];
  const selected = options.checks;
  const skip = (name: string) => { checks.push(`user-skipped:${name}`); missing.push(name); };
  const needsPreparedScene = selected.measurements || selected.mathtex || selected.finalLayout || selected.temporalLayout || options.vision;
  let version = "";
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:960px;height:540px";
  document.body.appendChild(host);
  const timeline = createLayoutTimeline();
  const reportOf: typeof verificationReport = (...args) => ({...verificationReport(...args), params: {...params}, sampling:timeline.coverage, layoutIssues:timeline.issues, overlapDeclarations:timeline.declarations});
  const scope = createVerificationScope(
    { Scene, ThreeDScene },
    c => c instanceof HTMLElement && (c === host || host.contains(c)),
    selected.temporalLayout ? timeline.boundary : undefined,
    selected.temporalLayout ? timeline.register : undefined,
  );
  const timer = selected.temporalLayout ? setInterval(() => {
    if (selected.temporalLayout) for (const e of scope.scenes) if (!e.disposed && e.kind !== 'ThreeDScene') timeline.sample(e.scene);
  }, 80) : undefined;
  const controller = new AbortController();
  const abort = () => { if (timer !== undefined) clearInterval(timer); controller.abort(); scope.close(); host.remove(); };
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
      for (const e of scope.scenes) if (!e.disposed && needsPreparedScene) {
        if ((selected.finalLayout || selected.temporalLayout) && e.kind !== 'ThreeDScene') await timeline.boundary(e.scene,true);
        else await prepareLayout(e.scene);
      }
    }, options.timeoutMs ?? 30000, controller.signal);
    if (!result.ok) return reportOf(result.status, result.error, version, checks, ["execution"]);
    checks.push("execution");
    const needsScene = selected.sceneAccess || selected.measurements || selected.mathtex || selected.nan || selected.finalLayout || selected.temporalLayout || options.vision;
    if (!scope.scenes.length && needsScene) return reportOf("incomplete", "未收集到场景，无法执行已启用的对象检查", version, checks, ["scene-access"]);
    const trackedCanvases = new Set(scope.scenes.map(({ scene }) => scene.getCanvas?.() ?? scene.renderer?.getCanvas?.()));
    if (selected.sceneAccess && [...host.querySelectorAll("canvas")].some(canvas => !trackedCanvases.has(canvas))) {
      return reportOf("incomplete", "发现未收集的渲染画布，不能确认所有场景都经过检查", version, checks, ["scene-access"]);
    }
    for (const entry of scope.scenes) {
      const s = entry.scene;
      if (needsScene && (entry.disposed || !s._mobjects || typeof s._mobjects[Symbol.iterator] !== "function")) {
        return reportOf("incomplete", "场景已释放或无法读取对象，未完成检查", version, checks, ["scene-access"]);
      }
      if (selected.mathtex) {
        const tex = detectMathTexError(s);
        if (tex) return reportOf("failed", tex, version, checks);
      }
      if (selected.nan) {
        const nan = detectNaN(s);
        if (nan) return reportOf("failed", nan, version, checks);
      }
      if (selected.measurements) {
        const measurement = measureCoverage(s);
        if (measurement) return reportOf("incomplete", measurement, version, checks, ["measurements"]);
      }
    }
    selected.sceneAccess ? checks.push("scene-access") : skip("scene-access");
    selected.mathtex ? checks.push("mathtex") : skip("mathtex");
    selected.nan ? checks.push("nan") : skip("nan");
    selected.measurements ? checks.push("measurements") : skip("measurements");
    if ((selected.finalLayout || selected.temporalLayout) && (timeline.error || timeline.failure)) {
      // 布局采样用于提示，不再阻止已经完成基础运行检查的动画展示。
      checks.push('layout-warning');
      const warning = timeline.failure ? `[layout] ${timeline.failure}; codeVersion=${version}` : timeline.error;
      if (!selected.finalLayout) { skip('layout-final'); skip('bounds-final'); }
      if (!selected.temporalLayout) skip('layout-temporal');
      return reportOf('passed', warning, version, checks, missing);
    }
    const has3D = scope.scenes.some(({ kind }) => kind === "ThreeDScene");
    if (has3D && options.skip3DLayout) {
      checks.push("3d-layout-skipped");
      if (!missing.includes('layout-final')) missing.push('layout-final', 'bounds-final', 'layout-temporal');
    } else if (has3D && (selected.finalLayout || selected.temporalLayout)) {
      return reportOf("incomplete", "3D 已完成运行和对象检查，屏幕布局检查尚未覆盖", version, checks, ["layout-final", "bounds-final", "layout-temporal"]);
    } else {
      if (selected.finalLayout) checks.push("layout-final", "bounds-final");
      else { skip("layout-final"); skip("bounds-final"); }
      if (selected.temporalLayout) checks.push("layout-temporal");
      else skip("layout-temporal");
    }
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

// AnimationGroup/LaggedStart add a library-owned, empty scheduling mobject to the scene.
// Identify its actual constructor, not a minified class name or arbitrary missing bounds.
const animationPlaceholderType = new AnimationGroup([]).mobject.constructor;

/** Detect missing/throwing geometry APIs before legacy detectors can swallow them. */
export function measureCoverage(scene: any): string {
  if (![scene.camera?.frameWidth, scene.camera?.frameHeight].every(n => Number.isFinite(n) && n > 0)) return "相机尺寸不可测量";
  const objects = [...scene._mobjects];
  if (!objects.length) return "结束场景为空，无法验证布局";
  const visited = new Set<any>();
  let measured = 0;
  const visit = (m: any): void => {
    if (visited.has(m)) return;
    visited.add(m);
    if(m.constructor === animationPlaceholderType) {
      const root=m.getThreeObject?.();
      if(root?.isGroup && !root.geometry && root.children.length===0 && !(m.submobjects || m._submobjects || []).length)return;
    }
    const bb = m.getBoundingBox?.(), center = m.getCenter?.();
    if (!bb || !Array.isArray(center) || center.length < 2 ||
      ![bb.width, bb.height, center[0], center[1]].every(Number.isFinite) || bb.width < 0 || bb.height < 0) throw new Error("对象边界不可测量");
    measured++;
    // Legacy detectors suppress getter errors; missing observations must not pass.
    if (typeof m.getText === "function") m.getText();
    if (typeof m.getLatex === "function") m.getLatex();
    if (typeof m.getRenderError === "function") m.getRenderError();
    for (const child of m.submobjects || m._submobjects || []) visit(child);
  };
  try { objects.forEach(visit); return measured ? "" : "场景只有动画调度对象，没有可验证的内容"; }
  catch (error: any) { return `测量未完成：${String(error?.message || error)}`; }
}
