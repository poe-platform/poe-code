import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import {
  saveDefaultModel,
  loadDefaultModels
} from "../../services/config.js";

export function registerDefaultModelCommand(
  program: Command,
  container: CliContainer
): void {
  const defaultModelCommand = program
    .command("default-model")
    .description("Configure or view the default model used when no model is specified.");

  defaultModelCommand
    .command("set")
    .description("Set the default model for a tool or globally.")
    .option(
      "--tool <tool>",
      'Tool to configure (e.g. "codex", "claude-code"). Omit for global default.'
    )
    .option("--model <model>", "Model identifier to use as default")
    .action(async function (this: Command) {
      const flags = resolveCommandFlags(program);
      const opts = this.opts<{ tool?: string; model?: string }>();
      const resources = createExecutionResources(container, flags, "default-model");
      resources.logger.intro("default-model set");

      const key = opts.tool ?? "global";
      const label = key === "global" ? "Global default model" : `Default model for ${key}`;

      const model = await container.options.ensure({
        value: opts.model,
        fallback: flags.assumeYes ? "anthropic/claude-sonnet-4.6" : undefined,
        descriptor: {
          name: "model",
          message: label,
          type: "text",
          initial: "anthropic/claude-sonnet-4.6"
        }
      });

      resources.context.complete({
        success: `Set ${label.toLowerCase()} to "${model}".`,
        dry: `Dry run: would set ${label.toLowerCase()} to "${model}".`
      });

      if (!flags.dryRun) {
        await saveDefaultModel({
          fs: container.fs,
          filePath: container.env.configPath,
          key,
          model
        });
        resources.logger.resolved(label, model);
      }

      resources.context.finalize();
    });

  defaultModelCommand
    .command("show")
    .description("Show all configured default models.")
    .action(async function (this: Command) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "default-model");
      resources.logger.intro("default-model show");

      const defaults = await loadDefaultModels({
        fs: container.fs,
        filePath: container.env.configPath
      });

      const entries = Object.entries(defaults);
      if (entries.length === 0) {
        resources.logger.info(
          "No default models configured. Use `poe-code default-model set` to configure one."
        );
      } else {
        for (const [key, model] of entries) {
          resources.logger.resolved(
            key === "global" ? "global" : key,
            model
          );
        }
      }

      resources.context.finalize();
    });
}
