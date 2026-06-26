import path from "node:path";
import { Option, type Command } from "commander";
import { parseAgentSpecifier } from "@poe-code/agent-defs";
import { spawn, type SpawnOptions, type SpawnResult } from "@poe-code/agent-spawn";
import { readMergedDocumentReadonly, resolveScope } from "@poe-code/poe-code-config";
import { cancel, intro, isCancel, multiselect, outro, select, withSpinner } from "toolcraft-design";
import type { CliContainer } from "../container.js";
import {
  GASLIGHT_CONFIG_EXAMPLE,
  ingestGaslight,
  runGaslight,
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
import { ValidationError } from "../errors.js";
import { hasOwnErrorCode } from "../../utils/error-codes.js";
import { addWorktreeOptions, pickWorktreeOptions } from "./worktree-options.js";
import { gaslightConfigScope } from "../../services/config.js";

const DEFAULT_AGENT = "claude-code";

interface GaslightCommandOptions {
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
      "archive" in rawGaslightConfig) ||
    container.env.variables.POE_GASLIGHT_ARCHIVE !== undefined;
  const gaslightConfig = resolveScope(
    gaslightConfigScope.schema,
    rawGaslightConfig,
    container.env.variables
  );
  return hasArchiveConfig ? { archive: gaslightConfig.archive === true } : {};
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
  const plans = names
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => path.join(planDirectory, name));
  if (plans.length === 0) {
    throw new ValidationError(
      `Gaslight found the plan directory, but it has no .md plans.\n\n${formatPlanDirectoryDetails(
        container,
        planDirectory,
        absoluteDirectory
      )}`
    );
  }
  if (assumeYes) {
    return [plans[0]!];
  }
  requireInteractiveStdin(
    "Gaslight plan selection requires a plan path, --plans, or --yes when running without an interactive TTY."
  );
  const selected = await multiselect({
    message: "Select Gaslight plans to run:",
    options: plans.map((plan) => ({ label: plan, value: plan })),
    required: true
  });
  if (isCancel(selected)) {
    throw new Error("Gaslight cancelled.");
  }
  return Array.isArray(selected) ? selected : [];
}

async function resolveGaslightPlanPaths(options: {
  container: CliContainer;
  assumeYes: boolean;
  positionalPlanPath?: string;
  optionPlanPaths?: string[];
}): Promise<string[]> {
  const sources = [
    options.positionalPlanPath ? "positional plan" : undefined,
    options.optionPlanPaths && options.optionPlanPaths.length > 0 ? "--plans" : undefined
  ].filter((source): source is string => source !== undefined);

  if (sources.length > 1) {
    throw new ValidationError(`Use only one plan source: ${sources.join(", ")}.`);
  }

  if (options.optionPlanPaths && options.optionPlanPaths.length > 0) {
    return options.optionPlanPaths;
  }
  if (options.positionalPlanPath) {
    return [options.positionalPlanPath];
  }
  return selectPlans(options.container, options.assumeYes);
}

async function resolveAgentAndModel(
  program: Command,
  container: CliContainer,
  options: GaslightCommandOptions
): Promise<{ agent: string; model?: string }> {
  const flags = resolveCommandFlags(program);
  const configured = await resolveDefaultAgent(container, { readOnly: true });
  const configuredSpecifier = configured ? parseAgentSpecifier(configured) : undefined;
  const agent =
    options.agent ??
    (flags.assumeYes
      ? (configuredSpecifier?.agent ?? DEFAULT_AGENT)
      : await resolveServiceArgument(program, container, undefined, { action: "gaslight" }));
  if (options.model) {
    return { agent, model: options.model };
  }

  const adapter = container.registry.get(agent);
  const defaultModel =
    configuredSpecifier?.agent === agent && configuredSpecifier.model
      ? configuredSpecifier.model
      : adapter?.configurePrompts?.model?.defaultValue;
  if (flags.assumeYes) {
    return { agent, ...(defaultModel ? { model: defaultModel } : {}) };
  }
  const model = await container.options.resolveModel({
    label: `${adapter?.label ?? agent} model`,
    defaultValue: defaultModel ?? "",
    choices: Array.isArray(adapter?.configurePrompts?.model?.choices)
      ? adapter.configurePrompts.model.choices
      : []
  });
  return { agent, model };
}

