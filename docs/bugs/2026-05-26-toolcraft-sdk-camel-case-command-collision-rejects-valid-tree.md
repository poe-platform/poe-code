# Toolcraft SDK camel case command collision rejects valid tree

## Summary

The public `toolcraft/sdk` `createSDK()` adapter rejects a valid command tree when distinct SDK-scoped command names normalize to the same camel-case member. A root containing `runTask` and `run_task` cannot be exposed through the SDK because construction throws `Duplicate SDK member "runTask".` instead of retaining both operations or reporting an earlier schema compatibility constraint.

## Reproduction

Create the disposable probe `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";

import { defineCommand, defineGroup } from "./index.js";
import { createSDK } from "./sdk.js";

describe("SDK command camel-case collision", () => {
  it("rejects a valid tree with distinct commands sharing one SDK member name", () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "runTask",
          scope: ["sdk"],
          params: S.Object({}),
          async handler() {
            return "camel";
          }
        }),
        defineCommand({
          name: "run_task",
          scope: ["sdk"],
          params: S.Object({}),
          async handler() {
            return "snake";
          }
        })
      ]
    });

    expect(() => createSDK(root)).toThrow('Duplicate SDK member "runTask".');
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
✓ packages/toolcraft/src/__probe__.test.ts > SDK command camel-case collision > rejects a valid tree with distinct commands sharing one SDK member name
```

`formatSegment()` produces camel-case SDK names at `packages/toolcraft/src/sdk.ts:271` through `packages/toolcraft/src/sdk.ts:275`, making both `runTask` and `run_task` become `runTask`. The tree builder assigns exported child members through `defineMember()` at `packages/toolcraft/src/sdk.ts:497` through `packages/toolcraft/src/sdk.ts:508` and `packages/toolcraft/src/sdk.ts:605` through `packages/toolcraft/src/sdk.ts:625`; when the second otherwise valid command is encountered, `createSDK()` throws `Duplicate SDK member "runTask".` and exposes no usable SDK object.

## Expected Behavior

SDK construction should either reject conflicting command names as part of explicit command-definition validation, with a clear compatibility diagnostic before runtime adapter creation, or use an unambiguous member mapping that preserves both commands. Valid declared operations must not make SDK creation unexpectedly unusable solely because of lossy name conversion.

## Impact

Projects exposing existing API command trees through Toolcraft cannot represent operations whose source names differ only by underscore versus camel-case spelling. Adding one such command can break creation of the entire SDK surface at runtime, preventing access to unrelated sibling commands and surfacing only a late adapter error.
