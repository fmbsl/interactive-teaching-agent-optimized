import { useEffect, useState } from "react";
import { useApp } from "../store";
import { saveLlmConfig, deleteLlmConfig, setActiveLlmConfig, saveVisionConfig, getUserPrefs, saveUserPrefs, getAppSettings, saveAppSettings, type EndpointConfig } from "../data/llmClient";
import { THEMES, DEFAULT_THEME } from "../theme";
import { Server, User, Paintbrush, Brain, ShieldCheck, Check } from "lucide-react";

const EMPTY: EndpointConfig = {
  id: "", name: "", baseUrl: "", apiKey: "", model: "",
  fallbackModel: "", fallbackBaseUrl: "", fallbackApiKey: "", supportsVision: false,
  reasoningEffort: "high",
};

const EMPTY_VISION: EndpointConfig = {
  id: "vision", name: "", baseUrl: "", apiKey: "", model: "",
  fallbackModel: "", fallbackBaseUrl: "", fallbackApiKey: "",
};

type TabId = "model" | "prefs" | "theme" | "decompose" | "verification";

// 本地兜底档位→预算(与后端 app_settings.py 的 EFFORT_PRESETS 一致;后端为准,拉取后覆盖)
const EFFORT_LOCAL: Record<string, { label: string; max_depth: number; max_nodes: number; max_expand: number }> = {
  low: { label: "低", max_depth: 2, max_nodes: 40, max_expand: 4 },
  mid: { label: "中", max_depth: 3, max_nodes: 80, max_expand: 8 },
  high: { label: "高", max_depth: 4, max_nodes: 140, max_expand: 14 },
};

