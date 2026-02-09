import path from "node:path";
import type { Stats } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { isCancel, select } from "@poe-code/design-system";
import { isNotFound } from "@poe-code/config-mutations";
import { parsePlan } from "./parser.js";

export type PlanResolverFileSystem = {
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<Stats>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
};

type PlanCandidate = {
  path: string;
  done: number;
  total: number;
};

export type ResolvePlanPathOptions = {
  /**
   * Working directory used to resolve relative paths and locate `.agents/tasks/`.
   */
  cwd: string;
  /**
   * Explicit plan path (e.g. from `--plan`). When provided, no discovery/prompting
   * is performed.
   */
  plan?: string;
  /**
   * Optional fs adapter for testing.
   */
  fs?: PlanResolverFileSystem;
};


function isPlanCandidateFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (!lower.startsWith("plan")) {
    return false;
  }
  const ext = path.extname(lower);
  return ext === ".yml" || ext === ".yaml";
}

async function listPlanCandidates(
  fs: PlanResolverFileSystem,
  cwd: string
): Promise<PlanCandidate[]> {
  const tasksDir = path.join(cwd, ".agents", "tasks");
  let entries: string[];
  try {
    entries = await fs.readdir(tasksDir);
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

    const absPath = path.join(tasksDir, entry);
    const stats = await fs.stat(absPath);
    if (!stats.isFile()) {
      continue;
    }

    const relativePath = path.relative(cwd, absPath);
    const content = await fs.readFile(absPath, "utf8");
    const plan = parsePlan(content);
    const done = plan.stories.filter((s) => s.status === "done").length;
    const total = plan.stories.length;

    candidates.push({ path: relativePath, done, total });
  }

  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return candidates;
}

export async function resolvePlanPath(
  options: ResolvePlanPathOptions
): Promise<string | null> {
  const fs = options.fs ?? {
    readdir: fsPromises.readdir,
    stat: fsPromises.stat,
    readFile: fsPromises.readFile
  } as PlanResolverFileSystem;
  const cwd = options.cwd;

  const provided = options.plan?.trim();
  if (provided) {
    const absPath = path.isAbsolute(provided)
      ? provided
      : path.resolve(cwd, provided);
    try {
      const stats = await fs.stat(absPath);
      if (!stats.isFile()) {
        throw new Error(
          `Plan not found at "${provided}". Provide --plan <path> to an existing plan file.`
        );
      }
    } catch (error) {
      if (isNotFound(error)) {
        throw new Error(
          `Plan not found at "${provided}". Provide --plan <path> to an existing plan file.`
        );
      }
      throw error;
    }
    return provided;
  }

  const candidates = await listPlanCandidates(fs, cwd);
  if (candidates.length === 0) {
    console.log(
      "No plans found under .agents/tasks/. Provide --plan <path> to an existing plan file."
    );
    return null;
  }

  const selection = await select({
    message: "Select a plan file to use for this Ralph run",
    options: candidates.map((candidate) => ({
      label: `${candidate.path} (${candidate.done}/${candidate.total})`,
      value: candidate.path
    }))
  });

  if (isCancel(selection)) {
    return null;
  }
  if (typeof selection !== "string" || selection.trim().length === 0) {
    return null;
  }
  return selection;
}
