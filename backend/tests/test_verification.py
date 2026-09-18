import pytest
from django.test import RequestFactory
from skill.verification import REQUIRED_CHECKS, normalize_verification, code_version
from skill import step_agent
from api import views

CODE = "const text = '数学';"

def report(status="passed"):
    return {"schemaVersion": 1, "status": status, "ok": True, "error": "test reason",
            "codeVersion": code_version(CODE), "checks": sorted(REQUIRED_CHECKS), "missing": [],
            "sampling": {"mode":"real-playback", "intervalMs":80, "samples":1, "maxGapMs":0}}


@pytest.mark.parametrize('sampling', [None, {}, {'mode':'real-playback','intervalMs':80,'samples':1,'maxGapMs':900}, {'mode':'real-playback','intervalMs':80,'samples':True,'maxGapMs':0}])
def test_invalid_sampling_is_not_certified(sampling):
    r=report();r['sampling']=sampling
    assert normalize_verification(r, True, expected_code=CODE)['status']=='incomplete'

@pytest.fixture
def draft(monkeypatch):
    value = {"runNonce": "current", "draftCode": CODE, "sceneCode": "", "title": "test", "explanation": "test", "renderAttempts": 0}
    monkeypatch.setitem(step_agent._DRAFTS, ("test-verification", "1"), value)
    monkeypatch.setattr(step_agent, "_RESUMES", {})
    return step_agent._DRAFTS[("test-verification", "1")]

@pytest.mark.parametrize("status", ["incomplete", "cancelled", "failed", "unknown"])
def test_boolean_success_cannot_override_status(status):
    assert normalize_verification(report(status), True, expected_code=CODE)["ok"] is False

def test_legacy_success_is_not_certified():
    assert normalize_verification(None, True)["status"] == "incomplete"

def test_missing_check_and_wrong_version_cannot_pass():
    r = report(); r["checks"].remove("layout-final")
    assert normalize_verification(r, True, expected_code=CODE)["status"] == "incomplete"
    assert normalize_verification(report(), True, expected_code="new code")["ok"] is False
    assert normalize_verification(report(), True, expected_code=CODE)["ok"] is True

@pytest.mark.parametrize("changes", [{"status": []}, {"checks": None}, {"schemaVersion": 2}, {"missing": ["unknown-check"]}])
def test_malformed_or_uncovered_report_is_incomplete(changes):
    r = report(); r.update(changes)
    assert normalize_verification(r, True, expected_code=CODE)["status"] == "incomplete"

@pytest.mark.parametrize("nonce,code", [("old", CODE), ("current", "old code")])
def test_stale_api_rejected_before_starting_worker(draft, monkeypatch, nonce, code):
    r = report(); r["codeVersion"] = code_version(code)
    monkeypatch.setattr(views, "start_run", lambda *a, **k: pytest.fail("stale result started a worker"))
    request = RequestFactory().post("/api/render_result", data={"session_id": "test-verification", "step_id": "1", "nonce": nonce, "ok": True, "verification": r}, content_type="application/json")
    assert views.render_result(request).status_code == 409
    assert not step_agent._RESUMES

def test_cancelled_does_not_resume_model_or_finalize(draft, monkeypatch):
    monkeypatch.setattr(step_agent, "_build_agent", lambda *a: pytest.fail("must not call model"))
    step_agent.set_render_result("test-verification", "1", True, nonce="current", verification=report("cancelled"))
    events = list(step_agent.resume_step_agent("test-verification", "1", "current"))
    assert [e["kind"] for e in events] == ["render_result", "error"]
    assert events[0]["payload"]["verification"]["status"] == "cancelled"
    assert draft["sceneCode"] == ""


def test_incomplete_resumes_model_for_repair(draft, monkeypatch):
    calls=[]
    monkeypatch.setattr(step_agent, '_get_runtime_cfg', lambda: object())
    class Agent:
        def stream(self, *args, **kwargs):
            calls.append('repair')
            return iter([])
    monkeypatch.setattr(step_agent, '_build_agent', lambda *args: Agent())
    step_agent.set_render_result("test-verification", "1", True, nonce="current", verification=report("incomplete"))
    events = list(step_agent.resume_step_agent("test-verification", "1", "current"))
    assert calls == ['repair']
    assert events[0]["kind"] == "render_result"

@pytest.mark.parametrize("status,expected", [("passed", CODE), ("incomplete", ""), ("cancelled", ""), ("unknown", "")])
def test_actual_commit_requires_current_complete_report(draft, monkeypatch, status, expected):
    monkeypatch.setattr(step_agent, "interrupt", lambda _: {"ok": True, "verification": report(status)})
    tools = step_agent._build_tools("test-verification", "1")
    next(t for t in tools if t.name == "commit").invoke({})
    assert draft["sceneCode"] == expected

