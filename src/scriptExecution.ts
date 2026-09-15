import type { VerificationStatus } from "./verificationTypes";

export type ExecutionOutcome =
  | { ok: true; status: "passed"; timedOut?: false }
  | { ok: false; status: Exclude<VerificationStatus, "passed">; error: string; timedOut?: boolean };

/** Cooperative deadline, not a sandbox: cannot preempt a synchronous infinite loop. */
export async function executeWithDeadline(run: () => Promise<unknown>, timeoutMs: number, signal?: AbortSignal): Promise<ExecutionOutcome> {
  if (signal?.aborted) return { ok: false, status: "cancelled", error: "验证已取消" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stopped = new Promise<ExecutionOutcome>(resolve => {
    if (Number.isFinite(timeoutMs)) timer = setTimeout(() => resolve({ ok: false, status: "incomplete", timedOut: true, error: "验证超时，后续代码尚未完成检查" }), timeoutMs);
    onAbort = () => resolve({ ok: false, status: "cancelled", error: "验证已取消" });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const work = Promise.resolve().then(run).then<ExecutionOutcome, ExecutionOutcome>(
      () => ({ ok: true, status: "passed" }),
      error => ({ ok: false, status: error?.verificationStatus === "incomplete" ? "incomplete" : error?.verificationStatus === "cancelled" ? "cancelled" : "failed", error: String(error?.message || error) }),
    );
    return await Promise.race([work, stopped]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
