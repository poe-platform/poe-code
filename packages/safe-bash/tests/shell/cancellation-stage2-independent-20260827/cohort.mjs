import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { setImmediate as turn } from "node:timers/promises";

assert.ok(process.env.STAGE2_PRODUCT_URL, "An explicit authenticated product module URL is required; no live fallback");
const productUrl = process.env.STAGE2_PRODUCT_URL;
const { Shell, MemoryFileSystem, agentCommands, ShellLimitError } = await import(productUrl);
const extension = new URL(productUrl).pathname.endsWith(".ts") ? "ts" : "js";
const { InvocationScope } = await import(new URL(`shell/cleanup.${extension}`, productUrl).href);
const cancellation = await import(new URL(`shell/cancellation.${extension}`, productUrl).href);
const capture = pending => Promise.resolve(pending).then(value => ({ kind: "return", value }), reason => ({ kind: "throw", reason }));
const returned = outcome => { if (outcome.kind === "throw") throw outcome.reason; assert.equal(outcome.kind, "return"); return outcome.value; };
const thrown = (outcome, reason) => { assert.equal(outcome.kind, "throw"); assert.ok(Object.is(outcome.reason, reason), "exact rejection identity"); };
const cases = [];
function row(id, name, execute) {
  cases.push(id);
  test(`${id} ${name}`, { timeout: 2500, concurrency: false }, execute);
}
function deferred() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return { promise, resolve };
}
function rig(context, options = {}) {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, ...options }).use(agentCommands());
  const caller = new AbortController();
  const gates = [];
  const pending = [];
  const owned = {
    fs, shell, caller,
    gate() { const gate = deferred(); gates.push(gate); return gate; },
    command(name, execute) { shell.commands.register({ name, execute }); },
    execute(script = "driver", extra = {}) {
      const outcome = capture(shell.exec(script, { signal: caller.signal, ...extra }));
      pending.push(outcome);
      return outcome;
    },
  };
  context.after(async () => {
    for (const gate of gates) gate.resolve();
    caller.abort(new Error("independent fixture teardown, never an acceptance rescue"));
    await shell.dispose();
    await Promise.all(pending);
  });
  return owned;
}
async function driver(scope, operation, script = "driver") {
  const finished = scope.gate();
  let outcome;
  scope.command("driver", async context => {
    outcome = await capture(Promise.resolve().then(() => operation(context)));
    finished.resolve();
    return { exitCode: 0 };
  });
  const execution = await scope.execute(script);
  await finished.promise;
  return { execution, outcome };
}
async function monitorScopes(operation, initialize = () => {}) {
  let children = 0;
  const scopes = [];
  const original = InvocationScope.prototype.child;
  InvocationScope.prototype.child = function () {
    children++;
    const child = Reflect.apply(original, this, []);
    scopes.push(child);
    initialize(child, children);
    return child;
  };
  try {
    const outcome = await capture(operation());
    return { outcome, children, closedChildren: scopes.filter(scope => scope.signal.aborted).length };
  }
  finally { InvocationScope.prototype.child = original; }
}
function abortExact(controller, reason) {
  if (reason === undefined) Object.defineProperty(controller.signal, "reason", { value: undefined, configurable: true });
  controller.abort(reason === undefined ? Symbol("native internal non-default abort") : reason);
}

row("R01", "omitted and undefined borrow without closing the parent", async context => {
  const scope = rig(context);
  const seen = [];
  scope.command("leaf", child => { seen.push(child.signal); return { exitCode: 3 }; });
  const result = await driver(scope, async parent => {
    const listenerCount = getEventListeners(parent.signal, "abort").length;
    const outcomes = [];
    const controllers = [];
    const native = globalThis.AbortController;
    let created = 0;
    globalThis.AbortController = new Proxy(native, { construct(target, args, receiver) { created++; return Reflect.construct(target, args, receiver); } });
    try {
      for (const invoke of [() => parent.invoke("leaf", []), () => parent.invoke("leaf", [], undefined),
        () => parent.invoke("leaf", [], {}), () => parent.invoke("leaf", [], { signal: undefined })]) {
        created = 0;
        outcomes.push(await invoke());
        controllers.push(created);
      }
    } finally { globalThis.AbortController = native; }
    assert.deepEqual(controllers, [2, 2, 2, 2], "only existing invoke and command scopes allocate native controllers");
    assert.equal(parent.signal.aborted, false);
    assert.equal(getEventListeners(parent.signal, "abort").length, listenerCount);
    for (const signal of seen) assert.equal(signal, parent.signal);
    return outcomes;
  });
  assert.equal(returned(result.execution).exitCode, 0);
  assert.deepEqual(returned(result.outcome), Array.from({ length: 4 }, () => ({ exitCode: 3 })));
});

