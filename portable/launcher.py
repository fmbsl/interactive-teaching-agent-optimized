"""Windows portable launcher for Manim Agent."""
from __future__ import annotations

import mimetypes
import os
from pathlib import Path
import socket
import shutil
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser

APP_HOST = "127.0.0.1"
PREFERRED_PORT = 8765


def bundle_root() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1])).resolve()


def writable_data_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "data"
    return bundle_root() / "backend"


def prepare_data_dir(bundle: Path) -> Path:
    """Keep user data beside the EXE and migrate legacy _internal/backend data once."""
    data = writable_data_root()
    data.mkdir(parents=True, exist_ok=True)
    legacy = bundle / "backend"
    for name in ("sessions", "uploads"):
        source, target = legacy / name, data / name
        if source.is_dir() and not target.exists():
            shutil.copytree(source, target)
        target.mkdir(parents=True, exist_ok=True)
    for name in ("llm_endpoints.json", "app_settings.json", "user_prefs.json", "db.sqlite3", ".env"):
        source, target = legacy / name, data / name
        if source.is_file() and not target.exists():
            shutil.copy2(source, target)
    return data


def app_url(port: int) -> str:
    return f"http://{APP_HOST}:{port}/?token=local-preview"


def is_running(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://{APP_HOST}:{port}/api/health", timeout=0.7) as response:
            return response.status == 200 and b"manim-teaching-agent" in response.read(4096)
    except Exception:
        return False


def choose_port() -> int:
    if is_running(PREFERRED_PORT):
        return PREFERRED_PORT
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((APP_HOST, PREFERRED_PORT))
            return PREFERRED_PORT
        except OSError:
            sock.bind((APP_HOST, 0))
            return int(sock.getsockname()[1])


class StaticFrontend:
    """Serve Vite output before forwarding /api requests to Django."""

    def __init__(self, django_app, static_root: Path):
        self.django_app = django_app
        self.static_root = static_root.resolve()

    def __call__(self, environ, start_response):
        path = (environ.get("PATH_INFO") or "/").replace("\\", "/")
        if path == "/api" or path.startswith("/api/"):
            return self.django_app(environ, start_response)
        if environ.get("REQUEST_METHOD", "GET").upper() not in {"GET", "HEAD"}:
            return self.django_app(environ, start_response)

        relative = path.lstrip("/") or "index.html"
        candidate = (self.static_root / relative).resolve()
        try:
            candidate.relative_to(self.static_root)
        except ValueError:
            candidate = self.static_root / "index.html"
        if not candidate.is_file():
            if "." not in Path(relative).name:
                candidate = self.static_root / "index.html"
            else:
                body = b"Not found"
                start_response("404 Not Found", [("Content-Type", "text/plain; charset=utf-8"), ("Content-Length", str(len(body)))])
                return [body]

        body = candidate.read_bytes()
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if candidate.suffix == ".js":
            content_type = "text/javascript; charset=utf-8"
        elif candidate.suffix in {".html", ".css", ".svg"}:
            content_type += "; charset=utf-8"
        headers = [
            ("Content-Type", content_type),
            ("Content-Length", str(len(body))),
            ("Cache-Control", "no-cache" if candidate.suffix == ".html" else "public, max-age=31536000, immutable"),
        ]
        start_response("200 OK", headers)
        return [] if environ.get("REQUEST_METHOD") == "HEAD" else [body]


def open_when_ready(port: int) -> None:
    for _ in range(100):
        if is_running(port):
            webbrowser.open(app_url(port), new=1)
            return
        time.sleep(0.1)


def run() -> None:
    root = bundle_root()
    data_dir = prepare_data_dir(root)
    backend_dir = root / "backend"
    static_dir = root / "dist"
    if not static_dir.joinpath("index.html").is_file():
        raise RuntimeError(f"缺少前端文件：{static_dir / 'index.html'}")

    os.environ["MANIM_AGENT_DATA_DIR"] = str(data_dir)
    os.chdir(data_dir)
    sys.path.insert(0, str(backend_dir))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
    (data_dir / "sessions").mkdir(parents=True, exist_ok=True)
    (data_dir / "uploads").mkdir(parents=True, exist_ok=True)

    port = choose_port()
    if is_running(port):
        webbrowser.open(app_url(port), new=1)
        return

    from backend.wsgi import application
    from waitress import create_server

    print("=" * 58)
    print(" Manim Agent 已启动")
    print(f" 地址：{app_url(port)}")
    print(f" 数据：{data_dir}")
    print(" 保持本窗口开启；关闭窗口即可停止程序。")
    print("=" * 58)
    threading.Thread(target=open_when_ready, args=(port,), daemon=True).start()
    create_server(StaticFrontend(application, static_dir), host=APP_HOST, port=port, threads=8).run()


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        pass
    except Exception:
        message = traceback.format_exc()
        try:
            (writable_data_root() / "ManimAgent-error.log").write_text(message, encoding="utf-8")
        except Exception:
            pass
        print("启动失败，详细信息已写入 ManimAgent-error.log：\n")
        print(message)
        try:
            input("按回车键退出……")
        except EOFError:
            pass
