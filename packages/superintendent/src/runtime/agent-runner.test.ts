import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildSpawnArgsMock, resolvePoeCommandExecutionMock, runPoeCommandMock } = vi.hoisted(() => ({
  buildSpawnArgsMock: vi.fn(() => ({ binaryName: "codex", args: [] })),
  resolvePoeCommandExecutionMock: vi.fn(() => ({
    factory: {},
    openSpec: {},
    detach: false,
    state: {}
  })),
  runPoeCommandMock: vi.fn(async () => ({ kind: "sync" as const, stdout: "done" }))
}));

vi.mock("@poe-code/agent-spawn/register-factories", () => ({}));
vi.mock("@poe-code/agent-spawn", () => ({ buildSpawnArgs: buildSpawnArgsMock }));
vi.mock("@poe-code/agent-harness-tools", () => ({
  resolvePoeCommandExecution: resolvePoeCommandExecutionMock,
  runPoeCommand: runPoeCommandMock
}));

describe("runAutonomousAgent", () => {
  beforeEach(() => {
    buildSpawnArgsMock.mockClear();
    resolvePoeCommandExecutionMock.mockClear();
    runPoeCommandMock.mockClear();
  });

  it("forwards cancellation to the active poe command", async () => {
    const controller = new AbortController();
    const { runAutonomousAgent } = await import("./agent-runner.js");

    await runAutonomousAgent({
      agent: "codex",
      prompt: "Build",
      cwd: "/repo",
      signal: controller.signal
    });

    expect(runPoeCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal })
    );
  });
});
