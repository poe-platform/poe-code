import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import {
  acp,
  cancel,
  createDashboard,
  isCancel,
  multiselect,
  promptText,
  select
} from "@poe-code/design-system";
import { resolveAgentId, parseAgentSpecifier, formatAgentSpecifier, allAgents } from "@poe-code/agent-defs";
import {
  isActivityTimeoutError,
  renderAcpEvent,
  type AcpEvent
} from "@poe-code/agent-spawn";
import {
  installSkill,
  resolveAgentSupport,
  supportedAgents,
  type SkillScope
} from "@poe-code/agent-skill-config";
import {
  readMergedDocument,
  resolveScope
} from "@poe-code/poe-code-config";
import type { CliContainer } from "../container.js";
import { pipelineConfigScope } from "../../services/config.js";
import { ValidationError } from "../errors.js";
import {
  createExecutionResources,
  resolveCommandFlags
} from "./shared.js";
import {
  runPipeline as sdkRunPipeline,
  type AgentRunUsage,
  type PipelineRunOptions,
  type PipelineRunResult,
  type PlanSummary,
  type TaskProgress
} from "../../sdk/pipeline.js";
import { spawn as sdkSpawn } from "../../sdk/spawn.js";
import {
  buildExecutionPrompt,
  interpolate,
  loadResolvedSteps,
  parsePlan,
  resolveAbsolutePlanPath,
  resolveFileIncludes,
  resolvePlanDirectory,
  resolvePlanPaths
} from "@poe-code/pipeline";
import {
  createDashboardLineBuffer,
  formatDashboardDuration,
  formatDashboardTimestamp,
  registerDashboardQuitCommands,
  shouldUseInteractiveDashboard
} from "./dashboard-loop-shared.js";

async function resolvePipelineCommandConfig(container: CliContainer): Promise<{
  planDirectory?: string;
  tui: boolean;
}> {
  const configDoc = await readMergedDocument(
    container.fs,
    container.env.configPath,
    container.env.projectConfigPath
  );
  const pipelineConfig = resolveScope(
    pipelineConfigScope.schema,
    configDoc[pipelineConfigScope.scope],
    container.env.variables
  );
  const planDirectory = pipelineConfig.plan_directory?.trim();
  return {
    ...(planDirectory ? { planDirectory } : {}),
    tui: pipelineConfig.tui === true
  };
}

const DEFAULT_PIPELINE_AGENT = "claude-code";
const DEFAULT_PIPELINE_SCOPE: SkillScope = "local";
let pipelineTemplatesCache: { skillPlan: string; steps: string } | null = null;

type PipelineInstallCommandOptions = {
  force?: boolean;
  agent?: string;
  local?: boolean;
  global?: boolean;
};

type TaskCompletion = TaskProgress & {
  durationMs: number;
  success: boolean;
  usage?: AgentRunUsage;
};

type PipelineDashboardRunOptions = {
  agent: string;
  model?: string;
  planPath: string;
  planIndex: number;
  totalPlans: number;
  runOptions: PipelineRunOptions;
};

function resolvePipelineAgent(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    return DEFAULT_PIPELINE_AGENT;
  }

  const specifier = parseAgentSpecifier(value.trim());
  const resolved = resolveAgentId(specifier.agent);
  if (!resolved) {
    const supported = allAgents.map((a) => a.id).join(", ");
    throw new ValidationError(`Unsupported agent: ${specifier.agent}. Supported agents: ${supported}`);
  }

  return formatAgentSpecifier({ agent: resolved, model: specifier.model });
}

function resolveMaxRuns(value: string | undefined): number | undefined {
  if (value == null) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new ValidationError(
      `Invalid max-runs "${value}". Expected a positive integer.`
    );
  }

  return parsed;
}

function formatRunSummary(result: PipelineRunResult): string {
  const metrics = result.metrics;

  return [
    `Runs: ${result.runsCompleted}`,
    `tasksCompleted: ${metrics.tasksCompleted}, tasksFailed: ${metrics.tasksFailed}, stepsCompleted: ${metrics.stepsCompleted}`,
    `Total tokens: ${metrics.totalInputTokens} input, ${metrics.totalOutputTokens} output, ${metrics.totalCachedTokens} cached`,
    `Duration: ${formatDashboardDuration(result.totalDurationMs)}`
  ].join("\n   ");
}

