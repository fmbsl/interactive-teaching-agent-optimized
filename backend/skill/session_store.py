"""会话执行树的持久化:每个 session 两个文件。

- <sid>.jsonl  追加日志,每事件一行(执行树原始记录,只增不改)
- <sid>.state.json  会话状态快照(覆盖写),重启后用它重建内存 session

目录:backend/sessions/。复用 llm_config_store 的原子写 + Lock 模式。
"""
from __future__ import annotations
import json
import os
import logging
import tempfile
from .run_control import writing
from typing import Optional

_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_SESSIONS_DIR = os.path.join(_BACKEND_DIR, "sessions")
logger = logging.getLogger(__name__)

# state.json 里只存可序列化的会话状态(从 agent._SESSIONS[sid] 取)
# 不存 graph 对象(MemorySaver 的暂停状态在 step_agent._SAVER 里,进程内,重启丢也无妨——
# 重启后该 step 会重新跑 agent,不续接旧 interrupt)


def _ensure_dir() -> None:
    os.makedirs(_SESSIONS_DIR, exist_ok=True)


def _state_path(sid: str) -> str:
    return os.path.join(_SESSIONS_DIR, f"{sid}.state.json")


def _jsonl_path(sid: str, sub_dir: str = "") -> str:
    if sub_dir:
        return os.path.join(_SESSIONS_DIR, sub_dir, f"{sid}.jsonl")
    return os.path.join(_SESSIONS_DIR, f"{sid}.jsonl")


def append_event(sid: str, event: dict, sub_dir: str = "") -> None:
    """追加一行事件到 <sid>.jsonl。event 应含 id/parentId/ts/kind 等。

    sub_dir 非空时写到子目录 sessions/<sub_dir>/<sid>.jsonl(如 decompose 特性隔离)。
    """
    try:
        _ensure_dir()
        if sub_dir:
            os.makedirs(os.path.join(_SESSIONS_DIR, sub_dir), exist_ok=True)
        with writing(sid):
            with open(_jsonl_path(sid, sub_dir), "a", encoding="utf-8") as f:
                f.write(json.dumps(event, ensure_ascii=False) + "\n")
    except Exception:
        logger.exception("Failed to append session event: %s", sid)
        raise


def save_state(sid: str, state: dict) -> None:
    """覆盖写 <sid>.state.json。state 是会话状态 dict(只存可序列化字段)。"""
    with writing(sid):
        _save_state_locked(sid, state)


def _save_state_locked(sid: str, state: dict) -> None:
    tmp = None
    try:
        _ensure_dir()
        # 只存可序列化字段,剔除内部运行态
        serializable = {
            "sid": sid,
            "question": state.get("question", ""),
            "file_text": state.get("file_text"),
            "lesson": state.get("lesson"),
            "current_step": state.get("current_step", 1),
            "finished": state.get("finished", False),
            "title": state.get("title", ""),
            "step_cache": state.get("step_cache", {}),
            "step_drafts": state.get("step_drafts", {}),
            "revision": state.get("revision", 0) + 1,
            # 新字段(主 agent 升级):多主题 list / 对话历史 / 文件 / 深度 / 步骤状态黑板
            "topics": state.get("topics", []),
            "conversation": state.get("conversation", []),
            "files": state.get("files", []),
            "depth": state.get("depth", "understand"),
            "step_status": state.get("step_status", {}),
            "graph": state.get("graph"),
        }
        current = load_state(sid)
        if current and current.get("revision", 0) > state.get("revision", 0):
            raise ValueError("Stale session revision")
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=_SESSIONS_DIR,
                                         prefix=f"{sid}.", suffix=".tmp", delete=False) as f:
            tmp = f.name
            json.dump(serializable, f, ensure_ascii=False, indent=1)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, _state_path(sid))
        state["revision"] = serializable["revision"]
    except Exception:
        logger.exception("Failed to save session state: %s", sid)
        raise
    finally:
        if tmp and os.path.exists(tmp):
            os.remove(tmp)


def load_state(sid: str) -> Optional[dict]:
    """读 <sid>.state.json;不存在返回 None。"""
    p = _state_path(sid)
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def load_all_states() -> dict:
    """扫 sessions/ 目录,返回 {sid: state_dict}。Django 启动时调,重建 _SESSIONS。"""
    if not os.path.isdir(_SESSIONS_DIR):
        return {}
    out = {}
    for fn in os.listdir(_SESSIONS_DIR):
        if not fn.endswith(".state.json"):
            continue
        sid = fn[: -len(".state.json")]
        st = load_state(sid)
        if st:
            out[sid] = st
    return out


def read_trace(sid: str, sub_dir: str = "") -> list:
    """读 <sid>.jsonl 全部事件,返回 list[dict]。供前端切回会话时重建执行树。

    sub_dir 非空时读子目录 sessions/<sub_dir>/<sid>.jsonl(如 decompose 特性隔离)。
    """
    p = _jsonl_path(sid, sub_dir)
    if not os.path.exists(p):
        return []
    out = []
    try:
        with open(p, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        pass
    return out


def delete_session_files(sid: str) -> None:
    """删除该会话的所有落盘文件:state.json、主 jsonl、decompose jsonl、上传目录、frames 目录。
    幂等;文件不存在也不报错。"""
    import shutil
    for p in (_state_path(sid), _jsonl_path(sid), _jsonl_path(sid, "decompose")):
        try:
            if os.path.exists(p):
                os.remove(p)
        except OSError:
            pass
    for d in (os.path.join(_SESSIONS_DIR, sid), os.path.join(_SESSIONS_DIR, f"{sid}_frames"),
              os.path.join(_SESSIONS_DIR, "decompose", sid),
              os.path.join(_BACKEND_DIR, "uploads", sid)):
        try:
            if os.path.isdir(d):
                shutil.rmtree(d, ignore_errors=True)
        except OSError:
            pass
