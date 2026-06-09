import nodeFs from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import { validateEvalYaml } from "../schema.js";
import { hasOwnErrorCode } from "../error-codes.js";
import { assertFsCanonicalContainedPath } from "../path-boundary.js";
import type { EvalDef, EvalFs, EvalSource, PlanKind } from "../types.js";

const allowedPlanKinds = ["plan", "pipeline", "superintendent", "experiment"] as const;

export async function listEvals(source: EvalSource): Promise<readonly string[]>;
export async function listEvals(source: EvalSource, fs: EvalFs): Promise<readonly string[]>;
export async function listEvals(
  source: EvalSource,
  fs: EvalFs = nodeFs as unknown as EvalFs
): Promise<readonly string[]> {
  const entries = await fs.readdir(source.rootDir, { withFileTypes: true });
  const evalIds: string[] = [];

  for (const entry of entries) {
    const name = typeof entry === "string" ? entry : entry.name;
    const entryPath = join(source.rootDir, name);

    if (typeof entry === "string") {
      const stat = await fs.stat(entryPath);
      if (!stat.isDirectory()) {
        continue;
      }
    } else if (!entry.isDirectory()) {
      continue;
    }

    if (await isFile(join(entryPath, "eval.yaml"), fs)) {
      evalIds.push(name);
    }
  }

  return evalIds.sort((left, right) => left.localeCompare(right));
}

export async function loadEval(source: EvalSource, id: string): Promise<EvalDef>;
export async function loadEval(source: EvalSource, id: string, fs: EvalFs): Promise<EvalDef>;
export async function loadEval(
  source: EvalSource,
  id: string,
  fs: EvalFs = nodeFs as unknown as EvalFs
): Promise<EvalDef> {
  assertSafeEvalId(id);

  const evalDir = join(source.rootDir, id);
  const evalYamlPath = join(evalDir, "eval.yaml");
  const planPath = join(evalDir, "plan.md");
  await assertFsCanonicalContainedPath(fs, source.rootDir, evalYamlPath, "eval.yaml");
  await assertFsCanonicalContainedPath(fs, source.rootDir, planPath, "plan.md");
  const evalYaml = validateEvalYaml(
    parseYamlFile(await fs.readFile(evalYamlPath, "utf8"), evalYamlPath),
    evalYamlPath
  );
  const plan = parsePlanMarkdown(await fs.readFile(planPath, "utf8"), planPath);

  return {
    id: evalYaml.id,
    title: evalYaml.title,
    rootDir: evalDir,
    target: {
      repo: evalYaml.target.repo,
      ref: evalYaml.target.ref,
      planDest: evalYaml.target.plan_dest ?? "docs/plans/eval-task.md"
    },
    scorer:
      evalYaml.scorer === undefined
        ? undefined
        : {
            command: evalYaml.scorer.command,
            cwd: evalYaml.scorer.cwd ?? "",
            resultPath: evalYaml.scorer.result_path,
            timeoutMs: evalYaml.scorer.timeout_ms
          },
    oracle: {
      path: evalYaml.oracle.path ?? "oracle",
      solutionDest: evalYaml.oracle.solution_dest ?? "."
    },
    budget: {
      maxIterations: evalYaml.budget.max_iterations,
      maxTokens: evalYaml.budget.max_tokens,
      wallClockMs: evalYaml.budget.wall_clock_ms
    },
    judge: {
      agent: evalYaml.judge.agent,
      model: evalYaml.judge.model,
      rubric: evalYaml.judge.rubric
    },
    weights: {
      tests: evalYaml.weights.tests,
      judge: evalYaml.weights.judge
    },
    ...(evalYaml.metrics === undefined
      ? {}
      : {
          metrics: evalYaml.metrics.map((metric) => ({
            id: metric.id,
            enabled: metric.enabled ?? true,
            required: metric.required ?? false,
            weight: metric.weight ?? 1,
            threshold: metric.threshold ?? 0.8,
            evaluator: metric.evaluator
          }))
        }),
    ...(evalYaml.verify === undefined
      ? {}
      : {
          verify: {
            command: evalYaml.verify.command,
            timeoutMs: evalYaml.verify.timeout_ms
          }
        }),
    plan
  };
}

async function isFile(path: string, fs: EvalFs): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return typeof stat.isFile === "function" ? stat.isFile() : !stat.isDirectory();
  } catch (error) {
    if (isMissingPath(error)) {
      return false;
    }
    throw error;
  }
}

function parseYamlFile(content: string, filePath: string): unknown {
  try {
    return parseYaml(content);
  } catch (error) {
    throw new Error(`Failed to parse ${filePath}: ${getErrorMessage(error)}`);
  }
}

function parsePlanMarkdown(content: string, filePath: string): EvalDef["plan"] {
  const normalized = stripBom(content);
  const frontmatter = readFrontmatter(normalized, filePath);
  const rawKind = frontmatter.data.kind;

  if (!isPlanKind(rawKind)) {
    const received = rawKind === undefined ? "missing" : JSON.stringify(rawKind);
    throw new Error(
      `Unsupported plan kind ${received} in ${filePath}. Expected one of: ${allowedPlanKinds.join(
        ", "
      )}.`
    );
  }

  return {
    path: filePath,
    kind: rawKind,
    body: frontmatter.body,
    frontmatter: frontmatter.data
  };
}

function readFrontmatter(
  content: string,
  filePath: string
): { data: Record<string, unknown>; body: string } {
  const lineBreak = content.startsWith("---\r\n") ? "\r\n" : "\n";

  if (!content.startsWith(`---${lineBreak}`)) {
    return { data: {}, body: content };
  }

  const afterOpening = content.slice(3 + lineBreak.length);
  const lines = afterOpening.split(lineBreak);
  const closingIndex = lines.findIndex((line) => line === "---");

  if (closingIndex === -1) {
    return { data: {}, body: content };
  }

  const yamlContent = lines.slice(0, closingIndex).join(lineBreak);
  const body = lines.slice(closingIndex + 1).join(lineBreak);
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlContent);
  } catch (error) {
    throw new Error(`Failed to parse ${filePath} frontmatter: ${getErrorMessage(error)}`);
  }

  if (parsed === null || parsed === undefined) {
    return { data: {}, body };
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return { data: {}, body };
  }

  return { data: { ...(parsed as Record<string, unknown>) }, body };
}

function isPlanKind(value: unknown): value is PlanKind {
  return allowedPlanKinds.includes(value as PlanKind);
}

function stripBom(content: string): string {
  return content.startsWith("\uFEFF") ? content.slice(1) : content;
}

export function assertSafeEvalId(id: string): void {
  if (id === "" || id === "." || id === ".." || id.includes("/") || id.includes("\\")) {
    throw new Error(`Invalid eval id "${id}". Eval ids must be first-level directory names.`);
  }
}

function isMissingPath(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
