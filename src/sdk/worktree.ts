import * as nodeFs from "node:fs/promises";
import { exec as nodeExec } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  createWorktree,
  listWorktrees,
  reconcileWorktree,
  removeWorktree,
  updateWorktreeEntry,
  type ListWorktreeEntry,
  type Worktree,
  type WorktreeDeps,
  type WorktreeReconciliationSummary
} from "@poe-code/worktree";
import type { SpawnOptions, SpawnResult, WorktreeExecutionOptions } from "./types.js";

const execShell = promisify(nodeExec);

export type WorktreeExecutionContext = {
  sourceCwd: string;
  worktreeCwd: string;
  worktree: Worktree;
  signal?: AbortSignal;
};

export type WorktreeExecutionResult = {
  worktree: Worktree;
  reconciliation?: WorktreeReconciliationSummary;
};

export type RunInWorktreeInput<T> = {
  cwd: string;
  selectedAgent: string;
  selectedModel?: string;
  worktree: WorktreeExecutionOptions;
  run: (context: WorktreeExecutionContext) => Promise<T>;
  isSuccessful?: (value: T) => boolean;
  signal?: AbortSignal;
  spawnAgent?: SpawnAgent;
  deps?: WorktreeDeps;
};

export type RunInWorktreeResult<T> = {
  value: T;
  worktree: WorktreeExecutionResult;
};

export type RunWithOptionalWorktreeInput<T> = Omit<RunInWorktreeInput<T>, "worktree"> & {
  worktree?: WorktreeExecutionOptions;
};

export type RunWithOptionalWorktreeResult<T> = {
  value: T;
  worktree?: WorktreeExecutionResult;
};

export type ManagedWorktreeCreateOptions = Parameters<typeof createWorktree>[0];
export type ManagedWorktreeReconcileOptions = {
  cwd: string;
  name: string;
  agent: string;
  registryFile?: string;
  deps?: WorktreeDeps;
  signal?: AbortSignal;
  spawnAgent?: SpawnAgent;
};
export type ManagedWorktreeListOptions = {
  cwd: string;
  registryFile?: string;
  deps?: WorktreeDeps;
};
export type ManagedWorktreeRemoveOptions = {
  cwd: string;
  name: string;
  registryFile?: string;
  deleteBranch?: boolean;
  deps?: WorktreeDeps;
};

type NormalizedWorktreeOptions = {
  enabled: boolean;
  registryFile: string;
  worktreeDir: string;
};

type SpawnAgent = (
  service: string,
  options: SpawnOptions & { worktree?: false }
) => Promise<SpawnResult>;

export async function runInWorktree<T>(
  input: RunInWorktreeInput<T>
): Promise<RunInWorktreeResult<T>> {
  const options = normalizeWorktreeOptions(input.cwd, input.worktree);
  if (!options.enabled) {
    throw new Error("runInWorktree requires enabled worktree options.");
  }
  const deps = input.deps ?? createNodeWorktreeDeps();
  const worktree = await createWorktree({
    cwd: input.cwd,
    name: `worktree-${randomUUID().slice(0, 8)}`,
    baseBranch: "HEAD",
    source: "sdk",
    agent: input.selectedAgent,
    registryFile: options.registryFile,
    worktreeDir: options.worktreeDir,
    sourceCwd: input.cwd,
    deps
  });

  let value: T;
  let successful: boolean;
  try {
    value = await input.run({
      sourceCwd: input.cwd,
      worktreeCwd: worktree.path,
      worktree,
      signal: input.signal
    });
    successful = !input.signal?.aborted && (input.isSuccessful?.(value) ?? true);
  } catch (error) {
    await handleFailedWorktreeRun({
      cwd: input.cwd,
      worktree,
      options,
      deps,
      selectedAgent: input.selectedAgent,
      selectedModel: input.selectedModel,
      spawnAgent: input.spawnAgent,
      signal: input.signal
    });
    throw error;
  }

  if (!successful) {
    await handleFailedWorktreeRun({
      ...input,
      worktree,
      options,
      deps,
      preserveWorktree: true
    });
    return { value, worktree: { worktree: { ...worktree, status: "failed" } } };
  }

  const reconciliation = await reconcileWorktree({
    cwd: input.cwd,
    name: worktree.name,
    registryFile: options.registryFile,
    deps,
    signal: input.signal,
    reconciliationAgent: async (agentInput) => {
      const spawnAgent = input.spawnAgent ?? defaultSpawnAgent;
      const result = await spawnAgent(input.selectedAgent, {
        cwd: agentInput.sourceCwd,
        prompt: agentInput.prompt,
        ...(input.selectedModel ? { model: input.selectedModel } : {}),
        ...(agentInput.resumeThreadId
          ? { resumeThreadId: agentInput.resumeThreadId }
          : {}),
        worktree: false
      });
      return result;
    }
  });

  return {
    value,
    worktree: {
      worktree,
      ...(reconciliation ? { reconciliation } : {})
    }
  };
}

