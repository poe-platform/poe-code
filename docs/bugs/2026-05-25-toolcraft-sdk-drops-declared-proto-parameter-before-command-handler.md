# Toolcraft SDK Drops a Declared `__proto__` Parameter Before the Command Handler

## Summary

The public `toolcraft/sdk` `createSDK()` API accepts a call for a command schema that declares a `__proto__` parameter, but silently loses the accepted value before invoking the command handler. The SDK exposes the normalized input member as `proto`, then maps it back to `__proto__` while copying into an ordinary validation-result object.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { createSDK } from "./sdk.js";

describe("toolcraft SDK prototype-key parameter repro", () => {
  it("drops a declared __proto__ SDK parameter before invoking the handler", async () => {
    const handler = vi.fn(async ({ params }) => ({ hasProto: Object.hasOwn(params, "__proto__") }));
    const shape = Object.fromEntries([["__proto__", S.String()]]) as Record<string, ReturnType<typeof S.String>>;
    const sdk = createSDK(
      defineGroup({
        name: "root",
        children: [defineCommand({ name: "probe", scope: ["sdk"], params: S.Object(shape), handler })]
      })
    ) as { probe(params: Record<string, unknown>): Promise<unknown> };

    await sdk.probe({ proto: "visible" });

    const params = handler.mock.calls[0]?.[0].params as Record<string, unknown>;
    expect(params).toEqual({});
    expect(Object.hasOwn(params, "__proto__")).toBe(false);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the accepted SDK call reaches the command handler without its schema-declared parameter. Remove the disposable probe after validation.

## Observed Behavior

For an SDK-scoped command whose schema shape owns `__proto__: S.String()`, `createSDK()` exposes and accepts the normalized call argument `{ proto: "visible" }`. The command handler nevertheless receives `params` equal to `{}` with no own `__proto__` property. In `packages/toolcraft/src/sdk.ts`, `validateObjectSchema()` records normalized input keys alongside their original schema keys, then writes each validated input into `result = {}` through `result[outputKey] = ...`; mapping accepted `proto` back to `outputKey === "__proto__"` fails to preserve the data field before handler dispatch.

## Expected Behavior

Toolcraft SDK invocation should preserve every accepted schema-declared argument through handler dispatch, including a declaration named `__proto__`, or reject such schemas at definition time instead of exposing an SDK argument that is silently omitted.

## Impact

SDK consumers can successfully invoke a command with an accepted argument and receive normal handler execution even though the value never reaches command logic. This causes incorrect command behavior and undermines validation guarantees for applications built on Toolcraft's direct SDK interface.
