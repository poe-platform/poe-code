# Config Extends Merge Cyclic Data Layer Overflows Call Stack

## Summary

The exported `mergeLayers()` API accepts in-memory `DataLayer` objects, but recursively merges nested plain objects without detecting cycles. Supplying a data layer containing a self-referential plain object causes the merge operation to recurse until it throws a native maximum call stack error.

## Reproduction

Create the disposable probe `packages/config-extends/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeLayers } from "./merge.js";

describe("mergeLayers cyclic public data input", () => {
  it("overflows recursion for a cyclic object layer", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => mergeLayers([{ source: "runtime", data: { config: cyclic } }]))
      .toThrowError(/call stack|recursion/i);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/config-extends/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming the public merge API ends in a native recursion failure for cyclic layer data. Remove the disposable probe after running it.

## Observed Behavior

`mergeLayers([{ source: "runtime", data: { config: cyclic } }])` throws a native maximum call stack or recursion error when `cyclic.self === cyclic`. `mergeLayers()` enters `mergeObjectLayers()` at `packages/config-extends/src/merge.ts:8` through `packages/config-extends/src/merge.ts:25`; each plain-object winner causes another `mergeObjectLayers()` invocation at `packages/config-extends/src/merge.ts:65` through `packages/config-extends/src/merge.ts:77`, with no visited-object tracking or cycle rejection.

## Expected Behavior

The in-memory layer merge API should reject cyclic values with a controlled configuration/data error, or otherwise support them without unbounded recursion. Public SDK input should not cause an incidental native stack overflow.

## Impact

SDK callers can construct data layers programmatically from runtime configuration, shared object graphs, or transformed inputs that contain cycles. One cyclic object can crash configuration resolution instead of yielding an actionable error, preventing prompt or agent configuration generation and making the source of failure difficult to diagnose.