async function handleFailedWorktreeRun(input: {
  cwd: string;
  worktree: Worktree;
  options: NormalizedWorktreeOptions;
  deps: WorktreeDeps;
  selectedAgent: string;
  selectedModel?: string;
  spawnAgent?: SpawnAgent;
  signal?: AbortSignal;
  preserveWorktree?: boolean;
}): Promise<void> {
  const worktreeHead = (await input.deps.exec("git rev-parse HEAD", {
    cwd: input.worktree.path
  })).stdout.trim();
  const status = (await input.deps.exec("git status --porcelain=v1 -z", {
    cwd: input.worktree.path
  })).stdout;
  const hasCommittedChanges =
    input.worktree.baseHead !== undefined && worktreeHead !== input.worktree.baseHead;
  const hasUncommittedChanges = status.length > 0;
  const summary: WorktreeReconciliationSummary = {
    committed: hasCommittedChanges ? "present" : "none",
    uncommitted: hasUncommittedChanges ? "present" : "none",
    removed: false,
    cleanup: "not_needed",
    conflictFiles: []
  };

  await updateWorktreeEntry(
    input.options.registryFile,
    input.worktree.name,
    (entry) => ({
      ...entry,
      status: "failed",
      reconciledAt: new Date().toISOString(),
      reconciliation: summary
    }),
    { fs: input.deps.fs }
  );

  if (input.preserveWorktree || input.signal?.aborted || hasCommittedChanges || hasUncommittedChanges) {
    return;
  }

  const spawnAgent = input.spawnAgent ?? defaultSpawnAgent;
  const result = await spawnAgent(input.selectedAgent, {
    cwd: input.cwd,
    prompt: buildFailedRunCleanupPrompt(input.worktree),
    ...(input.selectedModel ? { model: input.selectedModel } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    worktree: false
  });

  const removed = result.exitCode === 0 && !(await managedWorktreeExists(input.cwd, input.worktree, input.deps));
  await updateWorktreeEntry(
    input.options.registryFile,
    input.worktree.name,
    (entry) => ({
      ...entry,
      status: "failed",
      reconciledAt: new Date().toISOString(),
      reconciliation: {
        ...summary,
        removed,
        cleanup: removed ? "removed_by_agent" : "failed",
        ...(result.threadId ? { threadId: result.threadId } : {})
      }
    }),
    { fs: input.deps.fs }
  );
}

function buildFailedRunCleanupPrompt(worktree: Worktree): string {
  return [
    "A poe-code managed worktree run failed and produced no worktree changes.",
    "",
    `Worktree path: ${worktree.path}`,
    `Worktree branch: ${worktree.branch}`,
    "",
    "Remove that git worktree and branch now. Then verify `git worktree list --porcelain`",
    "does not contain the path."
  ].join("\n");
}

async function managedWorktreeExists(
  sourceCwd: string,
  worktree: Worktree,
  deps: WorktreeDeps
): Promise<boolean> {
  const gitOutput = await deps.exec("git worktree list --porcelain", { cwd: sourceCwd });
  for (const line of gitOutput.stdout.split("\n")) {
    if (line === `worktree ${worktree.path}`) {
      return true;
    }
  }
  try {
    await deps.fs.lstat(worktree.path);
    return true;
  } catch {
    return false;
  }
}

export async function runWithOptionalWorktree<T>(
  input: RunWithOptionalWorktreeInput<T>
): Promise<RunWithOptionalWorktreeResult<T>> {
  const options = normalizeWorktreeOptions(input.cwd, input.worktree ?? false);
  if (!options.enabled) {
    const worktree = createDirectWorktree(input.cwd, input.selectedAgent);
    const value = await input.run({
      sourceCwd: input.cwd,
      worktreeCwd: input.cwd,
      worktree,
      signal: input.signal
    });
    return { value };
  }

  return await runInWorktree({
    ...input,
    worktree: true
  });
}

export async function createManagedWorktree(
  options: ManagedWorktreeCreateOptions
): Promise<Worktree> {
  return await createWorktree(options);
}

export async function reconcileManagedWorktree(
  options: ManagedWorktreeReconcileOptions
): Promise<WorktreeReconciliationSummary> {
  const deps = options.deps ?? createNodeWorktreeDeps();
  return await reconcileWorktree({
      cwd: options.cwd,
      name: options.name,
      registryFile: options.registryFile ?? defaultRegistryFile(options.cwd),
      deps,
      signal: options.signal,
    reconciliationAgent: async (agentInput) => {
      const spawnAgent = options.spawnAgent ?? defaultSpawnAgent;
      return await spawnAgent(options.agent, {
        cwd: agentInput.sourceCwd,
        prompt: agentInput.prompt,
        ...(agentInput.resumeThreadId ? { resumeThreadId: agentInput.resumeThreadId } : {}),
        worktree: false
      });
    }
  });
}

export async function listManagedWorktrees(
  options: ManagedWorktreeListOptions
): Promise<ListWorktreeEntry[]> {
  const deps = options.deps ?? createNodeWorktreeDeps();
  return await listWorktrees(options.cwd, options.registryFile ?? defaultRegistryFile(options.cwd), deps);
}

export async function removeManagedWorktree(
  options: ManagedWorktreeRemoveOptions
): Promise<void> {
  const deps = options.deps ?? createNodeWorktreeDeps();
  await removeWorktree({
    cwd: options.cwd,
    name: options.name,
    registryFile: options.registryFile ?? defaultRegistryFile(options.cwd),
    deleteBranch: options.deleteBranch,
    deps
  });
}

function normalizeWorktreeOptions(
  cwd: string,
  options: WorktreeExecutionOptions
): NormalizedWorktreeOptions {
  if (options === false) {
    return {
      enabled: false,
      registryFile: defaultRegistryFile(cwd),
      worktreeDir: defaultWorktreeDir(cwd)
    };
  }
  return {
    enabled: true,
    registryFile: defaultRegistryFile(cwd),
    worktreeDir: defaultWorktreeDir(cwd)
  };
}

function defaultRegistryFile(cwd: string): string {
  return path.join(cwd, ".poe-code", "worktrees.yaml");
}

function defaultWorktreeDir(cwd: string): string {
  return path.join(cwd, ".poe-code", "worktrees");
}

function createDirectWorktree(cwd: string, selectedAgent: string): Worktree {
  return {
    name: "source",
    path: cwd,
    branch: "",
    baseBranch: "",
    createdAt: new Date().toISOString(),
    source: "sdk",
    agent: selectedAgent,
    status: "active",
    sourceCwd: cwd
  };
}

function createNodeWorktreeDeps(): WorktreeDeps {
  return {
    fs: {
      readFile: async (targetPath, encoding) => await nodeFs.readFile(targetPath, encoding),
      writeFile: async (targetPath, data, options) => {
        await nodeFs.writeFile(targetPath, data, options);
      },
      mkdir: async (targetPath, options) => {
        await nodeFs.mkdir(targetPath, options);
      },
      rmdir: nodeFs.rmdir,
      rename: async (oldPath, newPath) => {
        await nodeFs.rename(oldPath, newPath);
      },
      unlink: async (targetPath) => {
        await nodeFs.unlink(targetPath);
      },
      lstat: async (targetPath) => await nodeFs.lstat(targetPath)
    },
    exec: async (command, options) => {
      const result = await execShell(command, {
        cwd: options?.cwd,
        maxBuffer: 10 * 1024 * 1024
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr
      };
    }
  };
}

async function defaultSpawnAgent(
  service: string,
  options: SpawnOptions & { worktree?: false }
): Promise<SpawnResult> {
  const { spawn } = await import("./spawn.js");
  return await spawn(service, options).result;
}
