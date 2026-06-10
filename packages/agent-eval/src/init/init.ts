import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { hasOwnErrorCode } from "../error-codes.js";
import type { PlanKind } from "../types.js";

export interface InitOptions {
  sourceDir: string;
  name: string;
  kind: PlanKind;
  targetRepo?: string;
  targetRef?: string;
}

export interface InitResult {
  evalDir: string;
  files: readonly string[];
}

const defaultTargetRepo = "git+https://github.com/poe-platform/poe-code.git";
const defaultTargetRef = "main";
const initFiles = [
  "eval.yaml",
  "plan.md",
  "oracle/tests/example.test.ts",
  "oracle/solution/OUTPUT.md",
  "starter/.gitkeep"
] as const;
const invalidNameMessage =
  "Eval name must be kebab-case: lowercase letters, digits, and dashes; start with a letter.";

export async function evalInit(opts: InitOptions): Promise<InitResult> {
  validateInitName(opts.name);

  if (!path.isAbsolute(opts.sourceDir)) {
    throw new Error("sourceDir must be absolute.");
  }

  await assertSafeSourceDirectory(opts.sourceDir);

  const evalDir = path.join(opts.sourceDir, opts.name);

  try {
    await mkdir(evalDir);
  } catch (error) {
    if (isPathAlreadyPresent(error)) {
      throw new Error(`Eval folder already exists: ${evalDir}`);
    }
    throw error;
  }

  try {
    await mkdir(path.join(evalDir, "oracle", "tests"), { recursive: true });
    await mkdir(path.join(evalDir, "oracle", "solution"), { recursive: true });
    await mkdir(path.join(evalDir, "starter"), { recursive: true });
    const writes = await Promise.allSettled([
      writeNewFile(path.join(evalDir, "eval.yaml"), renderEvalYaml(opts)),
      writeNewFile(path.join(evalDir, "plan.md"), renderPlanMarkdown(opts.kind)),
      writeNewFile(path.join(evalDir, "oracle", "tests", "example.test.ts"), renderExampleTest()),
      writeNewFile(path.join(evalDir, "oracle", "solution", "OUTPUT.md"), "ok\n"),
      writeNewFile(path.join(evalDir, "starter", ".gitkeep"), "")
    ]);
    const failedWrite = writes.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failedWrite !== undefined) {
      throw failedWrite.reason;
    }
  } catch (error) {
    await rm(evalDir, { recursive: true, force: true });
    throw error;
  }

  return {
    evalDir,
    files: initFiles
  };
}

async function writeNewFile(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
}

async function assertSafeSourceDirectory(sourceDir: string): Promise<void> {
  try {
    const sourceStat = await lstat(sourceDir);
    if (sourceStat.isSymbolicLink()) {
      throw new Error("Eval source directory must not be a symbolic link.");
    }
  } catch (error) {
    if (!isMissingPath(error)) {
      throw error;
    }
  }
}

export function validateInitName(name: string): void {
  if (!isValidInitName(name)) {
    throw new Error(invalidNameMessage);
  }
}

function renderEvalYaml(opts: InitOptions): string {
  return stringifyYaml(
    {
      id: opts.name,
      title: titleFromName(opts.name),
      target: {
        repo: opts.targetRepo ?? defaultTargetRepo,
        ref: opts.targetRef ?? defaultTargetRef,
        plan_dest: "docs/plans/eval-task.md"
      },
      oracle: {
        path: "oracle"
      },
      budget: {
        max_iterations: 60,
        max_tokens: 400000,
        wall_clock_ms: 600000
      },
      judge: {
        agent: "claude-code",
        model: "anthropic/claude-opus-4.7",
        rubric: ["completeness", "spec_adherence", "code_quality"]
      },
      weights: {
        tests: 1,
        judge: 0
      },
      metrics: [
        {
          id: "task_completion",
          enabled: true,
          required: true,
          weight: 1,
          threshold: 1,
          evaluator: { kind: "deterministic" }
        },
        {
          id: "plan_adherence",
          enabled: true,
          required: false,
          weight: 1,
          threshold: 0.8,
          evaluator: { kind: "judge" }
        },
        {
          id: "tool_correctness",
          enabled: true,
          required: false,
          weight: 1,
          threshold: 0.8,
          evaluator: { kind: "deterministic" }
        },
        {
          id: "step_efficiency",
          enabled: true,
          required: false,
          weight: 1,
          threshold: 0.8,
          evaluator: { kind: "deterministic", config: { max_steps: 60 } }
        }
      ]
    },
    { lineWidth: 0 }
  );
}

function renderPlanMarkdown(kind: PlanKind): string {
  return [
    "---",
    stringifyYaml({ kind, version: 1 }, { lineWidth: 0 }).trimEnd(),
    "---",
    "Replace this with the task prompt the agent will see.",
    ""
  ].join("\n");
}

function renderExampleTest(): string {
  return [
    'import { describe, expect, it } from "vitest";',
    'import { readFileSync, existsSync } from "node:fs";',
    'import { join } from "node:path";',
    "",
    "const CLONE_DIR = process.env.CLONE_DIR!;",
    "const ORACLE_DIR = process.env.ORACLE_DIR!;",
    "",
    'describe("example", () => {',
    '  it("agent created the expected file", () => {',
    '    const path = join(CLONE_DIR, "OUTPUT.md");',
    "    expect(existsSync(path)).toBe(true);",
    "  });",
    "});",
    ""
  ].join("\n");
}

function titleFromName(name: string): string {
  return name
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isValidInitName(name: string): boolean {
  if (name.length === 0 || !isLowercaseLetter(name.charCodeAt(0))) {
    return false;
  }

  let previousWasDash = false;
  for (let index = 1; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    if (code === 45) {
      if (previousWasDash) {
        return false;
      }
      previousWasDash = true;
      continue;
    }

    if (!isLowercaseLetter(code) && !isDigit(code)) {
      return false;
    }
    previousWasDash = false;
  }

  return !previousWasDash;
}

function isLowercaseLetter(code: number): boolean {
  return code >= 97 && code <= 122;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isPathAlreadyPresent(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST") || hasOwnErrorCode(error, "ENOTEMPTY");
}

function isMissingPath(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR");
}
