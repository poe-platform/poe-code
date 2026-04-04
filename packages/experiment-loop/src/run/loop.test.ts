import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runExperimentLoop } from "./loop.js";
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

function journalFilePath(docPath: string): string {
  return docPath.replace(/\.md$/, ".journal.jsonl");
}

async function appendJournalEntry(
  fs: ExperimentFileSystem,
  docPath: string,
  entry: Omit<JournalEntry, "timestamp">
): Promise<void> {
  await fs.appendFile(
    journalFilePath(docPath),
    JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + "\n"
  );
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
    "---",
    "# Improve the tests",
    "",
    "Make the implementation better."
  ].join("\n");
}

describe("runExperimentLoop", () => {
  it("keeps an experiment when the agent writes a keep journal entry", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 })
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1")
    });
    const exec = createExec([]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => {
        await appendJournalEntry(fs, docPath, {
          commit: "keep-1",
          status: "keep",
          score: 2,
          scores: { tests: 2 },
          output: "tests: score=2, passed=true",
          agentOutput: "done",
          durationMs: 100
        });
        return { stdout: "done", stderr: "", exitCode: 0 };
      }
    );
    const onExperimentStart = vi.fn();
    const onExperimentComplete = vi.fn();
    const onCommit = vi.fn();

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
      onExperimentComplete,
      onCommit
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
    expect(onCommit).toHaveBeenCalledWith("keep-1");

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        cwd: "/repo"
      })
    );

    const prompt = runAgent.mock.calls[0]?.[0].prompt as string;
    expect(prompt).toContain("# Improve the tests");
    expect(prompt).toContain("commit\tstatus\tscore\tdurationMs\ttimestamp\toutput\tagentOutput");
    expect(prompt).toContain("You are autonomous, do not stop or ask for input.");

    expect(git.currentHash).toHaveBeenCalledWith("/repo");

    const journalContent = await fs.readFile(journalFilePath(docPath), "utf8");
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
    expect(entry?.output).toContain("tests: score=2, passed=true");
    expect(entry?.agentOutput).toBe("done");
  });

  it("resets to pre-experiment hash when agent exits without journaling", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 })
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-1")
    });
    const exec = createExec([]);
    const onReset = vi.fn();
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec,
      runAgent,
      onReset
    });

    expect(result.experimentsCompleted).toBe(1);
    expect(result.experimentsKept).toBe(0);
    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
    expect(onReset).toHaveBeenCalledWith("base-1");

    const journalContent = await fs.readFile(journalFilePath(docPath), "utf8");
    expect(journalContent).toBe("");
  });

  it("discards experiments when the agent writes a discard journal entry and resets to pre-experiment hash", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 5 })
    });
    const git = createGit({
      currentHash: vi.fn(async () => "base-5")
    });
    const exec = createExec([]);
    const runAgent = vi.fn(
      async (): Promise<AgentRunResult> => {
        await appendJournalEntry(fs, docPath, {
          commit: "base-5",
          status: "discard",
          score: 4,
          scores: { tests: 4 },
          output: "tests: score=4, passed=false",
          agentOutput: "done",
          durationMs: 100
        });
        return { stdout: "done", stderr: "", exitCode: 0 };
      }
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

    const [entry] = (
      await fs.readFile(journalFilePath(docPath), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as JournalEntry);

    expect(entry).toEqual(
      expect.objectContaining({
        commit: "base-5",
        status: "discard",
        score: 4,
        agentOutput: "done"
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
    const git = createGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createExec([]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => {
        await appendJournalEntry(fs, docPath, {
          commit: "keep-1",
          status: "keep",
          score: 2,
          scores: { tests: 2 },
          output: "tests: score=2, passed=true",
          agentOutput: "done",
          durationMs: 100
        });
        return { stdout: "done", stderr: "", exitCode: 0 };
      }
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
      fs.readFile(journalFilePath(docPath), "utf8")
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
    const git = createGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createExec([]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => {
        await appendJournalEntry(fs, docPath, {
          commit: "keep-1",
          status: "keep",
          score: 100,
          scores: { test_count: 100 },
          output: "test_count: score=100, passed=true",
          agentOutput: "done",
          durationMs: 100
        });
        return { stdout: "done", stderr: "", exitCode: 0 };
      }
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
    const git = createGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createExec([]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => {
        await appendJournalEntry(fs, docPath, {
          commit: "base-1",
          status: "discard",
          score: 99,
          scores: { test_count: 99 },
          output: "test_count: score=99, passed=false",
          agentOutput: "done",
          durationMs: 100
        });
        return { stdout: "done", stderr: "", exitCode: 0 };
      }
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
    const git = createGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createExec([]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => {
        await appendJournalEntry(fs, docPath, {
          commit: "keep-1",
          status: "keep",
          score: 103,
          scores: { test_count: 103 },
          output: "test_count: score=103, passed=true",
          agentOutput: "done",
          durationMs: 100
        });
        return { stdout: "done", stderr: "", exitCode: 0 };
      }
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
    const git = createGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createExec([]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => {
        await appendJournalEntry(fs, docPath, {
          commit: "base-1",
          status: "discard",
          score: 106,
          scores: { test_count: 106 },
          output: "test_count: score=106, passed=false",
          agentOutput: "done",
          durationMs: 100
        });
        return { stdout: "done", stderr: "", exitCode: 0 };
      }
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
    const git = createGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createExec([]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => {
        await appendJournalEntry(fs, docPath, {
          commit: "keep-1",
          status: "keep",
          score: 9,
          scores: { tests: 9 },
          output: "tests: score=9, passed=true",
          agentOutput: "done",
          durationMs: 100
        });
        return { stdout: "done", stderr: "", exitCode: 0 };
      }
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
    const git = createGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createExec([]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => {
        await appendJournalEntry(fs, docPath, {
          commit: "keep-1",
          status: "keep",
          score: 2,
          scores: { tests: 2 },
          output: "tests: score=2, passed=true",
          agentOutput: "done",
          durationMs: 100
        });
        return { stdout: "done", stderr: "", exitCode: 0 };
      }
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
    const git = createGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createExec([]);
    let callIndex = 0;
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => {
        callIndex += 1;
        await appendJournalEntry(fs, docPath, {
          commit: `keep-${callIndex}`,
          status: "keep",
          score: callIndex + 1,
          scores: { tests: callIndex + 1 },
          output: `tests: score=${callIndex + 1}, passed=true`,
          agentOutput: "done",
          durationMs: 100
        });
        return { stdout: "done", stderr: "", exitCode: 0 };
      }
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
    const git = createGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createExec([]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => {
        await appendJournalEntry(fs, docPath, {
          commit: "keep-1",
          status: "keep",
          score: 2,
          scores: { tests: 2 },
          output: "tests: score=2, passed=true",
          agentOutput: "done",
          durationMs: 100
        });
        return { stdout: "done", stderr: "", exitCode: 0 };
      }
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
    const git = createGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createExec([]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => {
        await appendJournalEntry(fs, docPath, {
          commit: "keep-1",
          status: "keep",
          score: 5050,
          scores: { duration: 5050 },
          output: "duration: score=5050, passed=true",
          agentOutput: "done",
          durationMs: 100
        });
        return { stdout: "done", stderr: "", exitCode: 0 };
      }
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

  it("measures baseline automatically when baseline is null, then uses agent journal entry", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: null })
    });
    const git = createGit({ currentHash: vi.fn(async () => "base-1") });
    // Only one exec call needed: baseline measurement
    const exec = createExec([
      { stdout: "5\n", stderr: "", exitCode: 0 }
    ]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => {
        await appendJournalEntry(fs, docPath, {
          commit: "keep-1",
          status: "keep",
          score: 7,
          scores: { tests: 7 },
          output: "tests: score=7, passed=true",
          agentOutput: "done",
          durationMs: 100
        });
        return { stdout: "done", stderr: "", exitCode: 0 };
      }
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

    const keepEntry = JSON.parse(
      (await fs.readFile(journalFilePath(docPath), "utf8")).trim()
    ) as JournalEntry;
    expect(keepEntry.score).toBe(7);
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
        "---",
        "# Improve the tests"
      ].join("\n")
    });
    const git = createGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createExec([]);
    let callIndex = 0;
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => {
        callIndex += 1;
        await appendJournalEntry(fs, docPath, {
          commit: `keep-${callIndex}`,
          status: "keep",
          score: callIndex + 1,
          scores: { tests: callIndex + 1 },
          output: `tests: score=${callIndex + 1}, passed=true`,
          agentOutput: "done",
          durationMs: 100
        });
        return { stdout: "done", stderr: "", exitCode: 0 };
      }
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

  it("includes agent output in the journal fed to subsequent experiments", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 })
    });
    const git = createGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createExec([]);
    let callIndex = 0;
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => {
        callIndex += 1;
        await appendJournalEntry(fs, docPath, {
          commit: `keep-${callIndex}`,
          status: "keep",
          score: callIndex + 1,
          scores: { tests: callIndex + 1 },
          output: `tests: score=${callIndex + 1}, passed=true`,
          agentOutput: "I refactored the parser module to reduce allocations",
          durationMs: 100
        });
        return { stdout: "I refactored the parser module to reduce allocations", stderr: "", exitCode: 0 };
      }
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

    const secondPrompt = runAgent.mock.calls[1]?.[0].prompt as string;
    expect(secondPrompt).toContain("I refactored the parser module to reduce allocations");
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
    const git = createGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createExec([]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => {
        await appendJournalEntry(fs, docPath, {
          commit: "keep-1",
          status: "keep",
          score: 2,
          scores: { tests: 2 },
          output: "tests: score=2, passed=true",
          agentOutput: "done",
          durationMs: 100
        });
        return { stdout: "done", stderr: "", exitCode: 0 };
      }
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
  });

  it("includes doc_path in the prompt", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 })
    });
    const git = createGit({ currentHash: vi.fn(async () => "abc1234") });
    const exec = createExec([]);
    const runAgent = vi.fn(
      async (_input: AgentRunInput): Promise<AgentRunResult> => {
        await appendJournalEntry(fs, docPath, {
          commit: "keep-1",
          status: "keep",
          score: 2,
          scores: { tests: 2 },
          output: "tests: score=2, passed=true",
          agentOutput: "done",
          durationMs: 100
        });
        return { stdout: "done", stderr: "", exitCode: 0 };
      }
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
    expect(prompt).toContain(docPath);
  });
});