function formatPipelineConfigSummary(options: {
  agent: string;
  model?: string;
  planPath: string;
  planIndex: number;
  totalPlans: number;
}): string {
  const parts = [`Agent: ${options.agent}`];
  if (options.model) {
    parts.push(`Model: ${options.model}`);
  }
  parts.push(`Plan: ${options.planPath}`);
  if (options.totalPlans > 1) {
    parts.push(`Sequence: ${options.planIndex + 1}/${options.totalPlans}`);
  }
  return parts.join(" · ");
}

function formatPipelineTasksSummary(summary: PlanSummary): string {
  const parts = [`${summary.done}/${summary.total} done`];
  if (summary.failed) {
    parts.push(`${summary.failed} failed`);
  }
  if (summary.open) {
    parts.push(`${summary.open} open`);
  }
  return parts.join(", ");
}

function formatTaskStartMessage(progress: TaskProgress): string {
  if (progress.phase) {
    return `${progress.taskTitle}...`;
  }

  const step = progress.stepName ? ` (${progress.stepName})` : "";
  const stepCounter =
    progress.stepIndex !== undefined && progress.totalSteps !== undefined
      ? ` step ${progress.stepIndex}/${progress.totalSteps}`
      : "";

  return `Task ${progress.taskIndex}/${progress.totalTasks}: ${progress.taskId}${step}${stepCounter}`;
}

function formatTaskCompleteMessage(progress: TaskCompletion): string {
  const duration = formatDashboardDuration(progress.durationMs);
  const status = progress.success ? "done" : "failed";
  const usage = progress.usage
    ? ` (tokens: ${progress.usage.inputTokens} in / ${progress.usage.outputTokens} out)`
    : "";

  if (progress.phase) {
    return `${progress.taskTitle} ${status} in ${duration}${usage}`;
  }

  return `Task ${progress.taskId} ${status} in ${duration}${usage}`;
}

function formatDashboardCurrentAction(progress: TaskProgress): string {
  if (progress.phase) {
    return progress.taskTitle;
  }

  const parts = [`Task ${progress.taskIndex}/${progress.totalTasks}`, progress.taskId];
  if (progress.stepName) {
    parts.push(progress.stepName);
  }
  if (progress.stepIndex !== undefined && progress.totalSteps !== undefined) {
    parts.push(`step ${progress.stepIndex}/${progress.totalSteps}`);
  }

  return parts.join(" · ");
}

function formatPipelineStageLabel(progress: TaskProgress): string {
  if (progress.phase) {
    return progress.phase;
  }

  return progress.stepName ? `${progress.taskId}:${progress.stepName}` : progress.taskId;
}

async function streamAcpEventsToDashboard(options: {
  events: AsyncIterable<AcpEvent>;
  onToolOutput(chunk: string): void;
  onErrorOutput(chunk: string): void;
}): Promise<boolean> {
  let sawEvents = false;
  let messageBuffer = "";
  let reasoningBuffer = "";

  const emitRendered = async (kind: "tool" | "error", event: AcpEvent): Promise<void> => {
    await acp.withAcpWriter((line) => {
      if (kind === "error") {
        options.onErrorOutput(`${line}\n`);
        return;
      }
      options.onToolOutput(`${line}\n`);
    }, async () => {
      renderAcpEvent(event);
    });
  };

  const flushMessageBuffer = async (): Promise<void> => {
    if (messageBuffer.length === 0) {
      return;
    }
    await emitRendered("tool", {
      event: "agent_message",
      text: messageBuffer
    });
    messageBuffer = "";
  };

  const flushReasoningBuffer = async (): Promise<void> => {
    if (reasoningBuffer.length === 0) {
      return;
    }
    await emitRendered("tool", {
      event: "reasoning",
      text: reasoningBuffer
    });
    reasoningBuffer = "";
  };

  for await (const event of options.events) {
    sawEvents = true;

    if (event.event === "agent_message") {
      await flushReasoningBuffer();
      messageBuffer += event.text;
      continue;
    }

    if (event.event === "reasoning") {
      await flushMessageBuffer();
      reasoningBuffer += event.text;
      continue;
    }

    await flushMessageBuffer();
    await flushReasoningBuffer();
    await emitRendered(event.event === "error" ? "error" : "tool", event);
  }

  await flushMessageBuffer();
  await flushReasoningBuffer();

  return sawEvents;
}

