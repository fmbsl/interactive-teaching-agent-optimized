#!/usr/bin/env python3
"""聚焦复现:Bug1(多工具孤儿掩盖) + chat_stop 暂停。输出明确结果。"""
import json, time, urllib.request

BASE = "http://localhost:8000"

def parse_sse(raw: bytes):
    text = raw.decode("utf-8", errors="replace")
    event, data = "", []
    for line in text.split("\n"):
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].strip())
    if not event or not data:
        return None
    try:
        return json.loads("\n".join(data))
    except Exception:
        return {"kind": event, "raw": "\n".join(data)[:200]}

def post(path, body, timeout=180):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 method="POST", headers={"Content-Type": "application/json"})
    evts = []
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        buf = b""
        while True:
            chunk = resp.read(4096)
            if not chunk:
                break
            buf += chunk
            while b"\n\n" in buf:
                raw, buf = buf.split(b"\n\n", 1)
                ev = parse_sse(raw)
                if ev:
                    evts.append(ev)
        if buf.strip():
            ev = parse_sse(buf)
            if ev:
                evts.append(ev)
    return evts

def new_session():
    req = urllib.request.Request(BASE + "/api/sessions", data=b"{}", method="POST",
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read().decode())["session_id"]

def kinds(evts, skip=("message_delta",)):
    out = []
    for e in evts:
        k = e.get("kind")
        if k in skip:
            continue
        out.append(k)
    return out

def main():
    results = []
    def check(name, cond, detail=""):
        results.append((name, cond, detail))
        print(f"{'PASS' if cond else 'FAIL'} | {name} {detail}", flush=True)

    print("=" * 70, flush=True)
    print("复现 Bug1:generate_animation 中断(与 switch_stage 同批)后发新消息", flush=True)
    print("=" * 70, flush=True)
    sid = new_session()
    evts = post("/api/chat", {"sid": sid, "text": "讲一下勾股定理", "depth": "understand"}, timeout=90)
    ks = kinds(evts)
    print(f"  第1轮: {ks}", flush=True)
    # 回答 ask,期望 agent 直接 switch_stage+generate_animation
    evts = post("/api/chat_answer", {"sid": sid, "answer": "直接拆学习清单,一步步来"}, timeout=120)
    ks = kinds(evts)
    print(f"  第2轮(回答): {ks}", flush=True)
    has_anim = "animation_request" in ks
    check("R1: 触发 generate_animation 中断", has_anim, f"kinds={ks}")
    if not has_anim:
        print("  未能构造动画中断态,跳过后续", flush=True)
    else:
        # 此刻会话有孤儿 generate_animation 中断(可能被 switch_stage 掩盖)。发新消息。
        evts = post("/api/chat", {"sid": sid, "text": "继续", "depth": "understand"}, timeout=120)
        ks = kinds(evts)
        errs = [e for e in evts if e.get("kind") == "error"]
        errmsg = errs[0]["payload"].get("message", "")[:120] if errs else ""
        check("R2: 孤儿中断被正确跳过(新消息不崩)", not errs, f"kinds={ks} err={errmsg}")
        # 再确认会话是否彻底卡死
        evts = post("/api/chat", {"sid": sid, "text": "你好", "depth": "understand"}, timeout=120)
        errs = [e for e in evts if e.get("kind") == "error"]
        check("R3: 会话仍可对话(未永久卡死)", not errs, f"err={errs[0]['payload'].get('message','')[:80] if errs else ''}")

    print("=" * 70, flush=True)
    print("chat_stop 暂停:", flush=True)
    print("=" * 70, flush=True)
    sid2 = new_session()
    # 后台起一个会中断的 chat(ask),然后立刻 stop
    import threading
    out = {}
    def runner():
        try:
            out["evts"] = post("/api/chat", {"sid": sid2, "text": "讲一下矩阵乘法", "depth": "understand"}, timeout=90)
        except Exception as e:
            out["evts"] = f"EXC:{e}"
    t = threading.Thread(target=runner)
    t.start()
    time.sleep(1.5)
    # stop
    try:
        resp = urllib.request.urlopen(urllib.request.Request(
            BASE + "/api/chat_stop", data=json.dumps({"sid": sid2}).encode(),
            method="POST", headers={"Content-Type": "application/json"}), timeout=30)
        print(f"  chat_stop 返回 {resp.status}", flush=True)
        check("S1: chat_stop 正常返回", resp.status == 200)
    except Exception as e:
        check("S1: chat_stop 正常返回", False, f"EXC:{e}")
    t.join(timeout=95)
    # 之后会话还能对话吗?
    evts = post("/api/chat", {"sid": sid2, "text": "你好", "depth": "understand"}, timeout=90)
    ks = kinds(evts)
    errs = [e for e in evts if e.get("kind") == "error"]
    check("S2: stop 后会话仍可对话", not errs, f"kinds={ks} err={errs[0]['payload'].get('message','')[:80] if errs else ''}")

    print("=" * 70, flush=True)
    print("SUMMARY", flush=True)
    print("=" * 70, flush=True)
    fails = [r for r in results if not r[1]]
    print(f"通过 {len(results)-len(fails)}/{len(results)},失败 {len(fails)}", flush=True)
    for name, cond, detail in fails:
        print(f"  FAIL: {name} {detail}", flush=True)

if __name__ == "__main__":
    main()
