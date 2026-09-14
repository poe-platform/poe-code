# Callback export recovery manual QA

Run after the maintained build and package checks. Repeat from an isolated npm
consumer for each actual published SafeJS entry. Set
`SAFEJS_QUALIFICATION_ENTRY` to the built index file URL, `poe-code/safejs`, or
`@poe-platform/safe-js`, then execute the following module with
`node --input-type=module` (and Bun where independently available). No local
publication is involved.

1. Verify original execution observes the acknowledged host write.
2. Verify completed capture/restore rejects before repeating the receiver.
3. Verify confined waitAsync/notify execution and replay agree.
4. Record the package version, publication provenance and module entry alongside
   stdout and process exit status. A source checkout is not an installed artifact.

```js
import assert from "node:assert/strict";
const entry = process.env.SAFEJS_QUALIFICATION_ENTRY;
const { run, dump } = await import(entry);
const source = "const b=new SharedArrayBuffer(4);await receive(()=>b);return new Uint8Array(b)[0]";
let calls = 0;
const bindings = {
  receive: async (callback) => {
    calls++;
    const buffer = await callback();
    new Uint8Array(buffer)[0] = 7;
  }
};
const original = await run(source, { bindings });
assert.equal(original.ok, true);
assert.equal(original.returnValue, 7);
assert.match(original.snapshot.replayError, /Shared storage exported by a guest callback/);
await assert.rejects(dump(original), /Shared storage exported by a guest callback/);
await assert.rejects(
  run(source, { bindings, snapshot: original.snapshot }),
  /Shared storage exported by a guest callback/
);
assert.equal(calls, 1);
const confined =
  "const a=new Int32Array(new SharedArrayBuffer(4));const w=Atomics.waitAsync(a,0,0);const n=Atomics.notify(a,0);return [n,await w.value]";
const first = await run(confined);
assert.deepEqual(first.returnValue, [1, "ok"]);
const replay = await run(confined, { snapshot: JSON.parse(await dump(first)) });
assert.deepEqual(replay.returnValue, [1, "ok"]);
console.log(
  JSON.stringify({
    entry,
    node: process.versions.node,
    icu: process.versions.icu,
    original: original.returnValue,
    receiverCalls: calls,
    confined: first.returnValue,
    confinedReplay: replay.returnValue,
    rejected: true
  })
);
```

This qualifies the explicit callback capture exclusion and the confined control.
It does not qualify raw argument aliases, legacy unmarked snapshots, an external
agent cluster, unsupported native growth, or an arbitrary concurrent history.
