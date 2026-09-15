// 独立模板检查页:sideline 列出模板(按领域/子类分组),点选后在舞台真渲染。
// 完全复用现有机制(src/manimCtx.ts 的 makeManimCtx + AsyncFunction 执行 +
// src/sceneCheck.ts 的 3D/TS/重叠/公式校验),不引入任何新渲染库。
import { useEffect, useMemo, useRef, useState } from "react";
import { TEMPLATES } from "./library";
import { OFFICIAL_TEMPLATES } from "./official";
import { makeManimCtx, makeSelfBuildCtx, Scene, ThreeDScene, exposeManimGlobals } from "../manimCtx";
import { is3DCode, detectOverlap, detectMathTexError } from "../sceneCheck";
import { execScript } from "../runScript";
import { Play, RotateCcw } from "lucide-react";

const ALL_TEMPLATES = [...TEMPLATES, ...OFFICIAL_TEMPLATES];
type Status = { text: string; ok: boolean };

export default function TemplateReview() {
  const [selectedId, setSelectedId] = useState<string | null>(ALL_TEMPLATES[0]?.id ?? null);
  const [paramValues, setParamValues] = useState<Record<string, number>>({});
  const [replayKey, setReplayKey] = useState(0);
  const [status, setStatus] = useState<Status>({ text: "就绪", ok: true });
  const [size, setSize] = useState({ w: 800, h: 450 });
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<any>(null);

  const tpl = useMemo(() => ALL_TEMPLATES.find((t) => t.id === selectedId) ?? null, [selectedId]);

  // 舞台尺寸(铺满 + resize 自适应,同 StagePanel)
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

  // 选中模板时重置参数为默认值
  useEffect(() => {
    if (tpl) {
      const init: Record<string, number> = {};
      (tpl.params ?? []).forEach((p) => { init[p.name] = p.default; });
      setParamValues(init);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const paramKey = JSON.stringify(paramValues);

  // 切换模板/改尺寸/改参数/点重跑 → 重建并真渲染
  // runId 递增保证只有"最新一次"渲染能写状态/画布,避免点击/HMR 快速切换时旧 run 串台覆盖
  const runIdRef = useRef(0);
  useEffect(() => {
    const stage = containerRef.current;
    if (!stage || !tpl) return;
    const rid = ++runIdRef.current;
    setStatus({ text: "运行中…", ok: true });
    // dispose 旧场景 + 清舞台(在启动新 run 前同步做)
    if (sceneRef.current) { try { sceneRef.current.dispose?.(); } catch {} sceneRef.current = null; }
    stage.innerHTML = "";
    // 官方示例是"自由脚本"(自带整套厨房:自己建容器/Scene/相机),走 selfBuild;
    // 手写模板是"固定一口灶"(注入 scene),保持原行为。
    const selfBuild = tpl.domain === "demo";
    (async () => {
      let s: any = null;
      try {
        if (selfBuild) {
          // 自由脚本:给一个真实 #container div,manim-web 导出 + container 铺全局,代码自建 scene。
          const host = document.createElement("div");
          host.id = "container";
          host.style.cssText = "width:100%;height:100%;";
          stage.appendChild(host);
          exposeManimGlobals(host);
          const ctx: any = makeSelfBuildCtx(host, paramValues);
          const r = await execScript(ctx, tpl.sceneCode, 40000);
          if (rid !== runIdRef.current) return;
          if (!r.ok) throw new Error(r.error);
          setStatus({ text: "完成 · 官方示例", ok: true });
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
          setStatus(overlap
            ? { text: "完成 · ⚠️ " + overlap, ok: false }
            : { text: "完成 · " + (want3D ? "可拖拽旋转" : "渲染通过"), ok: true });
        }
      } catch (e: any) {
        if (rid !== runIdRef.current) return;
        setStatus({ text: "错误: " + String(e?.message || e), ok: false });
      }
    })();
    return () => { if (rid === runIdRef.current) runIdRef.current++; };
  }, [tpl, size.w, size.h, paramKey, replayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 侧栏分组数据
  const groups = useMemo(() => {
    const g: { domain: string; categories: { name: string; items: typeof ALL_TEMPLATES }[] }[] = [];
    for (const t of ALL_TEMPLATES) {
      let dom = g.find((d) => d.domain === t.domain);
      if (!dom) { dom = { domain: t.domain, categories: [] }; g.push(dom); }
      let cat = dom.categories.find((c) => c.name === t.category);
      if (!cat) { cat = { name: t.category, items: [] }; dom.categories.push(cat); }
      cat.items.push(t);
    }
    return g;
  }, []);
  const domainLabel: Record<string, string> = { math: "数学", physics: "物理", demo: "官方示例" };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-deepest)] text-[var(--text)]">
      {/* 左:模板列表 */}
      <aside className="w-64 shrink-0 border-r border-[var(--border)] overflow-y-auto">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <div className="text-[13px] font-semibold text-white">manim 动画模板库</div>
          <div className="text-[10px] text-[var(--text-faint)]">第一批 · 数学 / 物理(本科)</div>
        </div>
        {groups.map((dom) => (
          <div key={dom.domain} className="py-2">
            <div className="px-4 py-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">{domainLabel[dom.domain]}</div>
            {dom.categories.map((cat) => (
              <div key={cat.name} className="mb-1">
                <div className="px-4 py-0.5 text-[11px] text-[var(--text-mute)]">{cat.name}</div>
                {cat.items.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={`block w-full text-left px-4 py-1.5 text-[12px] leading-snug transition-colors ${selectedId === t.id ? "bg-[var(--glow-1)] text-[#7cc6ff] border-l-2 border-[var(--blue)]" : "text-[var(--text-dim)] hover:bg-[var(--bg-2)]"}`}
                  >{t.title}</button>
                ))}
              </div>
            ))}
          </div>
        ))}
      </aside>

      {/* 中:舞台 + 信息 */}
      <main className="flex-1 flex flex-col min-w-0">
        <div ref={containerRef} className="flex-1 min-h-0 w-full relative">
          {!tpl && <div className="empty-state absolute inset-0"><div className="text-[12px] text-[var(--text-mute)]">未选择模板</div></div>}
        </div>
        <div className="border-t border-[var(--border)] px-4 py-3 space-y-3 shrink-0">
          {/* 标题 + 状态 + 操作 */}
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-white">{tpl?.title ?? "—"}</div>
              <div className="text-[11.5px] text-[var(--text-dim)] mt-0.5 leading-relaxed">{tpl?.intent ?? "选左侧模板查看这一镜讲什么"}</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`text-[11px] px-2 py-1 rounded-md ${status.ok ? "bg-[#0e2a1d] text-[#4ade80]" : "bg-[#2a1215] text-[#f87171]"}`}>{status.text}</span>
              <button className="btn-ghost px-2.5 py-1.5 rounded-md leading-none" title="回到动画开头" disabled={!tpl} onClick={() => setReplayKey((k) => k + 1)}><RotateCcw size={15} /></button>
              <button className="btn-blue px-4 py-1.5 rounded-md text-[12px] flex items-center gap-1.5" disabled={!tpl} onClick={() => setReplayKey((k) => k + 1)}><Play size={14} /> 重跑</button>
            </div>
          </div>
          {/* 参数滑块 */}
          {(tpl?.params?.length ?? 0) > 0 && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {(tpl?.params ?? []).map((p) => {
                const v = paramValues[p.name] ?? p.default;
                return (
                  <label key={p.name} className="flex items-center gap-2.5 text-[11px]">
                    <span className="w-24 text-[var(--text-mute)] shrink-0">{p.label}</span>
                    <input type="range" min={p.min} max={p.max} step={p.step} value={v}
                      onChange={(e) => setParamValues((prev) => ({ ...prev, [p.name]: parseFloat(e.target.value) }))}
                      className="flex-1" />
                    <span className="w-12 text-right tnum text-[var(--blue-strong)]">{v.toFixed(2)}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}