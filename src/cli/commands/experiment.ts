import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { cancel, getTheme, isCancel, renderTable, select } from "@poe-code/design-system";
import { resolveAgentId } from "@poe-code/agent-defs";
import { allSpawnConfigs } from "@poe-code/agent-spawn";
import {
  installSkill,
  resolveAgentSupport,
  supportedAgents,
  type SkillScope
} from "@poe-code/agent-skill-config";
import { parseExperimentFrontmatter } from "@poe-code/experiment-loop";
import type { ExperimentFrontmatter } from "@poe-code/experiment-loop";
import type { CliContainer } from "../container.js";
import { ValidationError } from "../errors.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import {
  runExperiment as sdkRunExperiment,
  readExperimentJournal as sdkReadExperimentJournal
} from "../../sdk/experiment.js";

const DEFAULT_EXPERIMENT_AGENT = "claude-code";
const DEFAULT_EXPERIMENT_SCOPE: SkillScope = "local";
const EXPERIMENTS_DIRECTORY = path.join(".poe-code", "experiments");

type ExperimentInstallCommandOptions = {
  force?: boolean;
  agent?: string;
  local?: boolean;
  global?: boolean;
};

let experimentTemplatesCache: { skillPlan: string } | null = null;

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
  const displayRoot =
    scope === "global" ? "~/.poe-code/experiments" : ".poe-code/experiments";

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
      throw new Error("Unable to locate package root for Experiment templates.");
    }
    currentPath = parentPath;
  }
}

async function loadExperimentTemplates(): Promise<{ skillPlan: string }> {
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

    const skillPlan = await readFile(
      path.join(templateRoot, "SKILL_experiment.md"),
      "utf8"
    );

    experimentTemplatesCache = { skillPlan };
    return experimentTemplatesCache;
  }

  throw new Error("Experiment templates not found.");
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

function validateExperimentDoc(frontmatter: ExperimentFrontmatter): string[] {
  const errors: string[] = [];

  if (!frontmatter.agent) {
    errors.push("Missing required field: agent");
  }

  if (!frontmatter.metric) {
    errors.push("Missing required field: metric");
  } else {
    const metrics = Array.isArray(frontmatter.metric)
      ? frontmatter.metric
      : [frontmatter.metric];

    for (const metric of metrics) {
      if (!metric.name || metric.name.trim().length === 0) {
        errors.push("Metric is missing required field: name");
      }
      if (metric.direction !== "minimize" && metric.direction !== "maximize" && metric.direction !== "stable") {
        errors.push(
          `Metric "${metric.name ?? "(unnamed)"}" has invalid direction: "${String(metric.direction)}". Must be "minimize", "maximize", or "stable"`
        );
      }
    }
  }

  if (frontmatter.status.kept > frontmatter.status.experiment) {
    errors.push(
      `Status inconsistency: kept (${frontmatter.status.kept}) exceeds experiment count (${frontmatter.status.experiment})`
    );
  }

  return errors;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function resolveExperimentAgent(value: string | undefined, sourceLabel = "agent"): string {
  if (!value || value.trim().length === 0) {
    return DEFAULT_EXPERIMENT_AGENT;
  }

  const resolved = resolveAgentId(value.trim());
  if (!resolved) {
    throw new ValidationError(`Unsupported ${sourceLabel}: ${value}`);
  }

  return resolved;
}

function parseNonNegativeInt(value: string | undefined, fieldName: string): number | undefined {
  if (value == null) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || [...trimmed].some((character) => character < "0" || character > "9")) {
    throw new ValidationError(`Invalid ${fieldName} "${value}". Expected a non-negative integer.`);
  }

  return Number.parseInt(trimmed, 10);
}

function resolveAbsoluteDocPath(container: CliContainer, docPath: string): string {
  if (docPath.startsWith("~/")) {
    return path.join(container.env.homeDir, docPath.slice(2));
  }

  return path.isAbsolute(docPath) ? docPath : path.resolve(container.env.cwd, docPath);
}

