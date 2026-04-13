import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { loadPipelineConfig } from "../config/loader.js";
import { parsePlan } from "./parser.js";
import type { PipelineFileStat, PipelineFileSystem } from "../types.js";
import { isNotFound } from "../utils.js";

type DiscoveryFs = Pick<PipelineFileSystem, "readFile" | "readdir" | "stat">;

type PlanCandidate = {
  path: string;
  done: number;
  total: number;
};

function createDefaultFs(): DiscoveryFs {
  return {
    readFile: fsPromises.readFile as DiscoveryFs["readFile"],
    readdir: fsPromises.readdir,
    stat: async (filePath: string) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: stat.mtimeMs
      } satisfies PipelineFileStat;
    }
  };
}

function isPlanCandidateFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith("plan") &&
    (lower.endsWith(".yaml") || lower.endsWith(".yml"))
  );
}

function countCompletedTasks(planPath: string, content: string): PlanCandidate {
  const plan = parsePlan(content);
  const total = plan.tasks.length;
  const done = plan.tasks.filter((task) => {
    if (typeof task.status === "string") {
      return task.status === "done";
    }
    return Object.values(task.status).every((status) => status === "done");
  }).length;

  return {
    path: planPath,
    done,
    total
  };
}

async function ensurePlanExists(
  fs: DiscoveryFs,
  cwd: string,
  planPath: string
): Promise<void> {
  const absolutePath = path.isAbsolute(planPath)
    ? planPath
    : path.resolve(cwd, planPath);

  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`Plan not found at "${planPath}".`);
    }
  } catch (error) {
    if (isNotFound(error)) {
      throw new Error(`Plan not found at "${planPath}".`);
    }
    throw error;
  }
}

async function scanPlansDir(
  fs: DiscoveryFs,
  plansDir: string,
  displayPrefix: string
): Promise<PlanCandidate[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(plansDir);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }

  const candidates: PlanCandidate[] = [];
  for (const entry of entries) {
    if (!isPlanCandidateFile(entry)) {
      continue;
    }

    const absolutePath = path.join(plansDir, entry);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      continue;
    }

    const displayPath = path.join(displayPrefix, entry);
    const content = await fs.readFile(absolutePath, "utf8");
    candidates.push(countCompletedTasks(displayPath, content));
  }

  return candidates;
}

async function listPlanCandidates(
  fs: DiscoveryFs,
  cwd: string,
  homeDir: string,
  planDirectory?: string
): Promise<PlanCandidate[]> {
  const customDir = planDirectory?.trim();
  const candidates = customDir
    ? await scanCustomPlanDir(fs, customDir, cwd, homeDir)
    : await scanDefaultPlanDirs(fs, cwd, homeDir);

  candidates.sort((left, right) => left.path.localeCompare(right.path));
  return candidates;
}

async function scanCustomPlanDir(
  fs: DiscoveryFs,
  planDirectory: string,
  cwd: string,
  homeDir: string
): Promise<PlanCandidate[]> {
  const absoluteDir = resolveAbsoluteDirectory(planDirectory, cwd, homeDir);
  return scanPlansDir(fs, absoluteDir, planDirectory);
}

async function scanDefaultPlanDirs(
  fs: DiscoveryFs,
  cwd: string,
  homeDir: string
): Promise<PlanCandidate[]> {
  const projectDir = path.join(cwd, ".poe-code", "pipeline", "plans");
  const globalDir = path.join(homeDir, ".poe-code", "pipeline", "plans");

  const [projectCandidates, globalCandidates] = await Promise.all([
    scanPlansDir(fs, projectDir, ".poe-code/pipeline/plans"),
    scanPlansDir(fs, globalDir, "~/.poe-code/pipeline/plans")
  ]);

  return [...projectCandidates, ...globalCandidates];
}

function resolveAbsoluteDirectory(dir: string, cwd: string, homeDir: string): string {
  if (dir.startsWith("~/")) {
    return path.join(homeDir, dir.slice(2));
  }
  return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
}

