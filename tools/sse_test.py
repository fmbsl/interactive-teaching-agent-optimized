#!/usr/bin/env python3
"""SSE 测试辅助:POST JSON 到 /api/*,逐个解析 SSE 事件并打印 kind。
用法: python tools/sse_test.py <method> <path> '<json>' [timeout]
"""
import json, sys, time, urllib.request

def main():
    method = sys.argv[1] if len(sys.argv) > 1 else "POST"
    path = sys.argv[2] if len(sys.argv) > 2 else "/api/health"
    body = sys.argv[3] if len(sys.argv) > 3 else "{}"
    timeout = float(sys.argv[4]) if len(sys.argv) > 4 else 120
    url = path if path.startswith("http") else f"http://localhost:8000{path}"
    data = body.encode()
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            buf = b""
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                buf += chunk
                while b"\n\n" in buf:
                    raw, buf = buf.split(b"\n\n", 1)
                    ev = parse(raw)
                    dt = round(time.time() - t0, 2)
                    print(f"[{dt:6.2f}s] {ev}", flush=True)
            # 残留
            if buf.strip():
                print(f"[{round(time.time()-t0,2):6.2f}s] {parse(buf)}", flush=True)
    except Exception as e:
        print(f"[{round(time.time()-t0,2):6.2f}s] CONN-ERR {type(e).__name__}: {e}", flush=True)

def parse(raw: bytes):
    text = raw.decode("utf-8", errors="replace")
    event = ""
    data_lines = []
    for line in text.split("\n"):
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data_lines.append(line[5:].strip())
    data = "\n".join(data_lines)
    # 精简输出
    try:
        obj = json.loads(data)
    except Exception:
        return f"event={event} data={data[:200]}"
    if event in ("session", "done", "error"):
        return f"<{event}> {data[:300]}"
    if event == "message_delta":
        return f"<message_delta> +{len(obj.get('text',''))}ch text='{obj.get('text','')[:40]}'"
    if event == "message":
        return f"<message> {obj.get('text','')[:80]}"
    if event == "agent_start":
        return f"<agent_start> {obj.get('payload',{}).get('title','')}"
    if event == "tool_call":
        p = obj.get("payload", {})
        args = json.dumps(p.get("args", {}), ensure_ascii=False)[:150]
        return f"<tool_call> {p.get('name')} args={args}"
    if event == "tool_result":
        p = obj.get("payload", {})
        return f"<tool_result> {p.get('output','')[:150]}"
    if event == "ask":
        p = obj.get("payload", {})
        return f"<ask> {p.get('question','')[:80]} opts={p.get('options')}"
    if event == "animation_request":
        p = obj.get("payload", {})
        return f"<animation_request> step_id={p.get('step_id')}"
    if event == "graph_command_request":
        return f"<graph_command_request>"
    if event == "modify_request":
        return f"<modify_request>"
    if event == "quiz":
        return f"<quiz>"
    if event == "render_request":
        p = obj.get("payload", {})
        return f"<render_request> code_len={len(p.get('code',''))}"
    if event == "render_result":
        p = obj.get("payload", {})
        return f"<render_result> ok={p.get('ok')} err={str(p.get('error',''))[:60]}"
    if event == "explain":
        p = obj.get("payload", {})
        return f"<explain> stepId={p.get('stepId')} title={p.get('title','')[:30]} code_len={len(p.get('sceneCode',''))}"
    if event == "topic_added":
        p = obj.get("payload", {})
        return f"<topic_added> {p.get('title','')[:40]} steps={[s['id'] for s in p.get('steps',[])]}"
    if event == "stage_switch":
        p = obj.get("payload", {})
        return f"<stage_switch> {p.get('stage')}"
    if event == "graph":
        return f"<graph> payload_keys={list(obj.get('payload',{}).keys())[:5]}"
    # 通用
    s = json.dumps(obj, ensure_ascii=False)
    return f"<{event}> {s[:200]}"

if __name__ == "__main__":
    main()
