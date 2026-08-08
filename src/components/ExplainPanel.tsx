import { useApp } from "../store";
import { Check, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

export default function ExplainPanel() {
  const { lesson, currentStep, topics, pendingQuiz, quizResult, setQuizResult, setPendingResume } = useApp();
  // 新流程:currentStep 是字符串 topicid-N,从 topics 找;旧流程:数字,从 lesson.steps 找
  // lesson 可能为 null(分解建的空 session),用空数组兜底
  const lessonSteps = lesson?.steps ?? [];
  const step = typeof currentStep === "string"
    ? topics.flatMap((t) => t.steps).find((s) => s.id === currentStep)
    : lessonSteps[currentStep - 1];

  // 新流程用 explanation(md,含公式);旧流程降级为 narration + formula 独立块。step null 时空。
  const hasMd = !!step && !!(step as any).explanation && (step as any).explanation.trim().length > 0;
  const mdContent = !step ? "" : (hasMd
    ? (step as any).explanation
    : (step.narration ? step.narration : "") + (step.formula ? `\n\n$$${step.formula}$$` : ""));

  // 考题作答:用户点选项 → 本地判对错显示+解析;经 store.pendingResume 触发 ChatPanel consume chatAnswer
  // (主 agent 对作答的反馈走 ChatPanel consume 进对话栏)
  const answerQuiz = (choice: number) => {
    if (!pendingQuiz || quizResult) return;  // 已作答不重复
    const correct = choice === pendingQuiz.answer;
    setQuizResult({ choice, correct, explanation: pendingQuiz.explanation });
    setPendingResume({ answer: String(choice) });  // ChatPanel useEffect 监听 → consume chatAnswer
  };
  // 跳过此题:resume 主 agent 的 generate_quiz(answer=-1 → 工具判"未作答"),让对话能继续,
  // 避免用户发新消息时撞上悬空的 tool_call 导致 INVALID_CHAT_HISTORY
  const skipQuiz = () => {
    if (!pendingQuiz || quizResult) return;
    setQuizResult({ choice: -1, correct: false, explanation: "你跳过了这道题。" });
    setPendingResume({ answer: "-1" });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 h-9 border-b border-[var(--border)] flex items-center shrink-0">
        <span className="text-[10px] text-[var(--text-faint)] uppercase tracking-wider">Explain</span>
        {step && <span className="ml-2 text-[12px] text-[var(--text-dim)]">{step.title}</span>}
        {step && <span className="ml-auto text-[10px] text-[var(--text-faint)] tnum">{step.id} / {lessonSteps.length}</span>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">
        {!step ? (
          <div className="empty-state min-h-[140px]">
            <div className="empty-icon">¶</div>
            <div className="text-[12px] text-[var(--text-mute)]">在左侧输入知识点后,这里会显示讲解</div>
            <div className="text-[10.5px] text-[var(--text-faint)]">含公式推导、Markdown 图文</div>
          </div>
        ) : (<>
        {/* 讲解(含公式,Markdown 渲染) */}
        <Section label="讲解">
          <div className="md-prose">
            <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
              {mdContent}
            </ReactMarkdown>
          </div>
        </Section>

        {/* 可调参数 */}
        {(step.paramsUsed?.length ?? 0) > 0 && (
          <Section label="可调参数">
            <div className="flex flex-wrap gap-1.5">
              {(step.paramsUsed ?? []).map((name) => {
                const p = (lesson?.params ?? []).find((x) => x.name === name);
                return (
                  <span key={name} className="text-[10px] px-2 py-0.5 rounded-md bg-[var(--blue)]/10 text-[var(--blue-strong)] border border-[var(--blue)]/20">
                    {p?.label ?? name}
                  </span>
                );
              })}
            </div>
          </Section>
        )}
        </>)}

        {/* 考题区:主 agent 出的选择题,用户作答考察是否学懂 */}
        {pendingQuiz && (
          <div className="rounded-lg border border-[var(--blue-deep)]/40 bg-[var(--bg-panel)]/60 p-3 space-y-2 panel-anim">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium text-[var(--blue-light)] uppercase tracking-wider">考题</span>
              {pendingQuiz.step_title && <span className="text-[10px] text-[var(--text-mute)]">· {pendingQuiz.step_title}</span>}
            </div>
            <div className="text-[12px] text-[var(--text)] leading-relaxed">{pendingQuiz.question}</div>
            <div className="space-y-1.5">
              {pendingQuiz.options.map((opt, i) => {
                const chosen = quizResult?.choice === i;
                const isAnswer = pendingQuiz.answer === i;
                let cls = "border-[var(--border)] hover:border-[var(--blue)]/50 hover:bg-[var(--blue)]/8 hover:translate-x-0.5 text-[var(--text-dim)]";
                if (quizResult) {
                  if (isAnswer) cls = "border-[#16a34a] bg-[#16a34a]/15 text-[#86efac] shadow-[0_0_0_1px_rgba(22,163,74,0.3)]";
                  else if (chosen) cls = "border-[#ef4444] bg-[#ef4444]/12 text-[#fca5a5]";
                  else cls = "border-[var(--border)] text-[var(--text-mute)] opacity-60";
                }
                return (
                  <button
                    key={i}
                    onClick={() => answerQuiz(i)}
                    disabled={!!quizResult}
                    className={`w-full text-left text-[11px] px-2.5 py-1.5 rounded-md border transition-all duration-150 ${cls} ${quizResult ? "cursor-default" : "cursor-pointer"}`}
                  >
                    <span className="text-[10px] font-semibold mr-1.5 tnum">{String.fromCharCode(65 + i)}.</span>
                    {opt}
                    {quizResult && isAnswer && <span className="ml-2 text-[10px] inline-flex items-center gap-0.5"><Check size={11} /> 正确</span>}
                    {quizResult && chosen && !isAnswer && <span className="ml-2 text-[10px] inline-flex items-center gap-0.5"><X size={11} /> 你选的</span>}
                  </button>
                );
              })}
            </div>
            {!quizResult && (
              <button
                onClick={skipQuiz}
                className="w-full text-[10px] text-[var(--text-faint)] hover:text-[var(--text-dim)] border border-[var(--border)] hover:border-[var(--blue-deep)]/40 rounded-md px-2 py-1 transition-colors"
              >
                跳过此题,继续对话
              </button>
            )}
            {quizResult && (
              <div className={`text-[11px] leading-relaxed rounded-md p-2 ${quizResult.correct ? "bg-[#16a34a]/10 text-[#86efac]" : "bg-[#ef4444]/8 text-[#fca5a5]"}`}>
                <span className="font-medium">{quizResult.correct ? "答对啦!" : "答错了"}</span>
                <span className="text-[var(--text-dim)]"> 解析:{quizResult.explanation}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-medium text-[var(--text-dim)] uppercase tracking-wider">{label}</span>
        {hint && <span className="text-[9px] text-[var(--text-faint)] border border-[var(--border)] rounded px-1.5 py-px">{hint}</span>}
        <span className="flex-1 h-px bg-[var(--border)]" />
      </div>
      {children}
    </div>
  );
}
