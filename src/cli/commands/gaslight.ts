import path from "node:path";
import { Option, type Command } from "commander";
import { parseAgentSpecifier } from "@poe-code/agent-defs";
import { formatPlanReadinessLabel } from "@poe-code/agent-harness-tools";
import { spawn, SPAWN_MODES, type SpawnOptions, type SpawnResult } from "@poe-code/agent-spawn";
import { discoverAllPlans } from "@poe-code/plan-browser";
import { readMergedDocumentReadonly, resolveScope } from "@poe-code/poe-code-config/core";
import { cancel, intro, isCancel, multiselect, outro, select, withSpinner } from "toolcraft-design";
import type { CliContainer } from "../container.js";
import {
  GASLIGHT_CONFIG_EXAMPLE,
  ingestGaslight,
  loadGaslightConfig,
  runGaslight,
  runGaslightDaemon,
  type GaslightDaemonEvent,
  type GaslightEvent,
  type GaslightIngestEvent
} from "../../sdk/gaslight.js";
import { spawn as sdkSpawn } from "../../sdk/spawn.js";
import { resolvePlanDirectory } from "./plan.js";
import {
  buildResumeCommand,
  createExecutionResources,
  requireInteractiveStdin,
  resolveCommandFlags,
  resolveDefaultAgent
} from "./shared.js";
import { resolveServiceArgument } from "./configure.js";
import { OperationCancelledError, ValidationError } from "../errors.js";
import { hasOwnErrorCode } from "../../utils/error-codes.js";
import { renderUnifiedDiff } from "../../utils/dry-run.js";
import { addWorktreeOptions, pickWorktreeOptions } from "./worktree-options.js";
import {
  addActivityTimeoutOption,
  pickActivityTimeoutOptions,
  type ActivityTimeoutCliOptions
} from "./activity-timeout-options.js";
import { addSkillOptions, resolveSkillOptions, type SkillCliOptions } from "./skill-options.js";
import { gaslightConfigScope } from "../../services/config.js";

const DEFAULT_AGENT = "claude-code";

interface GaslightCommandOptions extends ActivityTimeoutCliOptions, SkillCliOptions {
  agent?: string;
  archive?: boolean;
  config?: string;
  model?: string;
  mode?: "read" | "edit" | "yolo" | "auto";
  plans?: string[];
  worktree?: boolean;
}

async function resolveGaslightCommandConfig(
  container: CliContainer
): Promise<{ archive?: boolean }> {
  const configDoc = await readMergedDocumentReadonly(
    container.fs,
    container.env.configPath,
    container.env.projectConfigPath
  );
  const rawGaslightConfig = configDoc[gaslightConfigScope.scope];
  const hasArchiveConfig =
    (typeof rawGaslightConfig === "object" &&
      rawGaslightConfig !== null &&
      "auto-archive" in rawGaslightConfig) ||
    container.env.variables.POE_GASLIGHT_AUTO_ARCHIVE !== undefined;
  const gaslightConfig = resolveScope(
    gaslightConfigScope.schema,
    rawGaslightConfig,
    container.env.variables
  );
  return hasArchiveConfig ? { archive: gaslightConfig["auto-archive"] === true } : {};
}

interface GaslightIngestCommandOptions {
  agent?: string;
  allWorkspaces?: boolean;
  keepData?: string;
  limit?: string;
  model?: string;
  output?: string;
  since?: string;
  sources?: string;
}

interface GaslightDaemonCommandOptions extends ActivityTimeoutCliOptions, SkillCliOptions {
  agent?: string;
  config?: string;
  model?: string;
  mode?: "read" | "edit" | "yolo" | "auto";
  pollIntervalMs?: string;
  worktree?: boolean;
}

interface GaslightInstallOptions {
  force?: boolean;
  global?: boolean;
  local?: boolean;
}

type GaslightConfigScope = "global" | "local";

const DEFAULT_SCOPE: GaslightConfigScope = "local";

function resolveConfiguredPath(cwd: string, homeDir: string, value: string): string {
  if (value.startsWith("~/")) {
    return path.join(homeDir, value.slice(2));
  }
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}