function createPipelineDashboardRunAgent(options: {
  appendOutput: (kind: "tool" | "error", message: string) => void;
  activeStage: () => string;
}): NonNullable<PipelineRunOptions["runAgent"]> {
  return async (input) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const toolBuffer = createDashboardLineBuffer((line) => {
        options.appendOutput("tool", `[${options.activeStage()}] ${line}`);
      });
      const errorBuffer = createDashboardLineBuffer((line) => {
        options.appendOutput("error", `[${options.activeStage()}] ${line}`);
      });
      let sawStdout = false;
      let sawStderr = false;

      try {
        const { events, result } = sdkSpawn(input.agent, {
          prompt: input.prompt,
          cwd: input.cwd,
          logDir: input.logDir,
          model: input.model,
          mode: input.mode,
          ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
          tee: {
            stdout: {
              write(chunk: string) {
                sawStdout = true;
                toolBuffer.push(chunk);
              }
            },
            stderr: {
              write(chunk: string) {
                sawStderr = true;
                errorBuffer.push(chunk);
              }
            }
          },
          activityTimeoutMs: 10 * 60 * 1000
        });

        const eventStream = streamAcpEventsToDashboard({
          events,
          onToolOutput(chunk) {
            toolBuffer.push(chunk);
          },
          onErrorOutput(chunk) {
            errorBuffer.push(chunk);
          }
        });

        const [spawnResult, sawEvents] = await Promise.all([result, eventStream]);

        if (!sawEvents && !sawStdout && spawnResult.stdout.length > 0) {
          toolBuffer.push(spawnResult.stdout);
        }

        if (!sawStderr && spawnResult.stderr.length > 0) {
          errorBuffer.push(spawnResult.stderr);
        }

        toolBuffer.flush();
        errorBuffer.flush();
        return spawnResult;
      } catch (error) {
        toolBuffer.flush();
        errorBuffer.flush();

        if (!isActivityTimeoutError(error) || attempt === 3) {
          throw error;
        }
      }
    }

    throw new Error("Unreachable");
  };
}

function dashboardStatusForResult(
  result: PipelineRunResult
): "done" | "error" {
  return result.stopReason === "failed" ? "error" : "done";
}

async function runPipelineWithDashboard(
  options: PipelineDashboardRunOptions
): Promise<PipelineRunResult> {
  const dashboard = createDashboard({
    title: "Pipeline",
    statsTitle: "Run",
    rightPaneWidth: 32,
    hints: [
      { key: "q", label: "Quit" },
      { key: "↑↓", label: "Scroll" },
      { key: "F", label: "Follow" }
    ]
  });
  const abortController = new AbortController();
  const startedAt = Date.now();
  let iterations = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let currentAction: string | undefined;
  let currentStage = "pipeline";
  let status: "running" | "done" | "error" = "running";

  const syncStats = (): void => {
    dashboard.updateStats({
      status,
      iterations,
      tokensIn,
      tokensOut,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      ...(currentAction ? { currentAction } : {})
    });
  };

  const appendOutput = (
    kind: "info" | "success" | "error" | "tool" | "status",
    message: string
  ): void => {
    dashboard.appendOutput({
      kind,
      text: `${formatDashboardTimestamp(Date.now())} ${message}`,
      ts: Date.now()
    });
  };

  const requestCancellation = (): void => {
    if (abortController.signal.aborted) {
      return;
    }

    abortController.abort();
    currentAction = "Cancelling";
    appendOutput("status", "Cancellation requested");
    syncStats();
  };

  registerDashboardQuitCommands({
    abortController,
    dashboard,
    requestCancellation
  });
  dashboard.start();
  syncStats();

  const intervalId = global.setInterval(() => {
    syncStats();
  }, 1_000);
  const sigintHandler = () => {
    requestCancellation();
  };
  process.on("SIGINT", sigintHandler);

  try {
    const result = await sdkRunPipeline({
      ...options.runOptions,
      runAgent: createPipelineDashboardRunAgent({
        appendOutput,
        activeStage: () => currentStage
      }),
      signal: abortController.signal,
      onPlanReloadError(error: Error) {
        appendOutput("error", `Plan reload failed, using last good state: ${error.message}`);
      },
      onPlanResolved(summary: PlanSummary) {
        appendOutput(
          "info",
          `Config · ${formatPipelineConfigSummary({
            agent: options.agent,
            model: options.model,
            planPath: summary.planPath,
            planIndex: options.planIndex,
            totalPlans: options.totalPlans
          })}`
        );
        appendOutput("info", `Tasks · ${formatPipelineTasksSummary(summary)}`);
        syncStats();
      },
      onTaskStart(progress: TaskProgress) {
        currentStage = formatPipelineStageLabel(progress);
        currentAction = formatDashboardCurrentAction(progress);
        appendOutput("status", formatTaskStartMessage(progress));
        syncStats();
      },
      onTaskComplete(progress: TaskCompletion) {
        iterations += 1;
        if (progress.usage) {
          tokensIn += progress.usage.inputTokens;
          tokensOut += progress.usage.outputTokens;
        }
        appendOutput(progress.success ? "success" : "error", formatTaskCompleteMessage(progress));
        syncStats();
      }
    });

    status = dashboardStatusForResult(result);
    syncStats();
    return result;
  } catch (error) {
    status = "error";
    currentAction = undefined;
    appendOutput("error", error instanceof Error ? error.message : String(error));
    syncStats();
    throw error;
  } finally {
    global.clearInterval(intervalId);
    process.off("SIGINT", sigintHandler);
    dashboard.stop();
    dashboard.destroy();
  }
}

