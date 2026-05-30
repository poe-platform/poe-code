---
name: "Superintendent MCP integration shutdown failure rejects a completed run"
---

# Superintendent MCP integration shutdown failure rejects a completed run

## Summary

The exported Superintendent MCP `run` command wraps a completed loop result with optional Braintrust integrations and awaits `integrations.shutdown()` in a `finally` block. If the loop completes successfully but integration shutdown rejects, the MCP command rejects instead of returning the completed Superintendent result.

## Reproduction

1. Add this disposable probe as `packages/superintendent/src/commands/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  shutdown: vi.fn(async () => {
    throw new Error("integration shutdown denied");
  }),
  loadIntegrations: vi.fn()
}));

vi.mock("@poe-code/braintrust", () => ({
  loadIntegrations: mocked.loadIntegrations
}));

describe("superintendent MCP integration cleanup probe", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("rejects a completed loop solely because integration shutdown fails", async () => {
    const rawFs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/docs/plans/plan.md": [
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
          "  prompt: Own",
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
    const originalHome = process.env.HOME;
    const cwd = vi.spyOn(process, "cwd").mockReturnValue("/repo");
    process.env.HOME = "/home/test";
    mocked.loadIntegrations.mockResolvedValue({
      traceRun: vi.fn(async (_kind, _name, callback) => callback()),
      shutdown: mocked.shutdown
    });
    vi.doMock("node:fs/promises", () => rawFs);

    try {
      const { createRunMcpCommand } = await import("./run.js");
      const command = createRunMcpCommand({
        runLoop: vi.fn(async () => ({
          state: "completed",
          round: 1,
          reviewTurn: 0,
          maxRounds: 100,
          maxReviewTurns: 5,
          stopReason: "completed"
        }))
      });

      await expect(
        command.handler({
          params: { doc: "/repo/docs/plans/plan.md" },
          secrets: {},
          fetch: globalThis.fetch,
          fs: rawFs as never,
          env: { get: vi.fn(() => undefined) },
          progress: vi.fn()
        })
      ).rejects.toThrow("integration shutdown denied");
    } finally {
      vi.doUnmock("node:fs/promises");
      cwd.mockRestore();
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });
});
```

2. Run the focused probe:

```sh
npm exec -- vitest run packages/superintendent/src/commands/__probe__.test.ts --reporter verbose
```

3. Remove the disposable probe after validation.

The probe passes on the current implementation:

```text
✓ packages/superintendent/src/commands/__probe__.test.ts > superintendent MCP integration cleanup probe > rejects a completed loop solely because integration shutdown fails
```

## Observed Behavior

The injected loop runner returns `stopReason: "completed"`, and the integration wrapper allows that successful loop callback to finish. The command then awaits `integrations.shutdown()` in its outer `finally` block; the rejected shutdown replaces the completed command result with `integration shutdown denied`.

## Expected Behavior

Telemetry or integration shutdown failure after a completed Superintendent loop should not replace the authoritative completed workflow result. The command should return completion while surfacing integration cleanup failure separately, or expose both outcomes without reporting the workflow itself as rejected.

## Impact

Transient telemetry flushing or shutdown faults can make completed autonomous workflow runs appear failed to MCP clients. Callers may rerun completed work or mark a plan failed even though the actual Superintendent loop finished normally, while the cleanup-only issue is obscured as the top-level failure.