row("R02", "inherited accessors, proxy, function and array options read signal once", async context => {
  const scope = rig(context);
  const result = await driver(scope, async parent => {
    for (const kind of ["inherited", "proxy", "function", "array"]) {
      const local = new AbortController();
      let reads = 0;
      const getter = { get signal() { reads++; return local.signal; } };
      const options = kind === "inherited" ? Object.create(getter)
        : kind === "proxy" ? new Proxy({}, { get(_target, key) { return key === "signal" ? getter.signal : undefined; } })
          : Object.defineProperty(kind === "array" ? [] : function () {}, "signal", { get: () => getter.signal });
      assert.equal((await parent.invoke("true", [], options)).exitCode, 0);
      assert.equal(reads, 1, kind);
      assert.equal(getEventListeners(local.signal, "abort").length, 0);
    }
  });
  returned(result.outcome);
});

row("R03", "invalid containers and signal brands reject before any child scope", async context => {
  const scope = rig(context);
  let handlerCalls = 0;
  scope.command("leaf", () => { handlerCalls++; return { exitCode: 0 }; });
  const result = await driver(scope, async parent => {
    const bad = [null, 0, false, "options", Symbol("options"), 1n,
      ...[null, 0, false, "signal", {}, new AbortController(), { aborted: false, addEventListener() {} }].map(signal => ({ signal }))];
    for (const options of bad) {
      const observed = await monitorScopes(() => parent.invoke("leaf", [], options));
      assert.equal(observed.outcome.kind, "throw");
      assert.ok(observed.outcome.reason instanceof TypeError);
      assert.equal(observed.children, 0);
    }
  });
  returned(result.outcome);
  assert.equal(handlerCalls, 0);
});

row("R04", "already-aborted root wins before the options getter", async context => {
  const scope = rig(context);
  const reason = Object.freeze({ root: "before-admission" });
  let reads = 0;
  const result = await driver(scope, async parent => {
    scope.caller.abort(reason);
    return monitorScopes(() => parent.invoke("true", [], { get signal() { reads++; throw new Error("must not read"); } }));
  });
  thrown(result.execution, reason);
  const observed = returned(result.outcome);
  thrown(observed.outcome, reason);
  assert.equal(observed.children, 0);
  assert.equal(reads, 0);
});

row("R05", "throwing signal getters preserve exact falsy failures and their own effects", async context => {
  const scope = rig(context);
  const result = await driver(scope, async parent => {
    for (const reason of [undefined, null, false, 0, -0, "", NaN, Object.freeze({ getter: 1 })]) {
      let effects = 0;
      const observed = await monitorScopes(() => parent.invoke("true", [], { get signal() { effects++; throw reason; } }));
      thrown(observed.outcome, reason);
      assert.equal(effects, 1);
      assert.equal(observed.children, 0);
    }
  });
  returned(result.outcome);
});

row("R06", "root abort during a throwing getter outranks its staged error", async context => {
  const scope = rig(context);
  const rootReason = Object.freeze({ root: "getter-reentrancy" });
  const getterReason = Object.freeze({ getter: "lower-priority" });
  const result = await driver(scope, parent => monitorScopes(() => parent.invoke("true", [], {
    get signal() { scope.caller.abort(rootReason); throw getterReason; },
  })));
  thrown(result.execution, rootReason);
  const observed = returned(result.outcome);
  thrown(observed.outcome, rootReason);
  assert.equal(observed.children, 0);
});

