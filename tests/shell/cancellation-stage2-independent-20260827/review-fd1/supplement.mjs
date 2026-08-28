import assert from "node:assert/strict";
import { test } from "node:test";
import { getEventListeners } from "node:events";

assert.ok(process.env.STAGE2_PRODUCT_URL);
const extension = new URL(process.env.STAGE2_PRODUCT_URL).pathname.endsWith(".ts") ? "ts" : "js";
const cancellation = await import(new URL(`shell/cancellation.${extension}`, process.env.STAGE2_PRODUCT_URL).href);

test("S01 identical unreported execution reason is not runtime cancellation provenance", () => {
  const root = cancellation.createRootCancellationLink({ admission: { depth: 0, maxDepth: 8, resourceLimit: 32 } });
  const outerSignal = new AbortController();
  const innerSignal = new AbortController();
  const common = Object.freeze({ executionAndLocalReason: true });
  const outerReason = Object.freeze({ differentOuter: true });
  const outer = cancellation.activateChildCancellation(cancellation.prepareChildCancellation(root,
    { signal: outerSignal.signal }, { depth: 1, maxDepth: 8, resourceLimit: 32 }));
  const inner = cancellation.activateChildCancellation(cancellation.prepareChildCancellation(outer,
    { signal: innerSignal.signal }, { depth: 2, maxDepth: 8, resourceLimit: 32 }));
  try {
    innerSignal.abort(common);
    outerSignal.abort(outerReason);
    const selection = cancellation.selectRuntimeCancellationOutcome(inner, { kind: "throw", reason: common });
    assert.equal(selection.outcome.kind, "throw");
    assert.equal(selection.outcome.reason, common);
    assert.equal(selection.report, undefined);
  } finally {
    inner.close();
    outer.close();
    root.close();
  }
  assert.equal(getEventListeners(innerSignal.signal, "abort").length, 0);
  assert.equal(getEventListeners(outerSignal.signal, "abort").length, 0);
});

test("S02 actual nested invoke preserves equal unreported execution failure", { timeout: 2500 }, async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import(process.env.STAGE2_PRODUCT_URL);
  const { InvocationScope } = await import(new URL(`shell/cleanup.${extension}`, process.env.STAGE2_PRODUCT_URL).href);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  const caller = new AbortController();
  const outer = new AbortController();
  const inner = new AbortController();
  const common = Object.freeze({ executionAndLocalReason: true });
  const outerReason = Object.freeze({ differentOuter: true });
  const capture = pending => Promise.resolve(pending).then(value => ({ kind: "return", value }), reason => ({ kind: "throw", reason }));
  let innerOutcome;
  let outerOutcome;
  let cleanups = 0;
  shell.commands.register({ name: "branch", async execute(parent) {
    const child = InvocationScope.prototype.child;
    let ordinal = 0;
    InvocationScope.prototype.child = function () {
      const scope = Reflect.apply(child, this, []);
      if (++ordinal === 1) scope.register(() => { cleanups++; inner.abort(common); outer.abort(outerReason); });
      return scope;
    };
    try { innerOutcome = await capture(parent.invoke("true", [], { signal: inner.signal, get env() { throw common; } })); }
    finally { InvocationScope.prototype.child = child; }
    return { exitCode: 0 };
  } });
  shell.commands.register({ name: "driver", async execute(parent) {
    outerOutcome = await capture(parent.invoke("branch", [], { signal: outer.signal }));
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec("driver", { signal: caller.signal });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(innerOutcome, { kind: "throw", reason: common });
    assert.deepEqual(outerOutcome, { kind: "throw", reason: outerReason });
    assert.equal(cleanups, 1);
    assert.equal(caller.signal.aborted, false);
    assert.equal(getEventListeners(inner.signal, "abort").length, 0);
    assert.equal(getEventListeners(outer.signal, "abort").length, 0);
  } finally { await shell.dispose(); }
});
