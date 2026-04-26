import path from "node:path";
import type { Task, TaskListFs } from "../types.js";

let tmpFileCounter = 0;

export function hasErrorCode(error: unknown, code: string): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
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

export function validateTaskId(id: string): string {
  if (
    id.length === 0 ||
    id.startsWith(".") ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("..")
  ) {
    throw new Error(`Invalid task id "${id}".`);
  }

  return id;
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

export async function writeAtomically(fs: TaskListFs, filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${tmpFileCounter}`;
  tmpFileCounter += 1;

  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch (unlinkError) {
      if (!hasErrorCode(unlinkError, "ENOENT")) {
        throw unlinkError;
      }
    }

    throw error;
  }
}