row("R07", "preaborted local exact reasons admit no handler input or child scope", async context => {
  const scope = rig(context);
  let acquisitions = 0;
  const result = await driver(scope, async parent => {
    for (const reason of [undefined, null, false, 0, -0, "", NaN, Object.freeze({ local: 1 })]) {
      const local = new AbortController();
      abortExact(local, reason);
      const observed = await monitorScopes(() => parent.invoke("true", [], { signal: local.signal,
        stdin: { [Symbol.asyncIterator]() { acquisitions++; return { async next() { return { done: true }; } }; } },
      }));
      thrown(observed.outcome, reason);
      assert.equal(observed.children, 0);
    }
  });
  returned(result.outcome);
  assert.equal(acquisitions, 0);
});

async function hierarchy(context, order, rootDuringCleanup = false, overrides = {}) {
  const scope = rig(context);
  const outer = new AbortController();
  const inner = new AbortController();
  const reasons = { outer: Object.freeze({ origin: "outer" }), inner: Object.freeze({ origin: "inner" }), root: Object.freeze({ origin: "root" }), ...overrides };
  const entered = scope.gate();
  const work = scope.gate();
  const cleaning = scope.gate();
  const release = scope.gate();
  const innerDone = scope.gate();
  const outerDone = scope.gate();
  let delivered;
  let innerOutcome;
  let outerOutcome;
  let publiclySettled = false;
  scope.command("leaf", async child => {
    delivered = child.signal;
    child.registerCleanup(async () => { cleaning.resolve(); await release.promise; });
    entered.resolve();
    await work.promise;
    return { exitCode: 7 };
  });
  scope.command("branch", async parent => {
    innerOutcome = await capture(parent.invoke("leaf", [], { signal: inner.signal }));
    innerDone.resolve();
    if (innerOutcome.kind === "throw") throw innerOutcome.reason;
    return innerOutcome.value;
  });
  scope.command("driver", async parent => {
    outerOutcome = await capture(parent.invoke("branch", [], { signal: outer.signal }));
    outerDone.resolve();
    return { exitCode: 0 };
  });
  const execution = scope.execute().then(value => { publiclySettled = true; return value; });
  await entered.promise;
  const first = order[0];
  (first === "inner" ? inner : outer).abort(reasons[first]);
  work.resolve();
  await cleaning.promise;
  const firstDelivered = delivered.reason;
  for (const next of order.slice(1)) (next === "inner" ? inner : outer).abort(reasons[next]);
  if (rootDuringCleanup) scope.caller.abort(reasons.root);
  await turn();
  const heldBeforeRelease = !publiclySettled;
  release.resolve();
  const rootOutcome = await execution;
  await Promise.all([innerDone.promise, outerDone.promise]);
  return { scope, inner, outer, reasons, delivered, firstDelivered, innerOutcome, outerOutcome, rootOutcome, heldBeforeRelease };
}

row("R08", "local cancellation replaces numeric success only after registered cleanup", async context => {
  for (const inner of [Object.freeze({ local: true }), null, false, 0, -0, "", NaN]) {
    const result = await hierarchy(context, ["inner"], false, { inner });
    assert.equal(result.heldBeforeRelease, true);
    thrown(result.innerOutcome, inner);
    thrown(result.outerOutcome, inner);
    assert.equal(returned(result.rootOutcome).exitCode, 0);
    assert.equal(result.scope.caller.signal.aborted, false);
  }
});

row("R09", "inner delivery stays immutable while outer then root improve open settlement", async context => {
  const result = await hierarchy(context, ["inner", "outer"], true);
  assert.equal(result.heldBeforeRelease, true);
  assert.equal(result.firstDelivered, result.reasons.inner);
  assert.equal(result.delivered.reason, result.reasons.inner);
  thrown(result.innerOutcome, result.reasons.root);
  thrown(result.outerOutcome, result.reasons.root);
  thrown(result.rootOutcome, result.reasons.root);
});

row("R10", "outer-first delivery and settlement do not downgrade to inner", async context => {
  const result = await hierarchy(context, ["outer", "inner"]);
  assert.equal(result.firstDelivered, result.reasons.outer);
  assert.equal(result.delivered.reason, result.reasons.outer);
  thrown(result.innerOutcome, result.reasons.outer);
  thrown(result.outerOutcome, result.reasons.outer);
  assert.equal(returned(result.rootOutcome).exitCode, 0);
});

