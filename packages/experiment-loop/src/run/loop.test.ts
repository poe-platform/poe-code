import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runExperimentLoop } from "./loop.js";
import { parseExperimentFrontmatter } from "../frontmatter/frontmatter.js";
import type {
  AgentRunInput,
  AgentRunResult,
  ExecFn,
  ExperimentFileSystem,
  ExperimentGit,
  JournalEntry
} from "../types.js";

function createFs(files: Record<string, string>): ExperimentFileSystem {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
}

function createGit(overrides: Partial<ExperimentGit> = {}): ExperimentGit {
  return {
    commitAll: vi.fn(async () => "commit-1"),
    reset: vi.fn(async () => undefined),
    currentHash: vi.fn(async () => "base-1"),
    ...overrides
  };
}

function createExec(
  responses: Array<{ stdout: string; stderr: string; exitCode: number }>
): ExecFn {
  return vi.fn(async () => {
    const response = responses.shift();

    if (!response) {
      throw new Error("Unexpected exec call");
    }

    return response;
  }) as ExecFn;
}

function createDoc(options?: {
  baseline?: number | null;
}): string {
  const baseline = options?.baseline === undefined ? 1 : options.baseline;

  return [
    "---",
    "agent: claude-code",
    "metric:",
    "  name: tests",
    "  script: node scripts/metric-tests.mjs",
    "  direction: maximize",
    `baseline: ${baseline === null ? "null" : `{ tests: ${baseline} }`}`,
    "status:",
    "  state: open",
    "  experiment: 0",
    "  kept: 0",
    "---",
    "# Improve the tests",
    "",
    "Make the implementation better."
  ].join("\n");
}

