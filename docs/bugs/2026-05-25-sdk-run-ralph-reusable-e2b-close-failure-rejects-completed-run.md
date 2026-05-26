# SDK runRalph reusable E2B close failure rejects a completed run

## Summary

The public SDK `runRalph()` creates a reusable E2B command session for non-detached runs and closes it in a `finally` block after `@poe-code/ralph` finishes. If Ralph successfully returns a completed result but closing the reused session rejects, the SDK rejects with the cleanup error instead of returning the already completed workflow result.

## Reproduction

1. Add this disposable probe as `src/sdk/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  runWorkspaceRalph: vi.fn(),
  buildSpawnArgs: vi.fn(() => ({ binaryName: "claude", args: ["-p", "go"] })),
  createPoeCommandSession: vi.fn(),
  resolvePoeCommandExecution: vi.fn()
}));

vi.mock("@poe-code/ralph", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/ralph")>()),
  runRalph: mocked.runWorkspaceRalph
}));
vi.mock("@poe-code/agent-spawn", () => ({ buildSpawnArgs: mocked.buildSpawnArgs }));
vi.mock("@poe-code/agent-harness-tools", () => ({
  createPoeCommandSession: mocked.createPoeCommandSession,
  resolvePoeCommandExecution: mocked.resolvePoeCommandExecution
}));
vi.mock("./spawn.js", () => ({ spawn: Object.assign(vi.fn(), { autonomous: vi.fn() }) }));

import { runRalph } from "./ralph.js";

describe("SDK reusable E2B Ralph cleanup probe", () => {
  const originalPoeApiKey = process.env.POE_API_KEY;

  afterEach(() => {
    if (originalPoeApiKey === undefined) delete process.env.POE_API_KEY;
    else process.env.POE_API_KEY = originalPoeApiKey;
    vi.clearAllMocks();
  });

  it("rejects a successful run solely because session close fails", async () => {
    process.env.POE_API_KEY = "sk-test";
    mocked.resolvePoeCommandExecution.mockReturnValue({
      factory: { type: "e2b" },
      state: { jobs: {} },
      openSpec: { cwd: "/repo", runner: { detach: false } }
    });
    mocked.createPoeCommandSession.mockReturnValue({
      run: vi.fn().mockResolvedValue({ stdout: "done", stderr: "", exitCode: 0 }),
      close: vi.fn().mockRejectedValue(new Error("session close denied"))
    });
    mocked.runWorkspaceRalph.mockImplementation(async (options) => {
      await options.runAgent?.({ agent: "claude-code", prompt: "go", cwd: "/repo" });
      return {
        stopReason: "completed",
        docPath: "/repo/plan.md",
        iterationsCompleted: 1,
        totalDurationMs: 1
      };
    });

    await expect(
      runRalph({ cwd: "/repo", homeDir: "/home/test", docPath: "/repo/plan.md", runtime: "e2b" })
    ).rejects.toThrow("session close denied");
  });
});
```

2. Run the focused probe:

```sh
npm exec -- vitest run src/sdk/__probe__.test.ts --reporter verbose
```

3. Remove the disposable probe after validation.

The probe passes on the current implementation:

```text
✓ src/sdk/__probe__.test.ts > SDK reusable E2B Ralph cleanup probe > rejects a successful run solely because session close fails
```

## Observed Behavior

The mocked Ralph workflow invokes its E2B-backed agent successfully and returns `stopReason: "completed"`. The reused session's `close()` then rejects from `runRalph()`'s `finally` block, replacing the completed result with `session close denied` at the public SDK boundary.

## Expected Behavior

Failure to close an already used reusable E2B session should not convert a completed Ralph workflow into a failed SDK call. Cleanup failure should be reported separately or combined with the completed outcome without discarding the authoritative workflow result.

## Impact

Transient sandbox-close failures can cause callers, CLI commands, or automation to report and retry Ralph work that already completed successfully. Users receive a failure inconsistent with the plan's durable progress, potentially causing duplicate agent work and obscuring the actual cleanup-only fault.
