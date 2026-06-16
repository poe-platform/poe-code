import path from "node:path";
import type { Command } from "commander";
import { confirm, isCancel } from "toolcraft-design";
import {
  GhProjectSyncError,
  MalformedTaskError,
  moveTasks,
  openTaskList,
  resolveAuth,
  syncGhProject,
  verifyGhProject,
  type OpenTaskListOptions,
  type MoveProgressEvent,
  type Task,
  type TaskList,
  type TaskListFs,
  type Tasks,
  type SyncGhProjectReport,
  type VerifyGhProjectReport
} from "@poe-code/task-list";
import type { CliContainer } from "../container.js";
import type { ScopedLogger } from "../logger.js";
import {
  resolveTasksOptions,
  resolveWorkflowMoveTargetOptions,
  resolveWorkflowTaskListOptions,
  resolveWorkflowTasksOptions,
  type ResolvedWorkflowTasksOptions,
  type TasksCliOptions,
  TasksOptionsError
} from "./tasks-options.js";

interface TasksCommandOptions extends TasksCliOptions {
  description?: string;
  descriptionFile?: string;
  field?: string;
  json?: boolean;
  message?: string;
  metadataJson?: string;
  name?: string;
  title?: string;
  file?: string;
  yes?: boolean;
  from?: string;
  to?: string;
  deleteSource?: boolean;
  keep?: boolean;
  dryRun?: boolean;
  force?: boolean;
  rate?: string;
  limit?: string;
  stateMap?: string;
}

export function registerTasksCommand(program: Command, container: CliContainer): void {
  const tasks = program.command("tasks").description("Read and mutate configured workflow tasks.");

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
    .option("--title <name>", "Project title used when the project must be created.")
    .option("--json", "Print the sync report as JSON.")
    .option("--yes", "Confirm non-interactive sync.")
    .action(async (list: string, options: TasksCommandOptions, command: Command) => {
      await runSync(list, mergeCommandOptions(options, command), container);
    });

  tasks
    .command("move")
    .description("Move tasks between workflow-configured backends.")
    .option("--from <workflow.md>", "Source workflow file path.")
    .option("--to <workflow.md>", "Target workflow file path.")
    .option("--delete-source", "Delete source tasks after successful creation.")
    .option("--rate <number>", "Maximum task creates per minute.")
    .option("--limit <number>", "Maximum tasks to move.")
    .option("--dry-run", "Simulate the move without writing changes.")
    .option("--state-map <pairs>", "Map source states to target states as key:value pairs.")
    .action(async (options: TasksCommandOptions, command: Command) => {
      await runMove(mergeCommandOptions(options, command), container);
    });

  tasks
    .command("import")
    .description("Import markdown task files into a workflow-configured backend.")
    .option("--from <dir>", "Source directory of markdown task files.")
    .option("--to <workflow.md>", "Target workflow file path.")
    .option("--delete-source", "Delete source files after successful creation.")
    .option("--keep", "Keep source files after successful creation.")
    .option("--rate <number>", "Maximum task creates per minute.")
    .option("--limit <number>", "Maximum tasks to import.")
    .option("--dry-run", "Simulate the import without writing changes.")
    .action(async (options: TasksCommandOptions, command: Command) => {
      await runImport(mergeCommandOptions(options, command), container);
    });

  tasks
    .command("get")
    .description("Read a task from the configured task backend.")
    .argument("<id>", "Qualified task id.")
    .option("--workflow <path>", "Workflow file path.", "./WORKFLOW.md")
    .option("--field <name>", "Print one task field.")
    .option("--json", "Print the task as JSON.")
    .option("--yes", "Run non-interactively.")
    .action(async (id: string, options: TasksCommandOptions, command: Command) => {
      await runGet(id, mergeCommandOptions(options, command), container);
    });

  tasks
    .command("set")
    .description("Update a task in the configured task backend.")
    .argument("<id>", "Qualified task id.")
    .option("--workflow <path>", "Workflow file path.", "./WORKFLOW.md")
    .option("--description-file <path>", "Read the task description from a file.")
    .option("--description <string>", "Set the task description.")
    .option("--name <string>", "Set the task name.")
    .option("--metadata-json <json>", "Merge task metadata from a JSON object.")
    .option("--yes", "Run non-interactively.")
    .action(async (id: string, options: TasksCommandOptions, command: Command) => {
      await runSet(id, mergeCommandOptions(options, command), container);
    });

  tasks
    .command("set-state")
    .description("Set a task state.")
    .argument("<id>", "Qualified task id.")
    .argument("<state>", "Target state.")
    .option("--workflow <path>", "Workflow file path.", "./WORKFLOW.md")
    .option("--force", "Override human gates.")
    .option("--yes", "Run non-interactively.")
    .action(async (id: string, state: string, options: TasksCommandOptions, command: Command) => {
      await runSetState(id, state, mergeCommandOptions(options, command), container);
    });

  tasks
    .command("next")
    .description("Advance a task to the next declared workflow state.")
    .argument("<id>", "Qualified task id.")
    .option("--workflow <path>", "Workflow file path.", "./WORKFLOW.md")
    .option("--force", "Override human gates.")
    .option("--yes", "Run non-interactively.")
    .action(async (id: string, options: TasksCommandOptions, command: Command) => {
      await runNext(id, mergeCommandOptions(options, command), container);
    });

  tasks
    .command("comment")
    .description("Add a task comment when the backend supports it.")
    .argument("<id>", "Qualified task id.")
    .option("--workflow <path>", "Workflow file path.", "./WORKFLOW.md")
    .option("--file <path>", "Read the comment body from a file.")
    .option("--message <string>", "Comment body.")
    .option("--yes", "Run non-interactively.")
    .action(async (id: string, options: TasksCommandOptions, command: Command) => {
      await runComment(id, mergeCommandOptions(options, command), container);
    });
}

