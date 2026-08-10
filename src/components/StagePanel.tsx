import { useEffect, useRef, useState } from "react";
import { makeManimCtx, makeSelfBuildCtx, Scene, ThreeDScene, Axes, Dot, Line, Text, ValueTracker, Create, FadeIn, exposeManimGlobals } from "../manimCtx";
import { useApp } from "../store";
import { regenerateScene } from "../data/llmClient";
import { SkipBack, Play, Pause, SkipForward, RotateCcw, Camera, Square, Video } from "lucide-react";
import { is3DCode, detectOverlap, detectMathTexError, detectOutOfBounds, detectNaN } from "../sceneCheck";
import { execScript, isSelfBuildCode } from "../runScript";

// 转换器路线:后端把 Python Manim → TS,再拼成 `const {...} = ctx; <body>`。
// ctx 注入 manim-web 全部命名导出(类/颜色/方向/工具函数)+ scene + params,
// 这样转换代码里 import 的任何标识符都能从 ctx 解构到。
// manim-web 的 namespace import 隔离在 manimCtx.ts,避免破坏 React Fast Refresh。


// 中栏舞台:在 1D 损失 L(w)=½(w-1)² 上可视化梯度下降。
// η 与起点由滑块通过 ValueTracker 实时驱动(不重跑 construct)——"实时可交互"落点。
// 后端 agent 改某一步时,只替换本组件构造逻辑——"对话式局部重生成"落点。

/** 解析 CSS 变量为实际颜色值(供 manim-web/three 用——它们只认具体颜色,不认 var())。 */
function cssVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || name;
}

// ---------- 动画导出(截图 / 录制 WebM) ----------
function stageCanvas(scene: any, container: HTMLElement | null): HTMLCanvasElement | null {
  try { const cv = scene?.renderer?.getCanvas?.(); if (cv) return cv; } catch { /* ignore */ }
  // 自建场景(脚本里自己 new Scene)渲染进 container,取它下面的 canvas
  return container ? container.querySelector("canvas") : null;
}
function downloadDataUrl(dataUrl: string, name: string) {
  const a = document.createElement("a");
  a.href = dataUrl; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function pickVideoMime(): string {
  for (const m of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* ignore */ }
  }
  return "";
}

