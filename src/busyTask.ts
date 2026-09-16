import type { ChatEvent } from './data/llmClient';

export type BusyTask = { kind: 'agent' | 'graph' | 'animation' | 'quiz'; label: string; runId: number };

/** Both SSE consumers share these transitions; run identity owns cleanup. */
export function busyForEvent(ev: ChatEvent, runId: number): BusyTask | null | undefined {
  if (ev.kind === 'graph_command_request') return {kind: 'graph', label: '正在分解知识点…', runId};
  if (ev.kind === 'animation_request' || ev.kind === 'step-start' || (ev.kind === 'agent_start' && ev.agent === 'step'))
    return {kind: 'animation', label: '正在生成动画…', runId};
  if (ev.kind === 'modify_request') return {kind: 'animation', label: '正在修改动画…', runId};
  if (ev.kind === 'render_request') return {kind: 'animation', label: '正在验证动画…', runId};
  if (ev.kind === 'tool_call' && ev.name === 'generate_quiz') return {kind: 'quiz', label: '正在出题…', runId};
  if (['quiz', 'ask', 'done', 'error', 'explain'].includes(ev.kind)) return null;
  return undefined;
}

export function clearBusyRun(task: BusyTask | null, runId: number): BusyTask | null {
  return task?.runId === runId ? null : task;
}
