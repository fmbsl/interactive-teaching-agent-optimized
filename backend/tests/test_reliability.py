"""Offline races use barriers, with no model/network calls."""
import json
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
import agent
from skill import executor, session_store, step_agent
from skill.run_control import actor, RunCancelled, SessionRegistry, writing
from test_verification import report, CODE


@pytest.fixture
def session(tmp_path, monkeypatch):
    monkeypatch.setattr(session_store, '_SESSIONS_DIR', str(tmp_path))
    sid = 'reliability'
    agent.restore_session(sid, {'title': 'original'})
    yield sid
    executor._RUNS.pop(sid, None)
    agent._SESSIONS.pop(sid, None)
    step_agent.clear_session(sid)


@pytest.mark.parametrize('replace', [False, True])
def test_late_worker_cannot_mutate_or_persist(session, replace):
    entered, release, exited = (threading.Event() for _ in range(3))
    state = agent.get_session(session)
    state['topics'] = [{'steps': []}]
    nested = state['topics'][0]['steps']
    def old():
        try:
            entered.set()
            assert release.wait(5)
            nested.append({'title': 'late'})
            agent.rename_session(session, 'late')
            yield {'kind': 'late'}
        finally:
            exited.set()
    run = executor.start_run(session, 'old', old)
    assert entered.wait(5)
    if replace:
        def new():
            agent.rename_session(session, 'new')
            yield {'kind': 'new'}
        latest = executor.start_run(session, 'new', new)
        list(executor.iter_events(session, latest.run_id))
    else:
        run.cancel()
        agent.rename_session(session, 'new')
    release.set()
    assert exited.wait(5)
    assert not nested
    assert state['title'] == 'new'
    assert session_store.load_state(session)['title'] == 'new'
    assert not run.events
    assert all(e['kind'] != 'late' for e in session_store.read_trace(session))


def test_disconnect_does_not_cancel_worker(session):
    release, exited = threading.Event(), threading.Event()
    def work():
        yield {'kind': 'first'}
        assert release.wait(5)
        agent.rename_session(session, 'finished')
        exited.set()
        yield {'kind': 'last'}
    run = executor.start_run(session, 'work', work)
    reader = executor.iter_events(session, run.run_id)
    assert next(reader)[0]['kind'] == 'first'
    reader.close()
    release.set()
    assert exited.wait(5)
    assert not run.cancelled
    assert session_store.load_state(session)['title'] == 'finished'


def test_langchain_tool_thread_preserves_cancellation_context(session):
    from langchain_core.runnables.config import get_executor_for_config
    run = executor.Run('old', session, 'test')
    token = actor.set(run)
    try:
        with get_executor_for_config({}) as pool:
            assert pool.submit(actor.get).result(timeout=5) is run
            # Cancel from the HTTP/control context.
            actor.reset(token)
            run.cancel()
            token = actor.set(run)
            future = pool.submit(agent.rename_session, session, 'late')
            with pytest.raises(RunCancelled):
                future.result(timeout=5)
    finally:
        actor.reset(token)


def test_parallel_saves_and_stale_snapshot(session):
    state = agent.get_session(session)
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: session_store.save_state(session, state), range(24)))
    saved = session_store.load_state(session)
    assert saved['revision'] == state['revision'] == 24
    assert not list(__import__('pathlib').Path(session_store._SESSIONS_DIR).glob('*.tmp'))
    with pytest.raises(ValueError, match='Stale'):
        session_store.save_state(session, {'title': 'stale', 'revision': 1})
    assert session_store.load_state(session) == saved


def test_save_failure_is_reported_and_previous_file_retained(session, monkeypatch, caplog):
    state = agent.get_session(session)
    session_store.save_state(session, state)
    before = session_store.load_state(session)
    def fail(*args):
        raise OSError('disk unavailable')
    monkeypatch.setattr(session_store.os, 'replace', fail)
    with pytest.raises(OSError):
        session_store.save_state(session, state)
    assert session_store.load_state(session) == before
    assert 'Failed to save session state' in caplog.text


def test_candidate_failure_preserves_accepted_on_restore(session):
    accepted = {'title': 'good', 'explanation': 'good', 'draftCode': CODE,
                'sceneCode': CODE, 'verification': report(), 'params': []}
    agent.accept_step(session, '1', accepted)
    candidate = {**accepted, 'draftCode': 'bad', 'sceneCode': '', 'verification': report('failed')}
    step_agent.save_candidate(session, '1', candidate)
    with pytest.raises(ValueError):
        agent.accept_step(session, '1', candidate)
    agent.restore_session(session, session_store.load_state(session))
    assert agent.get_step_cache(session, '1')['sceneCode'] == CODE
    assert agent.get_session(session)['step_drafts']['1']['draftCode'] == 'bad'


