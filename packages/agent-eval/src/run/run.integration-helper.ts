import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect } from "vitest";
import type { EvalRunResult } from "../types.js";

const fixtureRoot = fileURLToPath(new URL("../__fixtures__", import.meta.url));

const tempRoots: string[] = [];

export function registerRunIntegrationCleanup(): void {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });
}

export async function createRunOutDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-eval-run-"));
  tempRoots.push(root);
  return path.join(root, "runs");
}

export function sourceFixture(kind: string): string {
  return path.join(fixtureRoot, "source", `example-${kind}`);
}

export function cloneFixture(): string {
  return path.join(fixtureRoot, "clone-target");
}

export async function copyFixtureClone(dest: string): Promise<void> {
  await cp(cloneFixture(), dest, { recursive: true });
}

export async function assertSuccessfulRun(input: {
  outDir: string;
  result: EvalRunResult;
  kind: string;
}): Promise<void> {
  expect(input.result).toEqual(
    expect.objectContaining({
      eval: "task",
      agent: "codex",
      model: "openai/gpt-5",
      planKind: input.kind,
      verdict: "pass",
      correctness: 1,
      iterations: 0,
      tests: {
        passed: 1,
        total: 1,
        pass_rate: 1,
        cases: [
          {
            name: "fixture scorer",
            passed: true,
            durationMs: 0
          }
        ]
      },
      cheated: false,
      cheatReport: {
        cheated: false,
        violations: []
      }
    })
  );
  expect(input.result.runId).toContain(`-task-codex-openai-gpt-5`);

  const runDir = path.join(input.outDir, input.result.runId);
  const cloneDir = path.join(runDir, "clone");
  await expect(stat(path.join(cloneDir, "README.md"))).resolves.toBeTruthy();
  await expect(stat(path.join(cloneDir, "starter.txt"))).resolves.toBeTruthy();
  await expect(stat(path.join(cloneDir, "docs", "plans", "eval-task.md"))).resolves.toBeTruthy();

  const persisted = JSON.parse(await readFile(path.join(runDir, "result.json"), "utf8"));
  expect(persisted).toEqual(input.result);
  expect(JSON.parse(await readFile(path.join(runDir, "cheat-report.json"), "utf8"))).toEqual({
    cheated: false,
    violations: []
  });
  await expect(readFile(path.join(runDir, "events.jsonl"), "utf8")).resolves.toBe("");
  await expect(readFile(path.join(runDir, "plan.md"), "utf8")).resolves.toContain(
    `kind: ${input.kind}`
  );
  await expect(readFile(path.join(runDir, "eval.yaml"), "utf8")).resolves.toContain("id: task");

  const copiedPlan = await readFile(path.join(cloneDir, "docs", "plans", "eval-task.md"), "utf8");
  expect(copiedPlan).toContain(`kind: ${input.kind}`);
}
