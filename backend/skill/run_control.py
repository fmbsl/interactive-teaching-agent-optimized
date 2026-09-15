"""Single-process cancellation fences for shared session mutations.

ContextVars are propagated by LangChain's executor to tool/checkpoint threads.
Locks protect only local writes, never model requests.
"""
from contextvars import ContextVar
from contextlib import contextmanager
from collections import defaultdict
from functools import wraps
import threading

actor = ContextVar("session_run", default=None)
_locks = defaultdict(threading.RLock)


class RunCancelled(BaseException):
    """Must escape agent fallback handlers catching Exception."""


@contextmanager
def writing(sid):
    with _locks[sid]:
        run = actor.get()
        if run is not None and (run.sid != sid or run.cancelled):
            raise RunCancelled()
        yield


def wrap(value, sid):
    if isinstance(value, (GuardDict, GuardList, GuardSet)) and value.sid == sid:
        return value
    if isinstance(value, dict):
        result = GuardDict()
        result.sid = sid
        dict.update(result, {k: wrap(v, sid) for k, v in value.items()})
        return result
    if isinstance(value, list):
        result = GuardList()
        result.sid = sid
        list.extend(result, (wrap(v, sid) for v in value))
        return result
    if isinstance(value, set):
        result = GuardSet(value)
        result.sid = sid
        return result
    return value


class GuardDict(dict):
    pass


class GuardList(list):
    pass


class GuardSet(set):
    pass


def _mutator(base, name):
    def mutate(self, *args, **kwargs):
        with writing(self.sid):
            if base is dict and name in ("update", "__ior__"):
                values = dict(*args, **kwargs)
                dict.update(self, {k: wrap(v, self.sid) for k, v in values.items()})
                return self if name == "__ior__" else None
            if base is list and name in ("extend", "__iadd__"):
                list.extend(self, [wrap(v, self.sid) for v in args[0]])
                return self if name == "__iadd__" else None
            # Convert all inputs: nested references must retain the same fence.
            args = tuple(wrap(v, self.sid) for v in args)
            kwargs = {k: wrap(v, self.sid) for k, v in kwargs.items()}
            result = getattr(base, name)(self, *args, **kwargs)
            return result
    return mutate


for cls, base, methods in (
    (GuardDict, dict, "__setitem__ __delitem__ clear pop popitem setdefault update __ior__"),
    (GuardList, list, "__setitem__ __delitem__ append extend insert pop remove clear reverse sort __iadd__ __imul__"),
    (GuardSet, set, "add remove discard pop clear update difference_update intersection_update symmetric_difference_update __ior__ __iand__ __ixor__ __isub__"),
):
    for name in methods.split():
        setattr(cls, name, _mutator(base, name))


class SessionRegistry(dict):
    def __init__(self, factory=None):
        super().__init__()
        self.factory = factory

    @staticmethod
    def sid(key):
        return key[0] if isinstance(key, tuple) else key

    def __missing__(self, key):
        if self.factory is None:
            raise KeyError(key)
        with writing(self.sid(key)):
            if key not in self:
                self[key] = self.factory()
            return self[key]

    def __setitem__(self, key, value):
        sid = self.sid(key)
        with writing(sid):
            super().__setitem__(key, wrap(value, sid))

    def __delitem__(self, key):
        with writing(self.sid(key)):
            super().__delitem__(key)

    def pop(self, key, *default):
        with writing(self.sid(key)):
            return super().pop(key, *default)


def guarded_tool(tool):
    """Check cancellation before any tool body (including read/model tools)."""
    def decorate(fn):
        @wraps(fn)
        def checked(*args, **kwargs):
            run = actor.get()
            if run is not None:
                with writing(run.sid):
                    pass
            return fn(*args, **kwargs)
        return tool(checked)
    return decorate


def session_write(fn):
    @wraps(fn)
    def checked(sid, *args, **kwargs):
        with writing(sid):
            return fn(sid, *args, **kwargs)
    return checked


from langgraph.checkpoint.memory import MemorySaver


class GuardedMemorySaver(MemorySaver):
    def put(self, *args, **kwargs):
        run = actor.get()
        if run is None:
            return super().put(*args, **kwargs)
        with writing(run.sid):
            return super().put(*args, **kwargs)

    def put_writes(self, *args, **kwargs):
        run = actor.get()
        if run is None:
            return super().put_writes(*args, **kwargs)
        with writing(run.sid):
            return super().put_writes(*args, **kwargs)
