import {test} from 'node:test';
import assert from 'node:assert/strict';
import {busyForEvent, clearBusyRun} from '../src/busyTask.ts';

test('old run cleanup cannot clear another animation task', () => {
  const active = busyForEvent({kind:'animation_request',stepId:'1',step_id:'1'}, 2)!;
  assert.equal(clearBusyRun(active,1), active);
  assert.equal(clearBusyRun(active,2), null);
});
test('direct generation and recursive verification use the same busy transitions', () => {
  assert.equal(busyForEvent({kind:'step-start',stepId:1,title:'math'},3)?.kind,'animation');
  assert.equal(busyForEvent({kind:'render_request',stepId:1,code:'code'},3)?.label,'正在验证动画…');
  assert.equal(busyForEvent({kind:'graph_command_request',instruction:'graph'},3)?.kind,'graph');
  assert.equal(busyForEvent({kind:'tool_call',stepId:null,name:'generate_quiz',args:{}},3)?.kind,'quiz');
});
test('terminal events release busy state while token chunks preserve it', () => {
  for(const kind of ['error','done','ask','explain','quiz']) assert.equal(busyForEvent({kind} as any,3),null);
  assert.equal(busyForEvent({kind:'message_delta',id:'1',role:'orchestrator',text:'text'},3),undefined);
});
