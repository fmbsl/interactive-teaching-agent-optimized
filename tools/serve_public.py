"""公网统一入口:同时服务 前端 dist 静态文件 + 把 /api 流式反向代理到本地后端 8000。

用途:配合 Cloudflare Tunnel(cloudflared quick tunnel)把整个教学应用暴露成单个公网 URL。
评审访问 tunnel 给的 https://xxx.trycloudflare.com →
    - /              → dist/index.html(SPA)
    - /assets/...    → dist 静态资源
    - /api/...       → 流式转发到 http://127.0.0.1:8000(保留 Authorization/body,SSE 不断流)

因为前端和 /api 同源(tunnel 域名),无跨域、前端 JS 用相对 /api 即可。

用法:
    python tools/serve_public.py            # 默认监听 0.0.0.0:9000
    PUBLIC_PORT=9100 python tools/serve_public.py
    # 然后: cloudflared tunnel --url http://localhost:9000
"""
from __future__ import annotations
import os
import sys
import urllib.parse
import urllib.request
import mimetypes
import http.server
import socketserver
import threading

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

STATIC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dist"))
BACKEND = os.environ.get("PUBLIC_BACKEND", "http://127.0.0.1:8000")
PORT = int(os.environ.get("PUBLIC_PORT", "9000"))
HOST = os.environ.get("PUBLIC_HOST", "0.0.0.0")


class PublicHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "manim-public/1.0"

    # ---- 路由 ----
    def do_GET(self):
        self._route()

    def do_POST(self):
        self._route()

    def do_DELETE(self):
        self._route()

    def do_PUT(self):
        self._route()

    def do_OPTIONS(self):
        self._route()

    def log_message(self, fmt, *args):  # 精简日志
        try:
            sys.stderr.write("[serve_public] %s %s\n" % (self.command, self.path))
        except Exception:
            pass

    def _route(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == "/api" or path.startswith("/api/"):
            return self._proxy()
        return self._serve_static()

    # ---- 静态文件(SPA 回退到 index.html) ----
    def _serve_static(self):
        path = urllib.parse.urlsplit(self.path).path
        if path in ("", "/"):
            path = "/index.html"
        fs = os.path.join(STATIC_DIR, path.lstrip("/"))
        if not os.path.isfile(fs):
            # SPA:非 api 且找不到文件 → index.html
            fs = os.path.join(STATIC_DIR, "index.html")
        if not os.path.isfile(fs):
            self.send_error(404, "前端未构建:请先 `npm run build` 或检查 dist/")
            return
        ctype = mimetypes.guess_type(fs)[0] or "application/octet-stream"
        if fs.endswith(".js"):
            ctype = "text/javascript"
        with open(fs, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text/") else ""))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ---- 反向代理到后端(流式,支持 SSE) ----
    def _proxy(self):
        up = urllib.parse.urlsplit(self.path)
        target = BACKEND + up.path + (("?" + up.query) if up.query else "")
        body = None
        if self.command in ("POST", "PUT", "PATCH", "DELETE"):
            ln = self.headers.get("Content-Length")
            if ln:
                try:
                    body = self.rfile.read(int(ln))
                except Exception:
                    body = None
        headers = {}
        for k in ("Authorization", "Content-Type", "Accept", "Origin", "Cookie"):
            v = self.headers.get(k)
            if v:
                headers[k] = v
        req = urllib.request.Request(target, data=body, method=self.command, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=None) as r:
                self.send_response(r.status)
                ct = r.headers.get("Content-Type", "application/json")
                self.send_header("Content-Type", ct)
                cc = r.headers.get("Cache-Control")
                if cc:
                    self.send_header("Cache-Control", cc)
                self.send_header("Connection", "close")
                self.end_headers()
                # 流式转发(SSE 长连接)
                while True:
                    try:
                        chunk = r.read(8192)
                    except Exception:
                        break
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError, OSError):
                        break
        except urllib.error.HTTPError as e:
            # 后端 4xx/5xx:转发状态+错误体
            try:
                err_body = e.read()
            except Exception:
                err_body = b""
            try:
                self.send_response(e.code)
                self.send_header("Content-Type", e.headers.get("Content-Type", "application/json")
                                 if e.headers else "application/json")
                self.send_header("Content-Length", str(len(err_body)))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception:
                pass
        except Exception:
            try:
                self.send_error(502, "无法连接后端(请确认 8000 已启动)")
            except Exception:
                pass


def main():
    os.makedirs(STATIC_DIR, exist_ok=True)
    if not os.path.isfile(os.path.join(STATIC_DIR, "index.html")):
        print("[serve_public] 警告: %s 下没有 index.html,请先 `npm run build`" % STATIC_DIR)
    httpd = http.server.ThreadingHTTPServer((HOST, PORT), PublicHandler)
    httpd.daemon_threads = True
    print("[serve_public] 统一入口 http://%s:%d  dist=%s  后端=%s" % (HOST, PORT, STATIC_DIR, BACKEND))
    print("[serve_public] 让 cloudflared 隧道指向本端口,例如: cloudflared tunnel --url http://localhost:%d" % PORT)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()