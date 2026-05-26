# Toolcraft SDK camel case parameter collision drops declared input

## Summary

The public `toolcraft/sdk` `createSDK()` adapter silently collapses distinct command parameters that normalize to the same camel-case SDK key. A command declaring both `fooBar` and `foo_bar` accepts one `fooBar` argument and successfully invokes its handler with only `foo_bar`, omitting the other required source parameter without reporting validation failure.

## Reproduction

Create the disposable probe `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";

import { defineCommand, defineGroup } from "./index.js";
import { createSDK } from "./sdk.js";

describe("SDK parameter camel-case collision", () => {
  it("accepts one normalized input while omitting a declared required field", async () => {
    const observed: unknown[] = [];
    const sdk = createSDK(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "submit",
            scope: ["sdk"],
            params: S.Object({
              fooBar: S.String(),
              foo_bar: S.String()
            }),
            async handler({ params }) {
              observed.push(params);
              return params;
            }
          })
        ]
      })
    ) as { submit(params: { fooBar: string }): Promise<unknown> };

    await expect(sdk.submit({ fooBar: "only-one-value" })).resolves.toEqual({
      foo_bar: "only-one-value"
    });
    expect(observed).toEqual([{ foo_bar: "only-one-value" }]);
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
rm -f packages/toolcraft/src/__probe__.test.ts
```

## Observed Behavior

The probe passes:

```text
✓ packages/toolcraft/src/__probe__.test.ts > SDK parameter camel-case collision > accepts one normalized input while omitting a declared required field
```

`formatSegment()` converts source names into camel-case SDK members at `packages/toolcraft/src/sdk.ts:271` through `packages/toolcraft/src/sdk.ts:275`. During argument validation, `validateObjectSchema()` inserts both source fields into a `Map` keyed by that normalized name at `packages/toolcraft/src/sdk.ts:432` through `packages/toolcraft/src/sdk.ts:484`; the later `foo_bar` declaration replaces `fooBar` at key `fooBar`. Invocation then validates and dispatches the surviving mapped object through `packages/toolcraft/src/sdk.ts:545` through `packages/toolcraft/src/sdk.ts:627`, so the handler receives `{ foo_bar: "only-one-value" }` while the declared required `fooBar` field is never checked.

## Expected Behavior

SDK construction or invocation should reject schemas whose camel-case API representation creates duplicate parameter keys, or use an unambiguous mapping preserving each declared field. A required source parameter must not vanish from validation and handler dispatch under a successful SDK call.

## Impact

SDK consumers wrapping existing APIs can execute operations with missing required payload data when source field names differ only by underscore versus camel casing. Calls succeed with an apparently valid typed SDK input while handler logic receives an incomplete object, potentially triggering incorrect defaults or unintended operations.
