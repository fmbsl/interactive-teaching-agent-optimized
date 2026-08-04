// 真后端流式客户端:对接 Django LangGraph agent。
// 三端点:/api/start /api/next /api/update + /api/upload(文件)
// SSE 事件:session / plan / step-start / explain / done / error

import type { LessonParam, LessonStep } from "./lesson";

export type AgentRole = "user" | "orchestrator" | "animator" | "verifier" | "narrator";

export type Depth = "popular" | "understand" | "deep";

export interface TopicStep { id: string; title: string; explanation?: string; intent?: string; narration?: string; formula?: string; paramsUsed?: string[]; params?: any[]; sceneCode?: string; level?: number; parent_title?: string | null; is_summary?: boolean }
export interface Topic { id: string; title: string; summary: string; steps: TopicStep[] }

export type ChatEvent = {
  id?: string; parentId?: string | null; ts?: number; agent?: string;
} & (
  | { kind: "message"; role: AgentRole; text: string }
  | { kind: "message_delta"; id: string; role: AgentRole; text: string }  // 流式增量:同 id 追加,前端往同一条 message 累加文本
  | { kind: "session"; sessionId: string }
  | { kind: "plan"; title: string; summary: string; params: LessonParam[]; steps: LessonStep[] }
  | { kind: "step-start"; stepId: number; title: string }
  | { kind: "agent_start"; stepId: number; title: string }
  | { kind: "tool_call"; stepId: number | null; name: string; args: Record<string, any> }
  | { kind: "tool_result"; stepId: number | null; toolCallId: string | null; output: string }
  | { kind: "render_request"; stepId: number; code: string }
  | { kind: "render_result"; stepId: number; ok: boolean; error: string }
  | { kind: "explain"; stepId: number; title: string; intent: string; formula: string; narration: string; explanation?: string; paramsUsed: string[]; params: { name: string; label: string; min: number; max: number; step: number; default: number }[]; sceneCode: string }
  | { kind: "topic_added"; topic: Topic }
  | { kind: "ask"; question: string; options?: string[] }
  | { kind: "animation_request"; stepId: string; step_id: string }
  | { kind: "stage_switch"; stage: "graph" | "animation" }  // 主 agent 切换中间舞台:graph=分解图,animation=动画
  | { kind: "graph"; payload: any }  // 主 agent 图编辑工具改图后推的分解图快照,前端刷新画布
  | { kind: "quiz"; step_title: string; question: string; options: string[]; answer: number; explanation: string }  // 主 agent 出的选择题,右边栏显示,用户作答后 resume
  | { kind: "diagram"; step_title: string; diagram_type: string; code: string; explanation: string }  // 主 agent 产的 mermaid 图,中间舞台 MermaidPanel 渲染
  | { kind: "decompose_request"; question: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string }
);

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://localhost:8000";

export async function uploadFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const resp = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: fd });
  if (!resp.ok) throw new Error(`上传失败 ${resp.status}`);
  const obj = await resp.json();
  if (obj.error) throw new Error(obj.error);
  return obj.file_text as string;
}

/** 上传文件到指定 session(新流程):存后端,返回 {file_id,name,size}。主 agent 用 read/grep 按需读。 */
export async function uploadForSession(sid: string, file: File): Promise<{ file_id: string; name: string; size: number }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("sid", sid);
  const resp = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: fd });
  if (!resp.ok) throw new Error(`上传失败 ${resp.status}`);
  const obj = await resp.json();
  if (obj.error) throw new Error(obj.error);
  return { file_id: obj.file_id, name: obj.name, size: obj.size };
}

/** 主 agent 多轮对话:SSE 流。sid 留空则后端新建。 */
export async function* chat(sid: string, text: string, depth: Depth = "understand", fileIds: string[] = []): AsyncGenerator<ChatEvent> {
  yield* streamSSE(`${API_BASE}/api/chat`, { sid, text, depth, file_ids: fileIds });
}

/** 回传 ask_user 的回答 或 generate_animation 的结果,恢复主 agent:SSE 流。 */
export async function* chatAnswer(sid: string, answer: string = "", result: any = null): AsyncGenerator<ChatEvent> {
  const body: Record<string, unknown> = { sid, answer };
  if (result !== null) body.result = result;
  yield* streamSSE(`${API_BASE}/api/chat_answer`, body);
}

