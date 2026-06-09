import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { parse, stringify } from "yaml";
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
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
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
  if (typeof value !== "object" || value === null || !Array.isArray((value as { worktrees?: unknown }).worktrees)) {
    return false;
  }
  return (value as { worktrees: unknown[] }).worktrees.every(isWorktree);
}

function isWorktree(value: unknown): value is Worktree {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Partial<Worktree>;
  return (
    typeof entry.name === "string" &&
    typeof entry.path === "string" &&
    typeof entry.branch === "string" &&
    typeof entry.baseBranch === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.source === "string" &&
    typeof entry.agent === "string" &&
    (entry.status === "active" || entry.status === "done" || entry.status === "failed" || entry.status === "removing") &&
    (entry.storyId === undefined || typeof entry.storyId === "string") &&
    (entry.planPath === undefined || typeof entry.planPath === "string") &&
    (entry.prompt === undefined || typeof entry.prompt === "string")
  );
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
