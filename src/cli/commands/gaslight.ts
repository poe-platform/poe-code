import path from "node:path";
import { Option, type Command } from "commander";
import { parseAgentSpecifier } from "@poe-code/agent-defs";
import { spawn, type SpawnOptions, type SpawnResult } from "@poe-code/agent-spawn";
import { intro, isCancel, outro, select, withSpinner } from "toolcraft-design";
import type { CliContainer } from "../container.js";
import { runGaslight, type GaslightEvent } from "../../sdk/gaslight.js";
import { resolvePlanDirectory } from "./plan.js";
import { requireInteractiveStdin, resolveCommandFlags, resolveDefaultAgent } from "./shared.js";
import { resolveServiceArgument } from "./configure.js";

const DEFAULT_AGENT = "claude-code";

interface GaslightCommandOptions {
  agent?: string;
  model?: string;
  mode?: "read" | "edit" | "yolo";
}

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

export function registerGaslightCommand(program: Command, container: CliContainer): void {
  program
    .command("gaslight")
    .description("Run a plan through a resumable sequence of agent follow-ups.")
    .argument("[plan-path]", "Markdown plan to implement")
    .option("--agent <agent>", "Agent to run")
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
}
