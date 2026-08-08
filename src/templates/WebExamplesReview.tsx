// 独立审阅页:网上搜集的 manim-web(非官方)example 逐个真渲染 + sceneCheck 检查。
// 完全复用现有机制(makeManimCtx / execScript / exposeManimGlobals / sceneCheck),
// 不引入新渲染库。支持自由脚本(自建 scene)与注入 scene(ctx)两种模式。
import { useEffect, useMemo, useRef, useState } from "react";
import { WEB_EXAMPLES, WebExample } from "./webExamples";
import { makeManimCtx, Scene, ThreeDScene, exposeManimGlobals } from "../manimCtx";
import { is3DCode, detectOverlap, detectMathTexError, detectOutOfBounds } from "../sceneCheck";
import { execScript } from "../runScript";
import { Play, RotateCcw, ExternalLink } from "lucide-react";

type Status = { text: string; ok: boolean };

const groupBy = (items: WebExample[]) => {
  const g: string[] = [];
  for (const t of items) if (!g.includes(t.category)) g.push(t.category);
  return g;
};

const domainLabel: Record<string, string> = { math: "数学", physics: "物理", computer: "计算机", finance: "金融", stats: "概率统计", demo: "自由脚本·自建 scene" };

export default function WebExamplesReview() {
  const [selectedId, setSelectedId] = useState<string | null>(WEB_EXAMPLES[0]?.id ?? null);
  const [paramValues, setParamValues] = useState<Record<string, number>>({});
  const [replayKey, setReplayKey] = useState(0);
  const [status, setStatus] = useState<Status>({ text: "就绪", ok: true });
  const [size, setSize] = useState({ w: 800, h: 450 });
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<any>(null);

  const tpl = useMemo(() => WEB_EXAMPLES.find((t) => t.id === selectedId) ?? null, [selectedId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setSize({ w: Math.max(320, Math.floor(cr.width)), h: Math.max(240, Math.floor(cr.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (tpl) {
      const init: Record<string, number> = {};
      (tpl.params ?? []).forEach((p) => { init[p.name] = p.default; });
      setParamValues(init);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const paramKey = JSON.stringify(paramValues);

  const runIdRef = useRef(0);
  useEffect(() => {
    const stage = containerRef.current;
    if (!stage || !tpl) return;
    const rid = ++runIdRef.current;
    setStatus({ text: "运行中…", ok: true });
    if (sceneRef.current) { try { sceneRef.current.dispose?.(); } catch {} sceneRef.current = null; }
    stage.innerHTML = "";
    // 自建 scene(ThreeDScene/Scene/相机)走自由脚本;注入 scene 走固定舞台。用 is3D 显式标记 3D。
    const selfBuild = tpl.domain === "demo";
    (async () => {
      let s: any = null;
      try {
        if (selfBuild) {
          const host = document.createElement("div");
          host.id = "container";
          host.style.cssText = "width:100%;height:100%;";
          stage.appendChild(host);
          exposeManimGlobals(host);
          const ctx: any = { container: host, params: paramValues };
          const r = await execScript(ctx, tpl.sceneCode, 40000);
          if (rid !== runIdRef.current) return;
          if (!r.ok) throw new Error(r.error);
          setStatus(r.timedOut
            ? { text: "完成 · (动画长,超时兜底)", ok: true }
            : { text: "完成 · 自建 scene(可拖拽/旋转)", ok: true });
        } else {
          const want3D = tpl.is3D ?? is3DCode(tpl.sceneCode);
          const opts = { backgroundColor: "#0a0c14", width: size.w, height: size.h };
          s = want3D ? new ThreeDScene(stage, opts) : new Scene(stage, opts);
          sceneRef.current = s;
          const ctx: any = makeManimCtx(s, paramValues);
          const r = await execScript(ctx, tpl.sceneCode, 40000);
          if (rid !== runIdRef.current) return;
          if (!r.ok) throw new Error(r.error);
          const texErr = detectMathTexError(s);
          if (texErr) throw new Error("公式渲染失败(MathJax 字体加载,改用 MathTexImage 或简化 LaTeX): " + texErr);
          const overlap = want3D ? "" : detectOverlap(s);
          const oob = want3D ? "" : detectOutOfBounds(s);
          const hint = [overlap, oob].filter(Boolean).join("; ");
          setStatus(hint
            ? { text: "完成 · ⚠️ " + hint, ok: false }
            : { text: "完成 · " + (want3D ? "渲染通过" : "渲染通过"), ok: true });
        }
      } catch (e: any) {
        if (rid !== runIdRef.current) return;
        setStatus({ text: "错误: " + String(e?.message || e), ok: false });
      }
    })();
    return () => { if (rid === runIdRef.current) runIdRef.current++; };
  }, [tpl, size.w, size.h, paramKey, replayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const categories = useMemo(() => groupBy(WEB_EXAMPLES), []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-deepest)] text-[var(--text)]">
      {/* 左:网页示例列表 */}
      <aside className="w-80 shrink-0 border-r border-[var(--border-1)] overflow-y-auto p-3 space-y-4">
        <div className="text-sm font-semibold px-1">网上搜集的非官方 example</div>
        <div className="px-1 text-[11px] text-[var(--text-mute)] leading-relaxed">
          来源:GitHub Issues(SitePoint 等)里社区贴的真实代码,已对照 manim-web 0.3.24 d.ts 校验 API。
        </div>
        {categories.map((cat) => (
          <div key={cat}>
            <div className="text-[11px] uppercase tracking-wide text-[var(--text-faint)] mb-1">{cat}</div>
            <div className="space-y-1">
              {WEB_EXAMPLES.filter((t) => t.category === cat).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-[12.5px] leading-snug transition-colors ${
                    selectedId === t.id
                      ? "bg-[var(--blue)]/15 text-[var(--blue-strong)] border border-[var(--blue)]/30"
                      : "text-[var(--text)] hover:bg-[var(--bg-2)] border border-transparent"
                  }`}
                >
                  {t.title}
                  <div className="text-[10.5px] text-[var(--text-mute)] mt-0.5 font-normal">{t.intent.slice(0, 42)}…</div>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="px-1 pt-2 text-[10.5px] text-[var(--text-faint)] border-t border-[var(--border-1)]">共 {WEB_EXAMPLES.length} 个示例 · 逐个真渲染</div>
      </aside>

      {/* 右:舞台 + 信息 */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* 顶栏:标题 / 来源 / 操作 */}
        <div className="h-14 shrink-0 flex items-center gap-3 px-4 border-b border-[var(--border-1)]">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{tpl?.title ?? "—"}</div>
            <div className="text-[10.5px] text-[var(--text-mute)] truncate">
              <span className="inline-flex items-center gap-1">
                {domainLabel[tpl?.domain ?? "math"]}
                <ExternalLink size={11} className="opacity-70" />
                {tpl?.source ?? ""}
              </span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className={`text-[11px] px-2 py-1 rounded-md ${status.ok ? "text-[var(--ok-strong)]" : "text-[var(--err-strong)]"}`}>{status.text}</span>
            <button onClick={() => setReplayKey((k) => k + 1)} className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12px] bg-[var(--bg-3)] hover:bg-[var(--bg-2)] border border-[var(--border-1)]">
              <RotateCcw size={14} /> 重跑
            </button>
          </div>
        </div>

        {/* 参数滑块 */}
        {tpl && (tpl.params?.length ?? 0) > 0 && (
          <div className="shrink-0 flex flex-wrap gap-x-6 gap-y-2 px-4 py-2 border-b border-[var(--border-1)] bg-[var(--bg-2)]/40">
            {(tpl.params ?? []).map((p) => (
              <label key={p.name} className="flex items-center gap-2 text-[12px] text-[var(--text-dim)]">
                <span>{p.label}</span>
                <input
                  type="range" min={p.min} max={p.max} step={p.step} value={paramValues[p.name] ?? p.default}
                  onChange={(e) => setParamValues((prev) => ({ ...prev, [p.name]: parseFloat(e.target.value) }))}
                  className="w-36 accent-[var(--blue)]"
                />
                <span className="tabular-nums text-[var(--text-mute)] w-10 text-right">{(paramValues[p.name] ?? p.default).toFixed(2)}</span>
              </label>
            ))}
          </div>
        )}

        {/* 舞台 */}
        <div className="flex-1 relative m-3 rounded-xl overflow-hidden border border-[var(--border-1)] bg-black">
          <div ref={containerRef} className="absolute inset-0" />
          <div className="absolute bottom-2 left-2 flex gap-2">
            {tpl?.is3D && <button onClick={() => setReplayKey((k) => k + 1)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] bg-[var(--bg-3)]/90 hover:bg-[var(--bg-2)] border border-[var(--border-1)]"><Play size={12} /> 播放</button>}
          </div>
        </div>

        {/* 教学意图 */}
        {tpl && (
          <div className="shrink-0 px-4 py-3 border-t border-[var(--border-1)] text-[12.5px] text-[var(--text-dim)] leading-relaxed">
            <span className="font-semibold text-[var(--text)] mr-1">教学意图:</span>{tpl.intent}
          </div>
        )}
      </main>
    </div>
  );
}