def test_changed_parameters_cannot_be_accepted(session):
    candidate = {'draftCode': CODE, 'sceneCode': CODE, 'verification': report(),
                 'params': [{'name': 'x', 'default': 3}]}
    with pytest.raises(ValueError):
        agent.accept_step(session, '1', candidate)
    candidate['verification']['params'] = {'x': 3}
    agent.accept_step(session, '1', candidate)
    assert agent.get_step_cache(session, '1')['verification']['params'] == {'x': 3}


def test_stop_rejects_late_render_result(session):
    from api.views import chat_stop
    from django.test import RequestFactory
    step_agent._DRAFTS[(session, '1')] = {'runNonce': 'nonce', 'draftCode': CODE}
    run = executor.Run('old', session, 'render')
    executor._RUNS[session] = run
    response = chat_stop(RequestFactory().post('/api/chat_stop', {'sid': session}, content_type='application/json'))
    assert response.status_code == 200 and run.cancelled
    with pytest.raises(ValueError):
        step_agent.set_render_result(session, '1', True, nonce='nonce', verification=report())


def test_new_task_rejects_previous_render_before_resume(session):
    step_agent._DRAFTS[(session, '1')] = {'runNonce': 'nonce', 'draftCode': CODE, 'ownerRun': 'old'}
    executor._RUNS[session] = executor.Run('new', session, 'chat')
    with pytest.raises(ValueError):
        executor.start_run(session, 'resume', lambda: iter([]), precondition=lambda:
            step_agent.validate_render_result(session, '1', True, nonce='nonce', verification=report()))
    assert executor.current_run(session).run_id == 'new'


def test_delayed_stop_does_not_cancel_new_run(session):
    from api.views import chat_stop
    from django.test import RequestFactory
    run = executor.Run('new', session, 'new')
    executor._RUNS[session] = run
    step_agent._DRAFTS[(session, '1')] = {'runNonce': 'new'}
    result = chat_stop(RequestFactory().post('/api/chat_stop',
        {'sid': session, 'run_id': 'old'}, content_type='application/json'))
    assert json.loads(result.content)['superseded']
    assert not run.cancelled
    assert step_agent._DRAFTS[(session, '1')]['runNonce'] == 'new'


def test_failed_promotion_rolls_back_memory_and_disk(session, monkeypatch):
    accepted = {'draftCode': CODE, 'sceneCode': CODE, 'verification': report(), 'title': 'old'}
    agent.accept_step(session, '1', accepted)
    def fail(*args):
        raise OSError('disk unavailable')
    monkeypatch.setattr(session_store.os, 'replace', fail)
    with pytest.raises(OSError):
        agent.accept_step(session, '1', {**accepted, 'title': 'new'})
    assert agent.get_step_cache(session, '1')['title'] == 'old'
    assert session_store.load_state(session)['step_cache']['1']['title'] == 'old'


def test_real_langgraph_cancel_blocks_late_checkpoint(session):
    from typing import TypedDict
    from langgraph.graph import StateGraph, START, END
    from skill.run_control import GuardedMemorySaver
    class State(TypedDict):
        value: str
    entered, release, exited = (threading.Event() for _ in range(3))
    saver = GuardedMemorySaver()
    def slow(state):
        entered.set()
        assert release.wait(5)
        return {'value': 'late'}
    builder = StateGraph(State)
    builder.add_node('slow', slow)
    builder.add_edge(START, 'slow')
    builder.add_edge('slow', END)
    graph = builder.compile(checkpointer=saver)
    config = {'configurable': {'thread_id': session}}
    def work():
        try:
            graph.invoke({'value': 'before'}, config)
            yield {'kind': 'late'}
        finally:
            exited.set()
    run = executor.start_run(session, 'graph', work)
    assert entered.wait(5)
    run.cancel()
    release.set()
    assert exited.wait(5)
    assert graph.get_state(config).values['value'] == 'before'
    assert not run.events


def test_nested_mutation_forms_are_fenced(session):
    registry = SessionRegistry()
    registry[session] = {'list': [], 'set': set(), 'dict': {}}
    state = registry[session]
    state['list'].extend({'v': 1} for _ in range(1))
    state['dict'].update([('nested', {'v': 1})])
    run = executor.Run('old', session, 'test')
    run.cancel()
    token = actor.set(run)
    try:
        for mutate in (lambda: state['list'][0].update(v=2),
                       lambda: state['dict']['nested'].pop('v'),
                       lambda: state['set'].add('late'),
                       lambda: registry.pop(session)):
            with pytest.raises(RunCancelled):
                mutate()
    finally:
        actor.reset(token)