const TABS: { id: TabId; label: string; Icon: typeof Server }[] = [
  { id: "model", label: "模型", Icon: Server },
  { id: "prefs", label: "偏好", Icon: User },
  { id: "theme", label: "主题", Icon: Paintbrush },
  { id: "decompose", label: "知识分解", Icon: Brain },
  { id: "verification", label: "验证", Icon: ShieldCheck },
];

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<TabId>("model");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 panel"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[680px] max-h-[86vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-[13px] font-semibold text-[var(--text)]">设置</h2>
          <button className="btn-ghost px-2 py-0.5 rounded text-[11px]" onClick={onClose}>关闭</button>
        </div>
        {/* Tab 栏 */}
        <div className="flex items-center gap-1 px-3 pt-2 border-b border-[var(--border)]">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-md text-[11px] font-medium transition-colors ${
                tab === id ? "bg-[var(--bg-1)] text-[var(--blue-strong)] border border-b-0 border-[var(--border)] -mb-px" : "text-[var(--text-mute)] hover:text-[var(--text)]"
              }`}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
        {/* 内容区(各 tab 自管滚动) */}
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {tab === "model" && <ModelTab />}
          {tab === "prefs" && <PrefsTab />}
          {tab === "theme" && <ThemeTab />}
          {tab === "decompose" && <DecomposeTab />}
          {tab === "verification" && <VerificationTab />}
        </div>
        <div className="px-4 py-2 border-t border-[var(--border)] text-[10px] text-[var(--text-faint)]">
          多数设置即时生效;模型类改动写后端,改完即用。
        </div>
      </div>
    </div>
  );
}

// ---------- 模型:LLM 接入点 + 视觉辅助 ----------
function ModelTab() {
  const { llmEndpoints, activeEndpointId, visionEndpoint, reloadLlmConfigs } = useApp();
  const [editing, setEditing] = useState<EndpointConfig | null>(null);
  const [editingVision, setEditingVision] = useState<EndpointConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wrap = async (fn: () => Promise<void>) => {
    setErr(null); setBusy(true);
    try { await fn(); } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };
  const save = () => wrap(async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.baseUrl.trim() || !editing.model.trim()) {
      setErr("名称、接入 URL、模型名必填");
      return;
    }
    await saveLlmConfig(editing);
    await reloadLlmConfigs();
    setEditing(null);
  });
  const remove = (id: string) => wrap(async () => { await deleteLlmConfig(id); await reloadLlmConfigs(); });
  const activate = (id: string) => wrap(async () => { await setActiveLlmConfig(id); await reloadLlmConfigs(); });
  const saveVision = () => wrap(async () => {
    if (!editingVision) return;
    if (!editingVision.baseUrl.trim() || !editingVision.model.trim()) { setErr("视觉辅助模型的接入 URL、模型名必填"); return; }
    await saveVisionConfig(editingVision);
    await reloadLlmConfigs();
    setEditingVision(null);
  });

  return (
    <div>
      {err && (
        <div className="mb-3 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[11px] text-[var(--danger-text)]">{err}</div>
      )}
      {editing ? (
        <EditForm value={editing} onChange={setEditing} onSave={save} onCancel={() => setEditing(null)} busy={busy} />
      ) : (
        <>
          <div className="mb-1.5 text-[11px] font-medium text-[var(--text-dim)]">LLM 接入点</div>
          <div className="space-y-1.5">
            {llmEndpoints.map((ep) => (
              <div key={ep.id} className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-row)] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[12px] text-[var(--text)]">{ep.name}</span>
                    {activeEndpointId === ep.id && (
                      <span className="chip bg-[var(--blue-soft)] text-[var(--blue-strong)]">启用中</span>
                    )}
                  </div>
                  <div className="truncate text-[10px] text-[var(--text-mute)]">{ep.model} · {ep.baseUrl}</div>
                </div>
                {activeEndpointId !== ep.id && (
                  <button className="btn-ghost px-2 py-0.5 rounded text-[10px]" disabled={busy} onClick={() => activate(ep.id)}>设为启用</button>
                )}
                <button className="btn-ghost px-2 py-0.5 rounded text-[10px]" disabled={busy} onClick={() => setEditing({ ...ep })}>编辑</button>
                <button className="btn-ghost px-2 py-0.5 rounded text-[10px]" disabled={busy} onClick={() => remove(ep.id)}>删除</button>
              </div>
            ))}
            {llmEndpoints.length === 0 && (
              <div className="py-6 text-center text-[11px] text-[var(--text-mute)]">暂无接入点,点击下方新增</div>
            )}
          </div>
          <button className="btn-blue mt-3 px-3 py-1.5 rounded-md text-[11px]" onClick={() => setEditing({ ...EMPTY })}>+ 新增接入点</button>

          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-[12px] font-semibold text-[var(--text)]">视觉辅助模型</h3>
              <span className="text-[10px] text-[var(--text-mute)]">主模型不支持视觉时,用它描述动画画面</span>
            </div>
            {editingVision ? (
              <VisionForm value={editingVision} onChange={setEditingVision} onSave={saveVision} onCancel={() => setEditingVision(null)} busy={busy} />
            ) : (
              <div>
                {visionEndpoint && visionEndpoint.baseUrl ? (
                  <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-row)] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-[var(--text)]">{visionEndpoint.name || "视觉辅助"}</div>
                      <div className="truncate text-[10px] text-[var(--text-mute)]">{visionEndpoint.model} · {visionEndpoint.baseUrl}</div>
                    </div>
                    <button className="btn-ghost px-2 py-0.5 rounded text-[10px]" disabled={busy} onClick={() => setEditingVision({ ...visionEndpoint })}>编辑</button>
                  </div>
                ) : (
                  <div className="py-2 text-center text-[11px] text-[var(--text-mute)]">未配置(主模型无视觉时,视觉检查自动跳过)</div>
                )}
                {!visionEndpoint?.baseUrl && (
                  <button className="btn-blue mt-2 px-3 py-1.5 rounded-md text-[11px]" onClick={() => setEditingVision({ ...EMPTY_VISION })}>+ 配置视觉辅助模型</button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- 偏好:全局记忆 ----------
function PrefsTab() {
  const [prefs, setPrefs] = useState("");
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { getUserPrefs().then(setPrefs); }, []);
  const savePrefs = async () => {
    setPrefsBusy(true); setDone(false);
    try { await saveUserPrefs(prefs); setDone(true); } finally { setPrefsBusy(false); }
  };
  return (
    <div>
      <div className="text-[11px] font-medium text-[var(--text-dim)] mb-1.5">用户偏好(主 agent 全局记忆)</div>
      <p className="text-[10px] text-[var(--text-mute)] mb-2 leading-relaxed">这段文字会拼进主 agent 的系统提示词,作为你的长期身份与学习偏好。</p>
      <textarea
        value={prefs}
        onChange={(e) => setPrefs(e.target.value)}
        rows={5}
        placeholder="如:喜欢用类比讲解;数学背景较强,可以跳过基础;偏好简洁,少用公式…"
        className="w-full text-[11px] text-[var(--text)] bg-[var(--bg-input)] border border-[var(--border)] rounded px-2 py-1.5 outline-none resize-none leading-relaxed focus:border-[var(--blue)]/50"
      />
      <button onClick={savePrefs} disabled={prefsBusy} className="btn-blue mt-1.5 px-3 py-1 rounded-md text-[11px] disabled:opacity-40 flex items-center gap-1.5">
        {prefsBusy ? "保存中…" : done ? <><Check size={12} /> 已保存</> : "保存偏好"}
      </button>
    </div>
  );
}

// ---------- 主题:预置 + 自定义 CSS ----------
function ThemeTab() {
  const { theme, setTheme, customCss, setCustomCss } = useApp();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11px] font-medium text-[var(--text-dim)] mb-2">主题预设</div>
        <div className="grid grid-cols-3 gap-2.5">
          {THEMES.map((t) => {
            const active = theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`text-left rounded-lg border p-2.5 transition-all ${
                  active ? "border-[var(--blue)] ring-1 ring-[var(--blue-ring)]" : "border-[var(--border)] hover:border-[var(--border-hover)]"
                }`}
                style={{ background: t.tokens["bg-1"] }}
              >
                {/* 色板预览:底 + 边框 + 文字 + 强调 */}
                <div
                  className="flex items-center gap-1.5 mb-1.5"
                  style={{ color: t.tokens["text"] }}
                >
                  <span className="w-3.5 h-3.5 rounded-full" style={{ background: t.tokens["blue"] }} />
                  <span className="w-3.5 h-3.5 rounded-full" style={{ background: t.tokens["bg-3"], border: `1px solid ${t.tokens["border"]}` }} />
                  <span className="h-1.5 flex-1 rounded" style={{ background: t.tokens["bg-input"], border: `1px solid ${t.tokens["border"]}` }} />
                </div>
                <div className="text-[11px] font-medium" style={{ color: active ? t.tokens["blue-strong"] : t.tokens["text"] }}>{t.name}</div>
                <div className="text-[9.5px] leading-snug" style={{ color: t.tokens["text-dim"] }}>{t.desc}</div>
              </button>
            );
          })}
        </div>
        <button className="btn-ghost mt-2 px-2.5 py-1 rounded text-[10px]" onClick={() => { setTheme(DEFAULT_THEME); setCustomCss(""); }}>
          恢复默认(深海暗蓝 + 清空自定义 CSS)
        </button>
      </div>
      <div className="border-t border-[var(--border)] pt-4">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[11px] font-medium text-[var(--text-dim)]">自定义 CSS</div>
          <button className="btn-ghost px-2 py-0.5 rounded text-[10px]" onClick={() => { navigator.clipboard?.writeText(customCss); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
            {copied ? "已复制" : "复制"}
          </button>
        </div>
        <p className="text-[10px] text-[var(--text-mute)] mb-2 leading-relaxed">写任意 CSS,保存即实时注入 <code className="text-[var(--code-ink)]">#user-css</code>。覆盖某主题的变量请用 <code className="text-[var(--code-ink)]">:root[data-theme="paper"]&#123;--text:#111;&#125;</code>(带上 <code className="text-[var(--code-ink)]">:root</code> 前缀与属性选择器才会压过内置主题)。</p>
        <textarea
          value={customCss}
          onChange={(e) => setCustomCss(e.target.value)}
          rows={7}
          spellCheck={false}
          placeholder="/* 例如:让所有主题的正文更亮 */&#10;.md-prose { font-size: 13px; }&#10;:root[data-theme='paper'] { --text: #111; }"
          className="w-full font-mono text-[11px] text-[var(--text)] bg-[var(--bg-input)] border border-[var(--border)] rounded px-2 py-1.5 outline-none resize-y leading-relaxed focus:border-[var(--blue)]/50"
        />
        <div className="text-[10px] text-[var(--text-faint)] mt-1">CSS 变量可参考主题预设的值;刷新后持久保留。</div>
      </div>
    </div>
  );
}

// ---------- 知识分解:力度档位 ----------
function DecomposeTab() {
  const { decomposeEffort, setDecomposeEffort, loadAppSettings } = useApp();
  const [presets, setPresets] = useState<Record<string, { max_depth: number; max_nodes: number; max_expand: number }> | null>(null);
  const [busyLevel, setBusyLevel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    getAppSettings().then((s) => { if (s.effort_presets) setPresets(s.effort_presets); }).catch(() => { /* 用本地兜底 */ });
  }, []);

  const budget = (presets ?? EFFORT_LOCAL)[decomposeEffort] as any;

  const pick = async (level: string) => {
    setDecomposeEffort(level);
    setErr(null); setSaved(null); setBusyLevel(level);
    try {
      const s = await saveAppSettings({ decompose_effort: level });
      if (s.effort_presets) setPresets(s.effort_presets);
      setSaved(level);
      loadAppSettings();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally { setBusyLevel(null); }
  };

  return (
    <div>
      <div className="text-[11px] font-medium text-[var(--text-dim)] mb-1">知识分解力度</div>
      <p className="text-[10px] text-[var(--text-mute)] mb-3 leading-relaxed">一个档位同时控制分解的三个预算(递归拆到多深 / 图谱最多多少节点 / 单次 LLM 展开上限)。档位越"高"分解越细但耗时与 token 消耗越大。</p>
      <div className="flex items-center gap-1.5">
        {(["low", "mid", "high"] as const).map((lv) => {
          const b = (presets ?? EFFORT_LOCAL)[lv] as any;
          const active = decomposeEffort === lv;
          return (
            <button
              key={lv}
              onClick={() => pick(lv)}
              disabled={busyLevel !== null}
              className={`flex-1 rounded-lg border px-3 py-2.5 text-left transition-all disabled:opacity-50 ${
                active ? "border-[var(--blue)] ring-1 ring-[var(--blue-ring)] bg-[var(--bg-row)]" : "border-[var(--border)] hover:border-[var(--border-hover)]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[12px] font-semibold ${active ? "text-[var(--blue-strong)]" : "text-[var(--text)]"}`}>{b?.label ?? lv}</span>
                {active && <Check size={13} className="text-[var(--blue-strong)]" />}
              </div>
              <div className="text-[9.5px] text-[var(--text-mute)] mt-1 leading-snug">
                深度约 {b?.max_depth ?? "—"} 层 · 节点 ≤ {b?.max_nodes ?? "—"} · 单次展开 ≤ {b?.max_expand ?? "—"} 次
              </div>
            </button>
          );
        })}
      </div>
      {err && <div className="mt-2 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[11px] text-[var(--danger-text)]">{err}</div>}
      <div className="mt-3 text-[10px] text-[var(--text-faint)]">
        {saved ? <>已保存,当前档位 = <b className="text-[var(--blue-strong)]">{budget?.label ?? decomposeEffort}</b>,下次分解生效。</> : "选择后立即保存到后端,对之后的新分解生效。"}
      </div>
    </div>
  );
}

