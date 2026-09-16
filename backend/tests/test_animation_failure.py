import pytest
from types import SimpleNamespace
from skill import main_agent

@pytest.fixture
def animation_tools(monkeypatch):
    cache = {}
    monkeypatch.setattr(main_agent, "_ANIMATION_FAILURES", {"failure-test": {}})
    monkeypatch.setattr(main_agent, "_agent", lambda: SimpleNamespace(get_step_cache=lambda sid, step: cache.get(step)))
    return {t.name: t for t in main_agent._build_tools("failure-test")}, cache

@pytest.mark.parametrize("result", [{"ok": False, "error": "layout overflow"}, {"ok": True}])
def test_failed_or_empty_generation_is_not_retried(animation_tools, monkeypatch, result):
    tools, cache = animation_tools
    calls = []
    monkeypatch.setattr(main_agent, "interrupt", lambda value: calls.append(value) or result)
    assert "失败" in tools["generate_animation"].invoke({"step_id": "one"})
    assert "本轮" in tools["generate_animation"].invoke({"step_id": "one"})
    assert len(calls) == 1
    main_agent._ANIMATION_FAILURES["failure-test"] = {}
    tools["generate_animation"].invoke({"step_id": "one"})
    assert len(calls) == 2


def test_failed_modify_cannot_trigger_new_generation(animation_tools, monkeypatch):
    tools, cache = animation_tools
    cache["one"] = {"sceneCode": "previous"}
    calls = []
    monkeypatch.setattr(main_agent, "interrupt", lambda value: calls.append(value) or {"ok": False, "error": "layout"})
    assert "失败" in tools["modify_step"].invoke({"step_id": "one", "feedback": "change"})
    assert "本轮" in tools["modify_step"].invoke({"step_id": "one", "feedback": "again"})
    assert "本轮" in tools["generate_animation"].invoke({"step_id": "one"})
    assert len(calls) == 1
    assert cache["one"]["sceneCode"] == "previous"
