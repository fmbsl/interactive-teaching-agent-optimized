"""应用级设置(运行时存储 + 持久化):存 backend/app_settings.json。

目前含:
- decompose_effort:知识分解的"努力程度"(low/mid/high),它是统一的力度档位,
  一键同时控制 decompose_agent 的三个预算(最大深度/最大节点数/单次展开上限),
  避免把三个数字拆给用户分别填。

仿 llm_config_store.py 模式:thread 锁 + 原子写 os.replace,改完立即生效。
"""
from __future__ import annotations
import json
import os
import threading
from .data_paths import backend_data_dir

_BACKEND_DIR = backend_data_dir()
_SETTINGS_PATH = os.path.join(_BACKEND_DIR, "app_settings.json")

_lock = threading.Lock()

# 档位 -> 预算:深度 / 节点数 / 单次分解的 expand_node 展开上限(限时)
EFFORT_PRESETS: dict[str, dict] = {
    "low":  {"max_depth": 2, "max_nodes": 40,  "max_expand": 4},
    "mid":  {"max_depth": 3, "max_nodes": 80,  "max_expand": 8},   # 默认/现状
    "high": {"max_depth": 4, "max_nodes": 140, "max_expand": 14},
}

DEFAULT = {"decompose_effort": "mid"}


def load() -> dict:
    """读 app_settings.json;不存在或损坏回 DEFAULT。"""
    if not os.path.exists(_SETTINGS_PATH):
        return dict(DEFAULT)
    try:
        with open(_SETTINGS_PATH, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return dict(DEFAULT)
        # 合并缺省,保证字段齐全
        out = dict(DEFAULT)
        out.update({k: v for k, v in data.items() if k in DEFAULT})
        return out
    except (json.JSONDecodeError, OSError):
        return dict(DEFAULT)


def save(data: dict) -> None:
    """保存设置(原子写)。只写 DEFAULT 认识的字段。"""
    cur = load()
    for k in DEFAULT:
        if k in data:
            cur[k] = data[k]
    tmp = _SETTINGS_PATH + ".tmp"
    with _lock:
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(cur, f, ensure_ascii=False, indent=2)
            os.replace(tmp, _SETTINGS_PATH)
        except OSError:
            try:
                if os.path.exists(tmp):
                    os.remove(tmp)
            except OSError:
                pass


def get_decompose_effort() -> str:
    """当前分解力度档位(low/mid/high)。非法值回 mid。"""
    e = load().get("decompose_effort", "mid")
    return e if e in EFFORT_PRESETS else "mid"


def set_decompose_effort(level: str) -> str:
    """设置分解力度档位,返回规范化后的档位。非法值忽略帧回当前。"""
    level = (level or "").strip().lower()
    if level not in EFFORT_PRESETS:
        return get_decompose_effort()
    save({"decompose_effort": level})
    return level


def get_decompose_budget() -> dict:
    """由当前档位算出 {max_depth, max_nodes, max_expand}。非法/未知回 mid。"""
    return dict(EFFORT_PRESETS.get(get_decompose_effort(), EFFORT_PRESETS["mid"]))
