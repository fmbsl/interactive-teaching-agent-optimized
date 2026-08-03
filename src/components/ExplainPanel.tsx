import { useApp } from "../store";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

export default function ExplainPanel() {
  const { lesson, currentStep, topics, pendingQuiz, setPendingQuiz, quizResult, setQuizResult, setPendingResume } = useApp();
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

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 h-9 border-b border-[#1e293b] flex items-center shrink-0">
        <span className="text-[10px] text-[#4a5365] uppercase tracking-wider">Explain</span>
        {step && <span className="ml-2 text-[12px] text-[#9aa6b8]">{step.title}</span>}
        {step && <span className="ml-auto text-[10px] text-[#4a5365] tnum">{step.id} / {lessonSteps.length}</span>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">
        {!step ? (
          <div className="grid place-items-center text-[11px] text-[#4a5365] px-6 text-center min-h-[120px]">
            在左侧输入知识点后,这里会显示当前步骤的公式与讲解。
          </div>
        ) : (<>
        {/* 动画意图 */}
        {step.intent && (
          <Section label="动画意图" hint="Animator 输入">
            <p className="text-[11px] text-[#6b7686] leading-relaxed">{step.intent}</p>
          </Section>
        )}

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
                  <span key={name} className="text-[10px] px-2 py-0.5 rounded-md bg-[#4a9eff]/10 text-[#5fb0ff] border border-[#4a9eff]/20">
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
          <div className="rounded-lg border border-[#2b6cb0]/40 bg-[#0d1626]/60 p-3 space-y-2 panel-anim">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium text-[#9ec5ff] uppercase tracking-wider">考题</span>
              {pendingQuiz.step_title && <span className="text-[10px] text-[#6b7686]">· {pendingQuiz.step_title}</span>}
            </div>
            <div className="text-[12px] text-[#dfe6f0] leading-relaxed">{pendingQuiz.question}</div>
            <div className="space-y-1.5">
              {pendingQuiz.options.map((opt, i) => {
                const chosen = quizResult?.choice === i;
                const isAnswer = pendingQuiz.answer === i;
                let cls = "border-[#1e293b] hover:border-[#4a9eff]/50 hover:bg-[#4a9eff]/5 text-[#9aa6b8]";
                if (quizResult) {
                  if (isAnswer) cls = "border-[#16a34a] bg-[#16a34a]/12 text-[#86efac]";
                  else if (chosen) cls = "border-[#ef4444] bg-[#ef4444]/10 text-[#fca5a5]";
                  else cls = "border-[#1e293b] text-[#6b7686] opacity-70";
                }
                return (
                  <button
                    key={i}
                    onClick={() => answerQuiz(i)}
                    disabled={!!quizResult}
                    className={`w-full text-left text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${cls} ${quizResult ? "cursor-default" : "cursor-pointer"}`}
                  >
                    <span className="text-[10px] font-semibold mr-1.5 tnum">{String.fromCharCode(65 + i)}.</span>
                    {opt}
                    {quizResult && isAnswer && <span className="ml-2 text-[10px]">✓ 正确</span>}
                    {quizResult && chosen && !isAnswer && <span className="ml-2 text-[10px]">✗ 你选的</span>}
                  </button>
                );
              })}
            </div>
            {quizResult && (
              <div className={`text-[11px] leading-relaxed rounded-md p-2 ${quizResult.correct ? "bg-[#16a34a]/10 text-[#86efac]" : "bg-[#ef4444]/8 text-[#fca5a5]"}`}>
                <span className="font-medium">{quizResult.correct ? "答对啦!" : "答错了"}</span>
                <span className="text-[#9aa6b8]"> 解析:{quizResult.explanation}</span>
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
        <span className="text-[10px] font-medium text-[#9aa6b8] uppercase tracking-wider">{label}</span>
        {hint && <span className="text-[9px] text-[#4a5365] border border-[#1e293b] rounded px-1.5 py-px">{hint}</span>}
        <span className="flex-1 h-px bg-[#1e293b]" />
      </div>
      {children}
    </div>
  );
}
