"""step_id 校验(_valid_step_id):坏 id 不 500、不空跑 LLM 的回归护栏。"""
import api.views as views


def _session(topics=None, lesson=None, sid="s"):
    return {"sid": sid, "topics": topics or [], "lesson": lesson}


def test_valid_topic_step():
    s = _session(topics=[{"id": "t", "steps": [{"id": "t-1", "title": "a"}, {"id": "t-S2", "title": "s"}]}])
    assert views._valid_step_id(s, "t-1") is True
    assert views._valid_step_id(s, "t-S2") is True


def test_invalid_topic_step_nonexistent_topic():
    s = _session(topics=[{"id": "t", "steps": [{"id": "t-1"}]}])
    assert views._valid_step_id(s, "no-such-topic-1") is False


def test_nonexistent_numeric_suffix():
    s = _session(topics=[{"id": "t", "steps": [{"id": "t-1"}]}])
    assert views._valid_step_id(s, "t-99") is False


def test_garbage_string_no_dash():
    s = _session(lesson={"steps": [{"id": 1}]})
    assert views._valid_step_id(s, "abc") is False  # 旧流 int('abc') 不应抛而是判 False


def test_valid_int_lesson_step():
    s = _session(lesson={"steps": [{"id": 1}, {"id": 2}]})
    assert views._valid_step_id(s, 1) is True
    assert views._valid_step_id(s, 2) is True
    assert views._valid_step_id(s, 3) is False  # 越界
    assert views._valid_step_id(s, 0) is False
