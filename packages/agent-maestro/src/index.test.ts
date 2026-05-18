import { fs, vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpawnResult } from "@poe-code/agent-spawn";
import type { StateMachineDef, TaskList, TaskListFs } from "@poe-code/task-list";
import { openTaskList } from "@poe-code/task-list";
import { maestroTaskStateMachine, runMaestro, type MaestroEvent } from "./index.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    default: fs.promises
  };
});

describe("runMaestro", () => {
  beforeEach(() => {
    vol.reset();
    vi.useRealTimers();
  });

  it("runs the default state machine, emits phases and agent events, and cleans a completed task workspace", async () => {
    vi.useFakeTimers();
    vol.fromJSON({
      "/repo/WORKFLOW.md": workflowFrontmatter({
        tasks: ["  type: yaml-file", "  path: /repo/tasks.yaml"],
        agent: ["  list: tasks"],
        workspace: ["  root: /repo/workspaces"],
        polling: ["  interval_ms: 25"]
      }),
      "/repo/.poe-code/pipeline/steps.yaml": [
        "steps:",
        "  implement:",
        "    agent: codex",
        "    mode: edit",
        "    prompt: Implement {{ prompt }}",
        "  verify:",
        "    agent: codex",
        "    mode: read",
        "    prompt: Verify {{ prompt }}",
        "teardown:",
        "  agent: codex",
        "  mode: read",
        "  prompt: Teardown {{ prompt }}"
      ].join("\n")
    });
    const taskList = await createYamlTaskList("/repo/tasks.yaml", fs.promises as unknown as TaskListFs);
    const tasks = taskList.list("tasks");
    await tasks.create({ id: "one", name: "One", description: "Do the work" });
    await tasks.fire("one", "plan");
    const events: MaestroEvent[] = [];
    const spawn = vi.fn(async (): Promise<SpawnResult> => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
      threadId: `session-${spawn.mock.calls.length}`
    }));
    const stop = await runMaestro({
      workflowPath: "/repo/WORKFLOW.md",
      taskList,
      agentSpawn: spawn,
      onEvent: (event) => events.push(event)
    });
    await flushMicrotasks();
    await waitForCondition(() => events.some((event) => event.type === "worker_exit"));

    await tasks.fire("one", "complete");
    await vi.advanceTimersByTimeAsync(25);
    await waitForCondition(() =>
      events.some((event) => event.type === "reconcile" && event.action === "stop_clean")
    );

    expect(events.filter((event) => event.type === "attempt_phase").map((event) => event.to)).toEqual([
      "preparing-workspace",
      "running-step",
      "running-step",
      "running-teardown",
      "succeeded"
    ]);
    expect(events.filter((event) => event.type === "agent_event").map((event) => event.step)).toEqual([
      "implement",
      "verify",
      "teardown"
    ]);
    await expect(tasks.get("one")).resolves.toMatchObject({ state: "done" });
    expect(vol.existsSync("/repo/workspaces/tasks_one")).toBe(false);

    await stop();
    expect(vol.existsSync("/repo/WORKFLOW.md.lock")).toBe(false);
  });

  it("runs the recommended state machine handoff path as terminal with cleanup and no retry", async () => {
    vi.useFakeTimers();
    vol.fromJSON({
      "/repo/WORKFLOW.md": workflowFrontmatter({
        tasks: ["  type: yaml-file", "  path: /repo/recommended.yaml"],
        active_states: ["  - queued", "  - agent-running"],
        terminal_states: ["  - human-review", "  - failed", "  - archived", "  - done"],
        agent: ["  list: maestro"],
        workspace: ["  root: /repo/workspaces"],
        polling: ["  interval_ms: 25"]
      }),
      "/repo/.poe-code/pipeline/steps.yaml": [
        "steps:",
        "  implement:",
        "    agent: codex",
        "    mode: edit",
        "    prompt: Implement {{ prompt }}",
        "  verify:",
        "    agent: codex",
        "    mode: read",
        "    prompt: Verify {{ prompt }}",
        "teardown:",
        "  agent: codex",
        "  mode: read",
        "  prompt: Teardown {{ prompt }}"
      ].join("\n")
    });
    const taskList = await createYamlTaskList(
      "/repo/recommended.yaml",
      fs.promises as unknown as TaskListFs,
      maestroTaskStateMachine
    );
    const tasks = taskList.list("maestro");
    await tasks.create({ id: "handoff", name: "Handoff" });
    const events: MaestroEvent[] = [];
    const spawn = vi.fn(async (): Promise<SpawnResult> => {
      await tasks.fire("handoff", "handoff");
      return { stdout: "", stderr: "", exitCode: 0, threadId: "handoff-session" };
    });

    const stop = await runMaestro({
      workflowPath: "/repo/WORKFLOW.md",
      taskList,
      agentSpawn: spawn,
      onEvent: (event) => events.push(event)
    });
    await waitForCondition(() =>
      events.some((event) => event.type === "reconcile" && event.action === "stop_clean")
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.type === "attempt_phase").map((event) => event.to)).toEqual([
      "preparing-workspace",
      "running-step",
      "canceled"
    ]);
    expect(events.some((event) => event.type === "retry_scheduled")).toBe(false);
    await expect(tasks.get("handoff")).resolves.toMatchObject({ state: "human-review" });
    expect(vol.existsSync("/repo/workspaces/maestro_handoff")).toBe(false);

    await stop();
  });

  it("dry-runs validation and exits without spawning or creating a workflow lock", async () => {
    vol.fromJSON({
      "/repo/WORKFLOW.md": workflowFrontmatter({
        tasks: ["  type: yaml-file", "  path: /repo/tasks.yaml"],
        agent: ["  list: tasks"],
        workspace: ["  root: /repo/workspaces"],
        polling: ["  interval_ms: 25"]
      }),
      "/repo/.poe-code/pipeline/steps.yaml": [
        "steps:",
        "  implement:",
        "    agent: codex",
        "    mode: edit",
        "    prompt: Implement {{ prompt }}"
      ].join("\n")
    });
    const taskList = await createYamlTaskList("/repo/tasks.yaml", fs.promises as unknown as TaskListFs);
    const tasks = taskList.list("tasks");
    await tasks.create({ id: "one", name: "One", description: "Do the work" });
    await tasks.fire("one", "plan");
    const spawn = vi.fn(async (): Promise<SpawnResult> => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const logger = { info: vi.fn(), error: vi.fn() };
    const stop = await runMaestro({
      workflowPath: "/repo/WORKFLOW.md",
      dryRun: true,
      taskList,
      agentSpawn: spawn,
      logger
    });

    expect(spawn).not.toHaveBeenCalled();
    expect(vol.existsSync("/repo/WORKFLOW.md.lock")).toBe(false);
    expect(logger.info).toHaveBeenCalledWith("maestro config OK", {
      tasks: "yaml-file",
      list: "tasks"
    });
    expect(logger.info).toHaveBeenCalledWith("maestro task store open OK", {
      candidates: 1,
      candidateIds: ["tasks/one"],
      skipped: 0,
      skippedKinds: []
    });
    expect(logger.info).toHaveBeenCalledWith("maestro dry-run complete");

    await expect(stop()).resolves.toBeUndefined();
  });

  it("reports unsupported workflow kinds in dry-run candidate logs", async () => {
    vol.fromJSON({
      "/repo/WORKFLOW.md": workflowFrontmatter({
        tasks: ["  type: yaml-file", "  path: /repo/tasks.yaml"],
        agent: ["  list: tasks"],
        workspace: ["  root: /repo/workspaces"],
        polling: ["  interval_ms: 25"]
      }),
      "/repo/.poe-code/pipeline/steps.yaml": [
        "steps:",
        "  implement:",
        "    agent: codex",
        "    mode: edit",
        "    prompt: Implement {{ prompt }}"
      ].join("\n")
    });
    const activeTasks = [
      {
        list: "tasks",
        id: "one",
        qualifiedId: "tasks/one",
        name: "One",
        state: "planned",
        description: "Do the work",
        metadata: { kind: "pipeline" }
      },
      {
        list: "tasks",
        id: "two",
        qualifiedId: "tasks/two",
        name: "Two",
        state: "planned",
        description: "Coordinate the work",
        metadata: { kind: "superintendent" }
      }
    ];
    const taskList = {
      allTasks: async ({ state }: { state?: string } = {}) =>
        activeTasks.filter((task) => state === undefined || task.state === state),
      lists: async () => ["tasks"]
    } as TaskList;
    const spawn = vi.fn(async (): Promise<SpawnResult> => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const logger = { info: vi.fn(), error: vi.fn() };

    await runMaestro({
      workflowPath: "/repo/WORKFLOW.md",
      dryRun: true,
      taskList,
      agentSpawn: spawn,
      logger
    });

    expect(logger.info).toHaveBeenCalledWith("maestro task store open OK", {
      candidates: 2,
      candidateIds: ["tasks/one", "tasks/two"],
      skipped: 1,
      skippedKinds: ["superintendent"]
    });
  });
});

async function createYamlTaskList(
  filePath: string,
  fs: TaskListFs,
  stateMachine?: StateMachineDef
): Promise<TaskList> {
  return openTaskList({
    type: "yaml-file",
    path: filePath,
    create: true,
    fs,
    ...(stateMachine ? { stateMachine } : {})
  });
}

function workflowFrontmatter(parts: Record<string, string[]>): string {
  const lines = ["---"];

  for (const [key, value] of Object.entries(parts)) {
    lines.push(`${key}:`, ...value);
  }

  lines.push("---", "", "Work on {{ task.name }}.");
  return lines.join("\n");
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await flushMicrotasks();

    if (condition()) {
      return;
    }

    await vi.advanceTimersByTimeAsync(1);
  }

  throw new Error("Condition was not met.");
}
