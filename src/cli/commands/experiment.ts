import path from "node:path";
import type { Command } from "commander";
import { cancel, getTheme, isCancel, renderTable, select } from "@poe-code/design-system";
import { resolveAgentId } from "@poe-code/agent-defs";
import { allSpawnConfigs } from "@poe-code/agent-spawn";
import { parseExperimentFrontmatter } from "@poe-code/experiment-loop";
import type { CliContainer } from "../container.js";
import { ValidationError } from "../errors.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import {
  runExperiment as sdkRunExperiment,
  readExperimentJournal as sdkReadExperimentJournal
} from "../../sdk/experiment.js";

const DEFAULT_EXPERIMENT_AGENT = "claude-code";
const EXPERIMENTS_DIRECTORY = path.join(".poe-code", "experiments");

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
}
