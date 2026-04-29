import * as fsPromises from "node:fs/promises";
import {
  makeAgentModule,
  makeEnvModule,
  makeFailModule,
  makeHarnessModule,
  makeLogModule,
  makeMcpModule,
  makeTimeModule,
  runHarness
} from "@poe-code/agent-script";
import { spawn as spawnAgent } from "@poe-code/agent-spawn";
import { McpClient, StdioTransport } from "tiny-mcp-client";
import { resolveAbsolutePlanPath, resolvePlanPath } from "../plan/discovery.js";
import type {
  AgentRunInput,
  AgentRunResult,
  AgentRunUsage,
  PipelineMetrics,
  PipelineRunOptions,
  PipelineRunResult,
  TaskCompletion,
  TaskProgress
} from "../types.js";
import { isRecord } from "../utils.js";

type PipelineHarnessModulesFor = Parameters<typeof runHarness>[1]["modulesFor"];
type PipelineHarnessModules = ReturnType<PipelineHarnessModulesFor>;
type PipelineLogSink = NonNullable<Parameters<typeof makeLogModule>[0]>;
type PipelineLogEntry = Parameters<PipelineLogSink>[0];
type PipelineAgentResult = AgentRunResult & {
  durationMs: number;
};
type HarnessTaskRecord = {
  id: string;
  title: string;
  prompt: string;
  status: unknown;
};
type HarnessTaskProgress = TaskProgress & {
  startedAt: number;
};

class MaxRunsReachedError extends Error {
  constructor() {
    super("Reached the configured max runs.");
    this.name = "MaxRunsReachedError";
  }
}

function isMaxRunsReachedError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && (error as { name?: unknown }).name === "MaxRunsReachedError";
}

function createMetrics(): PipelineMetrics {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    stepsCompleted: 0
  };
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && (error as { name?: unknown }).name === "AbortError";
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

