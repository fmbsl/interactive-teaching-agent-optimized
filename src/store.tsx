import { VerificationMailbox, type VerificationReport } from "./verificationTypes";
import { clearBusyRun, type BusyTask } from "./busyTask";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { emptyLesson, type Lesson } from "./data/lesson";
import { listLlmConfigs, getAppSettings, type EndpointConfig, type SessionSummary } from "./data/llmClient";
import { loadTheme, saveTheme, loadCustomCss, saveCustomCss, applyTheme, type ThemeId } from "./theme";

type ParamValues = Record<string, number>;
export type StepStatus = "pending" | "active" | "done";

// 长任务忙碌登记:当前正在进行的后台任务(kind + 展示文案)。全局只有 ChatPanel consume 设/清,
// 面板(GraphApp/StagePanel/ExplainPanel/footer)读它显示状态指示动画。

interface AppState {
  lesson: Lesson;
  setLesson: (l: Lesson) => void;
  currentStep: number;
  setCurrentStep: (id: number) => void;
  stepStatus: Record<number, StepStatus>;
  markStepActive: (id: number) => void;
  markStepDone: (id: number) => void;
  paramValues: ParamValues;
  setParam: (name: string, value: number) => void;
  mergeStepParams: (params: { name: string; label: string; min: number; max: number; step: number; default: number }[]) => void;
  updateStepContent: (stepId: number, content: { title?: string; narration?: string; formula?: string; explanation?: string; intent?: string; paramsUsed?: string[] }) => void;
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  stageResetKey: number;
  bumpStageReset: () => void;
  sceneCode: string;
  setSceneCode: (code: string) => void;
  // 浏览器在环验证:后端 render_request 推一段待验证 code,StagePanel 跑完回调 reportVerifyResult
  verifyRequest: { stepId: number; code: string; nonce: number; myRun: number; params?: Record<string, number> } | null;
  requestVerify: (stepId: number, code: string, myRun: number, params?: Record<string, number>) => Promise<VerificationReport>;
  reportVerifyResult: (result: VerificationReport, nonce: number) => void;
  cancelVerification: () => void;
  // 验证开关:BB 重叠检测 / 视觉检查
  bbCheckEnabled: boolean; setBbCheckEnabled: (v: boolean) => void;
  visionCheckEnabled: boolean; setVisionCheckEnabled: (v: boolean) => void;
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  // 会话列表
  sessionList: SessionSummary[];
  setSessionList: (s: SessionSummary[]) => void;
  // 切换会话:恢复某会话的状态(lesson/当前步/sceneCode)
  switchSession: (info: { sessionId: string; lesson: Lesson | null; currentStep: number; sceneCode: string }) => void;
  // 重置为空会话
  resetToEmpty: () => void;
  // 步骤导航请求(由舞台栏按钮触发,ChatPanel 监听执行 consume)
  navRequest: { target: "next" | "prev" | number; nonce: number } | null;
  requestNav: (target: "next" | "prev" | number) => void;
  // LLM 接入点配置
  llmEndpoints: EndpointConfig[];
  activeEndpointId: string | null;
  visionEndpoint: EndpointConfig | null;
  reloadLlmConfigs: () => Promise<void>;
  // 新:主 agent 多轮对话 + 分层 list + 深度 + 文件
  depth: "popular" | "understand" | "deep";
  setDepth: (d: "popular" | "understand" | "deep") => void;
  topics: import("./data/llmClient").Topic[];
  addTopic: (t: import("./data/llmClient").Topic) => void;
  setTopics: (t: import("./data/llmClient").Topic[]) => void;
  updateTopicStep: (stepId: string, content: Partial<import("./data/llmClient").TopicStep>) => void;
  pendingFiles: { file_id: string; name: string }[];   // 输入框待发送的文件 chip
  addPendingFile: (f: { file_id: string; name: string }) => void;
  removePendingFile: (file_id: string) => void;
  clearPendingFiles: () => void;
  // 浮窗开关:动画窗(StagePanel)/讲解窗(ExplainPanel)/分解图窗(GraphApp)。主 agent 按需弹出,可独立关闭。
  stageOpen: boolean; setStageOpen: (v: boolean) => void;
  explainOpen: boolean; setExplainOpen: (v: boolean) => void;
  graphOpen: boolean; setGraphOpen: (v: boolean) => void;
  closeAllWindows: () => void;
  // 当前 session 的知识分解图快照(随 session 走):{question, root_title, snapshot:{nodes,edges}} | null。
  // ChatPanel 切会话时从 detail.graph 写入,GraphApp 挂载/变化时据此重建画布。
  decomposeGraph: { question: string; root_title: string; snapshot: any } | null;
  setDecomposeGraph: (g: { question: string; root_title: string; snapshot: any } | null) => void;
  // 主 agent 出的当前考题(选择题):null 表示无题。右边栏 ExplainPanel 显示,用户作答后 resume 主 agent。
  pendingQuiz: { step_title: string; question: string; options: string[]; answer: number; explanation: string } | null;
  setPendingQuiz: (q: { step_title: string; question: string; options: string[]; answer: number; explanation: string } | null) => void;
  quizResult: { choice: number; correct: boolean; explanation: string } | null;  // 用户作答结果(显示对错+解析)
  setQuizResult: (r: { choice: number; correct: boolean; explanation: string } | null) => void;
  // 待处理的 resume 请求(右边栏考题作答等非 ChatPanel 发起的 resume):ChatPanel useEffect 监听并 consume chatAnswer
  pendingResume: { answer?: string; result?: any } | null;
  setPendingResume: (r: { answer?: string; result?: any } | null) => void;
  // 长任务忙碌登记(分解图/动画生成/出题),各面板用来显示"等待中"状态指示动画
  busyTask: BusyTask | null;
  setBusyTask: (t: BusyTask | null) => void;
  clearBusyTask: (runId: number) => void;
  // 主题 + 自定义 CSS(localStorage 持久化;App 挂载 effect 负责 applyTheme/applyCustomCss)
  theme: string;
  setTheme: (id: string) => void;
  customCss: string;
  setCustomCss: (css: string) => void;
  // 知识分解力度档位(low/mid/high,后端持久化,一并控制深度/节点数/展开上限)
  decomposeEffort: string;
  setDecomposeEffort: (level: string) => void;
  loadAppSettings: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [lesson, setLessonState] = useState<Lesson>(emptyLesson);
  const [currentStep, setCurrentStep] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionList, setSessionList] = useState<SessionSummary[]>([]);
  const [stageResetKey, setStageResetKey] = useState(0);
  const [sceneCode, setSceneCode] = useState("");
  const [bbCheckEnabled, setBbCheckEnabled] = useState(true); // BB 重叠检测开关(打回动画)
  // 新:主 agent 多轮对话状态
  const [depth, setDepth] = useState<"popular" | "understand" | "deep">("understand");
  const [topics, setTopics] = useState<import("./data/llmClient").Topic[]>([]);
  const [pendingFiles, setPendingFiles] = useState<{ file_id: string; name: string }[]>([]);
  const [visionCheckEnabled, setVisionCheckEnabled] = useState(true); // 视觉检查开关(截图给 LLM)。默认开:离屏验证截末帧→qwen3.6-chat 看图→描述塞回 agent,让它真正"看见"画面(重叠/越界)。之前默认 false 导致整条视觉链路从未触发。
  const [decomposeGraph, setDecomposeGraph] = useState<{ question: string; root_title: string; snapshot: any } | null>(null);
  const [pendingQuiz, setPendingQuiz] = useState<{ step_title: string; question: string; options: string[]; answer: number; explanation: string } | null>(null);
  const [quizResult, setQuizResult] = useState<{ choice: number; correct: boolean; explanation: string } | null>(null);
  const [pendingResume, setPendingResume] = useState<{ answer?: string; result?: any } | null>(null);
  const [busyTask, setBusyTask] = useState<BusyTask | null>(null);
  const clearBusyTask = useCallback((runId: number) => setBusyTask(cur => clearBusyRun(cur, runId)), []);
  // 浮窗开关(默认全关 = 对话优先)
  const [stageOpen, setStageOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const closeAllWindows = () => { setStageOpen(false); setExplainOpen(false); setGraphOpen(false); };
  // 主题 + 自定义 CSS(初始从 localStorage 恢复)
  const [theme, setThemeState] = useState<string>(loadTheme);
  const [customCss, setCustomCssState] = useState<string>(loadCustomCss);
  const [decomposeEffort, setDecomposeEffortState] = useState<string>("mid");
  const setTheme = (id: string) => {
    // 立即同步改 DOM(applyTheme 先于任何 useEffect 执行)。否则切主题时子组件(如 StagePanel
    // 用 cssVar 读 --bg-deepest 建场景)的 effect 先于父组件 AppShell 的 applyTheme 执行,
    // 会读到旧主题色。同步应用后,react 提交渲染时读到的已是最新主题。
    applyTheme(id as ThemeId);
    setThemeState(id);
    saveTheme(id as ThemeId);
  };
  const setCustomCss = (css: string) => { setCustomCssState(css); saveCustomCss(css); };
  const setDecomposeEffort = (level: string) => setDecomposeEffortState(level);
  const loadAppSettings = async () => {
    try {
      const s = await getAppSettings();
      setDecomposeEffortState(s.decompose_effort || "mid");
    } catch (e) {
      console.warn("[settings] 加载应用设置失败:", e);
    }
  };
  const [verifyRequest, setVerifyRequest] = useState<{ stepId: number; code: string; nonce: number; myRun: number; params?: Record<string, number> } | null>(null);
  const mailbox = useRef(new VerificationMailbox()).current;
  const cancelVerification = () => {
    mailbox.cancel();
    setVerifyRequest(null);
  };
  const requestVerify = (stepId: number, code: string, myRun: number, params?: Record<string, number>): Promise<VerificationReport> => {
    const { nonce, promise } = mailbox.begin();
    setVerifyRequest({ stepId, code, nonce, myRun, params });
    return promise;
  };
  const reportVerifyResult = (result: VerificationReport, nonce: number) => {
    if (mailbox.complete(nonce, result)) setVerifyRequest(null);
  };
  useEffect(() => () => mailbox.cancel(), [mailbox]);
  const [stepStatus, setStepStatus] = useState<Record<number, StepStatus>>({ 1: "active" });
  const [paramValues, setParamValues] = useState<ParamValues>(() => ({}));

  const setLesson = (l: Lesson) => {
    // 补全后端可能缺的字段(outline 只给 id/title,paramsUsed/explanation 等稍后才填)
    // 默认值整体 spread 与 s 合并:s 的字段优先,缺口用默认值填充;分散字面量会触发 TS2783
    const steps = l.steps.map((s) => ({
      ...{ paramsUsed: [] as string[], intent: "", formula: "", narration: "", explanation: "" },
      ...s,
    }));
    const normalized = { ...l, steps };
    setLessonState(normalized);
    const init: ParamValues = {};
    for (const p of normalized.params) init[p.name] = p.default;
    setParamValues(init);
    setCurrentStep(1);
    const st: Record<number, StepStatus> = {};
    for (const s of normalized.steps) st[s.id] = s.id === 1 ? "active" : "pending";
    setStepStatus(st);
  };

  const markStepActive = (id: number) =>
    setStepStatus((prev) => {
      const next = { ...prev };
      for (const s of Object.keys(next)) {
        const sid = Number(s);
        if (sid === id) next[sid] = "active";
        else if (next[sid] !== "done") next[sid] = "pending";
      }
      return next;
    });
  const markStepDone = (id: number) =>
    setStepStatus((prev) => ({ ...prev, [id]: "done" }));

  // 下游 agent 为某步设计的参数,合并进全局 params + paramValues(去重)
  const mergeStepParams = (params: { name: string; label: string; min: number; max: number; step: number; default: number }[]) => {
    setLessonState((prev) => {
      const existing = new Map(prev.params.map((p) => [p.name, p]));
      for (const p of params) if (!existing.has(p.name)) existing.set(p.name, p as any);
      return { ...prev, params: [...existing.values()] };
    });
    setParamValues((prev) => {
      const next = { ...prev };
      for (const p of params) if (!(p.name in next)) next[p.name] = p.default;
      return next;
    });
  };

  // 下游 agent 设计完某步,把 narration/formula/intent/paramsUsed 写回 lesson.steps(右栏讲解要用)
  const updateStepContent = (stepId: number, content: { title?: string; narration?: string; formula?: string; explanation?: string; intent?: string; paramsUsed?: string[] }) => {
    setLessonState((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => (s.id === stepId ? { ...s, ...content } : s)),
    }));
  };

  // 新流程:按字符串 stepId(topicid-N)更新 topic 子知识点的讲解/参数等
  const updateTopicStep = (stepId: string, content: Partial<import("./data/llmClient").TopicStep>) => {
    setTopics((prev) => prev.map((tp) => ({
      ...tp,
      steps: tp.steps.map((s) => (s.id === stepId ? { ...s, ...content } : s)),
    })));
  };

  const switchSession = (info: { sessionId: string; lesson: Lesson | null; currentStep: number; sceneCode: string }) => {
    cancelVerification();
    setSessionId(info.sessionId);
    setCurrentStep(info.currentStep);
    setSceneCode(info.sceneCode);
    if (info.lesson) {
      const steps = (info.lesson.steps ?? []).map((s) => ({
        ...{ paramsUsed: [] as string[], intent: "", formula: "", narration: "", explanation: "" },
        ...s,
      }));
      const lesson = { ...info.lesson, steps };
      setLessonState(lesson);
      const init: ParamValues = {};
      for (const p of (lesson.params ?? [])) init[p.name] = p.default;
      setParamValues(init);
      const st: Record<number, StepStatus> = {};
      for (const s of lesson.steps) st[s.id] = s.id === info.currentStep ? "active" : (s.id < info.currentStep ? "done" : "pending");
      setStepStatus(st);
    }
    setStageResetKey((k) => k + 1);
  };

  const resetToEmpty = () => {
    cancelVerification();
    setSessionId(null);
    setCurrentStep(1);
    setSceneCode("");
    setLessonState(emptyLesson);
    setStepStatus({ 1: "active" });
    setParamValues({});
    setStageResetKey((k) => k + 1);
    setDecomposeGraph(null);
  };

  // 步骤导航请求:舞台栏按钮调 requestNav,ChatPanel useEffect 监听 navRequest.nonce 变化执行
  const [navRequest, setNavRequest] = useState<{ target: "next" | "prev" | number; nonce: number } | null>(null);
  const requestNav = (target: "next" | "prev" | number) => setNavRequest({ target, nonce: Date.now() });

  // LLM 接入点
  const [llmEndpoints, setLlmEndpoints] = useState<EndpointConfig[]>([]);
  const [activeEndpointId, setActiveEndpointId] = useState<string | null>(null);
  const [visionEndpoint, setVisionEndpoint] = useState<EndpointConfig | null>(null);
  const reloadLlmConfigs = async () => {
    try {
      const s = await listLlmConfigs();
      setLlmEndpoints(s.endpoints || []);
      setActiveEndpointId(s.activeId);
      setVisionEndpoint(s.visionEndpoint || null);
    } catch (e) {
      console.warn("[llm] 加载接入点配置失败:", e);
    }
  };
  useEffect(() => { void reloadLlmConfigs(); }, []);

  const value = useMemo<AppState>(
    () => ({
      lesson, setLesson,
      currentStep, setCurrentStep,
      stepStatus, markStepActive, markStepDone,
      paramValues, setParam: (name, v) => setParamValues((prev) => ({ ...prev, [name]: v })),
      mergeStepParams,
      updateStepContent,
      isPlaying, setIsPlaying,
      stageResetKey, bumpStageReset: () => setStageResetKey((k) => k + 1),
      sceneCode, setSceneCode,
      verifyRequest, requestVerify, reportVerifyResult, cancelVerification,
      bbCheckEnabled, setBbCheckEnabled, visionCheckEnabled, setVisionCheckEnabled,
      sessionId, setSessionId,
      sessionList, setSessionList,
      switchSession, resetToEmpty,
      navRequest, requestNav,
      llmEndpoints, activeEndpointId, visionEndpoint, reloadLlmConfigs,
      depth, setDepth,
      topics, addTopic: (t) => setTopics((prev) => (prev.some((x) => x.id === t.id) ? prev : [...prev, t])), setTopics, updateTopicStep,
      pendingFiles,
      addPendingFile: (f) => setPendingFiles((prev) => (prev.some((x) => x.file_id === f.file_id) ? prev : [...prev, f])),
      removePendingFile: (fid) => setPendingFiles((prev) => prev.filter((x) => x.file_id !== fid)),
      clearPendingFiles: () => setPendingFiles([]),
      stageOpen, setStageOpen, explainOpen, setExplainOpen, graphOpen, setGraphOpen, closeAllWindows,
      decomposeGraph, setDecomposeGraph,
      pendingQuiz, setPendingQuiz,
      quizResult, setQuizResult,
      pendingResume, setPendingResume,
      busyTask, setBusyTask, clearBusyTask,
      theme, setTheme,
      customCss, setCustomCss,
      decomposeEffort, setDecomposeEffort, loadAppSettings,
    }),
    [lesson, currentStep, stepStatus, paramValues, isPlaying, stageResetKey, sceneCode, verifyRequest, bbCheckEnabled, visionCheckEnabled, sessionId, sessionList, navRequest, llmEndpoints, activeEndpointId, visionEndpoint, depth, topics, pendingFiles, stageOpen, explainOpen, graphOpen, decomposeGraph, pendingQuiz, quizResult, pendingResume, busyTask, theme, customCss, decomposeEffort]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