row("R11", "closed child outcomes and delivery stay stable after later abort", async context => {
  const scope = rig(context);
  const local = new AbortController();
  let delivered;
  scope.command("leaf", child => { delivered = child.signal; return { exitCode: 9 }; });
  const result = await driver(scope, async parent => {
    const first = await capture(parent.invoke("leaf", [], { signal: local.signal }));
    const previousReason = delivered.reason;
    local.abort({ late: true });
    await turn();
    assert.equal(delivered.aborted, false);
    assert.equal(delivered.reason, previousReason);
    assert.equal(returned(first).exitCode, 9);
    return parent.invoke("true", []);
  });
  assert.equal(returned(result.outcome).exitCode, 0);
  assert.equal(returned(result.execution).exitCode, 0);
});

row("R12", "a canceled child does not poison same-parent or other-shell siblings", async context => {
  const scope = rig(context);
  const other = rig(context);
  const reason = Object.freeze({ child: true });
  const local = new AbortController();
  local.abort(reason);
  const result = await driver(scope, async parent => {
    thrown(await capture(parent.invoke("true", [], { signal: local.signal })), reason);
    assert.equal(parent.signal.aborted, false);
    assert.equal((await parent.invoke("true", [])).exitCode, 0);
    assert.equal(returned(await other.execute("true")).exitCode, 0);
  });
  returned(result.outcome);
  assert.equal(returned(result.execution).exitCode, 0);
});

row("R13", "captured env-getter failure beats later local cancellation in closure", async context => {
  const scope = rig(context);
  const local = new AbortController();
  const failure = Object.freeze({ execution: true });
  const reason = Object.freeze({ local: true });
  const result = await driver(scope, parent => monitorScopes(() => parent.invoke("true", [], {
    signal: local.signal, get env() { throw failure; },
  }), (child, ordinal) => {
    if (ordinal === 1) child.register(() => { local.abort(reason); });
  }));
  thrown(returned(result.outcome).outcome, failure);
  assert.equal(returned(result.execution).exitCode, 0);
});

row("R14", "equal unreported sibling error is not a descendant cancellation report", async context => {
  const scope = rig(context);
  const common = Object.freeze({ identical: "object" });
  const outerReason = Object.freeze({ outer: true });
  const outer = new AbortController();
  let siblingOutcome;
  scope.command("branch", async parent => {
    const previous = new AbortController();
    previous.abort(common);
    await capture(parent.invoke("true", [], { signal: previous.signal }));
    const observed = await monitorScopes(() => parent.invoke("true", [], { get env() { throw common; } }), (child, ordinal) => {
      if (ordinal === 1) child.register(() => { outer.abort(outerReason); });
    });
    siblingOutcome = observed.outcome;
    return { exitCode: 0 };
  });
  const result = await driver(scope, parent => capture(parent.invoke("branch", [], { signal: outer.signal })));
  thrown(siblingOutcome, common);
  thrown(returned(result.outcome), outerReason);
});

row("R15", "normal invocation admissions retain the original cumulative command budget", async context => {
  const scope = rig(context, { limits: { maxCommands: 3 } });
  const result = await driver(scope, async parent => {
    const local = new AbortController();
    assert.equal((await parent.invoke("true", [], { signal: local.signal })).exitCode, 0);
    assert.equal((await parent.invoke("true", [])).exitCode, 0);
    return capture(parent.invoke("true", [], { signal: local.signal }));
  });
  const observed = returned(result.outcome);
  assert.equal(observed.kind, "throw");
  assert.ok(observed.reason instanceof ShellLimitError);
  assert.equal(observed.reason.limit, "maxCommands");
  thrown(result.execution, observed.reason);
});

row("R16", "early pipe closure remains stage-local and preserves the following command", async context => {
  const scope = rig(context);
  const entered = scope.gate();
  const headClosed = scope.gate();
  scope.shell.use(async (child, next) => {
    if (child.command !== "head") return next();
    await entered.promise;
    const result = await next();
    headClosed.resolve();
    return result;
  });
  let callerSignal;
  scope.command("emit", async child => {
    callerSignal = child.signal;
    entered.resolve();
    await headClosed.promise;
    await child.stdout.write(new Uint8Array([1, 2, 3]));
    return { exitCode: 0 };
  });
  const result = await driver(scope, parent => parent.invoke("emit", [], { signal: new AbortController().signal }), "driver | head -n 0; true");
  assert.equal(returned(result.execution).exitCode, 0);
  assert.equal(scope.caller.signal.aborted, false);
  assert.ok(callerSignal);
});