describe("runExperimentLoop", () => {
  it("keeps an experiment when all metrics pass and improve the baseline", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 })
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1"),
      commitAll: vi.fn(async () => "keep-1")
    });
    const exec = createExec([{ stdout: "2\n", stderr: "", exitCode: 0 }]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => ({
        stdout: "done",
        stderr: "",
        exitCode: 0
      })
    );
    const onExperimentStart = vi.fn();
    const onExperimentComplete = vi.fn();

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec,
      runAgent,
      onExperimentStart,
      onExperimentComplete
    });

    expect(result.stopReason).toBe("max_experiments");
    expect(result.docPath).toBe(docPath);
    expect(result.experimentsCompleted).toBe(1);
    expect(result.experimentsKept).toBe(1);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);

    expect(onExperimentStart).toHaveBeenCalledWith(1, "claude-code");
    expect(onExperimentComplete).toHaveBeenCalledTimes(1);
    expect(onExperimentComplete.mock.calls[0]?.[0]).toBe(1);
    expect((onExperimentComplete.mock.calls[0]?.[1] as JournalEntry).status).toBe("keep");

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        cwd: "/repo"
      })
    );

    const prompt = runAgent.mock.calls[0]?.[0].prompt as string;
    expect(prompt).toContain("# Improve the tests");
    expect(prompt).toContain("commit\tstatus\tscore\tdurationMs\ttimestamp\toutput");
    expect(prompt).toContain("You are autonomous, do not stop or ask for input.");

    expect(git.currentHash).toHaveBeenCalledWith("/repo");
    expect(git.commitAll).toHaveBeenCalledWith("experiment-loop: test-duration #1", "/repo");

    const updated = parseExperimentFrontmatter(await fs.readFile(docPath, "utf8"));
    expect(updated.frontmatter.baseline).toEqual({ tests: 2 });
    expect(updated.frontmatter.status).toEqual({
      state: "open",
      experiment: 1,
      kept: 1
    });

    const journalContent = await fs.readFile(
      "/repo/.poe-code/experiments/test-duration.journal.jsonl",
      "utf8"
    );
    const [entry] = journalContent
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as JournalEntry);

    expect(entry).toEqual(
      expect.objectContaining({
        commit: "keep-1",
        status: "keep",
        score: 2
      })
    );
    expect(entry.output).toContain("tests: score=2, passed=true");
  });

  it("logs crashes, resets git, and feeds the crash output into the next prompt", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 })
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1"),
      commitAll: vi.fn(async () => "keep-2")
    });
    const exec = createExec([{ stdout: "3\n", stderr: "", exitCode: 0 }]);
    const runAgent = vi
      .fn<(input: AgentRunInput) => Promise<AgentRunResult>>()
      .mockResolvedValueOnce({
        stdout: "boom stdout\n",
        stderr: "boom stderr\n",
        exitCode: 1
      })
      .mockResolvedValueOnce({
        stdout: "fixed",
        stderr: "",
        exitCode: 0
      });

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 2,
      fs,
      git,
      exec,
      runAgent
    });

    expect(result.experimentsCompleted).toBe(2);
    expect(result.experimentsKept).toBe(1);
    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");

    const secondPrompt = runAgent.mock.calls[1]?.[0].prompt as string;
    expect(secondPrompt).toContain("Last crash output");
    expect(secondPrompt).toContain("boom stdout");
    expect(secondPrompt).toContain("boom stderr");
    expect(secondPrompt).toContain("crash");

    const updated = parseExperimentFrontmatter(await fs.readFile(docPath, "utf8"));
    expect(updated.frontmatter.status).toEqual({
      state: "open",
      experiment: 2,
      kept: 1
    });

    const journalEntries = (
      await fs.readFile("/repo/.poe-code/experiments/test-duration.journal.jsonl", "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as JournalEntry);

    expect(journalEntries).toHaveLength(2);
    expect(journalEntries[0]).toEqual(
      expect.objectContaining({
        commit: "base-1",
        status: "crash",
        score: null
      })
    );
    expect(journalEntries[1]).toEqual(
      expect.objectContaining({
        commit: "keep-2",
        status: "keep",
        score: 3
      })
    );
  });

  it("discards experiments that do not improve the baseline and restores the baseline commit", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 5 })
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-5"),
      commitAll: vi.fn(async () => "discard-1")
    });
    const exec = createExec([{ stdout: "4\n", stderr: "", exitCode: 0 }]);
    const runAgent = vi.fn(
      async (): Promise<AgentRunResult> => ({
        stdout: "done",
        stderr: "",
        exitCode: 0
      })
    );

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec,
      runAgent
    });

    expect(result.experimentsCompleted).toBe(1);
    expect(result.experimentsKept).toBe(0);
    expect(git.reset).toHaveBeenCalledWith("base-5", "/repo");

    const updated = parseExperimentFrontmatter(await fs.readFile(docPath, "utf8"));
    expect(updated.frontmatter.baseline).toEqual({ tests: 5 });
    expect(updated.frontmatter.status).toEqual({
      state: "open",
      experiment: 1,
      kept: 0
    });

    const [entry] = (
      await fs.readFile("/repo/.poe-code/experiments/test-duration.journal.jsonl", "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as JournalEntry);

    expect(entry).toEqual(
      expect.objectContaining({
        commit: "discard-1",
        status: "discard",
        score: 4
      })
    );
  });

  it("lets explicit agent option override frontmatter", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent: codex",
        "metric:",
        "  name: tests",
        "  script: node scripts/metric-tests.mjs",
        "  direction: maximize",
        "baseline: { tests: 1 }",
        "status:",
        "  state: open",
        "  experiment: 0",
        "  kept: 0",
        "---",
        "# Improve the tests"
      ].join("\n")
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1"),
      commitAll: vi.fn(async () => "keep-1")
    });
    const exec = createExec([{ stdout: "2\n", stderr: "", exitCode: 0 }]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => ({
        stdout: "done",
        stderr: "",
        exitCode: 0
      })
    );

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      agent: "claude-code:anthropic/claude-opus-4.6",
      maxExperiments: 1,
      fs,
      git,
      exec,
      runAgent
    });

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        model: "anthropic/claude-opus-4.6"
      })
    );
  });

  it("initializes the journal file even when no experiments are run", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 })
    });
    const git = createGit();
    const exec = createExec([]);
    const runAgent = vi.fn();

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 0,
      fs,
      git,
      exec,
      runAgent
    });

    expect(result).toEqual({
      stopReason: "max_experiments",
      docPath,
      experimentsCompleted: 0,
      experimentsKept: 0,
      totalDurationMs: expect.any(Number)
    });
    expect(git.currentHash).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
    await expect(
      fs.readFile("/repo/.poe-code/experiments/test-duration.journal.jsonl", "utf8")
    ).resolves.toBe("");
  });

  it("returns cancelled immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 })
    });
    const git = createGit();
    const exec = createExec([]);
    const runAgent = vi.fn();

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 2,
      fs,
      git,
      exec,
      runAgent,
      signal: controller.signal
    });

    expect(result).toEqual({
      stopReason: "cancelled",
      docPath,
      experimentsCompleted: 0,
      experimentsKept: 0,
      totalDurationMs: expect.any(Number)
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("keeps an experiment when a stable metric stays equal to baseline", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: test_count",
        "  script: node scripts/metric-test-count.mjs",
        "  direction: stable",
        "baseline: { test_count: 100 }",
        "status:",
        "  state: open",
        "  experiment: 0",
        "  kept: 0",
        "---",
        "# Keep test count stable"
      ].join("\n")
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1"),
      commitAll: vi.fn(async () => "keep-1")
    });
    const exec = createExec([{ stdout: "100\n", stderr: "", exitCode: 0 }]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => ({
        stdout: "done",
        stderr: "",
        exitCode: 0
      })
    );

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec,
      runAgent
    });

    expect(result.experimentsKept).toBe(1);
  });

  it("discards an experiment when a stable metric changes from baseline", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: test_count",
        "  script: node scripts/metric-test-count.mjs",
        "  direction: stable",
        "baseline: { test_count: 100 }",
        "status:",
        "  state: open",
        "  experiment: 0",
        "  kept: 0",
        "---",
        "# Keep test count stable"
      ].join("\n")
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1"),
      commitAll: vi.fn(async () => "discard-1")
    });
    const exec = createExec([{ stdout: "99\n", stderr: "", exitCode: 0 }]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => ({
        stdout: "done",
        stderr: "",
        exitCode: 0
      })
    );

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec,
      runAgent
    });

    expect(result.experimentsKept).toBe(0);
    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
  });

  it("keeps a stable metric within delta tolerance", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: test_count",
        "  script: node scripts/metric-test-count.mjs",
        "  direction: stable",
        "  delta: 5",
        "baseline: { test_count: 100 }",
        "status:",
        "  state: open",
        "  experiment: 0",
        "  kept: 0",
        "---",
        "# Keep test count stable"
      ].join("\n")
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1"),
      commitAll: vi.fn(async () => "keep-1")
    });
    const exec = createExec([{ stdout: "103\n", stderr: "", exitCode: 0 }]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => ({
        stdout: "done",
        stderr: "",
        exitCode: 0
      })
    );

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec,
      runAgent
    });

    expect(result.experimentsKept).toBe(1);
  });

  it("discards a stable metric that exceeds delta tolerance", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: test_count",
        "  script: node scripts/metric-test-count.mjs",
        "  direction: stable",
        "  delta: 5",
        "baseline: { test_count: 100 }",
        "status:",
        "  state: open",
        "  experiment: 0",
        "  kept: 0",
        "---",
        "# Keep test count stable"
      ].join("\n")
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1"),
      commitAll: vi.fn(async () => "discard-1")
    });
    const exec = createExec([{ stdout: "106\n", stderr: "", exitCode: 0 }]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => ({
        stdout: "done",
        stderr: "",
        exitCode: 0
      })
    );

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec,
      runAgent
    });

    expect(result.experimentsKept).toBe(0);
    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
  });

  it("keeps a maximize metric with slight regression within delta", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: node scripts/metric-tests.mjs",
        "  direction: maximize",
        "  delta: 2",
        "baseline: { tests: 10 }",
        "status:",
        "  state: open",
        "  experiment: 0",
        "  kept: 0",
        "---",
        "# Maximize with tolerance"
      ].join("\n")
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1"),
      commitAll: vi.fn(async () => "keep-1")
    });
    // Score 9 is below baseline 10, but within delta 2
    const exec = createExec([{ stdout: "9\n", stderr: "", exitCode: 0 }]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => ({
        stdout: "done",
        stderr: "",
        exitCode: 0
      })
    );

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec,
      runAgent
    });

    expect(result.experimentsKept).toBe(1);
  });

  it("uses inline model from agent specifier notation", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent: claude-code:anthropic/claude-opus-4.6",
        "metric:",
        "  name: tests",
        "  script: node scripts/metric-tests.mjs",
        "  direction: maximize",
        "baseline: { tests: 1 }",
        "status:",
        "  state: open",
        "  experiment: 0",
        "  kept: 0",
        "---",
        "# Improve the tests"
      ].join("\n")
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1"),
      commitAll: vi.fn(async () => "keep-1")
    });
    const exec = createExec([{ stdout: "2\n", stderr: "", exitCode: 0 }]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => ({
        stdout: "done",
        stderr: "",
        exitCode: 0
      })
    );

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec,
      runAgent
    });

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        model: "anthropic/claude-opus-4.6"
      })
    );
  });

  it("per-agent inline models work with agent arrays", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent:",
        "  - claude-code:anthropic/claude-opus-4.6",
        "  - codex:openai/gpt-5.4",
        "metric:",
        "  name: tests",
        "  script: node scripts/metric-tests.mjs",
        "  direction: maximize",
        "baseline: { tests: 1 }",
        "status:",
        "  state: open",
        "  experiment: 0",
        "  kept: 0",
        "---",
        "# Improve the tests"
      ].join("\n")
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1"),
      commitAll: vi.fn(async () => "keep-1")
    });
    const exec = createExec([
      { stdout: "2\n", stderr: "", exitCode: 0 },
      { stdout: "3\n", stderr: "", exitCode: 0 }
    ]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => ({
        stdout: "done",
        stderr: "",
        exitCode: 0
      })
    );

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 2,
      fs,
      git,
      exec,
      runAgent
    });

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        model: "anthropic/claude-opus-4.6"
      })
    );
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        model: "openai/gpt-5.4"
      })
    );
  });

  it("reports agent id without model in onExperimentStart", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent: claude-code:anthropic/claude-opus-4.6",
        "metric:",
        "  name: tests",
        "  script: node scripts/metric-tests.mjs",
        "  direction: maximize",
        "baseline: { tests: 1 }",
        "status:",
        "  state: open",
        "  experiment: 0",
        "  kept: 0",
        "---",
        "# Improve the tests"
      ].join("\n")
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1"),
      commitAll: vi.fn(async () => "keep-1")
    });
    const exec = createExec([{ stdout: "2\n", stderr: "", exitCode: 0 }]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => ({
        stdout: "done",
        stderr: "",
        exitCode: 0
      })
    );
    const onExperimentStart = vi.fn();

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec,
      runAgent,
      onExperimentStart
    });

    expect(onExperimentStart).toHaveBeenCalledWith(1, "claude-code");
  });

  it("keeps a minimize metric with slight regression within delta", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: duration",
        "  script: node scripts/metric-duration.mjs",
        "  direction: minimize",
        "  delta: 100",
        "baseline: { duration: 5000 }",
        "status:",
        "  state: open",
        "  experiment: 0",
        "  kept: 0",
        "---",
        "# Minimize with tolerance"
      ].join("\n")
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1"),
      commitAll: vi.fn(async () => "keep-1")
    });
    // Score 5050 is above baseline 5000, but within delta 100
    const exec = createExec([{ stdout: "5050\n", stderr: "", exitCode: 0 }]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => ({
        stdout: "done",
        stderr: "",
        exitCode: 0
      })
    );

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec,
      runAgent
    });

    expect(result.experimentsKept).toBe(1);
  });

  it("measures baseline automatically when baseline is null", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: null })
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1"),
      commitAll: vi.fn(async () => "keep-1")
    });
    // First exec call = baseline measurement, second = after experiment
    const exec = createExec([
      { stdout: "5\n", stderr: "", exitCode: 0 },
      { stdout: "7\n", stderr: "", exitCode: 0 }
    ]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => ({
        stdout: "done",
        stderr: "",
        exitCode: 0
      })
    );

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec,
      runAgent
    });

    expect(result.experimentsCompleted).toBe(1);
    expect(result.experimentsKept).toBe(1);

    const updated = parseExperimentFrontmatter(await fs.readFile(docPath, "utf8"));
    // Baseline was measured as 5, then experiment scored 7 (maximize) so kept
    expect(updated.frontmatter.baseline).toEqual({ tests: 7 });
  });

  it("uses maxExperiments from frontmatter when not provided via options", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: node scripts/metric-tests.mjs",
        "  direction: maximize",
        "baseline: { tests: 1 }",
        "maxExperiments: 2",
        "status:",
        "  state: open",
        "  experiment: 0",
        "  kept: 0",
        "---",
        "# Improve the tests"
      ].join("\n")
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1"),
      commitAll: vi.fn(async () => "keep-1")
    });
    const exec = createExec([
      { stdout: "2\n", stderr: "", exitCode: 0 },
      { stdout: "3\n", stderr: "", exitCode: 0 }
    ]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => ({
        stdout: "done",
        stderr: "",
        exitCode: 0
      })
    );

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      fs,
      git,
      exec,
      runAgent
    });

    expect(result.stopReason).toBe("max_experiments");
    expect(result.experimentsCompleted).toBe(2);
  });

  it("uses custom run.yaml prompt template when present", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 }),
      "/repo/.poe-code/experiments/run.yaml": [
        "prompt: |",
        "  CUSTOM: {{body}}",
        "  INDEX: {{experiment_index}}",
        ""
      ].join("\n")
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1"),
      commitAll: vi.fn(async () => "keep-1")
    });
    const exec = createExec([{ stdout: "2\n", stderr: "", exitCode: 0 }]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => ({
        stdout: "done",
        stderr: "",
        exitCode: 0
      })
    );

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec,
      runAgent
    });

    const prompt = runAgent.mock.calls[0]?.[0].prompt as string;
    expect(prompt).toContain("CUSTOM:");
    expect(prompt).toContain("# Improve the tests");
    expect(prompt).toContain("INDEX: 1");
    expect(prompt).not.toContain("You are autonomous");
  });
});
