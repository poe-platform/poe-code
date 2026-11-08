import assert from "node:assert/strict";

for (const entry of ["@poe-platform/safe-js", "@poe-platform/safe-js/core"]) {
  const { Budget, createRealm, defineExtension } = await import(entry);
  const callbacks = [];
  const effects = [];
  let context;
  let receiver;
  let argument;
  let release;
  let cleanupCount = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const budget = new Budget({ maxSteps: 20_000 });
  const realm = createRealm({ budget, grants: ["guest:retain", "source:nested"], extensions: [defineExtension({
    manifest: { version: 1, name: "phases", capabilities: ["guest:retain", "source:nested"], globals: ["save", "retain", "mark", "wait", "dispatch", "work"] },
    setup(extension) {
      context = extension;
      context.onCleanup(() => { cleanupCount++; });
      return { globals: {
        save: callback => { callbacks.push(callback); },
        retain: context.retainGuestArguments((self, value) => { receiver = self; argument = value; }, 0),
        mark: value => { effects.push(value); },
        wait: () => pending,
        dispatch: context.nestedOperation(async () => {
          const nested = context.startCallback(callbacks[2]);
          await nested.synchronous;
          effects.push("host");
        }),
        work: context.nestedOperation(async () => {
          context.chargeWork(100);
          await new Promise(resolve => setImmediate(resolve));
          context.chargeWork(100);
          effects.push("work");
        })
      } };
    }
  })] });
  try {
    assert.equal((await realm.evaluate(`
      const object = { value: 1 }; object.self = object;
      retain(object, object); object.value = 2;
      async function listener(value) {
        let count = 0; for (let index = 0; index < 200; index++) count++;
        mark([count, this === object, value === object, value.self === value, value.value]);
        await wait(); mark("tail"); return listener;
      }
      save(listener);
      save(() => { mark("next"); return 7; });
      save(async () => { mark("inner"); await wait(); });
      save(() => { mark("outer"); dispatch(); work(); mark("returned"); });
    `)).ok, true, entry);
    const first = context.startCallback(callbacks[0], { thisValue: receiver, args: [argument] });
    assert.equal(Object.isFrozen(first), true);
    let settled = false;
    void first.result.then(() => { settled = true; }, () => { settled = true; });
    const next = realm.startCallback(callbacks[1]);
    await first.synchronous;
    assert.deepEqual(effects[0], [200, true, true, true, 2]);
    assert.ok(budget.stepsUsed > 1000);
    await next.synchronous;
    assert.equal(await next.result, 7);
    assert.deepEqual(effects, [[200, true, true, true, 2], "next"]);
    assert.equal(settled, false);
    await assert.rejects(realm.evaluate("return 1;"), { code: "reentry" });
    const nested = realm.startCallback(callbacks[3]);
    await nested.synchronous;
    assert.deepEqual(effects.slice(2), ["outer", "inner", "host", "work", "returned"]);
    await nested.result;
    assert.equal(settled, false);
    release();
    assert.equal(await first.result, callbacks[0]);
    assert.equal(effects.at(-1), "tail");
    assert.equal(await realm.invokeCallback(callbacks[1]), 7);
  } finally {
    release();
    await realm.close();
    await realm.close();
    assert.equal(cleanupCount, 1);
    assert.equal(budget.currentCallDepth, 0);
  }

  for (const [source, prefixSucceeds] of [
    ['() => { throw "failure"; }', false],
    ['async () => { throw "failure"; }', true],
    ['async () => { await 0; throw "failure"; }', true]
  ]) {
    let callback;
    const owner = createRealm({ bindings: { save: value => { callback = value; } } });
    try {
      await owner.evaluate(`save(${source});`);
      const invocation = owner.startCallback(callback);
      const [prefix, result] = await Promise.allSettled([invocation.synchronous, invocation.result]);
      assert.equal(prefix.status, prefixSucceeds ? "fulfilled" : "rejected");
      assert.deepEqual(result, { status: "rejected", reason: "failure" });
      if (!prefixSucceeds) assert.deepEqual(prefix, result);
    } finally { await owner.close(); }
  }

  for (const action of ["close", "abort", "fatal", "overlap"]) {
    const captured = [];
    const controller = new AbortController();
    const owner = createRealm({ signal: controller.signal, budget: new Budget({ maxSteps: 300 }), bindings: {
      save: value => { captured.push(value); }, wait: () => new Promise(() => {})
    } });
    try {
      await owner.evaluate("save(async () => { await wait(); }); save(async () => { while (true) {} });");
      const invocation = owner.startCallback(captured[0]);
      await invocation.synchronous;
      if (action === "abort") controller.abort(new Error("stopped"));
      else if (action === "fatal" || action === "overlap") {
        const failure = owner.startCallback(captured[action === "fatal" ? 1 : 0]);
        const outcomes = await Promise.allSettled([failure.synchronous, failure.result]);
        assert.ok(outcomes.every(outcome => outcome.status === "rejected"));
      } else await owner.close();
      await assert.rejects(invocation.result);
      await invocation.synchronous;
    } finally { await owner.close(); }
    const closed = owner.startCallback(captured[0]);
    assert.ok((await Promise.allSettled([closed.synchronous, closed.result])).every(outcome => outcome.status === "rejected"));
  }

  let callback;
  const owner = createRealm({ bindings: { save: value => { callback = value; } } });
  const foreign = createRealm();
  try {
    await owner.evaluate("save(() => 1);");
    const invocation = foreign.startCallback(callback);
    assert.ok((await Promise.allSettled([invocation.synchronous, invocation.result])).every(outcome => outcome.status === "rejected"));
    owner.releaseCallback(callback);
    const revoked = owner.startCallback(callback);
    assert.ok((await Promise.allSettled([revoked.synchronous, revoked.result])).every(outcome => outcome.status === "rejected"));
  } finally {
    await owner.close();
    await foreign.close();
  }

  const captured = [];
  const trace = [];
  const boundary = createRealm({ bindings: {
    save: value => { captured.push(value); }, mark: value => { trace.push(value); }
  } });
  try {
    await boundary.evaluate('save(async () => { mark("before"); await 0; mark("after"); });');
    const invocation = boundary.startCallback(captured[0]);
    await invocation.synchronous;
    assert.deepEqual(trace, ["before"]);
    await invocation.result;
    assert.deepEqual(trace, ["before", "after"]);
  } finally { await boundary.close(); }

  for (const action of ["close", "abort"]) {
    let captured;
    let entered;
    const entering = new Promise(resolve => { entered = resolve; });
    const controller = new AbortController();
    const ownerBudget = new Budget({ maxSteps: 1000 });
    const owner = createRealm({ budget: ownerBudget, signal: controller.signal, grants: ["source:nested"], extensions: [defineExtension({
      manifest: { version: 1, name: "blocked-prefix", capabilities: ["source:nested"], globals: ["save", "work"] },
      setup(context) {
        return { globals: {
          save: value => { captured = value; },
          work: context.nestedOperation(() => { entered(); return new Promise(() => {}); })
        } };
      }
    })] });
    try {
      await owner.evaluate("save(async () => { work(); });");
      const invocation = owner.startCallback(captured);
      await entering;
      if (action === "abort") controller.abort(new Error("stopped"));
      await owner.close();
      assert.ok((await Promise.allSettled([invocation.synchronous, invocation.result])).every(outcome => outcome.status === "rejected"));
      assert.equal(ownerBudget.currentCallDepth, 0);
      const replacement = createRealm({ budget: ownerBudget });
      await replacement.close();
    } finally { await owner.close(); }
  }

  const unhandled = [];
  const onUnhandled = reason => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  try {
    let captured;
    const owner = createRealm({ bindings: { save: value => { captured = value; } } });
    try {
      await owner.evaluate('save(() => { throw "ignored"; });');
      owner.startCallback(captured);
      await new Promise(resolve => setImmediate(resolve));
      await owner.close();
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(unhandled, []);
    } finally { await owner.close(); }
  } finally { process.removeListener("unhandledRejection", onUnhandled); }
}

console.log("Public realm callback phases, identity, nesting, yields, failures and cleanup passed");
