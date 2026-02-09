import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { spawn as defaultSpawn } from "@poe-code/agent-spawn";
import { isNotFound } from "@poe-code/config-mutations";
import { renderPrompt } from "../prompt/renderer.js";

const PLAN_PROMPT_TEMPLATE = [
  "# Plan",
  "",
  "You are an agent that generates a Ralph plan file (YAML) based on a user request.",
  "",
  "## User Request",
  "{{REQUEST}}",
  "",
  "## Output Path",
  "Write the YAML file to:",
  "{{OUT_PATH}}",
  "",
  "## Requirements",
  "- Create (or overwrite) the file at the output path.",
  "- The file must be valid YAML.",
  "- Use this structure (minimum):",
  "  - version: 1",
  "  - project: <short name>",
  "  - overview: <1-3 paragraphs>",
  "  - goals: [ ... ]",
  "  - nonGoals: [ ... ]",
  "  - qualityGates:",
  "    - npm run test",
  "    - npm run lint",
  "  - stories: [ ... ]",
  "- Stories should be actionable, small, and testable.",
  "- Each story must include:",
  "  - id: \"US-###\" (sequential, starting at US-001)",
  "  - title",
  "  - status: open",
  "  - dependsOn: [] (or list of story IDs)",
  "  - description: \"As a user, I want ...\"",
  "  - acceptanceCriteria: [\"...\", \"...\"]",
  "",
  "## If The Request Is Empty",
  "Ask the user for a one-sentence description of what they want to build.",
  "",
  "## Done Signal",
  "After writing the file, print a single line confirming the path, e.g.:",
  "Wrote plan to {{OUT_PATH}}",
  ""
].join("\n");

type PlanFileSystem = {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(
    path: string,
    data: string,
    options?: { encoding?: BufferEncoding }
  ): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  stat(path: string): Promise<{ isFile(): boolean }>;
};

export type RalphPlanResult = {
  outPath: string;
};

type SpawnFn = (
  agentId: string,
  options: { prompt: string; cwd?: string }
) => Promise<{ exitCode: number }>;

export type RalphPlanOptions = {
  request: string;
  outPath?: string;
  agent?: string;
  cwd?: string;
  deps?: Partial<{
    fs: PlanFileSystem;
    spawn: SpawnFn;
  }>;
};

function toSlug(input: string): string {
  const value = input.trim().toLowerCase();
  let slug = "";
  let lastWasDash = false;

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    const code = ch.charCodeAt(0);
    const isLowerAlpha = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;

    if (isLowerAlpha || isDigit) {
      slug += ch;
      lastWasDash = false;
      continue;
    }

    if (!lastWasDash && slug.length > 0) {
      slug += "-";
      lastWasDash = true;
    }
  }

  if (slug.endsWith("-")) {
    slug = slug.slice(0, slug.length - 1);
  }

  if (slug.length === 0) {
    return "untitled";
  }

  const maxLen = 48;
  if (slug.length > maxLen) {
    slug = slug.slice(0, maxLen);
    if (slug.endsWith("-")) {
      slug = slug.slice(0, slug.length - 1);
    }
  }

  return slug;
}

function resolveDefaultOutPath(request: string): string {
  return path.join(".agents", "tasks", `plan-${toSlug(request)}.yaml`);
}

function resolveAbsolutePath(cwd: string, candidate: string): string {
  if (!candidate) return path.resolve(cwd);
  return path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
}

async function ensureFileExists(fs: PlanFileSystem, filePath: string): Promise<void> {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      throw new Error(`Expected a file at "${filePath}", but found a non-file entry.`);
    }
  } catch (error) {
    if (isNotFound(error)) {
      throw new Error(`Agent did not write the plan file to "${filePath}".`, { cause: error });
    }
    throw error;
  }
}

export async function ralphPlan(options: RalphPlanOptions): Promise<RalphPlanResult> {
  const fs = options.deps?.fs ?? (fsPromises as unknown as PlanFileSystem);
  const spawn = options.deps?.spawn ?? defaultSpawn;

  const cwd = options.cwd ?? process.cwd();
  const request = options.request ?? "";

  const outPath = options.outPath?.trim() ? options.outPath.trim() : resolveDefaultOutPath(request);
  const outAbsPath = resolveAbsolutePath(cwd, outPath);
  const outDir = path.dirname(outAbsPath);

  const prompt = renderPrompt(PLAN_PROMPT_TEMPLATE, {
    REQUEST: request,
    OUT_PATH: outAbsPath
  });

  await fs.mkdir(outDir, { recursive: true });

  const agent = options.agent?.trim() ? options.agent.trim() : "codex";
  const result = await spawn(agent, { prompt, cwd });
  if (result.exitCode !== 0) {
    throw new Error(`Agent failed with exit code ${result.exitCode}.`);
  }

  await ensureFileExists(fs, outAbsPath);
  const written = await fs.readFile(outAbsPath, "utf8");
  if (written.trim().length === 0) {
    throw new Error(`Agent wrote an empty plan file to "${outAbsPath}".`);
  }

  return { outPath };
}
