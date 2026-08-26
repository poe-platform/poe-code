import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { parse, stringify } from "yaml";
import { hasOwnErrorCode } from "./error-codes.js";
import { assertPathHasNoSymbolicLinks, withRegistryLock } from "./registry-lock.js";
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
  await withRegistryLock(registryFile, fs, () => persistRegistry(registryFile, registry, fs));
}

export async function withRegistryTransaction<Result>(
  registryFile: string,
  fs: WorktreeFileSystem,
  operation: (
    registry: WorktreeRegistry,
    write: (registry: WorktreeRegistry) => Promise<void>
  ) => Promise<Result>
): Promise<Result> {
  return withRegistryLock(registryFile, fs, async () => {
    const registry = await readRegistry(registryFile, fs);
    return operation(registry, (next) => persistRegistry(registryFile, next, fs));
  });
}

async function persistRegistry(
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
  const sourceCwd = getOwnEntry(value, "sourceCwd");
  const baseHead = getOwnEntry(value, "baseHead");
  const reconciledAt = getOwnEntry(value, "reconciledAt");
  const reconciliation = getOwnEntry(value, "reconciliation");
  return (
    typeof name === "string" &&
    typeof path === "string" &&
    typeof branch === "string" &&
    typeof baseBranch === "string" &&
    typeof createdAt === "string" &&
    typeof source === "string" &&
    typeof agent === "string" &&
    (
      status === "active" ||
      status === "reconciling" ||
      status === "conflicted" ||
      status === "cleanup_failed" ||
      status === "done" ||
      status === "failed" ||
      status === "removing"
    ) &&
    (storyId === undefined || typeof storyId === "string") &&
    (planPath === undefined || typeof planPath === "string") &&
    (prompt === undefined || typeof prompt === "string") &&
    (sourceCwd === undefined || typeof sourceCwd === "string") &&
    (baseHead === undefined || typeof baseHead === "string") &&
    (reconciledAt === undefined || typeof reconciledAt === "string") &&
    (reconciliation === undefined || isReconciliationSummary(reconciliation))
  );
}

function isReconciliationSummary(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const committed = getOwnEntry(value, "committed");
  const uncommitted = getOwnEntry(value, "uncommitted");
  const removed = getOwnEntry(value, "removed");
  const cleanup = getOwnEntry(value, "cleanup");
  const conflictFiles = getOwnEntry(value, "conflictFiles");
  const threadId = getOwnEntry(value, "threadId");
  return (
    (
      committed === "none" ||
      committed === "present" ||
      committed === "merged_by_agent" ||
      committed === "failed"
    ) &&
    (
      uncommitted === "none" ||
      uncommitted === "present" ||
      uncommitted === "applied_by_agent" ||
      uncommitted === "failed"
    ) &&
    typeof removed === "boolean" &&
    (
      cleanup === "not_needed" ||
      cleanup === "removed_by_agent" ||
      cleanup === "nudged" ||
      cleanup === "failed"
    ) &&
    Array.isArray(conflictFiles) &&
    conflictFiles.every((file) => typeof file === "string") &&
    (threadId === undefined || typeof threadId === "string")
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
  await withRegistryTransaction(registryFile, fs, async (registry, write) => {
    registry.worktrees.push(entry);
    await write(registry);
  });
}

export async function removeWorktreeEntry(
  registryFile: string,
  name: string,
  fs: WorktreeFileSystem
): Promise<void> {
  await withRegistryTransaction(registryFile, fs, async (registry, write) => {
    registry.worktrees = registry.worktrees.filter((worktree) => worktree.name !== name);
    await write(registry);
  });
}

export async function updateWorktreeStatus(
  registryFile: string,
  name: string,
  status: WorktreeStatus,
  deps: { fs: WorktreeFileSystem }
): Promise<void> {
  const { fs } = deps;
  await withRegistryTransaction(registryFile, fs, async (registry, write) => {
    const entry = registry.worktrees.find((worktree) => worktree.name === name);
    if (!entry) {
      throw new Error(`Worktree "${name}" not found in registry`);
    }
    entry.status = status;
    await write(registry);
  });
}

export async function updateWorktreeEntry(
  registryFile: string,
  name: string,
  update: (entry: Worktree) => Worktree,
  deps: { fs: WorktreeFileSystem }
): Promise<Worktree> {
  const { fs } = deps;
  return withRegistryTransaction(registryFile, fs, async (registry, write) => {
    let updated: Worktree | undefined;
    const worktrees = registry.worktrees.map((entry) => {
      if (entry.name !== name) {
        return entry;
      }
      updated = update(entry);
      return updated;
    });
    if (!updated) {
      throw new Error(`Worktree "${name}" not found in registry`);
    }
    await write({ worktrees });
    return updated;
  });
}
