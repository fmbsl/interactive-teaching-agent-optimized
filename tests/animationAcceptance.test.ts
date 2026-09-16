import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationAcceptance} from '../src/animationAcceptance.ts';
test('empty or interrupted stream cannot certify an animation',()=>{
const t=new AnimationAcceptance();t.observe(1,{kind:'done'});
assert.equal(t.completed(1,'one',0,''),false);
t.observe(1,{kind:'explain',stepId:'one',sceneCode:''});
assert.equal(t.completed(1,'one',0,''),false);
});
test('recursive acceptance is scoped to the current run, step and attempt',()=>{
const t=new AnimationAcceptance();const before=t.version(1,'one');
t.observe(1,{kind:'explain',stepId:'one',sceneCode:'code'});
assert.equal(t.completed(1,'one',before,''),true);
assert.equal(t.completed(2,'one',before,''),false);
assert.equal(t.completed(1,'two',before,''),false);
assert.equal(t.completed(1,'one',t.version(1,'one'),''),false);
assert.equal(t.completed(1,'one',before,'render failed'),false);
t.clear();assert.equal(t.completed(1,'one',before,''),false);
});
