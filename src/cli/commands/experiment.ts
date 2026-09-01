import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import {
  acp,
  cancel,
  createDashboard,
  getTheme,
  isCancel,
  renderTable,
  select
} from "toolcraft-design";
import {
  resolveAgentId,
  parseAgentSpecifier,
  formatAgentSpecifier,
  allAgents
} from "@poe-code/agent-defs";
import { resolvePlanDirectory } from "@poe-code/pipeline";
import {
  resolveLoopAgent,
  resolveWorkflowPath,
  skillPlanConfigSection
} from "@poe-code/agent-harness-tools";
import {
  resolveAgentSupport,
  supportedAgents,
  type SkillScope
} from "@poe-code/agent-skill-config";
import { installSkillFile } from "./install-skill-file.js";
import { discoverExperimentDocs, parseExperimentFrontmatter } from "@poe-code/experiment-loop";
import { isFrontmatterKindError } from "@poe-code/frontmatter";
import type { ExperimentFrontmatter } from "@poe-code/experiment-loop";
import type { AcpMiddleware } from "@poe-code/agent-spawn";
import type { CliContainer } from "../container.js";
import { ValidationError } from "../errors.js";
import {
  createExecutionResources,
  requireInteractiveStdin,
  resolveCommandFlags,
  resolveDefaultAgent
} from "./shared.js";
import { dashboardTuiDescription } from "./help-guidance.js";
import {
  runExperiment as sdkRunExperiment,
  readExperimentJournal as sdkReadExperimentJournal,
  appendExperimentJournalEntry as sdkAppendExperimentJournalEntry
} from "../../sdk/experiment.js";
import { spawn as sdkSpawn } from "../../sdk/spawn.js";
import { experimentConfigScope, planConfigScope } from "../../services/config.js";
import { hasOwnErrorCode } from "../../utils/error-codes.js";
import {
  mergeExperimentCallbacks,
  readMergedDocument,
  readMergedDocumentReadonly,
  resolveScope,
  type ConfigDocument
} from "@poe-code/poe-code-config/core";
import { loadIntegrations, type Integrations } from "@poe-code/braintrust";
import type { ExperimentRunOptions } from "@poe-code/experiment-loop";
import {
  createDashboardLineBuffer,
  formatDashboardDuration,
  formatDashboardTimestamp,
  registerDashboardQuitCommands,
  shouldUseInteractiveDashboard
} from "./dashboard-loop-shared.js";
import {
  addRuntimeOptions,
  pickRuntimeOptions,
  type RuntimeCliOptions
} from "./runtime-options.js";
import {
  addWorktreeOptions,
  pickWorktreeOptions,
  type WorktreeCliOptions
} from "./worktree-options.js";

const DEFAULT_EXPERIMENT_AGENT = "claude-code";
const DEFAULT_EXPERIMENT_SCOPE: SkillScope = "local";
type ExperimentInstallCommandOptions = {
  force?: boolean;
  agent?: string;
  local?: boolean;
  global?: boolean;
};

let experimentTemplatesCache: { skillPlan: string; runYaml: string } | null = null;

type ExperimentDashboardRunOptions = {
  agent: string | string[];
  docPath: string;
  maxExperiments?: number;
  runOptions: Parameters<typeof sdkRunExperiment>[0];
  runtimeOptions: RuntimeCliOptions;
  integrations?: Integrations;
};

function resolveExperimentPaths(
  scope: SkillScope,
  cwd: string,
  homeDir: string
): {
  experimentsPath: string;
  displayExperimentsPath: string;
} {
  const rootPath =
    scope === "global"
      ? path.join(homeDir, ".poe-code", "experiments")
      : path.join(cwd, ".poe-code", "experiments");
  const displayRoot = scope === "global" ? "~/.poe-code/experiments" : ".poe-code/experiments";

  return {
    experimentsPath: rootPath,
    displayExperimentsPath: displayRoot
  };
}

async function pathExistsOnDisk(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
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
      throw new Error("Unable to locate package root for Experiment templates.");
    }
    currentPath = parentPath;
  }
}

