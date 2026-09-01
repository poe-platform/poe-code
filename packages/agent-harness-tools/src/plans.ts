import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { openTaskList, type TaskList, type TaskListFs } from "@poe-code/task-list";
import { hasOwnErrorCode } from "./error-codes.js";
import { resolveWorkflowPath } from "./paths.js";
import { comparePlanReadiness } from "./plan-readiness.js";

const PLAN_LIST_NAME = "plans";
const MARKDOWN_EXTENSION = ".md";

export interface PlanRef {
  id: string;
  absolutePath: string;
  displayPath: string;
  kind: string;
  name: string;
  readiness: PlanReadiness;
}

export type PlanReadiness = "draft" | "ready";

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
  metadataPatch?: Record<string, unknown>;
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

async function directoryExists(fs: TaskListFs, directoryPath: string): Promise<boolean> {
  try {
    return (await fs.stat(directoryPath)).isDirectory();
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR")) {
      return false;
    }

    throw error;
  }
}

function stripMarkdownExtension(fileName: string): string | undefined {
  if (!fileName.endsWith(MARKDOWN_EXTENSION)) {
    return undefined;
  }

  return fileName.slice(0, -MARKDOWN_EXTENSION.length);
}

function idFromPlanFileName(fileName: string): string | undefined {
  const stem = stripMarkdownExtension(fileName);
  if (stem === undefined) {
    return undefined;
  }

  let index = 0;
  while (index < stem.length && stem.charCodeAt(index) >= 48 && stem.charCodeAt(index) <= 57) {
    index += 1;
  }

  if (index > 0 && stem[index] === "-" && index < stem.length - 1) {
    return stem.slice(index + 1);
  }

  return stem;
}

type PlanFile = { absolutePath: string; updatedAt: number };

async function readPlanPaths(fs: TaskListFs, directoryPath: string): Promise<Map<string, PlanFile>> {
  const fileNames = await fs.readdir(directoryPath);
  const filesById = new Map<string, PlanFile>();

  for (const fileName of fileNames) {
    const id = idFromPlanFileName(fileName);
    if (id === undefined) {
      continue;
    }

    const absolutePath = path.join(directoryPath, fileName);
    const stat = await fs.stat(absolutePath);
    if (stat.isFile()) {
      const existing = filesById.get(id);
      if (existing !== undefined) {
        throw new Error(`Duplicate active plan identifier "${id}": ${existing.absolutePath} and ${absolutePath}`);
      }
      filesById.set(id, { absolutePath, updatedAt: stat.mtimeMs });
    }
  }

  return filesById;
}

function isPathWithin(basePath: string, targetPath: string): boolean {
  const relativePath = path.relative(basePath, targetPath);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function displayPlanPath(absolutePath: string, cwd: string, homeDir: string): string {
  if (isPathWithin(cwd, absolutePath)) {
    return path.relative(cwd, absolutePath);
  }

  if (isPathWithin(homeDir, absolutePath)) {
    const relativeToHome = path.relative(homeDir, absolutePath);
    return relativeToHome.length === 0 ? "~" : `~/${relativeToHome}`;
  }

  return absolutePath;
}

function resolvePlanDirectory(options: {
  cwd: string;
  homeDir: string;
  planDirectory: string;
}): string {
  return resolveWorkflowPath(options.planDirectory, options.cwd, options.homeDir);
}

function planKind(metadata: Record<string, unknown>): string {
  return String(metadata.kind ?? "plan");
}

export function parsePlanReadiness(value: unknown): PlanReadiness {
  if (value === undefined || value === "draft") return "draft";
  if (value === "ready") return value;
  throw new Error(`Invalid plan readiness ${JSON.stringify(value)}; expected "draft" or "ready".`);
}

export async function discoverPlans(options: DiscoverPlansOptions): Promise<PlanRef[]> {
  const resolvedDirectory = resolvePlanDirectory(options);
  const fs = options.fs ?? defaultFs();
  if (!(await directoryExists(fs, resolvedDirectory))) {
    return [];
  }

  const [taskList, filesById] = await Promise.all([
    openPlanList(options),
    readPlanPaths(fs, resolvedDirectory)
  ]);
  const kindFilter = options.kinds === undefined ? undefined : new Set(options.kinds);
  const tasks = await taskList.list(PLAN_LIST_NAME).all();

  return tasks
    .map((task) => ({
      id: task.id,
      name: task.name,
      kind: planKind(task.metadata),
      readiness: parsePlanReadiness(task.metadata.readiness),
      absolutePath: filesById.get(task.id)?.absolutePath ?? path.join(resolvedDirectory, `${task.id}.md`),
      updatedAt: filesById.get(task.id)?.updatedAt ?? 0
    }))
    .filter((plan) => kindFilter === undefined || kindFilter.has(plan.kind))
    .map((plan) => ({
      ...plan,
      displayPath: displayPlanPath(plan.absolutePath, options.cwd, options.homeDir)
    }))
    .sort(
      (left, right) =>
        comparePlanReadiness(left, right) ||
        right.updatedAt - left.updatedAt ||
        left.displayPath.localeCompare(right.displayPath)
    )
    .map(({ updatedAt: _updatedAt, ...plan }) => plan);
}

export const archivePlan = async (options: ArchivePlanOptions): Promise<void> => {
  const taskList = await openPlanList(options);
  const plans = taskList.list(PLAN_LIST_NAME);

  await plans.fire(options.id, "archive", {
    ...(options.metadataPatch ? { metadataPatch: options.metadataPatch } : {})
  });
};

export function openPlanList(options: OpenPlanListOptions): Promise<TaskList> {
  return openTaskList({
    type: "markdown-dir",
    path: resolvePlanDirectory(options),
    singleList: PLAN_LIST_NAME,
    frontmatterMode: "passthrough",
    fs: options.fs
  });
}