def test_api_normalizes_success_before_handoff(draft, monkeypatch):
    monkeypatch.setattr(views, "start_run", lambda *a, **k: type("Run", (), {"run_id": "test"})())
    monkeypatch.setattr(views, "_stream_run", lambda *a: iter([]))
    request = RequestFactory().post("/api/render_result", data={"session_id": "test-verification", "step_id": "1", "nonce": "current", "ok": True, "verification": report("incomplete")}, content_type="application/json")
    response = views.render_result(request)
    assert response.status_code == 200
    assert step_agent._RESUMES[("test-verification", "1", "current")]["ok"] is False


def test_final_only_report_cannot_certify_batch_b():
    r = report(); r['checks'].remove('layout-temporal')
    assert normalize_verification(r, True, expected_code=CODE)['status'] == 'incomplete'


def test_explicit_3d_layout_skip_can_certify_base_checks_without_sampling():
    r = report()
    r['checks'] = sorted((REQUIRED_CHECKS - {'layout-final', 'bounds-final', 'layout-temporal'}) | {'3d-layout-skipped'})
    r['sampling'] = {'mode':'real-playback', 'intervalMs':80, 'samples':0, 'maxGapMs':0}
    result = normalize_verification(r, True, expected_code=CODE)
    assert result['status'] == 'passed'
    assert result['ok'] is True


def test_3d_layout_skip_does_not_bypass_execution_checks():
    r = report()
    r['checks'] = sorted((REQUIRED_CHECKS - {'execution', 'layout-final', 'bounds-final', 'layout-temporal'}) | {'3d-layout-skipped'})
    r['sampling'] = {'mode':'real-playback', 'intervalMs':80, 'samples':0, 'maxGapMs':0}
    result = normalize_verification(r, True, expected_code=CODE)
    assert result['status'] == 'incomplete'
    assert 'execution' in result['missing']


@pytest.mark.parametrize('limit,previous', [('2', 2), ('0', 0), ('invalid', 2)])
def test_layout_retry_budget_promotes_runnable_draft(draft, monkeypatch, limit, previous):
    monkeypatch.setenv('LAYOUT_MAX_RETRIES', limit)
    monkeypatch.setattr(step_agent, '_get_runtime_cfg', lambda: object())
    class Agent:
        def stream(self, *args, **kwargs): return iter([])
    monkeypatch.setattr(step_agent, '_build_agent', lambda *args: Agent())
    draft['layoutFailCount'] = previous
    r=report('failed'); r['error']='[layout] labels overlap'
    step_agent.set_render_result('test-verification', '1', False, nonce='current', verification=r)
    events=list(step_agent.resume_step_agent('test-verification', '1', 'current'))
    assert events[0]['kind'] == 'render_result'
    assert events[0]['payload']['verification']['status'] == 'passed'
    assert 'display-fallback' in events[0]['payload']['verification']['checks']


def test_default_budget_allows_exactly_two_layout_repairs(draft, monkeypatch):
    monkeypatch.delenv('LAYOUT_MAX_RETRIES', raising=False)
    calls=[]
    monkeypatch.setattr(step_agent, '_get_runtime_cfg', lambda: object())
    class Agent:
        def stream(self, *args, **kwargs):
            calls.append('repair')
            return iter([])
    monkeypatch.setattr(step_agent, '_build_agent', lambda *args: Agent())
    for _ in range(3):
        r=report('failed');r['error']='[layout] overlap'
        step_agent.set_render_result('test-verification','1',False,nonce='current',verification=r)
        list(step_agent.resume_step_agent('test-verification','1','current'))
    assert len(calls)==3
    assert draft['layoutFailCount']==3


def test_runtime_failures_end_in_deterministic_2d_fallback(draft, monkeypatch):
    monkeypatch.setenv('ANIMATION_MAX_REPAIRS', '1')
    monkeypatch.setattr(step_agent, '_get_runtime_cfg', lambda: pytest.fail('fallback must not call model'))
    r=report('failed'); r['checks']=[]; r['missing']=['execution']; r['error']='ReferenceError'
    step_agent.set_render_result('test-verification','1',False,nonce='current',verification=r)
    events=list(step_agent.resume_step_agent('test-verification','1','current'))
    assert [e['kind'] for e in events] == ['render_result','render_request']
    assert 'ThreeDScene' not in events[-1]['payload']['code']
    assert 'new Text' in events[-1]['payload']['code']


def test_display_fallback_still_requires_execution_checks():
    r=report('passed')
    r['checks']=['display-fallback']
    r['missing']=sorted(REQUIRED_CHECKS)
    result=normalize_verification(r,True,expected_code=CODE)
    assert result['ok'] is False
    assert 'execution' in result['missing']


def test_malformed_diagnostics_are_dropped():
    r=report();r.update(layoutIssues=[None, {'objects':None}], overlapDeclarations=[{'objects':['x'],'start':0,'end':1,'reason':'transition'}])
    result=normalize_verification(r,True,expected_code=CODE)
    assert result['ok'] is True
    assert result['layoutIssues']==[]
    assert result['overlapDeclarations'][0]['reason']=='transition'
