import { readRegistry, updateWorktreeEntry } from "./registry.js";
import { worktreeNotFoundError } from "./not-found.js";
import type { Worktree, WorktreeDeps, WorktreeReconciliationSummary } from "./types.js";

export type WorktreeReconcilePhase = "reconcile" | "cleanup-nudge";

export type WorktreeReconciliationAgent = (input: {
  phase: WorktreeReconcilePhase;
  sourceCwd: string;
  worktree: Worktree;
  prompt: string;
  resumeThreadId?: string;
  summary: WorktreeReconciliationSummary;
  signal?: AbortSignal;
}) => Promise<{ exitCode: number; stdout: string; stderr: string; threadId?: string }>;

export type ReconcileWorktreeOptions = {
  cwd: string;
  name: string;
  registryFile: string;
  reconciliationAgent: WorktreeReconciliationAgent;
  deps: WorktreeDeps;
  signal?: AbortSignal;
};

type InspectedWorktree = {
  sourceCwd: string;
  baseHead: string;
  worktreeHead: string;
  statusPorcelain: string;
  committedPaths: string[];
  uncommittedPaths: string[];
};

export async function reconcileWorktree(
  options: ReconcileWorktreeOptions
): Promise<WorktreeReconciliationSummary> {
  const entry = await findWorktree(options.registryFile, options.name, options.deps);
  const sourceCwd = entry.sourceCwd ?? options.cwd;
  const recovering = (entry.status === "conflicted" || entry.status === "cleanup_failed") &&
    entry.reconciliation !== undefined;
  if (!recovering) {
    await assertCleanDestination(sourceCwd, options.deps);
  }

  await updateEntry(options, entry.name, (worktree) => ({
    ...worktree,
    status: "reconciling"
  }));

  const inspected = await inspectWorktree(entry, sourceCwd, options.deps);
  let summary = createInitialSummary(entry, inspected);
  const result = await invokeReconciliationAgent(options, {
    phase: "reconcile",
    sourceCwd,
    worktree: entry,
    prompt: buildReconciliationPrompt(entry, inspected, recovering),
    ...(recovering && summary.threadId ? { resumeThreadId: summary.threadId } : {}),
    summary,
    signal: options.signal
  });
  summary = {
    ...summary,
    threadId: result.threadId ?? summary.threadId,
    ...(summary.committed === "present" ? { committed: "merged_by_agent" as const } : {}),
    ...(summary.uncommitted === "present" ? { uncommitted: "applied_by_agent" as const } : {})
  };

  if (result.exitCode !== 0) {
    const failedSummary: WorktreeReconciliationSummary = {
      ...summary,
      committed: summary.committed === "none" ? "none" : "failed",
      uncommitted: summary.uncommitted === "none" ? "none" : "failed",
      cleanup: "failed"
    };
    await persistSummary(options, entry.name, "conflicted", failedSummary);
    throw new Error(`Worktree reconciliation agent exited with code ${result.exitCode}.`);
  }

  const conflictFiles = await listUnmergedPaths(sourceCwd, options.deps);
  if (conflictFiles.length > 0) {
    const conflictedSummary = { ...summary, conflictFiles };
    await persistSummary(options, entry.name, "conflicted", conflictedSummary);
    throw new Error("Worktree reconciliation left unresolved conflicts.");
  }
  const missingPaths = await listMissingExpectedSourcePaths(sourceCwd, inspected, options.deps);
  if (missingPaths.length > 0) {
    const conflictedSummary = { ...summary, conflictFiles: missingPaths };
    await persistSummary(options, entry.name, "conflicted", conflictedSummary);
    throw new Error("Worktree reconciliation did not apply expected worktree changes.");
  }

  const removedAfterFirstAttempt = !(await worktreeExists(sourceCwd, entry, options.deps));
  if (removedAfterFirstAttempt) {
    const doneSummary: WorktreeReconciliationSummary = {
      ...summary,
      removed: true,
      cleanup: "removed_by_agent",
      conflictFiles: []
    };
    await persistSummary(options, entry.name, "done", doneSummary);
    return doneSummary;
  }

  const cleanupPrompt = buildCleanupNudgePrompt(entry);
  await invokeReconciliationAgent(options, {
    phase: "cleanup-nudge",
    sourceCwd,
    worktree: entry,
    prompt: cleanupPrompt,
    resumeThreadId: summary.threadId,
    summary,
    signal: options.signal
  });

  const removedAfterNudge = !(await worktreeExists(sourceCwd, entry, options.deps));
  if (!removedAfterNudge) {
    const failedSummary: WorktreeReconciliationSummary = {
      ...summary,
      removed: false,
      cleanup: "failed",
      conflictFiles: []
    };
    await persistSummary(options, entry.name, "cleanup_failed", failedSummary);
    throw new Error("Worktree reconciliation cleanup failed.");
  }

  const nudgedSummary: WorktreeReconciliationSummary = {
    ...summary,
    removed: true,
    cleanup: "nudged",
    conflictFiles: []
  };
  await persistSummary(options, entry.name, "done", nudgedSummary);
  return nudgedSummary;
}

