import { useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

// Mermaid 展示面板:主 agent 对非数学/物理类知识点(生物分类、历史脉络、地理流程、软件架构等)
// 用 mermaid 图(流程图/时序图/类图/状态图/思维导图/甘特图)展示,补 manim 之短。
// mermaid 代码由主 agent generate_diagram 工具产出,经 diagram 事件存 store.diagram,这里渲染。
// 渲染失败(语法错)显示错误,主 agent 可重新产图。

let mermaidReady: Promise<any> | null = null;
async function loadMermaid() {
  if (mermaidReady) return mermaidReady;
  mermaidReady = (async () => {
    const m = await import("mermaid");
    m.default.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose", fontFamily: '"Times New Roman","SimSun",serif' });
    return m.default;
  })();
  return mermaidReady;
}

export default function MermaidPanel() {
  const { diagram } = useApp() as any;
  const [svg, setSvg] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [rendering, setRendering] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    const code = (diagram as any)?.code || "";
    if (!code) { setSvg(""); setErr(""); return; }
    let cancelled = false;
    const mySeq = ++seqRef.current;
    setRendering(true); setErr("");
    (async () => {
      try {
        const mermaid = await loadMermaid();
        if (cancelled || mySeq !== seqRef.current) return;
        const id = `mmd-${mySeq}-${Date.now().toString(36)}`;
        const { svg: out } = await mermaid.render(id, code);
        if (!cancelled && mySeq === seqRef.current) { setSvg(out); setErr(""); }
      } catch (e: any) {
        if (!cancelled && mySeq === seqRef.current) {
          // mermaid.render 失败:提取错误信息(常含 parse error 位置)
          setErr(e?.message || String(e));
          setSvg("");
        }
      } finally {
        if (!cancelled && mySeq === seqRef.current) setRendering(false);
      }
    })();
    return () => { cancelled = true; };
  }, [(diagram as any)?.code]);

  const code = (diagram as any)?.code || "";
  const title = (diagram as any)?.step_title || (diagram as any)?.title || "";
  const explanation = (diagram as any)?.explanation || "";

  if (!code) {
    return (
      <div className="stage-transition flex h-full flex-col items-center justify-center text-[#4a5365] text-[11px] px-6 text-center">
        <div className="text-[28px] mb-3 opacity-40">:UITableView</div>
        主 agent 会对流程/结构/关系类知识点(生物分类、历史脉络、软件架构、状态机等)自动选用 mermaid 图展示。
        <div className="mt-1">数学/物理类仍用 manim 动画。</div>
      </div>
    );
  }

  return (
    <div className="stage-transition flex h-full flex-col">
      <div className="px-4 h-9 border-b border-[#1e293b] flex items-center shrink-0 gap-2">
        <span className="text-[10px] text-[#4a5365] uppercase tracking-wider">Diagram</span>
        <span className="text-[12px] text-[#9aa6b8] truncate">{title}</span>
        <span className="ml-auto text-[10px] text-[#4a5365]">{(diagram as any)?.diagram_type || "mermaid"}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto grid place-items-center p-4 bg-[#0b0f18]">
        {rendering ? (
          <div className="text-[11px] text-[#6b7686]">渲染图中…</div>
        ) : err ? (
          <div className="text-[11px] text-[#fca5a5] max-w-full whitespace-pre-wrap font-mono p-3 rounded border border-[#ef4444]/30 bg-[#ef4444]/8">
            渲染失败:{err}
          </div>
        ) : (
          svg && <div className="diagram-svg-wrap" style={{ maxWidth: "100%" }} dangerouslySetInnerHTML={{ __html: svg }} />
        )}
      </div>
      {explanation && (
        <div className="flex-0 border-t border-[#1e293b] px-4 py-2 max-h-[40%] overflow-y-auto bg-[#0d121c]/80">
          <div className="md-prose text-[11px]">
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{explanation}</ReactMarkdown>
          </div>
        </div>
      )}
      <details className="flex-0 border-t border-[#1e293b] px-4 py-1.5">
        <summary className="text-[10px] text-[#4a5365] cursor-pointer">mermaid 源码</summary>
        <pre className="text-[10px] text-[#6b7686] font-mono whitespace-pre-wrap mt-1">{code}</pre>
      </details>
    </div>
  );
}
