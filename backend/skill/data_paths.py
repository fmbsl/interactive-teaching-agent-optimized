"""Resolve writable application data outside PyInstaller's _internal directory."""
from __future__ import annotations

import os


def backend_data_dir() -> str:
    configured = os.environ.get("MANIM_AGENT_DATA_DIR", "").strip()
    path = configured or os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    os.makedirs(path, exist_ok=True)
    return os.path.abspath(path)


def data_path(*parts: str) -> str:
    return os.path.join(backend_data_dir(), *parts)
