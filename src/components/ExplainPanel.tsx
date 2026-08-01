import { useApp } from "../store";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

export default function ExplainPanel() {
  const { lesson, currentStep } = useApp();
  const step = lesson.steps[currentStep - 1];

  if (!step) {
    return (
      <div className="flex h-full flex-col">
        <div className="px-4 h-9 border-b border-[#1e293b] flex items-center shrink-0">
          <span className="text-[10px] text-[#4a5365] uppercase tracking-wider">Explain</span>
        </div>
        <div className="flex-1 grid place-items-center text-[11px] text-[#4a5365] px-6 text-center">
          在左侧输入知识点后,这里会显示当前步骤的公式与讲解。
        </div>
      </div>
    );
  }

  // 新流程用 explanation(md,含公式);旧流程降级为 narration + formula 独立块
  const hasMd = !!(step as any).explanation && (step as any).explanation.trim().length > 0;
  const mdContent = hasMd
    ? (step as any).explanation
    : (step.narration ? step.narration : "") + (step.formula ? `\n\n$$${step.formula}$$` : "");

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 h-9 border-b border-[#1e293b] flex items-center shrink-0">
        <span className="text-[10px] text-[#4a5365] uppercase tracking-wider">Explain</span>
        <span className="ml-2 text-[12px] text-[#9aa6b8]">{step.title}</span>
        <span className="ml-auto text-[10px] text-[#4a5365] tnum">{step.id} / {lesson.steps.length}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">
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
                const p = lesson.params.find((x) => x.name === name);
                return (
                  <span key={name} className="text-[10px] px-2 py-0.5 rounded-md bg-[#4a9eff]/10 text-[#5fb0ff] border border-[#4a9eff]/20">
                    {p?.label ?? name}
                  </span>
                );
              })}
            </div>
          </Section>
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