async function discoverExperimentDocs(
  container: CliContainer
): Promise<Array<{ path: string; displayPath: string }>> {
  const directoryPath = path.join(container.env.cwd, EXPERIMENTS_DIRECTORY);

  let names: string[];
  try {
    names = await container.fs.readdir(directoryPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const docs: Array<{ path: string; displayPath: string }> = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) {
      continue;
    }

    const relativePath = path.join(EXPERIMENTS_DIRECTORY, name);
    const absolutePath = path.join(directoryPath, name);
    const stat = await container.fs.stat(absolutePath);
    if (!stat.isFile()) {
      continue;
    }

    docs.push({
      path: relativePath,
      displayPath: relativePath
    });
  }

  return docs;
}

async function resolveDocPath(options: {
  container: CliContainer;
  program: Command;
  providedDoc?: string;
  selectMessage: string;
  cancelMessage: string;
}): Promise<string | null> {
  if (options.providedDoc && options.providedDoc.trim().length > 0) {
    return options.providedDoc.trim();
  }

  const docs = await discoverExperimentDocs(options.container);
  if (docs.length === 0) {
    throw new ValidationError(
      "No markdown doc found under .poe-code/experiments/. Provide a doc path."
    );
  }

  const flags = resolveCommandFlags(options.program);
  if (flags.assumeYes) {
    return docs[0]!.path;
  }

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
  const absolutePath = resolveAbsoluteDocPath(container, docPath);

  try {
    const content = await container.fs.readFile(absolutePath, "utf8");
    return {
      absolutePath,
      frontmatter: parseExperimentFrontmatter(content).frontmatter
    };
  } catch {
    throw new ValidationError(`Experiment doc not found: ${docPath}`);
  }
}

async function promptForAgent(program: Command): Promise<string | null> {
  const flags = resolveCommandFlags(program);
  if (flags.assumeYes) {
    return DEFAULT_EXPERIMENT_AGENT;
  }

  const selected = await select({
    message: "Select agent to run the experiment with:",
    options: allSpawnConfigs.map((config) => ({
      label: config.agentId,
      value: config.agentId
    }))
  });
  if (isCancel(selected)) {
    cancel("Experiment run cancelled.");
    return null;
  }

  return resolveExperimentAgent(typeof selected === "string" ? selected : undefined);
}

