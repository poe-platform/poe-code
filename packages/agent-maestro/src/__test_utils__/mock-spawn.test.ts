import { describe, expect, it } from "vitest";
import type { StateMachineDef, Task } from "@poe-code/task-list";

import { createMockSpawn, createTaskScriptSpawn, type MockSpawnStep } from "./mock-spawn.js";
import { createMockTaskList } from "./mock-task-list.js";

const taskScriptMachine = {
  initial: "in-progress",
  states: ["in-progress", "done", "failed"],
  events: {
    complete: { from: ["in-progress"], to: "done" },
    fail: { from: ["in-progress"], to: "failed" }
  }
} as const satisfies StateMachineDef;

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

  it("runs afterResult after a successful result is built", async () => {
    const controller = new AbortController();
    const mock = createMockSpawn(
      {
        codex: [
          { kind: "emit", event: { event: "session_start", threadId: "thread-after" } },
          { kind: "exit", exitCode: 0 }
        ]
      },
      {
        afterResult: (result, call) => {
          expect(result.threadId).toBe("thread-after");
          expect(call.prompt).toBe("finish then abort");
          controller.abort();
        }
      }
    );

    await expect(
      mock.spawn("codex", { prompt: "finish then abort", signal: controller.signal })
    ).resolves.toMatchObject({ exitCode: 0, threadId: "thread-after" });
    expect(controller.signal.aborted).toBe(true);
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
      if (call.agent === "run") {
        return [
          {
            kind: "run",
            fn: async (captured) => {
              expect(captured.prompt).toBe("side-effect");
            }
          }
        ];
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
    await expect(mock.spawn("run", { prompt: "side-effect" })).resolves.toMatchObject({
      exitCode: 0
    });
    await expect(mock.spawn("throw", { prompt: "boom" })).rejects.toThrow("Agent crashed");

    expect(mock.calls.map((call) => call.agent)).toEqual([
      "emit",
      "exit",
      "wait",
      "assert",
      "run",
      "throw"
    ]);
  });

  it("supports a scripted step that intentionally never resolves", async () => {
    const mock = createMockSpawn({
      blocked: [{ kind: "block" }]
    });

    const result = mock.spawn("blocked", { prompt: "wait" });
    await Promise.resolve();

    await expect(Promise.race([result, Promise.resolve("pending")])).resolves.toBe("pending");
    expect(mock.calls).toHaveLength(1);
  });
});

describe("createTaskScriptSpawn", () => {
  it("runs task scripts by parsed prompt task id and attempt number", async () => {
    const taskList = createMockTaskList({
      tasks: [task("one"), task("retry")],
      stateMachine: taskScriptMachine
    });
    const mock = createTaskScriptSpawn(taskList, {
      one: [{ kind: "complete" }],
      retry: [{ kind: "exit", exitCode: 1 }, { kind: "complete" }]
    });

    await expect(mock.spawn("codex", { prompt: "task:one state:in-progress" })).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
      durationMs: 0,
      threadId: "thread-one-1",
      events: [{ event: "session_start", threadId: "thread-one-1" }]
    });
    await expect(taskList.get("tasks/one")).resolves.toMatchObject({ state: "done" });

    await expect(mock.spawn("codex", { prompt: "task:retry first" })).resolves.toMatchObject({
      exitCode: 1,
      threadId: "thread-retry-1"
    });
    await expect(taskList.get("tasks/retry")).resolves.toMatchObject({ state: "in-progress" });

    await expect(mock.spawn("codex", { prompt: "task:retry second" })).resolves.toMatchObject({
      exitCode: 0,
      threadId: "thread-retry-2"
    });
    await expect(taskList.get("tasks/retry")).resolves.toMatchObject({ state: "done" });
    expect(mock.calls.map((call) => call.prompt)).toEqual([
      "task:one state:in-progress",
      "task:retry first",
      "task:retry second"
    ]);
  });

  it("can fail a task with an abort-shaped spawn error", async () => {
    const taskList = createMockTaskList({
      tasks: [task("cancel")],
      stateMachine: taskScriptMachine
    });
    const mock = createTaskScriptSpawn(taskList, {
      cancel: [{ kind: "fail" }]
    });

    await expect(mock.spawn("codex", { prompt: "task:cancel" })).rejects.toMatchObject({
      name: "AbortError"
    });
    await expect(taskList.get("tasks/cancel")).resolves.toMatchObject({ state: "failed" });
  });

  it("throws a clear error when the prompt does not include a task id", async () => {
    const taskList = createMockTaskList({
      tasks: [task("missing")],
      stateMachine: taskScriptMachine
    });
    const mock = createTaskScriptSpawn(taskList, {});

    await expect(mock.spawn("codex", { prompt: "no task marker" })).rejects.toThrow(
      "Missing task id in prompt: no task marker"
    );
  });
});

function task(id: string): Task {
  return {
    list: "tasks",
    id,
    qualifiedId: `tasks/${id}`,
    name: id,
    state: "in-progress",
    description: "",
    metadata: {}
  };
}
