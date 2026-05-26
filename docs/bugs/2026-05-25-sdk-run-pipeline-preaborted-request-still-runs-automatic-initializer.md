# SDK `runPipeline` Pre-Aborted Request Still Runs Automatic Initializer

## Summary

The public SDK `runPipeline()` does not check an already-aborted signal before its automatic pipeline-initialization agent call. When a source document requires initialization, a request cancelled before invocation can still launch the initializer with an already-aborted signal before the workspace pipeline subsequently surfaces cancellation.

## Reproduction

Create a disposable Vitest probe at `src/sdk/__probe__.test.ts`:

```ts
import { vol } from "memfs";
import { describe, expect, it, vi } from "vitest";

const workspaceRunPipelineMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});
vi.mock("./spawn.js", () => ({ spawn: { autonomous: vi.fn() } }));
vi.mock("@poe-code/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/pipeline")>();
  return { ...actual, runPipeline: workspaceRunPipelineMock };
});

import { runPipeline } from "./pipeline.js";

describe("SDK auto-init pre-aborted pipeline", () => {
  it("runs automatic initialization before delegating an already aborted request", async () => {
    vol.reset();
    vol.fromJSON({ "/repo/feature.md": "# Feature\nShip it.\n" }, "/");
    const controller = new AbortController();
    controller.abort();
    const runAgent = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    workspaceRunPipelineMock.mockRejectedValueOnce(Object.assign(new Error("cancelled"), { name: "AbortError" }));

    await expect(runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "feature.md",
      signal: controller.signal,
      runAgent
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent.mock.calls[0]?.[0].signal?.aborted).toBe(true);
    expect(workspaceRunPipelineMock).toHaveBeenCalledTimes(1);
  });
});
```

Run:

```sh
npm exec -- vitest run src/sdk/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ src/sdk/__probe__.test.ts > SDK auto-init pre-aborted pipeline > runs automatic initialization before delegating an already aborted request
```

## Observed Behavior

Unlike `runPipelineInit()`, which returns cancelled before starting when `options.signal?.aborted` is true at `src/sdk/pipeline.ts:171` through `src/sdk/pipeline.ts:176`, `runPipeline()` performs no cancellation guard before its preflight initialization path. It detects an uninitialized explicit plan and calls `userRunAgent()` at `src/sdk/pipeline.ts:123` through `src/sdk/pipeline.ts:142`, merely forwarding the already-aborted signal to the runner. In the reproduction, the initializer is invoked once with `signal.aborted === true` before the mocked workspace pipeline rejects cancellation.

## Expected Behavior

If `runPipeline()` is invoked with a signal that is already aborted, it should avoid automatic initialization and all agent launches, surfacing cancellation immediately just as explicit `runPipelineInit()` does.

## Impact

Pre-cancelled SDK or CLI pipeline requests can still execute agent generation prompts and any resulting document edits, incur model/runtime costs, or start external actions. Users receive cancellation only after unnecessary initialization work has already been initiated.
