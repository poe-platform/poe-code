---
name: "Agent Script catch object rest converts proto property into inherited state"
---

# Agent Script catch object rest converts proto property into inherited state

## Summary

The exported `@poe-code/agent-script` `run()` API supports object rest bindings in `catch` clauses and also supports sandbox objects with an own enumerable `__proto__` data property. When a thrown object carrying that property is caught with `{ ...rest }`, the runtime copies it through bracket assignment into a normal object, losing the own property and exposing its nested values through the rest object's prototype instead.

## Reproduction

From the repository root, run this disposable Vitest probe:

```sh
cat > packages/agent-script/src/__probe__.test.ts <<'TEST'
import { describe, expect, it } from "vitest";
import { run } from "./run.js";

describe("agent-script catch rest proto key", () => {
  it("drops a thrown own __proto__ field while binding object rest", async () => {
    const result = await run(
      [
        "try {",
        '  throw Object.fromEntries([["kept", 1], ["__proto__", { injected: true }]]);',
        "} catch ({ kept, ...rest }) {",
        "  return JSON.stringify(Array.of(kept, Object.keys(rest), rest.injected));",
        "}"
      ].join("\n")
    );

    console.log(JSON.stringify(result.returnValue));
    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify([1, [], true])
    });
  });
});
TEST
npm exec -- vitest run packages/agent-script/src/__probe__.test.ts --reporter verbose
rm packages/agent-script/src/__probe__.test.ts
```

The probe passes and prints:

```text
"[1,[],true]"
✓ packages/agent-script/src/__probe__.test.ts > agent-script catch rest proto key > drops a thrown own __proto__ field while binding object rest
```

## Observed Behavior

The script creates its thrown object through the supported sandbox `Object.fromEntries()` operation, preserving `__proto__` as an own data property before the throw. During catch binding, `bindObjectPattern()` invokes `copyObjectRest()` for `{ kept, ...rest }` at `packages/agent-script/src/interp/exceptions.ts:613` through `packages/agent-script/src/interp/exceptions.ts:650`. `copyObjectRest()` then allocates `rest` as `{}` and copies each own enumerable source entry with `rest[key] = entryValue` at `packages/agent-script/src/interp/exceptions.ts:714` through `packages/agent-script/src/interp/exceptions.ts:728`. For the source `__proto__` entry, the resulting rest object has no own enumerable keys, while `rest.injected` resolves to `true` through its mutated prototype.

## Expected Behavior

Object rest binding should preserve own enumerable thrown-object properties as own data properties on the bound rest object, or reject unsupported dangerous keys. Catching a supported sandbox object must not convert a `__proto__` data field into inherited state.

## Impact

Agent scripts that catch structured thrown values can silently receive a different data shape from the one thrown: key enumeration loses the submitted field, while property reads expose attacker-controlled inherited members. This can alter error recovery, validation, branch decisions, logging, or policy logic that destructures and inspects caught data.