async function resolveRunAgent(options: {
  program: Command;
  providedAgent?: string;
  frontmatterAgent?: string;
}): Promise<string | null> {
  if (options.providedAgent) {
    return resolveExperimentAgent(options.providedAgent);
  }

  if (options.frontmatterAgent) {
    return resolveExperimentAgent(options.frontmatterAgent, "frontmatter agent");
  }

  return promptForAgent(options.program);
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
    .description("Run autonomous experiment loop workflows.");

  experiment
    .command("run")
    .description("Run an experiment doc through the autonomous experiment loop.")
    .argument("[doc]", "Experiment doc path")
    .option("--agent <agent>", "Override the agent from frontmatter")
    .option("--model <model>", "Override the model from frontmatter")
    .option("--max-experiments <n>", "Limit the number of experiments to run")
    .action(async function (this: Command, docArg?: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "experiment:run");
      const options = this.opts<{
        agent?: string;
        model?: string;
        maxExperiments?: string;
      }>();

      resources.logger.intro("experiment run");

      try {
        const docPath = await resolveDocPath({
          container,
          program,
          providedDoc: docArg,
          selectMessage: "Select the experiment doc to run:",
          cancelMessage: "Experiment run cancelled."
        });
        if (!docPath) {
          return;
        }

        const doc = await readExperimentDoc(container, docPath);
        const agent = await resolveRunAgent({
          program,
          providedAgent: options.agent,
          frontmatterAgent: doc.frontmatter.agent
        });
        if (!agent) {
          return;
        }

        const maxExperiments = parseNonNegativeInt(options.maxExperiments, "max-experiments");
        const result = await sdkRunExperiment({
          agent,
          cwd: container.env.cwd,
          homeDir: container.env.homeDir,
          docPath,
          ...(options.model ? { model: options.model } : {}),
          ...(maxExperiments !== undefined ? { maxExperiments } : {}),
          onExperimentStart(index, currentAgent) {
            resources.logger.info(`Experiment ${index} (${currentAgent})`);
          },
          onExperimentComplete(index, entry) {
            const score = entry.score === null ? "-" : String(entry.score);
            resources.logger.info(
              `Experiment ${index} ${entry.status} in ${formatDuration(entry.durationMs)} · score ${score}`
            );
          }
        });

        const summary = [
          `Experiments: ${result.experimentsCompleted}`,
          `Kept: ${result.experimentsKept}`,
          `Doc: ${result.docPath}`,
          `Duration: ${formatDuration(result.totalDurationMs)}`
        ].join("\n   ");

        if (result.stopReason === "cancelled") {
          process.exitCode = 130;
          resources.logger.warn("Experiment run cancelled.");
          resources.logger.resolved("Run summary", summary);
          return;
        }

        resources.logger.resolved("Run summary", summary);
        resources.logger.success("Experiment run finished.");
      } finally {
        resources.context.finalize();
      }
    });

  experiment
    .command("journal")
    .description("Display the experiment journal as a table.")
    .argument("[doc]", "Experiment doc path")
    .action(async function (docArg?: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "experiment:journal");
      resources.logger.intro("experiment journal");

      try {
        const docPath = await resolveDocPath({
          container,
          program,
          providedDoc: docArg,
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
          { name: "score", title: "score", alignment: "right", maxLen: 10 },
          { name: "duration", title: "duration", alignment: "right", maxLen: 10 },
          { name: "timestamp", title: "timestamp", alignment: "left", maxLen: 24 },
          { name: "commit", title: "commit", alignment: "left", maxLen: 10 },
          { name: "output", title: "output", alignment: "left", maxLen: 60 }
        ] as const;
        const rows = entries.map((entry, index) => ({
          index: String(index + 1),
          status: entry.status,
          score: entry.score === null ? "-" : String(entry.score),
          duration: formatDuration(entry.durationMs),
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

  experiment
    .command("validate")
    .description("Validate an experiment doc without running it.")
    .argument("[doc]", "Experiment doc path")
    .action(async function (this: Command, docArg?: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(
        container,
        flags,
        "experiment:validate"
      );

      try {
        resources.logger.intro("experiment validate");

        const docPath = await resolveDocPath({
          container,
          program,
          providedDoc: docArg,
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
        resources.logger.resolved("Agent", doc.frontmatter.agent!);
        resources.logger.resolved(
          "Metrics",
          metrics.map((m) => `${m.name} (${m.direction})`).join(", ")
        );
        resources.logger.success("Experiment doc is valid.");
      } finally {
        resources.context.finalize();
      }
    });

  experiment
    .command("install")
    .description("Install the Experiment /experiment skill and scaffold experiment files.")
    .option("--agent <name>", "Agent to install the Experiment skill for")
    .option("--local", "Install project-local skill and experiment files")
    .option("--global", "Install user-global skill and experiment files")
    .option("--force", "Overwrite existing files")
    .action(async function (this: Command) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(
        container,
        flags,
        "experiment:install"
      );
      const options = this.opts<ExperimentInstallCommandOptions>();

      if (options.local && options.global) {
        throw new ValidationError("Use either --local or --global, not both.");
      }

      try {
        let agent = options.agent;
        if (!agent) {
          if (flags.assumeYes) {
            agent = DEFAULT_EXPERIMENT_AGENT;
          } else {
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
        const skillResult = await installSkill(
          support.id,
          {
            name: "poe-code-experiment-plan",
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

        const experimentPaths = resolveExperimentPaths(
          scope,
          container.env.cwd,
          container.env.homeDir
        );

        if (!(await pathExists(container.fs, experimentPaths.experimentsPath))) {
          if (flags.dryRun) {
            resources.logger.dryRun(
              `Would create: ${experimentPaths.displayExperimentsPath}`
            );
          } else {
            await container.fs.mkdir(experimentPaths.experimentsPath, {
              recursive: true
            });
            resources.logger.info(
              `Create: ${experimentPaths.displayExperimentsPath}`
            );
          }
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
