import { createHash } from "node:crypto";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { assertClonableTargetRepo } from "../target-repo.js";

export interface CloneTargetInput {
  repo: string;
  ref: string;
  dest: string;
  cacheDir?: string | null;
  signal?: AbortSignal;
}

export async function cloneTarget(input: CloneTargetInput): Promise<{ resolvedSha: string }> {
  throwIfAborted(input.signal);
  assertClonableTargetRepo(input.repo);

  const destExisted = await exists(input.dest);

  try {
    const cacheDir = input.cacheDir;
    if (cacheDir == null) {
      await cloneDirect(input);
    } else {
      await cloneFromCache({ ...input, cacheDir });
    }

    return {
      resolvedSha: (await git(input.dest, input.signal).revparse(["HEAD"])).trim()
    };
  } catch (error) {
    if (!destExisted) {
      await rm(input.dest, { recursive: true, force: true });
    }

    throw error;
  }
}

async function cloneDirect(input: CloneTargetInput): Promise<void> {
  await git(undefined, input.signal).clone(input.repo, input.dest, [
    "--depth",
    "1",
    "--branch",
    input.ref
  ]);
}

async function cloneFromCache(input: CloneTargetInput & { cacheDir: string }): Promise<void> {
  await mkdir(input.cacheDir, { recursive: true });
  const cachedRepo = path.join(input.cacheDir, `${hashRepo(input.repo)}.git`);

  if (await exists(cachedRepo)) {
    await git(cachedRepo, input.signal).raw([
      "fetch",
      "origin",
      "--prune",
      "+refs/heads/*:refs/heads/*",
      "+refs/tags/*:refs/tags/*"
    ]);
  } else {
    await git(undefined, input.signal).clone(input.repo, cachedRepo, ["--bare"]);
  }

  await git(cachedRepo, input.signal).raw(["worktree", "prune"]);
  await git(cachedRepo, input.signal).raw(["worktree", "add", "--detach", input.dest, input.ref]);
}

function git(baseDir?: string, signal?: AbortSignal): SimpleGit {
  return simpleGit(baseDir ?? process.cwd(), { abort: signal });
}

function hashRepo(repo: string): string {
  return createHash("sha256").update(repo).digest("hex");
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw signal.reason instanceof Error ? signal.reason : new Error("cloneTarget aborted.");
}
