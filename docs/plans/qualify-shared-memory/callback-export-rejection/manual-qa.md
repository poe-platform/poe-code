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

## Remaining raw-argument recovery counterexample

With the same entry environment variable, execute the following module separately.
This is an observation of an unresolved defect: synchronous cells should remain
7/7/7, while queued-write cells currently replay 0 and can issue the wrong effect.
Exit 0 means the observations ran, not that recovery acceptance passed.

```js
const { run, dump, declareHostOperation } = await import(process.env.SAFEJS_QUALIFICATION_ENTRY);
for (const withEffect of [false, true])
  for (const outOfBand of [false, true]) {
    const source =
      "const a=new Uint8Array(new SharedArrayBuffer(4));save(a.buffer);await Promise.resolve();const observed=a[0];await hold();" +
      (withEffect ? "effect(observed);" : "") +
      "return observed";
    let entered, release;
    const ready = new Promise((r) => (entered = r)),
      gate = new Promise((r) => (release = r));
    let saves = 0;
    const effects = [];
    const bindings = {
      save: (b) => {
        saves++;
        const write = () => {
          new Uint8Array(b)[0] = 7;
        };
        if (outOfBand) queueMicrotask(write);
        else write();
      },
      hold: declareHostOperation(async () => {
        entered();
        await gate;
      }, "re-issue"),
      effect: (v) => {
        effects.push(v);
      }
    };
    const pending = run(source, { bindings });
    await ready;
    const saved = JSON.parse(await dump(pending, { mode: "replay" }));
    release();
    const original = await pending,
      completed = JSON.parse(await dump(original));
    const replayBindings = { ...bindings, hold: declareHostOperation(async () => {}, "re-issue") };
    const resume = async (snapshot) => {
      try {
        const result = await run(source, { bindings: replayBindings, snapshot });
        return { ok: result.ok, value: result.returnValue };
      } catch (e) {
        return { error: e.name, message: e.message };
      }
    };
    console.log(
      JSON.stringify({
        withEffect,
        outOfBand,
        original: original.returnValue,
        pendingReplay: await resume(saved),
        completedReplay: await resume(completed),
        saves,
        effects,
        replayError: saved.replayError ?? null
      })
    );
  }
```

## Independent scoped filesystem and shell smoke

Install each exact recorded package version into a separate temporary consumer
with `npm install --ignore-scripts --no-audit --no-fund`, then run the applicable
module with `node --input-type=module`. Run the shell module again with
`npm exec --yes --package=bun@1.4.2 -- bun run -`. Run `npm audit signatures`
in each consumer. Register command authority explicitly; a bare Shell has no
`cat` command. MemoryFS is populated through writeFile, not constructor options.

### @poe-platform/safe-fs@0.1.592

```js
import assert from "node:assert/strict";
import { createMemoryFileSystem } from "@poe-platform/safe-fs";
import { createNodeFsBridge } from "@poe-platform/safe-fs/node/filesystem";
assert.equal(typeof createNodeFsBridge, "function");
const fs = createMemoryFileSystem();
await fs.writeFile("/probe", new TextEncoder().encode("verified"));
assert.equal(new TextDecoder().decode(await fs.readFile("/probe")), "verified");
console.log(JSON.stringify({ package: "@poe-platform/safe-fs", memory: true, nodeAdapter: true }));
```

### @poe-platform/safe-bash@0.1.592

```js
import assert from "node:assert/strict";
import { Shell, agentCommands } from "@poe-platform/safe-bash";
import { createMemoryFileSystem } from "@poe-platform/safe-fs";
const fs = createMemoryFileSystem();
await fs.writeFile("/probe", new TextEncoder().encode("verified"));
const shell = new Shell({ fs, cwd: "/" }).use(agentCommands());
try {
  const result = await shell.exec("cat /probe");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "verified");
  console.log(JSON.stringify({ package: "@poe-platform/safe-bash", shell: true, sharedFs: true }));
} finally {
  await shell.dispose();
}
```
