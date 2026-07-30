import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { discoverPlans, formatPlanReadinessLabel } from "@poe-code/agent-harness-tools";
import { UserError } from "@poe-code/user-error";
import { parsePlan } from "./parser.js";
import type { PipelineFileStat, PipelineFileSystem } from "../types.js";
import { isNotFound } from "../utils.js";

type DiscoveryFs = Pick<PipelineFileSystem, "readFile" | "readdir" | "stat">;

type PlanCandidate = {
  path: string;
  ready: boolean;
  done: number;
  total: number;
};

type DiscoverPlansFs = NonNullable<Parameters<typeof discoverPlans>[0]["fs"]>;

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

function countCompletedTasks(planPath: string, content: string, ready = false): PlanCandidate {
  const plan = parsePlan(content);
  const total = plan.tasks.length;
  const done = plan.tasks.filter((task) => {
    if (typeof task.status === "string") {
      return task.status === "done";
    }
    const statuses = Object.values(task.status);
    return statuses.length > 0 && statuses.every((status) => status === "done");
  }).length;

  return {
    path: planPath,
    ready,
    done,
    total
  };
}

async function ensurePlanExists(
  fs: DiscoveryFs,
  cwd: string,
  homeDir: string,
  planPath: string
): Promise<void> {
  const absolutePath = resolveAbsolutePlanPath(planPath, cwd, homeDir);
  const stat = await fs.stat(absolutePath).catch((error: unknown) => {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  });

  if (stat === undefined || !stat.isFile()) {
    throw new UserError(
      `Plan not found at "${planPath}".\nPass --plan <path> to an existing plan file, or run "poe-code pipeline show-plan-path" to see where plans are discovered.`
    );
  }
}

async function listPlanCandidates(
  fs: DiscoveryFs,
  cwd: string,
  homeDir: string,
  planDirectory?: string
): Promise<PlanCandidate[]> {
  const dir = planDirectory?.trim() || "docs/plans";
  const plans = await discoverPlans({
    cwd,
    homeDir,
    planDirectory: dir,
    kinds: ["pipeline"],
    fs: fs as DiscoverPlansFs
  });
  const candidates = await Promise.all(
    plans.map(async (plan) => {
      const content = await fs.readFile(plan.absolutePath, "utf8");
      return countCompletedTasks(plan.displayPath, content, plan.readiness === "ready");
    })
  );
  return candidates;
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
      await ensurePlanExists(fs, options.cwd, options.homeDir, planPath);
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
      throw new Error(
        [
          "Provide --plan <path> to an existing plan file: --yes never picks a plan for you.",
          "",
          "Plans:",
          ...candidates.map(
            (candidate) => `- ${candidate.path} (${candidate.done}/${candidate.total})`
          )
        ].join("\n")
      );
    }
    if (options.selectPlans) {
      return options.selectPlans({
        message: "Select pipeline plans to run",
        options: candidates.map((candidate) => ({
          label: `${formatPlanReadinessLabel(
            candidate.path,
            candidate.ready ? "ready" : "draft"
          )} (${candidate.done}/${candidate.total})`,
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
        label: `${formatPlanReadinessLabel(
          candidate.path,
          candidate.ready ? "ready" : "draft"
        )} (${candidate.done}/${candidate.total})`,
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
