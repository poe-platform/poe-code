import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ListFilter, Task, TaskListFs } from "../types.js";

export interface OrderedEntry {
  task: Task;
  raw: Record<string, unknown>;
}

export function compareCreated(left: OrderedEntry, right: OrderedEntry): number {
  const leftCreated = typeof left.raw.created === "string" ? left.raw.created : "";
  const rightCreated = typeof right.raw.created === "string" ? right.raw.created : "";

  if (leftCreated === "" && rightCreated === "") {
    return left.task.qualifiedId.localeCompare(right.task.qualifiedId);
  }
  if (leftCreated === "") return 1;
  if (rightCreated === "") return -1;
  return leftCreated.localeCompare(rightCreated);
}

export function applyOrder(entries: OrderedEntry[], order: ListFilter["order"]): Task[] {
  if (order === "alphabetical") {
    return sortTasks(entries.map((entry) => entry.task));
  }
  if (order === "created") {
    return [...entries].sort(compareCreated).map((entry) => entry.task);
  }
  return entries.map((entry) => entry.task);
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    (error as { code?: unknown }).code === code
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sortStrings(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((left, right) => left.qualifiedId.localeCompare(right.qualifiedId));
}

export function isTrimmedPrintableIdentifier(value: string): boolean {
  if (value.length === 0 || value !== value.trim()) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) {
      return false;
    }
  }

  return true;
}

export function validateTaskId(id: string): string {
  if (
    !isTrimmedPrintableIdentifier(id) ||
    id.startsWith(".") ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("..")
  ) {
    throw new Error(`Invalid task id "${id}".`);
  }

  return id;
}

export function validateTaskName(name: string): string {
  if (name.trim().length === 0) {
    throw new Error("Task name must not be empty.");
  }

  return name;
}

export async function statIfExists(
  fs: TaskListFs,
  filePath: string
): Promise<Awaited<ReturnType<TaskListFs["stat"]>> | undefined> {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

export async function rejectSymbolicLinkComponents(
  fs: TaskListFs,
  filePath: string
): Promise<void> {
  const resolvedPath = path.resolve(filePath);
  const rootPath = path.parse(resolvedPath).root;
  const components = resolvedPath.slice(rootPath.length).split(path.sep).filter(Boolean);
  let currentPath = rootPath;

  for (const component of components) {
    currentPath = path.join(currentPath, component);

    try {
      if ((await fs.lstat(currentPath)).isSymbolicLink()) {
        if (currentPath === "/tmp") {
          continue;
        }
        throw new Error(`Path "${filePath}" contains a symbolic link.`);
      }
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return;
      }

      throw error;
    }
  }
}

export async function writeAtomically(
  fs: TaskListFs,
  filePath: string,
  content: string
): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let tempCreated = false;

  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    tempCreated = true;
    await fs.rename(tempPath, filePath);
    tempCreated = false;
  } catch (error) {
    if (tempCreated || !hasErrorCode(error, "EEXIST")) {
      try {
        await fs.unlink(tempPath);
      } catch (unlinkError) {
        if (!hasErrorCode(unlinkError, "ENOENT")) {
          throw unlinkError;
        }
      }
    }

    throw error;
  }
}

export async function withFileLock<T>(
  fs: TaskListFs,
  lockPath: string,
  operation: () => Promise<T>
): Promise<T> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      await fs.writeFile(lockPath, String(process.pid), { encoding: "utf8", flag: "wx" });
      break;
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) {
        await fs.unlink(lockPath).catch(() => undefined);
        throw error;
      }

      if (await removeAbandonedLock(fs, lockPath)) {
        continue;
      }

      await Promise.resolve();
    }
  }

  try {
    return await operation();
  } finally {
    await fs.unlink(lockPath);
  }
}

async function removeAbandonedLock(fs: TaskListFs, lockPath: string): Promise<boolean> {
  let content: string;

  try {
    content = await fs.readFile(lockPath, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return true;
    }

    throw error;
  }

  const owner = Number(content);

  if (Number.isInteger(owner) && owner > 0 && isProcessRunning(owner)) {
    return false;
  }

  try {
    await fs.unlink(lockPath);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return true;
    }

    throw error;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasErrorCode(error, "ESRCH");
  }
}
