"""会话:step_cache 字符串键、rename/delete、Markdown 导出。"""
import uuid, os
import agent
from agent import restore_session, get_step_cache, set_step_cache, rename_session, delete_session, export_session_md


SID = "ut_" + uuid.uuid4().hex[:6]


def _mk():
    return {
        "question": "测试", "file_text": None, "lesson": None, "current_step": 1,
        "finished": False, "title": "测试",
        "step_cache": {}, "scene_codes": {}, "conversation": [], "files": [],
        "depth": "understand", "topics": [], "step_status": {}, "graph": None,
    }


def test_step_cache_str_keys_survive_restore():
    sid = SID
    # 带字符串 topic 键的落盘 state(JSON 反序列化后键为字符串)
    st = _mk()
    st["step_cache"] = {"b8f7f543-1": {"title": "x", "sceneCode": "code"}}
    restore_session(sid, st)
    # 不崩,且字符串键保留
    sc = agent._SESSIONS[sid]["step_cache"]
    assert "b8f7f543-1" in sc
    # 访问器:int 或 str 都能命中
    assert get_step_cache(sid, "b8f7f543-1")
    set_step_cache(sid, 1, {"title": "y", "sceneCode": "c2"})
    assert get_step_cache(sid, 1) and get_step_cache(sid, "1")


def test_rename_session():
    sid = SID + "_r"
    agent._SESSIONS[sid] = _mk()
    assert rename_session(sid, "新标题") is True
    assert agent._SESSIONS[sid]["title"] == "新标题"
    assert rename_session(sid, "   ") is False  # 空标题拒绝
    del agent._SESSIONS[sid]


def test_export_md_contains_explanation():
    sid = SID + "_m"
    s = _mk()
    tid = "t" + uuid.uuid4().hex[:4]
    s["topics"] = [{"id": tid, "title": "主题", "summary": "概述", "steps": [{"id": f"{tid}-1", "title": "第1步"}]}]
    s["step_cache"] = {f"{tid}-1": {"title": "第1步", "intent": "意图", "explanation": "这里是讲解", "sceneCode": "const x=1"}}
    agent._SESSIONS[sid] = s
    md = export_session_md(sid)
    assert "主题" in md and "简介" in md or "讲解" in md
    assert "这里是讲解" in md
    assert "const x=1" in md
    del agent._SESSIONS[sid]