/** 用户偏好(全局记忆):GET 取 / POST 存。 */
export async function getUserPrefs(): Promise<string> {
  const r = await fetch(`${API_BASE}/api/user_prefs`);
  if (!r.ok) return "";
  return (await r.json()).prefs || "";
}
export async function saveUserPrefs(prefs: string): Promise<void> {
  await fetch(`${API_BASE}/api/user_prefs`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefs }),
  });
}

/** 发起会话:SSE 流。yield 出事件。 */
export async function* startLesson(question: string, fileText?: string): AsyncGenerator<ChatEvent> {
  yield { kind: "message", role: "orchestrator", text: "正在分析并拆解知识点…" };
  yield* streamSSE(`${API_BASE}/api/start`, { question, file_text: fileText ?? null });
}

/** 下一步:SSE 流。 */
export async function* nextStep(sessionId: string): AsyncGenerator<ChatEvent> {
  yield* streamSSE(`${API_BASE}/api/next`, { session_id: sessionId });
}

/** 上一步:SSE 流。 */
export async function* prevStep(sessionId: string): AsyncGenerator<ChatEvent> {
  yield* streamSSE(`${API_BASE}/api/prev`, { session_id: sessionId });
}

/** 跳到任意步(用缓存):SSE 流。 */
export async function* gotoStep(sessionId: string, stepId: number): AsyncGenerator<ChatEvent> {
  yield* streamSSE(`${API_BASE}/api/goto`, { session_id: sessionId, step_id: stepId });
}

/** 生成某步动画(点 list 触发,step_id 可为字符串 'topicid-N'):SSE 流。 */
export async function* explainStep(sessionId: string, stepId: number | string): AsyncGenerator<ChatEvent> {
  yield* streamSSE(`${API_BASE}/api/explain`, { session_id: sessionId, step_id: stepId });
}

/** 更新问题(重新拆解):SSE 流。 */
export async function* updateQuestion(sessionId: string, question: string, fileText?: string): AsyncGenerator<ChatEvent> {
  yield { kind: "message", role: "orchestrator", text: "已更新问题,重新拆解…" };
  yield* streamSSE(`${API_BASE}/api/update`, { session_id: sessionId, question, file_text: fileText ?? null });
}

/** 场景代码报错,重生成该步:SSE 流。 */
export async function* regenerateScene(sessionId: string, stepId: number, error: string): AsyncGenerator<ChatEvent> {
  yield* streamSSE(`${API_BASE}/api/regenerate`, { session_id: sessionId, step_id: stepId, error });
}

/** 浏览器渲染回传:把渲染结果(ok/error)POST 给后端,后端恢复 agent,流式返回 render_request(再次失败)/ explain / error。 */
export async function* postRenderResult(sessionId: string, stepId: number, ok: boolean, error: string, frame: string = ""): AsyncGenerator<ChatEvent> {
  // frame: ok=true 时可选,最后一帧 base64(视觉检查用);为空字符串则不带
  const body: Record<string, unknown> = { session_id: sessionId, step_id: stepId, ok, error };
  if (frame) body.frame = frame;
  yield* streamSSE(`${API_BASE}/api/render_result`, body);
}

// ---------- 会话管理 ----------

export interface SessionSummary { session_id: string; title: string; question: string; current_step: number; step_count: number }

export async function listSessions(): Promise<SessionSummary[]> {
  const r = await fetch(`${API_BASE}/api/sessions`);
  if (!r.ok) throw new Error(`列会话失败 ${r.status}`);
  const obj = await r.json();
  return obj.sessions || [];
}

export async function newSession(): Promise<string> {
  const r = await fetch(`${API_BASE}/api/sessions`, { method: "POST" });
  if (!r.ok) throw new Error(`新建会话失败 ${r.status}`);
  const obj = await r.json();
  return obj.session_id;
}

export interface SessionDetail {
  session_id: string; question: string; title: string; current_step: number;
  lesson: any; scene_codes: Record<number, string>;
}

export async function getSession(sid: string): Promise<SessionDetail> {
  const r = await fetch(`${API_BASE}/api/sessions/${sid}`);
  if (!r.ok) throw new Error(`取会话失败 ${r.status}`);
  return r.json();
}

