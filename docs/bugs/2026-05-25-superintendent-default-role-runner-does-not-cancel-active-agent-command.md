---
name: "Superintendent Default Role Runner Does Not Cancel Active Agent Command"
---

# Superintendent Default Role Runner Does Not Cancel Active Agent Command

## Summary

`@poe-code/superintendent` exposes `RunLoopOptions.signal` and detects cancellation between role phases, but its built-in agent execution path never forwards that signal into the active command runner. When a builder, inspector, superintendent, or owner command is in progress without an injected `runAgent`, aborting the loop does not interrupt the command; `runLoop()` remains pending until the agent exits on its own.

## Reproduction

Create a disposable Vitest probe at `packages/superintendent/src/__probe__.test.ts`:

```ts
import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type { SuperintendentFileSystem } from "./runtime/loop.js";

const runPoeCommandMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/agent-harness-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-harness-tools")>();
  return {
    ...actual,
    resolvePoeCommandExecution: vi.fn(() => ({ factory: {}, openSpec: {}, detach: false, state: undefined })),
    runPoeCommand: runPoeCommandMock
  };
});

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return { ...actual, buildSpawnArgs: vi.fn(() => ({ binaryName: "codex", args: [] })) };
});

import { runLoop } from "./runtime/loop.js";

function document(): string {
  return [
    "---", "kind: superintendent", "version: 1", "builder:", "  agent: codex", "  prompt: Build",
    "superintendent:", "  agent: codex", "  prompt: Review", "owner:", "  agent: codex", "  prompt: Approve",
    "status:", "  state: in_progress", "  round: 0", "  review_turn: 0", "---", "# Plan", "", "## Task Board", "", "- [ ] Task"
  ].join("\n");
}

describe("superintendent active default runner cancellation", () => {
  it("does not settle after abort until its active builder command finishes", async () => {
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
    let finishBuilder: ((value: { kind: "completed"; stdout: string }) => void) | undefined;
    let settled = false;
    runPoeCommandMock.mockImplementationOnce(() => new Promise((resolve) => { finishBuilder = resolve; }));

    const run = runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs, signal: controller.signal }).then((result) => {
      settled = true;
      return result;
    });

    await vi.waitFor(() => expect(runPoeCommandMock).toHaveBeenCalledTimes(1));
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);

    finishBuilder?.({ kind: "completed", stdout: "builder done" });
    await expect(run).resolves.toMatchObject({ stopReason: "aborted" });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/superintendent/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/superintendent/src/__probe__.test.ts > superintendent active default runner cancellation > does not settle after abort until its active builder command finishes
```

## Observed Behavior

`runLoop()` stores `signal` in its runtime options and, when an injected `runAgent` exists, forwards it from `packages/superintendent/src/runtime/loop.ts:713` through `packages/superintendent/src/runtime/loop.ts:729`. Without an injected runner, role implementations call `runAutonomousAgent()`, whose input type in `packages/superintendent/src/runtime/agent-runner.ts:16` through `packages/superintendent/src/runtime/agent-runner.ts:29` has no signal field. Its direct `runPoeCommand()` invocation at `packages/superintendent/src/runtime/agent-runner.ts:114` through `packages/superintendent/src/runtime/agent-runner.ts:119` therefore cannot observe loop cancellation. The reproduction aborts during a pending default builder command; the run remains pending until that mock command is manually resolved, and only then returns `"aborted"` between phases.

## Expected Behavior

The built-in superintendent role execution path should forward `RunLoopOptions.signal` into active command execution so cancellation can interrupt a running builder, inspector, superintendent, or owner role just as the injected-runner path exposes cancellation to custom executors.

## Impact

Normal CLI superintendent runs can appear unresponsive to `SIGINT`, dashboard cancel actions, or orchestration aborts while an agent command is active. Long-running or stuck agent processes continue consuming resources until they naturally finish, even though the loop eventually claims to support aborted outcomes.
