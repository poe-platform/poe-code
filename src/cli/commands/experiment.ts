import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { cancel, getTheme, isCancel, renderTable, select } from "@poe-code/design-system";
import { resolveAgentId, parseAgentSpecifier, formatAgentSpecifier, allAgents } from "@poe-code/agent-defs";
import { allSpawnConfigs } from "@poe-code/agent-spawn";
import { resolveWorkflowPath } from "@poe-code/agent-kit";
import {
  installSkill,
  resolveAgentSupport,
  supportedAgents,
  type SkillScope
} from "@poe-code/agent-skill-config";
import {
  discoverExperimentDocs,
  parseExperimentFrontmatter
} from "@poe-code/experiment-loop";
import type { ExperimentFrontmatter } from "@poe-code/experiment-loop";
import type { CliContainer } from "../container.js";
import { ValidationError } from "../errors.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import {
  runExperiment as sdkRunExperiment,
  readExperimentJournal as sdkReadExperimentJournal,
  appendExperimentJournalEntry as sdkAppendExperimentJournalEntry
} from "../../sdk/experiment.js";
import { experimentConfigScope } from "../../services/config.js";
import { readMergedDocument, resolveScope } from "@poe-code/poe-code-config";

const DEFAULT_EXPERIMENT_AGENT = "claude-code";
const DEFAULT_EXPERIMENT_SCOPE: SkillScope = "local";
type ExperimentInstallCommandOptions = {
  force?: boolean;
  agent?: string;
  local?: boolean;
  global?: boolean;
};

let experimentTemplatesCache: { skillPlan: string; runYaml: string } | null = null;

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
      if (!metric.script || metric.script.trim().length === 0) {
        errors.push(`Metric "${metric.name ?? "(unnamed)"}" is missing required field: script`);
      }
      if (metric.direction !== "minimize" && metric.direction !== "maximize" && metric.direction !== "stable") {
        errors.push(
          `Metric "${metric.name ?? "(unnamed)"}" has invalid direction: "${String(metric.direction)}". Must be "minimize", "maximize", or "stable"`
        );
      }
    }
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

  const specifier = parseAgentSpecifier(value.trim());
  const resolved = resolveAgentId(specifier.agent);
  if (!resolved) {
    const supported = allAgents.map((a) => a.id).join(", ");
    throw new ValidationError(`Unsupported ${sourceLabel}: ${specifier.agent}. Supported agents: ${supported}`);
  }

  return formatAgentSpecifier({ agent: resolved, model: specifier.model });
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

async function resolveExperimentPlanDirectory(
  container: CliContainer
): Promise<string | undefined> {
  const configDoc = await readMergedDocument(
    container.fs,
    container.env.configPath,
    container.env.projectConfigPath
  );
  const experimentConfig = resolveScope(
    experimentConfigScope.schema,
    configDoc[experimentConfigScope.scope],
    container.env.variables
  );
  const dir = experimentConfig.plan_directory?.trim();
  return dir || undefined;
}

async function resolveDocPath(options: {
  container: CliContainer;
  program: Command;
  providedDoc?: string;
  planDirectory?: string;
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
  const absolutePath = resolveWorkflowPath(docPath, container.env.cwd, container.env.homeDir);

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
  frontmatterAgent?: string | string[];
}): Promise<string | string[] | null> {
  if (options.providedAgent) {
    return resolveAgentList(options.providedAgent);
  }

  if (options.frontmatterAgent) {
    if (Array.isArray(options.frontmatterAgent)) {
      return options.frontmatterAgent.map((a) => resolveExperimentAgent(a, "frontmatter agent"));
    }
    return resolveExperimentAgent(options.frontmatterAgent, "frontmatter agent");
  }

  return promptForAgent(options.program);
}

function resolveAgentList(value: string): string | string[] {
  const parts = value.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) {
    return resolveExperimentAgent(undefined);
  }
  if (parts.length === 1) {
    return resolveExperimentAgent(parts[0]);
  }
  return parts.map((p) => resolveExperimentAgent(p));
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

  experiment
    .command("run")
    .description("Run an experiment doc through the autonomous experiment loop.")
    .argument("[doc]", "Experiment doc path")
    .option("--agent <agent>", "Override the agent from frontmatter")
    .option("--max-experiments <n>", "Limit the number of experiments to run")
    .action(async function (this: Command, docArg?: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "experiment:run");
      const options = this.opts<{
        agent?: string;
        maxExperiments?: string;
      }>();

      resources.logger.intro("experiment run");

      try {
        const planDirectory = await resolveExperimentPlanDirectory(container);
        const docPath = await resolveDocPath({
          container,
          program,
          providedDoc: docArg,
          planDirectory,
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
              ? Object.entries(entry.scores).map(([k, v]) => `${k}=${v}`).join(", ")
              : "-";
            resources.logger.info(
              `Experiment ${index} ${entry.status} in ${formatDuration(entry.durationMs)} · scores: ${scores}`
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

  const journalCommand = experiment
    .command("journal")
    .description("Display the experiment journal as a table.")
    .argument("[doc]", "Experiment doc path")
    .action(async function (docArg?: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "experiment:journal");
      resources.logger.intro("experiment journal");

      try {
        const planDirectory = await resolveExperimentPlanDirectory(container);
        const docPath = await resolveDocPath({
          container,
          program,
          providedDoc: docArg,
          planDirectory,
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
            ? Object.entries(entry.scores).map(([k, v]) => `${k}=${v}`).join(", ")
            : "-",
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
        const planDirectory = await resolveExperimentPlanDirectory(container);
        const docPath = await resolveDocPath({
          container,
          program,
          providedDoc: docArg,
          planDirectory,
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
          try {
            scores = JSON.parse(opts.scores) as Record<string, number>;
          } catch {
            throw new ValidationError(`Invalid --scores JSON: ${opts.scores}`);
          }
        }

        const entry = {
          commit: opts.commit,
          status,
          ...(scores ? { scores } : {}),
          output: opts.output,
          agentOutput: "",
          durationMs: Number.parseInt(opts.durationMs, 10) || 0,
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
      const resources = createExecutionResources(
        container,
        flags,
        "experiment:validate"
      );

      try {
        resources.logger.intro("experiment validate");

        const planDirectory = await resolveExperimentPlanDirectory(container);
        const docPath = await resolveDocPath({
          container,
          program,
          providedDoc: docArg,
          planDirectory,
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

        const runYamlPath = path.join(experimentPaths.experimentsPath, "run.yaml");
        const runYamlDisplayPath = path.join(experimentPaths.displayExperimentsPath, "run.yaml");
        if (!(await pathExists(container.fs, runYamlPath))) {
          if (flags.dryRun) {
            resources.logger.dryRun(`Would create: ${runYamlDisplayPath}`);
          } else {
            await container.fs.writeFile(runYamlPath, templates.runYaml);
            resources.logger.info(`Create: ${runYamlDisplayPath}`);
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