// ---------- 验证：逐项开关 ----------
function VerificationTab() {
  const {
    verificationChecks, setVerificationCheck,
    visionCheckEnabled, setVisionCheckEnabled,
    skip3DLayoutCheck, setSkip3DLayoutCheck,
  } = useApp();
  const rows = [
    { key: "sceneAccess" as const, title: "场景读取", cost: "很快", desc: "确认生成代码使用了可读取的动画场景。" },
    { key: "measurements" as const, title: "对象尺寸", cost: "很快", desc: "检查对象边界是否能可靠测量。" },
    { key: "mathtex" as const, title: "公式渲染", cost: "较快", desc: "发现 MathTex/公式纹理渲染错误。" },
    { key: "nan" as const, title: "无效数值", cost: "很快", desc: "发现坐标、矩阵和几何中的 NaN/Infinity。" },
    { key: "finalLayout" as const, title: "末帧重叠与越界", cost: "中等", desc: "动画结束后扫描一次文字和图形边界；问题只提示，不拦截展示。" },
    { key: "temporalLayout" as const, title: "播放过程布局采样", cost: "较慢", desc: "播放时每 80ms 扫描重叠与越界，会增加浏览器 CPU 占用。" },
  ];
  const recommended = () => {
    setVerificationCheck("sceneAccess", true);
    setVerificationCheck("measurements", true);
    setVerificationCheck("mathtex", true);
    setVerificationCheck("nan", true);
    setVerificationCheck("finalLayout", true);
    setVerificationCheck("temporalLayout", false);
    setVisionCheckEnabled(false);
    setSkip3DLayoutCheck(true);
  };
  const fastest = () => {
    for (const row of rows) setVerificationCheck(row.key, false);
    setVisionCheckEnabled(false);
    setSkip3DLayoutCheck(true);
  };
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-[var(--border)] bg-[var(--bg-row)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[12px] text-[var(--text)]">执行动画</div>
            <div className="text-[10px] text-[var(--text-mute)]">必须保留。验证器需要真实播放整段动画，因此它通常占用最多固定时间。</div>
          </div>
          <span className="chip text-[10px]">必选 · 最慢</span>
        </div>
      </div>
      {rows.map(row => (
        <div key={row.key} className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-row)] px-3 py-2.5">
          <div>
            <div className="flex items-center gap-2 text-[12px] text-[var(--text)]">
              {row.title}<span className="text-[9px] text-[var(--text-faint)]">{row.cost}</span>
            </div>
            <div className="text-[10px] text-[var(--text-mute)]">{row.desc}</div>
          </div>
          <input type="checkbox" checked={verificationChecks[row.key]} onChange={(e) => setVerificationCheck(row.key, e.target.checked)} className="accent-[var(--blue)]" />
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-row)] px-3 py-2.5">
        <div>
          <div className="flex items-center gap-2 text-[12px] text-[var(--text)]">视觉模型检查<span className="text-[9px] text-[var(--text-faint)]">很慢</span></div>
          <div className="text-[10px] text-[var(--text-mute)]">截图并请求远程视觉模型，通常额外增加数秒到几十秒；结果只作为提示。</div>
        </div>
        <input type="checkbox" checked={visionCheckEnabled} onChange={(e) => setVisionCheckEnabled(e.target.checked)} className="accent-[var(--blue)]" />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-row)] px-3 py-2.5">
        <div>
          <div className="text-[12px] text-[var(--text)]">3D 屏幕布局检查（实验性）</div>
          <div className="text-[10px] text-[var(--text-mute)]">3D 投影边界目前不够稳定，建议关闭；执行、公式、数值等选中项目仍会运行。</div>
        </div>
        <input type="checkbox" checked={!skip3DLayoutCheck} onChange={(e) => setSkip3DLayoutCheck(!e.target.checked)} className="accent-[var(--blue)]" />
      </div>
      <div className="flex gap-2">
        <button className="btn-blue px-3 py-1.5 rounded-md text-[11px]" onClick={recommended}>推荐设置</button>
        <button className="btn-ghost px-3 py-1.5 rounded-md text-[11px]" onClick={fastest}>最快模式</button>
      </div>
      <div className="rounded-md border border-[var(--border)] bg-[var(--bg-row)] px-3 py-2.5 text-[10px] text-[var(--text-mute)] leading-relaxed">
        设置保存在当前浏览器。关闭项目会缩短检查时间或降低 CPU 占用，但不会缩短动画代码自身的播放时长。
      </div>
    </div>
  );
}

