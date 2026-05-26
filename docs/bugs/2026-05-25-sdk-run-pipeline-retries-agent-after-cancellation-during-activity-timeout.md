# SDK `runPipeline` Retries Agent After Cancellation During Activity Timeout

## Summary

The public SDK `runPipeline()` retries pipeline agent invocations after `ActivityTimeoutError` without checking whether the run's abort signal has already fired. If cancellation occurs as the first timed-out attempt fails, the SDK immediately launches two more agent attempts with an already-aborted operation instead of stopping.

## Reproduction

Create a disposable Vitest probe at `src/sdk/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { PipelineRunOptions } from "@poe-code/pipeline";

const workspaceRunPipelineMock = vi.hoisted(() => vi.fn());

vi.mock("./spawn.js", () => ({ spawn: { autonomous: vi.fn() } }));
vi.mock("@poe-code/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/pipeline")>();
  return { ...actual, runPipeline: workspaceRunPipelineMock };
});

import { runPipeline } from "./pipeline.js";

describe("SDK pipeline timeout retry cancellation", () => {
  it("launches retry attempts after the signal aborts on the first timeout", async () => {
    const controller = new AbortController();
    const timeout = new Error("timed out");
    timeout.name = "ActivityTimeoutError";
    const runAgent = vi.fn(async () => {
      controller.abort();
      throw timeout;
    });
    workspaceRunPipelineMock.mockImplementationOnce(async (options: PipelineRunOptions) => {
      await options.runAgent?.({
        agent: "codex",
        prompt: "Ship it",
        mode: "yolo",
        cwd: "/repo",
        signal: controller.signal
      });
      throw new Error("unreachable");
    });

    await expect(runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      signal: controller.signal,
      runAgent
    })).rejects.toBe(timeout);

    expect(controller.signal.aborted).toBe(true);
    expect(runAgent).toHaveBeenCalledTimes(3);
  });
});
```

Run:

```sh
npm exec -- vitest run src/sdk/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ src/sdk/__probe__.test.ts > SDK pipeline timeout retry cancellation > launches retry attempts after the signal aborts on the first timeout
```

## Observed Behavior

`runWithRetry()` in `src/sdk/pipeline.ts:93` through `src/sdk/pipeline.ts:104` catches `ActivityTimeoutError` and loops up to three attempts without accepting or reading an abort signal. `runPipeline()` applies that wrapper to workspace task execution at `src/sdk/pipeline.ts:141` through `src/sdk/pipeline.ts:147`. In the reproduction, the first `runAgent()` aborts the supplied signal and throws an activity timeout; the wrapper then immediately invokes the same runner twice more and ultimately rejects with the timeout after three total calls, rather than respecting cancellation.

## Expected Behavior

Before launching a retry after a timed-out attempt, the SDK pipeline wrapper should check the active abort signal and terminate as cancelled when it has fired. Cancellation must prevent new agent attempts from being scheduled.

## Impact

Cancelled pipeline runs can trigger extra agent invocations, consuming tokens, compute, sandbox/runtime capacity, and possibly making additional workspace changes after operators requested a stop. Retries also obscure the true cancellation outcome by surfacing a timeout after redundant post-cancellation work.
