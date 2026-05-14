import type { Command } from "commander";
import {
  GhProjectSyncError,
  syncGhProject,
  verifyGhProject,
  type SyncGhProjectReport,
  type VerifyGhProjectReport
} from "@poe-code/task-list";
import type { CliContainer } from "../container.js";
import type { ScopedLogger } from "../logger.js";
import { resolveTasksOptions, type TasksCliOptions, TasksOptionsError } from "./tasks-options.js";

interface TasksCommandOptions extends TasksCliOptions {
  json?: boolean;
  yes?: boolean;
}

export function registerTasksCommand(program: Command, container: CliContainer): void {
  const tasks = program.command("tasks").description("Verify and sync task GitHub Projects.");

  tasks
    .command("verify")
    .description("Verify a task GitHub Project.")
    .argument("<list>", "Project list in <owner>/<number> format.")
    .option("--workflow <path>", "Workflow file path.", "./WORKFLOW.md")
    .option("--repo <owner/name>", "GitHub repository owner/name.")
    .option("--project <owner/number>", "GitHub project owner/number.")
    .option("--states <csv>", "Required task state names.")
    .option("--json", "Print the verification report as JSON.")
    .action(async (list: string, options: TasksCommandOptions, command: Command) => {
      await runVerify(list, mergeCommandOptions(options, command), container);
    });

  tasks
    .command("sync")
    .description("Sync a task GitHub Project.")
    .argument("<list>", "Project list in <owner>/<number> format.")
    .option("--workflow <path>", "Workflow file path.", "./WORKFLOW.md")
    .option("--repo <owner/name>", "GitHub repository owner/name.")
    .option("--project <owner/number>", "GitHub project owner/number.")
    .option("--states <csv>", "Required task state names.")
    .option("--json", "Print the sync report as JSON.")
    .option("--yes", "Confirm non-interactive sync.")
    .action(async (list: string, options: TasksCommandOptions, command: Command) => {
      await runSync(list, mergeCommandOptions(options, command), container);
    });
}

function mergeCommandOptions(options: TasksCommandOptions, command: Command): TasksCommandOptions {
  const globals = command.optsWithGlobals<{ yes?: boolean }>();
  return {
    ...options,
    yes: options.yes ?? globals.yes
  };
}

async function runVerify(
  list: string,
  options: TasksCommandOptions,
  container: CliContainer
): Promise<void> {
  const logger = container.loggerFactory.create({ scope: "tasks:verify" });

  try {
    const resolved = await resolveTasksOptions(list, options);
    const report = await verifyGhProject(resolved);

    if (options.json) {
      writeJson(report);
    } else {
      logVerifyReport(logger, report);
    }

    if (!report.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    handleCommandError(error, logger, options.json);
  }
}

async function runSync(
  list: string,
  options: TasksCommandOptions,
  container: CliContainer
): Promise<void> {
  const logger = container.loggerFactory.create({ scope: "tasks:sync" });

  if (!options.yes && process.stdin.isTTY !== true) {
    const message = "tasks sync requires --yes when running without an interactive TTY.";
    writeError(message, logger, options.json);
    process.exitCode = 1;
    return;
  }

  try {
    const resolved = await resolveTasksOptions(list, options);
    const report = await syncGhProject({ ...resolved, yes: options.yes === true });

    if (options.json) {
      writeJson(report);
    } else {
      logSyncReport(logger, report);
    }

    if (!report.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    if (error instanceof GhProjectSyncError) {
      const message = `${error.message} (op=${error.op}, target=${error.target})`;
      writeError(message, logger, options.json);
      process.exitCode = 1;
      return;
    }

    handleCommandError(error, logger, options.json);
  }
}

function logVerifyReport(logger: ScopedLogger, report: VerifyGhProjectReport): void {
  if (report.ok) {
    logger.info(`[info] GitHub Project ${formatProject(report)} is ready.`);
    return;
  }

  if (report.missingProject) {
    logger.error("[error] GitHub Project is missing.");
  }
  if (report.missingStatusField) {
    logger.error("[error] Status field is missing.");
  }
  if (report.missingOptions.length > 0) {
    logger.warn(`[warn] Missing status options: ${report.missingOptions.join(", ")}`);
  }
}

function logSyncReport(logger: ScopedLogger, report: SyncGhProjectReport): void {
  if (report.created.includes("project") && report.project !== null) {
    logger.info(`[info] Created GitHub Project #${report.project.number}.`);
    logger.warn(
      `[warn] Update WORKFLOW.md manually with project ${report.project.owner}/${report.project.number}.`
    );
  }

  if (report.created.length > 0) {
    logger.info(`[info] Created: ${report.created.join(", ")}`);
  }
  if (report.updated.length > 0) {
    logger.info(`[info] Updated: ${report.updated.join(", ")}`);
  }
  if (report.ok) {
    logger.info(`[info] GitHub Project ${formatProject(report)} is synced.`);
    return;
  }

  logger.error("[error] GitHub Project sync did not complete.");
}

function formatProject(report: VerifyGhProjectReport): string {
  return report.project === null ? "unknown" : `${report.project.owner}/${report.project.number}`;
}

function writeJson(report: VerifyGhProjectReport | SyncGhProjectReport): void {
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

function handleCommandError(error: unknown, logger: ScopedLogger, json: boolean | undefined): void {
  const message = formatCommandError(error);
  writeError(message, logger, json);
  process.exitCode = 1;
}

function writeError(message: string, logger: ScopedLogger, json: boolean | undefined): void {
  if (json) {
    process.stderr.write(`[error] ${message}\n`);
    return;
  }

  logger.error(`[error] ${message}`);
}

function formatCommandError(error: unknown): string {
  if (error instanceof TasksOptionsError || error instanceof Error) {
    return error.message;
  }

  return "Unexpected tasks command failure.";
}