function formatPlanDirectoryDetails(
  container: CliContainer,
  planDirectory: string,
  absoluteDirectory: string
): string {
  return [
    `Configured directory: ${planDirectory}`,
    `Resolved path: ${absoluteDirectory}`,
    "",
    "To use a different plan directory:",
    `- Project config: poe-code utils config edit --project`,
    `  ${container.env.projectConfigPath}`,
    `- Global config: poe-code utils config edit --global`,
    `  ${container.env.configPath}`,
    `- Set JSON: { "plan": { "plan_directory": "~/.poe-code/docs/plans" } }`,
    `- One-off: POE_PLAN_DIRECTORY=~/.poe-code/docs/plans poe-code gaslight`
  ].join("\n");
}

async function selectPlans(container: CliContainer, assumeYes: boolean): Promise<string[]> {
  const planDirectory = await resolvePlanDirectory(container, { readOnly: true });
  const absoluteDirectory = resolveConfiguredPath(
    container.env.cwd,
    container.env.homeDir,
    planDirectory
  );
  let names: string[];
  try {
    names = await container.fs.readdir(absoluteDirectory);
  } catch {
    throw new ValidationError(
      `Gaslight couldn't find the plan directory.\n\n${formatPlanDirectoryDetails(
        container,
        planDirectory,
        absoluteDirectory
      )}`
    );
  }
  if (!names.some((name) => name.endsWith(".md"))) {
    throw new ValidationError(
      `Gaslight found the plan directory, but it has no .md plans.\n\n${formatPlanDirectoryDetails(
        container,
        planDirectory,
        absoluteDirectory
      )}`
    );
  }
  const plans = await discoverAllPlans({
    cwd: container.env.cwd,
    homeDir: container.env.homeDir,
    configPath: container.env.configPath,
    projectConfigPath: container.env.projectConfigPath,
    fs: container.fs as Parameters<typeof discoverAllPlans>[0]["fs"],
    variables: container.env.variables
  });
  if (assumeYes || process.stdin.isTTY !== true) {
    throw new ValidationError(
      [
        "Gaslight needs an explicit plan path or --plans: --yes and non-interactive runs never pick a plan for you.",
        "",
        "Plans:",
        ...plans.map((plan) => `- ${plan.path}`)
      ].join("\n")
    );
  }
  const selected = await multiselect({
    message: "Select Gaslight plans to run:",
    options: plans.map((plan) => ({
      label: formatPlanReadinessLabel(plan.path, plan.readiness),
      value: plan.path
    })),
    required: true
  });
  if (isCancel(selected)) {
    throw new OperationCancelledError("Gaslight cancelled.");
  }
  return Array.isArray(selected) ? selected : [];
}

async function resolveGaslightPlanPaths(options: {
  container: CliContainer;
  assumeYes: boolean;
  positionalPlanPaths?: string[];
  optionPlanPaths?: string[];
}): Promise<string[]> {
  const sources = [
    options.positionalPlanPaths && options.positionalPlanPaths.length > 0
      ? "positional plans"
      : undefined,
    options.optionPlanPaths && options.optionPlanPaths.length > 0 ? "--plans" : undefined
  ].filter((source): source is string => source !== undefined);

  if (sources.length > 1) {
    throw new ValidationError(`Use only one plan source: ${sources.join(", ")}.`);
  }

  if (options.optionPlanPaths && options.optionPlanPaths.length > 0) {
    return options.optionPlanPaths;
  }
  if (options.positionalPlanPaths && options.positionalPlanPaths.length > 0) {
    return options.positionalPlanPaths;
  }
  return selectPlans(options.container, options.assumeYes);
}

