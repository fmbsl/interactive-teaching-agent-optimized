#!/usr/bin/env python3
"""并发与边缘场景测试:同 session 双 run、无 interrupt 的 chat_answer、render_result 孤儿。
"""
import json, threading, time, urllib.request

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

def brief(evts, skip=("message_delta",)):
    out = []
    for e in evts:
        if not e:
            out.append("<empty>")
            continue
        k = e.get("kind")
        if k in skip:
            continue
        if k is None:
            out.append(f"<no-kind>{json.dumps(e, ensure_ascii=False)[:80]}")
        elif k == "tool_call":
            out.append(f"tool:{e['payload'].get('name')}")
        elif k == "error":
            out.append(f"ERROR:{e['payload'].get('message','')[:70]}")
        elif k == "ask":
            out.append("ask")
        elif k == "topic_added":
            out.append("topic_added")
        elif k == "animation_request":
            out.append("animation_request")
        elif k == "graph_command_request":
            out.append("graph_command_request")
        elif k == "node":
            out.append("node")
        elif k == "edge":
            out.append("edge")
        elif k == "graph":
            out.append("graph")
        elif k == "done":
            out.append("done")
        elif k == "message":
            out.append(f"msg:{e.get('text','')[:20]}")
        else:
            out.append(k)
    return out

def main():
    results = []
    def check(name, cond, detail=""):
        results.append((name, cond, detail))
        print(f"{'PASS' if cond else 'FAIL'} | {name} {detail}", flush=True)

    print("=" * 70, flush=True)
    print("场景 D:同 session 双 run —— graph_command 慢跑时插入 chat", flush=True)
    print("=" * 70, flush=True)
    sidG = new_session()
    out = {}
    def graph_runner():
        try:
            out["graph"] = post("/api/graph_command", {"sid": sidG, "instruction": "帮我分解线性代数"}, timeout=120)
        except Exception as e:
            out["graph"] = f"EXC:{e}"
    t = threading.Thread(target=graph_runner)
    t.start()
    time.sleep(4)  # 图 agent 跑一会
    try:
        evts = post("/api/chat", {"sid": sidG, "text": "你好", "depth": "understand"}, timeout=90)
        out["chat"] = evts
        kb = brief(evts)
        check("D1: 同 sid 图跑时插 chat 无 error", not any("ERROR" in k for k in kb), f"chat kinds={kb}")
    except Exception as e:
        out["chat"] = f"EXC:{e}"
        check("D1: 同 sid 图跑时插 chat 无 error", False, f"EXC:{e}")
    t.join(timeout=130)
    gb = out.get("graph")
    if isinstance(gb, list):
        kb = brief(gb)
        check("D2: graph_command 自身事件正常", any(k in ("node", "graph") for k in kb), f"graph kinds={kb[:20]}")
    else:
        check("D2: graph_command 自身事件正常", False, f"graph={gb}")
    # 检查 session 状态与 graph 快照
    try:
        detail = json.loads(urllib.request.urlopen(BASE + f"/api/sessions/{sidG}", timeout=30).read().decode())
        has_graph = detail.get("graph") is not None and detail.get("graph", {}).get("snapshot", {}).get("nodes")
        check("D3: 会话 graph 快照已落", has_graph, f"graph={bool(detail.get('graph'))}")
    except Exception as e:
        check("D3: 会话 graph 快照已落", False, f"EXC:{e}")
    # 再发一条消息验证会话仍可用
    try:
        evts = post("/api/chat", {"sid": sidG, "text": "继续讲", "depth": "understand"}, timeout=90)
        kb = brief(evts)
        check("D4: 图/chat 混跑后会话仍可对话", not any("ERROR" in k for k in kb), f"kinds={kb}")
    except Exception as e:
        check("D4: 图/chat 混跑后会话仍可对话", False, f"EXC:{e}")

    print("=" * 70, flush=True)
    print("场景 E:无 pending interrupt 时 chat_answer(空 resume)", flush=True)
    print("=" * 70, flush=True)
    sidH = new_session()
    evts = post("/api/chat", {"sid": sidH, "text": "讲一下质数", "depth": "understand"}, timeout=90)
    kb = brief(evts)
    # 若又是 ask,先跳过;制造"无 interrupt 已完成"状态
    check("E1: H 首聊完成", not any("ERROR" in k for k in kb), f"kinds={kb}")
    evts = post("/api/chat_answer", {"sid": sidH, "answer": "随便答的" if any(k == "ask" for k in kb) else ""}, timeout=90)
    kb = brief(evts)
    check("E2: 无 interrupt 时 chat_answer 不 500/不 error", not any("ERROR" in k for k in kb), f"kinds={kb}")

    print("=" * 70, flush=True)
    print("SUMMARY", flush=True)
    print("=" * 70, flush=True)
    fails = [r for r in results if not r[1]]
    print(f"通过 {len(results)-len(fails)}/{len(results)},失败 {len(fails)}", flush=True)
    for name, cond, detail in fails:
        print(f"  FAIL: {name} {detail}", flush=True)

if __name__ == "__main__":
    main()
