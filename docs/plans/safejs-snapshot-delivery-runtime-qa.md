# Remote-based snapshot runtime QA

Executed manually under the Markdown QA plan. This is a bounded transport probe,
not the complete runtime test suite or an installed-release check.

Run the following with `node --input-type=module` on Node 18.18.0, 18.20.8,
20.20.2, 22.23.2, 24.21.0 and 26.8.2. Also run with `bun run -` on Bun 1.3.11.
Run from the repository root after the maintained SafeJS build. Node package
versions absent locally were invoked with `npx --yes --package=node@<version> node`.

```js
import {
  createSandboxPromise,
  getPromiseProperties,
  promiseProperties
} from "./packages/safe-js/dist/interp/values.js";
import { CompileScope } from "./packages/safe-js/dist/interp/regex/compile-guard.js";
import {
  importedPromiseSnapshots,
  importedPromises
} from "./packages/safe-js/dist/interp/promise-state.js";
import { createBuiltinBindings } from "./packages/safe-js/dist/interp/globals.js";
import { resolveIntrinsicIdentity } from "./packages/safe-js/dist/interp/intrinsics.js";
import { Budget } from "./packages/safe-js/dist/interp/budget.js";
import { restore as restoreInterpreter } from "./packages/safe-js/dist/snapshot/restore.js";
import { serialize } from "./packages/safe-js/dist/snapshot/serialize.js";
import assert from "node:assert/strict";
import { run, restore, dump } from "./packages/safe-js/dist/index.js";
import { decodeReplayData } from "./packages/safe-js/dist/snapshot/replay-data.js";
import { createSandboxClosure } from "./packages/safe-js/dist/interp/values.js";
let traps = 0;
const hostile = Object.defineProperty({}, "promiseReplay", {
  get() {
    traps++;
    throw Error("host getter");
  },
  enumerable: true
});
await assert.rejects(run("return 7;", { snapshot: hostile }));
assert.equal(traps, 0);
let calls = 0;
const source = "effect();const a={};a.self=a;return [a,a];";
const original = await run(source, {
  bindings: {
    effect: () => {
      calls++;
    }
  }
});
assert.equal(original.ok, true);
assert.equal(original.returnValue[0], original.returnValue[1]);
const snapshot = JSON.parse(await dump(original));
const replay = await run(source, {
  snapshot: restore(snapshot, { source }),
  bindings: {
    effect: () => {
      calls++;
    }
  }
});
assert.equal(replay.ok, true);
assert.equal(replay.returnValue[0], replay.returnValue[1]);
assert.equal(replay.returnValue[0].self, replay.returnValue[0]);
assert.equal(calls, 1);
snapshot.version = 999;
assert.throws(() => restore(snapshot, { source }), /expected/);
await assert.rejects(
  run(source, {
    snapshot,
    bindings: {
      effect: () => {
        calls++;
      }
    }
  })
);
assert.equal(calls, 1);
const ref = (id) => ({ tag: "ref", id });
const prop = (value) => ({ value, writable: true, enumerable: true, configurable: true });
const obj = (properties) => ({
  kind: "object",
  properties,
  extensible: true,
  nullPrototype: false
});
let published = 0;
const capability = createSandboxClosure({
  call: () => {
    throw Error("capability executed");
  }
});
assert.throws(() =>
  decodeReplayData(
    {
      root: ref(0),
      nodes: [
        obj({ first: prop(ref(1)), later: prop(ref(3)) }),
        { kind: "capability", id: "explicit", properties: ref(2) },
        obj({ self: prop(ref(1)) }),
        obj({ bad: prop(ref(99)) })
      ]
    },
    {
      resolveCapability: () => capability,
      onCapabilityRestored: () => {
        published++;
      }
    }
  )
);
assert.equal(published, 0);

const lowSource = "return 0";
const low = serialize({
  source: lowSource,
  currentAstNodeId: 1,
  scopeChain: [{ id: "module", bindings: {} }],
  callStack: [],
  pendingPromises: [],
  moduleBindings: {}
});
const lowBudget = new Budget({ dataSize: 12 });
assert.throws(
  () => restoreInterpreter(low, { source: lowSource, budget: lowBudget }),
  (error) => error.code === "budgetExceeded" && error.path === "$.sourceHash"
);
assert.equal(lowBudget.currentDataSize, 0);
let lowTraps = 0;
Object.defineProperty(low.scopeChain[0], "bindings", {
  get() {
    lowTraps++;
    throw Error("low-budget getter");
  },
  enumerable: true
});
const hostileBudget = new Budget({ dataSize: 12 });
assert.throws(
  () => restoreInterpreter(low, { source: lowSource, budget: hostileBudget }),
  (error) => error.code === "invalidType" && error.path === "$.scopeChain[0].bindings"
);
assert.equal(lowTraps, 0);
assert.equal(hostileBudget.currentDataSize, 0);

for (const present of [false, true]) {
  const p = createSandboxPromise(new Promise(() => {}));
  const previous = present ? getPromiseProperties(p) : undefined;
  if (previous)
    Object.defineProperty(previous, "original", {
      value: 17,
      enumerable: false,
      configurable: true,
      writable: false
    });
  const descriptors = previous ? Object.getOwnPropertyDescriptors(previous) : undefined;
  const failure = new Error("late transaction scheduling failure");
  assert.throws(
    () =>
      decodeReplayData(
        {
          root: ref(0),
          nodes: [
            obj({ first: prop(ref(1)), later: prop(ref(3)) }),
            { kind: "promise-capability", id: "owned", properties: ref(2) },
            obj({ replacement: prop(9) }),
            { kind: "settled-imported-promise", status: "fulfilled", outcome: 8, scheduleId: 1 }
          ]
        },
        {
          resolvePromise: (id) => (id === "owned" ? p : undefined),
          restoreScheduledPromise: () => {
            assert.notEqual(promiseProperties.get(p), previous);
            throw failure;
          }
        }
      ),
    (error) => error === failure
  );
  assert.equal(promiseProperties.get(p), previous);
  if (previous) assert.deepEqual(Object.getOwnPropertyDescriptors(previous), descriptors);
}
for (const status of ["fulfilled", "rejected"]) {
  const b = new Budget();
  const operation = b.acquireCompileOwner(false);
  const parent = new CompileScope(operation.owner);
  const memo = new Map();
  const captured = [];
  const failure = new Error("late capture scheduling failure");
  const before = b.currentDataSize;
  try {
    assert.throws(
      () =>
        decodeReplayData(
          {
            root: ref(0),
            nodes: [
              { kind: "settled-imported-promise", status, outcome: ref(1), scheduleId: 1 },
              { kind: "regex", source: "^(a|b)+$", flags: "u", lastIndex: 0 }
            ]
          },
          {
            graphId: "explicit",
            importedPromiseMemo: memo,
            onImportedPromiseRestored: (p) => captured.push(p),
            restoreScheduledPromise: () => {
              throw failure;
            }
          },
          parent
        ),
      (error) => error === failure
    );
    assert.equal(captured.length, 1);
    assert.equal(memo.size, 0);
    assert.equal(importedPromiseSnapshots.has(captured[0]), false);
    assert.equal(importedPromises.has(captured[0]), false);
    assert.equal(parent.tickets.size, 0);
    assert.equal(b.currentDataSize, before);
  } finally {
    parent.dispose();
    operation.release();
  }
}
const originalRealm = await run("Number.prototype.snapshotMarker=11;return Number.prototype");
assert.equal(originalRealm.ok, true);
const originalDescriptors = Object.getOwnPropertyDescriptors(originalRealm.returnValue);
const intrinsicSnapshot = serialize({
  source: lowSource,
  currentAstNodeId: 1,
  scopeChain: [{ id: "module", bindings: { prototype: originalRealm.returnValue } }],
  callStack: [],
  pendingPromises: [],
  moduleBindings: {}
});
const intrinsicBudget = new Budget();
const reconcile = intrinsicBudget.reconcileCompileData;
const lateError = new Error("late intrinsic reconciliation failure");
let firstReconcile = true;
intrinsicBudget.reconcileCompileData = function (...args) {
  if (firstReconcile) {
    firstReconcile = false;
    throw lateError;
  }
  return Reflect.apply(reconcile, this, args);
};
assert.throws(
  () => restoreInterpreter(intrinsicSnapshot, { source: lowSource, budget: intrinsicBudget }),
  (error) => error === lateError
);
assert.equal(intrinsicBudget.currentDataSize, 0);
assert.deepEqual([...intrinsicBudget.retainedValues()], []);
assert.deepEqual(Object.getOwnPropertyDescriptors(originalRealm.returnValue), originalDescriptors);
restoreInterpreter(intrinsicSnapshot, { source: lowSource, budget: intrinsicBudget });
assert.equal(
  resolveIntrinsicIdentity(intrinsicBudget, '["Number","prototype"]').snapshotMarker,
  11
);
const existingBudget = new Budget();
createBuiltinBindings({ budget: existingBudget });
const existingPrototype = resolveIntrinsicIdentity(existingBudget, '["Number","prototype"]');
Object.defineProperty(existingPrototype, "owned", { value: 19, configurable: true });
const existingDescriptors = Object.getOwnPropertyDescriptors(existingPrototype);
const existingRetained = [...existingBudget.retainedValues()];
const existingSize = existingBudget.currentDataSize;
assert.throws(
  () => restoreInterpreter(intrinsicSnapshot, { source: lowSource, budget: existingBudget }),
  /fresh intrinsic realm budget/
);
assert.equal(resolveIntrinsicIdentity(existingBudget, '["Number","prototype"]'), existingPrototype);
assert.deepEqual(Object.getOwnPropertyDescriptors(existingPrototype), existingDescriptors);
assert.deepEqual([...existingBudget.retainedValues()], existingRetained);
assert.equal(existingBudget.currentDataSize, existingSize);

const ordinarySource = "return 11";
const ordinaryRuntime = await run(ordinarySource);
assert.throws(
  () => restore({ ...ordinaryRuntime.snapshot }, { source: ordinarySource }),
  (error) => error.code === "invalidType"
);
const intrinsicSource = "Number.prototype.extra=23;await 0;return (1).extra";
const intrinsicRuntime = await run(intrinsicSource);
assert.equal(intrinsicRuntime.returnValue, 23);
assert.throws(
  () => restore({ ...intrinsicRuntime.snapshot }, { source: intrinsicSource }),
  (error) => error.code === "invalidState"
);
assert.equal((await run(intrinsicSource, { snapshot: intrinsicRuntime.snapshot })).returnValue, 23);

for (const key of ["version", "sourceHash", "clock", "random", "promiseReplay", "extra"]) {
  const candidate = await run("return 7;");
  let invoked = 0;
  const descriptor = Object.getOwnPropertyDescriptor(candidate.snapshot, key);
  Object.defineProperty(candidate.snapshot, key, { configurable: true, enumerable: true,
    get() { invoked++; return descriptor?.value; } });
  assert.throws(() => restore(candidate.snapshot, { source: "return 7;" }),
    error => error.name === "SnapshotValidationError" && error.code === "invalidType");
  await assert.rejects(run("return 7;", { snapshot: candidate.snapshot }),
    error => error.name === "SnapshotValidationError" && error.code === "invalidType");
  assert.equal(invoked, 0);
}

for (const enumerable of [true, false]) {
  const candidate = await run("return 7;");
  let invoked = 0;
  candidate.snapshot.extra = Object.defineProperty({}, "value", {
    enumerable, get() { invoked++; return 7; }
  });
  assert.throws(() => restore(candidate.snapshot, {source: "return 7;"}),
    error => error.name === "SnapshotValidationError" && error.code === "invalidType");
  await assert.rejects(run("return 7;", {snapshot: candidate.snapshot}),
    error => error.name === "SnapshotValidationError" && error.code === "invalidType");
  assert.equal(invoked, 0);
}
{
  const candidate = await run("return 7;");
  const promise = createSandboxPromise(Promise.resolve(1));
  const getter = Object.getOwnPropertyDescriptor(promise, "promise").get;
  let invoked = 0;
  Object.defineProperty(getter, "call", {configurable: true, value() {
    invoked++;
    return Reflect.apply(getter, promise, []);
  }});
  candidate.snapshot.extra = promise;
  try {
    restore(candidate.snapshot, {source: "return 7;"});
    assert.equal(invoked, 0);
  } finally { Reflect.deleteProperty(getter, "call"); }
}

console.log(
  JSON.stringify({
    node: process.version,
    bun: process.versions.bun,
    icu: process.versions.icu,
    checks:
      "getter, graph aliases/cycle, original/checkpoint/replay, unsupported version, host-effect count, deferred publication, retained budget rejection, fallback getter safety, Promise tables and registrations, intrinsic rollback and retry, existing realm preservation, runtime wrapper classification",
    passed: true
  })
);
```