async function resolveAgentAndModel(
  program: Command,
  container: CliContainer,
  options: GaslightCommandOptions,
  useConfiguredAgent = false,
  gaslightAgent?: string
): Promise<{ agent: string; model?: string }> {
  const flags = resolveCommandFlags(program);
  const configured = await resolveDefaultAgent(container, { readOnly: true });
  const configuredSpecifier = configured ? parseAgentSpecifier(configured) : undefined;
  const gaslightSpecifier = gaslightAgent ? parseAgentSpecifier(gaslightAgent) : undefined;
  const agent =
    options.agent ??
    gaslightSpecifier?.agent ??
    (flags.assumeYes || useConfiguredAgent
      ? (configuredSpecifier?.agent ?? DEFAULT_AGENT)
      : await resolveServiceArgument(program, container, undefined, { action: "gaslight" }));
  const model =
    options.model ??
    (gaslightSpecifier?.agent === agent ? gaslightSpecifier.model : undefined) ??
    (configuredSpecifier?.agent === agent ? configuredSpecifier.model : undefined);
  return { agent, ...(model ? { model } : {}) };
}

function formatUsage(usage: Awaited<ReturnType<typeof runGaslight>>["usage"]): string {
  if (!usage) {
    return "Usage unavailable";
  }
  const cost = usage.costUsd === undefined ? "" : ` · $${usage.costUsd.toFixed(2)}`;
  return `Usage: ${usage.inputTokens.toLocaleString()} input / ${usage.outputTokens.toLocaleString()} output tokens${cost}`;
}

function formatCompletedPlans(result: Awaited<ReturnType<typeof runGaslight>>): string {
  return [
    "Completed plans:",
    ...result.plans.map(
      (plan) =>
        `- ${path.basename(plan.planPath)}${plan.durationMs === undefined ? "" : ` · ${formatDuration(plan.durationMs)}`}`
    )
  ].join("\n");
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [
    days > 0 ? `${days}d` : undefined,
    hours > 0 ? `${hours}h` : undefined,
    minutes > 0 ? `${minutes}m` : undefined,
    seconds > 0 || totalSeconds === 0 ? `${seconds}s` : undefined
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
}

function parseSources(value: string | undefined): Array<"claude" | "codex"> | undefined {
  if (!value) {
    return undefined;
  }
  const sources = value
    .split(",")
    .map((source) => source.trim())
    .filter((source) => source.length > 0);
  for (const source of sources) {
    if (source !== "claude" && source !== "codex") {
      throw new ValidationError(
        `Unsupported trace source "${source}". Use claude, codex, or both.`
      );
    }
  }
  return sources as Array<"claude" | "codex">;
}

function parsePositiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed.toString() !== value.trim()) {
    throw new ValidationError(`${label} must be a positive integer.`);
  }
  return parsed;
}

async function resolveInstallScope(
  options: GaslightInstallOptions,
  assumeYes: boolean
): Promise<GaslightConfigScope | null> {
  if (options.local && options.global) {
    throw new ValidationError("Use either --local or --global, not both.");
  }
  if (options.local) return "local";
  if (options.global) return "global";
  if (assumeYes) return DEFAULT_SCOPE;
  requireInteractiveStdin(
    "Gaslight install scope selection requires --local, --global, or --yes when running without an interactive TTY."
  );
  const selected = await select({
    message: "Select install scope:",
    options: [
      { label: "Local", value: "local" },
      { label: "Global", value: "global" }
    ]
  });
  if (isCancel(selected)) {
    cancel("Gaslight install cancelled.");
    return null;
  }
  return selected as GaslightConfigScope;
}

// The diff shown before a forced overwrite must be the exact bytes written.
const gaslightConfigFileContent = `${GASLIGHT_CONFIG_EXAMPLE}\n`;

