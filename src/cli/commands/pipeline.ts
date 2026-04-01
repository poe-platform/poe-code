import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import {
  cancel,
  isCancel,
  promptText,
  select
} from "@poe-code/design-system";
import { resolveAgentId, parseAgentSpecifier, formatAgentSpecifier, allAgents } from "@poe-code/agent-defs";
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
  type PlanSummary,
  type TaskProgress
} from "../../sdk/pipeline.js";
import {
  loadResolvedSteps,
  parsePlan,
  resolveAbsolutePlanPath,
  resolvePlanDirectory
} from "@poe-code/pipeline";

async function resolvePipelinePlanDirectory(container: CliContainer): Promise<string | undefined> {
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
  const dir = pipelineConfig.plan_directory?.trim();
  return dir || undefined;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
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
      readFile(path.join(templateRoot, "steps.yaml.hbs"), "utf8")
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
    .description("Run a fixed-step task pipeline plan.");

  pipeline
    .command("run")
    .description("Run the selected pipeline plan until completion, failure, cancellation, or cap.")
    .option("--agent <name>", "Agent to run each pipeline step with")
    .option("--model <model>", "Model override passed to the agent")
    .option("--task <id>", "Run only the specified task")
    .option("--plan <path>", "Path to the pipeline plan file")
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
        task?: string;
        plan?: string;
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

        const planDirectory = await resolvePipelinePlanDirectory(container);

        const result = await sdkRunPipeline({
          agent,
          cwd: container.env.cwd,
          homeDir: container.env.homeDir,
          ...(planDirectory ? { planDirectory } : {}),
          ...(options.model ? { model: options.model } : {}),
          ...(options.task ? { task: options.task } : {}),
          ...(options.plan ? { plan: options.plan } : {}),
          ...(resolveMaxRuns(options.maxRuns) != null
            ? { maxRuns: resolveMaxRuns(options.maxRuns) }
            : {}),
          assumeYes: flags.assumeYes,
          onPlanReloadError(error: Error) {
            resources.logger.warn(`Plan reload failed, using last good state: ${error.message}`);
          },
          onPlanResolved(summary: PlanSummary) {
            const configLines = [`Agent: ${agent}`];
            if (options.model) configLines.push(`Model: ${options.model}`);
            configLines.push(`Plan: ${summary.planPath}`);
            resources.logger.resolved("Config", configLines.join("\n   "));

            const parts = [`${summary.done}/${summary.total} done`];
            if (summary.failed) parts.push(`${summary.failed} failed`);
            if (summary.open) parts.push(`${summary.open} open`);
            resources.logger.resolved("Tasks", parts.join(", "));
          },
          selectPlan: async (
            input: Parameters<NonNullable<PipelineRunOptions["selectPlan"]>>[0]
          ) => {
            const selected = await select(input);
            if (isCancel(selected)) {
              cancel("Pipeline run cancelled.");
              return null;
            }
            return typeof selected === "string" ? selected : null;
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
          },
          onTaskStart(progress: TaskProgress) {
            const step = progress.stepName ? ` (${progress.stepName})` : "";
            resources.logger.info(
              `Task ${progress.index}/${progress.total}: ${progress.taskId}${step}`
            );
          },
          onTaskComplete(progress: TaskProgress & {
            durationMs: number;
            success: boolean;
            usage?: AgentRunUsage;
          }) {
            const duration = formatDuration(progress.durationMs);
            const status = progress.success ? "done" : "failed";
            const usage = progress.usage
              ? ` (tokens: ${progress.usage.inputTokens} in / ${progress.usage.outputTokens} out)`
              : "";
            resources.logger.info(
              `Task ${progress.taskId} ${status} in ${duration}${usage}`
            );
          }
        });

        const metrics = result.metrics;
        const summary = [
          `Runs: ${result.runsCompleted}`,
          `tasksCompleted: ${metrics.tasksCompleted}, tasksFailed: ${metrics.tasksFailed}, stepsCompleted: ${metrics.stepsCompleted}`,
          `Total tokens: ${metrics.totalInputTokens} input, ${metrics.totalOutputTokens} output, ${metrics.totalCachedTokens} cached`,
          `Duration: ${formatDuration(result.totalDurationMs)}`
        ].join("\n   ");

        if (result.stopReason === "failed") {
          process.exitCode = 1;
          resources.logger.error(
            `Pipeline blocked at ${result.lastTaskId}${result.lastStepName ? ` (${result.lastStepName})` : ""}.`
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
          return;
        }

        if (result.stopReason === "max_runs") {
          resources.logger.info(
            `Reached max runs (${result.runsCompleted}).`
          );
          resources.logger.resolved("Run summary", summary);
          return;
        }

        resources.logger.resolved("Run summary", summary);
        resources.logger.success("Pipeline run finished.");
      } finally {
        resources.context.finalize();
      }
    });

  pipeline
    .command("validate")
    .description("Validate a pipeline plan YAML file without running it.")
    .argument("<file>", "Path to the pipeline plan YAML file")
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

        const hasSteps = Object.keys(steps).length > 0;
        const plan = parsePlan(content, hasSteps ? { availableSteps: steps } : {});

        const total = plan.tasks.length;
        const done = plan.tasks.filter((t) => {
          if (typeof t.status === "string") return t.status === "done";
          return Object.values(t.status).every((s) => s === "done");
        }).length;

        resources.logger.resolved("Plan", file);
        resources.logger.resolved("Tasks", `${total} tasks (${done} done)`);
        if (hasSteps) {
          resources.logger.resolved("Steps", Object.keys(steps).join(", "));
        }
        resources.logger.success("Plan is valid.");
      } finally {
        resources.context.finalize();
      }
    });

  pipeline
    .command("plan-path")
    .description("Print the directory where pipeline plan files should be placed.")
    .action(async function () {
      const planDirectory = await resolvePipelinePlanDirectory(container);

      const resolvedPath = await resolvePlanDirectory({
        cwd: container.env.cwd,
        homeDir: container.env.homeDir,
        planDirectory,
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
