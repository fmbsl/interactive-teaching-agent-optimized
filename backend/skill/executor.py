"""后台执行器:把 agent 生成与 SSE 连接解耦。

问题:原 views.py 用 StreamingHttpResponse(gen()) 直接把 agent 生成器接到 SSE 上,
客户端断连 → Django 关闭响应 → 生成器在 yield 处收到 GeneratorExit → agent 工作中止,
interrupt 状态残留在 MemorySaver,后续 rerun 可能撞 "Found AIMessages with tool_calls
that do not have a corresponding ToolMessage"。

解法:agent 生成器在后台线程跑,事件写进每个 session 的内存缓冲(+ 落盘 jsonl)。
SSE 视图只是缓冲的读者:客户端断连只停 SSE 读,不停后台线程,工作跑完整段(到 explain
或到 render_request)就停,结果已落盘 step_cache / jsonl。客户端重连可从 trace 拿历史事件。

每个 session 同一时刻只跑一个 run(后到的 run 取代前一个)。run_id 区分批次,
SSE 读者靠 run_id 判断自己读的是不是当前 run(过期的 run 读者会被告知 run 已切换)。
"""
from __future__ import annotations
import threading
import time
import uuid
from typing import Callable, Generator, Any

from .session_store import append_event
from .run_control import actor, writing, RunCancelled


class Run:
    """一次 agent 段执行的缓冲。后台线程写,一个或多个 SSE 读者读。"""
    def __init__(self, run_id: str, sid: str, label: str):
        self.run_id = run_id
        self.sid = sid
        self.label = label
        self.events: list[dict] = []
        self.done: bool = False
        self.cancelled = False
        self.error: Any = None
        self.cond = threading.Condition()
        self.created_at = time.time()

    def push(self, evt: dict) -> None:
        with self.cond:
            if self.cancelled:
                return
            self.events.append(evt)
            self.cond.notify_all()

    def finish(self, error: Any = None) -> None:
        with self.cond:
            self.done = True
            self.error = error
            self.cond.notify_all()

    def cancel(self) -> None:
        with writing(self.sid):
            self.cancelled = True
            self.finish()

    def snapshot_from(self, idx: int) -> tuple[list[dict], bool, Any]:
        """返回 (从 idx 起的新事件, done, error)。"""
        with self.cond:
            return self.events[idx:], self.done, self.error


# sid -> 当前活跃 Run。后到的 run 取代前一个(前一个标 superseded)
_RUNS: dict[str, Run] = {}
_RUNS_LOCK = threading.Lock()


def current_run(sid: str) -> Run | None:
    return _RUNS.get(sid)


def _emit_persisted(sid: str, evt: dict, sub_dir: str = "") -> dict:
    """补全 sid/ts,落盘 jsonl(执行树),返回补全后的 evt 供缓冲用。

    sub_dir 非空时落到 sessions/<sub_dir>/<sid>.jsonl(如 decompose 特性隔离)。
    """
    if "sid" not in evt:
        evt["sid"] = sid
    if "ts" not in evt:
        evt["ts"] = time.time() * 1000  # 毫秒,与前端 Date.now() 对齐(否则跨前后端事件排序错乱)
    append_event(sid, evt, sub_dir=sub_dir)
    return evt


def start_run(sid: str, label: str, gen_factory: Callable[[], Generator[dict, None, None]], sub_dir: str = "", precondition=None) -> Run:
    """启动后台线程跑 gen_factory() 生成器。每个 yield 的 dict 事件 push 进 Run + 落盘。
    返回该 Run(含 run_id)。若该 sid 已有 run,标旧 run 为 superseded(旧读者会看到 done)。

    gen_factory:无参,返回 agent 生成器(yield 事件 dict,字段含 kind/parentId/payload 等)。
    sub_dir:落盘子目录(非空时隔离到 sessions/<sub_dir>/),默认空=现有根路径。
    """
    run_id = uuid.uuid4().hex[:8]
    run = Run(run_id, sid, label)
    with writing(sid), _RUNS_LOCK:
        if precondition is not None:
            precondition()
        prev = _RUNS.get(sid)
        if prev is not None:
            prev.cancel()
        _RUNS[sid] = run

    def worker():
        token = actor.set(run)
        iterator = None
        try:
            with writing(sid):
                iterator = iter(gen_factory())
            while True:
                with writing(sid):
                    pass
                ev = next(iterator)
                with writing(sid):
                    _emit_persisted(sid, ev, sub_dir=sub_dir)
                    run.push(ev)
        except (StopIteration, RunCancelled):
            pass
        except Exception as e:  # noqa: BLE001
            run.finish(error=e)
            return
        finally:
            if iterator is not None:
                try:
                    iterator.close()
                except (Exception, RunCancelled):
                    pass
            actor.reset(token)
        run.finish()

    t = threading.Thread(target=worker, name=f"agent-{sid}-{run_id}", daemon=True)
    t.start()
    return run


def iter_events(sid: str, run_id: str, replay: bool = False):
    """SSE 读者生成器:从当前 run 读事件,直到 run done 或被新 run 取代。
    yield (event_dict, status) —— status: "live" 正常事件;"done" run 正常结束(此后不再有事件);
    "superseded" 该 run 被新 run 取代(客户端应重新拉 trace / 重连);"error" run 异常。

    replay=True 时从头读该 run 已缓冲的事件(用于重连补播);False 时只读连接之后的新事件。

    注意:每个 run 的 SSE 读者只连一次(客户端每次 POST 起新 run),不存在重连同 run 的场景。
    但 worker 线程在 start_run 返回后、SSE 读者调本函数前可能已 push 若干事件(如 session/
    agent_start),replay=False 用 len(run.events) 作起点会跳过这些 → 客户端丢首事件。
    故此处一律从 0 读,保证不丢开头事件。
    """
    run = current_run(sid)
    if run is None or run.run_id != run_id:
        # run 已不存在或已被取代:告知客户端重新拉 trace
        yield ({}, "superseded")
        return
    idx = 0
    while True:
        # 在锁内只取数据,不在锁内 yield(挂起期间持锁会阻塞 worker 的 run.push,造成 worker 短暂 stall)
        superseded = False
        new_events: list[dict] = []
        is_done = False
        err: Any = None
        with run.cond:
            while idx >= len(run.events) and not run.done:
                run.cond.wait(timeout=30)
                # 每 30s 醒一次让 SSE 保活(也防 run 被取代后没 notify 的极端情况)
                # 检查 run 是否已被取代
                if current_run(sid) is not run:
                    superseded = True
                    break
            if not superseded and current_run(sid) is not run:
                superseded = True
            if not superseded:
                new_events = run.events[idx:]
                idx = len(run.events)
                is_done = run.done
                err = run.error
        if superseded:
            yield ({}, "superseded")
            return
        for ev in new_events:
            yield (ev, "live")
        if is_done:
            if err is not None:
                yield ({"kind": "error", "payload": {"message": f"后台 agent 异常:{err}"}}, "error")
            else:
                yield ({}, "done")
            return
