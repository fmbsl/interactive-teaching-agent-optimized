"""统一调试日志:写到 backend/debug.log,带时间戳。

用法:from skill.debug_log import dlog
    dlog("step 3 sceneCode_len=1234")

设计:
- 单文件追加,不轮转(竞赛 demo,体量小)。
- 每行一条,带 ISO 时间戳 + 调用点标记。
- 长内容(如 sceneCode)由调用方截断后传入,本函数只负责落盘。
"""
from __future__ import annotations
import os
from datetime import datetime

_LOG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "debug.log",
)


def dlog(msg: str) -> None:
    """写一条日志到 backend/debug.log。任何异常都吞掉,绝不影响主流程。"""
    try:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"[{ts}] {msg}\n")
    except Exception:
        pass


def log_path() -> str:
    """返回日志文件绝对路径,供外部读取。"""
    return _LOG_PATH
