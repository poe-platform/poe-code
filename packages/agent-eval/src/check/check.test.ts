import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaseResult } from "../run/vitest-runner.js";

const mocks = vi.hoisted(() => ({
  fs: undefined as unknown as ReturnType<typeof createFsFromVolume>["promises"],
  cloneTarget: vi.fn(),
  runScorer: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  default: {
    cp: (...args: unknown[]) => mocks.fs.cp(...(args as Parameters<typeof mocks.fs.cp>)),
    mkdir: (...args: unknown[]) => mocks.fs.mkdir(...(args as Parameters<typeof mocks.fs.mkdir>)),
    readFile: (...args: unknown[]) =>
      mocks.fs.readFile(...(args as Parameters<typeof mocks.fs.readFile>)),
    readdir: (...args: unknown[]) =>
      mocks.fs.readdir(...(args as Parameters<typeof mocks.fs.readdir>)),
    stat: (...args: unknown[]) => mocks.fs.stat(...(args as Parameters<typeof mocks.fs.stat>))
    ,realpath: (...args: unknown[]) => mocks.fs.realpath(...(args as Parameters<typeof mocks.fs.realpath>))
  },
  cp: (...args: unknown[]) => mocks.fs.cp(...(args as Parameters<typeof mocks.fs.cp>)),
  mkdir: (...args: unknown[]) => mocks.fs.mkdir(...(args as Parameters<typeof mocks.fs.mkdir>)),
  stat: (...args: unknown[]) => mocks.fs.stat(...(args as Parameters<typeof mocks.fs.stat>))
  ,realpath: (...args: unknown[]) => mocks.fs.realpath(...(args as Parameters<typeof mocks.fs.realpath>))
}));

vi.mock("../run/clone.js", () => ({
  cloneTarget: mocks.cloneTarget
}));

vi.mock("../run/scorer.js", () => ({
  runScorer: mocks.runScorer
}));

const { evalCheck } = await import("./check.js");

describe("evalCheck", () => {
  const cases: CaseResult[] = [{ name: "copies solution", passed: true, durationMs: 12 }];

  beforeEach(() => {
    mocks.fs = createFsFromVolume(Volume.fromJSON(createSourceFiles(), "/")).promises;
    mocks.cloneTarget.mockReset();
    mocks.runScorer.mockReset();
    mocks.cloneTarget.mockImplementation(async ({ dest }: { dest: string }) => {
      await mocks.fs.mkdir(dest, { recursive: true });
    });
    mocks.runScorer.mockResolvedValue({ passed: 1, total: 1, cases });
  });

  it("clones target, overlays starter and oracle solution, then runs the scorer", async () => {
    const controller = new AbortController();

    const result = await evalCheck({
      sourceDir: "/repo/evals",
      evalId: "smoke",
      signal: controller.signal
    });

    expect(result).toMatchObject({
      evalId: "smoke",
      tests: { passed: 1, total: 1, cases }
    });
    expect(result.cloneDir).toMatch(/^\/repo\/evals\/artifacts\/\.check\/smoke\/[^/]+\/clone$/);
    await expect(
      mocks.fs.readFile(path.join(result.cloneDir, "starter.txt"), "utf8")
    ).resolves.toBe("starter\n");
    await expect(
      mocks.fs.readFile(path.join(result.cloneDir, "patched", "answer.txt"), "utf8")
    ).resolves.toBe("solution\n");
    expect(mocks.cloneTarget).toHaveBeenCalledWith({
      repo: "https://example.com/repo.git",
      ref: "main",
      dest: result.cloneDir,
      signal: controller.signal
    });
    expect(mocks.runScorer).toHaveBeenCalledWith({
      evalDef: expect.objectContaining({ id: "smoke" }),
      evalDir: "/repo/evals/smoke",
      cloneDir: result.cloneDir,
      signal: controller.signal
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("loads declared metrics without changing deterministic check scoring", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(
        createSourceFiles({
          metrics: true
        }),
        "/"
      )
    ).promises;

    const result = await evalCheck({ sourceDir: "/repo/evals", evalId: "smoke" });

    expect(result.tests).toEqual({ passed: 1, total: 1, cases });
    expect(mocks.runScorer).toHaveBeenCalledWith(
      expect.objectContaining({
        evalDef: expect.objectContaining({
          metrics: [expect.objectContaining({ id: "task_completion" })]
        })
      })
    );
  });

  it("defaults oracle.solution_dest to the clone root", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(createSourceFiles({ solutionDest: undefined }), "/")
    ).promises;

    const result = await evalCheck({ sourceDir: "/repo/evals", evalId: "smoke" });

    await expect(mocks.fs.readFile(path.join(result.cloneDir, "answer.txt"), "utf8")).resolves.toBe(
      "solution\n"
    );
  });

  it("defaults the check clone under runs when source config is absent", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(createSourceFiles({ includeSourceConfig: false }), "/")
    ).promises;

    const result = await evalCheck({ sourceDir: "/repo/evals", evalId: "smoke" });

    expect(result.cloneDir).toMatch(/^\/repo\/evals\/runs\/\.check\/smoke\/[^/]+\/clone$/);
  });

  it("rejects oracle.solution_dest values that escape the clone root", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(createSourceFiles({ solutionDest: "../outside" }), "/")
    ).promises;

    await expect(evalCheck({ sourceDir: "/repo/evals", evalId: "smoke" })).rejects.toThrow(
      "oracle.solution_dest must stay within the clone root."
    );
    expect(mocks.runScorer).not.toHaveBeenCalled();
  });

  it("rejects oracle paths that escape the eval directory", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(
        {
          ...createSourceFiles(),
          "/repo/evals/outside/solution/answer.txt": "external\n"
        },
        "/"
      )
    ).promises;
    await mocks.fs.writeFile(
      "/repo/evals/smoke/eval.yaml",
      createEvalYaml("patched").replace("oracle:\n", "oracle:\n  path: ../outside\n"),
      "utf8"
    );

    await expect(evalCheck({ sourceDir: "/repo/evals", evalId: "smoke" })).rejects.toThrow(
      "oracle.path must stay within the eval directory."
    );
    expect(mocks.runScorer).not.toHaveBeenCalled();
  });

  it("rejects symlinked solution destinations that escape the clone root", async () => {
    mocks.cloneTarget.mockImplementation(async ({ dest }: { dest: string }) => {
      await mocks.fs.mkdir(dest, { recursive: true });
      await mocks.fs.mkdir("/outside", { recursive: true });
      await mocks.fs.symlink("/outside", path.join(dest, "patched"));
    });

    await expect(evalCheck({ sourceDir: "/repo/evals", evalId: "smoke" })).rejects.toThrow(
      "oracle.solution_dest must stay within the canonical clone directory."
    );
    expect(mocks.runScorer).not.toHaveBeenCalled();
  });

  it("propagates clone errors", async () => {
    mocks.cloneTarget.mockRejectedValue(new Error("clone failed"));

    await expect(evalCheck({ sourceDir: "/repo/evals", evalId: "smoke" })).rejects.toThrow(
      "clone failed"
    );
    expect(mocks.runScorer).not.toHaveBeenCalled();
  });

  it("propagates scorer errors", async () => {
    mocks.runScorer.mockRejectedValue(new Error("scorer failed"));

    await expect(evalCheck({ sourceDir: "/repo/evals", evalId: "smoke" })).rejects.toThrow(
      "scorer failed"
    );
  });
});

