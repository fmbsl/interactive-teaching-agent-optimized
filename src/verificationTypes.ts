export type VerificationStatus = "passed" | "failed" | "incomplete" | "cancelled";
export interface VerificationReport {
  schemaVersion: 1;
  status: VerificationStatus;
  ok: boolean;
  error: string;
  codeVersion: string;
  checks: string[];
  missing: string[];
  frame: string;
  sampling?: { mode: string; intervalMs: number; samples: number; maxGapMs: number };
  layoutIssues?: {key:string;type:string;objects:string[];bounds:{left:number;right:number;top:number;bottom:number}[];message:string;scene:number;start:number;end:number}[];
  overlapDeclarations?: {objects:string[];start:number;end:number;reason:string}[];
}
export function verificationCheckLabel(check: string): string {
  const labels: Record<string, string> = {
    execution: "脚本执行", "scene-access": "场景读取", measurements: "对象尺寸",
    mathtex: "公式渲染", nan: "无效数值", "layout-final": "末帧重叠", "bounds-final": "末帧越界",
    "optional-visual-frame": "可选画面辅助检查", verification: "验证流程", "layout-temporal": "动画过程采样",
  };
  return labels[check] || check;
}
export function verificationReport(status: VerificationStatus, error = "", codeVersion = "", checks: string[] = [], missing: string[] = []): VerificationReport {
  return { schemaVersion: 1, status, ok: status === "passed", error, codeVersion, checks, missing, frame: "" };
}
export async function codeVersionOf(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

/** Each request has an identity even when multiple validations share a chat run. */
export class VerificationMailbox {
  private counter = 0;
  private pending: { nonce: number; resolve: (report: VerificationReport) => void } | null = null;
  begin() {
    this.cancel();
    const nonce = ++this.counter;
    const promise = new Promise<VerificationReport>(resolve => { this.pending = { nonce, resolve }; });
    return { nonce, promise };
  }
  complete(nonce: number, report: VerificationReport) {
    if (this.pending?.nonce !== nonce) return false;
    const pending = this.pending;
    this.pending = null;
    pending.resolve(report);
    return true;
  }
  cancel() {
    const pending = this.pending;
    this.pending = null;
    pending?.resolve(verificationReport("cancelled", "验证已取消"));
  }
}
