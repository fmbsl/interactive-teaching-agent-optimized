#!/usr/bin/env python3
"""step_agent render 孤儿测试:explain 暂停在 render_request 后重新 explain,再回传 render_result。
验证:旧 render_result 是否会污染新 run;会话/缓存是否一致。
"""
import json, time, urllib.request, threading

BASE = "http://localhost:8000"
SID = "462f4eef"
STEP = "8399597e-1"

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

def post(path, body, timeout=240):
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

def ksum(evts):
    ks = []
    for e in evts:
        k = e.get("kind")
        if k == "tool_call":
            ks.append(f"tool:{e['payload'].get('name')}")
        elif k == "error":
            ks.append(f"ERROR:{e['payload'].get('message','')[:60]}")
        else:
            ks.append(k)
    return ks

def main():
    # 1) 第一次 explain → 等 render_request
    print("第1次 explain 开始(step_agent 跑 LLM,可能较慢)…", flush=True)
    out1 = {}
    def run1():
        try:
            out1["evts"] = post("/api/explain", {"session_id": SID, "step_id": STEP}, timeout=220)
        except Exception as e:
            out1["evts"] = f"EXC:{e}"
    t = threading.Thread(target=run1)
    t.start()
    # 轮询等 render_request 出现(通过 trace 判断)
    reached = False
    for _ in range(60):
        time.sleep(3)
        try:
            tr = json.loads(urllib.request.urlopen(BASE + f"/api/sessions/{SID}/trace", timeout=15).read().decode())["events"]
            if any(e["kind"] == "render_request" for e in tr):
                reached = True
                break
        except Exception:
            pass
    t.join(timeout=230)
    ks = ksum(out1["evts"]) if isinstance(out1["evts"], list) else out1["evts"]
    print(f"  第1次 explain kinds={ks}", flush=True)
    if isinstance(ks, list):
        has_rr = "render_request" in ks
    else:
        has_rr = False
    print(f"  到达 render_request: {has_rr}", flush=True)

    if has_rr:
        # 2) 重新 explain(模拟切走再切回后再次点击)
        print("第2次 explain 开始(模拟切回重点)…", flush=True)
        try:
            out2 = post("/api/explain", {"session_id": SID, "step_id": STEP}, timeout=240)
            ks2 = ksum(out2)
            print(f"  第2次 explain kinds={ks2}", flush=True)
        except Exception as e:
            out2 = f"EXC:{e}"
            print(f"  第2次 explain 异常: {e}", flush=True)
        # 3) 回传一个 ok=false 的 render_result(模拟旧渲染失败结果)
        print("回传 render_result ok=false(旧渲染结果)…", flush=True)
        try:
            out3 = post("/api/render_result", {"session_id": SID, "step_id": STEP, "ok": False, "error": "测试渲染错误"}, timeout=180)
            ks3 = ksum(out3)
            print(f"  render_result kinds={ks3}", flush=True)
        except Exception as e:
            print(f"  render_result 异常: {e}", flush=True)
        # 检查缓存状态
        d = json.loads(urllib.request.urlopen(BASE + f"/api/sessions/{SID}", timeout=15).read().decode())
        for tp in d["topics"]:
            for s in tp["steps"]:
                if s["id"] == STEP:
                    print(f"  该步缓存 sceneCode_len={len(s.get('sceneCode',''))} title={s.get('title','')[:20]}", flush=True)

if __name__ == "__main__":
    main()