function formatUsage(usage: Awaited<ReturnType<typeof runGaslight>>["usage"]): string {
  if (!usage) {
    return "Usage unavailable";
  }
  const cost = usage.costUsd === undefined ? "" : ` · $${usage.costUsd.toFixed(2)}`;
  return `Usage: ${usage.inputTokens.toLocaleString()} input / ${usage.outputTokens.toLocaleString()} output tokens${cost}`;
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

async function scaffoldConfig(
  container: CliContainer,
  scope: GaslightConfigScope,
  force: boolean,
  dryRun: boolean
): Promise<{ path: string; changed: boolean }> {
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
  try {
    await container.fs.stat(configPath);
    if (!force) {
      return { path: configPath, changed: false };
    }
  } catch (error) {
    if (!hasOwnErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
  if (!dryRun) {
    await container.fs.mkdir(configDirectory, { recursive: true });
    await container.fs.writeFile(configPath, `${GASLIGHT_CONFIG_EXAMPLE}\n`, {
      encoding: "utf8"
    });
  }
  return { path: configPath, changed: true };
}

export function registerGaslightCommand(program: Command, container: CliContainer): void {
  const gaslight = addWorktreeOptions(program
      .command("gaslight")
      .description("Run a plan through a resumable sequence of agent follow-ups.")
      .argument("[plan-path]", "Markdown plan to implement")
      .option("--agent <agent>", "Agent to run")
      .option("--archive", "Archive each plan after all gaslight rounds succeed")
      .option("--no-archive", "Leave plans in place after gaslight rounds succeed")
      .option("--config <path>", "gaslight.yaml variant to use")
      .option("--model <model>", "Model to run")
      .option("--plans <paths...>", "Markdown plans to run sequentially")
      .addOption(
        new Option("--mode <mode>", "Spawn mode")
          .choices(["read", "edit", "yolo", "auto"])
          .default("auto")
      ))
    .action(async function (this: Command, providedPlanPath: string | undefined) {
      const flags = resolveCommandFlags(program);
      const options = this.opts<GaslightCommandOptions>();
      const planPaths = await resolveGaslightPlanPaths({
        container,
        assumeYes: flags.assumeYes,
        positionalPlanPath: providedPlanPath,
        optionPlanPaths: options.plans
      });
      const commandConfig = await resolveGaslightCommandConfig(container);
      const { agent, model } = await resolveAgentAndModel(program, container, options);
      const logger = container.loggerFactory.create();

      intro("gaslight");
      const result = await runGaslight({
        planPaths,
        agent,
        ...(model ? { model } : {}),
        ...(options.config ? { configPath: options.config } : {}),
        archive: options.archive ?? commandConfig.archive,
        mode: options.mode ?? "auto",
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
          await sdkSpawn.pretty(spawnAgent, spawnOptions)
      });
      const finished =
        planPaths.length > 1
          ? `${planPaths.length} plans, ${result.rounds.length} rounds finished`
          : `${result.rounds.length} rounds finished`;
      const lastThreadId = result.rounds.at(-1)?.threadId;
      const resumeCommand = lastThreadId
        ? buildResumeCommand(agent, lastThreadId, container.env.cwd)
        : undefined;
      outro(
        [
          finished,
          formatUsage(result.usage),
          resumeCommand ? `Resume: ${resumeCommand}` : undefined
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n")
      );
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
      const { agent, model } = await resolveAgentAndModel(program, container, options);
      let extractedPrompts = 0;
      let extractedTraces = 0;
      const logger = container.loggerFactory.create();

      intro("gaslight ingest");
      const result = await ingestGaslight({
        analysisAgent: agent,
        ...(model ? { model } : {}),
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
      if (options.keepData) {
        logger.resolved("Analysis input", result.dataPath);
      }
      outro(`Wrote ${result.outputPath}`);
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
          resources.logger[flags.dryRun ? "dryRun" : "info"](
            `${flags.dryRun ? "Would create" : "Create"}: ${config.path}`
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
