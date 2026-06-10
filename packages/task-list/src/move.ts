import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { findEvent } from "./state-machine.js";
import { openTaskList } from "./open.js";
import type {
  MoveResult,
  MoveTasksOptions,
  Task,
  TaskListFs,
  TaskListOptions,
  Tasks
} from "./types.js";

export async function moveTasks(options: MoveTasksOptions): Promise<MoveResult> {
  const rate = options.rate ?? 15;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError("moveTasks rate must be a positive number.");
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 0)) {
    throw new RangeError("moveTasks limit must be a non-negative integer.");
  }

  const source = await openTaskList(readOnlySourceOptions(options.source));
  const tasks = (await source.allTasks({ includeArchived: true })).slice(0, options.limit);
  const result: MoveResult = { created: 0, skipped: 0, errors: [] };
  if (tasks.length === 0) {
    return result;
  }

  const target = await openTaskList(readOnlyTargetOptions(options.target, options.dryRun));
  const targetLists = new Map<string, Tasks>();
  const takeToken = createTokenBucket(rate);

  for (const task of tasks) {
    let targetTasks: Tasks;
    let targetState: string;
    let createdTarget: Task | undefined;

    try {
      targetTasks = await resolveTargetTasks(task, target, targetLists);
      targetState = options.stateMap?.[task.state] ?? targetTasks.stateMachine.initial;

      const transitionEvents = findTransitionEvents(
        targetTasks,
        targetTasks.stateMachine.initial,
        targetState
      );
      if (targetTasks.stateMachine.initial !== targetState && transitionEvents === undefined) {
        throw new Error(
          `Cannot migrate task state from "${targetTasks.stateMachine.initial}" to "${targetState}".`
        );
      }

      if (options.dryRun) {
        result.skipped += 1;
        emitProgress(options, {
          type: "skipped",
          id: task.id,
          source: task,
          targetList: targetTasks.name,
          targetState,
          reason: "dry-run"
        });
        continue;
      }

      await takeToken();
      let created = await targetTasks.create({
        id: task.id,
        name: task.name,
        description: task.description,
        metadata: task.metadata
      });
      createdTarget = created;
      created = await applyState(targetTasks, created, transitionEvents ?? []);

      if (options.deleteSource === true) {
        await source.list(task.list).delete(task.id);
      }

      result.created += 1;

      emitProgress(options, {
        type: "created",
        id: task.id,
        source: task,
        target: created,
        targetList: targetTasks.name,
        targetState
      });
    } catch (error) {
      let message = errorMessage(error);
      if (createdTarget !== undefined) {
        try {
          await targetTasks!.delete(createdTarget.id);
        } catch (rollbackError) {
          message = `${message} Rollback failed: ${errorMessage(rollbackError)}`;
        }
      }
      result.errors.push({ id: task.id, error: message });
      emitProgress(options, { type: "error", id: task.id, source: task, error: message });
    }
  }

  return result;
}

function emitProgress(
  options: MoveTasksOptions,
  event: Parameters<NonNullable<MoveTasksOptions["onProgress"]>>[0]
): void {
  try {
    options.onProgress?.(event);
  } catch {
    return;
  }
}

async function resolveTargetTasks(
  sourceTask: Task,
  target: Awaited<ReturnType<typeof openTaskList>>,
  targetLists: Map<string, Tasks>
): Promise<Tasks> {
  const cached = targetLists.get(sourceTask.list);
  if (cached !== undefined) {
    return cached;
  }

  let tasks: Tasks;
  try {
    tasks = target.list(sourceTask.list);
  } catch (error) {
    const lists = await target.lists();
    if (lists.length !== 1) {
      throw error;
    }
    tasks = target.list(lists[0]);
  }

  targetLists.set(sourceTask.list, tasks);
  return tasks;
}

async function applyState(tasks: Tasks, created: Task, events: readonly string[]): Promise<Task> {
  let task = created;
  for (const event of events) {
    task = await tasks.fire(task.id, event);
  }
  return task;
}

function readOnlySourceOptions<TOptions extends TaskListOptions>(options: TOptions): TOptions {
  if (!hasOwnProperty(options, "create")) {
    return options;
  }

  return { ...options, create: false };
}

function readOnlyTargetOptions(
  options: TaskListOptions,
  dryRun: boolean | undefined
): TaskListOptions {
  if (!dryRun || options.type === "gh-issues") {
    return options;
  }

  return {
    ...options,
    create: true,
    fs: createDryRunFs(
      options.fs ?? (fsPromises as unknown as TaskListFs),
      options.path,
      options.type
    )
  };
}

function createDryRunFs(
  fs: TaskListFs,
  targetPath: string,
  targetType: "markdown-dir" | "yaml-file"
): TaskListFs {
  const resolvedTargetPath = path.resolve(targetPath);
  const unexpectedWrite = async (): Promise<never> => {
    throw new Error("moveTasks dryRun attempted to write to the target backend.");
  };

  return {
    ...fs,
    async mkdir(directoryPath: string): Promise<void> {
      if (path.resolve(directoryPath) !== resolvedTargetPath) {
        await unexpectedWrite();
      }
    },
    async stat(filePath: string) {
      try {
        return await fs.stat(filePath);
      } catch (error) {
        if (path.resolve(filePath) !== resolvedTargetPath) {
          throw error;
        }

        return {
          isDirectory: () => targetType === "markdown-dir",
          isFile: () => targetType === "yaml-file",
          mtimeMs: 0
        };
      }
    },
    rename: unexpectedWrite,
    unlink: unexpectedWrite,
    writeFile: unexpectedWrite
  };
}

function findTransitionEvents(
  tasks: Tasks,
  fromState: string,
  targetState: string
): string[] | undefined {
  if (fromState === targetState) {
    return [];
  }
  const queue: Array<{ state: string; events: string[] }> = [{ state: fromState, events: [] }];
  const visited = new Set([fromState]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      return undefined;
    }
    for (const eventName of Object.keys(tasks.stateMachine.events)) {
      const event = findEvent(tasks.stateMachine, current.state, eventName);
      if (event === undefined) {
        continue;
      }
      const events = [...current.events, eventName];
      if (event.to === targetState) {
        return events;
      }
      if (!visited.has(event.to)) {
        visited.add(event.to);
        queue.push({ state: event.to, events });
      }
    }
  }

  return undefined;
}

function createTokenBucket(rate: number): () => Promise<void> {
  const intervalMs = 60_000 / rate;
  const capacity = Math.max(1, rate);
  let tokens = capacity;
  let lastRefill = Date.now();

  return async () => {
    while (true) {
      const now = Date.now();
      tokens = Math.min(capacity, tokens + (now - lastRefill) / intervalMs);
      lastRefill = now;
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, Math.ceil((1 - tokens) * intervalMs));
      });
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasOwnProperty(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