function EditForm({
  value, onChange, onSave, onCancel, busy,
}: {
  value: EndpointConfig;
  onChange: (v: EndpointConfig) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const fields: { key: keyof EndpointConfig; label: string; ph: string }[] = [
    { key: "name", label: "名称", ph: "如 DeepSeek 官方" },
    { key: "baseUrl", label: "接入 URL", ph: "https://api.deepseek.com/" },
    { key: "apiKey", label: "API Key", ph: "sk-..." },
    { key: "model", label: "模型名", ph: "deepseek-v4-flash" },
    { key: "fallbackModel", label: "回退模型名(可选)", ph: "deepseek-chat" },
    { key: "fallbackBaseUrl", label: "回退接入 URL(可选)", ph: "https://api.deepseek.com/" },
    { key: "fallbackApiKey", label: "回退 API Key(可选)", ph: "sk-..." },
  ];
  return (
    <div className="space-y-2.5">
      <div className="text-[11px] text-[var(--text-dim)]">{value.id ? "编辑接入点" : "新增接入点"}</div>
      {fields.map((f) => (
        <div key={f.key}>
          <label className="mb-0.5 block text-[10px] text-[var(--text-faint)]">{f.label}</label>
          <input
            type={f.key.toLowerCase().includes("key") ? "password" : "text"}
            value={(value as any)[f.key] ?? ""}
            placeholder={f.ph}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-3)] px-2.5 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--blue)]/50 placeholder:text-[var(--text-faint)]"
          />
        </div>
      ))}
      <label className="flex items-center gap-2 text-[11px] text-[var(--text-dim)] cursor-pointer select-none">
        <input
          type="checkbox"
          checked={!!value.supportsVision}
          onChange={(e) => onChange({ ...value, supportsVision: e.target.checked })}
          className="accent-[var(--blue)]"
        />
        支持视觉(模型能直接看图;否则走"视觉辅助模型"描述画面)
      </label>
      <div>
        <label className="mb-0.5 block text-[10px] text-[var(--text-faint)]">动画生成推理强度(速度 vs 质量)</label>
        <select
          value={value.reasoningEffort || "high"}
          onChange={(e) => onChange({ ...value, reasoningEffort: e.target.value })}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-3)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--blue)]/50"
        >
          <option value="high">high · 最全但慢(每轮多~15s)</option>
          <option value="medium">medium · 均衡</option>
          <option value="low">low · 快(一步约减半)</option>
          <option value="off">off · 最快(关闭思考,动画更简)</option>
        </select>
      </div>
      <div className="flex gap-2 pt-1">
        <button className="btn-blue px-3 py-1.5 rounded-md text-[11px] disabled:opacity-40" disabled={busy} onClick={onSave}>保存</button>
        <button className="btn-ghost px-3 py-1.5 rounded-md text-[11px]" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

