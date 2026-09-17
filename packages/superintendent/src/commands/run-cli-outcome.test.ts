import { afterEach, describe, expect, it, vi } from "vitest";
import { createFsFromVolume, Volume } from "memfs";
import { createRunQueue } from "@poe-code/agent-harness-tools";

const mocks = vi.hoisted(() => ({ sequence: vi.fn() }));
vi.mock("../runtime/sequence.js", () => ({ runSuperintendentSequence: mocks.sequence }));
vi.mock("node:fs/promises", async () => {
  const { createFsFromVolume, Volume } = await import("memfs");
  return createFsFromVolume(Volume.fromJSON({
    "/repo/plan.md": [
      "---", "kind: superintendent", "version: 1", "builder:", "  agent: codex", "  prompt: Build",
      "superintendent:", "  agent: codex", "  prompt: Review", "owner:", "  agent: codex", "  prompt: Approve",
      "status:", "  state: in_progress", "  round: 0", "  review_turn: 0", "---", "## Task Board", "- [ ] Implement"
    ].join("\n")
  })).promises;
});

const previousExitCode = process.exitCode;
afterEach(() => { vi.restoreAllMocks(); process.exitCode = previousExitCode; });

describe("superintendent command outcomes", () => {
  it.each([["failed", 1], ["cancelled", 130]] as const)("reports a %s queued run with exit code %i", async (status, exitCode) => {
    vi.spyOn(process, "cwd").mockReturnValue("/repo");
    process.exitCode = 0;
    const queue = createRunQueue({ plans: ["/repo/plan.md"], afterEachPlan: ["Review"] });
    const snapshot = await queue.run({ execute: async (item) => item.kind === "plan" ? "completed" : status });
    mocks.sequence.mockResolvedValue({
      status, queue: snapshot, messages: [],
      plans: [{ docPath: "/repo/plan.md", builderAgent: "codex", state: "completed", round: 1, reviewTurn: 0, maxRounds: 2, maxReviewTurns: 5, stopReason: "completed" }]
    });
    const { runCommand } = await import("./run.js");
    const result = await runCommand.handler({
      params: { docs: ["/repo/plan.md"], afterPlan: ["Review"], tui: false },
      secrets: {}, fetch: globalThis.fetch, fs: createFsFromVolume(new Volume()).promises as never,
      env: { get: () => undefined }, progress: vi.fn()
    } as unknown as Parameters<typeof runCommand.handler>[0]);
    expect(result.queue?.status).toBe(status);
    expect(process.exitCode).toBe(exitCode);
  });
});
