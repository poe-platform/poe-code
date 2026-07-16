import { promises as nodeFs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn as defaultSpawn, type SpawnUsage } from "@poe-code/agent-spawn";
import { archivePlan as archivePlanShared } from "@poe-code/agent-harness-tools";
import { UserError } from "@poe-code/user-error";
import { loadGaslightConfig } from "./config.js";
import type {
  GaslightFileSystem,
  GaslightOptions,
  GaslightPlanResult,
  GaslightResult,
  GaslightRound
} from "./types.js";

type ArchivePlanFs = NonNullable<Parameters<typeof archivePlanShared>[0]["fs"]>;

function summarize(stdout: string, stderr: string): string {
  return stdout.trim() || stderr.trim();
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

async function requirePlan(
  fs: GaslightFileSystem,
  absolutePath: string,
  planPath: string
): Promise<void> {
  try {
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      throw new Error("not a file");
    }
  } catch (error) {
    throw new UserError(`Plan file not found: ${planPath}`, { cause: error });
  }
}

function resolvePlanPath(cwd: string, homeDir: string, planPath: string): string {
  if (planPath.startsWith("~/")) {
    return path.join(homeDir, planPath.slice(2));
  }
  return path.resolve(cwd, planPath);
}

function planIdFromPath(planPath: string): string {
  const stem = path.basename(planPath, ".md");
  let index = 0;
  while (index < stem.length && stem.charCodeAt(index) >= 48 && stem.charCodeAt(index) <= 57) {
    index += 1;
  }

  if (index > 0 && stem[index] === "-" && index < stem.length - 1) {
    return stem.slice(index + 1);
  }

  return stem;
}

function archivedPlanPath(planPath: string): string {
  return path.join(path.dirname(planPath), "archive", `${planIdFromPath(planPath)}.md`);
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

function requireNonEmptyString(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return trimmed;
}

function resolveModel(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("model must be a non-empty string when provided.");
  }
  return trimmed;
}

function resolveOptionalPrompt(value: string | undefined, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireNonEmptyString(value, label);
}

function resolvePlanPaths(options: GaslightOptions, cwd: string, homeDir: string): string[] {
  if (options.planPaths.length === 0) {
    throw new Error("Provide at least one plan path.");
  }
  for (const planPath of options.planPaths) {
    if (planPath.trim().length === 0) {
      throw new Error("plan paths must be non-empty strings.");
    }
  }
  const planPaths = options.planPaths.map((planPath) => planPath.trim());
  const seen = new Map<string, string>();
  for (const planPath of planPaths) {
    const resolvedPath = resolvePlanPath(cwd, homeDir, planPath);
    const duplicate = seen.get(resolvedPath);
    if (duplicate !== undefined) {
      throw new Error(`Duplicate plan path: ${duplicate}`);
    }
    seen.set(resolvedPath, planPath);
  }
  return planPaths;
}

export async function runGaslight(options: GaslightOptions): Promise<GaslightResult> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const fs = options.fs ?? nodeFs;
  const spawn = options.spawn ?? defaultSpawn;
  const agent = requireNonEmptyString(options.agent, "agent");
  const model = resolveModel(options.model);
  const inlineSetup = resolveOptionalPrompt(options.setup, "setup");
  const inlineTeardown = resolveOptionalPrompt(options.teardown, "teardown");
  validateInlineConfig(options.prompt, options.followups);
  const planPaths = resolvePlanPaths(options, cwd, homeDir);
  for (const planPath of planPaths) {
    await requirePlan(fs, resolvePlanPath(cwd, homeDir, planPath), planPath);
  }

  const config: {
    setup?: string;
    prompt: string;
    followups: string[];
    teardown?: string;
    archive?: boolean;
  } =
    options.prompt !== undefined && options.followups !== undefined
      ? {
          ...(inlineSetup ? { setup: inlineSetup } : {}),
          prompt: options.prompt.trim(),
          followups: options.followups.map((value) => value.trim()),
          ...(inlineTeardown ? { teardown: inlineTeardown } : {})
        }
      : await loadGaslightConfig(cwd, homeDir, fs, options.configPath);
  const shouldArchive = options.archive ?? config.archive ?? false;
  const rounds: GaslightRound[] = [];
  const plans: GaslightPlanResult[] = [];
  let usage: SpawnUsage | undefined;

  for (const [planIndex, planPath] of planPaths.entries()) {
    const prompts = [
      ...(config.setup ? [config.setup] : []),
      `${config.prompt} ${planPath}`,
      ...config.followups,
      ...(config.teardown ? [config.teardown] : [])
    ];
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
      const result = await spawn(agent, {
        prompt,
        cwd,
        mode: options.mode ?? "auto",
        ...(model ? { model } : {}),
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

    let archivedPath: string | undefined;
    if (shouldArchive) {
      const id = planIdFromPath(planPath);
      await archivePlanShared({
        cwd,
        homeDir,
        planDirectory: path.dirname(planPath),
        id,
        fs: fs as unknown as ArchivePlanFs
      });
      archivedPath = archivedPlanPath(planPath);
    }

    plans.push({
      planPath,
      ...(archivedPath ? { archivedPath } : {}),
      rounds: planRounds,
      ...(planUsage ? { usage: planUsage } : {})
    });
  }

  return { rounds, plans, ...(usage ? { usage } : {}) };
}
