# Process runner mock runner default completion resolves before configured output

## Summary

The exported `@poe-code/process-runner/testing` helper `createMockRunner()` resolves its `result` promise immediately by default, even when the configured mock behavior still has piped `stdout` or `stderr` lines scheduled for later delivery. Consumers that await the mock command's completion can therefore observe a completed process before its declared output has been emitted.

## Reproduction

Create a disposable probe at `packages/process-runner/src/__probe__.test.ts`:

```ts
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { createMockRunner } from "./testing/mock-runner.js";

describe("process-runner default mock output timing", () => {
  it("resolves completion before configured stdout has been emitted", async () => {
    const handle = createMockRunner([{ exitCode: 0, stdout: ["late-output"] }]).exec({
      command: "demo",
      stdout: "pipe"
    });
    const chunks: string[] = [];
    handle.stdout?.setEncoding("utf8");
    handle.stdout?.on("data", (chunk: string) => chunks.push(chunk));

    await handle.result;
    expect(chunks).toEqual([]);

    await once(handle.stdout!, "end");
    expect(chunks).toEqual(["late-output"]);
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/process-runner/src/__probe__.test.ts --reporter verbose
rm -f packages/process-runner/src/__probe__.test.ts
```

The probe passes, confirming that the default mock result settles before its configured output is delivered:

```text
✓ packages/process-runner/src/__probe__.test.ts > process-runner default mock output timing > resolves completion before configured stdout has been emitted
```

## Observed Behavior

`createMockRunner()` is publicly exported at `packages/process-runner/src/index.ts:10`, with output and timing configuration exposed through `MockRunBehavior` at `packages/process-runner/src/types.ts:178` through `packages/process-runner/src/types.ts:185`. `createRunHandle()` schedules configured streams through `createReadableStream()` at `packages/process-runner/src/testing/mock-runner.ts:44` through `packages/process-runner/src/testing/mock-runner.ts:51`, which emits non-empty output only after `setTimeout()` intervals at `packages/process-runner/src/testing/mock-runner.ts:121` through `packages/process-runner/src/testing/mock-runner.ts:130`. However, if `exitAfterMs` is omitted, the same run handle resolves `result` via `queueMicrotask(complete)` at `packages/process-runner/src/testing/mock-runner.ts:73` through `packages/process-runner/src/testing/mock-runner.ts:77`, before the output timer fires.

## Expected Behavior

For mock behaviors that declare piped output, command completion should not resolve before all configured output streams have emitted and ended unless the configured behavior explicitly models early process exit or truncation. Omitting `exitAfterMs` should provide a coherent default completed command, not a completed result followed by future process output.

## Impact

Tests and SDK consumers using the exported mock runner can await a successful command result and then incorrectly conclude that no output was produced, even though configured lines arrive afterward. This can hide log-processing defects, create timing-dependent assertions, and make simulations diverge from normal process completion semantics where remaining piped output is drained before consumers treat execution as fully observed.