function VisionForm({
  value, onChange, onSave, onCancel, busy,
}: {
  value: EndpointConfig;
  onChange: (v: EndpointConfig) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const fields: { key: keyof EndpointConfig; label: string; ph: string }[] = [
    { key: "name", label: "名称(可选)", ph: "如 GPT-4o / qwen-vl" },
    { key: "baseUrl", label: "接入 URL", ph: "https://api.openai.com/v1" },
    { key: "apiKey", label: "API Key", ph: "sk-..." },
    { key: "model", label: "模型名(需支持图像)", ph: "gpt-4o / qwen-vl-max" },
  ];
  return (
    <div className="space-y-2.5">
      <div className="text-[11px] text-[var(--text-dim)]">视觉辅助模型(主模型无视觉时,用它看动画最后一帧)</div>
      {fields.map((f) => (
        <div key={f.key}>
          <label className="mb-0.5 block text-[10px] text-[var(--text-faint)]">{f.label}</label>
          <input
            type={f.key.toLowerCase().includes("key") ? "password" : "text"}
            value={(value as any)[f.key] ?? ""}
            placeholder={f.ph}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-3)] px-2.5 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--blue)]/50 placeholder:text-[var(--text-faint)]"
          />
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <button className="btn-blue px-3 py-1.5 rounded-md text-[11px] disabled:opacity-40" disabled={busy} onClick={onSave}>保存</button>
        <button className="btn-ghost px-3 py-1.5 rounded-md text-[11px]" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
