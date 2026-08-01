import { useEffect, useState } from "react";
import { useApp } from "../store";
import { saveLlmConfig, deleteLlmConfig, setActiveLlmConfig, saveVisionConfig, getUserPrefs, saveUserPrefs, type EndpointConfig } from "../data/llmClient";

const EMPTY: EndpointConfig = {
  id: "", name: "", baseUrl: "", apiKey: "", model: "",
  fallbackModel: "", fallbackBaseUrl: "", fallbackApiKey: "", supportsVision: false,
};

const EMPTY_VISION: EndpointConfig = {
  id: "vision", name: "", baseUrl: "", apiKey: "", model: "",
  fallbackModel: "", fallbackBaseUrl: "", fallbackApiKey: "",
};

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { llmEndpoints, activeEndpointId, visionEndpoint, reloadLlmConfigs } = useApp();
  const [prefs, setPrefs] = useState("");
  const [prefsBusy, setPrefsBusy] = useState(false);
  useEffect(() => { getUserPrefs().then(setPrefs); }, []);
  const savePrefs = async () => {
    setPrefsBusy(true);
    try { await saveUserPrefs(prefs); } finally { setPrefsBusy(false); }
  };
  const [editing, setEditing] = useState<EndpointConfig | null>(null);
  const [editingVision, setEditingVision] = useState<EndpointConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
  const remove = (id: string) => wrap(async () => {
    await deleteLlmConfig(id);
    await reloadLlmConfigs();
  });
  const activate = (id: string) => wrap(async () => {
    await setActiveLlmConfig(id);
    await reloadLlmConfigs();
  });
  const saveVision = () => wrap(async () => {
    if (!editingVision) return;
    if (!editingVision.baseUrl.trim() || !editingVision.model.trim()) {
      setErr("视觉辅助模型的接入 URL、模型名必填");
      return;
    }
    await saveVisionConfig(editingVision);
    await reloadLlmConfigs();
    setEditingVision(null);
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 panel"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[560px] max-h-[85vh] overflow-auto rounded-xl border border-[#1e293b] bg-[#0b0f18] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#1e293b] px-4 py-3">
          <h2 className="text-[13px] font-semibold text-[#dfe6f0]">LLM 接入点设置</h2>
          <button className="btn-ghost px-2 py-0.5 rounded text-[11px]" onClick={onClose}>关闭</button>
        </div>

        <div className="p-4">
          {err && (
            <div className="mb-3 rounded-md border border-[#5a3a3a] bg-[#2a1414] px-3 py-2 text-[11px] text-[#e0a0a0]">{err}</div>
          )}

          {editing ? (
            <EditForm
              value={editing}
              onChange={setEditing}
              onSave={save}
              onCancel={() => setEditing(null)}
              busy={busy}
            />
          ) : (
            <>
              <div className="space-y-1.5">
                {llmEndpoints.map((ep) => (
                  <div key={ep.id} className="flex items-center gap-2 rounded-md border border-[#1e293b] bg-[#0f1828] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12px] text-[#dfe6f0]">{ep.name}</span>
                        {activeEndpointId === ep.id && (
                          <span className="chip bg-[#4a9eff]/15 text-[#5fb0ff]">启用中</span>
                        )}
                      </div>
                      <div className="truncate text-[10px] text-[#4a5365]">{ep.model} · {ep.baseUrl}</div>
                    </div>
                    {activeEndpointId !== ep.id && (
                      <button className="btn-ghost px-2 py-0.5 rounded text-[10px]" disabled={busy} onClick={() => activate(ep.id)}>设为启用</button>
                    )}
                    <button className="btn-ghost px-2 py-0.5 rounded text-[10px]" disabled={busy} onClick={() => setEditing({ ...ep })}>编辑</button>
                    <button className="btn-ghost px-2 py-0.5 rounded text-[10px]" disabled={busy} onClick={() => remove(ep.id)}>删除</button>
                  </div>
                ))}
                {llmEndpoints.length === 0 && (
                  <div className="py-6 text-center text-[11px] text-[#4a5365]">暂无接入点,点击下方新增</div>
                )}
              </div>
              <button
                className="btn-blue mt-3 px-3 py-1.5 rounded-md text-[11px]"
                onClick={() => setEditing({ ...EMPTY })}
              >+ 新增接入点</button>
            </>
          )}

          <div className="mt-5 border-t border-[#1e293b] pt-4">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-[12px] font-semibold text-[#dfe6f0]">视觉辅助模型</h3>
              <span className="text-[10px] text-[#4a5365]">主模型不支持视觉时,用它描述动画画面</span>
            </div>
            {editingVision ? (
              <VisionForm
                value={editingVision}
                onChange={setEditingVision}
                onSave={saveVision}
                onCancel={() => setEditingVision(null)}
                busy={busy}
              />
            ) : (
              <div>
                {visionEndpoint && visionEndpoint.baseUrl ? (
                  <div className="flex items-center gap-2 rounded-md border border-[#1e293b] bg-[#0f1828] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-[#dfe6f0]">{visionEndpoint.name || "视觉辅助"}</div>
                      <div className="truncate text-[10px] text-[#4a5365]">{visionEndpoint.model} · {visionEndpoint.baseUrl}</div>
                    </div>
                    <button className="btn-ghost px-2 py-0.5 rounded text-[10px]" disabled={busy} onClick={() => setEditingVision({ ...visionEndpoint })}>编辑</button>
                  </div>
                ) : (
                  <div className="py-2 text-center text-[11px] text-[#4a5365]">未配置(主模型无视觉时,视觉检查自动跳过)</div>
                )}
                {!visionEndpoint?.baseUrl && (
                  <button
                    className="btn-blue mt-2 px-3 py-1.5 rounded-md text-[11px]"
                    onClick={() => setEditingVision({ ...EMPTY_VISION })}
                  >+ 配置视觉辅助模型</button>
                )}
              </div>
            )}
          </div>

          {/* 用户偏好(全局记忆,主 agent 提示词读它) */}
          <div className="mt-4">
            <div className="text-[11px] font-medium text-[#9aa6b8] mb-1.5">用户偏好(主 agent 全局记忆)</div>
            <textarea
              value={prefs}
              onChange={(e) => setPrefs(e.target.value)}
              rows={4}
              placeholder="如:喜欢用类比讲解;数学背景较强,可以跳过基础;偏好简洁,少用公式…"
              className="w-full text-[11px] text-[#dfe6f0] bg-[#0a0f1a] border border-[#1e293b] rounded px-2 py-1.5 outline-none resize-none leading-relaxed"
            />
            <button onClick={savePrefs} disabled={prefsBusy} className="btn-blue mt-1.5 px-3 py-1 rounded-md text-[11px] disabled:opacity-40">
              {prefsBusy ? "保存中…" : "保存偏好"}
            </button>
          </div>
        </div>
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
      <div className="text-[11px] text-[#9aa6b8]">{value.id ? "编辑接入点" : "新增接入点"}</div>
      {fields.map((f) => (
        <div key={f.key}>
          <label className="mb-0.5 block text-[10px] text-[#4a5365]">{f.label}</label>
          <input
            type={f.key.toLowerCase().includes("key") ? "password" : "text"}
            value={(value as any)[f.key] ?? ""}
            placeholder={f.ph}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            className="w-full rounded-md border border-[#1e293b] bg-[#161f2e] px-2.5 py-1.5 text-[11px] text-[#dfe6f0] outline-none focus:border-[#4a9eff]/50 placeholder:text-[#4a5365]"
          />
        </div>
      ))}
      <label className="flex items-center gap-2 text-[11px] text-[#9aa6b8] cursor-pointer select-none">
        <input
          type="checkbox"
          checked={!!value.supportsVision}
          onChange={(e) => onChange({ ...value, supportsVision: e.target.checked })}
          className="accent-[#4a9eff]"
        />
        支持视觉(模型能直接看图;否则走"视觉辅助模型"描述画面)
      </label>
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
      <div className="text-[11px] text-[#9aa6b8]">视觉辅助模型(主模型无视觉时,用它看动画最后一帧)</div>
      {fields.map((f) => (
        <div key={f.key}>
          <label className="mb-0.5 block text-[10px] text-[#4a5365]">{f.label}</label>
          <input
            type={f.key.toLowerCase().includes("key") ? "password" : "text"}
            value={(value as any)[f.key] ?? ""}
            placeholder={f.ph}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            className="w-full rounded-md border border-[#1e293b] bg-[#161f2e] px-2.5 py-1.5 text-[11px] text-[#dfe6f0] outline-none focus:border-[#4a9eff]/50 placeholder:text-[#4a5365]"
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
