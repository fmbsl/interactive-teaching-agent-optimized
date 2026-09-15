import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainStep, chatStop } from '../src/data/llmClient.ts';
Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: () => null}});

const event = (kind: string, value: unknown) => `event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`;
const collect = async (stream: AsyncIterable<unknown>) => {
  const events = [];
  for await (const item of stream) events.push(item);
  return events;
};

test('SSE keeps candidate parameters and stop targets the observed run', async t => {
  t.mock.property(globalThis, 'localStorage', {getItem: () => null});
  let stopBody: any;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (url.endsWith('/chat_stop')) {
      stopBody = JSON.parse(String(init.body));
      return new Response('{}');
    }
    return new Response(event('run', {sid:'s', run_id:'r1'}) + event('render_request', {
      kind:'render_request', stepId:1, payload:{code:'code', nonce:'nonce', params:{x:3}},
    }));
  });
  const events: any[] = await collect(explainStep('s', 1));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].params, {x:3});
  await chatStop('s');
  assert.deepEqual(stopBody, {sid:'s', run_id:'r1'});
});

test('immediate restart waits until the stop request finishes', async t => {
  t.mock.property(globalThis, 'localStorage', {getItem: () => null});
  let finishStop!: () => void;
  const waiting = new Promise<void>(resolve => { finishStop = resolve; });
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    if (url.endsWith('/chat_stop')) await waiting;
    return new Response('');
  });
  const stop = chatStop('s');
  const next = collect(explainStep('s', 1));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['/api/chat_stop']);
  finishStop();
  await Promise.all([stop, next]);
  assert.deepEqual(calls, ['/api/chat_stop', '/api/explain']);
});

test('stop failure is observable and does not block future requests', async t => {
  t.mock.property(globalThis, 'localStorage', {getItem: () => null});
  t.mock.method(globalThis, 'fetch', async (url: string) =>
    new Response('', {status: url.endsWith('/chat_stop') ? 503 : 200}));
  await assert.rejects(chatStop('s'), /503/);
  assert.deepEqual(await collect(explainStep('s', 1)), []);
});