async function deleteIfExists(filepath: string): Promise<void> {
  try {
    await fsPromises.rm(filepath, { force: true });
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

function resolveSnapshotPath(absolutePlanPath: string): string {
  return `${absolutePlanPath}.snapshot.json`;
}

function readHarnessTasks(frontmatter: Record<string, unknown>): HarnessTaskRecord[] {
  if (!Array.isArray(frontmatter.tasks)) {
    return [];
  }

  return frontmatter.tasks.flatMap((task) => {
    if (!isRecord(task)) {
      return [];
    }

    const id = typeof task.id === "string" ? task.id : undefined;
    const title = typeof task.title === "string" ? task.title : undefined;
    const prompt = typeof task.prompt === "string" ? task.prompt : undefined;

    if (!id || !title || !prompt) {
      return [];
    }

    return [{
      id,
      title,
      prompt,
      status: task.status
    }];
  });
}

function isTaskDone(status: unknown): boolean {
  if (typeof status === "string") {
    return status === "done";
  }

  if (!isRecord(status)) {
    return false;
  }

  const values = Object.values(status);
  return values.length > 0 && values.every((value) => value === "done");
}

function isTaskFailed(status: unknown): boolean {
  if (typeof status === "string") {
    return status === "failed";
  }

  if (!isRecord(status)) {
    return false;
  }

  return Object.values(status).some((value) => value === "failed");
}

function filterFrontmatterTasks(
  frontmatter: Record<string, unknown>,
  taskId: string | undefined
): {
  frontmatter: Record<string, unknown>;
  summary: {
    done: number;
    failed: number;
    open: number;
    total: number;
  };
  tasks: HarnessTaskRecord[];
} {
  const allTasks = readHarnessTasks(frontmatter);

  if (!taskId) {
    return {
      frontmatter: {
        ...frontmatter,
        tasks: (frontmatter.tasks as unknown[] | undefined)?.filter((task) => {
          if (!isRecord(task) || typeof task.id !== "string") {
            return false;
          }

          const match = allTasks.find((candidate) => candidate.id === task.id);
          return match !== undefined && !isTaskDone(match.status);
        }) ?? []
      },
      summary: summarizeTasks(allTasks),
      tasks: allTasks.filter((task) => !isTaskDone(task.status))
    };
  }

  const selectedTask = allTasks.find((task) => task.id === taskId);
  if (!selectedTask) {
    throw new Error(`Task "${taskId}" was not found in the plan.`);
  }

  return {
    frontmatter: {
      ...frontmatter,
      tasks: (frontmatter.tasks as unknown[]).filter(
        (task) => isRecord(task) && task.id === taskId && !isTaskDone(task.status)
      )
    },
    summary: summarizeTasks([selectedTask]),
    tasks: isTaskDone(selectedTask.status) ? [] : [selectedTask]
  };
}

function summarizeTasks(tasks: readonly HarnessTaskRecord[]): {
  done: number;
  failed: number;
  open: number;
  total: number;
} {
  const done = tasks.filter((task) => isTaskDone(task.status)).length;
  const failed = tasks.filter((task) => isTaskFailed(task.status)).length;
  const total = tasks.length;

  return {
    done,
    failed,
    open: total - done - failed,
    total
  };
}

function updateUsage(metrics: PipelineMetrics, usage: AgentRunUsage | undefined): void {
  if (!usage) {
    return;
  }

  metrics.totalInputTokens += usage.inputTokens;
  metrics.totalOutputTokens += usage.outputTokens;
  metrics.totalCachedTokens += usage.cachedTokens ?? 0;
}

function readTaskPayload(value: unknown): { id?: string; title?: string; durationMs?: number } {
  if (!isRecord(value)) {
    return {};
  }

  return {
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.durationMs === "number" && Number.isFinite(value.durationMs)
      ? { durationMs: value.durationMs }
      : {})
  };
}

function createTaskProgressState(tasks: readonly HarnessTaskRecord[]): {
  setActiveFromEvent(entry: PipelineLogEntry): void;
  completeActiveTask(durationMs?: number): number | undefined;
  failActiveTask(): number | undefined;
  lastTaskId(): string | undefined;
} {
  const taskIndexById = new Map(tasks.map((task, index) => [task.id, index + 1] as const));
  const taskTitleById = new Map(tasks.map((task) => [task.id, task.title] as const));
  let activeTask: HarnessTaskProgress | undefined;
  let lastTaskId: string | undefined;

  const resolveProgress = (payload: { id?: string; title?: string }): HarnessTaskProgress | undefined => {
    const taskId = payload.id;
    if (!taskId) {
      return activeTask;
    }

    const taskIndex = taskIndexById.get(taskId);
    if (!taskIndex) {
      return undefined;
    }

    return {
      taskId,
      taskTitle: payload.title ?? taskTitleById.get(taskId) ?? taskId,
      taskIndex,
      totalTasks: tasks.length,
      startedAt: Date.now()
    };
  };

  return {
    setActiveFromEvent(entry) {
      if (entry.type !== "event" || (entry.name !== "task.started" && entry.name !== "task.start")) {
        return;
      }

      const progress = resolveProgress(readTaskPayload(entry.payload));
      if (!progress) {
        return;
      }

      activeTask = progress;
      lastTaskId = progress.taskId;
    },

    completeActiveTask(durationMs) {
      if (!activeTask) {
        return undefined;
      }

      lastTaskId = activeTask.taskId;
      const resolvedDuration = durationMs ?? Math.max(0, Date.now() - activeTask.startedAt);
      activeTask = undefined;
      return resolvedDuration;
    },

    failActiveTask() {
      if (!activeTask) {
        return undefined;
      }

      lastTaskId = activeTask.taskId;
      const resolvedDuration = Math.max(0, Date.now() - activeTask.startedAt);
      activeTask = undefined;
      return resolvedDuration;
    },

    lastTaskId() {
      return lastTaskId;
    }
  };
}

export async function runPipelineHarness(
  options: PipelineRunOptions
): Promise<PipelineRunResult> {
  const metrics = createMetrics();
  const planPath = await resolvePlanPath({
    cwd: options.cwd,
    homeDir: options.homeDir,
    plan: options.plan,
    planDirectory: options.planDirectory,
    assumeYes: options.assumeYes,
    fs: options.fs,
    selectPlan: options.selectPlan,
    promptForPath: options.promptForPath
  });

  if (!planPath) {
    return {
      stopReason: "cancelled",
      planPath: "",
      runsCompleted: 0,
      totalDurationMs: 0,
      metrics
    };
  }

  const absolutePlanPath = resolveAbsolutePlanPath(planPath, options.cwd, options.homeDir);
  const snapshotPath = resolveSnapshotPath(absolutePlanPath);
  const startedAt = Date.now();
  let agentRuns = 0;
  let lastTaskId: string | undefined;

  if (options.reset) {
    await deleteIfExists(snapshotPath);
  }

  try {
    const result = await runHarness(absolutePlanPath, {
      signal: options.signal,
      snapshotPath,
      modulesFor: (frontmatter, meta): PipelineHarnessModules => {
        const filtered = filterFrontmatterTasks(frontmatter, options.task);
        const taskState = createTaskProgressState(filtered.tasks);

        if (filtered.summary.total > 0 && filtered.summary.open === 0) {
          throw new MaxRunsReachedError();
        }

        options.onPlanResolved?.({
          planPath,
          ...filtered.summary
        });

        const completeTask = (success: boolean, durationMs?: number): void => {
          const currentTaskId = taskState.lastTaskId();
          if (!currentTaskId) {
            return;
          }

          const taskIndex = filtered.tasks.findIndex((task) => task.id === currentTaskId);
          if (taskIndex === -1) {
            return;
          }

          const progress: TaskCompletion = {
            taskId: currentTaskId,
            taskTitle: filtered.tasks[taskIndex]!.title,
            taskIndex: taskIndex + 1,
            totalTasks: filtered.tasks.length,
            durationMs: durationMs ?? 0,
            success,
            ...(success ? { taskCompleted: true } : {})
          };

          if (success) {
            metrics.tasksCompleted += 1;
            metrics.stepsCompleted += 1;
          } else {
            metrics.tasksFailed += 1;
          }

          options.onTaskComplete?.(progress);
        };

        const logSink: PipelineLogSink = (entry) => {
          taskState.setActiveFromEvent(entry);
          lastTaskId = taskState.lastTaskId();

          if (entry.type !== "event") {
            return;
          }

          if (entry.name === "task.started" || entry.name === "task.start") {
            const payload = readTaskPayload(entry.payload);
            const taskId = payload.id;
            if (!taskId) {
              return;
            }

            const taskIndex = filtered.tasks.findIndex((task) => task.id === taskId);
            if (taskIndex === -1) {
              return;
            }

            options.onTaskStart?.({
              taskId,
              taskTitle: payload.title ?? filtered.tasks[taskIndex]!.title,
              taskIndex: taskIndex + 1,
              totalTasks: filtered.tasks.length
            });
            return;
          }

          if (
            entry.name === "task.completed"
            || entry.name === "task.complete"
            || entry.name === "task.done"
          ) {
            const payload = readTaskPayload(entry.payload);
            completeTask(true, taskState.completeActiveTask(payload.durationMs));
            return;
          }

          if (entry.name === "task.failed") {
            completeTask(false, taskState.failActiveTask());
          }
        };

        const runAgent = async (input: AgentRunInput): Promise<PipelineAgentResult> => {
          if (options.maxRuns !== undefined && agentRuns >= options.maxRuns) {
            throw new MaxRunsReachedError();
          }

          const startedAt = Date.now();
          const resolvedInput: AgentRunInput = {
            agent: options.agent,
            prompt: input.prompt,
            mode: input.mode ?? "yolo",
            cwd: input.cwd ?? options.cwd,
            logDir: input.logDir ?? options.logDir,
            ...(options.model ? { model: options.model } : input.model ? { model: input.model } : {}),
            ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
            ...(options.signal ? { signal: options.signal } : {})
          };

          const result = options.runAgent
            ? await options.runAgent(resolvedInput)
            : await spawnAgent(resolvedInput.agent, {
                prompt: resolvedInput.prompt,
                cwd: resolvedInput.cwd,
                logDir: resolvedInput.logDir,
                model: resolvedInput.model,
                mode: resolvedInput.mode,
                ...(resolvedInput.mcpServers ? { mcpServers: resolvedInput.mcpServers } : {}),
                ...(resolvedInput.signal ? { signal: resolvedInput.signal } : {})
              });

          agentRuns += 1;
          updateUsage(metrics, result.usage);
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            ...(result.threadId ? { threadId: result.threadId } : {}),
            ...(result.usage ? { usage: result.usage } : {}),
            durationMs: "durationMs" in result && typeof result.durationMs === "number"
              ? result.durationMs
              : Date.now() - startedAt
          };
        };

        return {
          agent: makeAgentModule(async (input) => {
            const result = await runAgent({
              agent: input.agent,
              prompt: input.prompt,
              cwd: input.cwd ?? options.cwd,
              mode: input.mode ?? "yolo",
              ...(input.model ? { model: input.model } : {}),
              ...(input.mcp ? { mcpServers: input.mcp } : {}),
              ...(options.logDir ? { logDir: options.logDir } : {}),
              ...(options.signal ? { signal: options.signal } : {})
            });

            return {
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
              summary: result.stdout.trim(),
              durationMs: result.durationMs
            };
          }),
          harness: makeHarnessModule(filtered.frontmatter, meta),
          mcp: makeMcpModule(async (server) => {
            const client = new McpClient({
              clientInfo: {
                name: "poe-code-pipeline",
                version: "0.0.0"
              }
            });

            await client.connect(
              new StdioTransport({
                command: server.command,
                ...(server.args === undefined ? {} : { args: server.args }),
                ...(server.env === undefined ? {} : { env: server.env })
              })
            );

            return {
              listTools: async () => client.listTools(),
              callTool: async (params) =>
                client.callTool({
                  name: params.name,
                  ...(params.arguments === undefined
                    ? {}
                    : { arguments: params.arguments as Record<string, unknown> })
                })
            };
          }),
          log: makeLogModule(logSink),
          env: makeEnvModule([]),
          fail: makeFailModule(),
          time: makeTimeModule()
        } as PipelineHarnessModules;
      }
    });

    if (!result.ok && lastTaskId && metrics.tasksFailed === 0) {
      metrics.tasksFailed += 1;
    }

    return {
      stopReason: result.ok ? "completed" : "failed",
      planPath,
      runsCompleted: agentRuns,
      totalDurationMs: Date.now() - startedAt,
      metrics,
      ...(lastTaskId ? { lastTaskId } : {})
    };
  } catch (error) {
    if (isMaxRunsReachedError(error)) {
      return {
        stopReason: agentRuns === 0 ? "nothing_to_run" : "max_runs",
        planPath,
        runsCompleted: agentRuns,
        totalDurationMs: Date.now() - startedAt,
        metrics,
        ...(lastTaskId ? { lastTaskId } : {})
      };
    }

    if (options.signal?.aborted || isAbortError(error)) {
      return {
        stopReason: "cancelled",
        planPath,
        runsCompleted: agentRuns,
        totalDurationMs: Date.now() - startedAt,
        metrics,
        ...(lastTaskId ? { lastTaskId } : {})
      };
    }

    if (lastTaskId) {
      metrics.tasksFailed += 1;
    }

    return {
      stopReason: "failed",
      planPath,
      runsCompleted: agentRuns,
      totalDurationMs: Date.now() - startedAt,
      metrics,
      ...(lastTaskId ? { lastTaskId } : {})
    };
  }
}