row("R17", "sole falsy cleanup failure beats all numeric results including 124", async context => {
  for (const [exitCode, reason] of [[0, undefined], [7, false], [124, 0]]) {
    const scope = rig(context);
    scope.command("leaf", child => { child.registerCleanup(() => { throw reason; }); return { exitCode }; });
    const result = await driver(scope, parent => parent.invoke("leaf", [], { signal: new AbortController().signal }));
    assert.equal(returned(result.outcome).exitCode, exitCode);
    thrown(result.execution, reason);
  }
});

row("R18", "captured budget rejection outranks cleanup failure at the root barrier", async context => {
  const scope = rig(context, { limits: { maxCommands: 1 } });
  const cleanup = Object.freeze({ cleanup: true });
  const result = await driver(scope, async parent => {
    parent.registerCleanup(() => { throw cleanup; });
    return capture(parent.invoke("true", [], { signal: new AbortController().signal }));
  });
  const failure = returned(result.outcome);
  assert.equal(failure.kind, "throw");
  assert.ok(failure.reason instanceof ShellLimitError);
  thrown(result.execution, failure.reason);
});

row("R19", "root abort during cleanup beats captured execution and cleanup failure", async context => {
  const scope = rig(context, { limits: { maxCommands: 1 } });
  const reason = Object.freeze({ root: "barrier" });
  let cleaned = 0;
  const result = await driver(scope, async parent => {
    parent.registerCleanup(() => { cleaned++; scope.caller.abort(reason); throw false; });
    return capture(parent.invoke("true", [], { signal: new AbortController().signal }));
  });
  assert.equal(cleaned, 1);
  thrown(result.execution, reason);
});

row("R20", "multiple cleanup failures preserve exact ordered AggregateError members", async context => {
  const scope = rig(context);
  scope.command("leaf", child => {
    child.registerCleanup(() => { throw undefined; });
    child.registerCleanup(() => { throw null; });
    return { exitCode: 19 };
  });
  const result = await driver(scope, parent => parent.invoke("leaf", [], { signal: new AbortController().signal }));
  assert.equal(returned(result.outcome).exitCode, 19);
  assert.equal(result.execution.kind, "throw");
  assert.ok(result.execution.reason instanceof AggregateError);
  assert.deepEqual(result.execution.reason.errors, [undefined, null]);
});

row("R21", "local listeners detach on success cancellation and invalid argv", async context => {
  const scope = rig(context);
  const result = await driver(scope, async parent => {
    for (const kind of ["success", "preabort", "argv"]) {
      const local = new AbortController();
      if (kind === "preabort") local.abort({ local: true });
      await capture(parent.invoke("true", kind === "argv" ? ["\0"] : [], { signal: local.signal }));
      assert.equal(getEventListeners(local.signal, "abort").length, 0, kind);
    }
    return parent.invoke("true", []);
  });
  assert.equal(returned(result.outcome).exitCode, 0);
});

row("R22", "listener attach-then-throw rolls back all admitted resources", async context => {
  const scope = rig(context);
  const local = new AbortController();
  const reason = Object.freeze({ initialization: true });
  const add = local.signal.addEventListener;
  local.signal.addEventListener = function (...args) { Reflect.apply(add, this, args); throw reason; };
  const result = await driver(scope, async parent => {
    const observed = await monitorScopes(() => parent.invoke("true", [], { signal: local.signal }));
    thrown(observed.outcome, reason);
    assert.equal(observed.closedChildren, observed.children);
    assert.equal(getEventListeners(local.signal, "abort").length, 0);
    assert.equal(parent.signal.aborted, false);
    return parent.invoke("true", []);
  });
  assert.equal(returned(result.outcome).exitCode, 0);
});

