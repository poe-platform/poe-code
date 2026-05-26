# Toolcraft CLI Drops a Declared `__proto__` Option Before the Command Handler

## Summary

The public `toolcraft/cli` `runCLI()` API exposes an option for a command schema field named `__proto__` and accepts `--proto visible`, but silently drops that supplied value before invoking the command handler. Its CLI parameter resolver reconstructs the declared schema path in an ordinary object by dynamic assignment.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

describe("toolcraft CLI prototype-key parameter repro", () => {
  const originalArgv = process.argv;
  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = undefined;
  });

  it("drops a declared __proto__ CLI parameter before invoking the handler", async () => {
    const handler = vi.fn(async ({ params }) => params);
    const shape = Object.fromEntries([["__proto__", S.String()]]) as Record<string, ReturnType<typeof S.String>>;
    const root = defineGroup({
      name: "toolcraft",
      children: [defineCommand({ name: "probe", scope: ["cli"], params: S.Object(shape), handler })]
    });
    process.argv = ["node", "toolcraft", "probe", "--proto", "visible"];

    await runCLI(root);

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

The probe passes, confirming that the valid CLI invocation runs the handler with an empty parameter object rather than the supplied schema field. Remove the disposable probe after validation.

## Observed Behavior

For a CLI-scoped Toolcraft command whose parameter schema owns `__proto__: S.String()`, `runCLI()` accepts the generated `--proto visible` option and invokes the handler, but `params` is `{}` without an own `__proto__` field. `packages/toolcraft/src/cli.ts` collects schema fields with their original paths, resolves option values, and calls `setNestedValue(params, field.path, value)`; that helper starts from `params = {}` and writes the original `__proto__` leaf via `cursor[leaf] = value`, silently failing to represent the accepted option as an own data field.

## Expected Behavior

Toolcraft CLI dispatch should deliver every accepted schema-backed option to command handlers, including a field declared as `__proto__`, or reject such declarations before exposing an option that cannot be faithfully represented.

## Impact

Command authors can publish a CLI option that users can pass successfully but application logic never receives. Commands may execute with incomplete input while appearing valid, causing incorrect automation results and eroding trust in generated CLI validation and option forwarding.
