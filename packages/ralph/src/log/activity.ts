import { dirname } from "node:path";
import * as fsPromises from "node:fs/promises";

export type ActivityLogFileSystem = {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  appendFile(
    path: string,
    data: string,
    options?: { encoding?: BufferEncoding }
  ): Promise<void>;
};

export type LogActivityOptions = {
  fs?: ActivityLogFileSystem;
};

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function validateLogPath(path: string): void {
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new Error(
      `Invalid activity log path: expected a non-empty string, got ${String(path)}`
    );
  }
  if (path.includes("\0")) {
    throw new Error("Invalid activity log path: contains null byte");
  }
}

export async function logActivity(
  path: string,
  message: string,
  options: LogActivityOptions = {}
): Promise<void> {
  validateLogPath(path);

  const fs = options.fs ?? fsPromises;

  const parent = dirname(path);
  if (parent && parent !== ".") {
    await fs.mkdir(parent, { recursive: true });
  }

  const entry = `[${formatTimestamp(new Date())}] ${message}\n`;
  try {
    await fs.appendFile(path, entry, { encoding: "utf8" });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
    throw new Error(`Failed to append activity log entry: ${detail}`, { cause: error });
  }
}

