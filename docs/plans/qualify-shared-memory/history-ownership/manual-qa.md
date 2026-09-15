# Shared history ownership manual QA

Execute from the repository root with `node --import tsx --input-type=module`.
No worker blocks the host event loop. Worker startup is acknowledged before guest
execution. After save returns, the guest signals the worker, waits for an atomic
publication marker, then reads the data. Only the isolated worker may block.
The host resets all three words before capturing the pending call boundary. Compare
only journals, normalizing random run IDs; do not claim identical complete heaps.
Terminate each worker in `finally`, even when an assertion fails.

```js
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { run } from "./packages/safe-js/src/run.ts";
import { dump } from "./packages/safe-js/src/dump.ts";
import { declareHostOperation } from "./packages/safe-js/src/interp/host-bridge.ts";
console.log(JSON.stringify({ versions: process.versions }));
const histories = [];
const source = `const a=new Int32Array(new SharedArrayBuffer(12));save(a.buffer);
  Atomics.store(a,2,1);Atomics.notify(a,2);
  while(Atomics.load(a,1)===0) await Promise.resolve();
  const observed=Atomics.load(a,0);await hold();return observed`;
for (const transient of [false, true]) {
  const worker = new Worker(
    `const {parentPort}=require('node:worker_threads');
    parentPort.on('message',({buffer,transient})=>{
      const a=new Int32Array(buffer);
      Atomics.wait(a,2,0);
      Atomics.store(a,0,transient?7:0);Atomics.store(a,1,1);
    });parentPort.postMessage('ready');`,
    { eval: true, execArgv: [] }
  );
  let release, enter, retained;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    enter = resolve;
  });
  let running;
  try {
    assert.deepEqual(await once(worker, "message"), ["ready"]);
    running = run(source, {
      bindings: {
        save: (buffer) => {
          retained = buffer;
          worker.postMessage({ buffer, transient });
        },
        hold: declareHostOperation(async () => {
          const a = new Int32Array(retained);
          Atomics.store(a, 0, 0);
          Atomics.store(a, 1, 0);
          Atomics.store(a, 2, 0);
          enter();
          await gate;
        }, "re-issue")
      }
    });
    await Promise.race([
      ready,
      running.then((result) => {
        throw new Error(JSON.stringify(result));
      })
    ]);
    const snapshot = JSON.parse(await dump(running, { mode: "replay" }));
    release();
    const original = await running;
    assert.equal(original.ok, true);
    assert.equal(original.returnValue, transient ? 7 : 0);
    const journal = structuredClone(snapshot.replay);
    for (const call of journal.calls) {
      call.runId = "RUN";
      call.id = "RUN:" + call.id.slice(call.id.lastIndexOf(":") + 1);
    }
    histories.push(journal);
    console.log(
      JSON.stringify({
        transient,
        observed: original.returnValue,
        finalWords: Array.from(new Int32Array(retained)),
        replayError: snapshot.replayError ?? null,
        journal
      })
    );
  } finally {
    release();
    await worker.terminate();
    if (running) await running;
  }
}
assert.deepEqual(histories[0], histories[1]);
console.log(JSON.stringify({ identicalBoundaryJournals: true, distinctObservations: true }));
```

This is an impossibility witness, not a passing recovery acceptance test. It does
not replay the publication spin: replay has no recorded worker and may exhaust a
budget. It establishes that neither the boundary journal nor unchanged boundary
bytes establishes the intervening read history. The earlier queueMicrotask
schedule in `../agent-refresh/reproductions.md` separately tests actual pending
and completed replay, including the incorrect subsequent effect. Execute its
first module unchanged and retain all original/replayed observations.