/** 取某会话的执行树事件流(切回旧会话时重建 Claude Code 式视图)。 */
export async function getTrace(sid: string): Promise<ChatEvent[]> {
  const r = await fetch(`${API_BASE}/api/sessions/${sid}/trace`);
  if (!r.ok) throw new Error(`取执行树失败 ${r.status}`);
  const obj = await r.json();
  const evts = obj.events || [];
  // 把落盘的 evt {id,parentId,ts,kind,agent,stepId,payload} 还原成 ChatEvent
  return evts.map((e: any) => {
    const p = e.payload || {};
    const base = { id: e.id, parentId: e.parentId, ts: e.ts, agent: e.agent };
    switch (e.kind) {
      case "message": return { ...base, kind: "message", role: p.role || "orchestrator", text: p.text || "" };
      case "message_delta": return { ...base, kind: "message_delta", id: e.id || p.id || "", role: p.role || "orchestrator", text: p.text || "" };
      case "plan": return { ...base, kind: "plan", title: p.title, summary: p.summary, params: p.params, steps: p.steps };
      case "step-start": return { ...base, kind: "step-start", stepId: (p.stepId ?? e.stepId), title: p.title };
      case "agent_start": return { ...base, kind: "agent_start", stepId: (p.stepId ?? e.stepId), title: p.title };
      case "tool_call": return { ...base, kind: "tool_call", stepId: (p.stepId ?? e.stepId), name: p.name, args: p.args || {} };
      case "tool_result": return { ...base, kind: "tool_result", stepId: (p.stepId ?? e.stepId), toolCallId: p.toolCallId ?? null, output: p.output || "" };
      case "render_request": return { ...base, kind: "render_request", stepId: (p.stepId ?? e.stepId), code: p.code || "" };
      case "render_result": return { ...base, kind: "render_result", stepId: (p.stepId ?? e.stepId), ok: !!p.ok, error: p.error || "" };
      case "explain": return { ...base, kind: "explain", stepId: (p.stepId ?? e.stepId), title: p.title, intent: p.intent, formula: p.formula, narration: p.narration, explanation: p.explanation || "", paramsUsed: p.paramsUsed, params: p.params || [], sceneCode: p.sceneCode || "" };
      case "topic_added": return { ...base, kind: "topic_added", topic: p as Topic };
      case "ask": return { ...base, kind: "ask", question: p.question || "", options: p.options };
      case "animation_request": return { ...base, kind: "animation_request", stepId: p.step_id || "", step_id: p.step_id || "" };
    case "stage_switch": return { ...base, kind: "stage_switch", stage: p.stage || "animation" };
      case "graph": return { ...base, kind: "graph", payload: p };
      case "quiz": return { ...base, kind: "quiz", step_title: p.step_title || "", question: p.question || "", options: p.options || [], answer: p.answer ?? 0, explanation: p.explanation || "" };
    case "diagram": return { ...base, kind: "diagram", step_title: p.step_title || "", diagram_type: p.diagram_type || "", code: p.code || "", explanation: p.explanation || "" };
      case "decompose_request": return { ...base, kind: "decompose_request", question: p.question || "" };
      case "error": return { ...base, kind: "error", message: p.message };
      default: return null;
    }
  }).filter(Boolean) as ChatEvent[];
}

/** 导出当前会话为 JSON 文件(浏览器触发下载)。 */
export async function exportSession(sid: string): Promise<void> {
  const r = await fetch(`${API_BASE}/api/session/${sid}/export`);
  if (!r.ok) throw new Error(`导出失败 ${r.status}`);
  const blob = await r.blob();
  const cd = r.headers.get("Content-Disposition") || "";
  const m = /filename="([^"]+)"/.exec(cd);
  const name = m ? m[1] : `session_${sid}.json`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 导入导出的 JSON,重建会话(不调 LLM),返回新 sid + title。 */
export async function importSessionFromFile(file: File): Promise<{ sessionId: string; title: string }> {
  const text = await file.text();
  const data = JSON.parse(text);
  const r = await fetch(`${API_BASE}/api/session/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`导入失败 ${r.status}`);
  return r.json();
}

// ---------- LLM 接入点配置 ----------

export interface EndpointConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fallbackModel: string;
  fallbackBaseUrl: string;
  fallbackApiKey: string;
  supportsVision?: boolean;
}

export interface LlmConfigState {
  activeId: string | null;
  endpoints: EndpointConfig[];
  visionEndpoint?: EndpointConfig;
}

export async function listLlmConfigs(): Promise<LlmConfigState> {
  const r = await fetch(`${API_BASE}/api/llm/config`);
  if (!r.ok) throw new Error(`取 LLM 配置失败 ${r.status}`);
  return r.json();
}

export async function saveLlmConfig(cfg: Partial<EndpointConfig> & { name: string; baseUrl: string; model: string }): Promise<LlmConfigState> {
  const r = await fetch(`${API_BASE}/api/llm/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save", endpoint: cfg }),
  });
  if (!r.ok) throw new Error(`保存接入点失败 ${r.status}`);
  return r.json();
}

