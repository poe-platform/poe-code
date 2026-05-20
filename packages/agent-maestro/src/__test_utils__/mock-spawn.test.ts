import { describe, expect, it } from "vitest";

import { createMockSpawn, type MockSpawnStep } from "./mock-spawn.js";

describe("createMockSpawn", () => {
  it("returns scripted exit results", async () => {
    const mock = createMockSpawn({
      codex: [{ kind: "exit", exitCode: 7 }]
    });

    await expect(mock.spawn("codex", { prompt: "run it" })).resolves.toMatchObject({
      exitCode: 7,
      stdout: "",
      stderr: "",
      durationMs: 0
    });
  });

  it("treats scripted exit as terminal", async () => {
    const mock = createMockSpawn({
      codex: [
        { kind: "exit", exitCode: 7 },
        { kind: "emit", event: { event: "agent_message", text: "after exit" } }
      ]
    });

    await expect(mock.spawn("codex", { prompt: "run it" })).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 7,
      durationMs: 0,
      events: []
    });
  });

  it("maps scripted throws to spawn-compatible error types", async () => {
    const cases: Array<{
      scriptError: MockSpawnStep & { kind: "throw" };
      name: string;
      message: string;
      failure?: string;
    }> = [
      {
        scriptError: { kind: "throw", error: "abort" },
        name: "AbortError",
        message: "Agent spawn aborted"
      },
      {
        scriptError: { kind: "throw", error: "activity_timeout" },
        name: "ActivityTimeoutError",
        message: "Agent spawn activity timed out"
      },
      {
        scriptError: { kind: "throw", error: "agent_startup_error" },
        name: "AgentStartupError",
        message: "Agent failed to start",
        failure: "agent_startup_error"
      },
      {
        scriptError: { kind: "throw", error: "agent_crashed" },
        name: "Error",
        message: "Agent crashed"
      },
      {
        scriptError: { kind: "throw", error: new Error("custom") },
        name: "Error",
        message: "custom"
      }
    ];

    for (const testCase of cases) {
      const mock = createMockSpawn({
        codex: [testCase.scriptError]
      });

      await expect(mock.spawn("codex", { prompt: "run it" })).rejects.toMatchObject({
        name: testCase.name,
        message: testCase.message,
        ...(testCase.failure ? { failure: testCase.failure } : {})
      });
    }
  });

  it("uses the configured activity timeout in timeout errors", async () => {
    const mock = createMockSpawn({
      codex: [{ kind: "throw", error: "activity_timeout" }]
    });

    await expect(
      mock.spawn("codex", { prompt: "run it", activityTimeoutMs: 1_500 })
    ).rejects.toMatchObject({
      name: "ActivityTimeoutError",
      message: "Agent spawn timed out after 1.5s of inactivity"
    });
  });

  it("honors already-aborted signals synchronously and aborts mid-script", async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    const mock = createMockSpawn();

    expect(() =>
      mock.spawn("codex", {
        prompt: "do not start",
        signal: preAborted.signal
      })
    ).toThrow(Object.assign(new Error("Agent spawn aborted"), { name: "AbortError" }));
    expect(mock.calls).toEqual([
      {
        agent: "codex",
        prompt: "do not start",
        signal: preAborted.signal
      }
    ]);

    const controller = new AbortController();
    const abortingMock = createMockSpawn({
      codex: [
        {
          kind: "assert",
          fn: () => controller.abort()
        },
        { kind: "wait", ms: 25 },
        { kind: "exit", exitCode: 0 }
      ]
    });

    await expect(
      abortingMock.spawn("codex", { prompt: "stop during script", signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("captures calls and verifies cwd when a verifier is supplied", async () => {
    const controller = new AbortController();
    const mock = createMockSpawn(
      {
        claude: [
          {
            kind: "assert",
            fn: (call) => {
              expect(call.cwd).toBe("/repo");
            }
          }
        ]
      },
      {
        cwdExists: (cwd) => cwd === "/repo"
      }
    );

    await mock.spawn("claude", {
      prompt: "ship",
      model: "anthropic/claude-sonnet-4.5",
      mode: "read",
      cwd: "/repo",
      signal: controller.signal
    });

    expect(mock.calls).toEqual([
      {
        agent: "claude",
        prompt: "ship",
        model: "anthropic/claude-sonnet-4.5",
        mode: "read",
        cwd: "/repo",
        signal: controller.signal
      }
    ]);

    await expect(mock.spawn("claude", { prompt: "bad cwd", cwd: "/missing" })).rejects.toThrow(
      'Mock spawn cwd does not exist: "/missing"'
    );
  });

  it("defaults to a successful result with one synthetic agent message event", async () => {
    const mock = createMockSpawn();

    await expect(mock.spawn("codex", { prompt: "default" })).resolves.toEqual({
      stdout: "Mock agent response",
      stderr: "",
      exitCode: 0,
      durationMs: 0,
      events: [{ event: "agent_message", text: "Mock agent response" }]
    });
  });

  it("runs multiple call scripts with one step of each kind", async () => {
    const mock = createMockSpawn((call) => {
      if (call.agent === "emit") {
        return [{ kind: "emit", event: { event: "agent_message", text: "hello" } }];
      }
      if (call.agent === "exit") {
        return [{ kind: "exit", exitCode: 3 }];
      }
      if (call.agent === "wait") {
        return [{ kind: "wait", ms: 40 }];
      }
      if (call.agent === "assert") {
        return [{ kind: "assert", fn: (captured) => expect(captured.prompt).toBe("check") }];
      }
      return [{ kind: "throw", error: "agent_crashed" }];
    });

    await expect(mock.spawn("emit", { prompt: "event" })).resolves.toMatchObject({
      exitCode: 0,
      stdout: "hello",
      events: [{ event: "agent_message", text: "hello" }]
    });
    await expect(mock.spawn("exit", { prompt: "code" })).resolves.toMatchObject({
      exitCode: 3
    });
    await expect(mock.spawn("wait", { prompt: "clock" })).resolves.toMatchObject({
      exitCode: 0,
      durationMs: 40
    });
    await expect(mock.spawn("assert", { prompt: "check" })).resolves.toMatchObject({
      exitCode: 0
    });
    await expect(mock.spawn("throw", { prompt: "boom" })).rejects.toThrow("Agent crashed");

    expect(mock.calls.map((call) => call.agent)).toEqual([
      "emit",
      "exit",
      "wait",
      "assert",
      "throw"
    ]);
  });
});
