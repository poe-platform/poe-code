# Process runner mock runner constructor command uses inherited behavior

## Summary

The exported `@poe-code/process-runner/testing` helper `createMockRunnerByCommand()` accepts a command-behavior map, but performs command lookup through ordinary prototype inheritance. With an empty configuration object, invoking command `"constructor"` obtains `Object.prototype.constructor` as though it were a configured mock behavior and returns a malformed run handle instead of throwing the documented unknown-command error.

## Reproduction

Create a disposable probe at `packages/process-runner/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMockRunnerByCommand } from "./testing/mock-runner.js";

describe("process-runner mock command prototype lookup", () => {
  it("runs an unconfigured constructor command instead of rejecting it", async () => {
    const runner = createMockRunnerByCommand({});
    const handle = runner.exec({ command: "constructor" });
    await expect(handle.result).resolves.toEqual({ exitCode: undefined });
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/process-runner/src/__probe__.test.ts --reporter verbose
rm -f packages/process-runner/src/__probe__.test.ts
```

The probe passes, confirming that an unconfigured inherited command produces a successful-looking result rather than the expected lookup failure:

```text
✓ packages/process-runner/src/__probe__.test.ts > process-runner mock command prototype lookup > runs an unconfigured constructor command instead of rejecting it
```

## Observed Behavior

`createMockRunnerByCommand()` is exported from the package testing entry point and reads configured behavior as `behaviorsByCommand[spec.command]` at `packages/process-runner/src/testing/mock-runner.ts:20` through `packages/process-runner/src/testing/mock-runner.ts:36`. For an ordinary empty object and `spec.command === "constructor"`, that lookup returns the inherited `Object` constructor function rather than `undefined`. `createRunHandle()` then reads missing behavior fields from that function object at `packages/process-runner/src/testing/mock-runner.ts:38` through `packages/process-runner/src/testing/mock-runner.ts:92`, ultimately resolving `{ exitCode: undefined }` instead of throwing `No mock run behavior found for command "constructor"` as it does for ordinary absent names.

## Expected Behavior

Command behavior lookup should consider only own configured entries, or the behavior map should be normalized into a prototype-free structure. Any command not explicitly registered, including `constructor`, must reject with the same unknown-command error.

## Impact

Tests and SDK consumers using the exported mock runner can accidentally accept execution of an unconfigured command and observe an invalid result shape. This can mask missing command fixtures, allow test scenarios to pass without exercising intended behavior, and make simulated execution dependent on JavaScript object prototype names rather than declared mock configuration.
