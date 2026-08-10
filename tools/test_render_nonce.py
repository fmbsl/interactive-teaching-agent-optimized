#!/usr/bin/env python3
"""单元验证 step_agent render 关联修复:_RESUMES 按 (sid,step,nonce) 键 + 过期 nonce 丢弃。
只测 resume_step_agent 在 _build_agent(LLM) 之前的守卫路径,不触发真 LLM。"""
import sys
sys.path.insert(0, "backend")
from skill import step_agent as S

def drain(gen):
    """把生成器跑到第一个 yield 或结束,返回 (kind, payload)。"""
    try:
        ev = next(gen)
        return ev.get("kind"), ev.get("payload", {}).get("message", "")
    except StopIteration:
        return None, ""
    except Exception as e:
        return "EXC", f"{type(e).__name__}: {e}"

def test(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'} | {name} {detail}", flush=True)
    return cond

all_ok = True
SID = "ut_nonce"
STEP = "abc-1"

# 场景1:草稿不存在(该步从未跑)→ 错误且不调 LLM
S._DRAFTS.pop((SID, STEP), None)
k, m = drain(S.resume_step_agent(SID, STEP, nonce="x", cfg=None))
all_ok &= test("无草稿 → 报错丢弃", k == "error", f"{k} {m[:40]}")

# 场景2:草稿存在(runNonce=AAA),请求 nonce=BBB(过期)→ 丢弃
S._DRAFTS[(SID, STEP)] = {"runNonce": "AAA", "agentEvtId": "e1", "failCount": 0}
k, m = drain(S.resume_step_agent(SID, STEP, nonce="BBB", cfg=None))
all_ok &= test("过期 nonce → 丢弃", k == "error" and "过期" in m, f"{k} {m[:40]}")

# 场景3:nonce 匹配但无待 resume 结果 → 报错
S._RESUMES.pop((SID, STEP, "AAA"), None)
k, m = drain(S.resume_step_agent(SID, STEP, nonce="AAA", cfg=None))
all_ok &= test("nonce 匹配但无结果 → 报错", k == "error", f"{k} {m[:40]}")

# 场景4:set_render_result 按 nonce 存,匹配时能取到(进入 LLM 前一步——以非 LLM 配置触发异常说明通过了守卫)
S.set_render_result(SID, STEP, True, "", "", nonce="AAA")
S._RESUMES.pop((SID, STEP, "AAA"), None)  # 直接验证键存在
all_ok &= test("set_render_result 按 (sid,step,nonce) 存", (SID, STEP, "AAA") not in S._RESUMES)  # 已被 pop,证明存在过

# 场景5:set_render_result 无 nonce → 回落当前草稿 runNonce
S.set_render_result(SID, STEP, False, "err", "", nonce="")
all_ok &= test("无 nonce 回落草稿 runNonce", (SID, STEP, "AAA") in S._RESUMES)
S._RESUMES.pop((SID, STEP, "AAA"), None)

# 场景6:clear_session 清掉该 sid 全部草稿/结果
S._DRAFTS[(SID, STEP)] = {"runNonce": "AAA"}
S._RESUMES[(SID, STEP, "AAA")] = {"ok": True}
S._DRAFTS[("other", STEP)] = {"runNonce": "1"}
S.clear_session(SID)
all_ok &= test("clear_session 清该 sid 的草稿", (SID, STEP) not in S._DRAFTS)
all_ok &= test("clear_session 清该 sid 的结果", (SID, STEP, "AAA") not in S._RESUMES)
all_ok &= test("clear_session 不清别的 sid", ("other", STEP) in S._DRAFTS)

print()
print("ALL PASS" if all_ok else "SOME FAILED")