async function invokeReconciliationAgent(
  options: ReconcileWorktreeOptions,
  input: Parameters<WorktreeReconciliationAgent>[0]
): Promise<Awaited<ReturnType<WorktreeReconciliationAgent>>> {
  try {
    return await options.reconciliationAgent(input);
  } catch (agentError) {
    const failedSummary: WorktreeReconciliationSummary = {
      ...input.summary,
      ...(input.phase === "reconcile" ? {
        committed: input.summary.committed === "none" ? "none" : "failed",
        uncommitted: input.summary.uncommitted === "none" ? "none" : "failed"
      } : {}),
      cleanup: "failed"
    };
    try {
      await persistSummary(options, input.worktree.name,
        input.phase === "reconcile" ? "conflicted" : "cleanup_failed", failedSummary);
    } catch (recordingError) {
      throw new AggregateError([agentError, recordingError],
        "Worktree reconciliation agent failed and its recovery state could not be recorded.");
    }
    throw agentError;
  }
}

async function findWorktree(
  registryFile: string,
  name: string,
  deps: WorktreeDeps
): Promise<Worktree> {
  const registry = await readRegistry(registryFile, deps.fs);
  const entry = registry.worktrees.find((worktree) => worktree.name === name);
  if (!entry) {
    throw worktreeNotFoundError(name, registry.worktrees);
  }
  return entry;
}

async function assertCleanDestination(sourceCwd: string, deps: WorktreeDeps): Promise<void> {
  const status = await deps.exec("git status --porcelain=v1 -z", { cwd: sourceCwd });
  if (status.stdout.length > 0) {
    throw new Error(
      "Cannot run with --worktree because the destination checkout has uncommitted changes.\nCommit, stash, or discard those changes before starting a worktree run."
    );
  }
}

async function inspectWorktree(
  worktree: Worktree,
  sourceCwd: string,
  deps: WorktreeDeps
): Promise<InspectedWorktree> {
  const worktreeHead = (await deps.exec("git rev-parse HEAD", { cwd: worktree.path })).stdout.trim();
  const statusPorcelain = (await deps.exec("git status --porcelain=v1 -z", {
    cwd: worktree.path
  })).stdout;
  const committedPaths = worktreeHead === (worktree.baseHead ?? worktree.baseBranch)
    ? []
    : await listChangedPathsBetween(worktree.path, worktree.baseHead ?? worktree.baseBranch, worktreeHead, deps);
  return {
    sourceCwd,
    baseHead: worktree.baseHead ?? worktree.baseBranch,
    worktreeHead,
    statusPorcelain,
    committedPaths,
    uncommittedPaths: parsePorcelainPaths(statusPorcelain)
  };
}

function createInitialSummary(
  worktree: Worktree,
  inspected: InspectedWorktree
): WorktreeReconciliationSummary {
  return {
    committed: inspected.worktreeHead === inspected.baseHead ? "none" : "present",
    uncommitted: inspected.statusPorcelain.length === 0 ? "none" : "present",
    removed: false,
    cleanup: "not_needed",
    conflictFiles: [],
    ...(worktree.reconciliation?.threadId ? { threadId: worktree.reconciliation.threadId } : {})
  };
}

