# Toolcraft SDK then command breaks Promise adoption

## Summary

The public `toolcraft/sdk` `createSDK()` API accepts an SDK-scoped root command named `then`, but the returned SDK object is then treated as a JavaScript thenable. Passing that valid SDK through `Promise.resolve(...)`, `await`, or any Promise-returning boundary automatically invokes the declared command with Promise resolver arguments instead of normal command params, causing parameter validation to reject before the caller invokes any tool.

## Reproduction

Create the disposable probe `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("SDK then command Promise adoption", () => {
  it("crashes Promise.resolve for an SDK that declares a valid then command", () => {
    const source = String.raw`
      import { S, defineCommand, defineGroup } from "./packages/toolcraft/src/index.ts";
      import { createSDK } from "./packages/toolcraft/src/sdk.ts";

      const sdk = createSDK(defineGroup({
        name: "root",
        children: [defineCommand({
          name: "then",
          scope: ["sdk"],
          params: S.Object({}),
          async handler() { return "reachable"; }
        })]
      }));

      await Promise.resolve(sdk);
      console.log("resolved");
    `;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", source],
      { cwd: process.cwd(), encoding: "utf8", timeout: 2_000 }
    );

    console.log(result.stderr);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invalid value for "". Expected an object, got undefined.');
    expect(result.stdout).not.toContain("resolved");
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
rm -f packages/toolcraft/src/__probe__.test.ts
```

## Observed Behavior

The probe passes after reproducing a child-process failure. The child exits nonzero and prints:

```text
UserError: Invalid value for "". Expected an object, got undefined.
    at throwValidationErrors (.../packages/toolcraft/src/validation-errors.ts:16:11)
    at validateSDKArguments (.../packages/toolcraft/src/sdk.ts:493:3)
    at Object.output [as then] (.../packages/toolcraft/src/sdk.ts:579:29)
```

`createResolvedSDK()` materializes each SDK command as a direct enumerable object member through `defineMember(output, formatSegment(child.name), ...)` at `packages/toolcraft/src/sdk.ts:605` through `packages/toolcraft/src/sdk.ts:624`, with no reservation or validation for the standard thenable member name `then`. As soon as code performs Promise adoption, JavaScript calls that member as a thenable callback hook with resolver functions rather than an object parameter, and the normal command validation path at `packages/toolcraft/src/sdk.ts:571` through `packages/toolcraft/src/sdk.ts:600` rejects the unexpected invocation.

## Expected Behavior

`createSDK()` should reject SDK trees that would publish a root member named `then` with a clear Toolcraft-owned compatibility error, or expose commands through an object shape that cannot accidentally become a thenable. A valid SDK instance must remain safe to pass through `Promise.resolve(...)` or `await` without dispatching an undeclared command invocation.

## Impact

SDK integrations that generate commands from external APIs can accept an otherwise valid operation named `then` and return an object that crashes common asynchronous composition patterns before callers use it. The failure is especially surprising because simply awaiting a factory result or resolving the SDK through standard Promise utilities triggers tool validation and may also emit error-report side effects for a command the application never intended to run.