async function loadExperimentTemplates(): Promise<{ skillPlan: string; runYaml: string }> {
  if (experimentTemplatesCache) {
    return experimentTemplatesCache;
  }

  const packageRoot = await findPackageRoot(fileURLToPath(import.meta.url));
  const templateRoots = [
    path.join(packageRoot, "src", "templates", "experiment"),
    path.join(packageRoot, "dist", "templates", "experiment")
  ];

  for (const templateRoot of templateRoots) {
    if (!(await pathExistsOnDisk(templateRoot))) {
      continue;
    }

    const [skillPlan, runYaml] = await Promise.all([
      readFile(path.join(templateRoot, "SKILL_experiment.md"), "utf8"),
      readFile(path.join(templateRoot, "run.yaml.mustache"), "utf8")
    ]);

    experimentTemplatesCache = { skillPlan, runYaml };
    return experimentTemplatesCache;
  }

  throw new Error("Experiment templates not found.");
}

async function pathExists(fs: CliContainer["fs"], targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

function validateExperimentDoc(frontmatter: ExperimentFrontmatter): string[] {
  const errors: string[] = [];

  if (!frontmatter.agent) {
    errors.push("Missing required field: agent");
  }

  if (!frontmatter.metric) {
    errors.push("Missing required field: metric");
  } else {
    const metrics = Array.isArray(frontmatter.metric) ? frontmatter.metric : [frontmatter.metric];

    for (const metric of metrics) {
      if (!metric.name || metric.name.trim().length === 0) {
        errors.push("Metric is missing required field: name");
      }
      if (!metric.script || metric.script.trim().length === 0) {
        errors.push(`Metric "${metric.name ?? "(unnamed)"}" is missing required field: script`);
      }
      if (
        metric.direction !== "minimize" &&
        metric.direction !== "maximize" &&
        metric.direction !== "stable"
      ) {
        errors.push(
          `Metric "${metric.name ?? "(unnamed)"}" has invalid direction: "${String(metric.direction)}". Must be "minimize", "maximize", or "stable"`
        );
      }
    }
  }

  return errors;
}

function formatExperimentAgentSummary(agent: string | string[]): string {
  return Array.isArray(agent) ? agent.join(", ") : agent;
}

function formatMaxExperimentsLabel(maxExperiments: number | undefined): string {
  return maxExperiments === undefined ? "unlimited" : String(maxExperiments);
}

function formatExperimentConfigSummary(options: {
  agent: string | string[];
  docPath: string;
  maxExperiments?: number;
}): string {
  return [
    `Agent: ${formatExperimentAgentSummary(options.agent)}`,
    `Max experiments: ${formatMaxExperimentsLabel(options.maxExperiments)}`,
    `Doc: ${options.docPath}`
  ].join(" · ");
}

function formatExperimentCurrentAction(
  index: number,
  maxExperiments: number | undefined,
  currentAgent: string
): string {
  const progress =
    maxExperiments === undefined ? `Experiment ${index}` : `Experiment ${index}/${maxExperiments}`;
  return `${progress} · ${currentAgent}`;
}

function formatExperimentScores(scores: Record<string, number> | undefined): string {
  if (!scores) {
    return "-";
  }

  return Object.entries(scores)
    .map(([name, value]) => `${name}=${value}`)
    .join(", ");
}

function formatExperimentStageLabel(index: number): string {
  return `experiment:${index}`;
}

function createExperimentDashboardRunAgent(options: {
  appendOutput: (kind: "tool" | "error", message: string) => void;
  activeStage: () => string;
  runtimeOptions: RuntimeCliOptions;
  middlewares?: AcpMiddleware[];
}): NonNullable<ExperimentRunOptions["runAgent"]> {
  return async (input) => {
    const errorBuffer = createDashboardLineBuffer((line) => {
      options.appendOutput("error", `[${options.activeStage()}] ${line}`);
    });

    try {
      const result = await acp.withAcpWriter(
        (line) => {
          options.appendOutput("tool", `[${options.activeStage()}] ${line}`);
        },
        async () =>
          await sdkSpawn.autonomous(input.agent, {
            prompt: input.prompt,
            cwd: input.cwd,
            model: input.model,
            ...options.runtimeOptions,
            ...(input.signal ? { signal: input.signal } : {}),
            ...(options.middlewares ? { middlewares: options.middlewares } : {}),
            worktree: false,
            useStdin: true,
            tee: {
              stderr: {
                write(chunk: string) {
                  errorBuffer.push(chunk);
                }
              }
            }
          })
      );

      errorBuffer.flush();
      return result;
    } catch (error) {
      errorBuffer.flush();
      throw error;
    }
  };
}

function createExperimentCliRunAgent(options: {
  runtimeOptions: RuntimeCliOptions;
  middlewares: AcpMiddleware[];
}): NonNullable<ExperimentRunOptions["runAgent"]> {
  return async (input) =>
    sdkSpawn.autonomous(input.agent, {
      prompt: input.prompt,
      cwd: input.cwd,
      model: input.model,
      ...options.runtimeOptions,
      ...(input.signal ? { signal: input.signal } : {}),
      middlewares: options.middlewares,
      worktree: false
    });
}

async function runExperimentWithDashboard(
  options: ExperimentDashboardRunOptions
): Promise<Awaited<ReturnType<typeof sdkRunExperiment>>> {
  const dashboard = createDashboard({
    title: "Experiment",
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
  let currentExperimentIndex = 0;
  let currentAction: string | undefined;
  let status: "running" | "done" | "error" = "running";

  const syncStats = (): void => {
    dashboard.updateStats({
      status,
      iterations,
      tokensIn: 0,
      tokensOut: 0,
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
  appendOutput("info", `Config · ${formatExperimentConfigSummary(options)}`);

  const intervalId = global.setInterval(() => {
    syncStats();
  }, 1_000);
  const sigintHandler = () => {
    requestCancellation();
  };
  process.on("SIGINT", sigintHandler);

  const runAgent = createExperimentDashboardRunAgent({
    appendOutput,
    activeStage: () => formatExperimentStageLabel(currentExperimentIndex),
    runtimeOptions: options.runtimeOptions,
    ...(options.integrations?.spawnMiddleware
      ? { middlewares: [options.integrations.spawnMiddleware] }
      : {})
  });

  try {
    const runOptions: Parameters<typeof sdkRunExperiment>[0] = {
      ...options.runOptions,
      signal: abortController.signal,
      runAgent,
      onExperimentStart(index, currentAgent) {
        currentExperimentIndex = index;
        currentAction = formatExperimentCurrentAction(index, options.maxExperiments, currentAgent);
        appendOutput(
          "status",
          options.maxExperiments === undefined
            ? `Experiment ${index} (${currentAgent})`
            : `Experiment ${index}/${options.maxExperiments} (${currentAgent})`
        );
        syncStats();
      },
      onBaselineCollected(baseline) {
        const entries = Object.entries(baseline)
          .map(([name, value]) => `${name}=${value}`)
          .join(", ");
        appendOutput("info", `Baseline collected: ${entries}`);
      },
      onCommit(commitHash) {
        appendOutput("info", `Committed ${commitHash.slice(0, 7)}`);
      },
      onMetricResult(metric, result) {
        const score = result.score === null ? "-" : String(result.score);
        const metricStatus = result.passed ? "passed" : "failed";
        appendOutput("info", `${metric.name}: ${score} (${metricStatus})`);
      },
      onReset(targetHash) {
        appendOutput("info", `Reset to ${targetHash.slice(0, 7)}`);
      },
      onExperimentComplete(index, entry) {
        iterations = Math.max(iterations, index);
        appendOutput(
          entry.status === "keep" ? "success" : "error",
          `Experiment ${index} ${entry.status} in ${formatDashboardDuration(entry.durationMs)} · scores: ${formatExperimentScores(entry.scores)}`
        );
        syncStats();
      }
    };
    const result = await runExperimentWithIntegrations(options.integrations, options.docPath, {
      ...runOptions,
      ...mergeExperimentCallbacks(runOptions, options.integrations?.experimentCallbacks)
    });

    status = "done";
    iterations = result.experimentsCompleted;
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

async function runExperimentWithIntegrations(
  integrations: Integrations | null | undefined,
  name: string,
  options: Parameters<typeof sdkRunExperiment>[0]
): Promise<Awaited<ReturnType<typeof sdkRunExperiment>>> {
  return (
    integrations?.traceRun("experiment", name, () => sdkRunExperiment(options)) ??
    sdkRunExperiment(options)
  );
}

function resolveExperimentAgent(value: string | undefined, sourceLabel = "agent"): string {
  if (!value || value.trim().length === 0) {
    return DEFAULT_EXPERIMENT_AGENT;
  }

  const specifier = parseAgentSpecifier(value.trim());
  const resolved = resolveAgentId(specifier.agent);
  if (!resolved) {
    const supported = allAgents.map((a) => a.id).join(", ");
    throw new ValidationError(
      `Unsupported ${sourceLabel}: ${specifier.agent}. Supported agents: ${supported}`
    );
  }

  return formatAgentSpecifier({ agent: resolved, model: specifier.model });
}

function parseNonNegativeInt(value: string | undefined, fieldName: string): number | undefined {
  if (value == null) {
    return undefined;
  }

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    [...trimmed].some((character) => character < "0" || character > "9")
  ) {
    throw new ValidationError(`Invalid ${fieldName} "${value}". Expected a non-negative integer.`);
  }

  return Number.parseInt(trimmed, 10);
}

function parseNonNegativeFiniteNumber(value: string, fieldName: string): number {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (trimmed.length === 0 || !Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError(
      `Invalid ${fieldName} "${value}". Expected a non-negative finite number.`
    );
  }

  return parsed;
}

function parseExperimentScores(value: string): Record<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ValidationError(`Invalid --scores JSON: ${value}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError("--scores must be a JSON object.");
  }

  const scores: Record<string, number> = {};
  for (const [key, score] of Object.entries(parsed)) {
    if (typeof score !== "number" || !Number.isFinite(score)) {
      throw new ValidationError(`--scores.${key} must be a finite number.`);
    }
    scores[key] = score;
  }

  return scores;
}

async function resolveExperimentCommandConfig(
  container: CliContainer,
  options: { readonly?: boolean } = {}
): Promise<{
  configDoc: ConfigDocument;
  planDirectory: string;
  tui: boolean;
}> {
  const readConfig = options.readonly ? readMergedDocumentReadonly : readMergedDocument;
  const configDoc = await readConfig(
    container.fs,
    container.env.configPath,
    container.env.projectConfigPath
  );
  const experimentConfig = resolveScope(
    experimentConfigScope.schema,
    configDoc[experimentConfigScope.scope],
    container.env.variables
  );
  const planConfig = resolveScope(
    planConfigScope.schema,
    configDoc[planConfigScope.scope],
    container.env.variables
  );
  return {
    configDoc,
    planDirectory: planConfig.plan_directory,
    tui: experimentConfig.tui === true
  };
}

async function resolveDocPath(options: {
  container: CliContainer;
  program: Command;
  providedDoc?: string;
  planDirectory: string;
  selectMessage: string;
  cancelMessage: string;
}): Promise<string | null> {
  if (options.providedDoc && options.providedDoc.trim().length > 0) {
    return options.providedDoc.trim();
  }

  const docs = await discoverExperimentDocs({
    cwd: options.container.env.cwd,
    homeDir: options.container.env.homeDir,
    planDirectory: options.planDirectory,
    fs: options.container.fs
  });
  if (docs.length === 0) {
    throw new ValidationError(
      `No experiment doc (kind: experiment) found under ${options.planDirectory}. Pass a doc path, or create one with \`poe-code experiment install\`.`
    );
  }

  const flags = resolveCommandFlags(options.program);
  if (flags.assumeYes) {
    return docs[0]!.path;
  }

  requireInteractiveStdin(
    "Experiment doc selection requires a doc path or --yes when running without an interactive TTY."
  );

  const selected = await select({
    message: options.selectMessage,
    options: docs.map((doc) => ({
      label: doc.displayPath,
      value: doc.path
    }))
  });
  if (isCancel(selected)) {
    cancel(options.cancelMessage);
    return null;
  }

  return typeof selected === "string" ? selected : null;
}

async function readExperimentDoc(
  container: CliContainer,
  docPath: string
): Promise<{
  absolutePath: string;
  frontmatter: ReturnType<typeof parseExperimentFrontmatter>["frontmatter"];
}> {
  const absolutePath = resolveWorkflowPath(docPath, container.env.cwd, container.env.homeDir);

  let content: string;
  try {
    content = await container.fs.readFile(absolutePath, "utf8");
  } catch {
    throw new ValidationError(`Experiment doc not found: ${docPath}`);
  }

  try {
    return {
      absolutePath,
      frontmatter: parseExperimentFrontmatter(content).frontmatter
    };
  } catch (error) {
    if (isFrontmatterKindError(error)) {
      throw new ValidationError(
        `Found ${docPath} but kind is "${error.foundKind}", expected "${error.expectedKind}". Pass an experiment doc, or create one with \`poe-code experiment install\`.`
      );
    }

    throw new ValidationError(
      `Invalid experiment doc ${docPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function resolveRunAgent(options: {
  container: CliContainer;
  program: Command;
  providedAgent?: string;
  frontmatterAgent?: string | string[];
}): Promise<string | string[] | null> {
  const providedAgents = options.providedAgent ? splitAgentList(options.providedAgent) : [];

  if (options.providedAgent) {
    if (providedAgents.length === 0) {
      return resolveExperimentAgent(undefined);
    }
    if (providedAgents.length > 1) {
      return providedAgents.map((agent) => resolveExperimentAgent(agent));
    }
  }

  if (Array.isArray(options.frontmatterAgent)) {
    if (providedAgents.length === 1) {
      return resolveExperimentAgent(options.providedAgent);
    }
    return options.frontmatterAgent.map((a) => resolveExperimentAgent(a, "frontmatter agent"));
  }

  const flags = resolveCommandFlags(options.program);
  if (
    !flags.assumeYes &&
    options.providedAgent === undefined &&
    typeof options.frontmatterAgent !== "string"
  ) {
    requireInteractiveStdin(
      "Experiment agent selection requires --agent, frontmatter agent, or --yes when running without an interactive TTY."
    );
  }

  try {
    const selectedAgent = await resolveLoopAgent({
      providedAgent: options.providedAgent,
      frontmatterAgent:
        typeof options.frontmatterAgent === "string" ? options.frontmatterAgent : undefined,
      configuredDefaultAgent: await resolveDefaultAgent(options.container),
      assumeYes: flags.assumeYes,
      fallbackAgent: DEFAULT_EXPERIMENT_AGENT,
      message: "Select agent to run the experiment with:",
      select,
      isCancel
    });
    if ("cancelled" in selectedAgent) {
      cancel("Experiment run cancelled.");
      return null;
    }

    return resolveExperimentAgent(selectedAgent.agent);
  } catch (error) {
    if (providedAgents.length === 1 && options.providedAgent) {
      return resolveExperimentAgent(options.providedAgent);
    }

    if (typeof options.frontmatterAgent === "string") {
      return resolveExperimentAgent(options.frontmatterAgent, "frontmatter agent");
    }

    throw error;
  }
}

function splitAgentList(value: string): string[] {
  return value
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function formatJournalOutput(output: string): string {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return "-";
  }

  return trimmed.split("\n").join(" ↵ ");
}

export function registerExperimentCommand(program: Command, container: CliContainer): void {
  const experiment = program
    .command("experiment")
    .description("Run autonomous experiment loop workflows.")
    .addHelpCommand(false);

  const run = experiment
    .command("run")
    .description("Run an experiment doc through the autonomous experiment loop.")
    .argument("[docs...]", "Experiment doc paths to run sequentially")
    .option("--agent <agent>", "Override the agent from frontmatter")
    .option("--max-experiments <n>", "Limit the number of experiments to run")
    .option("--tui", dashboardTuiDescription("the experiment"))
    .option("--no-tui", "Disable the live dashboard for this experiment run");

  addRuntimeOptions(addWorktreeOptions(run)).action(async function (
    this: Command,
    docArgs: string[]
  ) {
    const flags = resolveCommandFlags(program);
    const resources = createExecutionResources(container, flags, "experiment:run");
    const options = this.opts<
      {
        agent?: string;
        maxExperiments?: string;
        tui?: boolean;
      } & RuntimeCliOptions &
        WorktreeCliOptions
    >();
    const runtimeOptions = pickRuntimeOptions(options);
    const worktreeOptions = pickWorktreeOptions(options);

    resources.logger.intro("experiment run");

    let integrations: Integrations | null = null;
    try {
      const commandConfig = await resolveExperimentCommandConfig(container, {
        readonly: flags.dryRun
      });
      const providedDocs: Array<string | undefined> = docArgs.length > 0 ? docArgs : [undefined];
      for (const docArg of providedDocs) {
        await integrations?.shutdown();
        integrations = null;
        const docPath = await resolveDocPath({
          container,
          program,
          providedDoc: docArg,
          planDirectory: commandConfig.planDirectory,
          selectMessage: "Select the experiment doc to run:",
          cancelMessage: "Experiment run cancelled."
        });
        if (!docPath) {
          return;
        }

        const doc = await readExperimentDoc(container, docPath);
        const agent = await resolveRunAgent({
          container,
          program,
          providedAgent: options.agent,
          frontmatterAgent: doc.frontmatter.agent
        });
        if (!agent) {
          return;
        }

        const maxExperiments = parseNonNegativeInt(options.maxExperiments, "max-experiments");
        if (flags.dryRun) {
          resources.logger.dryRun(
            `Dry run: would run experiment doc ${docPath} with ${formatExperimentAgentSummary(agent)} for up to ${formatMaxExperimentsLabel(maxExperiments)} experiments.`
          );
          continue;
        }

        integrations = await loadIntegrations(commandConfig.configDoc);
        const runOptions: Parameters<typeof sdkRunExperiment>[0] = {
          agent,
          cwd: container.env.cwd,
          homeDir: container.env.homeDir,
          docPath,
          worktree: worktreeOptions,
          ...runtimeOptions,
          ...(maxExperiments !== undefined ? { maxExperiments } : {}),
          onExperimentStart(index, currentAgent) {
            resources.logger.info(`Experiment ${index} (${currentAgent})`);
          },
          onBaselineCollected(baseline) {
            const entries = Object.entries(baseline)
              .map(([name, value]) => `${name}=${value}`)
              .join(", ");
            resources.logger.info(`Baseline collected: ${entries}`);
          },
          onCommit(commitHash) {
            resources.logger.info(`  Committed ${commitHash.slice(0, 7)}`);
          },
          onMetricResult(metric, result) {
            const score = result.score === null ? "-" : String(result.score);
            const status = result.passed ? "passed" : "failed";
            resources.logger.info(`  ${metric.name}: ${score} (${status})`);
          },
          onReset(targetHash) {
            resources.logger.info(`  Reset to ${targetHash.slice(0, 7)}`);
          },
          onExperimentComplete(index, entry) {
            const scores = entry.scores
              ? Object.entries(entry.scores)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(", ")
              : "-";
            resources.logger.info(
              `Experiment ${index} ${entry.status} in ${formatDashboardDuration(entry.durationMs)} · scores: ${scores}`
            );
          }
        };
        if (integrations?.spawnMiddleware) {
          runOptions.runAgent = createExperimentCliRunAgent({
            runtimeOptions,
            middlewares: [integrations.spawnMiddleware]
          });
        }
        const useDashboard = shouldUseInteractiveDashboard(options.tui ?? commandConfig.tui);
        const result = useDashboard
          ? await runExperimentWithDashboard({
              agent,
              docPath,
              maxExperiments,
              runOptions,
              runtimeOptions,
              ...(integrations ? { integrations } : {})
            })
          : await runExperimentWithIntegrations(integrations, docPath, {
              ...runOptions,
              ...mergeExperimentCallbacks(runOptions, integrations?.experimentCallbacks)
            });

        const summary = [
          `Experiments: ${result.experimentsCompleted}`,
          `Kept: ${result.experimentsKept}`,
          `Doc: ${result.docPath}`,
          `Duration: ${formatDashboardDuration(result.totalDurationMs)}`
        ].join("\n   ");

        if (result.stopReason === "cancelled") {
          process.exitCode = 130;
          resources.logger.warn("Experiment run cancelled.");
          resources.logger.resolved("Run summary", summary);
          return;
        }

        resources.logger.resolved("Run summary", summary);
        resources.logger.success("Experiment run finished.");
      }
    } finally {
      await integrations?.shutdown();
      resources.context.finalize();
    }
  });

  const journalCommand = experiment
    .command("journal")
    .description("Display the experiment journal as a table.")
    .argument("[doc]", "Experiment doc path")
    .action(async function (docArg?: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "experiment:journal");
      resources.logger.intro("experiment journal");

      try {
        const commandConfig = await resolveExperimentCommandConfig(container, { readonly: true });
        const docPath = await resolveDocPath({
          container,
          program,
          providedDoc: docArg,
          planDirectory: commandConfig.planDirectory,
          selectMessage: "Select the experiment doc journal to view:",
          cancelMessage: "Experiment journal cancelled."
        });
        if (!docPath) {
          return;
        }

        await readExperimentDoc(container, docPath);
        const entries = await sdkReadExperimentJournal({
          cwd: container.env.cwd,
          homeDir: container.env.homeDir,
          docPath
        });
        const theme = getTheme();
        const columns = [
          { name: "index", title: "#", alignment: "right", maxLen: 4 },
          { name: "status", title: "status", alignment: "left", maxLen: 8 },
          { name: "scores", title: "scores", alignment: "left", maxLen: 40 },
          { name: "duration", title: "duration", alignment: "right", maxLen: 10 },
          { name: "timestamp", title: "timestamp", alignment: "left", maxLen: 24 },
          { name: "commit", title: "commit", alignment: "left", maxLen: 10 },
          { name: "output", title: "output", alignment: "left", maxLen: 60 }
        ] as const;
        const rows = entries.map((entry, index) => ({
          index: String(index + 1),
          status: entry.status,
          scores: entry.scores
            ? Object.entries(entry.scores)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ")
            : "-",
          duration: formatDashboardDuration(entry.durationMs),
          timestamp: entry.timestamp,
          commit: entry.commit,
          output: formatJournalOutput(entry.output)
        }));

        resources.logger.info(
          renderTable({
            theme,
            columns: [...columns],
            rows
          })
        );
      } finally {
        resources.context.finalize();
      }
    });

  journalCommand
    .command("log")
    .description("Append an entry to the experiment journal.")
    .argument("[doc]", "Experiment doc path")
    .requiredOption("--status <status>", "Entry status: keep or discard")
    .requiredOption("--commit <hash>", "Git commit hash")
    .option("--scores <json>", "Metric scores as JSON object, e.g. '{\"tests\":2}'")
    .option("--output <text>", "Metric output text", "")
    .option("--duration-ms <number>", "Duration in milliseconds", "0")
    .action(async function (this: Command, docArg?: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "experiment:journal:log");
      const opts = this.opts<{
        status: string;
        commit: string;
        scores?: string;
        output: string;
        durationMs: string;
      }>();

      try {
        const commandConfig = await resolveExperimentCommandConfig(container, {
          readonly: flags.dryRun
        });
        const docPath = await resolveDocPath({
          container,
          program,
          providedDoc: docArg,
          planDirectory: commandConfig.planDirectory,
          selectMessage: "Select the experiment doc to log to:",
          cancelMessage: "Journal log cancelled."
        });
        if (!docPath) {
          return;
        }

        const status = opts.status as "keep" | "discard";
        if (status !== "keep" && status !== "discard") {
          throw new ValidationError(`Invalid status "${opts.status}". Must be keep or discard.`);
        }

        let scores: Record<string, number> | undefined;
        if (opts.scores) {
          scores = parseExperimentScores(opts.scores);
        }
        const durationMs = parseNonNegativeFiniteNumber(opts.durationMs, "--duration-ms");

        const entry = {
          commit: opts.commit,
          status,
          ...(scores ? { scores } : {}),
          output: opts.output,
          agentOutput: "",
          durationMs,
          timestamp: new Date().toISOString()
        };

        if (!flags.dryRun) {
          await sdkAppendExperimentJournalEntry({
            cwd: container.env.cwd,
            homeDir: container.env.homeDir,
            docPath,
            entry
          });
        }

        resources.context.complete({
          success: `Logged ${status} entry (commit: ${opts.commit})`,
          dry: `Would log ${status} entry (commit: ${opts.commit})`
        });
      } finally {
        resources.context.finalize();
      }
    });

  experiment
    .command("validate")
    .description("Validate an experiment doc without running it.")
    .argument("[doc]", "Experiment doc path")
    .action(async function (this: Command, docArg?: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "experiment:validate");

      try {
        resources.logger.intro("experiment validate");

        const commandConfig = await resolveExperimentCommandConfig(container, {
          readonly: flags.dryRun
        });
        const docPath = await resolveDocPath({
          container,
          program,
          providedDoc: docArg,
          planDirectory: commandConfig.planDirectory,
          selectMessage: "Select the experiment doc to validate:",
          cancelMessage: "Experiment validate cancelled."
        });
        if (!docPath) {
          return;
        }

        const doc = await readExperimentDoc(container, docPath);
        const errors = validateExperimentDoc(doc.frontmatter);

        if (errors.length > 0) {
          for (const error of errors) {
            resources.logger.error(error);
          }
          throw new ValidationError(
            `Experiment doc has ${errors.length} validation error${errors.length === 1 ? "" : "s"}.`
          );
        }

        const metrics = doc.frontmatter.metric
          ? Array.isArray(doc.frontmatter.metric)
            ? doc.frontmatter.metric
            : [doc.frontmatter.metric]
          : [];

        resources.logger.resolved("Doc", docPath);
        const agentDisplay = Array.isArray(doc.frontmatter.agent)
          ? doc.frontmatter.agent.join(", ")
          : doc.frontmatter.agent!;
        resources.logger.resolved("Agent", agentDisplay);
        resources.logger.resolved(
          "Metrics",
          metrics.map((m) => `${m.name}: ${m.script} (${m.direction})`).join(", ")
        );
        resources.logger.success("Experiment doc is valid.");
      } finally {
        resources.context.finalize();
      }
    });

  // `plan-path` stays an alias: scripts interpolate it and it is the name every other plan-owning
  // command group uses.
  experiment
    .command("show-plan-path")
    .alias("plan-path")
    .description("Print the directory where experiment plan files should be placed.")
    .action(async function () {
      const commandConfig = await resolveExperimentCommandConfig(container, { readonly: true });

      const resolvedPath = resolvePlanDirectory({
        cwd: container.env.cwd,
        homeDir: container.env.homeDir,
        planDirectory: commandConfig.planDirectory
      });

      process.stdout.write(`${resolvedPath}\n`);
    });

  experiment
    .command("install")
    .description("Install the Experiment skill and scaffold experiment files.")
    .option("--agent <name>", "Target agent")
    .option("--local", "Install project-local skill and experiment files")
    .option("--global", "Install user-global skill and experiment files")
    .option("--force", "Overwrite existing files")
    .action(async function (this: Command) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "experiment:install");
      const options = this.opts<ExperimentInstallCommandOptions>();

      if (options.local && options.global) {
        throw new ValidationError("Use either --local or --global, not both.");
      }

      try {
        let agent = options.agent;
        if (!agent) {
          const fromConfig = await resolveDefaultAgent(container, { readOnly: flags.dryRun });
          if (fromConfig !== null) {
            agent = parseAgentSpecifier(fromConfig).agent;
          } else if (flags.assumeYes) {
            agent = DEFAULT_EXPERIMENT_AGENT;
          } else {
            requireInteractiveStdin(
              "Experiment install agent selection requires --agent or --yes when running without an interactive TTY."
            );

            const selected = await select({
              message: "Select agent to install the Experiment skill for:",
              options: supportedAgents.map((value) => ({
                value,
                label: value
              }))
            });
            if (isCancel(selected)) {
              cancel("Experiment install cancelled.");
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
          scope = DEFAULT_EXPERIMENT_SCOPE;
        } else {
          requireInteractiveStdin(
            "Experiment install scope selection requires --local, --global, or --yes when running without an interactive TTY."
          );

          const selected = await select({
            message: "Select install scope:",
            options: [
              { value: "local", label: "Local" },
              { value: "global", label: "Global" }
            ]
          });
          if (isCancel(selected)) {
            cancel("Experiment install cancelled.");
            return;
          }
          scope = selected as SkillScope;
        }

        resources.logger.intro(`experiment install (${support.id}, ${scope})`);

        const templates = await loadExperimentTemplates();
        const experimentPaths = resolveExperimentPaths(
          scope,
          container.env.cwd,
          container.env.homeDir
        );
        const runYamlPath = path.join(experimentPaths.experimentsPath, "run.yaml");
        const runYamlDisplayPath = path.join(experimentPaths.displayExperimentsPath, "run.yaml");
        const experimentsPathExisted = await pathExists(
          container.fs,
          experimentPaths.experimentsPath
        );
        const runYamlExisted = await pathExists(container.fs, runYamlPath);
        let createdExperimentsPath = false;
        let createdRunYaml = false;

        try {
          if (!experimentsPathExisted) {
            if (flags.dryRun) {
              resources.logger.dryRun(`Would create: ${experimentPaths.displayExperimentsPath}`);
            } else {
              await container.fs.mkdir(experimentPaths.experimentsPath, {
                recursive: true
              });
              createdExperimentsPath = true;
              resources.logger.info(`Create: ${experimentPaths.displayExperimentsPath}`);
            }
          }

          if (!runYamlExisted) {
            if (flags.dryRun) {
              resources.logger.dryRun(`Would create: ${runYamlDisplayPath}`);
            } else {
              try {
                await container.fs.writeFile(runYamlPath, templates.runYaml, {
                  encoding: "utf8",
                  flag: "wx"
                });
              } catch (error) {
                if (!isAlreadyExists(error)) {
                  await container.fs.unlink(runYamlPath).catch(() => undefined);
                }
                throw error;
              }
              createdRunYaml = true;
              resources.logger.info(`Create: ${runYamlDisplayPath}`);
            }
          }

          await installSkillFile({
            container,
            logger: resources.logger,
            agentId: support.id,
            skill: {
              name: "poe-code-experiment-plan",
              content: templates.skillPlan + "\n\n" + skillPlanConfigSection("experiment")
            },
            scope,
            force: options.force === true,
            dryRun: flags.dryRun
          });
        } catch (error) {
          if (!flags.dryRun) {
            if (createdRunYaml) {
              await container.fs.unlink(runYamlPath).catch(() => undefined);
            }
            if (createdExperimentsPath) {
              await container.fs
                .rm?.(experimentPaths.experimentsPath, { recursive: true, force: true })
                .catch(() => undefined);
            }
          }
          throw error;
        }

        resources.context.complete({
          success: `Installed Experiment skill for ${support.id} and scaffolded ${scope} experiment files`,
          dry: `Would install Experiment skill for ${support.id} and scaffold ${scope} experiment files`
        });
      } finally {
        resources.context.finalize();
      }
    });
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "EEXIST");
}