function resolvePipelinePaths(scope: SkillScope, cwd: string, homeDir: string): {
  plansPath: string;
  stepsPath: string;
  displayPlansPath: string;
  displayStepsPath: string;
} {
  const rootPath =
    scope === "global"
      ? path.join(homeDir, ".poe-code", "pipeline")
      : path.join(cwd, ".poe-code", "pipeline");
  const displayRoot =
    scope === "global" ? "~/.poe-code/pipeline" : ".poe-code/pipeline";

  return {
    plansPath: path.join(rootPath, "plans"),
    stepsPath: path.join(rootPath, "steps.yaml"),
    displayPlansPath: `${displayRoot}/plans`,
    displayStepsPath: `${displayRoot}/steps.yaml`
  };
}

async function loadPipelineTemplates(): Promise<{
  skillPlan: string;
  steps: string;
}> {
  if (pipelineTemplatesCache) {
    return pipelineTemplatesCache;
  }

  const packageRoot = await findPackageRoot(fileURLToPath(import.meta.url));
  const templateRoots = [
    path.join(packageRoot, "src", "templates", "pipeline"),
    path.join(packageRoot, "dist", "templates", "pipeline")
  ];

  for (const templateRoot of templateRoots) {
    if (!(await pathExistsOnDisk(templateRoot))) {
      continue;
    }

    const [skillPlan, steps] = await Promise.all([
      readFile(path.join(templateRoot, "SKILL_plan.md"), "utf8"),
      readFile(path.join(templateRoot, "steps.yaml.mustache"), "utf8")
    ]);

    pipelineTemplatesCache = { skillPlan, steps };
    return pipelineTemplatesCache;
  }

  throw new Error("Pipeline templates not found.");
}

async function pathExistsOnDisk(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function findPackageRoot(entryFilePath: string): Promise<string> {
  let currentPath = path.dirname(entryFilePath);

  while (true) {
    if (await pathExistsOnDisk(path.join(currentPath, "package.json"))) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      throw new Error("Unable to locate package root for Pipeline templates.");
    }
    currentPath = parentPath;
  }
}

async function pathExists(
  fs: CliContainer["fs"],
  targetPath: string
): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

