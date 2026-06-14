import path from "node:path";
import { Option, type Command } from "commander";
import { parseAgentSpecifier } from "@poe-code/agent-defs";
import { spawn, type SpawnOptions, type SpawnResult } from "@poe-code/agent-spawn";
import { cancel, intro, isCancel, outro, select, withSpinner } from "toolcraft-design";
import type { CliContainer } from "../container.js";
import {
  GASLIGHT_CONFIG_EXAMPLE,
  ingestGaslight,
  runGaslight,
  type GaslightEvent,
  type GaslightIngestEvent
} from "../../sdk/gaslight.js";
import { resolvePlanDirectory } from "./plan.js";
import {
  createExecutionResources,
  requireInteractiveStdin,
  resolveCommandFlags,
  resolveDefaultAgent
} from "./shared.js";
import { resolveServiceArgument } from "./configure.js";
import { ValidationError } from "../errors.js";
import { hasOwnErrorCode } from "../../utils/error-codes.js";

const DEFAULT_AGENT = "claude-code";

interface GaslightCommandOptions {
  agent?: string;
  config?: string;
  model?: string;
  mode?: "read" | "edit" | "yolo";
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

async function selectPlan(container: CliContainer, assumeYes: boolean): Promise<string> {
  const planDirectory = await resolvePlanDirectory(container, { readOnly: true });
  const absoluteDirectory = path.resolve(container.env.cwd, planDirectory);
  let names: string[];
  try {
    names = await container.fs.readdir(absoluteDirectory);
  } catch {
    throw new Error(`Plan directory not found: ${planDirectory}`);
  }
  const plans = names
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => path.join(planDirectory, name));
  if (plans.length === 0) {
    throw new Error(`No markdown plans found in ${planDirectory}.`);
  }
  if (assumeYes) {
    return plans[0]!;
  }
  requireInteractiveStdin(
    "Gaslight plan selection requires a plan path or --yes when running without an interactive TTY."
  );
  const selected = await select({
    message: "Select a plan:",
    options: plans.map((plan) => ({ label: plan, value: plan }))
  });
  if (isCancel(selected)) {
    throw new Error("Gaslight cancelled.");
  }
  return selected as string;
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
    await container.fs.mkdir(path.dirname(configPath), { recursive: true });
    await container.fs.writeFile(configPath, `${GASLIGHT_CONFIG_EXAMPLE}\n`, {
      encoding: "utf8"
    });
  }
  return { path: configPath, changed: true };
}

export function registerGaslightCommand(program: Command, container: CliContainer): void {
  const gaslight = program
    .command("gaslight")
    .description("Run a plan through a resumable sequence of agent follow-ups.")
    .argument("[plan-path]", "Markdown plan to implement")
    .option("--agent <agent>", "Agent to run")
    .option("--config <path>", "gaslight.yaml variant to use")
    .option("--model <model>", "Model to run")
    .addOption(
      new Option("--mode <mode>", "Spawn mode").choices(["read", "edit", "yolo"]).default("edit")
    )
    .action(async function (this: Command, providedPlanPath: string | undefined) {
      const flags = resolveCommandFlags(program);
      const options = this.opts<GaslightCommandOptions>();
      const planPath = providedPlanPath ?? (await selectPlan(container, flags.assumeYes));
      const { agent, model } = await resolveAgentAndModel(program, container, options);
      let currentRound = 1;
      let totalRounds = 1;
      let currentPrompt = planPath;

      intro("gaslight");
      const result = await runGaslight({
        planPath,
        agent,
        ...(model ? { model } : {}),
        ...(options.config ? { configPath: options.config } : {}),
        mode: options.mode ?? "edit",
        cwd: container.env.cwd,
        homeDir: container.env.homeDir,
        fs: container.fs,
        onEvent(event: GaslightEvent) {
          if (event.type === "round.started") {
            currentRound = event.round;
            totalRounds = event.total;
            currentPrompt = event.round === 1 ? `plan: ${planPath}` : event.prompt;
          }
        },
        spawn: async (spawnAgent: string, spawnOptions: SpawnOptions): Promise<SpawnResult> =>
          await withSpinner({
            message: () => `Round ${currentRound}/${totalRounds} · ${currentPrompt}`,
            fn: () => spawn(spawnAgent, spawnOptions),
            stopMessage: () => `Round ${currentRound}/${totalRounds} · ${currentPrompt}`
          })
      });
      outro(`${result.rounds.length} rounds finished\n${formatUsage(result.usage)}`);
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
      let dataPath = "";

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
          if (event.type === "analysis.started") {
            dataPath = event.dataPath;
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
      outro(
        [
          `Wrote ${result.outputPath}`,
          `Extracted ${result.promptCount} human prompts from ${result.traceCount} traces`,
          options.keepData
            ? `Analysis input: ${dataPath || result.dataPath}`
            : "Analysis input: removed after analysis"
        ].join("\n")
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