export async function resolvePlanDirectory(options: {
  cwd: string;
  homeDir: string;
  planDirectory?: string;
  fs?: { stat(path: string): Promise<{ isDirectory(): boolean }> };
}): Promise<string> {
  const customDir = options.planDirectory?.trim();
  if (customDir) {
    return resolveAbsoluteDirectory(customDir, options.cwd, options.homeDir);
  }

  const fs = options.fs ?? createDefaultFs();
  const projectDir = path.join(options.cwd, ".poe-code");
  try {
    const stat = await fs.stat(projectDir);
    if (stat.isDirectory()) {
      return path.join(options.cwd, ".poe-code", "pipeline", "plans");
    }
  } catch {
    // project config dir does not exist
  }

  return path.join(options.homeDir, ".poe-code", "pipeline", "plans");
}

export function resolveAbsolutePlanPath(
  planPath: string,
  cwd: string,
  homeDir: string
): string {
  if (planPath.startsWith("~/")) {
    return path.join(homeDir, planPath.slice(2));
  }
  return path.isAbsolute(planPath) ? planPath : path.resolve(cwd, planPath);
}

export async function resolvePlanPath(options: {
  cwd: string;
  homeDir: string;
  plan?: string;
  plans?: string[];
  planDirectory?: string;
  assumeYes?: boolean;
  fs?: DiscoveryFs;
  selectPlan?: (input: {
    message: string;
    options: Array<{ label: string; value: string }>;
  }) => Promise<string | null>;
  selectPlans?: (input: {
    message: string;
    options: Array<{ label: string; value: string }>;
    required: boolean;
  }) => Promise<string[] | null>;
  promptForPath?: (input: { message: string; placeholder: string }) => Promise<string | null>;
}): Promise<string | null> {
  const fs = options.fs ?? createDefaultFs();

  const planPaths = await resolvePlanPaths({
    ...options,
    fs
  });

  return planPaths?.[0] ?? null;
}

export async function resolvePlanPaths(options: {
  cwd: string;
  homeDir: string;
  plan?: string;
  plans?: string[];
  planDirectory?: string;
  assumeYes?: boolean;
  fs?: DiscoveryFs;
  selectPlan?: (input: {
    message: string;
    options: Array<{ label: string; value: string }>;
  }) => Promise<string | null>;
  selectPlans?: (input: {
    message: string;
    options: Array<{ label: string; value: string }>;
    required: boolean;
  }) => Promise<string[] | null>;
  promptForPath?: (input: { message: string; placeholder: string }) => Promise<string | null>;
}): Promise<string[] | null> {
  const fs = options.fs ?? createDefaultFs();

  const explicitPlans = [
    ...(options.plan ? [options.plan] : []),
    ...(options.plans ?? [])
  ].map((planPath) => planPath.trim()).filter((planPath) => planPath.length > 0);

  if (explicitPlans.length > 0) {
    for (const planPath of explicitPlans) {
      await ensurePlanExists(fs, options.cwd, planPath);
    }
    return explicitPlans;
  }

  const config = await loadPipelineConfig({
    cwd: options.cwd,
    homeDir: options.homeDir,
    fs
  });

  if (config.planPath) {
    await ensurePlanExists(fs, options.cwd, config.planPath);
    return [config.planPath];
  }

  const candidates = await listPlanCandidates(fs, options.cwd, options.homeDir, options.planDirectory);

  if (candidates.length >= 1) {
    if (options.assumeYes) {
      return [candidates[0]!.path];
    }
    if (options.selectPlans) {
      return options.selectPlans({
        message: "Select pipeline plans to run",
        options: candidates.map((candidate) => ({
          label: `${candidate.path} (${candidate.done}/${candidate.total})`,
          value: candidate.path
        })),
        required: true
      });
    }
    if (!options.selectPlan) {
      return null;
    }
    const selectedPlan = await options.selectPlan({
      message: "Select a pipeline plan to run",
      options: candidates.map((candidate) => ({
        label: `${candidate.path} (${candidate.done}/${candidate.total})`,
        value: candidate.path
      }))
    });
    return selectedPlan ? [selectedPlan] : null;
  }

  if (options.assumeYes) {
    throw new Error(
      "No plan found under .poe-code/pipeline/plans/ or ~/.poe-code/pipeline/plans/. Provide --plan <path> to an existing plan file."
    );
  }

  if (!options.promptForPath) {
    return null;
  }

  const selectedPath = await options.promptForPath({
    message: "Enter the pipeline plan path",
    placeholder: ".poe-code/pipeline/plans/plan.yaml"
  });
  return selectedPath ? [selectedPath] : null;
}