row("R23", "literal argv cwd env replacement and middleware survive child signals", async context => {
  const scope = rig(context);
  await scope.fs.mkdir("/work");
  const order = [];
  const arguments_ = ["", "a b", "$(false)", ";", "*", "😀"];
  let observed;
  scope.shell.use(async (child, next) => { order.push(child.command); child.env = { ...child.env }; return next(); });
  scope.command("leaf", child => { observed = { args: child.args, cwd: child.cwd, env: { ...child.env } }; return { exitCode: 8 }; });
  const result = await driver(scope, parent => parent.invoke("leaf", arguments_, {
    signal: new AbortController().signal, cwd: "/work", env: { ONLY: "child" }, replaceEnv: true,
  }));
  assert.equal(returned(result.outcome).exitCode, 8);
  assert.deepEqual(observed, { args: arguments_, cwd: "/work", env: { ONLY: "child" } });
  assert.deepEqual(order, ["driver", "leaf"]);
});

row("R24", "getopts prefix restoration and child cursor cloning remain intact", async context => {
  for (const body of ["OPTIND=1 driver", "f() { local OPTIND=1; OPTIND=1 driver; getopts ab localopt -ab; }; f"]) {
    const scope = rig(context);
    const result = await driver(scope, async parent => {
      assert.equal((await parent.invoke("getopts", ["ab", "child", "-ab"], { signal: new AbortController().signal })).exitCode, 0);
      return parent.invoke("true", [], { env: { OPTIND: "2" }, signal: new AbortController().signal });
    }, `set -- -ab; getopts ab opt; ${body}; getopts ab opt; printf '%s:%s\\n' "$opt" "$OPTIND"`);
    returned(result.outcome);
    assert.equal(returned(result.execution).stdout, "b:2\n");
  }
});

row("R25", "binary stdin sink overrides and redirect ownership remain usable", async context => {
  const scope = rig(context);
  const bytes = new Uint8Array([0, 255, 128, 10]);
  const output = [];
  let acquisitions = 0;
  let returns = 0;
  const result = await driver(scope, parent => parent.invoke("cat", [], {
    signal: new AbortController().signal, stdinIsDefault: false,
    stdin: { [Symbol.asyncIterator]() {
      acquisitions++;
      let read = false;
      return {
        async next() { if (read) return { done: true }; read = true; return { done: false, value: bytes }; },
        async return() { returns++; return { done: true }; },
      };
    } },
    stdout: { async write(chunk) { output.push(...chunk); } },
  }), "driver > /redirect; printf done");
  assert.equal(returned(result.outcome).exitCode, 0);
  assert.deepEqual(output, [...bytes]);
  assert.equal(acquisitions, 1);
  assert.equal(returns, 0, "natural EOF does not redundantly call return");
  assert.deepEqual(await scope.fs.readFile("/redirect"), new Uint8Array());
  assert.equal(returned(result.execution).stdout, "done");
  let unreadNext = 0;
  let unreadReturn = 0;
  scope.command("unread-driver", parent => parent.invoke("head", ["-n", "0"], {
    signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() { return {
      async next() { unreadNext++; return { done: false, value: bytes }; },
      async return() { unreadReturn++; return { done: true }; },
    }; } },
  }));
  assert.equal(returned(await scope.execute("unread-driver")).exitCode, 0);
  assert.equal(unreadNext, 0);
  assert.equal(unreadReturn, 1, "owned unread input is still returned exactly once");
});

row("C01", "control seam: delivered order versus preobservation configured fallback", () => {
  for (const preaborted of [false, true]) {
    const budget = new AbortController();
    const pipeline = new AbortController();
    const budgetReason = Object.freeze({ control: "budget" });
    const pipelineReason = Object.freeze({ control: "pipeline" });
    if (preaborted) { pipeline.abort(pipelineReason); budget.abort(budgetReason); }
    const root = cancellation.createRootCancellationLink({ admission: { depth: 0, maxDepth: 8, resourceLimit: 32 },
      controls: [{ role: "budget-control", signal: budget.signal }, { role: "pipeline-control", signal: pipeline.signal }],
    });
    try {
      if (!preaborted) { pipeline.abort(pipelineReason); budget.abort(budgetReason); }
      assert.equal(root.deliverySignal.reason, preaborted ? budgetReason : pipelineReason);
    } finally { root.close(); }
    assert.equal(getEventListeners(budget.signal, "abort").length, 0);
    assert.equal(getEventListeners(pipeline.signal, "abort").length, 0);
  }
});

assert.equal(cases.length, 26);
