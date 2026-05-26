# Process log writer NaN tail limit returns entire current log

## Summary

The exported `@poe-code/process-launcher` `createLogWriter()` API accepts `Number.NaN` as the `lines` limit for `tail()`. Rather than rejecting an invalid bound or returning no lines, it returns the entire current log file because the resulting `Array.prototype.slice(NaN)` is treated as a zero offset.

## Reproduction

Create a disposable Vitest probe at `packages/process-launcher/src/logs/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createLogWriter } from "./log-writer.js";
import type { LauncherFileSystem } from "../types.js";

describe("process log writer NaN tail limit", () => {
  it("returns every log line instead of rejecting an invalid limit", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({}, "/")).promises as unknown as LauncherFileSystem;
    const writer = createLogWriter("/logs", 3, fs);

    await writer.write("one", "stdout");
    await writer.write("two", "stdout");
    await writer.write("three", "stdout");

    await expect(writer.tail("stdout", Number.NaN)).resolves.toEqual(["one", "two", "three"]);
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/process-launcher/src/logs/__probe__.test.ts --reporter verbose
rm -f packages/process-launcher/src/logs/__probe__.test.ts
```

## Observed Behavior

Passing a non-numeric bound returns every current log line successfully:

```text
✓ packages/process-launcher/src/logs/__probe__.test.ts > process log writer NaN tail limit > returns every log line instead of rejecting an invalid limit
```

The reproduction reads three appended lines through a request whose supplied maximum is `Number.NaN`:

```json
{"requestedLines":"NaN","returned":["one","two","three"]}
```

`tail()` in `packages/process-launcher/src/logs/log-writer.ts` computes `lineCount` with `Math.max(0, Math.trunc(lines))`. For `Number.NaN`, that expression remains `NaN`, so the explicit `lineCount === 0` check does not run. The final `allLines.slice(-lineCount)` becomes `allLines.slice(NaN)`, and JavaScript treats that index as zero, returning every available line.

## Expected Behavior

The log reader should validate that its optional line limit is a finite non-negative integer before loading bounded output, or normalize invalid values to a documented safe result. A malformed limit must not silently expand a bounded tail request into an unbounded read of the current log.

## Impact

Callers that expose `tail()` through APIs, tools, or generated configuration can unexpectedly return substantially more process output than requested when a malformed numeric limit is provided. This increases memory and response sizes, can leak historical command output beyond intended display limits, and masks invalid input as a successful read operation.
