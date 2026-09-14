# Delivered atomic wait manual QA

Source `d63d1f4bb81b4514d873090b970b796bb15be702`. Run the selected workspace build,
then execute this module on stdin using each command in `built-rollback.json`.
The comparison-load injection is after the first acknowledged native registration.
No sleeps or timing assertions are used. Original waiters and the external owner
must survive; the restored queue must be empty before rejection.

```js
import assert from "node:assert/strict";
import { Budget } from "./packages/safe-js/dist/interp/budget.js";
import { createAtomicsGlobal } from "./packages/safe-js/dist/interp/globals/atomics.js";
import { runResources, withRunResources } from "./packages/safe-js/dist/interp/resources.js";
import { createSharedArrayBufferStorage } from "./packages/safe-js/dist/interp/shared-array-buffer.js";
import { serialize } from "./packages/safe-js/dist/snapshot/serialize.js";
import { restore } from "./packages/safe-js/dist/snapshot/restore.js";
console.log(JSON.stringify({ versions: process.versions }));
for (const bigint of [false, true]) {
  await withRunResources(undefined, async () => {
    const budget = new Budget();
    const buffer = createSharedArrayBufferStorage(16, undefined, budget);
    const view = bigint ? new BigInt64Array(buffer) : new Int32Array(buffer);
    const waitAsync = createAtomicsGlobal(budget).waitAsync;
    const first = await waitAsync.call([view, 0, bigint ? 0n : 0]);
    const second = await waitAsync.call([view, 1, bigint ? 0n : 0]);
    const source = "return 0";
    const restored = restore(
      serialize({
        source,
        currentAstNodeId: 1,
        scopeChain: [{ id: "external", bindings: { view, second, first } }],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {}
      }),
      { source }
    );
    const target = restored.currentScope.lookup("view").value;
    const originalLoad = Atomics.load;
    const failure = new Error("controlled second activation failure");
    let intercepted = 0;
    Atomics.load = function (array, index) {
      if (array === target && index === 1) {
        intercepted++;
        throw failure;
      }
      return Reflect.apply(originalLoad, Atomics, [array, index]);
    };
    try {
      await assert.rejects(restored.activateAtomicWaits(), (e) => e === failure);
    } finally {
      Atomics.load = originalLoad;
    }
    assert.equal(intercepted, 1);
    assert.equal(runResources.getStore().signal.aborted, false);
    const residual = [Atomics.notify(target, 0), Atomics.notify(target, 1)];
    const original = [Atomics.notify(view, 0), Atomics.notify(view, 1)];
    assert.deepEqual(residual, [0, 0]);
    assert.deepEqual(original, [1, 1]);
    await assert.rejects(restored.activateAtomicWaits(), (e) => e === failure);
    console.log(JSON.stringify({ bigint, residual, original, ownerLive: true }));
  });
}
```

## Integer operations and shared growth

Execute this second module using the commands in `built-operations.json`.
An unavailable growth cell remains a semantic nonpass.

```js
import assert from "node:assert/strict";
import { run } from "./packages/safe-js/dist/run.js";
import { dump } from "./packages/safe-js/dist/dump.js";
console.log(JSON.stringify({ versions: process.versions }));
for (const type of [
  "Int8Array",
  "Uint8Array",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "BigInt64Array",
  "BigUint64Array"
]) {
  const big = type.startsWith("Big");
  const initial = big ? "18446744073709551615n" : "4294967295";
  const operand = big ? "257n" : "257";
  const source = `const a=new ${type}(new SharedArrayBuffer(16));const results=[];
    for(const name of ['store','load','add','sub','and','or','xor','exchange','compareExchange']) {
      a[0]=${initial};const expected=a[0];
      const value=name==='compareExchange'?Atomics[name](a,0,expected,${operand}):Atomics[name](a,0,${operand});
      results.push([name,String(value),String(a[0])]);
    }return results`;
  const expected = Function(source)();
  const original = await run(source);
  assert.equal(original.ok, true);
  assert.deepEqual(original.returnValue, expected);
  const replay = await run(source, { snapshot: JSON.parse(await dump(original)) });
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.returnValue, expected);
  console.log(JSON.stringify({ type, operations: 9, original: true, completedReplay: true }));
}
const source =
  "const b=new SharedArrayBuffer(4,{maxByteLength:8});const tracking=new Uint8Array(b);const fixed=new Uint8Array(b,0,4);const before=tracking.length;b.grow(8);tracking[7]=7;return [before,b.byteLength,fixed.length,tracking.length,tracking[7]]";
let growth, growthFailure, growthReplay;
try {
  growth = await run(source);
} catch (error) {
  growthFailure = { name: error.name, message: error.message };
}
if (growth?.ok) {
  assert.deepEqual(growth.returnValue, [4, 8, 4, 8, 7]);
  growthReplay = await run(source, { snapshot: JSON.parse(await dump(growth)) });
  assert.equal(growthReplay.ok, true);
  assert.deepEqual(growthReplay.returnValue, [4, 8, 4, 8, 7]);
}
console.log(
  JSON.stringify({
    growth: growth?.returnValue ?? null,
    growthFailure,
    completedGrowthReplay: growthReplay?.returnValue ?? null
  })
);
const controls = await run(`const a=new Int32Array(new SharedArrayBuffer(4));
  let blocked;try{Atomics.wait(a,0,0,0)}catch(e){blocked=e.name}
  return [Atomics.waitAsync(a,0,1).value,Atomics.waitAsync(a,0,0,0).value,blocked,
    Atomics.notify(new Int32Array(4),0)]`);
assert.equal(controls.ok, true);
assert.deepEqual(controls.returnValue, ["not-equal", "timed-out", "TypeError", 0]);
console.log(JSON.stringify({ controls: controls.returnValue }));
if (growthFailure || !growth?.ok) process.exitCode = 1;
```