export default function StagePanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  // 舞台铺满:不传 width/height,useScene 默认用容器尺寸,并随容器 resize 自适应。
  // 自管 scene:根据 sceneCode 是否含 3D 类,创建 Scene 或 ThreeDScene(带 3D 相机+OrbitControls+光照)。
  const [scene, setScene] = useState<InstanceType<typeof Scene> | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 420 });
  // 动画导出:截图(即时)/ 录制 WebM(MediaRecorder,点击开始→再点停止并下载)
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recRafRef = useRef<number | null>(null);

  const handleScreenshot = () => {
    const cv = stageCanvas(scene, containerRef.current);
    if (!cv) return;
    try {
      const data = cv.toDataURL("image/png");
      if (data.length > 22) downloadDataUrl(data, `manim_${Date.now()}.png`);
    } catch { /* ignore */ }
  };
  const handleRecord = () => {
    if (recorderRef.current) {
      recorderRef.current.stop(); // 再点 → 停止并下载(onstop 里收尾)
      return;
    }
    const cv = stageCanvas(scene, containerRef.current);
    if (!cv || typeof (cv as any).captureStream !== "function") return;
    try {
      const stream = (cv as any).captureStream(30);
      const mime = pickVideoMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recChunksRef.current = [];
      rec.ondataavailable = (e: BlobEvent) => { if (e.data && e.data.size) recChunksRef.current.push(e.data); };
      rec.onstop = () => {
        // 录制期间用 rAF 强制 scene.render() 驱动重绘,否则 WebGL captureStream 静止时抓不到帧(录成空)。
        if (recRafRef.current != null) { cancelAnimationFrame(recRafRef.current); recRafRef.current = null; }
        const blob = new Blob(recChunksRef.current, { type: rec.mimeType || "video/webm" });
        if (blob.size) downloadBlob(blob, `manim_${Date.now()}.webm`);
        recorderRef.current = null;
        setRecording(false);
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      // 注入 scene 才有 render();自建场景脚本自己驱动绘制,无法强制(依赖其自身)。
      if (typeof (scene as any)?.render === "function") {
        const tick = () => {
          try { (scene as any).render(); } catch { /* ignore */ }
          if (recorderRef.current) recRafRef.current = requestAnimationFrame(tick);
        };
        recRafRef.current = requestAnimationFrame(tick);
      }
    } catch { /* 不支持则静默 */ }
  };
  const { lesson, currentStep, topics, paramValues, isPlaying, setIsPlaying, stageResetKey, bumpStageReset, sceneCode, setSceneCode, sessionId, requestNav, verifyRequest, reportVerifyResult, bbCheckEnabled, visionCheckEnabled, setVisionCheckEnabled, theme } = useApp();

  // 参数调整消抖 + 调完自动播放:
  // paramKey(JSON 化 paramValues)变化 → 停稳 350ms 后才重建一次场景(滑块拖动不每 tick 全量重绘);
  // 重建前设 autoPlayRef,让这次重建跑完直接自动播放(不再停在首段)。
  // 仅"用户拖滑块"触发的 paramValues 变化才消抖重建;切步/切会话的 paramValues 变化由各自 dep 触发,
  // 不应再重建/自动播(否则切步会多一次重建 + 莫名自动播放)。
  const paramKey = JSON.stringify(paramValues);
  const [paramRebuildKey, setParamRebuildKey] = useState(0);
  const paramTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoPlayRef = useRef(false);
  const paramEditedRef = useRef(false);
  const handleParamEdit = () => { paramEditedRef.current = true; };
  const prevParamKeyRef = useRef(paramKey);
  useEffect(() => {
    const prev = prevParamKeyRef.current;
    prevParamKeyRef.current = paramKey;
    if (prev === paramKey) return; // 首次挂载/无变化不重建
    if (!paramEditedRef.current) return; // 非滑块来源(切步/切会话):交给各自 dep,不消抖重建
    paramEditedRef.current = false;
    if (paramTimerRef.current) clearTimeout(paramTimerRef.current);
    paramTimerRef.current = setTimeout(() => {
      autoPlayRef.current = true; // 参数调整完 → 自动播放
      setParamRebuildKey((k) => k + 1);
    }, 350);
    return () => { if (paramTimerRef.current) clearTimeout(paramTimerRef.current); };
  }, [paramKey]);

  // 当前步骤标题/序号标签:字符串 stepId(topicid-N,新流程)从 topics 找;数字从 lesson.steps 找
  // lesson 可能为 null(分解建的空 session),此时用空数组兜底
  const lessonSteps = lesson?.steps ?? [];
  const stageStep = typeof currentStep === "string"
    ? topics.flatMap((t) => t.steps).find((s) => s.id === currentStep)
    : lessonSteps[currentStep - 1];
  const stageStepTitle = stageStep?.title || "";
  const stageStepLabel = typeof currentStep === "string"
    ? (() => { const tp = topics.find((t) => t.steps.some((s) => s.id === currentStep)); const n = tp ? tp.steps.findIndex((s) => s.id === currentStep) + 1 : 0; return `${n} / ${tp?.steps.length || 0}`; })()
    : `${currentStep} / ${lessonSteps.length}`;

  // 测量容器尺寸(铺满 + resize 自适应)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect;
        setContainerSize({ w: Math.max(320, Math.floor(cr.width)), h: Math.max(240, Math.floor(cr.height)) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // sceneCode/容器尺寸 变化时重建对应类型的 scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // 自建场景代码不需要注入 scene(自己在 container 上 new Scene)
    if (isSelfBuildCode(sceneCode)) { setScene(null); return; }
    const want3D = is3DCode(sceneCode);
    const opts = { backgroundColor: cssVar("--bg-deepest"), width: containerSize.w, height: containerSize.h };
    const s = want3D ? new ThreeDScene(container, opts) : new Scene(container, opts);
    setScene(s);
    return () => {
      try { (s as any).dispose?.(); } catch { /* ignore */ }
      setScene(null);
    };
  }, [sceneCode, stageResetKey, containerSize.w, containerSize.h, theme]);

  const lrTrackerRef = useRef<InstanceType<typeof ValueTracker> | null>(null);
  const startTrackerRef = useRef<InstanceType<typeof ValueTracker> | null>(null);
  const iterateRef = useRef<(() => Promise<void>) | null>(null);
  // 段间暂停控制:LLM 代码每个 await scene.play(...) 后,检查 pauseCtrl.paused,
  // 若暂停则阻塞,直到用户按"播放"调 resume()。默认 paused=true(首段播完自动停,等用户按播放)。
  // "播放"= 解除暂停,连续往后播(各段不再停,直到用户按暂停);"暂停"= 设标志,下个动画段末停住。
  // "下一段"(⏭)= stepOnce=true,只走一段到下个断点再停。
  const pauseCtrl = useRef<{ paused: boolean; resume: (() => void) | null; stepOnce: boolean }>({ paused: true, resume: null, stepOnce: false });
  const waitIfPaused = async () => {
    // stepOnce:被"下一段"唤醒后,只走这一段,到这里重新挂起(单步推进语义)
    if (pauseCtrl.current.stepOnce) {
      pauseCtrl.current.stepOnce = false;
      pauseCtrl.current.paused = true;
      setIsPlaying(false);
      return;
    }
    while (pauseCtrl.current.paused) {
      await new Promise<void>((resolve) => { pauseCtrl.current.resume = resolve; });
    }
  };

  // 浏览器在环验证:收到 verifyRequest 时,在临时 scene 上跑 code,成功/失败回报给后端 agent
  useEffect(() => {
    if (!verifyRequest) return;
    let disposed = false;
    (async () => {
      const { code, myRun } = verifyRequest;
      const offscreen = document.createElement("div");
      offscreen.style.cssText = "position:absolute;left:-9999px;top:0;width:800px;height:450px;";
      document.body.appendChild(offscreen);
      // 自建场景代码(自己 new Scene):离屏 freedom-Kitchen 跑,不做 BB/视觉检查(姿势多样)。
      if (isSelfBuildCode(code)) {
        try {
          exposeManimGlobals(offscreen);
          const cc: any = makeSelfBuildCtx(offscreen, paramValues);
          const rr = await execScript(cc, code, 30000);
          if (disposed) return;
          if (!rr.ok) throw new Error(rr.error);
          reportVerifyResult(true, "", "", myRun);
        } catch (e: any) {
          if (!disposed) reportVerifyResult(false, String(e?.message || e), "", myRun);
        } finally {
          offscreen.remove();
        }
        return;
      }
      const want3D = is3DCode(code);
      // 用一个离屏容器跑验证,不污染主舞台
      const opts = { backgroundColor: cssVar("--bg-deepest"), width: 800, height: 450 };
      const s = want3D ? new ThreeDScene(offscreen, opts) : new Scene(offscreen, opts);
      try {
        const ctx: any = makeManimCtx(s, paramValues);
        // 执行(TS 容忍 + 30s 超时):execScript 先按纯 JS 直跑,语法错(含 TS 注解)才转译重跑。
        // ⚠️ 超时阈值必须大于典型教学动画总时长(常 15-20s,含结尾 Indicate/Pulse/Circumscribe)。
        // 之前 10s 太短:长动画跑到一半被超时判"通过",后段 Indicate/Pulse 从没被验证过 →
        // 主舞台跑完整代码时在那一步报错(e107.map),回退默认梯度下降并 REGENERATE 循环。
        // 超时时间是"动画太长安逸通过"下限。注:超时那一刻后的动画段未被验证(主舞台仍可能触发),
        // 30s 已覆盖绝大多数教学动画全长;这是当前实现的取舍,非"无条件通过"。
        const execR = await execScript(ctx, code, 30000);
        if (!execR.ok) throw new Error(execR.error);
        if (disposed) return;
        // MathTex 渲染错误检查:manim-web 的 MathTex._renderPromise 用 .catch 吞掉 MathJax 错误
        // (只 console.error + 存 _renderError,Promise 仍 resolve),所以 await waitForRender() 不会抛。
        // 但主舞台后续读取 MathTex 几何(nextTo/getBoundingBox/Indicate 读点)会触发同步 MathJax retry 抛错
        // → 主舞台 build 失败 → 回退默认场景。这里主动查 getRenderError(),把 MathJax 失败暴露给 agent 自修。
        const texErr = detectMathTexError(s);
        if (texErr) {
          reportVerifyResult(false, `公式渲染失败(MathJax 字体异步加载问题,改用 MathTexImage 或简化 LaTeX 避开 \\overrightarrow/\\mathcal 等需动态字体的命令):${texErr}`, "", myRun);
          return;
        }
        // NaN 检测(硬错误,不受 BB 开关控制):标签/坐标含 NaN -> 打回自修
        const nan = detectNaN(s);
        if (nan) {
          reportVerifyResult(false, nan, "", myRun);
          return;
        }
        // 渲染成功后:2D BB 重叠检测(开关开且非 3D)
        if (bbCheckEnabled && !want3D) {
          const overlap = detectOverlap(s);
          if (overlap) {
            reportVerifyResult(false, `文字/形状重叠:${overlap}`, "", myRun);
            return;
          }
          // 文字/标注越界检测:文字飘出画布边缘被裁 → 打回自修
          const ob = detectOutOfBounds(s);
          if (ob) {
            reportVerifyResult(false, ob, "", myRun);
            return;
          }
        }
        // 视觉检查:开关开且非 3D 时,截最后一帧(canvas.toDataURL)随结果回传后端,
        // 后端存 png 并调视觉辅助模型描述画面(主模型无视觉时)。3D 的 WebGL canvas
        // toDataURL 多半空白,暂跳过(降级无视觉检查)。
        let frame = "";
        if (visionCheckEnabled && !want3D) {
          try {
            const cv = (s as any).getCanvas?.();
            if (cv && cv.toDataURL) frame = cv.toDataURL("image/png");
          } catch { /* 截帧失败:降级无 frame,不阻塞验证通过 */ }
        }
        reportVerifyResult(true, "", frame, myRun);
      } catch (e: any) {
        if (!disposed) reportVerifyResult(false, String(e?.message || e), "", myRun);
      } finally {
        try { (s as any).dispose?.(); } catch { /* ignore */ }
        offscreen.remove();
      }
    })();
    return () => { disposed = true; };
  }, [verifyRequest]); // eslint-disable-line react-hooks/exhaustive-deps


  // 滑块 → tracker(默认场景实时响应,无动画)
  useEffect(() => {
    lrTrackerRef.current?.setValue((paramValues.lr ?? 0.1));
  }, [(paramValues.lr ?? 0.1)]);
  useEffect(() => {
    startTrackerRef.current?.setValue((paramValues.start ?? -2.5));
  }, [(paramValues.start ?? -2.5)]);

  // scene 就绪后构建当前步场景
  // 防死循环 + 避免重复调 LLM:按 stepId 累计 regenerate 次数(跨 build 持久),每步上限 2 次。
  // 超过上限后即便代码仍报错也直接回退默认场景,不再调后端——点回已访问步秒回,不重新生成。
  const regenCountByStepRef = useRef<Record<number, number>>({});
  useEffect(() => {
    // 参数调整完的自动播放标志:消抖定时器触发重建前置 true,本次 build 跑完直接播(不停首段)
    const autoPlay = autoPlayRef.current;
    autoPlayRef.current = false;
    const selfBuild = sceneCode ? isSelfBuildCode(sceneCode) : false;
    const s = scene;
    // 注入 scene 路径需要 scene;自建场景路径不需要(自己在 container 上建)
    if (!s && !selfBuild) return;
    let cancelled = false;
    // scene 类型和 sceneCode 不匹配时跳过本次 build(等重建 scene 的 useEffect 换成正确类型再跑),
    // 否则 3D 代码会在普通 Scene 上执行报 "setCameraOrientation is not a function"(仅注入 scene 路径)
    const want3D = is3DCode(sceneCode);
    const sceneIs3D = s instanceof ThreeDScene;
    if (!selfBuild && want3D !== sceneIs3D) return;

    async function build() {
      if (selfBuild) {
        // 自建场景(自由脚本):代码自己 new Scene(container,{相机...}),暂停/断点降级为连播。
        try {
          await runSelfBuild(sceneCode, paramValues);
          regenCountByStepRef.current[currentStep] = 0;
          return;
        } catch (e: any) {
          console.warn("[sceneCode] 自建场景首跑失败,重试一次:", e?.message || e);
          await new Promise((r) => setTimeout(r, 250));
          if (cancelled) return;
          try {
            await runSelfBuild(sceneCode, paramValues);
            regenCountByStepRef.current[currentStep] = 0;
          } catch (e2: any) {
            console.warn("[sceneCode] 自建场景重试仍失败:", e2?.message || e2);
            if (s) { try { s.clear(); } catch {} }
          }
          return;
        }
      }
      if (!s) return;
      s.clear();
      // 优先执行 LLM 生成的场景代码;失败则回退默认场景并触发重生成
      if (sceneCode) {
        try {
          console.log('[build] scene type=', s.constructor?.name, 'is3D=', is3DCode(sceneCode), 'hasSetCam=', typeof (s as any).setCameraOrientation);
          await runSceneCode(s, sceneCode, paramValues);
          // 成功执行:该步代码 OK,重置 regenCount(以后点回不再 regenerate)
          regenCountByStepRef.current[currentStep] = 0;
          return;
        } catch (e: any) {
          console.warn("[sceneCode] 首次执行失败,等待 250ms 后用同一段已验证代码重试一次:", e?.message || e);
          // 主舞台与离屏验证共享 manim-web 全局状态(MathJax/KaTeX 加载、渲染资源),
          // 验证刚结束、离屏 scene 销毁后立刻 build,可能撞上瞬时竞态(如 MathJax retry)。
          // 这段 code 已在验证器跑通,失败大概率是竞态而非代码本身——重试一次通常就过。
          try {
            s.clear();
            await new Promise((r) => setTimeout(r, 250));
            if (cancelled) return;
            await runSceneCode(s, sceneCode, paramValues);
            regenCountByStepRef.current[currentStep] = 0;
            return;
          } catch (e2: any) {
            console.warn("[sceneCode] 重试仍失败,回退默认场景:", e2?.message || e2);
            s.clear();
            // 仅当代码确实有问题(两次都失败)才回退默认 + 触发后端重生成;
            // 且每步上限 1 次重生成,超过则保留默认场景(避免反复横跳浪费 LLM 调用)
            const used = regenCountByStepRef.current[currentStep] || 0;
            if (used < 1 && sessionId) {
              regenCountByStepRef.current[currentStep] = used + 1;
              (async () => {
                try {
                  for await (const ev of regenerateScene(sessionId, currentStep, String(e2?.message || e2))) {
                    if (cancelled) return; // 切会话/卸载:停止把回传流写到已失效的舞台
                    if (ev.kind === "explain" && ev.sceneCode) {
                      setSceneCode(ev.sceneCode); // 触发 build 重建,用新代码
                    }
                  }
                } catch { /* ignore */ }
              })();
            }
            buildDefaultScene(s);
            if (autoPlay) setIsPlaying(true); // 参数调整完:默认场景也自动播(iterateRef 跑起来)
            return;
          }
        }
      }
      buildDefaultScene(s);
      if (autoPlay) setIsPlaying(true); // 参数调整完:默认场景也自动播
    }

    /** 解析 CSS 变量为实际颜色值(供 manim-web/three 用——它们只认具体颜色,不认 var())。 */
function buildDefaultScene(s: any) {
      const axes = new Axes({
        xRange: [-4, 4, 1],
        yRange: [0, 5, 1],
        xLength: 10,
        yLength: 4,
        axisConfig: { color: cssVar("--border-hover"), strokeWidth: 2 },
      });
      const curve = axes.plot((w: number) => 0.5 * (w - 1) ** 2, {
        xRange: [-3.5, 3.5],
        color: cssVar("--blue"),
        strokeWidth: 3,
      });
      const titleLabel = new Text({ text: "L(w) = ½(w − 1)²", fontSize: 0.32, color: cssVar("--text-dim"), fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif' });
      titleLabel.moveTo([-3.2, 2.0, 0]);
      const minDot = new Dot({ point: axes.c2p(1, 0), radius: 0.07, color: cssVar("--blue-strong") });
      const minLabel = new Text({ text: "min", fontSize: 0.22, color: cssVar("--blue-strong"), fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif' });
      minLabel.moveTo(axes.c2p(1, 0)).shift([0.25, 0.2, 0]);

      const lrTracker = new ValueTracker((paramValues.lr ?? 0.1));
      const startTracker = new ValueTracker((paramValues.start ?? -2.5));
      lrTrackerRef.current = lrTracker;
      startTrackerRef.current = startTracker;
      s.add(lrTracker, startTracker);
      const wTracker = new ValueTracker((paramValues.start ?? -2.5));
      s.add(wTracker);

      const ball = new Dot({
        point: axes.c2p((paramValues.start ?? -2.5), 0.5 * ((paramValues.start ?? -2.5) - 1) ** 2),
        radius: 0.1,
        color: cssVar("--blue-strong"),
      });
      ball.addUpdater(() => {
        const w = wTracker.getValue();
        ball.moveTo(axes.c2p(w, 0.5 * (w - 1) ** 2));
      });
      const trail = new Line({
        start: axes.c2p((paramValues.start ?? -2.5), 0.5 * ((paramValues.start ?? -2.5) - 1) ** 2),
        end: axes.c2p((paramValues.start ?? -2.5), 0.5 * ((paramValues.start ?? -2.5) - 1) ** 2),
        color: cssVar("--blue-strong"),
        strokeWidth: 2,
      });
      s.add(trail);
      const info = new Text({ text: "η=0.10  w=0.00", fontSize: 0.24, color: cssVar("--text") });
      info.moveTo([2.4, 2.0, 0]);
      info.addUpdater(() => {
        const eta = lrTracker.getValue();
        const w = wTracker.getValue();
        info.setText(`η=${eta.toFixed(2)}  w=${w.toFixed(2)}`);
      });
      s.add(axes, curve, titleLabel, minDot, minLabel, ball, info);
      s.play(new Create(curve)).then(() => s.play(new FadeIn(ball), new FadeIn(minDot), new FadeIn(minLabel)));
      const trailStart = axes.c2p((paramValues.start ?? -2.5), 0.5 * ((paramValues.start ?? -2.5) - 1) ** 2);
      iterateRef.current = async () => {
        for (let i = 0; i < 40; i++) {
          if (cancelled) return;
          const eta = lrTracker.getValue();
          const w = wTracker.getValue();
          const wNext = w - eta * (w - 1);
          trail.setStart(trailStart);
          trail.setEnd(axes.c2p(wNext, 0.5 * (wNext - 1) ** 2));
          await s.play(wTracker.animateTo(wNext, { duration: 0.3 }));
          if (Math.abs(wNext - w) < 1e-3) break;
        }
      };
    }

    async function runSelfBuild(code: string, params: any) {
      // 自建场景(自由脚本):代码自己 new Scene(container,{相机...})。给真 #container + 全局导出。
      const stage = containerRef.current;
      if (!stage) return;
      stage.innerHTML = "";
      const host = document.createElement("div");
      host.id = "container";
      host.style.cssText = "width:100%;height:100%;";
      stage.appendChild(host);
      exposeManimGlobals(host);
      const ctx: any = makeSelfBuildCtx(host, params);
      const r = await execScript(ctx, code, 40000);
      if (!r.ok) throw new Error(r.error);
    }

    async function runSceneCode(s: any, code: string, params: any) {
      // ctx 注入 manim-web 全部命名导出(类/颜色/方向/工具函数)+ scene + params。
      // 转换器路线下,后端 code 开头 `const {...} = ctx;` 解构出它 import 的标识符。
      const ctx: any = makeManimCtx(s, params);
      // 段间暂停:包装 scene.play / scene.wait,每个动画段播完后检查暂停标志。
      // 暂停态时阻塞(停在该段末尾),按"播放"resume 才继续下一段。LLM 代码不用改。
      // (验证离屏跑的是它自己的 makeManimCtx,不走这里,不受暂停影响。)
      if (autoPlay) {
        // 参数调整完:自动播放,首段不停,一路播到底
        pauseCtrl.current.paused = false;
        setIsPlaying(true);
      } else {
        pauseCtrl.current.paused = true; // 每次 build 重置:首段播完即停
        setIsPlaying(false);             // 重置/回到最初:按钮回到"▶ 播放"态(pauseCtrl 暂停但 isPlaying 之前可能 true)
      }
      const origPlay = s.play.bind(s);
      const origWait = s.wait.bind(s);
      s.play = async function (...anims: any[]) {
        await origPlay(...anims);
        await waitIfPaused();
      };
      s.wait = async function (dur?: number) {
        await origWait(dur);
        await waitIfPaused();
      };
      // 执行:支持 TS+JS(execScript 先按纯 JS 直跑,语法错才懒加载 typescript 转译剥类型),
      // 带 40s 超时防代码挂死(卡死的动画不再把主舞台 build 卡住)。
      const execR = await execScript(ctx, code, 40000);
      if (execR.ok) return;
      // 完整信息打到 console,便于定位主舞台 vs 离屏验证不一致的错(e107.map / MathJax retry 等)
      console.error("[runSceneCode FAIL]", execR.error);
      throw new Error(execR.error);
    }

    void build();
    return () => {
      cancelled = true;
      iterateRef.current = null;
    };
  }, [scene, currentStep, stageResetKey, sceneCode, paramRebuildKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 播放按钮触发迭代
  useEffect(() => {
    if (!isPlaying) return;
    const fn = iterateRef.current;
    if (!fn) return;
    let active = true;
    (async () => {
      await fn();
      if (active) setIsPlaying(false);
    })();
    return () => {
      active = false;
    };
  }, [isPlaying, setIsPlaying]);

  return (
    <div className="flex h-full flex-col stage-transition">
      {/* 舞台上方加一行步骤标题,让中栏有"标题感" */}
      <div className="flex items-center px-4 h-9 border-b border-[var(--border)] shrink-0">
        <span className="text-[10px] text-[var(--text-faint)] uppercase tracking-wider">Stage</span>
        <span className="ml-2 text-[12px] text-[var(--text-dim)]">{stageStepTitle || "等待提问…"}</span>
        <span className="ml-auto text-[10px] text-[var(--text-faint)] tnum">{stageStepLabel}</span>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 w-full overflow-hidden relative">
        {!sceneCode && (
          <div className="empty-state absolute inset-0">
            <div className="empty-icon">▷</div>
            <div className="text-[12px] text-[var(--text-mute)]">在左侧输入一个 STEM 知识点开始</div>
            <div className="text-[10.5px] text-[var(--text-faint)]">主 agent 会拆解知识点,逐个用动画 + 讲解带你学</div>
          </div>
        )}
      </div>
      <div className="border-t border-[var(--border)] px-4 py-3 space-y-3 shrink-0">
        <div className="flex items-center gap-2">
          {/* 左:知识点导航(整个 step 切换) */}
          <button
            className="btn-ghost px-3 py-1.5 rounded-md text-[12px] disabled:opacity-30"
            disabled={!sessionId || currentStep <= 1}
            onClick={() => requestNav("prev")}
          >← 上一步</button>
          <button
            className="btn-ghost px-3 py-1.5 rounded-md text-[12px] disabled:opacity-30"
            disabled={!sessionId || currentStep >= lessonSteps.length}
            onClick={() => requestNav("next")}
          >下一步 →</button>

          {/* 右:动画段控制(单步内断点) */}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              className="btn-ghost px-2.5 py-1.5 rounded-md leading-none disabled:opacity-30"
              title="回到动画开头"
              disabled={!sceneCode}
              onClick={bumpStageReset}
            ><SkipBack size={15} /></button>
            <button
              className="btn-blue px-4 py-1.5 rounded-md text-[12px] flex items-center gap-1.5"
              onClick={() => {
                const next = !isPlaying;
                setIsPlaying(next);
                // LLM 场景段间暂停:播放=解除暂停并唤醒阻塞的 waitIfPaused;暂停=设标志(下个段末停)
                pauseCtrl.current.stepOnce = false;
                pauseCtrl.current.paused = !next;
                if (next && pauseCtrl.current.resume) { const r = pauseCtrl.current.resume; pauseCtrl.current.resume = null; r(); }
              }}
            >{isPlaying ? <><Pause size={14} /> 暂停</> : <><Play size={14} /> 播放</>}</button>
            <button
              className="btn-ghost px-2.5 py-1.5 rounded-md leading-none disabled:opacity-30"
              title="下一段动画"
              disabled={!sceneCode || isPlaying}
              onClick={() => {
                // 下一段:只走一段到下个断点再停。播放态下无效(disabled 已禁)。
                pauseCtrl.current.stepOnce = true;
                pauseCtrl.current.paused = false;
                if (pauseCtrl.current.resume) { const r = pauseCtrl.current.resume; pauseCtrl.current.resume = null; r(); }
              }}
            ><SkipForward size={15} /></button>
            <button
              className="btn-ghost px-2.5 py-1.5 rounded-md leading-none"
              title="重置舞台"
              onClick={bumpStageReset}
            ><RotateCcw size={15} /></button>
            <span className="w-px h-4 bg-[var(--border)] mx-0.5" />
            <button
              className="btn-ghost px-2 py-1.5 rounded-md leading-none disabled:opacity-30"
              title="下载当前帧为 PNG 图片"
              disabled={!sceneCode}
              onClick={handleScreenshot}
            ><Camera size={14} /></button>
            <button
              className={`px-2 py-1.5 rounded-md leading-none disabled:opacity-30 flex items-center gap-1 text-[10px] ${recording ? "bg-[var(--danger-bg)] text-[var(--danger-text)]" : "btn-ghost"}`}
              title={recording ? "停止录制并下载 WebM 视频" : "录制动画为 WebM 视频(配合点\"播放\"效果最佳);再点一次停止并下载"}
              disabled={!sceneCode}
              onClick={handleRecord}
            >{recording ? <><Square size={11} /> 停止</> : <><Video size={14} /></>}</button>
            <label className="flex items-center gap-1 text-[10px] text-[var(--text-mute)] cursor-pointer select-none ml-1" title="通过后截最后一帧给视觉模型检查画面(需在设置里配视觉辅助模型)">
              <input type="checkbox" checked={visionCheckEnabled} onChange={(e) => setVisionCheckEnabled(e.target.checked)} className="accent-[var(--blue)]" />
              视觉检查
            </label>
          </div>
        </div>
        <ParamSliders onEdit={handleParamEdit} />
      </div>
    </div>
  );
}

function ParamSliders({ onEdit }: { onEdit: () => void }) {
  const { lesson, currentStep, topics, paramValues, setParam } = useApp();
  // 字符串 stepId(新 topic)从 topics 找 paramsUsed/params;数字(旧 lesson)从 lesson.steps
  // lesson 可能为 null(分解建的空 session,无知识点拆解),此时无 step/params,直接返回 null
  const step: any = typeof currentStep === "string"
    ? topics.flatMap((t) => t.steps).find((s) => s.id === currentStep)
    : (lesson?.steps ?? [])[currentStep - 1];
  const used = step?.paramsUsed || [];
  // params 优先用 step.params(新流程 explain 事件带的);否则从 lesson.params 按 used 过滤(旧)
  const lessonParams = lesson?.params ?? [];
  const params: any[] = step?.params?.length ? step.params : lessonParams.filter((p) => used.includes(p.name));
  if (params.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {params.map((p) => {
        // 参数值可能缺失(切会话/切 topic 步时 paramValues 未初始化对应 key),兜底用默认值,防 toFixed(undefined) 白屏
        const v = paramValues[p.name] ?? p.default ?? p.min ?? 0;
        return (
        <label key={p.name} className="flex items-center gap-2.5 text-[11px]">
          <span className="w-16 text-[var(--text-mute)] shrink-0">{p.label}</span>
          <input
            type="range"
            min={p.min}
            max={p.max}
            step={p.step}
            value={v}
            onChange={(e) => { onEdit(); setParam(p.name, parseFloat(e.target.value)); }}
            className="flex-1"
          />
          <span className="w-10 text-right tnum text-[var(--blue-strong)]">{v.toFixed(2)}</span>
        </label>
        );
      })}
    </div>
  );
}
