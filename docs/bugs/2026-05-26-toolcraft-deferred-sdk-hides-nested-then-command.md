# Toolcraft deferred SDK hides nested then command

## Summary

The public `toolcraft/sdk` `createSDK()` adapter silently hides a valid nested SDK command named `then` whenever an unrelated MCP proxy group activates deferred SDK resolution. Without a proxy, `sdk.ops.then` is an exposed callable command; with a proxy anywhere in the root tree, reading the same declared command yields `undefined`, making it impossible to invoke through the SDK.

## Reproduction

Create the disposable probe `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";

import { defineCommand, defineGroup } from "./index.js";
import { createSDK } from "./sdk.js";

function createRoot(includeProxy: boolean) {
  return defineGroup({
    name: "root",
    children: [
      defineGroup({
        name: "ops",
        children: [
          defineCommand({
            name: "then",
            scope: ["sdk"],
            params: S.Object({}),
            async handler() {
              return "reachable";
            }
          })
        ]
      }),
      ...(includeProxy
        ? [
            defineGroup({
              name: "remote",
              scope: ["sdk"],
              mcp: { transport: "stdio" as const, command: "unused" },
              children: []
            })
          ]
        : [])
    ]
  });
}

describe("deferred SDK nested then command", () => {
  it("hides a nested then command only after an unrelated proxy activates deferral", () => {
    const eager = createSDK(createRoot(false)) as {
      ops: { then(params: Record<string, never>): Promise<string> };
    };
    const deferred = createSDK(createRoot(true)) as {
      ops: { then(params: Record<string, never>): Promise<string> };
    };

    console.log(`eager=${typeof eager.ops.then} deferred=${String(deferred.ops.then)}`);
    expect(typeof eager.ops.then).toBe("function");
    expect(deferred.ops.then).toBeUndefined();
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
rm -f packages/toolcraft/src/__probe__.test.ts
```

## Observed Behavior

The probe passes and prints:

```text
eager=function deferred=undefined
✓ packages/toolcraft/src/__probe__.test.ts > deferred SDK nested then command > hides a nested then command only after an unrelated proxy activates deferral
```

`createSDK()` returns the direct object built by `createResolvedSDK()` when no MCP proxy groups exist, and that eager object exposes the nested `ops.then` command normally. When any MCP proxy group is present, it returns the lazy proxy created by `createDeferredSDK()` at `packages/toolcraft/src/sdk.ts:630` through `packages/toolcraft/src/sdk.ts:680`. The proxy `get` trap explicitly returns `undefined` for every property named `then` beneath the root path at `packages/toolcraft/src/sdk.ts:670` through `packages/toolcraft/src/sdk.ts:673`, so the legitimate nested command is hidden before resolution or invocation.

## Expected Behavior

Adding an MCP proxy group should not remove independently declared SDK commands from other groups. Deferred SDK access should preserve callable nested members named `then`, or `createSDK()` should reject incompatible command trees consistently before exposing different SDK surfaces depending on whether a proxy exists.

## Impact

SDK packages combining local commands with remotely discovered MCP tools can silently lose a nested operation named `then` after enabling an otherwise unrelated proxy integration. Code that works against the same static command tree before proxy configuration begins failing with `undefined` member access after proxy configuration, without a schema error or discovery diagnostic explaining that the operation vanished.