async function scaffoldConfig(
  container: CliContainer,
  scope: GaslightConfigScope,
  force: boolean,
  dryRun: boolean
): Promise<{ path: string; changed: boolean; previousContent: string | null }> {
  const root = scope === "global" ? container.env.homeDir : container.env.cwd;
  const configPath = path.join(root, ".poe-code", "gaslight.yaml");
  const configDirectory = path.dirname(configPath);
  try {
    const stats = await container.fs.lstat(configDirectory);
    if (stats.isSymbolicLink()) {
      throw new Error(`Gaslight config directory cannot be a symbolic link: ${configDirectory}`);
    }
  } catch (error) {
    if (!hasOwnErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
  let previousContent: string | null = null;
  try {
    previousContent = await container.fs.readFile(configPath, "utf8");
    if (!force) {
      return { path: configPath, changed: false, previousContent };
    }
  } catch (error) {
    if (!hasOwnErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
  if (!dryRun) {
    await container.fs.mkdir(configDirectory, { recursive: true });
    await container.fs.writeFile(configPath, gaslightConfigFileContent, {
      encoding: "utf8"
    });
  }
  return { path: configPath, changed: true, previousContent };
}

export function registerGaslightCommand(program: Command, container: CliContainer): void {
  const gaslight = program
    .command("gaslight")
    .description("Run a plan through a resumable sequence of agent follow-ups.")
    .argument(
      "[plan-paths...]",
      "Markdown plans to run sequentially; each plan is sent with the configured prompt (default: Implement)"
    )
    .option("--agent <agent>", "Agent to run")
    .option("--archive", "Archive each plan after all gaslight rounds succeed")
    .option("--no-archive", "Leave plans in place after gaslight rounds succeed (default)")
    .option("--config <path>", "gaslight.yaml variant to use")
    .option("--model <model>", "Model to run")
    .option("--plans <paths...>", "Markdown plans to run sequentially")
    .addOption(new Option("--mode <mode>", "Spawn mode").choices([...SPAWN_MODES]));

  addSkillOptions(addActivityTimeoutOption(addWorktreeOptions(gaslight))).action(async function (
    this: Command,
    providedPlanPaths: string[]
  ) {
    const flags = resolveCommandFlags(program);
    const options = this.opts<GaslightCommandOptions>();
    const planPaths = await resolveGaslightPlanPaths({
      container,
      assumeYes: flags.assumeYes,
      positionalPlanPaths: providedPlanPaths,
      optionPlanPaths: options.plans
    });
    const commandConfig = await resolveGaslightCommandConfig(container);
    const skills = resolveSkillOptions(options);
    const gaslightConfig = await loadGaslightConfig(
      container.env.cwd,
      container.env.homeDir,
      container.fs,
      options.config
    );
    const { agent, model } = await resolveAgentAndModel(
      program,
      container,
      options,
      false,
      gaslightConfig.agent
    );
    const logger = container.loggerFactory.create();

    intro("gaslight");
    if (flags.dryRun) {
      logger.dryRun(
        [
          "Dry run: would run Gaslight.",
          "Plans:",
          ...planPaths.map((planPath) => `- ${planPath}`),
          `Agent: ${agent}`,
          model ? `Model: ${model}` : undefined,
          gaslightConfig.path ? `Config: ${gaslightConfig.path}` : undefined,
          options.mode ? `Mode: ${options.mode}` : undefined,
          `Worktree: ${options.worktree === true ? "enabled" : "disabled"}`,
          `Archive on success: ${options.archive ?? commandConfig.archive ?? gaslightConfig.archive ?? false}`
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n")
      );
      return;
    }
    const result = await runGaslight({
      planPaths,
      agent,
      ...(model ? { model } : {}),
      ...(options.config ? { configPath: options.config } : {}),
      archive: options.archive ?? commandConfig.archive,
      ...(options.mode ? { mode: options.mode } : {}),
      cwd: container.env.cwd,
      homeDir: container.env.homeDir,
      worktree: pickWorktreeOptions(options as Record<string, unknown>),
      fs: container.fs,
      onEvent(event: GaslightEvent) {
        if (event.type === "round.started") {
          logger.resolved("Prompt", event.prompt);
        }
      },
      spawn: async (spawnAgent: string, spawnOptions: SpawnOptions): Promise<SpawnResult> =>
        await sdkSpawn.pretty(spawnAgent, {
          ...spawnOptions,
          ...pickActivityTimeoutOptions(options),
          ...(skills ? { skills } : {})
        })
    });
    const finished =
      planPaths.length > 1
        ? `${planPaths.length} plans · ${result.rounds.length} rounds finished`
        : `${result.rounds.length} rounds finished`;
    const finishedWithDuration =
      result.durationMs === undefined
        ? finished
        : `${finished} · ${formatDuration(result.durationMs)} total`;
    const lastThreadId = result.rounds.at(-1)?.threadId;
    const resumeCommand = lastThreadId
      ? buildResumeCommand(agent, lastThreadId, container.env.cwd)
      : undefined;
    outro(
      [
        finishedWithDuration,
        formatCompletedPlans(result),
        formatUsage(result.usage),
        resumeCommand ? `Resume: ${resumeCommand}` : undefined
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n")
    );
  });

  gaslight
    .command("daemon")
    .description("Continuously implement ready regular plans sequentially.")
    .option("--agent <agent>", "Agent to run")
    .option("--config <path>", "gaslight.yaml variant to use")
    .option("--model <model>", "Model to run")
    .option("--poll-interval-ms <ms>", "Delay between plan directory scans", "5000");

  const daemon = gaslight.commands.find((command) => command.name() === "daemon");
  if (!daemon) throw new Error("Gaslight daemon command registration failed.");
  daemon.configureHelp({ showGlobalOptions: false });
  addSkillOptions(addActivityTimeoutOption(addWorktreeOptions(daemon))).action(async () => {
    const flags = resolveCommandFlags(program);
    const options = {
      ...gaslight.opts<GaslightDaemonCommandOptions>(),
      ...daemon.opts<GaslightDaemonCommandOptions>()
    };
    const planDirectory = await resolvePlanDirectory(container, { readOnly: true });
    const gaslightConfig = await loadGaslightConfig(
      container.env.cwd,
      container.env.homeDir,
      container.fs,
      options.config
    );
    const { agent, model } = await resolveAgentAndModel(
      program,
      container,
      options,
      true,
      gaslightConfig.agent
    );
    const skills = resolveSkillOptions(options);
    const logger = container.loggerFactory.create();
    const pollIntervalMs = parsePositiveInteger(options.pollIntervalMs, "--poll-interval-ms");
    if (flags.dryRun) {
      intro("gaslight daemon");
      logger.dryRun(
        [
          `Dry run: would watch ${planDirectory} for ready regular plans.`,
          `Poll interval: ${pollIntervalMs} ms`,
          `Agent: ${agent}`,
          model ? `Model: ${model}` : undefined,
          gaslightConfig.path ? `Config: ${gaslightConfig.path}` : undefined,
          options.mode ? `Mode: ${options.mode}` : undefined,
          `Worktree: ${options.worktree === true ? "enabled" : "disabled"}`,
          "Archive on success: true"
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n")
      );
      return;
    }
    const controller = new AbortController();
    const stop = (): void => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    intro("gaslight daemon");
    try {
      const result = await runGaslightDaemon({
        planDirectory,
        pollIntervalMs,
        agent,
        ...(model ? { model } : {}),
        ...(options.config ? { configPath: options.config } : {}),
        ...(options.mode ? { mode: options.mode } : {}),
        cwd: container.env.cwd,
        homeDir: container.env.homeDir,
        worktree: pickWorktreeOptions(options as Record<string, unknown>),
        fs: container.fs,
        signal: controller.signal,
        onEvent(event: GaslightDaemonEvent) {
          if (event.type === "plan.started") logger.resolved("Plan", event.planPath);
          if (event.type === "plan.failed") logger.error(`${event.planPath}: ${event.error}`);
        },
        spawn: async (spawnAgent: string, spawnOptions: SpawnOptions): Promise<SpawnResult> =>
          await sdkSpawn.pretty(spawnAgent, {
            ...spawnOptions,
            ...pickActivityTimeoutOptions(options),
            ...(skills ? { skills } : {})
          })
      });
      outro(`Gaslight daemon stopped · ${result.completedPlans} plans completed`);
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  });

  gaslight
    .command("ingest")
    .description("Generate a gaslight config from local Claude and Codex traces.")
    .option("--agent <agent>", "Agent to analyze extracted prompts")
    .option("--model <model>", "Model to run")
    .option("--sources <sources>", "Comma-separated trace sources: claude,codex")
    .option("--since <duration>", "Only include recently updated traces", "30d")
    .option("--limit <number>", "Maximum extracted human prompts", "200")
    .option("--output <path>", "Generated gaslight config path")
    .option("--keep-data <path>", "Persist curated analysis input at this path")
    .option("--all-workspaces", "Read traces from every workspace")
    .action(async function (this: Command) {
      const options = {
        ...gaslight.opts<GaslightIngestCommandOptions>(),
        ...this.opts<GaslightIngestCommandOptions>()
      };
      const flags = resolveCommandFlags(program);
      const { agent, model } = await resolveAgentAndModel(
        program,
        container,
        options,
        flags.dryRun
      );
      let extractedPrompts = 0;
      let extractedTraces = 0;
      const logger = container.loggerFactory.create();

      intro("gaslight ingest");
      const result = await ingestGaslight({
        analysisAgent: agent,
        ...(model ? { model } : {}),
        ...(flags.dryRun ? { dryRun: true } : {}),
        sources: parseSources(options.sources),
        since: options.since,
        limit: parsePositiveInteger(options.limit, "--limit"),
        allWorkspaces: options.allWorkspaces === true,
        ...(options.output ? { outputPath: options.output } : {}),
        ...(options.keepData ? { keepDataPath: options.keepData } : {}),
        cwd: container.env.cwd,
        homeDir: container.env.homeDir,
        fs: container.fs,
        onEvent(event: GaslightIngestEvent) {
          if (event.type === "prompts.extracted") {
            extractedPrompts = event.prompts;
            extractedTraces = event.traces;
          }
        },
        spawn: async (spawnAgent: string, spawnOptions: SpawnOptions): Promise<SpawnResult> =>
          await withSpinner({
            message: () =>
              `Analyzing ${extractedPrompts} prompts from ${extractedTraces} traces with ${spawnAgent}`,
            fn: () => spawn(spawnAgent, spawnOptions),
            stopMessage: () =>
              `Analyzed ${extractedPrompts} prompts from ${extractedTraces} traces with ${spawnAgent}`
          })
      });
      if (options.keepData && !flags.dryRun) {
        logger.resolved("Analysis input", result.dataPath);
      }
      outro(
        flags.dryRun
          ? `Would analyze ${result.promptCount} prompts from ${result.traceCount} traces with ${agent} and write ${result.outputPath}`
          : `Wrote ${result.outputPath}`
      );
    });

  gaslight
    .command("install")
    .description("Install a default gaslight.yaml configuration.")
    .option("--local", "Install project-local config")
    .option("--global", "Install user-global config")
    .option("--force", "Overwrite an existing gaslight.yaml")
    .action(async function (this: Command) {
      const flags = resolveCommandFlags(program);
      const options = this.opts<GaslightInstallOptions>();
      const resources = createExecutionResources(container, flags, "gaslight:install");
      try {
        const scope = await resolveInstallScope(options, flags.assumeYes);
        if (scope === null) return;

        resources.logger.intro(`gaslight install (${scope})`);
        const config = await scaffoldConfig(container, scope, options.force === true, flags.dryRun);
        if (config.changed) {
          if (config.previousContent !== null) {
            resources.logger.info(
              renderUnifiedDiff(
                config.path,
                config.previousContent,
                gaslightConfigFileContent
              ).join("\n")
            );
          }
          const verb = config.previousContent !== null ? "overwrite" : "create";
          resources.logger[flags.dryRun ? "dryRun" : "info"](
            flags.dryRun
              ? `Would ${verb}: ${config.path}`
              : `${verb === "overwrite" ? "Overwrite" : "Create"}: ${config.path}`
          );
        }
        resources.context.complete({
          success: config.changed
            ? `Installed Gaslight config (${scope}).`
            : `Gaslight config already exists (${scope}).`,
          dry: config.changed
            ? `Would install Gaslight config (${scope}).`
            : `Gaslight config already exists (${scope}).`
        });
      } finally {
        resources.context.finalize();
      }
    });
}
