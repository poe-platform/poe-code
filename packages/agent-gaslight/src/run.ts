import { promises as nodeFs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn as defaultSpawn, type SpawnUsage } from "@poe-code/agent-spawn";
import { loadGaslightConfig } from "./config.js";
import type {
  GaslightFileSystem,
  GaslightOptions,
  GaslightResult,
  GaslightRound
} from "./types.js";

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

export async function runGaslight(options: GaslightOptions): Promise<GaslightResult> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const fs = options.fs ?? nodeFs;
  const spawn = options.spawn ?? defaultSpawn;
  validateInlineConfig(options.prompt, options.followups);
  await requirePlan(fs, cwd, options.planPath);

  const config =
    options.prompt !== undefined && options.followups !== undefined
      ? { prompt: options.prompt.trim(), followups: options.followups.map((value) => value.trim()) }
      : await loadGaslightConfig(cwd, homeDir, fs, options.configPath);
  const prompts = [`${config.prompt} ${options.planPath}`, ...config.followups];
  const rounds: GaslightRound[] = [];
  let usage: SpawnUsage | undefined;
  let resumeThreadId: string | undefined;

  for (const [index, prompt] of prompts.entries()) {
    const round = index + 1;
    options.onEvent?.({ type: "round.started", round, total: prompts.length, prompt });
    const result = await spawn(options.agent, {
      prompt,
      cwd,
      mode: options.mode ?? "edit",
      ...(options.model ? { model: options.model } : {}),
      ...(resumeThreadId ? { resumeThreadId } : {}),
      ...(options.signal ? { signal: options.signal } : {})
    });

    if (result.exitCode !== 0) {
      const completed = rounds.length;
      const noun = completed === 1 ? "round" : "rounds";
      throw new Error(
        `Gaslight round ${round} failed after ${completed} completed ${noun}: ${summarize(result.stderr, result.stdout) || `exit code ${result.exitCode}`}`
      );
    }

    const summary = summarize(result.stdout, result.stderr);
    rounds.push({ prompt, summary, ...(result.threadId ? { threadId: result.threadId } : {}) });
    usage = addUsage(usage, result.usage);
    options.onEvent?.({ type: "round.finished", round, total: prompts.length, summary });

    if (round < prompts.length) {
      if (!result.threadId) {
        throw new Error("agent returned no threadId; cannot resume the conversation");
      }
      resumeThreadId = result.threadId;
    }
  }

  return { rounds, ...(usage ? { usage } : {}) };
}
