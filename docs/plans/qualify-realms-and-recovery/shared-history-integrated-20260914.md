# Shared-history recovery witness — integrated transport source

This is manual QA, not a passing conformance test. Build the selected SafeJS
workspace, set `SAFEJS_QUALIFICATION_ENTRY=./packages/safe-js/dist/index.js`, and
execute the JavaScript below as stdin to `node --input-type=module` from the
repository root. Only the three named host capabilities are granted. No timeout
or budget is overridden. Process exit0 means observation completed; compare
all values and effects before deciding acceptance.

On `5ad2344edc13cd11508cb0b4cee1828c8b9e2c26` plus the integrated jobs-v9
transport repair, Node22.23.2/ICU78.2:

| Host write  | Original | Pending replay | Completed replay                            | Effects with effect enabled |
| ----------- | -------: | -------------: | ------------------------------------------- | --------------------------- |
| Synchronous |        7 |              7 | 7                                           | [7,7]                       |
| Queued      |        7 |              0 | 0 without effect; late mismatch with effect | [7,0]                       |

Both captured histories have `replayError: null`. Recovery of the queued history
is accepted before the incorrect pending effect. This is the unresolved
SM-REPLAY-1/2 admission/history defect, not a missing ECMAScript capability by
design. Neither graph coverage nor prose exclusions establish capture ownership.
Require faithful supported recovery or rejection before resumed effects; do not
weaken the expectation to accept zero or a late mismatch.

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
