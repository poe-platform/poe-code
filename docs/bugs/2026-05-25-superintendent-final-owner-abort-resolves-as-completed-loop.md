# Superintendent Final Owner Abort Resolves as Completed Loop

## Summary

`@poe-code/superintendent` can receive an abort signal during its final owner-review execution and still return `stopReason: "completed"`. If the owner runner aborts its supplied signal while resolving with `approve_completion`, the loop writes completed state and prioritizes that state over cancellation when deciding the public result.

## Reproduction

Create a disposable Vitest probe at `packages/superintendent/src/__probe__.test.ts`:

```ts
import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runLoop, type LoopRunners, type SuperintendentFileSystem } from "./runtime/loop.js";
import type { runBuilder } from "./runtime/run-builder.js";
import type { runInspector } from "./runtime/run-inspector.js";
import type { runOwnerReview } from "./runtime/run-owner-review.js";
import type { runSuperintendent } from "./runtime/run-superintendent.js";

function document(): string {
  return [
    "---", "kind: superintendent", "version: 1", "builder:", "  agent: claude-code", "  prompt: Build",
    "superintendent:", "  agent: claude-code", "  prompt: Review", "owner:", "  agent: claude-code", "  prompt: Approve",
    "status:", "  state: in_progress", "  round: 0", "  review_turn: 0", "---", "# Plan", "", "## Task Board", "", "- [ ] Task"
  ].join("\n");
}

describe("superintendent abort during final approval", () => {
  it("returns completed after the owner aborts while approving completion", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const volume = Volume.fromJSON({ [docPath]: document() }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    const fs = {
      readFile: (filePath: string, encoding: BufferEncoding) => rawFs.readFile(filePath, encoding) as Promise<string>,
      writeFile: async (filePath: string, data: string) => { await rawFs.mkdir(path.dirname(filePath), { recursive: true }); await rawFs.writeFile(filePath, data, "utf8"); },
      readdir: (filePath: string) => rawFs.readdir(filePath) as Promise<string[]>,
      open: (filePath: string, flags: string) => rawFs.open(filePath, flags),
      stat: async (filePath: string) => { const stat = await rawFs.stat(filePath); return { isFile: () => stat.isFile(), isDirectory: () => stat.isDirectory(), mtimeMs: Number(stat.mtimeMs) }; },
      unlink: async (filePath: string) => { await rawFs.unlink(filePath); },
      mkdir: async (filePath: string, options?: { recursive?: boolean }) => { await rawFs.mkdir(filePath, options); },
      rmdir: async (filePath: string) => { await rawFs.rmdir(filePath); },
      rename: async (oldPath: string, newPath: string) => { await rawFs.rename(oldPath, newPath); }
    } as SuperintendentFileSystem;
    const controller = new AbortController();
    const runners: LoopRunners = {
      builder: vi.fn(async () => ({ summary: "built", log: "built", log_path: "" })) as unknown as typeof runBuilder,
      inspector: vi.fn() as unknown as typeof runInspector,
      superintendent: vi.fn(async () => ({ summary: "ready", transition: { action: "request_review", summary: "ready" } })) as unknown as typeof runSuperintendent,
      ownerReview: vi.fn(async () => { controller.abort(); return { transition: { action: "approve_completion" } }; }) as unknown as typeof runOwnerReview
    };

    const result = await runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs, runners, signal: controller.signal });

    expect(controller.signal.aborted).toBe(true);
    expect(result).toMatchObject({ state: "completed", stopReason: "completed" });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/superintendent/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/superintendent/src/__probe__.test.ts > superintendent abort during final approval > returns completed after the owner aborts while approving completion
```

## Observed Behavior

After owner review returns `approve_completion`, `packages/superintendent/src/runtime/loop.ts:384` through `packages/superintendent/src/runtime/loop.ts:398` sets state to `"completed"` and writes that status. The following stop decision calls `readLoopStopReason()` at `packages/superintendent/src/runtime/loop.ts:406` through `packages/superintendent/src/runtime/loop.ts:410`. That helper returns `"completed"` immediately for completed state at `packages/superintendent/src/runtime/loop.ts:631` through `packages/superintendent/src/runtime/loop.ts:637`, before consulting `readInterruptionReason()` and the aborted signal at `packages/superintendent/src/runtime/loop.ts:646` through `packages/superintendent/src/runtime/loop.ts:652`. The reproduction therefore receives a completed result while its signal is already aborted.

## Expected Behavior

An abort request that occurs during the final active owner run should not be silently overwritten by that run's normal approval return. The loop should re-check cancellation after the owner invocation and surface an aborted outcome, or otherwise define and consistently expose completion-versus-cancellation ordering without reporting ordinary completion for an aborted operation.

## Impact

CLI interrupt handling and supervisory systems can request cancellation while the final agent is still running but receive a successful completed status instead. This can falsely signal that the operation honored the user's desired finalization, obscure cancellation telemetry, and prevent callers from distinguishing approved completion from a cancelled in-flight review.
