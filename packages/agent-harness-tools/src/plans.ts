import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { openTaskList, type Task, type TaskList, type TaskListFs } from "@poe-code/task-list";
import { resolveWorkflowPath } from "./paths.js";

export interface PlanRef {
  id: string;
  absolutePath: string;
  displayPath: string;
  kind: string;
  name: string;
}

export interface DiscoverPlansOptions {
  cwd: string;
  homeDir: string;
  planDirectory: string;
  kinds?: readonly string[];
  fs?: TaskListFs;
}

export interface ArchivePlanOptions {
  cwd: string;
  homeDir: string;
  planDirectory: string;
  id: string;
  fs?: TaskListFs;
}

export interface OpenPlanListOptions {
  cwd: string;
  homeDir: string;
  planDirectory: string;
  fs?: TaskListFs;
}

function defaultFs(): TaskListFs {
  return fsPromises as unknown as TaskListFs;
}

function isMissingDirectory(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    ((error as { code?: unknown }).code === "ENOENT" ||
      (error as { code?: unknown }).code === "ENOTDIR")
  );
}

function isUnderDirectory(directoryPath: string, filePath: string): boolean {
  const relativePath = path.relative(directoryPath, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function displayPathFor(filePath: string, cwd: string, homeDir: string): string {
  if (isUnderDirectory(cwd, filePath)) {
    return path.relative(cwd, filePath);
  }

  if (isUnderDirectory(homeDir, filePath)) {
    const relativePath = path.relative(homeDir, filePath);
    return relativePath === "" ? "~" : `~/${relativePath}`;
  }

  return filePath;
}

function isValidTaskIdShape(id: string): boolean {
  return (
    id.length > 0 &&
    !id.startsWith(".") &&
    !id.includes("/") &&
    !id.includes("\\") &&
    !id.includes("..")
  );
}

function isNumericPrefix(prefix: string): boolean {
  if (prefix.length === 0) {
    return false;
  }

  for (const char of prefix) {
    if (char < "0" || char > "9") {
      return false;
    }
  }

  return true;
}

function idFromActivePlanFilename(fileName: string): string | undefined {
  if (!fileName.endsWith(".md")) {
    return undefined;
  }

  const stem = fileName.slice(0, -".md".length);
  const separatorIndex = stem.indexOf("-");

  if (separatorIndex > 0) {
    const prefix = stem.slice(0, separatorIndex);
    const id = stem.slice(separatorIndex + 1);

    if (isNumericPrefix(prefix) && isValidTaskIdShape(id)) {
      return id;
    }
  }

  return isValidTaskIdShape(stem) ? stem : undefined;
}

async function activePlanFilePaths(
  fs: TaskListFs,
  planDirectory: string
): Promise<Map<string, string> | undefined> {
  let entries: string[];

  try {
    entries = await fs.readdir(planDirectory);
  } catch (error) {
    if (isMissingDirectory(error)) {
      return undefined;
    }

    throw error;
  }

  const filesById = new Map<string, string>();

  for (const entry of entries) {
    const id = idFromActivePlanFilename(entry);

    if (id === undefined) {
      continue;
    }

    filesById.set(id, path.join(planDirectory, entry));
  }

  return filesById;
}

function openPlansTaskList(planDirectory: string, fs: TaskListFs | undefined): Promise<TaskList> {
  return openTaskList({
    type: "markdown-dir",
    path: planDirectory,
    singleList: "plans",
    frontmatterMode: "passthrough",
    fs
  });
}

function planRefFromTask(options: {
  task: Task;
  absolutePath: string;
  cwd: string;
  homeDir: string;
}): PlanRef {
  const kind = String(options.task.metadata.kind ?? "plan");

  return {
    id: options.task.id,
    name: options.task.name,
    kind,
    absolutePath: options.absolutePath,
    displayPath: displayPathFor(options.absolutePath, options.cwd, options.homeDir)
  };
}

export async function discoverPlans(options: DiscoverPlansOptions): Promise<PlanRef[]> {
  const planDirectory = resolveWorkflowPath(options.planDirectory, options.cwd, options.homeDir);
  const fs = options.fs ?? defaultFs();
  const filesById = await activePlanFilePaths(fs, planDirectory);

  if (filesById === undefined) {
    return [];
  }

  const taskList = await openPlansTaskList(planDirectory, options.fs);
  const tasks = await taskList.list("plans").all();
  const kindFilter = options.kinds === undefined ? undefined : new Set(options.kinds);
  const plans: PlanRef[] = [];

  for (const task of tasks) {
    const kind = String(task.metadata.kind ?? "plan");

    if (kindFilter !== undefined && !kindFilter.has(kind)) {
      continue;
    }

    const absolutePath = filesById.get(task.id);

    if (absolutePath === undefined) {
      continue;
    }

    plans.push(
      planRefFromTask({
        task,
        absolutePath,
        cwd: options.cwd,
        homeDir: options.homeDir
      })
    );
  }

  return plans;
}

export async function archivePlan(options: ArchivePlanOptions): Promise<void> {
  const planDirectory = resolveWorkflowPath(options.planDirectory, options.cwd, options.homeDir);
  const taskList = await openPlansTaskList(planDirectory, options.fs);

  await taskList.list("plans").fire(options.id, "archive");
}

export function openPlanList(options: OpenPlanListOptions): Promise<TaskList> {
  return openPlansTaskList(
    resolveWorkflowPath(options.planDirectory, options.cwd, options.homeDir),
    options.fs
  );
}
