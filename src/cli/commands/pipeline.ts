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
import {
  resolveAgentId,
  parseAgentSpecifier,
  formatAgentSpecifier,
  allAgents
} from "@poe-code/agent-defs";
import { renderAcpEvent, type AcpEvent, type AcpMiddleware } from "@poe-code/agent-spawn";
import { skillPlanConfigSection } from "@poe-code/agent-harness-tools";
import { installSkill, resolveAgentSupport, type SkillScope } from "@poe-code/agent-skill-config";
import {
  loadIntegrations,
  mergePipelineCallbacks,
  readMergedDocument,
  resolveScope,
  type ConfigDocument,
  type Integrations
} from "@poe-code/poe-code-config";
import type { CliContainer } from "../container.js";
import { pipelineConfigScope, planConfigScope } from "../../services/config.js";
import { ValidationError } from "../errors.js";
import { discoverPipelineInitSources } from "./pipeline-init.js";
import { createExecutionResources, resolveCommandFlags, resolveDefaultAgent } from "./shared.js";
import { resolvePipelineLoopAgent } from "./pipeline-loop-agent.js";
import {
  runPipelineInit as sdkRunPipelineInit,
  runPipeline as sdkRunPipeline,
  type AgentRunUsage,
  type PipelineInitSource,
  type PipelineLockStatus,
  type PipelineRunOptions,
  type PipelineRunResult,
  type PlanSummary,
  type TaskProgress
} from "../../sdk/pipeline.js";
import { createSpawnSession, type SpawnSession } from "../../sdk/spawn-session.js";
import {
  buildExecutionPrompt,
  interpolatePipelineVars,
  loadPipelineConfig,
  loadResolvedSteps,
  parsePlan,
  resolveAbsolutePlanPath,
  resolveFileIncludes,
  resolvePipelineVars,
  resolvePlanDirectory,
  resolvePlanPaths,
  validateResolvedPromptVars
} from "@poe-code/pipeline";
import {
  createDashboardLineBuffer,
  formatDashboardDuration,
  formatDashboardTimestamp,
  registerDashboardQuitCommands,
  shouldUseInteractiveDashboard
} from "./dashboard-loop-shared.js";

async function resolvePipelineCommandConfig(container: CliContainer): Promise<{
  configDoc: ConfigDocument;
  planDirectory: string;
  tui: boolean;
}> {
  const [configDoc, pipelineYamlConfig] = await Promise.all([
    readMergedDocument(container.fs, container.env.configPath, container.env.projectConfigPath),
    loadPipelineConfig({
      cwd: container.env.cwd,
      homeDir: container.env.homeDir,
      fs: container.fs
    })
  ]);
  const pipelineConfig = resolveScope(
    pipelineConfigScope.schema,
    configDoc[pipelineConfigScope.scope],
    container.env.variables
  );
  const planConfig = resolveScope(
    planConfigScope.schema,
    configDoc[planConfigScope.scope],
    container.env.variables
  );
  const globalPlanDirectory = String(planConfig.plan_directory);
  const yamlPlanDirectory = pipelineYamlConfig.plan_directory;
  const planDirectory: string =
    typeof yamlPlanDirectory === "string" ? yamlPlanDirectory : globalPlanDirectory;
  return {
    configDoc,
    planDirectory,
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
  taskCompleted?: boolean;
};

type PipelineDashboardRunOptions = {
  agent: string;
  model?: string;
  planPath: string;
  planIndex: number;
  totalPlans: number;
  runOptions: PipelineRunOptions;
  integrations?: Integrations;
};

function resolvePipelineAgent(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    return DEFAULT_PIPELINE_AGENT;
  }

  const specifier = parseAgentSpecifier(value.trim());
  const resolved = resolveAgentId(specifier.agent);
  if (!resolved) {
    const supported = allAgents.map((a) => a.id).join(", ");
    throw new ValidationError(
      `Unsupported agent: ${specifier.agent}. Supported agents: ${supported}`
    );
  }

  return formatAgentSpecifier({ agent: resolved, model: specifier.model });
}

