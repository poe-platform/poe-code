import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { parse, stringify } from "yaml";
import { hasOwnErrorCode } from "./error-codes.js";
import type {
  Worktree,
  WorktreeRegistry,
  WorktreeFileSystem,
  WorktreeStatus
} from "./types.js";

export async function readRegistry(
  registryFile: string,
  fs: WorktreeFileSystem
): Promise<WorktreeRegistry> {
  try {
    await assertPathHasNoSymbolicLinks(registryFile, fs);
    const content = await fs.readFile(registryFile, "utf8");
    const parsed: unknown = parse(content);
    if (!isWorktreeRegistry(parsed)) {
      throw new Error(`Invalid worktree registry: ${registryFile}`);
    }
    return parsed;
  } catch (error) {
    if (isNotFound(error)) {
      return { worktrees: [] };
    }
    throw error;
  }
}

export async function writeRegistry(
  registryFile: string,
  registry: WorktreeRegistry,
  fs: WorktreeFileSystem
): Promise<void> {
  await assertPathHasNoSymbolicLinks(registryFile, fs);
  await fs.mkdir(dirname(registryFile), { recursive: true });
  await assertPathHasNoSymbolicLinks(registryFile, fs);
  const yaml = stringify(registry, { lineWidth: 0 });
  const temporaryFile = `${registryFile}.tmp-${randomUUID()}`;
  let temporaryCreated = false;
  try {
    await assertPathHasNoSymbolicLinks(temporaryFile, fs);
    await fs.writeFile(temporaryFile, yaml, { encoding: "utf8", flag: "wx" });
    temporaryCreated = true;
    await assertPathHasNoSymbolicLinks(registryFile, fs);
    await fs.rename(temporaryFile, registryFile);
  } catch (error) {
    if (temporaryCreated || !isAlreadyExists(error)) {
      await fs.unlink(temporaryFile).catch(() => undefined);
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

function isAlreadyExists(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

async function assertPathHasNoSymbolicLinks(
  targetPath: string,
  fs: Pick<WorktreeFileSystem, "lstat">
): Promise<void> {
  const segments = targetPath.split("/").filter(Boolean);
  let currentPath = targetPath.startsWith("/") ? "" : ".";
  for (const segment of segments) {
    currentPath = `${currentPath}/${segment}`;
    try {
      if ((await fs.lstat(currentPath)).isSymbolicLink()) {
        throw new Error(`Refusing worktree registry path containing symbolic link: ${currentPath}`);
      }
    } catch (error) {
      if (isNotFound(error)) {
        return;
      }
      throw error;
    }
  }
}

function isWorktreeRegistry(value: unknown): value is WorktreeRegistry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const worktrees = getOwnEntry(value, "worktrees");
  if (!Array.isArray(worktrees)) {
    return false;
  }
  return worktrees.every(isWorktree);
}

function isWorktree(value: unknown): value is Worktree {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const name = getOwnEntry(value, "name");
  const path = getOwnEntry(value, "path");
  const branch = getOwnEntry(value, "branch");
  const baseBranch = getOwnEntry(value, "baseBranch");
  const createdAt = getOwnEntry(value, "createdAt");
  const source = getOwnEntry(value, "source");
  const agent = getOwnEntry(value, "agent");
  const status = getOwnEntry(value, "status");
  const storyId = getOwnEntry(value, "storyId");
  const planPath = getOwnEntry(value, "planPath");
  const prompt = getOwnEntry(value, "prompt");
  return (
    typeof name === "string" &&
    typeof path === "string" &&
    typeof branch === "string" &&
    typeof baseBranch === "string" &&
    typeof createdAt === "string" &&
    typeof source === "string" &&
    typeof agent === "string" &&
    (status === "active" || status === "done" || status === "failed" || status === "removing") &&
    (storyId === undefined || typeof storyId === "string") &&
    (planPath === undefined || typeof planPath === "string") &&
    (prompt === undefined || typeof prompt === "string")
  );
}

function getOwnEntry(record: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? (record as Record<string, unknown>)[key]
    : undefined;
}

export async function addWorktreeEntry(
  registryFile: string,
  entry: Worktree,
  fs: WorktreeFileSystem
): Promise<void> {
  const registry = await readRegistry(registryFile, fs);
  registry.worktrees.push(entry);
  await writeRegistry(registryFile, registry, fs);
}

export async function removeWorktreeEntry(
  registryFile: string,
  name: string,
  fs: WorktreeFileSystem
): Promise<void> {
  const registry = await readRegistry(registryFile, fs);
  registry.worktrees = registry.worktrees.filter((w) => w.name !== name);
  await writeRegistry(registryFile, registry, fs);
}

export async function updateWorktreeStatus(
  registryFile: string,
  name: string,
  status: WorktreeStatus,
  deps: { fs: WorktreeFileSystem }
): Promise<void> {
  const { fs } = deps;
  const registry = await readRegistry(registryFile, fs);
  const entry = registry.worktrees.find((w) => w.name === name);
  if (!entry) {
    throw new Error(`Worktree "${name}" not found in registry`);
  }
  entry.status = status;
  await writeRegistry(registryFile, registry, fs);
}
