"""用户偏好(全局记忆):存 backend/user_prefs.json,主 agent 提示词读它。
前端 SettingsPanel 可编辑。用户身份偏好:如"喜欢类比讲解"、"数学背景强"等。
"""
from __future__ import annotations
import os
import json

_PREFS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "user_prefs.json")


def load_prefs() -> str:
    """读用户偏好文本(纯字符串,主 agent 提示词原样拼入)。无则空串。"""
    try:
        if os.path.exists(_PREFS_PATH):
            with open(_PREFS_PATH, encoding="utf-8") as f:
                return (json.load(f) or {}).get("prefs", "")
    except Exception:
        pass
    return ""


def save_prefs(text: str) -> None:
    """保存用户偏好文本。"""
    try:
        with open(_PREFS_PATH, "w", encoding="utf-8") as f:
            json.dump({"prefs": text or ""}, f, ensure_ascii=False, indent=2)
    except Exception:
        pass
