import test from "node:test";
import assert from "node:assert/strict";
import { executeWithDeadline } from "../src/scriptExecution.ts";
import { createVerificationScope } from "../src/verificationScope.ts";
import { codeVersionOf, VerificationMailbox, verificationReport } from "../src/verificationTypes.ts";

test("deadline cannot certify code which throws later", async () => {
  const result = await executeWithDeadline(async () => {
    await new Promise(r => setTimeout(r, 30));
    throw new Error("late failure");
  }, 5);
  assert.equal(result.status, "incomplete");
  assert.equal(result.ok, false);
  await new Promise(r => setTimeout(r, 40)); // late rejection must be observed
});

test("success clears its deadline; cancellation unregisters its listener", async () => {
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  let pending = 0;
  globalThis.setTimeout = ((...args: any[]) => { pending++; return realSet(...args); }) as any;
  globalThis.clearTimeout = ((timer: any) => { if (timer !== undefined) pending--; realClear(timer); }) as any;
  try {
    assert.equal((await executeWithDeadline(async () => {}, 1000)).status, "passed");
    assert.equal(pending, 0);
    const controller = new AbortController();
    const work = executeWithDeadline(() => new Promise(() => {}), 1000, controller.signal);
    controller.abort();
    assert.equal((await work).status, "cancelled");
    assert.equal(pending, 0);
  } finally { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; }
});

test("already cancelled validation does not execute code", async () => {
  const controller = new AbortController(); controller.abort();
  let executed = false;
  assert.equal((await executeWithDeadline(async () => { executed = true; }, 10, controller.signal)).status, "cancelled");
  assert.equal(executed, false);
});

class FakeScene {
  disposed = 0;
  async play() { await Promise.resolve(); }
  dispose() { this.disposed++; }
  add() {}
}
test("constructor aliases are tracked; multiple scenes are disposed exactly once", async () => {
  const scope = createVerificationScope({ Scene: FakeScene }, c => c === "host");
  const Alias = scope.bindings.Scene;
  const a = new Alias("host"), b = new Alias("host");
  a.play();
  await scope.drain();
  assert.equal(scope.scenes.length, 2);
  scope.close(); scope.close();
  assert.equal(a.disposed, 1); assert.equal(b.disposed, 1);
  assert.throws(() => a.add(), /已释放/);
  assert.throws(() => new Alias("host"), /已结束/);
});

test("unawaited scene operations are drained and their failures observed", async () => {
  class BrokenScene extends FakeScene { async play() { throw new Error("animation failed"); } }
  const scope = createVerificationScope({ Scene: BrokenScene }, () => true);
  new scope.bindings.Scene("host").play();
  await assert.rejects(scope.drain(), /animation failed/);
  scope.close();
});

test("scopes do not replace constructors for other running scenes", () => {
  const a = createVerificationScope({ Scene: FakeScene }, () => true);
  const b = createVerificationScope({ Scene: FakeScene }, () => true);
  a.close();
  const scene = new b.bindings.Scene("host"); scene.add();
  assert.equal(scene.disposed, 0); b.close();
});

test("code fingerprints are SHA256 and preserve unicode", async () => {
  assert.equal(await codeVersionOf("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.notEqual(await codeVersionOf("数学"), await codeVersionOf("数学 "));
});

test("late callback cannot resolve the next validation, even in the same chat run", async () => {
  const mailbox = new VerificationMailbox();
  const first = mailbox.begin(), next = mailbox.begin();
  assert.equal((await first.promise).status, "cancelled");
  assert.equal(mailbox.complete(first.nonce, verificationReport("passed")), false);
  assert.equal(mailbox.complete(next.nonce, verificationReport("incomplete", "next result")), true);
  assert.equal((await next.promise).error, "next result");
  assert.equal(mailbox.complete(next.nonce, verificationReport("passed")), false);
});

test("cancelled mailbox releases its pending consumer", async () => {
  const mailbox = new VerificationMailbox(); const request = mailbox.begin();
  mailbox.cancel();
  assert.equal((await request.promise).status, "cancelled");
});

test("interactive playback without a deadline remains cancellable", async () => {
  const controller = new AbortController();
  const work = executeWithDeadline(() => new Promise(() => {}), Infinity, controller.signal);
  await new Promise(r => setTimeout(r, 5)); controller.abort();
  assert.equal((await work).status, "cancelled");
});

// Temporal policy tests use controlled timestamps; browser fixtures exercise the real renderer.
import { LayoutObservations } from '../src/layoutObservations.ts';
test('a transient collision clears before persistence threshold', () => {
  const samples = new LayoutObservations();
  assert.deepEqual(samples.observe(['a:b'], 0, false), []);
  assert.deepEqual(samples.observe([], 80, false), []);
  assert.deepEqual(samples.observe(['a:b'], 240, false), []);
});
test('persistent collision, boundary collision and measurement gaps are distinct', () => {
  const samples = new LayoutObservations();
  for(const t of [0,80,160])assert.deepEqual(samples.observe(['a:b'],t,false),[]);
  assert.deepEqual(samples.observe(['a:b'],240,false),[{key:'a:b',start:0,end:240}]);
  assert.deepEqual(samples.observe(['a:b'],800,false),[]);
  assert.deepEqual(samples.observe(['a:b'],810,true),[{key:'a:b',start:800,end:810}]);
});
