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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

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

  it.each(["first", "second"] as const)("isolates overlapping scopes when %s finishes first", async (finishFirst) => {
    const { runAutonomousAgent, withAutonomousAgentRunner } = await import("./agent-runner.js");
    const gates = { first: deferred(), second: deferred() };
    await withAutonomousAgentRunner(async () => "outer", async () => {
      const first = withAutonomousAgentRunner(async () => "first", async () => {
        await gates.first.promise;
        return await runAutonomousAgent({ agent: "codex", prompt: "first" });
      });
      const second = withAutonomousAgentRunner(async () => "second", async () => {
        await gates.second.promise;
        return await runAutonomousAgent({ agent: "codex", prompt: "second" });
      });
      const pending = { first, second };
      const finishLast = finishFirst === "first" ? "second" : "first";
      try {
        gates[finishFirst].resolve();
        await expect(pending[finishFirst]).resolves.toBe(finishFirst);
        gates[finishLast].resolve();
        await expect(pending[finishLast]).resolves.toBe(finishLast);
      } finally {
        gates.first.resolve();
        gates.second.resolve();
        await Promise.allSettled([first, second]);
      }
      await expect(runAutonomousAgent({ agent: "codex", prompt: "outer" })).resolves.toBe("outer");
    });
    expect(runPoeCommandMock).not.toHaveBeenCalled();
  });

  it("restores an outer scope after a nested asynchronous failure", async () => {
    const { runAutonomousAgent, withAutonomousAgentRunner } = await import("./agent-runner.js");
    const failure = new Error("nested failure");
    await withAutonomousAgentRunner(async () => "outer", async () => {
      await expect(withAutonomousAgentRunner(async () => "inner", async () => {
        await expect(runAutonomousAgent({ agent: "codex", prompt: "inner" })).resolves.toBe("inner");
        throw failure;
      })).rejects.toBe(failure);
      await expect(runAutonomousAgent({ agent: "codex", prompt: "outer" })).resolves.toBe("outer");
    });
    expect(runPoeCommandMock).not.toHaveBeenCalled();
  });

  it("does not inject a runner into an unrelated caller while a scope is pending", async () => {
    const { runAutonomousAgent, withAutonomousAgentRunner } = await import("./agent-runner.js");
    const gate = deferred();
    const injected = vi.fn(async () => "injected");
    const pending = withAutonomousAgentRunner(injected, async () => { await gate.promise; });
    try {
      await expect(runAutonomousAgent({ agent: "codex", prompt: "outside" })).resolves.toEqual({ stdout: "done" });
      expect(injected).not.toHaveBeenCalled();
      expect(runPoeCommandMock).toHaveBeenCalledTimes(1);
    } finally {
      gate.resolve();
      await pending;
    }
  });

  it("does not replace another active runner when an overlapping operation rejects", async () => {
    const { runAutonomousAgent, withAutonomousAgentRunner } = await import("./agent-runner.js");
    const firstGate = deferred();
    const secondGate = deferred();
    const failure = new Error("first failed");
    await withAutonomousAgentRunner(async () => "outer", async () => {
      const first = withAutonomousAgentRunner(async () => "first", async () => {
        await firstGate.promise;
        throw failure;
      });
      const firstFailed = expect(first).rejects.toBe(failure);
      const second = withAutonomousAgentRunner(async () => "second", async () => {
        await secondGate.promise;
        return await runAutonomousAgent({ agent: "codex", prompt: "second" });
      });
      try {
        firstGate.resolve();
        await firstFailed;
        secondGate.resolve();
        await expect(second).resolves.toBe("second");
      } finally {
        firstGate.resolve();
        secondGate.resolve();
        await Promise.allSettled([first, second]);
      }
    });
  });

  it("keeps a descendant's runner after its creating callback has returned", async () => {
    const { runAutonomousAgent, withAutonomousAgentRunner } = await import("./agent-runner.js");
    const gate = deferred();
    let descendant!: ReturnType<typeof runAutonomousAgent>;
    await withAutonomousAgentRunner(async () => "owner", async () => {
      descendant = (async () => {
        await gate.promise;
        return await runAutonomousAgent({ agent: "codex", prompt: "descendant" });
      })();
    });
    gate.resolve();
    await expect(descendant).resolves.toBe("owner");
    await expect(runAutonomousAgent({ agent: "codex", prompt: "outside" })).resolves.toEqual({ stdout: "done" });
  });

  it("returns a rejected promise for a synchronous operation failure", async () => {
    const { runAutonomousAgent, withAutonomousAgentRunner } = await import("./agent-runner.js");
    const failure = new Error("synchronous failure");
    const pending = withAutonomousAgentRunner(async () => "unused", () => { throw failure; });
    await expect(pending).rejects.toBe(failure);
    await expect(runAutonomousAgent({ agent: "codex", prompt: "outside" })).resolves.toEqual({ stdout: "done" });
  });
});