function createSourceFiles(
  input: {
    includeSourceConfig?: boolean;
    solutionDest?: string;
    metrics?: boolean;
  } = {}
): Record<string, string> {
  const solutionDest = "solutionDest" in input ? input.solutionDest : "patched";
  const files: Record<string, string> = {
    "/repo/evals/.poe-code-eval.json": JSON.stringify({ out: "artifacts" }),
    "/repo/evals/smoke/eval.yaml": createEvalYaml(solutionDest, input.metrics === true),
    "/repo/evals/smoke/plan.md": ["---", "kind: plan", "---", "Implement the task."].join("\n"),
    "/repo/evals/smoke/starter/starter.txt": "starter\n",
    "/repo/evals/smoke/oracle/solution/answer.txt": "solution\n"
  };

  if (input.includeSourceConfig === false) {
    delete files["/repo/evals/.poe-code-eval.json"];
  }

  return files;
}

function createEvalYaml(solutionDest: string | undefined, metrics = false): string {
  return [
    "id: smoke",
    "title: Smoke eval",
    "target:",
    "  repo: https://example.com/repo.git",
    "  ref: main",
    "scorer:",
    "  command: npm test",
    "  result_path: score.json",
    "  timeout_ms: 1000",
    solutionDest === undefined ? "oracle: {}" : "oracle:",
    ...(solutionDest === undefined ? [] : [`  solution_dest: ${solutionDest}`]),
    "budget:",
    "  max_iterations: 10",
    "  max_tokens: 1000",
    "  wall_clock_ms: 60000",
    "judge:",
    "  agent: codex",
    "  model: gpt-5",
    "  rubric:",
    "    - completeness",
    "weights:",
    "  tests: 0.7",
    "  judge: 0.3",
    ...(metrics
      ? [
          "metrics:",
          "  - id: task_completion",
          "    required: true",
          "    threshold: 1",
          "    evaluator:",
          "      kind: deterministic"
        ]
      : [])
  ].join("\n");
}