export function registerPipelineCommand(
  program: Command,
  container: CliContainer
): void {
  const pipeline = program
    .command("pipeline")
    .description("Run a fixed-step task pipeline plan.")
    .addHelpCommand(false);

  pipeline
    .command("run")
    .description("Run the selected pipeline plan until completion, failure, cancellation, or max runs.")
    .option("--agent <name>", "Agent to run each pipeline step with")
    .option("--model <model>", "Model override passed to the agent")
    .option("--tui", "Show a live dashboard while the pipeline is running")
    .option("--no-tui", "Disable the live dashboard for this pipeline run")
    .option("--task <id>", "Run only the specified task")
    .option("--plan <path>", "Path to the pipeline plan file")
    .option("--plans <paths...>", "Paths to pipeline plan files to run sequentially")
    .option("--max-runs <n>", "Maximum number of agent executions to perform")
    .action(async function (this: Command) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(
        container,
        flags,
        "pipeline:run"
      );
      const options = this.opts<{
        agent?: string;
        model?: string;
        tui?: boolean;
        task?: string;
        plan?: string;
        plans?: string[];
        maxRuns?: string;
      }>();

      resources.logger.intro("pipeline run");

      try {
        let agent: string;
        if (options.agent) {
          agent = resolvePipelineAgent(options.agent);
        } else if (flags.assumeYes) {
          agent = DEFAULT_PIPELINE_AGENT;
        } else {
          const selected = await select({
            message: "Select agent to run pipeline steps with:",
            options: supportedAgents.map((value) => ({
              value,
              label: value
            }))
          });
          if (isCancel(selected)) {
            cancel("Pipeline run cancelled.");
            return;
          }
          agent = resolvePipelineAgent(selected as string);
        }

        const commandConfig = await resolvePipelineCommandConfig(container);
        const maxRuns = resolveMaxRuns(options.maxRuns);

        if (options.plan && options.plans && options.plans.length > 0) {
          throw new ValidationError("Use either --plan or --plans, not both.");
        }

        const planPaths = await resolvePlanPaths({
          cwd: container.env.cwd,
          homeDir: container.env.homeDir,
          ...(commandConfig.planDirectory ? { planDirectory: commandConfig.planDirectory } : {}),
          ...(options.plan ? { plan: options.plan } : {}),
          ...(options.plans && options.plans.length > 0 ? { plans: options.plans } : {}),
          assumeYes: flags.assumeYes,
          fs: container.fs,
          selectPlans: async (input: {
            message: string;
            options: Array<{ label: string; value: string }>;
            required: boolean;
          }) => {
            const selected = await multiselect(input);
            if (isCancel(selected)) {
              cancel("Pipeline run cancelled.");
              return null;
            }
            return Array.isArray(selected) ? selected : null;
          },
          promptForPath: async (
            input: Parameters<NonNullable<PipelineRunOptions["promptForPath"]>>[0]
          ) => {
            const value = await promptText(input);
            if (isCancel(value)) {
              cancel("Pipeline run cancelled.");
              return null;
            }
            return typeof value === "string" && value.trim().length > 0
              ? value.trim()
              : null;
          }
        });

        if (!planPaths || planPaths.length === 0) {
          return;
        }

        for (const [index, planPath] of planPaths.entries()) {
          const totalPlans = planPaths.length;
          if (totalPlans > 1) {
            resources.logger.info(`Plan ${index + 1}/${totalPlans}: ${planPath}`);
          }

          const runOptions: PipelineRunOptions = {
            agent,
            cwd: container.env.cwd,
            homeDir: container.env.homeDir,
            ...(commandConfig.planDirectory ? { planDirectory: commandConfig.planDirectory } : {}),
            ...(options.model ? { model: options.model } : {}),
            ...(options.task ? { task: options.task } : {}),
            plan: planPath,
            ...(maxRuns != null ? { maxRuns } : {}),
            assumeYes: flags.assumeYes
          };

          const useDashboard = shouldUseInteractiveDashboard(options.tui ?? commandConfig.tui);
          const result = useDashboard
            ? await runPipelineWithDashboard({
                agent,
                ...(options.model ? { model: options.model } : {}),
                planPath,
                planIndex: index,
                totalPlans,
                runOptions
              })
            : await sdkRunPipeline({
                ...runOptions,
                onPlanReloadError(error: Error) {
                  resources.logger.warn(`Plan reload failed, using last good state: ${error.message}`);
                },
                onPlanResolved(summary: PlanSummary) {
                  resources.logger.resolved(
                    "Config",
                    formatPipelineConfigSummary({
                      agent,
                      model: options.model,
                      planPath: summary.planPath,
                      planIndex: index,
                      totalPlans
                    }).replaceAll(" · ", "\n   ")
                  );
                  resources.logger.resolved("Tasks", formatPipelineTasksSummary(summary));
                },
                onTaskStart(progress: TaskProgress) {
                  resources.logger.info(formatTaskStartMessage(progress));
                },
                onTaskComplete(progress: TaskCompletion) {
                  resources.logger.info(formatTaskCompleteMessage(progress));
                }
              });

          const summary = formatRunSummary(result);

          if (result.stopReason === "failed") {
            process.exitCode = 1;
            resources.logger.error(
              `Pipeline failed at ${result.lastTaskId}${result.lastStepName ? ` (${result.lastStepName})` : ""}.`
            );
            resources.logger.resolved("Run summary", summary);
            return;
          }

          if (result.stopReason === "cancelled") {
            process.exitCode = 130;
            resources.logger.warn("Pipeline run cancelled.");
            resources.logger.resolved("Run summary", summary);
            return;
          }

          if (result.stopReason === "nothing_to_run") {
            resources.logger.info("Nothing to run.");
            resources.logger.resolved("Run summary", summary);
            continue;
          }

          if (result.stopReason === "max_runs") {
            resources.logger.info(
              `Reached max runs (${result.runsCompleted}).`
            );
            resources.logger.resolved("Run summary", summary);
            return;
          }

          resources.logger.resolved("Run summary", summary);
        }

        resources.logger.success(planPaths.length > 1 ? "Pipeline sequence finished." : "Pipeline run finished.");
      } finally {
        resources.context.finalize();
      }
    });

  pipeline
    .command("validate")
    .description("Validate a pipeline plan markdown file without running it.")
    .argument("<file>", "Path to the pipeline plan markdown file")
    .option("--preview", "Expand and display all prompt content for each task and step.")
    .action(async function (this: Command, file: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(
        container,
        flags,
        "pipeline:validate"
      );

      try {
        resources.logger.intro("pipeline validate");

        const absolutePath = resolveAbsolutePlanPath(
          file,
          container.env.cwd,
          container.env.homeDir
        );

        const content = await container.fs.readFile(absolutePath, "utf8");

        const steps = await loadResolvedSteps({
          cwd: container.env.cwd,
          homeDir: container.env.homeDir,
          fs: container.fs
        });

        const hasSteps = Object.keys(steps.steps).length > 0;
        const plan = parsePlan(content, hasSteps ? { availableSteps: steps.steps } : {});

        const total = plan.tasks.length;
        const done = plan.tasks.filter((t) => {
          if (typeof t.status === "string") return t.status === "done";
          return Object.values(t.status).every((s) => s === "done");
        }).length;

        resources.logger.resolved("Plan", file);
        resources.logger.resolved("Tasks", `${total} tasks (${done} done)`);
        if (hasSteps) {
          resources.logger.resolved("Steps", Object.keys(steps.steps).join(", "));
        }
        resources.logger.success("Plan is valid.");

        const opts = this.opts<{ preview?: boolean }>();
        if (opts.preview) {
          const readFile = container.fs.readFile.bind(container.fs);
          const resolvedVars: Record<string, string> = {};
          for (const [key, value] of Object.entries(plan.vars ?? {})) {
            resolvedVars[key] = await resolveFileIncludes(value, container.env.cwd, readFile);
          }

          const resolvedSetup = plan.setup === null ? undefined : (plan.setup ?? steps.setup);
          const resolvedTeardown = plan.teardown === null ? undefined : (plan.teardown ?? steps.teardown);

          if (resolvedSetup) {
            const raw = Object.keys(resolvedVars).length > 0
              ? interpolate(resolvedSetup.prompt, resolvedVars)
              : resolvedSetup.prompt;
            const expanded = await resolveFileIncludes(raw, container.env.cwd, readFile);
            resources.logger.resolved("setup", expanded);
          }

          for (const task of plan.tasks) {
            if (typeof task.status === "string") {
              const expanded = await resolveFileIncludes(
                buildExecutionPrompt({ selection: { kind: "run", task }, steps: steps.steps, planPath: file, vars: resolvedVars }),
                container.env.cwd,
                readFile
              );
              resources.logger.resolved(`task: ${task.id} — ${task.title}`, expanded);
            } else {
              for (const stepName of Object.keys(task.status)) {
                const expanded = await resolveFileIncludes(
                  buildExecutionPrompt({ selection: { kind: "run", task, stepName }, steps: steps.steps, planPath: file, vars: resolvedVars }),
                  container.env.cwd,
                  readFile
                );
                resources.logger.resolved(`task: ${task.id} / ${stepName}`, expanded);
              }
            }
          }

          if (resolvedTeardown) {
            const raw = Object.keys(resolvedVars).length > 0
              ? interpolate(resolvedTeardown.prompt, resolvedVars)
              : resolvedTeardown.prompt;
            const expanded = await resolveFileIncludes(raw, container.env.cwd, readFile);
            resources.logger.resolved("teardown", expanded);
          }
        }
      } finally {
        resources.context.finalize();
      }
    });

  pipeline
    .command("plan-path")
    .description("Print the directory where pipeline plan files should be placed.")
    .action(async function () {
      const commandConfig = await resolvePipelineCommandConfig(container);

      const resolvedPath = await resolvePlanDirectory({
        cwd: container.env.cwd,
        homeDir: container.env.homeDir,
        planDirectory: commandConfig.planDirectory,
        fs: container.fs
      });

      process.stdout.write(`${resolvedPath}\n`);
    });

  pipeline
    .command("install")
    .description("Install the Pipeline /plan skill and scaffold pipeline files.")
    .option("--agent <name>", "Agent to install the Pipeline skill for")
    .option("--local", "Install project-local skill and pipeline files")
    .option("--global", "Install user-global skill and pipeline files")
    .option("--force", "Overwrite an existing steps.yaml scaffold")
    .action(async function (this: Command) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(
        container,
        flags,
        "pipeline:install"
      );
      const options = this.opts<PipelineInstallCommandOptions>();

      if (options.local && options.global) {
        throw new ValidationError("Use either --local or --global, not both.");
      }

      try {
        let agent = options.agent;
        if (!agent) {
          if (flags.assumeYes) {
            agent = DEFAULT_PIPELINE_AGENT;
          } else {
            const selected = await select({
              message: "Select agent to install the Pipeline skill for:",
              options: supportedAgents.map((value) => ({
                value,
                label: value
              }))
            });
            if (isCancel(selected)) {
              cancel("Pipeline install cancelled.");
              return;
            }
            agent = selected as string;
          }
        }

        const support = resolveAgentSupport(agent);
        if (support.status !== "supported" || !support.id) {
          throw new ValidationError(`Unsupported agent: ${agent}`);
        }

        let scope: SkillScope;
        if (options.local) {
          scope = "local";
        } else if (options.global) {
          scope = "global";
        } else if (flags.assumeYes) {
          scope = DEFAULT_PIPELINE_SCOPE;
        } else {
          const selected = await select({
            message: "Select install scope:",
            options: [
              { value: "local", label: "Local" },
              { value: "global", label: "Global" }
            ]
          });
          if (isCancel(selected)) {
            cancel("Pipeline install cancelled.");
            return;
          }
          scope = selected as SkillScope;
        }

        resources.logger.intro(`pipeline install (${support.id}, ${scope})`);

        const templates = await loadPipelineTemplates();
        const skillResult = await installSkill(
          support.id,
          {
            name: "poe-code-pipeline-plan",
            content: templates.skillPlan
          },
          {
            fs: container.fs,
            cwd: container.env.cwd,
            homeDir: container.env.homeDir,
            scope,
            dryRun: flags.dryRun
          }
        );

        if (flags.dryRun) {
          resources.logger.dryRun(`Would create: ${skillResult.displayPath}`);
        } else {
          resources.logger.info(`Create: ${skillResult.displayPath}`);
        }

        const pipelinePaths = resolvePipelinePaths(
          scope,
          container.env.cwd,
          container.env.homeDir
        );

        if (!(await pathExists(container.fs, pipelinePaths.plansPath))) {
          if (flags.dryRun) {
            resources.logger.dryRun(`Would create: ${pipelinePaths.displayPlansPath}`);
          } else {
            await container.fs.mkdir(pipelinePaths.plansPath, { recursive: true });
            resources.logger.info(`Create: ${pipelinePaths.displayPlansPath}`);
          }
        }

        const stepsExists = await pathExists(container.fs, pipelinePaths.stepsPath);
        if (stepsExists && !options.force) {
          resources.logger.info(
            `Skip: ${pipelinePaths.displayStepsPath} (already exists)`
          );
        } else if (flags.dryRun) {
          resources.logger.dryRun(
            `Would ${stepsExists ? "overwrite" : "create"}: ${pipelinePaths.displayStepsPath}`
          );
        } else {
          await container.fs.mkdir(path.dirname(pipelinePaths.stepsPath), {
            recursive: true
          });
          await container.fs.writeFile(pipelinePaths.stepsPath, templates.steps, {
            encoding: "utf8"
          });
          resources.logger.info(
            `${stepsExists ? "Overwrite" : "Create"}: ${pipelinePaths.displayStepsPath}`
          );
        }

        resources.context.complete({
          success: `Installed Pipeline skill for ${support.id} and scaffolded ${scope} pipeline files`,
          dry: `Would install Pipeline skill for ${support.id} and scaffold ${scope} pipeline files`
        });
      } finally {
        resources.context.finalize();
      }
    });
}