function resolveMaxRuns(value: string | undefined): number | undefined {
  if (value == null) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new ValidationError(`Invalid max-runs "${value}". Expected a positive integer.`);
  }

  return parsed;
}

function resolvePipelineInitSourcePath(
  container: CliContainer,
  sourcePath: string
): PipelineInitSource {
  const absolutePath = sourcePath.startsWith("~/")
    ? path.join(container.env.homeDir, sourcePath.slice(2))
    : path.isAbsolute(sourcePath)
      ? sourcePath
      : path.resolve(container.env.cwd, sourcePath);

  return {
    absolutePath,
    relativePath: sourcePath,
    title: path.basename(sourcePath, path.extname(sourcePath))
  };
}

const PIPELINE_ACTIVITY_TIMEOUT_RETRY_COUNT = 3;

function isActivityTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "ActivityTimeoutError";
}

function formatRunSummary(result: PipelineRunResult): string {
  const metrics = result.metrics;

  return [
    `Runs: ${result.runsCompleted}`,
    `Tasks: ${metrics.tasksCompleted} completed, ${metrics.tasksFailed} failed`,
    `Steps: ${metrics.stepsCompleted} completed`,
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

  if (progress.stepName && !progress.success) {
    return `Task ${progress.taskId} (${progress.stepName}) failed in ${duration}${usage}`;
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
    await acp.withAcpWriter(
      (line) => {
        if (kind === "error") {
          options.onErrorOutput(`${line}\n`);
          return;
        }
        options.onToolOutput(`${line}\n`);
      },
      async () => {
        renderAcpEvent(event);
      }
    );
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
  session: SpawnSession;
  appendOutput: (kind: "tool" | "error", message: string) => void;
  activeStage: () => string;
  teeTarget: PipelineDashboardTeeTarget;
}): NonNullable<PipelineRunOptions["runAgent"]> {
  return async (input) => {
    const toolBuffer = createDashboardLineBuffer((line) => {
      options.appendOutput("tool", `[${options.activeStage()}] ${line}`);
    });
    const errorBuffer = createDashboardLineBuffer((line) => {
      options.appendOutput("error", `[${options.activeStage()}] ${line}`);
    });
    options.teeTarget.tool = toolBuffer;
    options.teeTarget.error = errorBuffer;
    try {
      let lastError: unknown;
      for (let attempt = 0; attempt < PIPELINE_ACTIVITY_TIMEOUT_RETRY_COUNT; attempt++) {
        options.teeTarget.sawStdout = false;
        options.teeTarget.sawStderr = false;
        let sawStdout = false;
        let sawStderr = false;

        try {
          const { events, result } = options.session.run(
            {
              agent: input.agent,
              prompt: input.prompt,
              cwd: input.cwd,
              mode: input.mode,
              ...(input.logDir ? { logDir: input.logDir } : {}),
              ...(input.logFileName ? { logFileName: input.logFileName } : {}),
              ...(input.model ? { model: input.model } : {}),
              ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
              ...(input.signal ? { signal: input.signal } : {}),
              syncBack: false
            },
            { streaming: true }
          );

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
          sawStdout = options.teeTarget.sawStdout;
          sawStderr = options.teeTarget.sawStderr;

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
          if (!isActivityTimeoutError(error)) {
            toolBuffer.flush();
            errorBuffer.flush();
            throw error;
          }
          lastError = error;
        }
      }

      toolBuffer.flush();
      errorBuffer.flush();
      throw lastError;
    } finally {
      options.teeTarget.tool = undefined;
      options.teeTarget.error = undefined;
      options.teeTarget.sawStdout = false;
      options.teeTarget.sawStderr = false;
    }
  };
}

function createPipelineCliRunAgent(
  session: SpawnSession
): NonNullable<PipelineRunOptions["runAgent"]> {
  return async (input) =>
    await session.run({
      agent: input.agent,
      prompt: input.prompt,
      cwd: input.cwd,
      mode: input.mode,
      ...(input.logDir ? { logDir: input.logDir } : {}),
      ...(input.logFileName ? { logFileName: input.logFileName } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      syncBack: false
    });
}

type PipelineDashboardTeeTarget = {
  tool?: ReturnType<typeof createDashboardLineBuffer>;
  error?: ReturnType<typeof createDashboardLineBuffer>;
  sawStdout: boolean;
  sawStderr: boolean;
};

function createPipelineDashboardSpawnSession(options: {
  agent: string;
  model?: string;
  cwd: string;
  middlewares?: AcpMiddleware[];
  teeTarget: PipelineDashboardTeeTarget;
}): SpawnSession {
  return createSpawnSession({
    service: options.agent,
    cwd: options.cwd,
    ...(options.model ? { model: options.model } : {}),
    ...(options.middlewares ? { middlewares: options.middlewares } : {}),
    activityTimeoutMs: 10 * 60 * 1000,
    tee: {
      stdout: {
        write(chunk: string) {
          options.teeTarget.sawStdout = true;
          options.teeTarget.tool?.push(chunk);
        }
      },
      stderr: {
        write(chunk: string) {
          options.teeTarget.sawStderr = true;
          options.teeTarget.error?.push(chunk);
        }
      }
    }
  });
}

function createPipelineCliSpawnSession(options: {
  agent: string;
  model?: string;
  cwd: string;
  middlewares: AcpMiddleware[];
}): SpawnSession {
  return createSpawnSession({
    service: options.agent,
    cwd: options.cwd,
    ...(options.model ? { model: options.model } : {}),
    middlewares: options.middlewares
  });
}

function dashboardStatusForResult(result: PipelineRunResult): "done" | "error" {
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
  let waitingForLock = false;

  const syncStats = (): void => {
    const stats = {
      status,
      iterations,
      iterationsLabel: "Tasks",
      tokensIn,
      tokensOut,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      ...(currentAction ? { currentAction } : {})
    };
    dashboard.updateStats(stats);
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

  const teeTarget: PipelineDashboardTeeTarget = {
    sawStdout: false,
    sawStderr: false
  };
  const session = createPipelineDashboardSpawnSession({
    agent: options.agent,
    cwd: options.runOptions.cwd,
    ...(options.model ? { model: options.model } : {}),
    ...(options.integrations?.spawnMiddleware
      ? { middlewares: [options.integrations.spawnMiddleware] }
      : {}),
    teeTarget
  });

  try {
    const runOptions: PipelineRunOptions = {
      ...options.runOptions,
      runAgent: createPipelineDashboardRunAgent({
        session,
        appendOutput,
        activeStage: () => currentStage,
        teeTarget
      }),
      signal: abortController.signal,
      onPlanReloadError(error: Error) {
        appendOutput("error", `Plan reload failed, using last good state: ${error.message}`);
      },
      onLockStatusChange(lockStatus) {
        appendOutput("status", lockStatus.message);
        if (lockStatus.state === "waiting") {
          waitingForLock = true;
          currentAction = lockStatus.message;
        } else if (waitingForLock) {
          waitingForLock = false;
          currentAction = undefined;
        }
        syncStats();
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
        if (progress.taskCompleted) {
          iterations += 1;
        }
        if (progress.usage) {
          tokensIn += progress.usage.inputTokens;
          tokensOut += progress.usage.outputTokens;
        }
        appendOutput(progress.success ? "success" : "error", formatTaskCompleteMessage(progress));
        syncStats();
      }
    };
    const result = await runPipelineWithIntegrations(options.integrations, options.planPath, {
      ...runOptions,
      ...mergePipelineCallbacks(runOptions, options.integrations?.pipelineCallbacks)
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
    try {
      try {
        await session.syncBack();
      } finally {
        await session.close();
      }
    } finally {
      global.clearInterval(intervalId);
      process.off("SIGINT", sigintHandler);
      dashboard.stop();
      dashboard.destroy();
    }
  }
}

async function runPipelineWithIntegrations(
  integrations: Integrations | null | undefined,
  name: string,
  options: PipelineRunOptions
): Promise<PipelineRunResult> {
  return (
    integrations?.traceRun("pipeline", name, () => sdkRunPipeline(options)) ??
    sdkRunPipeline(options)
  );
}

function resolvePipelinePaths(
  scope: SkillScope,
  cwd: string,
  homeDir: string
): {
  plansPath: string;
  stepsPath: string;
  legacyDefaultStepsPath: string;
  displayPlansPath: string;
  displayStepsPath: string;
} {
  const rootPath =
    scope === "global"
      ? path.join(homeDir, ".poe-code", "pipeline")
      : path.join(cwd, ".poe-code", "pipeline");
  const displayRoot = scope === "global" ? "~/.poe-code/pipeline" : ".poe-code/pipeline";

  return {
    plansPath: path.join(rootPath, "plans"),
    stepsPath: path.join(rootPath, "steps.yaml"),
    legacyDefaultStepsPath: path.join(rootPath, "steps", "default.yaml"),
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
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
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

async function pathExists(fs: CliContainer["fs"], targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function registerPipelineCommand(program: Command, container: CliContainer): void {
  const pipeline = program
    .command("pipeline")
    .description("Run a fixed-step task pipeline plan.")
    .addHelpCommand(false);

  pipeline
    .command("run")
    .description(
      "Run the selected pipeline plan until completion, failure, cancellation, or max runs."
    )
    .option("--agent <name>", "Agent to run each pipeline step with")
    .option("--model <model>", "Model override passed to the agent")
    .option("--tui", "Show a live dashboard while the pipeline is running")
    .option("--no-tui", "Disable the live dashboard for this pipeline run")
    .option("--task <id>", "Run only the specified task")
    .option("--plan <path>", "Path to the pipeline plan file")
    .option("--plans <paths...>", "Paths to pipeline plan files to run sequentially")
    .option("--max-runs <n>", "Maximum number of agent executions to perform")
    .option("--dry-run", "Resolve the selected plan without running agents or changing files")
    .action(async function (this: Command) {
      const flags = resolveCommandFlags(program);
      const options = this.opts<{
        agent?: string;
        model?: string;
        tui?: boolean;
        task?: string;
        plan?: string;
        plans?: string[];
        maxRuns?: string;
        dryRun?: boolean;
      }>();
      const dryRun = flags.dryRun || Boolean(options.dryRun);
      const resources = createExecutionResources(container, { ...flags, dryRun }, "pipeline:run");

      resources.logger.intro("pipeline run");

      let integrations: Integrations | null = null;
      try {
        const configuredDefaultAgent = await resolveDefaultAgent(container);
        const agent = dryRun
          ? resolvePipelineAgent(options.agent ?? configuredDefaultAgent ?? DEFAULT_PIPELINE_AGENT)
          : await (async () => {
              const selectedAgent = await resolvePipelineLoopAgent({
                providedAgent: options.agent,
                configuredDefaultAgent,
                assumeYes: flags.assumeYes,
                fallbackAgent: DEFAULT_PIPELINE_AGENT,
                message: "Select agent to run pipeline steps with:",
                select,
                isCancel
              });
              if ("cancelled" in selectedAgent) {
                cancel("Pipeline run cancelled.");
                return null;
              }
              return resolvePipelineAgent(selectedAgent.agent);
            })();
        if (agent === null) {
          return;
        }

        const commandConfig = await resolvePipelineCommandConfig(container);
        integrations = await loadIntegrations(commandConfig.configDoc);
        const maxRuns = resolveMaxRuns(options.maxRuns);

        if (options.plan && options.plans && options.plans.length > 0) {
          throw new ValidationError("Use either --plan or --plans, not both.");
        }

        const planPaths = await resolvePlanPaths({
          cwd: container.env.cwd,
          homeDir: container.env.homeDir,
          planDirectory: commandConfig.planDirectory,
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
            return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
            planDirectory: commandConfig.planDirectory,
            ...(options.model ? { model: options.model } : {}),
            ...(options.task ? { task: options.task } : {}),
            plan: planPath,
            ...(maxRuns != null ? { maxRuns } : {}),
            ...(dryRun ? { dryRun: true } : {}),
            assumeYes: flags.assumeYes
          };

          const useDashboard = shouldUseInteractiveDashboard(options.tui ?? commandConfig.tui);
          let cliSession: SpawnSession | null = null;
          if (!useDashboard && integrations?.spawnMiddleware) {
            cliSession = createPipelineCliSpawnSession({
              agent,
              cwd: container.env.cwd,
              ...(options.model ? { model: options.model } : {}),
              middlewares: [integrations.spawnMiddleware]
            });
            runOptions.runAgent = createPipelineCliRunAgent(cliSession);
          }

          const result = await (async () => {
            try {
              return useDashboard
                ? await runPipelineWithDashboard({
                    agent,
                    ...(options.model ? { model: options.model } : {}),
                    planPath,
                    planIndex: index,
                    totalPlans,
                    runOptions,
                    ...(integrations ? { integrations } : {})
                  })
                : await runPipelineWithIntegrations(integrations, planPath, {
                    ...runOptions,
                    onPlanReloadError(error: Error) {
                      resources.logger.warn(
                        `Plan reload failed, using last good state: ${error.message}`
                      );
                    },
                    ...mergePipelineCallbacks(
                      {
                        onLockStatusChange(lockStatus: PipelineLockStatus) {
                          resources.logger.info(lockStatus.message);
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
                      },
                      integrations?.pipelineCallbacks
                    )
                  });
            } finally {
              if (cliSession) {
                try {
                  await cliSession.syncBack();
                } finally {
                  await cliSession.close();
                }
              }
            }
          })();

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

          if (result.stopReason === "dry_run") {
            resources.logger.info("Dry run complete.");
            resources.logger.resolved("Run summary", summary);
            continue;
          }

          if (result.stopReason === "max_runs") {
            resources.logger.info(`Reached max runs (${result.runsCompleted}).`);
            resources.logger.resolved("Run summary", summary);
            return;
          }

          resources.logger.resolved("Run summary", summary);
        }

        resources.logger.success(
          planPaths.length > 1 ? "Pipeline sequence finished." : "Pipeline run finished."
        );
      } finally {
        await integrations?.shutdown();
        resources.context.finalize();
      }
    });

  pipeline
    .command("init")
    .description("Initialize pipeline plans from source Markdown docs.")
    .argument("[question]", "Optional user question to forward to the plan generator")
    .option("--agent <name>", "Agent to generate the plan with")
    .option("--model <model>", "Model override passed to the agent")
    .option("--source <path>", "Single source Markdown doc to convert")
    .option("--sources <paths...>", "Multiple source Markdown docs to convert")
    .action(async function (this: Command, question: string | undefined) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "pipeline:init");
      const options = this.opts<{
        agent?: string;
        model?: string;
        source?: string;
        sources?: string[];
      }>();

      resources.logger.intro("pipeline init");

      try {
        let sourcePaths = options.sources;
        let resolvedQuestion = question;
        if (!resolvedQuestion && sourcePaths && sourcePaths.length > 0) {
          const trailingArgument = sourcePaths[sourcePaths.length - 1];
          if (trailingArgument && !trailingArgument.toLowerCase().endsWith(".md")) {
            resolvedQuestion = trailingArgument;
            sourcePaths = sourcePaths.slice(0, -1);
          }
        }

        const selectedAgent = await resolvePipelineLoopAgent({
          providedAgent: options.agent,
          configuredDefaultAgent: await resolveDefaultAgent(container),
          assumeYes: flags.assumeYes,
          fallbackAgent: DEFAULT_PIPELINE_AGENT,
          message: "Select agent to generate pipeline plans with:",
          select,
          isCancel
        });
        if ("cancelled" in selectedAgent) {
          cancel("Pipeline init cancelled.");
          return;
        }
        const agent = resolvePipelineAgent(selectedAgent.agent);

        if (options.source && sourcePaths && sourcePaths.length > 0) {
          throw new ValidationError("Use either --source or --sources, not both.");
        }

        let sources: PipelineInitSource[];
        if (options.source) {
          sources = [resolvePipelineInitSourcePath(container, options.source)];
        } else if (sourcePaths && sourcePaths.length > 0) {
          sources = sourcePaths.map((sourcePath) =>
            resolvePipelineInitSourcePath(container, sourcePath)
          );
        } else {
          if (flags.assumeYes) {
            throw new ValidationError("Provide --source or --sources when using --yes.");
          }

          const discoveredSources = await discoverPipelineInitSources({ container });
          if (discoveredSources.length === 0) {
            resources.logger.info("No source documents available to initialize.");
            return;
          }

          const selected = await multiselect({
            message: "Select source Markdown docs to convert:",
            options: discoveredSources.map((source) => ({
              value: source.relativePath,
              label: `${source.title} (${source.relativePath})`
            })),
            required: true
          });
          if (isCancel(selected)) {
            cancel("Pipeline init cancelled.");
            return;
          }

          const selectedSourcePaths = Array.isArray(selected)
            ? new Set(selected)
            : new Set<string>();
          sources = discoveredSources.filter((source) =>
            selectedSourcePaths.has(source.relativePath)
          );
          if (sources.length === 0) {
            return;
          }
        }

        const result = await sdkRunPipelineInit({
          agent,
          cwd: container.env.cwd,
          homeDir: container.env.homeDir,
          ...(options.model ? { model: options.model } : {}),
          ...(resolvedQuestion ? { question: resolvedQuestion } : {}),
          sources,
          assumeYes: flags.assumeYes,
          onSourceStart(source, index, total) {
            resources.logger.info(`Source ${index}/${total}: ${source.relativePath}`);
          },
          onSourceComplete(source, index, total) {
            resources.logger.success(`Completed ${index}/${total}: ${source.relativePath}`);
          }
        });

        if (result.stopReason === "failed") {
          process.exitCode = 1;
          resources.logger.error(
            result.failedSource
              ? `Pipeline init failed at ${result.failedSource}.`
              : "Pipeline init failed."
          );
          return;
        }

        if (result.stopReason === "cancelled") {
          process.exitCode = 130;
          resources.logger.warn("Pipeline init cancelled.");
          return;
        }

        resources.logger.success("Pipeline init finished.");
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
      const resources = createExecutionResources(container, flags, "pipeline:validate");

      try {
        resources.logger.intro("pipeline validate");

        const absolutePath = resolveAbsolutePlanPath(
          file,
          container.env.cwd,
          container.env.homeDir
        );

        const content = await container.fs.readFile(absolutePath, "utf8");

        const draftPlan = parsePlan(content);
        const steps = await loadResolvedSteps({
          cwd: container.env.cwd,
          homeDir: container.env.homeDir,
          fs: container.fs,
          name: draftPlan.extends,
          stepOverrides: draftPlan.stepOverrides
        });
        const plan = parsePlan(content, { availableSteps: steps.steps });

        const total = plan.tasks.length;
        const done = plan.tasks.filter((t) => {
          if (typeof t.status === "string") return t.status === "done";
          return Object.values(t.status).every((s) => s === "done");
        }).length;
        const readFile = container.fs.readFile.bind(container.fs);
        const resolvedVars = await resolvePipelineVars(
          plan.vars ?? {},
          container.env.cwd,
          readFile
        );
        const resolvedSetup = plan.setup === null ? undefined : (plan.setup ?? steps.setup);
        const resolvedTeardown =
          plan.teardown === null ? undefined : (plan.teardown ?? steps.teardown);

        validateResolvedPromptVars({
          plan,
          steps: steps.steps,
          planPath: file,
          vars: resolvedVars,
          setup: resolvedSetup,
          teardown: resolvedTeardown
        });

        resources.logger.resolved("Plan", file);
        resources.logger.resolved("Tasks", `${total} tasks (${done} done)`);
        if (Object.keys(steps.steps).length > 0) {
          resources.logger.resolved("Steps", Object.keys(steps.steps).join(", "));
        }
        resources.logger.success("Plan is valid.");

        const opts = this.opts<{ preview?: boolean }>();
        if (opts.preview) {
          if (resolvedSetup) {
            const raw = interpolatePipelineVars(resolvedSetup.prompt, resolvedVars, "setup");
            const expanded = await resolveFileIncludes(raw, container.env.cwd, readFile);
            resources.logger.resolved("setup", expanded);
          }

          for (const task of plan.tasks) {
            if (typeof task.status === "string") {
              const expanded = await resolveFileIncludes(
                buildExecutionPrompt({
                  selection: { kind: "run", task },
                  steps: steps.steps,
                  planPath: file,
                  vars: resolvedVars
                }),
                container.env.cwd,
                readFile
              );
              resources.logger.resolved(`task: ${task.id} — ${task.title}`, expanded);
            } else {
              for (const stepName of Object.keys(task.status)) {
                const expanded = await resolveFileIncludes(
                  buildExecutionPrompt({
                    selection: { kind: "run", task, stepName },
                    steps: steps.steps,
                    planPath: file,
                    vars: resolvedVars
                  }),
                  container.env.cwd,
                  readFile
                );
                resources.logger.resolved(`task: ${task.id} / ${stepName}`, expanded);
              }
            }
          }

          if (resolvedTeardown) {
            const raw = interpolatePipelineVars(resolvedTeardown.prompt, resolvedVars, "teardown");
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

      const resolvedPath = resolvePlanDirectory({
        cwd: container.env.cwd,
        homeDir: container.env.homeDir,
        planDirectory: commandConfig.planDirectory
      });

      process.stdout.write(`${resolvedPath}\n`);
    });

  pipeline
    .command("install")
    .description("Install the Pipeline /plan skill and scaffold pipeline files.")
    .option("--agent <name>", "Agent to install the Pipeline skill for")
    .option("--local", "Install project-local skill and pipeline files")
    .option("--global", "Install user-global skill and pipeline files")
    .option("--force", "Overwrite an existing default step config scaffold")
    .action(async function (this: Command) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "pipeline:install");
      const options = this.opts<PipelineInstallCommandOptions>();

      if (options.local && options.global) {
        throw new ValidationError("Use either --local or --global, not both.");
      }

      try {
        const selectedAgent = await resolvePipelineLoopAgent({
          providedAgent: options.agent,
          configuredDefaultAgent: await resolveDefaultAgent(container),
          assumeYes: flags.assumeYes,
          fallbackAgent: DEFAULT_PIPELINE_AGENT,
          message: "Select agent to install the Pipeline skill for:",
          select,
          isCancel
        });
        if ("cancelled" in selectedAgent) {
          cancel("Pipeline install cancelled.");
          return;
        }
        const agent = resolvePipelineAgent(selectedAgent.agent);

        const support = resolveAgentSupport(parseAgentSpecifier(agent).agent);
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
            content: templates.skillPlan + "\n\n" + skillPlanConfigSection("pipeline")
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

        const pipelinePaths = resolvePipelinePaths(scope, container.env.cwd, container.env.homeDir);

        if (!(await pathExists(container.fs, pipelinePaths.plansPath))) {
          if (flags.dryRun) {
            resources.logger.dryRun(`Would create: ${pipelinePaths.displayPlansPath}`);
          } else {
            await container.fs.mkdir(pipelinePaths.plansPath, { recursive: true });
            resources.logger.info(`Create: ${pipelinePaths.displayPlansPath}`);
          }
        }

        const legacyDefaultStepsExists = await pathExists(
          container.fs,
          pipelinePaths.legacyDefaultStepsPath
        );
        let stepsExists = await pathExists(container.fs, pipelinePaths.stepsPath);

        if (legacyDefaultStepsExists && !stepsExists) {
          if (flags.dryRun) {
            resources.logger.dryRun(
              `Would rename: ${pipelinePaths.displayStepsPath} (migrate from steps/default.yaml)`
            );
          } else {
            await container.fs.rename(
              pipelinePaths.legacyDefaultStepsPath,
              pipelinePaths.stepsPath
            );
            resources.logger.info(
              `Rename: steps/default.yaml -> ${pipelinePaths.displayStepsPath}`
            );
          }
          stepsExists = true;
        }

        if (stepsExists && !options.force) {
          resources.logger.info(`Skip: ${pipelinePaths.displayStepsPath} (already exists)`);
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