function buildReconciliationPrompt(
  worktree: Worktree,
  inspected: InspectedWorktree,
  recovering: boolean
): string {
  const committed = inspected.worktreeHead === inspected.baseHead ? "none" : "present";
  const uncommitted = formatPorcelainSummary(inspected.statusPorcelain);
  return [
    "Reconcile and clean up this poe-code managed worktree.",
    ...(recovering ? [
      "Resume the previous failed reconciliation; the destination may contain partial changes or unresolved conflicts.",
      "Preserve existing destination changes and user conflict resolutions; do not reset or discard them to obtain a clean checkout.",
      "Complete an in-progress merge before starting another."
    ] : []),
    "",
    `Source checkout: ${inspected.sourceCwd}`,
    `Worktree path: ${worktree.path}`,
    `Worktree branch: ${worktree.branch}`,
    `Base commit: ${inspected.baseHead}`,
    `Worktree head: ${inspected.worktreeHead}`,
    `Committed changes: ${committed}`,
    "Uncommitted changes:",
    uncommitted,
    "",
    "Rules:",
    "- Merge committed worktree changes into the source checkout when present.",
    "- Transfer tracked, staged, unstaged, and untracked worktree file changes into the source checkout.",
    "- Resolve all git conflict markers and file collisions you encounter.",
    "- Preserve the requested worktree changes unless they are invalid or superseded by a clear source-checkout requirement.",
    "- Keep the repository buildable.",
    "- Do not commit unless completing an in-progress git merge requires a commit.",
    "- Remove the managed worktree and branch when done.",
    "- When done, leave `git status --porcelain=v1 -z` with no unmerged paths."
  ].join("\n");
}

function buildCleanupNudgePrompt(worktree: Worktree): string {
  return [
    "The source checkout reconciliation appears complete, but the managed worktree still exists:",
    "",
    `Worktree path: ${worktree.path}`,
    `Worktree branch: ${worktree.branch}`,
    "",
    "Remove that git worktree and branch now. Then verify `git worktree list --porcelain`",
    "does not contain the path."
  ].join("\n");
}

function formatPorcelainSummary(output: string): string {
  const entries = output.split("\0").filter((entry) => entry.length > 0);
  return entries.length === 0 ? "none" : entries.join("\n");
}

async function listChangedPathsBetween(
  cwd: string,
  leftRef: string,
  rightRef: string,
  deps: WorktreeDeps
): Promise<string[]> {
  const result = await deps.exec(
    `git diff --name-only -z ${shellQuote(leftRef)} ${shellQuote(rightRef)}`,
    { cwd }
  );
  return result.stdout.split("\0").filter((entry) => entry.length > 0);
}

async function listMissingExpectedSourcePaths(
  sourceCwd: string,
  inspected: InspectedWorktree,
  deps: WorktreeDeps
): Promise<string[]> {
  const expected = [...new Set([...inspected.committedPaths, ...inspected.uncommittedPaths])];
  if (expected.length === 0) {
    return [];
  }
  const [diff, status] = await Promise.all([
    deps.exec(`git diff --name-only -z ${shellQuote(inspected.baseHead)}`, { cwd: sourceCwd }),
    deps.exec("git status --porcelain=v1 -z", { cwd: sourceCwd })
  ]);
  const actual = new Set([
    ...diff.stdout.split("\0").filter((entry) => entry.length > 0),
    ...parsePorcelainPaths(status.stdout)
  ]);
  return expected.filter((filePath) => !actual.has(filePath));
}

function parsePorcelainPaths(output: string): string[] {
  const paths: string[] = [];
  const entries = output.split("\0").filter((entry) => entry.length > 0);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const path = entry.length > 3 ? entry.slice(3) : entry;
    if (path.length > 0) {
      paths.push(path);
    }
    if ((entry.startsWith("R ") || entry.startsWith("C ")) && index + 1 < entries.length) {
      const sourcePath = entries[index + 1]!;
      if (sourcePath.length > 0) {
        paths.push(sourcePath);
      }
      index += 1;
    }
  }
  return paths;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function listUnmergedPaths(sourceCwd: string, deps: WorktreeDeps): Promise<string[]> {
  const result = await deps.exec("git diff --name-only --diff-filter=U -z", { cwd: sourceCwd });
  return result.stdout.split("\0").filter((entry) => entry.length > 0);
}

async function worktreeExists(
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

async function persistSummary(
  options: ReconcileWorktreeOptions,
  name: string,
  status: Worktree["status"],
  summary: WorktreeReconciliationSummary
): Promise<void> {
  await updateEntry(options, name, (worktree) => ({
    ...worktree,
    status,
    reconciliation: summary,
    reconciledAt: new Date().toISOString()
  }));
}

async function updateEntry(
  options: ReconcileWorktreeOptions,
  name: string,
  update: (worktree: Worktree) => Worktree
): Promise<Worktree> {
  return await updateWorktreeEntry(options.registryFile, name, update, { fs: options.deps.fs });
}
