import type { SpawnResult } from "@poe-code/agent-spawn";
import type { Task } from "@poe-code/task-list";
import { expect, vi } from "vitest";

import type { AttemptEvent } from "../agent/runner.js";
import type { WorkflowDefinition } from "../config/load.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { MaestroState } from "../runtime/state.js";
import type { WorkflowDriverContext } from "../drivers/types.js";
import type { TickDeps } from "../runtime/loop.js";
import { createMockSpawn } from "./mock-spawn.js";
import { createMockTaskList } from "./mock-task-list.js";

type ConfigOverrides = Partial<Omit<ResolvedConfig, "agent">> & {
  agent?: Partial<ResolvedConfig["agent"]>;
  maxConcurrentAgents?: number;
};

type DriverContextOverrides = Partial<WorkflowDriverContext> & {
  events?: AttemptEvent[];
};

type TaskOverrides = Partial<Task> & { url?: string };

const defaultState = "planned";
const defaultTaskId = "task-1";
const defaultTaskList = "tasks";
const defaultWorkspaceRoot = "/__memfs__/workspaces";

export function createTask(overrides: TaskOverrides = {}): Task {
  const parsed = parseQualifiedId(overrides.qualifiedId);
  const list = overrides.list ?? parsed?.list ?? defaultTaskList;
  const id = overrides.id ?? parsed?.id ?? defaultTaskId;
  const qualifiedId = overrides.qualifiedId ?? `${list}/${id}`;
  const name = overrides.name ?? (overrides.qualifiedId === undefined ? "Build runner" : id);

  const task: Task & { url?: string } = {
    ...overrides,
    list,
    id,
    qualifiedId,
    name,
    state: overrides.state ?? defaultState,
    description: overrides.description ?? "Render this task body",
    metadata: overrides.metadata ?? {},
    url: overrides.url
  };

  return task;
}

export function createConfig(overrides: ConfigOverrides = {}): ResolvedConfig {
  const states = overrides.states ?? {
    planned: { prompt: "Plan {{ prompt }}" },
    done: { terminal: true }
  };

  return {
    tasks: { type: "markdown-dir", path: "/__memfs__/tasks" },
    polling: { intervalMs: 30_000 },
    workspace: { root: defaultWorkspaceRoot },
    ...withoutAgent(overrides),
    states,
    activeStateNames:
      overrides.activeStateNames ?? stateNamesBy(states, (state) => state.prompt !== undefined),
    terminalStateNames:
      overrides.terminalStateNames ?? stateNamesBy(states, (state) => state.terminal === true),
    stateOrder: overrides.stateOrder ?? Object.keys(states),
    agent: {
      service: "codex",
      list: defaultTaskList,
      maxConcurrentAgents:
        overrides.agent?.maxConcurrentAgents ?? overrides.maxConcurrentAgents ?? 1,
      maxRetryBackoffMs: 300_000,
      ...overrides.agent
    }
  };
}

export function createTickDeps(overrides: Partial<TickDeps> = {}): TickDeps {
  const mockSpawn = createMockSpawn();

  return {
    tasks: createMockTaskList(),
    validateDispatch: async () => ({ ok: true }),
    reconcileRunning: async () => [],
    ensureWorkspace: async (_root, qualifiedId) => ({
      path: `${defaultWorkspaceRoot}/${qualifiedId.replaceAll("/", "_")}`,
      createdNow: true
    }),
    runAttempt: async () => ({ reason: "abnormal", failure: "canceled" }),
    spawn: mockSpawn.spawn,
    now: () => 0,
    ...overrides
  };
}

export function createDriverContext(overrides: DriverContextOverrides = {}): WorkflowDriverContext {
  const events = overrides.events ?? [];
  const mockSpawn = createMockSpawn();

  return {
    task: createTask(),
    attempt: 1,
    workspaceDir: `${defaultWorkspaceRoot}/${defaultTaskId}`,
    planPath: "/__memfs__/tasks/task-1.md",
    cfg: createConfig(),
    abort: new AbortController().signal,
    emit: (event) => events.push(event),
    spawn: mockSpawn.spawn,
    logger: { warn: () => undefined },
    ...withoutEvents(overrides)
  };
}

export function createWorkflowDefinition(
  overrides: Partial<WorkflowDefinition> = {}
): WorkflowDefinition {
  return {
    sourcePath: "/__memfs__/WORKFLOW.md",
    config: createConfig(),
    promptTemplate: "{{ task.description }}",
    ...overrides
  };
}

export function successSpawn(overrides: Partial<SpawnResult> = {}): SpawnResult {
  return { stdout: "", stderr: "", exitCode: 0, ...overrides };
}

export function assertNoLeakedWorkers(
  state: Pick<MaestroState, "running" | "claimed">,
  workers: Pick<Map<string, unknown>, "keys" | "size">
): void {
  expect({
    workers: [...workers.keys()],
    running: [...state.running.keys()],
    claimed: [...state.claimed.values()]
  }).toEqual({
    workers: [],
    running: [],
    claimed: []
  });
}

export async function assertEventually(
  predicate: () => boolean | Promise<boolean>,
  options: {
    ticks: number;
    tick: () => void | Promise<void>;
    advanceMs?: number;
  }
): Promise<number> {
  for (let tickCount = 0; tickCount <= options.ticks; tickCount += 1) {
    if (await predicate()) {
      return tickCount;
    }

    if (tickCount === options.ticks) {
      break;
    }

    await vi.advanceTimersByTimeAsync(options.advanceMs ?? 1);
    await options.tick();
    await Promise.resolve();
  }

  expect(await predicate()).toBe(true);
  return options.ticks;
}

function parseQualifiedId(qualifiedId: string | undefined): { list: string; id: string } | null {
  if (qualifiedId === undefined) {
    return null;
  }

  const separatorIndex = qualifiedId.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === qualifiedId.length - 1) {
    return null;
  }

  return {
    list: qualifiedId.slice(0, separatorIndex),
    id: qualifiedId.slice(separatorIndex + 1)
  };
}

function stateNamesBy(
  states: ResolvedConfig["states"],
  predicate: (state: ResolvedConfig["states"][string]) => boolean
): string[] {
  return Object.entries(states)
    .filter(([, state]) => predicate(state))
    .map(([name]) => name);
}

function withoutAgent(overrides: ConfigOverrides): Partial<Omit<ResolvedConfig, "agent">> {
  const {
    agent: ignoredAgent,
    maxConcurrentAgents: ignoredMaxConcurrentAgents,
    ...rest
  } = overrides;
  return rest;
}

function withoutEvents(overrides: DriverContextOverrides): Partial<WorkflowDriverContext> {
  const { events: ignoredEvents, ...rest } = overrides;
  return rest;
}