For the maintained mutation corpus, bundle
`packages/safe-js/test/adversarial/snapshot-mutation.ts` using esbuild with
`bundle:true, format:'esm', platform:'node', external:['node:*']`. Import the
bundle and `await runSnapshotMutationCorpus()` on each runtime above. The source
keeps seed `0x5a902026`, 96 cases and the 750 ms bound unchanged. No optional slow
profile was enabled.

Workerd uses 1.20260901.1, compatibility date 2026-09-01 and `nodejs_compat`.
Bundle with the additional `conditions:['workerd']`; import run/restore/dump
from their individual built implementation modules and export an async fetch
handler wrapping the same assertions. Send one local HTTP request and inspect
the JSON result. Repeat with the maintained mutation corpus in a separate
handler. The Node SDK index bundle attempt failed on `#safe-fs-native-seek`;
using the individual runtime modules avoids the Node-only filesystem adapter.
This does not qualify the Node SDK index as a Workerd package export.

Workerd reports no ICU/V8 version through `process.versions`. Its within-request
clock is not a portable wall-time measurement; its corpus result qualifies
semantic assertions, not a 750 ms elapsed-time guarantee on Workerd.

## Genuine legacy fixture probe

Run this code on the same Node/Bun cells. It uses the repository's genuine
v6/v7 fixture bytes without changing source, version or journal markers. The
expected JSON values are compared exactly; guest object roots must retain null
prototypes. Two replay/dump/restore cycles preserve all recorded journals and
never execute replacement host operations. Reusing one capability for two
distinct operations is an explicit negative control on the fixture that actually
calls both operations.

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run, restore, declareHostOperation, dump } from "./packages/safe-js/dist/index.js";
const v6 = JSON.parse(
  readFileSync("packages/safe-js/test/fixtures/public-promise-v6.json", "utf8")
);
const v7 = JSON.parse(
  readFileSync("packages/safe-js/test/fixtures/public-promise-alias-v7.json", "utf8")
);

