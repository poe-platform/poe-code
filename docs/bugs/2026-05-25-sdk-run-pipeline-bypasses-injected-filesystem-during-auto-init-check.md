# SDK `runPipeline` Bypasses Injected Filesystem During Auto-Init Check

## Summary

The public SDK `runPipeline()` accepts `PipelineRunOptions.fs`, but its automatic initialization preflight reads an explicit plan through Node's host filesystem instead of the supplied filesystem adapter. A valid pipeline plan available only through the injected filesystem fails with `ENOENT` before the workspace pipeline core can consume it.

## Reproduction

Create a disposable Vitest probe at `src/sdk/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type { PipelineFileSystem } from "@poe-code/pipeline";

const workspaceRunPipelineMock = vi.hoisted(() => vi.fn());

vi.mock("./spawn.js", () => ({ spawn: { autonomous: vi.fn() } }));
vi.mock("@poe-code/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/pipeline")>();
  return { ...actual, runPipeline: workspaceRunPipelineMock };
});

import { runPipeline } from "./pipeline.js";

describe("SDK pipeline injected filesystem", () => {
  it("reads an explicit plan from the host filesystem before delegating to provided fs", async () => {
    const volume = Volume.fromJSON({
      "/virtual/feature.md": ["---", "kind: pipeline", "version: 1", "tasks:", "  - id: work", "    title: Work", "    prompt: Do it", "    status: open", "---", ""].join("\n")
    }, "/");
    const fs = createFsFromVolume(volume).promises as unknown as PipelineFileSystem;

    await expect(runPipeline({
      agent: "codex",
      cwd: "/virtual",
      homeDir: "/home/test",
      plan: "feature.md",
      fs,
      runAgent: vi.fn()
    })).rejects.toMatchObject({ code: "ENOENT" });

    expect(workspaceRunPipelineMock).not.toHaveBeenCalled();
  });
});
```

Run:

```sh
npm exec -- vitest run src/sdk/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ src/sdk/__probe__.test.ts > SDK pipeline injected filesystem > reads an explicit plan from the host filesystem before delegating to provided fs
```

## Observed Behavior

`PipelineRunOptions` exposes `fs?: PipelineFileSystem` in `packages/pipeline/src/types.ts:161` through `packages/pipeline/src/types.ts:185`, and the pipeline core uses `options.fs` for plan resolution and reading. Before delegation, however, `src/sdk/pipeline.ts:115` through `src/sdk/pipeline.ts:125` resolves the explicit path with `path.resolve()` and calls `planNeedsInit()`, which reads with imported `node:fs/promises` at `src/sdk/pipeline.ts:79` through `src/sdk/pipeline.ts:90`. In the reproduction the virtual plan exists in `memfs`, but no host file exists at `/virtual/feature.md`; the SDK rejects `ENOENT` and never invokes the mocked workspace pipeline.

## Expected Behavior

SDK preflight behavior should use `options.fs` whenever the pipeline invocation supplies a filesystem adapter, preserving the same document source and test/sandbox abstraction used by the pipeline core. A valid injected plan must not be rejected solely because it is absent from the host filesystem.

## Impact

Consumers using in-memory filesystems, sandbox-backed storage, remote document adapters, or isolated test environments cannot reliably call the public pipeline SDK with an explicit plan. The adapter leaks out of the supplied storage boundary, produces misleading missing-file failures, and may inspect a different host file than the core will execute.
