---
name: "Superintendent loop lock release failure rejects persisted completion"
---

# Superintendent loop lock release failure rejects persisted completion

## Summary

The exported `@poe-code/superintendent` `runLoop()` workflow writes `status.state: completed` to its plan document after owner approval, then awaits workflow-lock release in a `finally` block. If releasing that lock rejects, the API rejects after the completed Superintendent state has already been persisted.

## Reproduction

1. Add this disposable probe as `packages/superintendent/src/runtime/__probe__.test.ts`:

```ts
import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type { SuperintendentFileSystem } from "./loop.js";

const mocked = vi.hoisted(() => ({
  releaseLock: vi.fn(async () => {
    throw new Error("loop lock release denied");
  })
}));

vi.mock("@poe-code/agent-harness-tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/agent-harness-tools")>()),
  lockWorkflow: vi.fn(async () => mocked.releaseLock)
}));

import { runLoop } from "./loop.js";

describe("superintendent loop release failure probe", () => {
  it("rejects after persisting completed state when releasing its lock fails", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const rawFs = createFsFromVolume(
      Volume.fromJSON({
        [docPath]: [
          "---",
          "kind: superintendent",
          "version: 1",
          "builder:",
          "  agent: codex",
          "  prompt: Build",
          "superintendent:",
          "  agent: codex",
          "  prompt: Review",
          "owner:",
          "  agent: codex",
          "  prompt: Approve",
          "status:",
          "  state: in_progress",
          "  round: 0",
          "  review_turn: 0",
          "---",
          "# Plan",
          ""
        ].join("\n")
      }, "/")
    ).promises;
    const fs = {
      readFile: (filePath: string, encoding: BufferEncoding) => rawFs.readFile(filePath, encoding),
      writeFile: async (filePath: string, content: string) => {
        await rawFs.mkdir(path.dirname(filePath), { recursive: true });
        await rawFs.writeFile(filePath, content, "utf8");
      },
      readdir: (filePath: string) => rawFs.readdir(filePath),
      open: (filePath: string, flags: string) => rawFs.open(filePath, flags),
      stat: async (filePath: string) => {
        const stat = await rawFs.stat(filePath);
        return { isFile: () => stat.isFile(), isDirectory: () => stat.isDirectory(), mtimeMs: Number(stat.mtimeMs) };
      },
      unlink: (filePath: string) => rawFs.unlink(filePath),
      mkdir: (filePath: string, options?: { recursive?: boolean }) => rawFs.mkdir(filePath, options),
      rmdir: (filePath: string) => rawFs.rmdir(filePath),
      rename: (oldPath: string, newPath: string) => rawFs.rename(oldPath, newPath)
    } as SuperintendentFileSystem;

    await expect(
      runLoop({
        docPath,
        cwd: "/repo",
        homeDir: "/home/test",
        fs,
        runners: {
          builder: vi.fn(async () => ({ summary: "built", log: "built" })),
          inspector: vi.fn(),
          superintendent: vi.fn(async () => ({
            summary: "ready",
            transition: { action: "request_review", summary: "ready" }
          })),
          ownerReview: vi.fn(async () => ({ transition: { action: "approve_completion" } }))
        }
      })
    ).rejects.toThrow("loop lock release denied");

    await expect(rawFs.readFile(docPath, "utf8")).resolves.toContain("state: completed");
  });
});
```

2. Run the focused probe:

```sh
npm exec -- vitest run packages/superintendent/src/runtime/__probe__.test.ts --reporter verbose
```

3. Remove the disposable probe after validation.

The probe passes on the current implementation:

```text
✓ packages/superintendent/src/runtime/__probe__.test.ts > superintendent loop release failure probe > rejects after persisting completed state when releasing its lock fails
```

## Observed Behavior

The mocked builder, superintendent, and owner stages perform a normal completion lifecycle, and `runLoop()` writes `state: completed` to the plan after owner approval. The final lock release then rejects with `loop lock release denied`, causing the exported API to reject despite the durable plan recording a completed workflow.

## Expected Behavior

Failure to release the workflow lock after committed completion should not replace the authoritative Superintendent result. The API should return completed state while separately exposing lock cleanup trouble, or explicitly represent both outcomes without reporting normal completed work as a rejected run.

## Impact

Lock cleanup failures can make orchestrators and CLI callers retry or flag as failed a Superintendent plan that is already persisted as complete. This produces contradictory workflow state, increases the risk of duplicate autonomous activity, and obscures the fact that only post-completion lock disposal failed.
