import path from "node:path";
import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import { text } from "@poe-code/design-system";
import {
  resolveCommandFlags,
  createExecutionResources
} from "./shared.js";
import { parsePipeline } from "../../sdk/pipeline/parse.js";
import { validatePipeline } from "../../sdk/pipeline/validate.js";
import { runPipeline } from "../../sdk/pipeline/run.js";
import { isParallelGroup } from "../../sdk/pipeline/types.js";
import type { PipelineDefinition } from "../../sdk/pipeline/types.js";

export function registerPipelineCommand(
  program: Command,
  container: CliContainer
): void {
  const pipelineCmd = program
    .command("pipeline")
    .description("Run multi-step agent pipelines.");

  pipelineCmd
    .command("run")
    .description("Run a pipeline from a YAML file.")
    .argument("<file>", "Path to pipeline YAML file")
    .option("-C, --cwd <path>", "Override working directory for all steps")
    .action(async function (this: Command, file: string) {
      const flags = resolveCommandFlags(program);
      const commandOptions = this.opts<{ cwd?: string }>();

      const filePath = path.resolve(file);
      const yamlContent = await container.fs.readFile(filePath, "utf8");
      const pipeline = parsePipeline(yamlContent);

      const cwd = commandOptions.cwd
        ? path.resolve(commandOptions.cwd)
        : process.cwd();

      if (flags.dryRun) {
        renderDryRun(pipeline);
        return;
      }

      const resources = createExecutionResources(
        container,
        flags,
        "pipeline"
      );
      resources.logger.intro(`pipeline ${pipeline.name}`);

      const result = await runPipeline(pipeline, { cwd });

      if (result.summary.success) {
        const duration = formatDuration(result.summary.totalDuration);
        resources.logger.info(
          `Pipeline completed: ${result.summary.completedSteps} steps (${duration})`
        );
      } else {
        const duration = formatDuration(result.summary.totalDuration);
        resources.logger.info(
          `Pipeline aborted (${result.summary.completedSteps}/${result.summary.totalSteps} steps completed, ${duration})`
        );
        process.exitCode = 1;
      }

      resources.context.finalize();
    });

  pipelineCmd
    .command("validate")
    .description("Validate a pipeline YAML file without running it.")
    .argument("<file>", "Path to pipeline YAML file")
    .action(async function (this: Command, file: string) {
      const filePath = path.resolve(file);
      const yamlContent = await container.fs.readFile(filePath, "utf8");
      const pipeline = parsePipeline(yamlContent);
      validatePipeline(pipeline);

      const resources = createExecutionResources(
        container,
        resolveCommandFlags(program),
        "pipeline"
      );
      resources.logger.info(`Pipeline "${pipeline.name}" is valid.`);
      resources.context.finalize();
    });
}

function renderDryRun(pipeline: PipelineDefinition): void {
  const lines: string[] = [
    text.heading(`Pipeline: ${pipeline.name}`)
  ];
  if (pipeline.description) {
    lines.push(`  ${pipeline.description}`);
  }
  lines.push("");

  let stepIndex = 1;
  for (const entry of pipeline.steps) {
    if (isParallelGroup(entry)) {
      const names = entry.parallel
        .map((s) => {
          const agent = s.agent ?? pipeline.defaults?.agent ?? "?";
          const mode = s.mode ?? pipeline.defaults?.mode ?? "yolo";
          return `${s.name} (${agent} · ${mode})`;
        })
        .join("  +  ");
      lines.push(`  ${stepIndex}. ${text.muted("[parallel]")} ${names}`);
      stepIndex += entry.parallel.length;
    } else {
      const agent = entry.agent ?? pipeline.defaults?.agent ?? "?";
      const mode = entry.mode ?? pipeline.defaults?.mode ?? "yolo";
      lines.push(`  ${stepIndex}. ${text.command(entry.name)} ${text.muted(`(${agent} · ${mode})`)}`);
      stepIndex += 1;
    }
  }

  process.stdout.write(lines.join("\n") + "\n");
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}
