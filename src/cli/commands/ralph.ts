import type { Command } from "commander";
import {
  cancel,
  isCancel,
  promptText,
  select
} from "@poe-code/design-system";
import { resolveAgentId } from "@poe-code/agent-defs";
import { allSpawnConfigs } from "@poe-code/agent-spawn";
import {
  discoverDocs
} from "@poe-code/ralph";
import type { CliContainer } from "../container.js";
import { ValidationError } from "../errors.js";
import {
  createExecutionResources,
  resolveCommandFlags
} from "./shared.js";
import {
  runRalph as sdkRunRalph,
  type RalphRunOptions
} from "../../sdk/ralph.js";

const DEFAULT_RALPH_AGENT = "claude-code";

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function resolveRalphAgent(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    return DEFAULT_RALPH_AGENT;
  }

  const resolved = resolveAgentId(value.trim());
  if (!resolved) {
    throw new ValidationError(`Unsupported agent: ${value}`);
  }

  return resolved;
}

function parsePositiveInt(
  value: string | undefined,
  fieldName: string
): number | undefined {
  if (value == null) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new ValidationError(
      `Invalid ${fieldName} "${value}". Expected a positive integer.`
    );
  }

  return parsed;
}

async function resolveAgent(options: {
  program: Command;
  providedAgent?: string;
}): Promise<string | null> {
  if (options.providedAgent) {
    return resolveRalphAgent(options.providedAgent);
  }

  const flags = resolveCommandFlags(options.program);
  if (flags.assumeYes) {
    return DEFAULT_RALPH_AGENT;
  }

  const selected = await select({
    message: "Select agent to run Ralph with:",
    options: allSpawnConfigs.map((config) => ({
      label: config.agentId,
      value: config.agentId
    }))
  });
  if (isCancel(selected)) {
    cancel("Ralph run cancelled.");
    return null;
  }

  return resolveRalphAgent(typeof selected === "string" ? selected : undefined);
}

async function resolveDocPath(options: {
  container: CliContainer;
  program: Command;
  providedDoc?: string;
}): Promise<string | null> {
  if (options.providedDoc && options.providedDoc.trim().length > 0) {
    return options.providedDoc.trim();
  }

  const docs = await discoverDocs({
    cwd: options.container.env.cwd,
    homeDir: options.container.env.homeDir,
    fs: options.container.fs
  });
  if (docs.length === 0) {
    throw new ValidationError(
      "No markdown doc found under .poe-code/ralph/plans/ or ~/.poe-code/ralph/plans/. Provide a doc path."
    );
  }

  const flags = resolveCommandFlags(options.program);
  if (flags.assumeYes) {
    return docs[0]!.path;
  }

  const selected = await select({
    message: "Select the Ralph markdown doc to run:",
    options: docs.map((doc) => ({
      label: doc.displayPath,
      value: doc.path
    }))
  });
  if (isCancel(selected)) {
    cancel("Ralph run cancelled.");
    return null;
  }

  return typeof selected === "string" ? selected : null;
}

async function resolveIterations(options: {
  program: Command;
  providedIterations?: string;
}): Promise<number | null> {
  const explicitIterations = parsePositiveInt(
    options.providedIterations,
    "iterations"
  );
  if (explicitIterations != null) {
    return explicitIterations;
  }

  const flags = resolveCommandFlags(options.program);
  if (flags.assumeYes) {
    throw new ValidationError(
      "Iterations are required when using --yes. Provide poe-code ralph run <iterations> [doc]."
    );
  }

  const entered = await promptText({
    message: "How many Ralph iterations should run?"
  });
  if (isCancel(entered)) {
    cancel("Ralph run cancelled.");
    return null;
  }

  return parsePositiveInt(
    typeof entered === "string" ? entered.trim() : undefined,
    "iterations"
  ) ?? null;
}

export function registerRalphCommand(
  program: Command,
  container: CliContainer
): void {
  const ralph = program
    .command("ralph")
    .description("Run a simple iterative markdown loop.");

  ralph
    .command("run")
    .description("Run the selected markdown doc through repeated agent iterations.")
    .argument("[iterations]", "Number of Ralph iterations to run")
    .argument("[doc]", "Markdown doc path")
    .option("--agent <name>", "Agent to run each iteration with")
    .option("--model <model>", "Model override passed to the agent")
    .option(
      "--max-failures <n>",
      "Consecutive failure threshold before overbake protection prompts"
    )
    .action(async function (
      this: Command,
      iterationsArg?: string,
      docArg?: string
    ) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "ralph:run");
      const options = this.opts<{
        agent?: string;
        model?: string;
        maxFailures?: string;
      }>();

      resources.logger.intro("ralph run");

      try {
        const agent = await resolveAgent({
          program,
          providedAgent: options.agent
        });
        if (!agent) {
          return;
        }

        const docPath = await resolveDocPath({
          container,
          program,
          providedDoc: docArg
        });
        if (!docPath) {
          return;
        }

        const maxIterations = await resolveIterations({
          program,
          providedIterations: iterationsArg
        });
        if (maxIterations == null) {
          return;
        }

        const maxFailures = parsePositiveInt(
          options.maxFailures,
          "max-failures"
        );

        const result = await sdkRunRalph({
          agent,
          cwd: container.env.cwd,
          homeDir: container.env.homeDir,
          docPath,
          maxIterations,
          ...(options.model ? { model: options.model } : {}),
          ...(maxFailures != null ? { maxFailures } : {}),
          promptOverbake: async (
            input: Parameters<NonNullable<RalphRunOptions["promptOverbake"]>>[0]
          ) => {
            const selected = await select({
              message:
                `Ralph hit ${input.consecutiveFailures} consecutive failures ` +
                `(threshold ${input.threshold}). What should happen next?`,
              options: [
                { label: "Continue", value: "continue" },
                { label: "Abort", value: "abort" }
              ]
            });

            if (isCancel(selected)) {
              cancel("Ralph run cancelled.");
              return "abort";
            }

            return selected === "continue" ? "continue" : "abort";
          },
          onIterationStart(iteration, total) {
            resources.logger.info(`Iteration ${iteration}/${total}`);
          },
          onIterationComplete(iteration, durationMs, success) {
            const status = success ? "done" : "failed";
            resources.logger.info(
              `Iteration ${iteration} ${status} in ${formatDuration(durationMs)}`
            );
          },
          onOverbakeWarning(consecutiveFailures, threshold) {
            resources.logger.warn(
              `Overbake protection triggered at ${consecutiveFailures} consecutive failures (threshold ${threshold}).`
            );
          }
        });

        const summary = [
          `Iterations: ${result.iterationsCompleted}/${maxIterations}`,
          `Doc: ${result.docPath}`,
          `Duration: ${formatDuration(result.totalDurationMs)}`
        ].join("\n   ");

        if (result.stopReason === "cancelled") {
          process.exitCode = 130;
          resources.logger.warn("Ralph run cancelled.");
          resources.logger.resolved("Run summary", summary);
          return;
        }

        if (result.stopReason === "overbake_abort") {
          process.exitCode = 1;
          resources.logger.warn("Ralph stopped after repeated failures.");
          resources.logger.resolved("Run summary", summary);
          return;
        }

        resources.logger.resolved("Run summary", summary);
        resources.logger.success("Ralph run finished.");
      } finally {
        resources.context.finalize();
      }
    });
}
