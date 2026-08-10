#!/usr/bin/env python3
"""会话切换特殊场景测试 v2:直接解析 SSE 为 dict,可靠判断事件种类。
用 MSYS_NO_PATHCONV=1 避免 Windows Git Bash 路径转换;PYTHONIOENCODING=utf-8 防乱码。
"""
import json, sys, time, urllib.request, uuid

BASE = "http://localhost:8000"

def parse_sse(raw: bytes):
    """解析一个 SSE 帧 → dict(或 None)。event/data 字段合并。"""
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
        obj = json.loads("\n".join(data))
    except Exception:
        return {"kind": event, "raw": "\n".join(data)[:200]}
    return obj

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
        if k == "tool_call":
            out.append(f"tool:{e['payload'].get('name')}")
        elif k == "error":
            out.append(f"ERROR:{e['payload'].get('message','')[:80]}")
        elif k == "done":
            out.append("done")
        elif k == "ask":
            out.append("ask")
        elif k == "topic_added":
            out.append("topic_added")
        elif k == "animation_request":
            out.append("animation_request")
        elif k == "graph_command_request":
            out.append("graph_command_request")
        elif k == "modify_request":
            out.append("modify_request")
        elif k == "quiz":
            out.append("quiz")
        elif k == "explain":
            out.append("explain")
        elif k == "render_request":
            out.append("render_request")
        elif k == "stage_switch":
            out.append(f"stage:{e['payload'].get('stage')}")
        elif k == "graph":
            out.append("graph")
        elif k == "message":
            out.append(f"msg:{e.get('text','')[:30]}")
        elif k == "agent_start":
            out.append("agent_start")
        else:
            out.append(k)
    return out

def has_error(evts):
    return any(e.get("kind") == "error" for e in evts)

def main():
    results = []
    def check(name, cond, detail=""):
        results.append((name, cond, detail))
        print(f"{'PASS' if cond else 'FAIL'} | {name} {detail}", flush=True)

    print("=" * 70, flush=True)
    print("场景 A:基础 ask 中断 + 回答", flush=True)
    print("=" * 70, flush=True)
    sidD = new_session()
    evts = post("/api/chat", {"sid": sidD, "text": "讲一下傅里叶变换", "depth": "understand"}, timeout=90)
    ks = kinds(evts)
    check("A1: chat 触发 ask 中断", "ask" in ks, f"kinds={ks}")
    check("A2: 无 error", not has_error(evts), f"kinds={ks}")
    evts = post("/api/chat_answer", {"sid": sidD, "answer": "直接拆学习清单,一步步来"}, timeout=120)
    ks = kinds(evts)
    check("A3: chat_answer resume 无 error", not has_error(evts), f"kinds={ks}")

    print("=" * 70, flush=True)
    print("场景 B:ask 中断后切新 session 聊天,再切回发新消息(忽略问题)", flush=True)
    print("=" * 70, flush=True)
    sidE = new_session()
    evts = post("/api/chat", {"sid": sidE, "text": "讲一下贝叶斯定理", "depth": "understand"}, timeout=90)
    ks = kinds(evts)
    check("B1: E 触发 ask 中断", "ask" in ks, f"kinds={ks}")
    sidF = new_session()
    evts = post("/api/chat", {"sid": sidF, "text": "什么是导数", "depth": "understand"}, timeout=90)
    ks = kinds(evts)
    check("B2: F 独立聊天无 error", not has_error(evts), f"kinds={ks}")
    evts = post("/api/chat", {"sid": sidE, "text": "算了直接拆", "depth": "understand"}, timeout=120)
    ks = kinds(evts)
    check("B3: 切回 E 发新消息跳过孤儿 ask", not has_error(evts), f"kinds={ks}")

    print("=" * 70, flush=True)
    print("SUMMARY", flush=True)
    print("=" * 70, flush=True)
    fails = [r for r in results if not r[1]]
    print(f"通过 {len(results)-len(fails)}/{len(results)},失败 {len(fails)}", flush=True)
    for name, cond, detail in fails:
        print(f"  FAIL: {name} {detail}", flush=True)

if __name__ == "__main__":
    main()