let hostCalls = 0;
const forbidden = () => {
  hostCalls++;
  throw Error("legacy replay executed a host callback");
};
const bindings = {
  boundary: declareHostOperation(forbidden, "re-issue"),
  readValue: declareHostOperation(() => {
    hostCalls++;
    throw Error("legacy readValue executed");
  }, "re-issue")
};
for (const fixture of [
  ...v6.cases.map((f) => ({ ...f, snapshot: f.completed, expected: { value: 7 } })),
  ...v7
]) {
  const before = JSON.stringify(fixture.snapshot);
  let snapshot = restore(fixture.snapshot, { source: fixture.source });
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = await run(fixture.source, {
      snapshot,
      bindings,
      hostCallResumeProvider: forbidden
    });
    assert.equal(result.ok, true);
    assert.equal(Object.getPrototypeOf(result.returnValue), null);
    assert.equal(JSON.stringify(result.returnValue), JSON.stringify(fixture.expected));
    assert.equal(result.snapshot.executionSemantics, fixture.snapshot.executionSemantics);
    assert.deepEqual(result.snapshot.promiseReplay, fixture.snapshot.promiseReplay);
    assert.deepEqual(result.snapshot.replay, fixture.snapshot.replay);
    assert.deepEqual(result.snapshot.initialInputs, fixture.snapshot.initialInputs);
    snapshot = restore(JSON.parse(await dump(result)), { source: fixture.source });
  }
  assert.equal(JSON.stringify(fixture.snapshot), before);
}
assert.equal(hostCalls, 0);

const aliasFixture = v6.cases.find((fixture) => fixture.name === "host");
await assert.rejects(
  run(aliasFixture.source, {
    snapshot: restore(aliasFixture.completed, { source: aliasFixture.source }),
    bindings: {
      boundary: declareHostOperation(forbidden, "re-issue"),
      readValue: declareHostOperation(forbidden, "re-issue")
    }
  }),
  (error) => error.name === "HostCallResumabilityError" && error.action === "reset"
);
assert.equal(hostCalls, 0);
console.log(
  JSON.stringify({
    node: process.version,
    bun: process.versions.bun,
    icu: process.versions.icu,
    fixtures: 6,
    replays: 12,
    hostCalls,
    aliasedAuthorityRejected: true,
    passed: true
  })
);
```

For Workerd, replace the filesystem reads with bundled JSON imports of the same
fixture files, use the individual built run/restore/dump/host-bridge modules, and
wrap the assertions in an async fetch handler as above. Do not give the guest
filesystem access.