export async function saveVisionConfig(endpoint: Partial<EndpointConfig> & { baseUrl: string; model: string }): Promise<LlmConfigState> {
  const r = await fetch(`${API_BASE}/api/llm/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "saveVision", endpoint }),
  });
  if (!r.ok) throw new Error(`保存视觉辅助模型失败 ${r.status}`);
  return r.json();
}

export async function deleteLlmConfig(id: string): Promise<LlmConfigState> {
  const r = await fetch(`${API_BASE}/api/llm/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", id }),
  });
  if (!r.ok) throw new Error(`删除接入点失败 ${r.status}`);
  return r.json();
}

export async function setActiveLlmConfig(id: string): Promise<LlmConfigState> {
  const r = await fetch(`${API_BASE}/api/llm/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "setActive", id }),
  });
  if (!r.ok) throw new Error(`切换接入点失败 ${r.status}`);
  return r.json();
}

// ---------- 知识分解 ----------

/** 知识分解 agent:SSE 流(原始 dict,不经 parseSSE)。sid 给则用主 session(图挂其上),不给后端自建。
 *  事件 kind:session/decompose_start/node/edge/graph/tool_call/tool_result/error/done。 */
export async function* decompose(sid: string, question: string, fileText?: string): AsyncGenerator<any> {
  yield* streamRawSSE(`${API_BASE}/api/decompose`, { sid, question, file_text: fileText ?? null });
}

/** 把分解 DAG 转成 Topic 学习清单,写入该 session 的 topics。sid 为主 session id(图已挂其上)。返回 {session_id, topic}。 */
export async function decomposeToTopics(sid: string, question: string = ""): Promise<{ session_id: string; topic: Topic }> {
  const r = await fetch(`${API_BASE}/api/decompose/${sid}/to_topics`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }),
  });
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({}))).error || `转换失败 ${r.status}`;
    throw new Error(msg);
  }
  return r.json();
}

/** 手动拆分分解图里的节点(双击节点触发)。sid 为主 session id(图挂其上)。返回 {sid, message, graph, events}。 */
export async function decomposeSplit(
  sid: string, target: string, children: { title: string; mastery?: boolean }[],
  prereqs: { title: string; mastery?: boolean }[] = [], deps: { from: string; to: string }[] = [], prune = true,
): Promise<{ sid: string; message: string; graph: any; events: any[] }> {
  const r = await fetch(`${API_BASE}/api/decompose/${sid}/split`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, children, prereqs, deps, prune }),
  });
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({}))).error || `拆分失败 ${r.status}`;
    throw new Error(msg);
  }
  return r.json();
}

/** 通用图编辑(右键菜单用):直接调后端 decompose_agent.edit_*,绕过 LLM 即时改图。
 *  op: remove/add/rename/set_mastered/merge/add_to_topics。params 视 op 而定。
 *  返回 {sid, message, graph}(graph=新快照,前端 setDecomposeGraph 刷新画布)。 */
export async function decomposeEdit(
  sid: string, op: string, params: Record<string, any>,
): Promise<{ sid: string; message: string; graph: any }> {
  const r = await fetch(`${API_BASE}/api/decompose/${sid}/edit`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, ...params }),
  });
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({})).catch(() => ({}))).error || `编辑失败 ${r.status}`;
    throw new Error(msg);
  }
  return r.json();
}

/** agent 自动拆分(右键"拆分"菜单):后端用 LLM 跑 _split_replace 的自动分解,返回新快照。 */
export async function decomposeAutoSplit(sid: string, target: string): Promise<{ sid: string; message: string; graph: any }> {
  const r = await fetch(`${API_BASE}/api/decompose/${sid}/auto_split`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({}))).error || `自动拆分失败 ${r.status}`;
    throw new Error(msg);
  }
  return r.json();
}

async function* streamSSE(url: string, body: any): AsyncGenerator<ChatEvent> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    yield { kind: "error", message: `无法连接后端:${e.message}` };
    return;
  }
  if (!resp.ok || !resp.body) {
    yield { kind: "error", message: `后端返回 ${resp.status}` };
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev = parseSSE(raw);
        if (ev) yield ev;
      }
    }
  } catch (e: any) {
    yield { kind: "error", message: `流中断:${e.message}` };
  } finally {
    // 早退(如切会话/新 run 取代旧 run 时 consume 提前 return,生成器被 .return() 中断):
    // 显式取消底层 reader,否则已建立的 HTTP 连接会挂着直到服务端超时
    try { reader.cancel(); } catch { /* ignore */ }
  }
}

/** 原始 SSE 流:不经 parseSSE 类型窄化,每个 frame 直接 JSON.parse 返回原始事件 dict。
 *  供知识分解 graph 页用(事件 kind:node/edge/graph/decompose_start 不在 ChatEvent union 里)。
 *  返回的 dict 形态:执行树事件 {id,parentId,kind,agent,payload} 或裸控制事件 {kind:"session"/"done"/"error",...}。 */
export async function* streamRawSSE(url: string, body: any): AsyncGenerator<any> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    yield { kind: "error", message: `无法连接后端:${e.message}` };
    return;
  }
  if (!resp.ok || !resp.body) {
    yield { kind: "error", message: `后端返回 ${resp.status}` };
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev = parseRawSSE(raw);
        if (ev) yield ev;
      }
    }
  } catch (e: any) {
    yield { kind: "error", message: `流中断:${e.message}` };
  } finally {
    try { reader.cancel(); } catch { /* ignore */ }
  }
}

function parseRawSSE(raw: string): any | null {
  let event = "";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!event || !data) return null;
  try { return JSON.parse(data); } catch { return null; }
}

function parseSSE(raw: string): ChatEvent | null {
  let event = "";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!event || !data) return null;
  let obj: any;
  try { obj = JSON.parse(data); } catch { return null; }
  // 大部分事件是执行树 evt:{id,parentId,ts,kind,agent,stepId,payload};少数控制事件(session/done/error)是裸 dict。
  const tree = (obj && typeof obj === "object" && "payload" in obj) ? obj : null;
  const p = tree ? tree.payload : obj;
  const base = tree ? { id: tree.id, parentId: tree.parentId, ts: tree.ts, agent: tree.agent } : {};
  switch (event) {
    case "session": return { kind: "session", sessionId: obj.session_id };
    case "message": return { ...base, kind: "message", role: p.role || "orchestrator", text: p.text || "" };
    case "message_delta": return { ...base, kind: "message_delta", id: tree?.id || p.id || "", role: p.role || "orchestrator", text: p.text || "" };
    case "plan": return { ...base, kind: "plan", title: p.title, summary: p.summary, params: p.params, steps: p.steps };
    case "step-start": return { ...base, kind: "step-start", stepId: (p.stepId ?? tree?.stepId), title: p.title };
    case "agent_start": return { ...base, kind: "agent_start", stepId: (p.stepId ?? tree?.stepId), title: p.title };
    case "tool_call": return { ...base, kind: "tool_call", stepId: (p.stepId ?? tree?.stepId), name: p.name, args: p.args || {} };
    case "tool_result": return { ...base, kind: "tool_result", stepId: (p.stepId ?? tree?.stepId), toolCallId: p.toolCallId ?? null, output: p.output || "" };
    case "render_request": return { ...base, kind: "render_request", stepId: (p.stepId ?? tree?.stepId), code: p.code || "" };
    case "render_result": return { ...base, kind: "render_result", stepId: (p.stepId ?? tree?.stepId), ok: !!p.ok, error: p.error || "" };
    case "explain": return { ...base, kind: "explain", stepId: (p.stepId ?? tree?.stepId), title: p.title, intent: p.intent, formula: p.formula, narration: p.narration, explanation: p.explanation || "", paramsUsed: p.paramsUsed, params: p.params || [], sceneCode: p.sceneCode || "" };
    case "topic_added": return { ...base, kind: "topic_added", topic: p as Topic };
    case "ask": return { ...base, kind: "ask", question: p.question || "", options: p.options };
    case "animation_request": return { ...base, kind: "animation_request", stepId: p.step_id || "", step_id: p.step_id || "" };
    case "stage_switch": return { ...base, kind: "stage_switch", stage: p.stage || "animation" };
    case "graph": return { ...base, kind: "graph", payload: p };
    case "quiz": return { ...base, kind: "quiz", step_title: p.step_title || "", question: p.question || "", options: p.options || [], answer: p.answer ?? 0, explanation: p.explanation || "" };
    case "diagram": return { ...base, kind: "diagram", step_title: p.step_title || "", diagram_type: p.diagram_type || "", code: p.code || "", explanation: p.explanation || "" };
    case "decompose_request": return { ...base, kind: "decompose_request", question: p.question || "" };
    case "done": return { kind: "done", message: obj.message };
    case "error": return tree ? { ...base, kind: "error", message: p.message } : { kind: "error", message: obj.message };
    default: return null;
  }
}
