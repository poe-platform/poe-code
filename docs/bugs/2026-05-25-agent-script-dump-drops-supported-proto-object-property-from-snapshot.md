---
name: "Agent Script `dump()` Drops a Supported `__proto__` Object Property from a Snapshot"
---

# Agent Script `dump()` Drops a Supported `__proto__` Object Property from a Snapshot

## Summary

The public Agent Script `dump()` API silently loses an own enumerable `__proto__` property on an interpreter object when serializing a yielded run snapshot. This property is valid interpreter state: the built-in sandbox `Object.fromEntries()` deliberately produces an object owning `__proto__`, but the snapshot dump formatter rewrites object entries into an ordinary object map with bracket assignment.

## Reproduction

Create a disposable Vitest probe at `packages/agent-script/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { dump } from "./dump.js";
import { createSandboxClosure, createSandboxPromise } from "./interp/values.js";
import { run } from "./run.js";

describe("agent-script dump prototype-key repro", () => {
  it("drops an interpreter object own __proto__ property from a snapshot dump", async () => {
    const never = new Promise<never>(() => undefined);
    const result = run(
      [
        `const record = Object.fromEntries(JSON.parse('[["__proto__",1]]'));`,
        "await wait();",
        "return record;"
      ].join("\n"),
      {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(never),
            name: "wait"
          })
        }
      }
    );

    const snapshot = JSON.parse(await dump(result)) as {
      bindings: { record: Record<string, unknown> };
    };

    expect(snapshot.bindings.record).toEqual({});
    expect(Object.hasOwn(snapshot.bindings.record, "__proto__")).toBe(false);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-script/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that `dump()` succeeds but omits the valid interpreter object property from its JSON snapshot. Remove the disposable probe after validation.

## Observed Behavior

An executing script creates `record` through the supported sandbox call `Object.fromEntries([["__proto__", 1]])` and then yields at `await wait()`. Calling public `dump(result)` produces a snapshot whose serialized `bindings.record` is `{}` with no own `__proto__` field. `packages/agent-script/src/snapshot/dump-format.ts` reads own enumerable data descriptors correctly, but `serializeObjectEntries()` constructs `serialized = {}` and stores each read key via `serialized[key] = dumped`, causing `__proto__` to disappear during dump generation.

## Expected Behavior

Snapshot dumping should preserve every serializable sandbox object property that the interpreter supports, including an own enumerable `__proto__` field, so restoring or inspecting a yielded script snapshot reflects the actual interpreter state.

## Impact

Long-running Agent Script executions can checkpoint incomplete state without failing. Scripts that hold data under `__proto__` can resume from a persisted snapshot with different object contents than at the yield point, producing incorrect results or irreversible loss of saved workflow state.
