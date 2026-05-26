# SDK `runPipelineInit` Final Source Abort Resolves as Done

## Summary

The public SDK `runPipelineInit()` does not re-check cancellation after its final source initializer resolves successfully. If the last agent invocation aborts the supplied signal while returning exit code `0`, the initializer returns `stopReason: "done"` even though cancellation occurred during active work.

## Reproduction

Create a disposable Vitest probe at `src/sdk/__probe__.test.ts`:

```ts
import { vol } from "memfs";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});
vi.mock("./spawn.js", () => ({ spawn: { autonomous: vi.fn() } }));

import { runPipelineInit } from "./pipeline.js";

describe("SDK pipeline init final-source cancellation", () => {
  it("returns done after the final initializer aborts the signal and resolves successfully", async () => {
    vol.reset();
    vol.fromJSON({ "/repo/source.md": "# Source\n" }, "/");
    const controller = new AbortController();

    const result = await runPipelineInit({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      assumeYes: true,
      sources: [{ absolutePath: "/repo/source.md", relativePath: "source.md", title: "Source" }],
      signal: controller.signal,
      runAgent: vi.fn(async () => {
        controller.abort();
        return { stdout: "done", stderr: "", exitCode: 0 };
      })
    });

    expect(controller.signal.aborted).toBe(true);
    expect(result).toEqual({ stopReason: "done", sourcesProcessed: 1 });
  });
});
```

Run:

```sh
npm exec -- vitest run src/sdk/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ src/sdk/__probe__.test.ts > SDK pipeline init final-source cancellation > returns done after the final initializer aborts the signal and resolves successfully
```

## Observed Behavior

`runPipelineInit()` checks `options.signal?.aborted` before each source and after reading source content at `src/sdk/pipeline.ts:171` through `src/sdk/pipeline.ts:202`. It then awaits `runAgent()` at `src/sdk/pipeline.ts:207` through `src/sdk/pipeline.ts:215`, calls source completion, checks only `result.exitCode`, and increments `sourcesProcessed` at `src/sdk/pipeline.ts:217` through `src/sdk/pipeline.ts:227`. When that was the final source, execution falls through directly to the `"done"` result at `src/sdk/pipeline.ts:244` through `src/sdk/pipeline.ts:247` without consulting the now-aborted signal. The reproduction receives `done` while its controller is already aborted.

## Expected Behavior

Cancellation occurring during the final source initialization should be checked after the agent returns and surfaced as `stopReason: "cancelled"`, or the API should explicitly define final success as overriding cancellation. It should not silently report an uninterrupted done outcome after an in-flight cancellation request.

## Impact

CLI cancel controls and SDK callers can request termination during the final generated plan edit yet receive a successful initialization status. This misreports lifecycle state, obscures cancellation telemetry, and may cause downstream automation to proceed as though initialization completed without interruption.
