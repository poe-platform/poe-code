import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";
import type { WorktreeFileSystem } from "./types.js";

const LOCK_WAIT_MS = 30_000;
const LOCK_RETRY_MS = 10;

export async function withRegistryLock<Result>(
  registryFile: string,
  fs: WorktreeFileSystem,
  operation: () => Promise<Result>
): Promise<Result> {
  await assertPathHasNoSymbolicLinks(registryFile, fs);
  const lockPath = `${resolve(registryFile)}.lock`;
  const ownerPath = `${lockPath}/${process.pid}-${randomUUID()}`;
  await fs.mkdir(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (true) {
    await assertPathHasNoSymbolicLinks(lockPath, fs);
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (error) {
      if (!hasOwnErrorCode(error, "EEXIST")) throw error;
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for worktree registry lock: ${lockPath}. ` +
          "An abandoned lock must only be removed after confirming all worktree operations have stopped."
        );
      }
      await new Promise((done) => setTimeout(done, LOCK_RETRY_MS));
    }
  }

  let ownerCreated = false;
  let outcome: { result: Result } | { error: unknown };
  try {
    await assertPathHasNoSymbolicLinks(lockPath, fs);
    await fs.mkdir(ownerPath);
    ownerCreated = true;
    outcome = { result: await operation() };
  } catch (error) {
    outcome = { error };
  }
  try {
    await assertPathHasNoSymbolicLinks(lockPath, fs);
    if (ownerCreated) await fs.rmdir(ownerPath);
    await fs.rmdir(lockPath);
  } catch (error) {
    if ("error" in outcome) {
      throw new AggregateError([outcome.error, error], "Worktree operation and registry lock release failed");
    }
    throw error;
  }
  if ("error" in outcome) throw outcome.error;
  return outcome.result;
}

export async function assertPathHasNoSymbolicLinks(
  targetPath: string,
  fs: Pick<WorktreeFileSystem, "lstat">
): Promise<void> {
  const segments = targetPath.split("/").filter(Boolean);
  let currentPath = targetPath.startsWith("/") ? "" : ".";
  for (const segment of segments) {
    currentPath = `${currentPath}/${segment}`;
    try {
      if ((await fs.lstat(currentPath)).isSymbolicLink()) {
        if (currentPath === "/var") continue;
        throw new Error(`Refusing worktree registry path containing symbolic link: ${currentPath}`);
      }
    } catch (error) {
      if (hasOwnErrorCode(error, "ENOENT")) return;
      throw error;
    }
  }
}