function mergeCommandOptions(options: TasksCommandOptions, command: Command): TasksCommandOptions {
  const globals = command.optsWithGlobals<{ yes?: boolean; dryRun?: boolean }>();
  return {
    ...options,
    yes: options.yes ?? globals.yes,
    dryRun: options.dryRun ?? globals.dryRun
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
    const auth = resolved.auth ?? { token: await resolveAuth({}) };
    const report = await verifyGhProject({ ...resolved, auth });

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

  if (!options.yes && options.json !== true && process.stdin.isTTY !== true) {
    const message = "tasks sync requires --yes when running without an interactive TTY.";
    writeError(message, logger, options.json);
    process.exitCode = 1;
    return;
  }

  try {
    const resolved = await resolveTasksOptions(list, options);
    const auth = resolved.auth ?? { token: await resolveAuth({}) };
    const syncOptions = {
      ...resolved,
      auth,
      ...(options.title !== undefined && options.title.trim() !== ""
        ? { title: options.title.trim() }
        : {}),
      yes: options.yes === true
    };
    let report = await syncGhProject(syncOptions);

    if (!report.ok && options.yes !== true && options.json !== true) {
      const shouldProvision = await confirm({
        message: `Create missing GitHub Project resources (${formatMissingSyncResources(report)})?`
      });

      if (!isCancel(shouldProvision) && shouldProvision === true) {
        report = await syncGhProject({ ...syncOptions, yes: true });
      }
    }

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

async function runMove(options: TasksCommandOptions, container: CliContainer): Promise<void> {
  const logger = container.loggerFactory.create({ scope: "tasks:move" });

  try {
    if (options.from === undefined || options.from.trim() === "") {
      throw new TasksCommandUsageError("tasks move requires --from <workflow.md>.");
    }
    if (options.to === undefined || options.to.trim() === "") {
      throw new TasksCommandUsageError("tasks move requires --to <workflow.md>.");
    }

    const rate =
      options.rate === undefined ? undefined : parsePositiveNumber(options.rate, "--rate");
    const limit =
      options.limit === undefined ? undefined : parseNonNegativeInteger(options.limit, "--limit");
    const stateMap = options.stateMap === undefined ? undefined : parseStateMap(options.stateMap);

    await moveTasks({
      source: await resolveWorkflowTaskListOptions(options.from),
      target: await resolveWorkflowMoveTargetOptions(options.to),
      ...(options.deleteSource === true ? { deleteSource: true } : {}),
      ...(rate !== undefined ? { rate } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(options.dryRun === true ? { dryRun: true } : {}),
      ...(stateMap !== undefined ? { stateMap } : {}),
      onProgress: (event) => logMoveProgress(event, logger)
    });
  } catch (error) {
    handleCommandError(error, logger, options.json);
  }
}

async function runImport(options: TasksCommandOptions, container: CliContainer): Promise<void> {
  const logger = container.loggerFactory.create({ scope: "tasks:import" });

  try {
    if (options.from === undefined || options.from.trim() === "") {
      throw new TasksCommandUsageError("tasks import requires --from <source-dir>.");
    }
    if (options.to === undefined || options.to.trim() === "") {
      throw new TasksCommandUsageError("tasks import requires --to <workflow.md>.");
    }
    if (options.keep === true && options.deleteSource === true) {
      throw new TasksCommandUsageError("Provide only one of --keep or --delete-source.");
    }

    const rate =
      options.rate === undefined ? undefined : parsePositiveNumber(options.rate, "--rate");
    const limit =
      options.limit === undefined ? undefined : parseNonNegativeInteger(options.limit, "--limit");

    const source: OpenTaskListOptions = {
      type: "markdown-dir",
      path: path.resolve(options.from),
      singleList: "import",
      frontmatterMode: "passthrough"
    };

    await moveTasks({
      source,
      target: await resolveWorkflowMoveTargetOptions(options.to),
      ...(options.deleteSource === true ? { deleteSource: true } : {}),
      ...(rate !== undefined ? { rate } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(options.dryRun === true ? { dryRun: true } : {}),
      onProgress: (event) => logMoveProgress(event, logger)
    });
  } catch (error) {
    handleCommandError(error, logger, options.json);
  }
}

function logMoveProgress(event: MoveProgressEvent, logger: ScopedLogger): void {
  if (event.type === "skipped") {
    logger.dryRun(`[dry-run] Would create "${event.source.name}" as ${event.targetState}.`);
    return;
  }

  if (event.type === "created") {
    logger.success(`[created] Created "${event.source.name}" as ${event.targetState}.`);
    return;
  }

  logger.error(`[error] Failed to create "${event.source.name}": ${event.error}`);
}

async function runGet(
  id: string,
  options: TasksCommandOptions,
  container: CliContainer
): Promise<void> {
  const logger = container.loggerFactory.create({ scope: "tasks:get" });

  try {
    const { taskList } = await openConfiguredTaskList(options, container);
    const task = await taskList.get(id);

    if (options.field !== undefined) {
      writeField(task, options.field);
    } else if (options.json) {
      writeJson(task);
    } else {
      logTask(logger, task);
    }
  } catch (error) {
    handleCommandError(error, logger, options.json);
  }
}

async function runSet(
  id: string,
  options: TasksCommandOptions,
  container: CliContainer
): Promise<void> {
  const logger = container.loggerFactory.create({ scope: "tasks:set" });

  try {
    assertExclusive(
      options.descriptionFile,
      options.description,
      "Provide exactly one of --description-file or --description when updating description."
    );
    if (
      options.name === undefined &&
      options.description === undefined &&
      options.descriptionFile === undefined &&
      options.metadataJson === undefined
    ) {
      throw new TasksCommandUsageError(
        "Provide at least one of --name, --description, --description-file, or --metadata-json."
      );
    }

    const { taskList } = await openConfiguredTaskList(options, container);
    const { task, tasks } = await resolveTaskView(taskList, id);
    const description =
      options.descriptionFile !== undefined
        ? await container.fs.readFile(options.descriptionFile, "utf8")
        : options.description;
    const metadata =
      options.metadataJson === undefined ? undefined : parseMetadataJson(options.metadataJson);

    if (options.dryRun === true) {
      logger.dryRun(`[dry-run] Would update task ${task.qualifiedId}.`);
      return;
    }

    const updated = await tasks.update(task.id, {
      ...(options.name !== undefined ? { name: options.name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(metadata !== undefined ? { metadata } : {})
    });

    logger.info(`[info] Updated task ${updated.qualifiedId}.`);
  } catch (error) {
    handleCommandError(error, logger, options.json);
  }
}

async function runSetState(
  id: string,
  state: string,
  options: TasksCommandOptions,
  container: CliContainer
): Promise<void> {
  const logger = container.loggerFactory.create({ scope: "tasks:set-state" });

  try {
    const opened = await openConfiguredTaskList(options, container);
    const { task } = await resolveTaskView(opened.taskList, id);
    if (!opened.resolved.stateOrder.includes(state)) {
      throw new TasksCommandUsageError(
        `target state "${state}" is not declared in WORKFLOW.md; declared states: ${opened.resolved.stateOrder.join(", ")}`
      );
    }
    assertGateAllowed(opened.resolved, task.state, state, options.force);
    if (options.dryRun === true) {
      logger.dryRun(`[dry-run] Would set task ${task.qualifiedId} state to ${state}.`);
      return;
    }
    await setTaskState(id, state, opened.taskList, opened.resolved.stateOrder);
  } catch (error) {
    handleCommandError(error, logger, options.json);
  }
}

function assertGateAllowed(
  resolved: Pick<ResolvedWorkflowTasksOptions, "stateOrder" | "gateStates">,
  fromState: string,
  toState: string,
  force: boolean | undefined
): void {
  if (force === true) {
    return;
  }

  const gate = findCrossedGate(resolved, fromState, toState);
  if (gate === undefined) {
    return;
  }

  const reason =
    gate === fromState
      ? `cannot advance out of "${fromState}": it is a human gate`
      : `cannot move to "${toState}": it would cross the human gate "${gate}"`;
  throw new TasksCommandUsageError(`${reason}. Advance it from the board or pass --force.`);
}

function findCrossedGate(
  resolved: Pick<ResolvedWorkflowTasksOptions, "stateOrder" | "gateStates">,
  fromState: string,
  toState: string
): string | undefined {
  if (resolved.gateStates.includes(fromState)) {
    return fromState;
  }

  const fromIndex = resolved.stateOrder.indexOf(fromState);
  const toIndex = resolved.stateOrder.indexOf(toState);
  if (fromIndex < 0 || toIndex < 0) {
    return undefined;
  }

  const lowerBound = Math.min(fromIndex, toIndex);
  const upperBound = Math.max(fromIndex, toIndex);
  for (let index = lowerBound + 1; index < upperBound; index += 1) {
    if (resolved.gateStates.includes(resolved.stateOrder[index])) {
      return resolved.stateOrder[index];
    }
  }

  return undefined;
}

async function runNext(
  id: string,
  options: TasksCommandOptions,
  container: CliContainer
): Promise<void> {
  const logger = container.loggerFactory.create({ scope: "tasks:next" });

  try {
    const opened = await openConfiguredTaskList(options, container);
    let task: Task;
    try {
      task = (await resolveTaskView(opened.taskList, id)).task;
    } catch (error) {
      if (error instanceof MalformedTaskError) {
        throw new TasksCommandUsageError(
          `current state is not declared in WORKFLOW.md; declared states: ${opened.resolved.stateOrder.join(", ")}`
        );
      }

      throw error;
    }
    const currentIndex = opened.resolved.stateOrder.indexOf(task.state);

    if (currentIndex < 0) {
      throw new TasksCommandUsageError(
        `current state "${task.state}" is not declared in WORKFLOW.md; declared states: ${opened.resolved.stateOrder.join(", ")}`
      );
    }

    const nextState = opened.resolved.stateOrder[currentIndex + 1];
    if (nextState === undefined) {
      throw new TasksCommandUsageError(
        `no state after \`${task.state}\`; use \`set-state\` to override`
      );
    }

    assertGateAllowed(opened.resolved, task.state, nextState, options.force);

    if (options.dryRun === true) {
      logger.dryRun(`[dry-run] Would set task ${task.qualifiedId} state to ${nextState}.`);
      return;
    }

    await setTaskState(id, nextState, opened.taskList, opened.resolved.stateOrder);
  } catch (error) {
    handleCommandError(error, logger, options.json);
  }
}

async function runComment(
  id: string,
  options: TasksCommandOptions,
  container: CliContainer
): Promise<void> {
  const logger = container.loggerFactory.create({ scope: "tasks:comment" });

  try {
    assertExactlyOne(options.file, options.message, "Provide exactly one of --file or --message.");
    const opened = await openConfiguredTaskList(options, container);

    if (opened.resolved.taskListOptions.type !== "gh-issues") {
      throw new TasksCommandUsageError(
        `comment is unsupported on the ${opened.resolved.taskListOptions.type} task backend`
      );
    }

    const body =
      options.file !== undefined
        ? await container.fs.readFile(options.file, "utf8")
        : options.message;
    const { task, tasks } = await resolveTaskView(opened.taskList, id);
    const comment = readCommentMethod(tasks);
    if (comment === undefined) {
      throw new TasksCommandUsageError(
        `comment is unsupported on the ${opened.resolved.taskListOptions.type} task backend`
      );
    }

    if (options.dryRun === true) {
      logger.dryRun(`[dry-run] Would comment on task ${task.qualifiedId}.`);
      return;
    }

    await comment(task.id, body ?? "");
    logger.info(`[info] Commented on task ${task.qualifiedId}.`);
  } catch (error) {
    handleCommandError(error, logger, options.json);
  }
}

async function openConfiguredTaskList(
  options: TasksCommandOptions,
  container: CliContainer
): Promise<{ resolved: ResolvedWorkflowTasksOptions; taskList: TaskList }> {
  const resolved = await resolveWorkflowTasksOptions(options);
  return {
    resolved,
    taskList: await openTaskList(addRuntimeTaskOptions(resolved, container))
  };
}

function addRuntimeTaskOptions(
  resolved: ResolvedWorkflowTasksOptions,
  container: CliContainer
): OpenTaskListOptions {
  const options = resolved.taskListOptions;
  if (!hasOwnProperty(options, "path")) {
    return options;
  }

  return {
    ...options,
    fs: container.fs as unknown as TaskListFs,
    stateMachine: resolved.stateMachine
  } as unknown as OpenTaskListOptions;
}

async function resolveTaskView(
  taskList: TaskList,
  qualifiedId: string
): Promise<{ task: Task; tasks: Tasks }> {
  const task = await taskList.get(qualifiedId);
  return {
    task,
    tasks: taskList.list(task.list)
  };
}

async function setTaskState(
  id: string,
  state: string,
  taskList: TaskList,
  stateOrder: readonly string[]
): Promise<Task> {
  if (!stateOrder.includes(state)) {
    throw new TasksCommandUsageError(
      `target state "${state}" is not declared in WORKFLOW.md; declared states: ${stateOrder.join(", ")}`
    );
  }

  const { task, tasks } = await resolveTaskView(taskList, id);
  if (task.state === state) {
    return task;
  }

  return tasks.fire(task.id, state);
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

function formatMissingSyncResources(report: SyncGhProjectReport): string {
  const missing: string[] = [];
  if (report.missingProject) {
    missing.push("project");
  }
  if (report.missingStatusField) {
    missing.push("Status field");
  }
  if (report.missingOptions.length > 0) {
    missing.push(`status options: ${report.missingOptions.join(", ")}`);
  }

  return missing.length === 0 ? "missing resources" : missing.join("; ");
}

function formatProject(report: VerifyGhProjectReport): string {
  return report.project === null ? "unknown" : `${report.project.owner}/${report.project.number}`;
}

function logTask(logger: ScopedLogger, task: Task): void {
  logger.info(`id: ${task.qualifiedId}`);
  logger.info(`name: ${task.name}`);
  logger.info(`state: ${task.state}`);
  logger.info("description:");
  logger.info(task.description);
  logger.info(`metadata: ${JSON.stringify(task.metadata)}`);
}

function writeJson(value: VerifyGhProjectReport | SyncGhProjectReport | Task): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function writeField(task: Task, field: string): void {
  if (!hasOwnProperty(task, field)) {
    throw new TasksCommandUsageError(`Task field "${field}" does not exist.`);
  }

  const value = task[field as keyof Task];
  const output = typeof value === "string" ? value : JSON.stringify(value);
  process.stdout.write(`${output ?? ""}\n`);
}

function handleCommandError(error: unknown, logger: ScopedLogger, json: boolean | undefined): void {
  const message = formatCommandError(error);
  writeError(message, logger, json);
  process.exitCode = error instanceof TasksCommandUsageError ? 2 : 1;
}

function writeError(message: string, logger: ScopedLogger, json: boolean | undefined): void {
  if (json) {
    process.stderr.write(`[error] ${message}\n`);
    return;
  }

  logger.error(`[error] ${message}`);
}

function formatCommandError(error: unknown): string {
  if (
    error instanceof TasksOptionsError ||
    error instanceof TasksCommandUsageError ||
    error instanceof Error
  ) {
    return error.message;
  }

  return "Unexpected tasks command failure.";
}

function assertExclusive(left: unknown, right: unknown, message: string): void {
  if (left !== undefined && right !== undefined) {
    throw new TasksCommandUsageError(message);
  }
}

function assertExactlyOne(left: unknown, right: unknown, message: string): void {
  if ((left === undefined) === (right === undefined)) {
    throw new TasksCommandUsageError(message);
  }
}

function parseMetadataJson(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new TasksCommandUsageError("--metadata-json must be valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TasksCommandUsageError("--metadata-json must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

function parsePositiveNumber(value: string, optionName: string): number {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(parsed) || parsed <= 0) {
    throw new TasksCommandUsageError(`${optionName} must be a positive number.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, optionName: string): number {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (trimmed === "" || !Number.isInteger(parsed) || parsed < 0) {
    throw new TasksCommandUsageError(`${optionName} must be a non-negative integer.`);
  }
  return parsed;
}

function parseStateMap(value: string): Record<string, string> {
  const entries = value.split(",");
  if (entries.at(-1) === "") {
    entries.pop();
  }

  const stateMap: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const entry of entries) {
    const pair = entry.split(":");
    const sourceState = pair[0]?.trim();
    const targetState = pair[1]?.trim();
    if (pair.length !== 2 || sourceState === "" || targetState === "") {
      throw new TasksCommandUsageError(
        "--state-map must be comma-separated key:value pairs with non-empty keys and values."
      );
    }
    stateMap[sourceState] = targetState;
  }

  if (Object.keys(stateMap).length === 0) {
    throw new TasksCommandUsageError(
      "--state-map must be comma-separated key:value pairs with non-empty keys and values."
    );
  }

  return stateMap;
}

function readCommentMethod(
  tasks: Tasks
): ((id: string, body: string) => Promise<void>) | undefined {
  const candidate = (tasks as { comment?: unknown }).comment;
  return typeof candidate === "function"
    ? (candidate as (id: string, body: string) => Promise<void>)
    : undefined;
}

function hasOwnProperty(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

class TasksCommandUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TasksCommandUsageError";
  }
}
