import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { getYamlContent, parsePlan } from "./parser.js";
import type { PipelineFileStat, PipelineFileSystem } from "../types.js";
import { isNotFound, isRecord } from "../utils.js";

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

function isMarkdownFile(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

function isPipelinePlan(content: string): boolean {
  let parsed: unknown;
  try {
    parsed = parseYaml(getYamlContent(content));
  } catch {
    return false;
  }

  return isRecord(parsed) && parsed.kind === "pipeline";
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

async function ensurePlanExists(fs: DiscoveryFs, cwd: string, planPath: string): Promise<void> {
  const absolutePath = path.isAbsolute(planPath) ? planPath : path.resolve(cwd, planPath);

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
    if (!isMarkdownFile(entry)) {
      continue;
    }

    const absolutePath = path.join(plansDir, entry);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      continue;
    }

    const displayPath = path.join(displayPrefix, entry);
    const content = await fs.readFile(absolutePath, "utf8");
    if (!isPipelinePlan(content)) {
      continue;
    }
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
  const dir = planDirectory?.trim() || "docs/plans";
  const candidates = await scanCustomPlanDir(fs, dir, cwd, homeDir);
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

function resolveAbsoluteDirectory(dir: string, cwd: string, homeDir: string): string {
  if (dir.startsWith("~/")) {
    return path.join(homeDir, dir.slice(2));
  }
  return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
}

function describeDiscoveryDirectory(planDirectory?: string): string {
  const configured = planDirectory?.trim();
  return configured && configured.length > 0 ? configured : "docs/plans";
}

export function resolvePlanDirectory(options: {
  cwd: string;
  homeDir: string;
  planDirectory?: string;
}): string {
  const dir = options.planDirectory?.trim() || "docs/plans";
  return resolveAbsoluteDirectory(dir, options.cwd, options.homeDir);
}

export function resolveAbsolutePlanPath(planPath: string, cwd: string, homeDir: string): string {
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

  const explicitPlans = [...(options.plan ? [options.plan] : []), ...(options.plans ?? [])]
    .map((planPath) => planPath.trim())
    .filter((planPath) => planPath.length > 0);

  if (explicitPlans.length > 0) {
    for (const planPath of explicitPlans) {
      await ensurePlanExists(fs, options.cwd, planPath);
    }
    return explicitPlans;
  }

  const candidates = await listPlanCandidates(
    fs,
    options.cwd,
    options.homeDir,
    options.planDirectory
  );

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
    const directory = describeDiscoveryDirectory(options.planDirectory);
    throw new Error(
      `No plan found under ${directory}. Provide --plan <path> to an existing plan file.`
    );
  }

  if (!options.promptForPath) {
    return null;
  }

  const selectedPath = await options.promptForPath({
    message: "Enter the pipeline plan path",
    placeholder: path.join(describeDiscoveryDirectory(options.planDirectory), "plan.md")
  });
  return selectedPath ? [selectedPath] : null;
}
