import { promises as nodeFs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn as defaultSpawn, type SpawnUsage } from "@poe-code/agent-spawn";
import { loadGaslightConfig } from "./config.js";
import type {
  GaslightArchiveFileSystem,
  GaslightFileSystem,
  GaslightOptions,
  GaslightPlanResult,
  GaslightResult,
  GaslightRound
} from "./types.js";

function summarize(stdout: string, stderr: string): string {
  return stdout.trim() || stderr.trim();
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function addUsage(
  total: SpawnUsage | undefined,
  usage: SpawnUsage | undefined
): SpawnUsage | undefined {
  if (!usage) {
    return total;
  }
  return {
    inputTokens: (total?.inputTokens ?? 0) + usage.inputTokens,
    outputTokens: (total?.outputTokens ?? 0) + usage.outputTokens,
    ...((total?.cachedTokens !== undefined || usage.cachedTokens !== undefined) && {
      cachedTokens: (total?.cachedTokens ?? 0) + (usage.cachedTokens ?? 0)
    }),
    ...((total?.costUsd !== undefined || usage.costUsd !== undefined) && {
      costUsd: (total?.costUsd ?? 0) + (usage.costUsd ?? 0)
    })
  };
}

async function requirePlan(fs: GaslightFileSystem, cwd: string, planPath: string): Promise<void> {
  const absolutePath = path.resolve(cwd, planPath);
  try {
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      throw new Error("not a file");
    }
  } catch (error) {
    throw new Error(`Plan file not found: ${planPath}`, { cause: error });
  }
}

async function rejectArchiveSymlink(
  fs: GaslightArchiveFileSystem,
  archiveDir: string
): Promise<void> {
  if (!fs.lstat) {
    return;
  }
  try {
    const stats = await fs.lstat(archiveDir);
    if (stats.isSymbolicLink()) {
      throw new Error(`Archive directory cannot be a symbolic link: ${archiveDir}`);
    }
  } catch (error) {
    if (isMissingFile(error)) {
      return;
    }
    throw error;
  }
}

async function archivePlan(
  fs: GaslightArchiveFileSystem,
  cwd: string,
  planPath: string
): Promise<string> {
  if (!fs.rename) {
    throw new Error("Gaslight plan archiving requires a filesystem with rename support.");
  }

  const absolutePath = path.resolve(cwd, planPath);
  const archiveDir = path.join(path.dirname(absolutePath), "archive");
  const archivedPath = path.join(archiveDir, path.basename(absolutePath));

  try {
    await fs.readFile(archivedPath, "utf8");
    throw new Error(`Archive destination already exists: ${archivedPath}`);
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }

  await rejectArchiveSymlink(fs, archiveDir);
  const createdDirectory = await fs.mkdir(archiveDir, { recursive: true });
  try {
    await rejectArchiveSymlink(fs, archiveDir);
    await fs.rename(absolutePath, archivedPath);
  } catch (error) {
    if (createdDirectory !== undefined && fs.rmdir) {
      try {
        await fs.rmdir(archiveDir);
      } catch {
        // Best-effort cleanup only; preserve the original archive failure.
      }
    }
    throw error;
  }

  return archivedPath;
}

function validateInlineConfig(prompt: string | undefined, followups: string[] | undefined): void {
  if ((prompt === undefined) !== (followups === undefined)) {
    throw new Error("prompt and followups must be provided together.");
  }
  if (prompt !== undefined && prompt.trim().length === 0) {
    throw new Error("prompt must be a non-empty string.");
  }
  if (
    followups !== undefined &&
    (followups.length === 0 || followups.some((followup) => followup.trim().length === 0))
  ) {
    throw new Error("followups must be a non-empty array of non-empty strings.");
  }
}

function resolvePlanPaths(options: GaslightOptions): string[] {
  if (options.planPaths.length === 0) {
    throw new Error("Provide at least one plan path.");
  }
  for (const planPath of options.planPaths) {
    if (planPath.trim().length === 0) {
      throw new Error("plan paths must be non-empty strings.");
    }
  }
  return options.planPaths.map((planPath) => planPath.trim());
}

export async function runGaslight(options: GaslightOptions): Promise<GaslightResult> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const fs = (options.fs ?? nodeFs) as GaslightArchiveFileSystem;
  const spawn = options.spawn ?? defaultSpawn;
  validateInlineConfig(options.prompt, options.followups);
  const planPaths = resolvePlanPaths(options);
  for (const planPath of planPaths) {
    await requirePlan(fs, cwd, planPath);
  }

  const config =
    options.prompt !== undefined && options.followups !== undefined
      ? { prompt: options.prompt.trim(), followups: options.followups.map((value) => value.trim()) }
      : await loadGaslightConfig(cwd, homeDir, fs, options.configPath);
  const rounds: GaslightRound[] = [];
  const plans: GaslightPlanResult[] = [];
  let usage: SpawnUsage | undefined;

  for (const [planIndex, planPath] of planPaths.entries()) {
    const prompts = [`${config.prompt} ${planPath}`, ...config.followups];
    const planRounds: GaslightRound[] = [];
    let planUsage: SpawnUsage | undefined;
    let resumeThreadId: string | undefined;

    for (const [index, prompt] of prompts.entries()) {
      const round = index + 1;
      options.onEvent?.({
        type: "round.started",
        round,
        total: prompts.length,
        prompt,
        planPath,
        planIndex: planIndex + 1,
        totalPlans: planPaths.length
      });
      const result = await spawn(options.agent, {
        prompt,
        cwd,
        mode: options.mode ?? "edit",
        ...(options.model ? { model: options.model } : {}),
        ...(resumeThreadId ? { resumeThreadId } : {}),
        ...(options.signal ? { signal: options.signal } : {})
      });

      if (result.exitCode !== 0) {
        const completed = planRounds.length;
        const noun = completed === 1 ? "round" : "rounds";
        const prefix =
          planPaths.length === 1
            ? `Gaslight round ${round}`
            : `Gaslight plan ${planIndex + 1}/${planPaths.length} (${planPath}) round ${round}`;
        throw new Error(
          `${prefix} failed after ${completed} completed ${noun}: ${summarize(result.stderr, result.stdout) || `exit code ${result.exitCode}`}`
        );
      }

      const summary = summarize(result.stdout, result.stderr);
      const gaslightRound = {
        prompt,
        summary,
        ...(result.threadId ? { threadId: result.threadId } : {})
      };
      planRounds.push(gaslightRound);
      rounds.push(gaslightRound);
      planUsage = addUsage(planUsage, result.usage);
      usage = addUsage(usage, result.usage);
      options.onEvent?.({
        type: "round.finished",
        round,
        total: prompts.length,
        summary,
        planPath,
        planIndex: planIndex + 1,
        totalPlans: planPaths.length
      });

      if (round < prompts.length) {
        if (!result.threadId) {
          throw new Error("agent returned no threadId; cannot resume the conversation");
        }
        resumeThreadId = result.threadId;
      }
    }

    const archivedPath = await archivePlan(fs, cwd, planPath);
    plans.push({
      planPath,
      archivedPath,
      rounds: planRounds,
      ...(planUsage ? { usage: planUsage } : {})
    });
  }

  return { rounds, plans, ...(usage ? { usage } : {}) };
}
