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
  editable?: string[];
  readonly?: string[];
}): string {
  const baseline = options?.baseline ?? 1;
  const editable = options?.editable ?? ["src/editable.ts"];
  const readonly = options?.readonly ?? ["README.md"];

  return [
    "---",
    "agent: claude-code",
    "metric:",
    "  name: tests",
    "  direction: maximize",
    `baseline: ${baseline === null ? "null" : `{ tests: ${baseline} }`}`,
    "editable:",
    ...editable.map((entry) => `  - ${entry}`),
    "readonly:",
    ...readonly.map((entry) => `  - ${entry}`),
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
      [docPath]: createDoc({ baseline: 1, editable: ["src/index.ts"], readonly: ["docs/spec.md"] })
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
    expect(prompt).toContain("Editable files:\n- src/index.ts");
    expect(prompt).toContain("Readonly files:\n- docs/spec.md");
    expect(prompt).toContain("you are autonomous, do not stop or ask for input");

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
});
