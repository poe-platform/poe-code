import path from "node:path";
import { randomUUID } from "node:crypto";
import { isNotFound } from "@poe-code/config-mutations";
import { hasOwnErrorCode } from "./error-codes.js";
import type { FileSystem } from "./file-system.js";

type TimestampProvider = () => string;

const DEFAULT_TIMESTAMP: TimestampProvider = () =>
  new Date().toISOString().replace(/[:.]/g, "-");

export async function createBackup(
  fs: FileSystem,
  targetPath: string,
  timestamp: TimestampProvider = DEFAULT_TIMESTAMP
): Promise<string | null> {
  if (!(await exists(fs, targetPath))) {
    return null;
  }

  const backupPath = `${targetPath}.backup.${timestamp()}`;
  await copyExclusive(fs, targetPath, backupPath);
  return backupPath;
}

export async function restoreLatestBackup(
  fs: FileSystem,
  targetPath: string
): Promise<boolean> {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }

  const backups = entries
    .filter((name) => isGeneratedBackupName(name, base))
    .sort()
    .reverse();

  if (backups.length === 0) {
    return false;
  }

  const latest = path.join(dir, backups[0]);
  const temporaryPath = `${targetPath}.restore-${randomUUID()}`;
  let temporaryCreated = false;
  try {
    await copyExclusive(fs, latest, temporaryPath);
    temporaryCreated = true;
    await fs.rename(temporaryPath, targetPath);
    temporaryCreated = false;
  } catch (error) {
    if (temporaryCreated) {
      await fs.unlink(temporaryPath).catch(() => undefined);
    }
    throw error;
  }
  return true;
}

function isGeneratedBackupName(name: string, base: string): boolean {
  const prefix = `${base}.backup.`;
  if (!name.startsWith(prefix)) {
    return false;
  }

  const timestamp = name.slice(prefix.length);
  return timestamp.length > 0 && timestamp[0] >= "0" && timestamp[0] <= "9";
}

async function exists(fs: FileSystem, targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

async function copyExclusive(
  fs: FileSystem,
  from: string,
  to: string
): Promise<void> {
  const content = await fs.readFile(from);
  try {
    await fs.writeFile(to, content, { flag: "wx" });
  } catch (error) {
    if (!isAlreadyExists(error)) {
      await fs.unlink(to).catch(() => undefined);
    }
    throw error;
  }
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "EEXIST");
}
