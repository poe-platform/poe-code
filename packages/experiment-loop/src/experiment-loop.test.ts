import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { loadRunConfig } from "./config/loader.js";
import { evaluate, evaluateChain } from "./evaluator/evaluator.js";
import {
  experimentDocumentSchema,
  experimentDocumentSchemaId,
  parseExperimentFrontmatter,
  parseExperimentFrontmatterData,
  writeExperimentFrontmatter
} from "./frontmatter/frontmatter.js";
import { createDefaultGit } from "./git/git.js";
import { ExperimentJournal } from "./journal/journal.js";
import { runExperimentLoop } from "./run/loop.js";
import {
  agentMakesChanges,
  createExperimentDoc,
  createExperimentLoopSimulation,
  metricResult
} from "./testing/simulation.js";
import type {
  AgentRunInput,
  AgentRunResult,
  ExecFn,
  ExperimentFileSystem,
  ExperimentGit,
  JournalEntry,
  MetricDef
} from "./types.js";

function createFs(files: Record<string, string> = {}): ExperimentFileSystem {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
}

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

function createEvalExec(
  responses: Array<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>
) {
  const execMock = vi.fn(async () => {
    const response = responses.shift();

    if (!response) {
      throw new Error("Unexpected exec call");
    }

    return response;
  });

  return {
    exec: execMock as ExecFn,
    execMock
  };
}

function createGitExec(
  responses: Array<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>
) {
  const commands: Array<{ command: string; options?: { cwd?: string; timeout?: number } }> = [];

  const exec = vi.fn(async (command: string, options?: { cwd?: string; timeout?: number }) => {
    commands.push({ command, options });

    const response = responses.shift();

    if (!response) {
      throw new Error(`Unexpected exec call: ${command}`);
    }

    return response;
  });

  return {
    exec: exec as ExecFn,
    commands
  };
}

function createLoopExec(
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

function createLoopGit(overrides: Partial<ExperimentGit> = {}): ExperimentGit {
  return {
    reset: vi.fn(async () => undefined),
    currentHash: vi.fn(async () => "base-1"),
    ...overrides
  };
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

function createDoc(options?: { baseline?: number | null }): string {
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

function createJournalEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    commit: "a1b2c3d",
    status: "keep",
    scores: { tests: 1.04 },
    output: "test_duration: 1.04",
    agentOutput: "optimized hot path",
    durationMs: 5023,
    timestamp: "2026-03-30T10:00:00.000Z",
    ...overrides
  };
}

describe("@poe-code/experiment-loop public exports", () => {
  it("re-exports the experiment document schema from the package entrypoint", async () => {
    const pkg = await import("./index.js");
    const frontmatter = await import("./frontmatter/frontmatter.js");

    expect(pkg.experimentDocumentSchema).toBe(frontmatter.experimentDocumentSchema);
    expect(pkg.experimentDocumentSchemaId).toBe(frontmatter.experimentDocumentSchemaId);
  });

  it("exports the experiment document schema", () => {
    expect(experimentDocumentSchemaId).toBe(
      "https://poe-platform.github.io/poe-code/schemas/plans/experiment.schema.json"
    );
    expect(experimentDocumentSchema).toMatchObject({
      $id: experimentDocumentSchemaId,
      type: "object",
      properties: {
        kind: { const: "experiment" },
        version: { type: "integer" },
        baseline: {},
        max_experiments: { type: "integer" },
        metric_timeout: { type: "integer" }
      },
      required: []
    });
  });
});

describe("loadRunConfig", () => {
  it("uses bundled default when no project run.yaml exists", async () => {
    const config = await loadRunConfig({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/experiments/run.yaml": ["prompt: |", "  Global: {{body}}", ""].join(
          "\n"
        )
      })
    });

    expect(config.prompt).toContain("{{body}}");
    expect(config.prompt).toContain("{{journal}}");
    expect(config.prompt).toContain("{{metrics}}");
  });

  it("fully replaces bundled default when project run.yaml does not extend", async () => {
    const config = await loadRunConfig({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/experiments/run.yaml": [
          "prompt: |",
          "  Global: {{body}}",
          "  Journal: {{journal}}",
          ""
        ].join("\n"),
        "/repo/.poe-code/experiments/run.yaml": [
          "prompt: |",
          "  Do this: {{body}}",
          "  History: {{journal}}",
          ""
        ].join("\n")
      })
    });

    expect(config.prompt).toBe("Do this: {{body}}\nHistory: {{journal}}\n");
  });

  it("merges with bundled default when project run.yaml sets extends true", async () => {
    const config = await loadRunConfig({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/experiments/run.yaml": "extends: true\n"
      })
    });

    expect(config.prompt).toContain("{{body}}");
    expect(config.prompt).toContain("{{journal}}");
    expect(config.prompt).toContain("{{metrics}}");
  });

  it("uses global run.yaml as the base when project run.yaml extends", async () => {
    const config = await loadRunConfig({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/experiments/run.yaml": [
          "prompt: |",
          "  Global: {{body}}",
          "  Journal: {{journal}}",
          ""
        ].join("\n"),
        "/repo/.poe-code/experiments/run.yaml": "extends: true\n"
      })
    });

    expect(config.prompt).toBe("Global: {{body}}\nJournal: {{journal}}\n");
  });

  it("rejects a project run config symlinked outside the project", async () => {
    const fs = createFs({
      "/outside/run.yaml": "prompt: External project prompt\n"
    });
    await fs.mkdir("/repo/.poe-code/experiments", { recursive: true });
    await (fs as ExperimentFileSystem & { symlink(target: string, path: string): Promise<void> })
      .symlink("/outside/run.yaml", "/repo/.poe-code/experiments/run.yaml");

    await expect(loadRunConfig({ cwd: "/repo", homeDir: "/home/test", fs })).rejects.toThrow(
      "Experiment run config must not contain symbolic links."
    );
  });

  it("rejects a global config directory symlinked outside the home directory", async () => {
    const fs = createFs({
      "/repo/.poe-code/experiments/run.yaml": "extends: true\n",
      "/outside/run.yaml": "prompt: External global prompt\n"
    });
    await fs.mkdir("/home/test/.poe-code", { recursive: true });
    await (fs as ExperimentFileSystem & { symlink(target: string, path: string): Promise<void> })
      .symlink("/outside", "/home/test/.poe-code/experiments");

    await expect(loadRunConfig({ cwd: "/repo", homeDir: "/home/test", fs })).rejects.toThrow(
      "Experiment run config must not contain symbolic links."
    );
  });

  it("does not hide project config read failures with inherited missing-path codes", async () => {
    const baseFs = createFs();
    const fs: ExperimentFileSystem = {
      ...baseFs,
      async readFile(filePath, encoding) {
        if (filePath === "/repo/.poe-code/experiments/run.yaml") {
          throw new Error("project config read denied");
        }

        return await baseFs.readFile(filePath, encoding);
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(loadRunConfig({ cwd: "/repo", homeDir: "/home/test", fs })).rejects.toThrow(
        "project config read denied"
      );
    });
  });

  it("does not ignore config path check failures with inherited missing-path codes", async () => {
    const baseFs = createFs();
    const fs: ExperimentFileSystem = {
      ...baseFs,
      async lstat() {
        throw new Error("config lstat denied");
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(loadRunConfig({ cwd: "/repo", homeDir: "/home/test", fs })).rejects.toThrow(
        "config lstat denied"
      );
    });
  });

  it("returns default when run.yaml is comment-only", async () => {
    const config = await loadRunConfig({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/experiments/run.yaml": [
          "# This file is all comments",
          "# No actual config",
          ""
        ].join("\n")
      })
    });

    expect(config.prompt).toContain("{{body}}");
  });

  it("throws for invalid yaml", async () => {
    await expect(
      loadRunConfig({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/experiments/run.yaml": "prompt: ["
        })
      })
    ).rejects.toThrow(/invalid.*yaml/i);
  });

  it("throws when prompt field is missing", async () => {
    await expect(
      loadRunConfig({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/experiments/run.yaml": "other: value\n"
        })
      })
    ).rejects.toThrow(/missing.*prompt/i);
  });

  it("throws when prompt field is not a string", async () => {
    await expect(
      loadRunConfig({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/experiments/run.yaml": "prompt: 42\n"
        })
      })
    ).rejects.toThrow(/prompt.*string/i);
  });

  it("throws when prompt field is whitespace-only", async () => {
    await expect(
      loadRunConfig({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/experiments/run.yaml": 'prompt: "   "\n'
        })
      })
    ).rejects.toThrow(/prompt.*non-empty string/i);
  });
});

describe("evaluate", () => {
  it("returns a passing result when the metric exits 0 with a valid score", async () => {
    const { exec, execMock } = createEvalExec([
      {
        stdout: "42\n",
        stderr: "",
        exitCode: 0
      }
    ]);

    await expect(evaluate("node scripts/metric-tests.mjs", "/repo", exec)).resolves.toEqual({
      score: 42,
      passed: true,
      output: "42\n"
    });

    expect(execMock).toHaveBeenCalledWith("node scripts/metric-tests.mjs", {
      cwd: "/repo",
      timeout: 180_000
    });
  });

  it("returns a failing result when the metric exits non-zero", async () => {
    const { exec } = createEvalExec([
      {
        stdout: "0\n",
        stderr: "metric failed\n",
        exitCode: 1
      }
    ]);

    await expect(evaluate("node scripts/metric-tests.mjs", "/repo", exec)).resolves.toEqual({
      score: 0,
      passed: false,
      output: "0\nmetric failed\n"
    });
  });

  it("treats non-numeric stdout as a failure", async () => {
    const { exec } = createEvalExec([
      {
        stdout: "not-a-number\n",
        stderr: "",
        exitCode: 0
      }
    ]);

    await expect(evaluate("node scripts/metric-tests.mjs", "/repo", exec)).resolves.toEqual({
      score: null,
      passed: false,
      output: "not-a-number\n"
    });
  });

  it("treats non-finite metric scores as failures", async () => {
    const { exec } = createEvalExec([
      {
        stdout: "Infinity\n",
        stderr: "",
        exitCode: 0
      }
    ]);

    await expect(evaluate("node scripts/metric-tests.mjs", "/repo", exec)).resolves.toEqual({
      score: null,
      passed: false,
      output: "Infinity\n"
    });
  });

  it("does not report stderr-only command failures as timeouts", async () => {
    const { exec } = createEvalExec([
      {
        stdout: "",
        stderr: "Error: Cannot find module 'missing-script.mjs'\n",
        exitCode: 1
      }
    ]);

    const result = await evaluate("node missing-script.mjs", "/repo", exec, 5000);

    expect(result.passed).toBe(false);
    expect(result.output).toContain("Cannot find module");
    expect(result.output).not.toContain("Metric timed out");
  });

  it("parses the score from the last non-empty stdout line", async () => {
    const { exec } = createEvalExec([
      {
        stdout: "Running benchmark\nIntermediate note\n\n12.5\n\n",
        stderr: "",
        exitCode: 0
      }
    ]);

    await expect(evaluate("node scripts/metric-benchmark.mjs", "/repo", exec)).resolves.toEqual({
      score: 12.5,
      passed: true,
      output: "Running benchmark\nIntermediate note\n\n12.5\n\n"
    });
  });
});

describe("evaluateChain", () => {
  const metrics: MetricDef[] = [
    {
      name: "tests",
      script: "node scripts/metric-tests.mjs",
      direction: "maximize"
    },
    {
      name: "duration",
      script: "node scripts/metric-duration.mjs",
      direction: "minimize"
    },
    {
      name: "size",
      script: "node scripts/metric-size.mjs",
      direction: "minimize"
    }
  ];

  it("returns all results when every metric passes", async () => {
    const { exec, execMock } = createEvalExec([
      {
        stdout: "1\n",
        stderr: "",
        exitCode: 0
      },
      {
        stdout: "10\n",
        stderr: "",
        exitCode: 0
      },
      {
        stdout: "20\n",
        stderr: "",
        exitCode: 0
      }
    ]);

    await expect(evaluateChain(metrics, "/repo", exec)).resolves.toEqual([
      {
        score: 1,
        passed: true,
        output: "1\n"
      },
      {
        score: 10,
        passed: true,
        output: "10\n"
      },
      {
        score: 20,
        passed: true,
        output: "20\n"
      }
    ]);

    expect(execMock).toHaveBeenCalledTimes(3);
  });

  it("short-circuits when the first metric fails", async () => {
    const { exec, execMock } = createEvalExec([
      {
        stdout: "0\n",
        stderr: "failed\n",
        exitCode: 1
      }
    ]);

    await expect(evaluateChain(metrics, "/repo", exec)).resolves.toEqual([
      {
        score: 0,
        passed: false,
        output: "0\nfailed\n"
      }
    ]);

    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it("continues after a parse failure when the metric still exits 0", async () => {
    const { exec, execMock } = createEvalExec([
      {
        stdout: "not-a-number\n",
        stderr: "",
        exitCode: 0
      },
      {
        stdout: "10\n",
        stderr: "",
        exitCode: 0
      },
      {
        stdout: "20\n",
        stderr: "",
        exitCode: 0
      }
    ]);

    await expect(evaluateChain(metrics, "/repo", exec)).resolves.toEqual([
      {
        score: null,
        passed: false,
        output: "not-a-number\n"
      },
      {
        score: 10,
        passed: true,
        output: "10\n"
      },
      {
        score: 20,
        passed: true,
        output: "20\n"
      }
    ]);

    expect(execMock).toHaveBeenCalledTimes(3);
  });

  it("returns results through the first failing metric", async () => {
    const { exec, execMock } = createEvalExec([
      {
        stdout: "1\n",
        stderr: "",
        exitCode: 0
      },
      {
        stdout: "10\n",
        stderr: "boom\n",
        exitCode: 1
      }
    ]);

    await expect(evaluateChain(metrics, "/repo", exec)).resolves.toEqual([
      {
        score: 1,
        passed: true,
        output: "1\n"
      },
      {
        score: 10,
        passed: false,
        output: "10\nboom\n"
      }
    ]);

    expect(execMock).toHaveBeenCalledTimes(2);
  });
});

describe("parseExperimentFrontmatter", () => {
  it("parses a single metric with script and direction", () => {
    const content = [
      "---",
      "agent: claude-code",
      "metric:",
      "  name: test_duration",
      "  script: node scripts/metric-test-duration.mjs",
      "  direction: minimize",
      "---",
      "# Experiment",
      "",
      "Body"
    ].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.metric).toEqual({
      name: "test_duration",
      script: "node scripts/metric-test-duration.mjs",
      direction: "minimize"
    });
    expect(result.body).toBe("# Experiment\n\nBody");
  });

  it("parses a metric with stable direction", () => {
    const content = [
      "---",
      "metric:",
      "  name: test_count",
      "  script: node scripts/metric-test-count.mjs",
      "  direction: stable",
      "---",
      "Body"
    ].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.metric).toEqual({
      name: "test_count",
      script: "node scripts/metric-test-count.mjs",
      direction: "stable"
    });
  });

  it("rejects non-finite stable metric deltas", () => {
    const content = [
      "---",
      "metric:",
      "  name: test_count",
      "  script: node scripts/metric-test-count.mjs",
      "  direction: stable",
      "  delta: .inf",
      "---",
      "Body"
    ].join("\n");

    expect(() => parseExperimentFrontmatter(content)).toThrow("metric.delta must be a non-negative number.");
  });

  it("does not accept inherited metric fields", async () => {
    await withObjectPrototypeProperties(
      {
        name: "polluted",
        script: "npm test",
        direction: "maximize"
      },
      () => {
        const content = ["---", "metric: {}", "baseline: null", "---", "Body"].join("\n");

        expect(() => parseExperimentFrontmatter(content)).toThrow(
          "metric.name must be a non-empty string."
        );
      }
    );
  });

  it("rejects invalid metric direction frontmatter", () => {
    const content = [
      "---",
      "metric:",
      "  name: tests",
      "  script: npm test",
      "  direction: max",
      "baseline: null",
      "---",
      "Body"
    ].join("\n");

    expect(() => parseExperimentFrontmatter(content)).toThrow(
      'metric.direction must be one of "minimize", "maximize", or "stable".'
    );
  });

  it("rejects invalid baseline values", () => {
    const content = [
      "---",
      "metric:",
      "  name: tests",
      "  script: npm test",
      "  direction: maximize",
      "baseline:",
      "  tests: bad",
      "---",
      "Body"
    ].join("\n");

    expect(() => parseExperimentFrontmatter(content)).toThrow(
      "baseline.tests must be a finite number."
    );
  });

  it("rejects unsupported document versions when present", () => {
    expect(() =>
      parseExperimentFrontmatterData({
        kind: "experiment",
        version: 999,
        agent: "claude-code",
        metric: { name: "tests", script: "npm test", direction: "maximize" },
        baseline: null
      })
    ).toThrow("Experiment document version must be 1.");
  });

  it("rejects invalid agent frontmatter values", () => {
    const content = [
      "---",
      "kind: experiment",
      "version: 1",
      "agent:",
      "  - codex",
      "  - 42",
      "metric:",
      "  name: tests",
      "  script: npm test",
      "  direction: maximize",
      "baseline: { tests: 1 }",
      "---",
      "Body"
    ].join("\n");

    expect(() => parseExperimentFrontmatter(content)).toThrow(
      "agent[1] must be a non-empty string."
    );
  });

  it("parses metric_timeout from frontmatter", () => {
    const content = ["---", "metric_timeout: 120", "baseline: null", "---", "Body"].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.metric_timeout).toBe(120);
  });

  it("rejects negative metric_timeout frontmatter", () => {
    const content = ["---", "metric_timeout: -1", "baseline: null", "---", "Body"].join("\n");

    expect(() => parseExperimentFrontmatter(content)).toThrow(
      "metric_timeout must be a non-negative integer."
    );
  });

  it("ignores legacy camelCase metricTimeout frontmatter", () => {
    const content = ["---", "metricTimeout: 120", "baseline: null", "---", "Body"].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.metric_timeout).toBeUndefined();
  });

  it("parses extends from frontmatter", () => {
    const content = ["---", "extends: true", "baseline: null", "---", "Body"].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.extends).toBe(true);
  });

  it("ignores inherited frontmatter fields", async () => {
    await withObjectPrototypeProperties(
      {
        agent: "polluted-agent",
        extends: true,
        baseline: { tests: 1 },
        max_experiments: 9,
        metric_timeout: 30
      },
      () => {
        const content = ["---", "{}", "---", "Body"].join("\n");

        const result = parseExperimentFrontmatter(content);

        expect(result.frontmatter).toEqual({ baseline: null });
      }
    );
  });

  it("parses agent as a single string", () => {
    const content = ["---", "agent: claude-code", "baseline: null", "---", "Body"].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.agent).toBe("claude-code");
  });

  it("parses agent as an array of strings", () => {
    const content = [
      "---",
      "agent:",
      "  - claude-code",
      "  - codex",
      "baseline: null",
      "---",
      "Body"
    ].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.agent).toEqual(["claude-code", "codex"]);
  });

  it("parses max_experiments from frontmatter", () => {
    const content = [
      "---",
      "agent: claude-code",
      "metric:",
      "  name: tests",
      "  script: npm test",
      "  direction: maximize",
      "max_experiments: 10",
      "baseline: null",
      "---",
      "Body"
    ].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.max_experiments).toBe(10);
  });

  it("rejects negative max_experiments frontmatter", () => {
    const content = ["---", "max_experiments: -1", "baseline: null", "---", "Body"].join("\n");

    expect(() => parseExperimentFrontmatter(content)).toThrow(
      "max_experiments must be a non-negative integer."
    );
  });

  it("ignores legacy camelCase maxExperiments frontmatter", () => {
    const content = ["---", "maxExperiments: 10", "baseline: null", "---", "Body"].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.max_experiments).toBeUndefined();
  });

  it("omits max_experiments when not present", () => {
    const content = ["---", "baseline: null", "---", "Body"].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.max_experiments).toBeUndefined();
  });

  it("parses a metric chain", () => {
    const content = [
      "---",
      "metric:",
      "  - name: tests",
      "    script: npm test",
      "    direction: maximize",
      "  - name: test_duration",
      "    script: node scripts/metric-test-duration.mjs",
      "    direction: minimize",
      "---",
      "Body"
    ].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.metric).toEqual<MetricDef[]>([
      {
        name: "tests",
        script: "npm test",
        direction: "maximize"
      },
      {
        name: "test_duration",
        script: "node scripts/metric-test-duration.mjs",
        direction: "minimize"
      }
    ]);
  });

  it("parses baseline as a record of numbers", () => {
    const content = ["---", "baseline:", "  tests: 1", "  test_duration: 42.5", "---", "Body"].join(
      "\n"
    );

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.baseline).toEqual({
      tests: 1,
      test_duration: 42.5
    });
  });

  it("parses baseline as null", () => {
    const content = ["---", "baseline: null", "---", "Body"].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.baseline).toBeNull();
  });

  it("returns null baseline when the markdown has no frontmatter", () => {
    const content = ["# Experiment", "", "Body"].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result).toEqual({
      frontmatter: { baseline: null },
      body: "# Experiment\n\nBody"
    });
  });

  it("returns all frontmatter config fields with the expected types", () => {
    const content = [
      "---",
      "agent: claude-code",
      "metric:",
      "  name: tests",
      "  script: npm test",
      "  direction: maximize",
      "baseline:",
      "  tests: 1",
      "---",
      "# Experiment"
    ].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter).toEqual({
      agent: "claude-code",
      metric: {
        name: "tests",
        script: "npm test",
        direction: "maximize"
      },
      baseline: {
        tests: 1
      }
    });
  });

  it("ignores legacy status fields", () => {
    const content = [
      "---",
      "agent: claude-code",
      "baseline: null",
      "status:",
      "  state: open",
      "  experiment: 3",
      "  kept: 2",
      "---",
      "Body"
    ].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter).toEqual({ agent: "claude-code", baseline: null });
  });
});

describe("writeExperimentFrontmatter", () => {
  it("round-trips parsed frontmatter through write", async () => {
    const fs = createFs();
    const docPath = "/repo/experiment.md";
    const original = [
      "---",
      "agent: claude-code",
      "metric:",
      "  - name: tests",
      "    script: npm test",
      "    direction: maximize",
      "  - name: test_duration",
      "    script: node scripts/metric-test-duration.mjs",
      "    direction: minimize",
      "baseline:",
      "  tests: 1",
      "  test_duration: 42.5",
      "---",
      "# Experiment",
      "",
      "Body"
    ].join("\n");

    const parsed = parseExperimentFrontmatter(original);

    await writeExperimentFrontmatter(docPath, parsed.frontmatter, parsed.body, fs);

    const written = await fs.readFile(docPath, "utf8");
    const reparsed = parseExperimentFrontmatter(written);

    expect(reparsed).toEqual(parsed);
  });

  it("writes canonical YAML frontmatter with snake_case fields and no status fields", async () => {
    const fs = createFs();
    const docPath = "/repo/experiment.md";

    await writeExperimentFrontmatter(
      docPath,
      {
        baseline: null,
        max_experiments: 3,
        metric_timeout: 120
      },
      "# Experiment\n",
      fs
    );

    const written = await fs.readFile(docPath, "utf8");

    expect(written).toContain("---\n");
    expect(written).toContain(
      `$schema: ${experimentDocumentSchemaId}\nkind: experiment\nversion: 1\n`
    );
    expect(written).toContain("baseline: null\n");
    expect(written).toContain("max_experiments: 3\n");
    expect(written).toContain("metric_timeout: 120\n");
    expect(written).not.toContain("maxExperiments");
    expect(written).not.toContain("metricTimeout");
    expect(written).not.toContain("status");
    expect(written.endsWith("# Experiment\n")).toBe(true);
  });

  it("drops legacy camelCase aliases when rewriting a parsed document", async () => {
    const fs = createFs();
    const docPath = "/repo/experiment.md";
    const original = [
      "---",
      "maxExperiments: 3",
      "metricTimeout: 120",
      "baseline: null",
      "---",
      "# Experiment",
      ""
    ].join("\n");

    const parsed = parseExperimentFrontmatter(original);

    await writeExperimentFrontmatter(docPath, parsed.frontmatter, parsed.body, fs);

    const written = await fs.readFile(docPath, "utf8");

    expect(written).toContain(
      `$schema: ${experimentDocumentSchemaId}\nkind: experiment\nversion: 1\n`
    );
    expect(written).toContain("baseline: null\n");
    expect(written).not.toContain("maxExperiments");
    expect(written).not.toContain("metricTimeout");
    expect(written).not.toContain("max_experiments");
    expect(written).not.toContain("metric_timeout");
  });

  it("does not follow a preexisting legacy temp path symlink", async () => {
    const docPath = "/repo/experiment.md";
    const outsidePath = "/outside/target.md";
    const volume = Volume.fromJSON(
      {
        [docPath]: "---\nkind: experiment\nversion: 1\nbaseline: null\n---\n# Keep this plan\n",
        [outsidePath]: "outside stays unchanged\n"
      },
      "/"
    );
    volume.symlinkSync(outsidePath, `${docPath}.tmp`);
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;

    await writeExperimentFrontmatter(docPath, { baseline: { tests: 42 } }, "# Keep this plan\n", fs);

    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside stays unchanged\n");
    const documentStat = await fs.lstat(docPath);
    expect(documentStat.isSymbolicLink()).toBe(false);
    await expect(fs.readFile(docPath, "utf8")).resolves.toContain("tests: 42");
  });

  it("does not remove a colliding frontmatter temp symlink it did not create", async () => {
    const docPath = "/repo/experiment.md";
    const outsidePath = "/outside/target.md";
    const original = "---\nkind: experiment\nversion: 1\nbaseline: null\n---\n# Keep this plan\n";
    const volume = Volume.fromJSON(
      {
        [docPath]: original,
        [outsidePath]: "outside stays unchanged\n"
      },
      "/"
    );
    const baseFs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    let temporaryPath: string | undefined;
    const fs: ExperimentFileSystem = {
      ...baseFs,
      async writeFile(filePath, content, options) {
        if (
          temporaryPath === undefined &&
          filePath.startsWith(`${docPath}.`) &&
          filePath.endsWith(".tmp")
        ) {
          temporaryPath = filePath;
          volume.symlinkSync(outsidePath, filePath);
        }

        await baseFs.writeFile(filePath, content, options);
      }
    };

    await expect(
      writeExperimentFrontmatter(docPath, { baseline: { tests: 42 } }, "# Keep this plan\n", fs)
    ).rejects.toMatchObject({ code: "EEXIST" });

    expect(temporaryPath).toBeDefined();
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside stays unchanged\n");
    const tempStat = await fs.lstat(temporaryPath as string);
    expect(tempStat.isSymbolicLink()).toBe(true);
    await expect(fs.readFile(docPath, "utf8")).resolves.toBe(original);
  });

  it("preserves the document when frontmatter persistence fails", async () => {
    const docPath = "/repo/experiment.md";
    const original = "---\nkind: experiment\nversion: 1\nbaseline: null\n---\n# Keep this plan\n";
    const fs = createFs({ [docPath]: original });
    const writeFile = fs.writeFile.bind(fs);
    let temporaryPath: string | undefined;
    fs.writeFile = async (filePath: string, content: string, options) => {
      temporaryPath = filePath;
      await writeFile(filePath, content.slice(0, 9), options);
      throw new Error("plan disk full");
    };

    await expect(writeExperimentFrontmatter(docPath, { baseline: { tests: 42 } }, "# Keep this plan\n", fs))
      .rejects.toThrow("plan disk full");
    await expect(fs.readFile(docPath, "utf8")).resolves.toBe(original);
    expect(temporaryPath?.startsWith(`${docPath}.`)).toBe(true);
    expect(temporaryPath?.endsWith(".tmp")).toBe(true);
    await expect(fs.readFile(temporaryPath ?? "", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("removes partial frontmatter temp files when write errors only inherit existing-path codes", async () => {
    const docPath = "/repo/experiment.md";
    const original = "---\nkind: experiment\nversion: 1\nbaseline: null\n---\n# Keep this plan\n";
    const fs = createFs({ [docPath]: original });
    const writeFile = fs.writeFile.bind(fs);
    let temporaryPath: string | undefined;
    fs.writeFile = async (filePath: string, content: string, options) => {
      temporaryPath = filePath;
      await writeFile(filePath, content.slice(0, 9), options);
      throw new Error("frontmatter temp denied");
    };

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(
        writeExperimentFrontmatter(docPath, { baseline: { tests: 42 } }, "# Keep this plan\n", fs)
      ).rejects.toThrow("frontmatter temp denied");
    });

    await expect(fs.readFile(docPath, "utf8")).resolves.toBe(original);
    expect(temporaryPath?.startsWith(`${docPath}.`)).toBe(true);
    expect(temporaryPath?.endsWith(".tmp")).toBe(true);
    await expect(fs.readFile(temporaryPath ?? "", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});

describe("createDefaultGit", () => {
  it("reset stashes experiment docs, resets, and restores them", async () => {
    const { exec, commands } = createGitExec([
      { stdout: "old-stash\n", stderr: "", exitCode: 0 },
      { stdout: "", stderr: "", exitCode: 0 },
      { stdout: "new-stash\n", stderr: "", exitCode: 0 },
      { stdout: "", stderr: "", exitCode: 0 },
      { stdout: "", stderr: "", exitCode: 0 },
      { stdout: "", stderr: "", exitCode: 0 }
    ]);
    const git = createDefaultGit(exec);

    await git.reset("abc123", "/repo");

    expect(commands).toEqual([
      { command: "git rev-parse -q --verify refs/stash", options: { cwd: "/repo" } },
      {
        command: "git stash push -q --include-untracked -- .poe-code/experiments",
        options: { cwd: "/repo" }
      },
      { command: "git rev-parse -q --verify refs/stash", options: { cwd: "/repo" } },
      { command: "git reset --hard 'abc123'", options: { cwd: "/repo" } },
      { command: "git stash pop -q 'stash@{0}'", options: { cwd: "/repo" } }
    ]);
  });

  it("reset does not restore an existing stash when no scoped stash is created", async () => {
    const { exec, commands } = createGitExec([
      { stdout: "existing-stash\n", stderr: "", exitCode: 0 },
      { stdout: "", stderr: "", exitCode: 0 },
      { stdout: "existing-stash\n", stderr: "", exitCode: 0 },
      { stdout: "", stderr: "", exitCode: 0 }
    ]);
    const git = createDefaultGit(exec);

    await git.reset("abc123", "/repo");

    expect(commands).toEqual([
      { command: "git rev-parse -q --verify refs/stash", options: { cwd: "/repo" } },
      {
        command: "git stash push -q --include-untracked -- .poe-code/experiments",
        options: { cwd: "/repo" }
      },
      { command: "git rev-parse -q --verify refs/stash", options: { cwd: "/repo" } },
      { command: "git reset --hard 'abc123'", options: { cwd: "/repo" } }
    ]);
  });

  it("refuses default experiment resets with unrelated dirty worktree files", async () => {
    const { exec, commands } = createGitExec([
      { stdout: " M src/user-work.ts\n", stderr: "", exitCode: 0 }
    ]);
    const git = createDefaultGit(exec);

    await expect(git.currentHash("/repo")).rejects.toThrow(
      "Experiment loop requires a clean working tree outside .poe-code/experiments."
    );
    expect(commands).toEqual([
      {
        command: "git status --porcelain --untracked-files=all -- . ':(exclude).poe-code/experiments'",
        options: { cwd: "/repo" }
      }
    ]);
  });

  it("currentHash returns short hash", async () => {
    const { exec, commands } = createGitExec([
      { stdout: "", stderr: "", exitCode: 0 },
      { stdout: "fedcba\n", stderr: "", exitCode: 0 }
    ]);
    const git = createDefaultGit(exec);

    await expect(git.currentHash("/repo")).resolves.toBe("fedcba");
    expect(commands).toEqual([
      {
        command: "git status --porcelain --untracked-files=all -- . ':(exclude).poe-code/experiments'",
        options: { cwd: "/repo" }
      },
      { command: "git rev-parse --short HEAD", options: { cwd: "/repo" } }
    ]);
  });
});

describe("ExperimentJournal", () => {
  it("initializes a missing journal file without clobbering future entries", async () => {
    const fs = createFs();
    const journalPath = "/repo/experiment.journal.jsonl";
    const journal = new ExperimentJournal(journalPath, fs);

    await journal.init();

    await expect(fs.readFile(journalPath, "utf8")).resolves.toBe("");

    const entry = createJournalEntry();
    await journal.log(entry);

    await expect(fs.readFile(journalPath, "utf8")).resolves.toBe(`${JSON.stringify(entry)}\n`);
  });

  it("does not erase an entry created while initialization observes a missing journal", async () => {
    const journalPath = "/repo/experiment.journal.jsonl";
    const concurrentEntry = createJournalEntry({ commit: "concurrent" });
    let content: string | undefined;
    let observedMissingRead = false;
    const fs = {
      mkdir: async () => undefined,
      lstat: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
      readFile: async () => {
        if (!observedMissingRead) {
          observedMissingRead = true;
          content = `${JSON.stringify(concurrentEntry)}\n`;
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }
        return content ?? "";
      },
      writeFile: async (_path: string, next: string) => {
        content = next;
      },
      appendFile: async (_path: string, next: string) => {
        content = `${content ?? ""}${next}`;
      }
    } as unknown as ExperimentFileSystem;
    const journal = new ExperimentJournal(journalPath, fs);

    await journal.init();

    await expect(journal.readAll()).resolves.toEqual([concurrentEntry]);
  });

  it("logs a single entry and reads it back", async () => {
    const fs = createFs();
    const journalPath = "/repo/docs/experiment.journal.jsonl";
    const journal = new ExperimentJournal(journalPath, fs);
    const entry = createJournalEntry();

    await journal.log(entry);

    await expect(fs.readFile(journalPath, "utf8")).resolves.toBe(`${JSON.stringify(entry)}\n`);
    await expect(journal.readAll()).resolves.toEqual([entry]);
  });

  it("rejects a symlinked journal sidecar before reading or appending", async () => {
    const fs = createFs({
      "/outside/journal.jsonl": `${JSON.stringify(createJournalEntry())}\n`
    });
    await fs.mkdir("/repo", { recursive: true });
    await (fs as ExperimentFileSystem & { symlink(target: string, path: string): Promise<void> })
      .symlink("/outside/journal.jsonl", "/repo/experiment.journal.jsonl");
    const journal = new ExperimentJournal("/repo/experiment.journal.jsonl", fs);

    await expect(journal.readAll()).rejects.toThrow(
      "Experiment journal must not contain symbolic links."
    );
    await expect(journal.log(createJournalEntry({ commit: "new" }))).rejects.toThrow(
      "Experiment journal must not contain symbolic links."
    );
    await expect(fs.readFile("/outside/journal.jsonl", "utf8")).resolves.not.toContain('"commit":"new"');
  });

  it("logs multiple entries and returns them in order", async () => {
    const fs = createFs();
    const journal = new ExperimentJournal("/repo/experiment.journal.jsonl", fs);
    const first = createJournalEntry();
    const second = createJournalEntry({
      commit: "e4f5g6h",
      status: "discard",
      scores: { tests: 1.12 },
      output: "test_duration: 1.12",
      durationMs: 4987,
      timestamp: "2026-03-30T10:11:00.000Z"
    });
    const third = createJournalEntry({
      commit: "f7g8h9i",
      status: "keep",
      scores: { tests: 0.98 },
      output: "test_duration: 0.98",
      durationMs: 4700,
      timestamp: "2026-03-30T10:22:00.000Z"
    });

    await journal.log(first);
    await journal.log(second);
    await journal.log(third);

    await expect(journal.readAll()).resolves.toEqual([first, second, third]);
  });

  it("preserves later entries after an interrupted journal log write", async () => {
    const journalPath = "/repo/experiment.journal.jsonl";
    const baseFs = createFs();
    const first = createJournalEntry({ commit: "first" });
    const failed = createJournalEntry({ commit: "failed" });
    const later = createJournalEntry({ commit: "later" });
    let failNextMutation = false;
    const fs: ExperimentFileSystem = {
      ...baseFs,
      async writeFile(filePath, content) {
        if (failNextMutation) {
          failNextMutation = false;
          await baseFs.writeFile(filePath, content.slice(0, 10));
          throw new Error("journal write interrupted");
        }
        await baseFs.writeFile(filePath, content);
      },
      async appendFile(filePath, content) {
        if (failNextMutation) {
          failNextMutation = false;
          await baseFs.appendFile(filePath, content.slice(0, 10));
          throw new Error("journal write interrupted");
        }
        await baseFs.appendFile(filePath, content);
      }
    };
    const journal = new ExperimentJournal(journalPath, fs);

    await journal.log(first);
    failNextMutation = true;
    await expect(journal.log(failed)).rejects.toThrow("journal write interrupted");
    await journal.log(later);

    await expect(journal.readAll()).resolves.toEqual([first, later]);
  });

  it("returns an empty array when the journal file is missing", async () => {
    const fs = createFs();
    const journal = new ExperimentJournal("/repo/missing.journal.jsonl", fs);

    await expect(journal.readAll()).resolves.toEqual([]);
  });

  it("does not hide journal read failures with inherited missing-path codes", async () => {
    const baseFs = createFs();
    const fs: ExperimentFileSystem = {
      ...baseFs,
      async readFile(filePath, encoding) {
        if (filePath === "/repo/missing.journal.jsonl") {
          throw new Error("journal read denied");
        }

        return await baseFs.readFile(filePath, encoding);
      }
    };
    const journal = new ExperimentJournal("/repo/missing.journal.jsonl", fs);

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(journal.readAll()).rejects.toThrow("journal read denied");
    });
  });

  it("formats entries as a readable TSV table", async () => {
    const fs = createFs();
    const journal = new ExperimentJournal("/repo/experiment.journal.jsonl", fs);

    await journal.log(
      createJournalEntry({
        output: "line 1\nline\t2"
      })
    );
    await journal.log(
      createJournalEntry({
        commit: "e4f5g6h",
        status: "discard",
        scores: { tests: 1.12 },
        output: "test_duration: 1.12",
        durationMs: 4987,
        timestamp: "2026-03-30T10:11:00.000Z"
      })
    );

    await expect(journal.format()).resolves.toBe(
      [
        "commit\tstatus\tscores\tdurationMs\ttimestamp\toutput\tagentOutput",
        `a1b2c3d\tkeep\t${JSON.stringify({ tests: 1.04 })}\t5023\t2026-03-30T10:00:00.000Z\tline 1\\nline\\t2\toptimized hot path`,
        `e4f5g6h\tdiscard\t${JSON.stringify({ tests: 1.12 })}\t4987\t2026-03-30T10:11:00.000Z\ttest_duration: 1.12\toptimized hot path`
      ].join("\n")
    );
  });

  it("formats a missing journal as a header-only TSV table", async () => {
    const fs = createFs();
    const journal = new ExperimentJournal("/repo/missing.journal.jsonl", fs);

    await expect(journal.format()).resolves.toBe(
      "commit\tstatus\tscores\tdurationMs\ttimestamp\toutput\tagentOutput"
    );
  });

  it("escapes carriage returns and backslashes in formatted output", async () => {
    const fs = createFs();
    const journal = new ExperimentJournal("/repo/experiment.journal.jsonl", fs);

    await journal.log(
      createJournalEntry({
        output: String.raw`path\to\file\rnext line`
      })
    );

    await expect(journal.format()).resolves.toContain(
      `a1b2c3d\tkeep\t${JSON.stringify({ tests: 1.04 })}\t5023\t2026-03-30T10:00:00.000Z\tpath\\\\to\\\\file\\\\rnext line\toptimized hot path`
    );
  });

  it("reads concatenated JSON objects on a single line", async () => {
    const first = createJournalEntry({ commit: "aaa1111" });
    const second = createJournalEntry({ commit: "bbb2222", status: "discard" });
    const fs = createFs({
      "/repo/experiment.journal.jsonl": `${JSON.stringify(first)}${JSON.stringify(second)}\n`
    });
    const journal = new ExperimentJournal("/repo/experiment.journal.jsonl", fs);

    await expect(journal.readAll()).resolves.toEqual([first, second]);
  });

  it("reads concatenated JSON objects containing brace text", async () => {
    const first = createJournalEntry({ commit: "aaa1111", output: "printed { while debugging" });
    const second = createJournalEntry({ commit: "bbb2222", output: "done" });
    const fs = createFs({
      "/repo/experiment.journal.jsonl": `${JSON.stringify(first)}${JSON.stringify(second)}\n`
    });
    const journal = new ExperimentJournal("/repo/experiment.journal.jsonl", fs);

    await expect(journal.readAll()).resolves.toEqual([first, second]);
  });

  it("does not follow a preexisting legacy publish temp path symlink", async () => {
    vi.resetModules();
    const { ExperimentJournal: FreshExperimentJournal } = await import("./journal/journal.js");
    const first = createJournalEntry({ commit: "first" });
    const second = createJournalEntry({ commit: "second" });
    const journalPath = "/repo/experiment.journal.jsonl";
    const outsidePath = "/outside/journal-target.jsonl";
    const volume = Volume.fromJSON(
      {
        [journalPath]: `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
        [outsidePath]: "outside stays unchanged\n"
      },
      "/"
    );
    volume.symlinkSync(outsidePath, `${journalPath}.${process.pid}.0.tmp`);
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    const journal = new FreshExperimentJournal(journalPath, fs);

    const updated = await journal.updateLast({ scores: { tests: 42 } });

    expect(updated).toEqual(expect.objectContaining({ scores: { tests: 42 } }));
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside stays unchanged\n");
    const journalStat = await fs.lstat(journalPath);
    expect(journalStat.isSymbolicLink()).toBe(false);
    await expect(journal.readAll()).resolves.toEqual([
      first,
      { ...second, scores: { tests: 42 } }
    ]);
  });

  it("does not remove a colliding journal temp symlink it did not create", async () => {
    const first = createJournalEntry({ commit: "first" });
    const second = createJournalEntry({ commit: "second" });
    const journalPath = "/repo/experiment.journal.jsonl";
    const outsidePath = "/outside/journal-target.jsonl";
    const original = `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`;
    const volume = Volume.fromJSON(
      {
        [journalPath]: original,
        [outsidePath]: "outside stays unchanged\n"
      },
      "/"
    );
    const baseFs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    let temporaryPath: string | undefined;
    const fs: ExperimentFileSystem = {
      ...baseFs,
      async writeFile(filePath, content, options) {
        if (
          temporaryPath === undefined &&
          filePath.startsWith(`${journalPath}.`) &&
          filePath.endsWith(".tmp")
        ) {
          temporaryPath = filePath;
          volume.symlinkSync(outsidePath, filePath);
        }

        await baseFs.writeFile(filePath, content, options);
      }
    };
    const journal = new ExperimentJournal(journalPath, fs);

    await expect(journal.updateLast({ scores: { tests: 42 } })).rejects.toMatchObject({
      code: "EEXIST"
    });

    expect(temporaryPath).toBeDefined();
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside stays unchanged\n");
    const tempStat = await fs.lstat(temporaryPath as string);
    expect(tempStat.isSymbolicLink()).toBe(true);
    await expect(fs.readFile(journalPath, "utf8")).resolves.toBe(original);
  });

  it("updateLast patches the last entry and preserves earlier entries", async () => {
    const fs = createFs();
    const journal = new ExperimentJournal("/repo/experiment.journal.jsonl", fs);
    const first = createJournalEntry({ commit: "aaa1111" });
    const second = createJournalEntry({ commit: "bbb2222", scores: undefined });

    await journal.log(first);
    await journal.log(second);

    const updated = await journal.updateLast({ scores: { tests: 42 } });

    expect(updated).toEqual({ ...second, scores: { tests: 42 } });

    const entries = await journal.readAll();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(first);
    expect(entries[1]!.scores).toEqual({ tests: 42 });
  });

  it("preserves journal history when updating the last entry cannot be committed", async () => {
    const journalPath = "/repo/experiment.journal.jsonl";
    const first = createJournalEntry({ commit: "aaa1111" });
    const second = createJournalEntry({ commit: "bbb2222", scores: undefined });
    const baseFs = createFs({
      [journalPath]: `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`
    });
    let temporaryPath: string | undefined;
    const fs: ExperimentFileSystem = {
      ...baseFs,
      async writeFile(filePath, _content, options) {
        temporaryPath = filePath;
        await baseFs.writeFile(filePath, "{", options);
        throw new Error("journal disk full");
      }
    };
    const journal = new ExperimentJournal(journalPath, fs);

    await expect(journal.updateLast({ scores: { tests: 42 } })).rejects.toThrow(
      "journal disk full"
    );
    await expect(new ExperimentJournal(journalPath, baseFs).readAll()).resolves.toEqual([
      first,
      second
    ]);
    expect(temporaryPath?.startsWith(`${journalPath}.`)).toBe(true);
    expect(temporaryPath?.endsWith(".tmp")).toBe(true);
    await expect(baseFs.readFile(temporaryPath ?? "", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("removes partial journal temp files when write errors only inherit existing-path codes", async () => {
    const journalPath = "/repo/experiment.journal.jsonl";
    const first = createJournalEntry({ commit: "aaa1111" });
    const second = createJournalEntry({ commit: "bbb2222", scores: undefined });
    const baseFs = createFs({
      [journalPath]: `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`
    });
    let temporaryPath: string | undefined;
    const fs: ExperimentFileSystem = {
      ...baseFs,
      async writeFile(filePath, _content, options) {
        temporaryPath = filePath;
        await baseFs.writeFile(filePath, "{", options);
        throw new Error("journal temp denied");
      }
    };
    const journal = new ExperimentJournal(journalPath, fs);

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(journal.updateLast({ scores: { tests: 42 } })).rejects.toThrow(
        "journal temp denied"
      );
    });

    await expect(new ExperimentJournal(journalPath, baseFs).readAll()).resolves.toEqual([
      first,
      second
    ]);
    expect(temporaryPath?.startsWith(`${journalPath}.`)).toBe(true);
    expect(temporaryPath?.endsWith(".tmp")).toBe(true);
    await expect(baseFs.readFile(temporaryPath ?? "", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("updateLast returns null on empty journal", async () => {
    const fs = createFs();
    const journal = new ExperimentJournal("/repo/experiment.journal.jsonl", fs);

    await journal.init();
    const result = await journal.updateLast({ scores: { tests: 1 } });

    expect(result).toBeNull();
  });

  it("handles discard entries without scores", async () => {
    const fs = createFs();
    const journal = new ExperimentJournal("/repo/experiment.journal.jsonl", fs);
    const entry = createJournalEntry({
      commit: "d1sc4rd",
      status: "discard",
      scores: undefined,
      output: "no improvement found",
      durationMs: 102,
      timestamp: "2026-03-30T10:05:30.000Z"
    });

    await journal.log(entry);

    await expect(journal.readAll()).resolves.toEqual([entry]);
    await expect(journal.format()).resolves.toContain(
      "d1sc4rd\tdiscard\t-\t102\t2026-03-30T10:05:30.000Z\tno improvement found\toptimized hot path"
    );
  });

  it("ignores journal objects without required experiment fields", async () => {
    const fs = createFs({ "/repo/experiment.journal.jsonl": "{}\n" });
    const journal = new ExperimentJournal("/repo/experiment.journal.jsonl", fs);

    await expect(journal.readAll()).resolves.toEqual([]);
  });
});

describe("runExperimentLoop", () => {
  it("rejects an explicitly wrong document kind before running an agent", async () => {
    const docPath = "/repo/.poe-code/experiments/not-experiment.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "kind: pipeline",
        "version: 1",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: npm test",
        "  direction: maximize",
        "baseline: { tests: 1 }",
        "---",
        "Wrong workflow kind"
      ].join("\n")
    });
    const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    await expect(
      runExperimentLoop({
        cwd: "/repo",
        homeDir: "/home/user",
        docPath,
        maxExperiments: 1,
        fs,
        git: createLoopGit(),
        exec: createLoopExec([]),
        runAgent
      })
    ).rejects.toThrow("Experiment document kind must be 'experiment'.");
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("rejects unknown frontmatter keys instead of applying default agents", async () => {
    const docPath = "/repo/.poe-code/experiments/unknown-key.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agnet: codex",
        "metric:",
        "  name: tests",
        "  script: npm test",
        "  direction: maximize",
        "baseline: { tests: 1 }",
        "---",
        "Wrong key"
      ].join("\n")
    });
    const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    await expect(
      runExperimentLoop({
        cwd: "/repo",
        homeDir: "/home/user",
        docPath,
        maxExperiments: 1,
        fs,
        git: createLoopGit(),
        exec: createLoopExec([]),
        runAgent
      })
    ).rejects.toThrow('Unknown experiment frontmatter field: "agnet".');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("rejects empty metric chains before running an agent", async () => {
    const docPath = "/repo/.poe-code/experiments/empty-metrics.md";
    const fs = createFs({
      [docPath]: ["---", "agent: claude-code", "metric: []", "baseline: null", "---", "No metrics"].join("\n")
    });
    const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    await expect(
      runExperimentLoop({
        cwd: "/repo",
        homeDir: "/home/user",
        docPath,
        maxExperiments: 1,
        fs,
        git: createLoopGit(),
        exec: createLoopExec([]),
        runAgent
      })
    ).rejects.toThrow("Experiment doc must contain at least one metric.");
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("rejects model-only agent specifiers before running an agent", async () => {
    const docPath = "/repo/.poe-code/experiments/model-only.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent: ':openai/gpt-5.4'",
        "metric:",
        "  name: tests",
        "  script: npm test",
        "  direction: maximize",
        "baseline: { tests: 1 }",
        "---",
        "Invalid agent"
      ].join("\n")
    });
    const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    await expect(
      runExperimentLoop({
        cwd: "/repo",
        homeDir: "/home/user",
        docPath,
        maxExperiments: 1,
        fs,
        git: createLoopGit(),
        exec: createLoopExec([]),
        runAgent
      })
    ).rejects.toThrow("Agent specifier must include an agent id.");
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("does not evaluate a baseline when max_experiments is zero", async () => {
    const docPath = "/repo/.poe-code/experiments/disabled.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: npm test",
        "  direction: maximize",
        "baseline: null",
        "max_experiments: 0",
        "---",
        "Disabled"
      ].join("\n")
    });
    const exec = vi.fn(async () => ({ stdout: "1\n", stderr: "", exitCode: 0 })) as ExecFn;

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      fs,
      git: createLoopGit(),
      exec,
      runAgent: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
    });

    expect(result.experimentsCompleted).toBe(0);
    expect(exec).not.toHaveBeenCalled();
  });

  it("honors zero metric_timeout when evaluating a baseline", async () => {
    const docPath = "/repo/.poe-code/experiments/zero-timeout.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: npm test",
        "  direction: maximize",
        "metric_timeout: 0",
        "baseline: null",
        "max_experiments: 0",
        "---",
        "Measure only"
      ].join("\n")
    });
    const exec = vi.fn(async () => ({ stdout: "1\n", stderr: "", exitCode: 0 })) as ExecFn;

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git: createLoopGit(),
      exec,
      runAgent: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
    });

    expect(exec).toHaveBeenCalledWith("npm test", { cwd: "/repo", timeout: 0 });
  });

  it("rejects duplicate metric names before collecting baselines", async () => {
    const docPath = "/repo/.poe-code/experiments/duplicate.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  - name: score",
        "    script: node one.mjs",
        "    direction: maximize",
        "  - name: score",
        "    script: node two.mjs",
        "    direction: minimize",
        "baseline: null",
        "max_experiments: 0",
        "---",
        "Measure baselines"
      ].join("\n")
    });
    const exec = vi.fn(async () => ({ stdout: "10\n", stderr: "", exitCode: 0 })) as ExecFn;

    await expect(
      runExperimentLoop({
        cwd: "/repo",
        homeDir: "/home/user",
        docPath,
        fs,
        git: createLoopGit(),
        exec,
        runAgent: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
      })
    ).rejects.toThrow('Metric names must be unique: "score".');
    expect(exec).not.toHaveBeenCalled();
  });

  it("ignores malformed journal scores when formatting a future prompt", async () => {
    const docPath = "/repo/.poe-code/experiments/reuse.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 }),
      [journalFilePath(docPath)]: `${JSON.stringify(
        createJournalEntry({ commit: "bad", scores: { tests: "not-a-number" } as never })
      )}\n`
    });
    const runAgent = vi.fn(async (input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "next",
        status: "discard",
        scores: { tests: 1 },
        output: "done",
        agentOutput: "done",
        durationMs: 1
      });
      return { stdout: input.prompt, stderr: "", exitCode: 0 };
    });

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 2,
      fs,
      git: createLoopGit(),
      exec: createLoopExec([]),
      runAgent
    });

    const prompt = runAgent.mock.calls[0]?.[0].prompt as string;
    const metricLine = prompt.match(/- tests:[^\n]*/)?.[0] ?? "";
    expect(metricLine).toContain("(baseline: 1)");
    expect(metricLine).not.toContain("not-a-number");
  });

  it("does not use an empty kept commit as the discard reset target", async () => {
    const docPath = "/repo/.poe-code/experiments/empty-commit.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 }),
      [journalFilePath(docPath)]: `${JSON.stringify(createJournalEntry({ commit: "" }))}\n`
    });
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "discarded",
        status: "discard",
        scores: { tests: 1 },
        output: "done",
        agentOutput: "done",
        durationMs: 1
      });
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 2,
      fs,
      git,
      exec: createLoopExec([]),
      runAgent
    });

    expect(git.currentHash).toHaveBeenCalledWith("/repo");
    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
    expect(git.reset).not.toHaveBeenCalledWith("", "/repo");
  });

  it("validates reset safety before resuming from a kept journal hash", async () => {
    const docPath = "/repo/.poe-code/experiments/resume-safety.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 }),
      [journalFilePath(docPath)]: `${JSON.stringify(createJournalEntry({ commit: "kept-base" }))}\n`
    });
    const git = createLoopGit({
      currentHash: vi.fn(async () => {
        throw new Error("working tree contains user edits");
      })
    });
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));

    await expect(
      runExperimentLoop({
        cwd: "/repo",
        homeDir: "/home/user",
        docPath,
        maxExperiments: 2,
        fs,
        git,
        exec: createLoopExec([]),
        runAgent
      })
    ).rejects.toThrow("working tree contains user edits");

    expect(git.currentHash).toHaveBeenCalledWith("/repo");
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("does not render inherited baseline properties for metric names", async () => {
    const docPath = "/repo/.poe-code/experiments/constructor.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: constructor",
        "  script: npm test",
        "  direction: maximize",
        "baseline: {}",
        "---",
        "Improve score"
      ].join("\n")
    });
    const runAgent = vi.fn(async (input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "discard",
        status: "discard",
        scores: { constructor: 1 },
        output: "done",
        agentOutput: "done",
        durationMs: 1
      });
      return { stdout: input.prompt, stderr: "", exitCode: 0 };
    });

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git: createLoopGit(),
      exec: createLoopExec([]),
      runAgent
    });

    const metricLine = String(runAgent.mock.calls[0]?.[0].prompt).match(/- constructor:[^\n]*/)?.[0] ?? "";
    expect(metricLine).not.toContain("baseline:");
  });

  it("does not count malformed journal objects against the experiment budget", async () => {
    const docPath = "/repo/.poe-code/experiments/blocked-by-history.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 }),
      [journalFilePath(docPath)]: "{}\n"
    });
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "discard",
        status: "discard",
        scores: { tests: 1 },
        output: "done",
        agentOutput: "done",
        durationMs: 1
      });
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git: createLoopGit(),
      exec: createLoopExec([]),
      runAgent
    });

    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("keeps an experiment when the agent writes a keep journal entry", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 })
    });
    const git = createLoopGit({
      currentHash: vi.fn(async () => "base-1")
    });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { tests: 2 },
        output: "tests: score=2, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });
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
    expect(prompt).toContain("commit\tstatus\tscores\tdurationMs\ttimestamp\toutput\tagentOutput");
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
        scores: { tests: 2 }
      })
    );
    expect(entry?.output).toContain("tests: score=2, passed=true");
    expect(entry?.agentOutput).toBe("done");
  });

  it("waits for async experiment completion callbacks before returning", async () => {
    const docPath = "/repo/.poe-code/experiments/async-complete.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 })
    });
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { tests: 2 },
        output: "tests: score=2, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });
    const events: string[] = [];
    let resolveComplete!: () => void;
    const completeReady = new Promise<void>((resolve) => {
      resolveComplete = resolve;
    });
    let settled = false;

    const runPromise = runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git: createLoopGit(),
      exec: createLoopExec([]),
      runAgent,
      async onExperimentComplete() {
        events.push("complete-start");
        await completeReady;
        events.push("complete-end");
      }
    }).then((result) => {
      settled = true;
      return result;
    });

    await vi.waitFor(() => expect(events).toEqual(["complete-start"]));
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveComplete();
    const result = await runPromise;

    expect(result.stopReason).toBe("max_experiments");
    expect(events).toEqual(["complete-start", "complete-end"]);
  });

  it("does not reject an accepted keep when the commit observer fails", async () => {
    const docPath = "/repo/.poe-code/experiments/commit-observer.md";
    const fs = createFs({ [docPath]: createDoc({ baseline: 1 }) });
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { tests: 2 },
        output: "better",
        agentOutput: "done",
        durationMs: 1
      });
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git: createLoopGit(),
      exec: createLoopExec([]),
      runAgent,
      onCommit: () => { throw new Error("observer failed"); }
    });

    expect(result.experimentsKept).toBe(1);
  });

  it("resets to pre-experiment hash when agent exits without journaling", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 })
    });
    const git = createLoopGit({
      currentHash: vi.fn(async () => "base-1")
    });
    const exec = createLoopExec([]);
    const onReset = vi.fn();
    const runAgent = vi.fn(
      async (): Promise<AgentRunResult> => ({
        stdout: "",
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

  it("does not reject a completed reset when the reset observer fails", async () => {
    const docPath = "/repo/.poe-code/experiments/reset-observer.md";
    const fs = createFs({ [docPath]: createDoc({ baseline: 1 }) });
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "discard-1",
        status: "discard",
        output: "discard",
        agentOutput: "done",
        durationMs: 1
      });
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec: createLoopExec([]),
      runAgent,
      onReset: () => { throw new Error("observer failed"); }
    });

    expect(result.experimentsCompleted).toBe(1);
    expect(result.experimentsKept).toBe(0);
    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
  });

  it("resets candidate edits before returning cancelled from an in-flight agent", async () => {
    const docPath = "/repo/.poe-code/experiments/cancelled.md";
    const candidatePath = "/repo/src/candidate.txt";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 }),
      [candidatePath]: "original\n"
    });
    const git = createLoopGit({
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => fs.writeFile(candidatePath, "original\n"))
    });
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await fs.writeFile(candidatePath, "changed before cancel\n");
      throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    });

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec: createLoopExec([]),
      runAgent
    });

    expect(result.stopReason).toBe("cancelled");
    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
    await expect(fs.readFile(candidatePath, "utf8")).resolves.toBe("original\n");
  });

  it("resets candidate edits before propagating an in-flight agent error", async () => {
    const docPath = "/repo/.poe-code/experiments/failed.md";
    const candidatePath = "/repo/src/candidate.txt";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 }),
      [candidatePath]: "original\n"
    });
    const git = createLoopGit({
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => fs.writeFile(candidatePath, "original\n"))
    });
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await fs.writeFile(candidatePath, "partial agent edit\n");
      throw new Error("agent crashed");
    });

    await expect(
      runExperimentLoop({
        cwd: "/repo",
        homeDir: "/home/user",
        docPath,
        maxExperiments: 1,
        fs,
        git,
        exec: createLoopExec([]),
        runAgent
      })
    ).rejects.toThrow("agent crashed");

    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
    await expect(fs.readFile(candidatePath, "utf8")).resolves.toBe("original\n");
  });

  it("resets candidate edits before propagating a post-agent journal read error", async () => {
    const docPath = "/repo/.poe-code/experiments/read-fail.md";
    const candidatePath = "/repo/src/candidate.txt";
    const baseFs = createFs({
      [docPath]: createDoc({ baseline: 1 }),
      [candidatePath]: "original\n"
    });
    let failJournalRead = false;
    const fs: ExperimentFileSystem = {
      ...baseFs,
      async readFile(filePath, encoding) {
        if (filePath === journalFilePath(docPath) && failJournalRead) {
          throw new Error("journal temporarily unreadable");
        }
        return baseFs.readFile(filePath, encoding);
      }
    };
    const git = createLoopGit({
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => baseFs.writeFile(candidatePath, "original\n"))
    });
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await baseFs.writeFile(candidatePath, "candidate edit\n");
      failJournalRead = true;
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(
      runExperimentLoop({
        cwd: "/repo",
        homeDir: "/home/user",
        docPath,
        maxExperiments: 1,
        fs,
        git,
        exec: createLoopExec([]),
        runAgent
      })
    ).rejects.toThrow("journal temporarily unreadable");

    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
    await expect(baseFs.readFile(candidatePath, "utf8")).resolves.toBe("original\n");
  });

  it("discards experiments when the agent writes a discard journal entry and resets to pre-experiment hash", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 5 })
    });
    const git = createLoopGit({
      currentHash: vi.fn(async () => "baseline-abc")
    });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "discard-xyz",
        status: "discard",
        scores: { tests: 4 },
        output: "tests: score=4, passed=false",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
    expect(git.reset).toHaveBeenCalledWith("baseline-abc", "/repo");

    const [entry] = (await fs.readFile(journalFilePath(docPath), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as JournalEntry);

    expect(entry).toEqual(
      expect.objectContaining({
        commit: "discard-xyz",
        status: "discard",
        scores: { tests: 4 },
        agentOutput: "done"
      })
    );
  });

  it("removes a discard outcome when its required reset fails", async () => {
    const docPath = "/repo/.poe-code/experiments/reset-failure.md";
    const fs = createFs({ [docPath]: createDoc({ baseline: 1 }) });
    const git = createLoopGit({
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => { throw new Error("reset denied"); })
    });
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "discard-1",
        status: "discard",
        output: "worse",
        agentOutput: "done",
        durationMs: 1
      });
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(
      runExperimentLoop({
        cwd: "/repo",
        homeDir: "/home/user",
        docPath,
        maxExperiments: 1,
        fs,
        git,
        exec: createLoopExec([]),
        runAgent
      })
    ).rejects.toThrow("reset denied");

    await expect(new ExperimentJournal(journalFilePath(docPath), fs).readAll()).resolves.toEqual([]);
  });

  it("computes scores via evaluator when agent logs entry without scores", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 5 })
    });
    const git = createLoopGit({
      currentHash: vi.fn(async () => "baseline-abc")
    });
    const exec = createLoopExec([{ stdout: "42\n", stderr: "", exitCode: 0 }]);
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        output: "done",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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

    const [entry] = (await fs.readFile(journalFilePath(docPath), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as JournalEntry);

    expect(entry).toEqual(
      expect.objectContaining({
        scores: { tests: 42 }
      })
    );
  });

  it("resets a scoreless keep entry when required scoring fails", async () => {
    const docPath = "/repo/.poe-code/experiments/evaluate-keep.md";
    const fs = createFs({ [docPath]: createDoc({ baseline: 10 }) });
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "candidate",
        status: "keep",
        output: "candidate",
        agentOutput: "done",
        durationMs: 1
      });
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec: createLoopExec([{ stdout: "failed\n", stderr: "tests failed\n", exitCode: 1 }]),
      runAgent
    });

    expect(result.experimentsKept).toBe(0);
    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
  });

  it("resets an explicit scoreless discard without executing metrics", async () => {
    const docPath = "/repo/.poe-code/experiments/discard.md";
    const fs = createFs({ [docPath]: createDoc({ baseline: 1 }) });
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = vi.fn(async () => { throw new Error("metric runner unavailable"); }) as ExecFn;
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "discard-1",
        status: "discard",
        output: "discard",
        agentOutput: "done",
        durationMs: 1
      });
      return { stdout: "", stderr: "", exitCode: 0 };
    });

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
    expect(exec).not.toHaveBeenCalled();
    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
  });

  it("resets a scoreless keep when computed score publication fails", async () => {
    const docPath = "/repo/.poe-code/experiments/score-write.md";
    const candidatePath = "/repo/src/candidate.txt";
    const baseFs = createFs({ [docPath]: createDoc({ baseline: 1 }), [candidatePath]: "original\n" });
    const fs: ExperimentFileSystem = {
      ...baseFs,
      async writeFile(filePath, content) {
        if (filePath.includes(".journal.jsonl.") && filePath.endsWith(".tmp")) {
          throw new Error("disk full publishing scores");
        }
        await baseFs.writeFile(filePath, content);
      }
    };
    const git = createLoopGit({
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => baseFs.writeFile(candidatePath, "original\n"))
    });
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await baseFs.writeFile(candidatePath, "kept candidate\n");
      await baseFs.appendFile(
        journalFilePath(docPath),
        `${JSON.stringify({ ...createJournalEntry({ commit: "candidate-1", scores: undefined }) })}\n`
      );
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(
      runExperimentLoop({
        cwd: "/repo",
        homeDir: "/home/user",
        docPath,
        maxExperiments: 1,
        fs,
        git,
        exec: createLoopExec([{ stdout: "2\n", stderr: "", exitCode: 0 }]),
        runAgent
      })
    ).rejects.toThrow("disk full publishing scores");

    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
    await expect(baseFs.readFile(candidatePath, "utf8")).resolves.toBe("original\n");
  });

  it("resets an unvalidated keep when a metric observer fails", async () => {
    const docPath = "/repo/.poe-code/experiments/metric-observer.md";
    const candidatePath = "/repo/src/candidate.txt";
    const fs = createFs({ [docPath]: createDoc({ baseline: 1 }), [candidatePath]: "original\n" });
    const git = createLoopGit({
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => fs.writeFile(candidatePath, "original\n"))
    });
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await fs.writeFile(candidatePath, "unscored candidate\n");
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        output: "candidate",
        agentOutput: "done",
        durationMs: 1
      });
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(
      runExperimentLoop({
        cwd: "/repo",
        homeDir: "/home/user",
        docPath,
        maxExperiments: 1,
        fs,
        git,
        exec: createLoopExec([{ stdout: "2\n", stderr: "", exitCode: 0 }]),
        runAgent,
        onMetricResult: () => { throw new Error("metric observer failed"); }
      })
    ).rejects.toThrow("metric observer failed");

    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
    await expect(fs.readFile(candidatePath, "utf8")).resolves.toBe("original\n");
  });

  it("resets a kept journal entry when the agent process exits non-zero", async () => {
    const docPath = "/repo/.poe-code/experiments/nonzero.md";
    const fs = createFs({ [docPath]: createDoc({ baseline: 1 }) });
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "bad-commit",
        status: "keep",
        scores: { tests: 2 },
        output: "tests improved",
        agentOutput: "failed after writing journal",
        durationMs: 10
      });
      return { stdout: "", stderr: "agent crashed", exitCode: 1 };
    });

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec: createLoopExec([]),
      runAgent
    });

    expect(result.experimentsKept).toBe(0);
    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
  });

  it("skips score computation when agent already provides scores", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 5 })
    });
    const git = createLoopGit({
      currentHash: vi.fn(async () => "baseline-abc")
    });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { tests: 99 },
        output: "done",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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

    expect(exec).not.toHaveBeenCalled();

    const [entry] = (await fs.readFile(journalFilePath(docPath), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as JournalEntry);

    expect(entry).toEqual(
      expect.objectContaining({
        scores: { tests: 99 }
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
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { tests: 2 },
        output: "tests: score=2, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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

  it("inherits metric and body from a matching base when extends is true", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: ["---", "extends: true", "baseline: { tests: 1 }", "---", ""].join("\n"),
      "/repo/.poe-code/experiments/bases/test-duration.md": [
        "---",
        "metric:",
        "  name: tests",
        "  script: node scripts/metric-tests.mjs",
        "  direction: maximize",
        "---",
        "# Base prompt",
        "",
        "Use the shared instructions."
      ].join("\n")
    });
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { tests: 2 },
        output: "tests: score=2, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
        agent: "claude-code"
      })
    );
    expect(runAgent.mock.calls[0]?.[0].prompt).toContain("# Base prompt");
    expect(runAgent.mock.calls[0]?.[0].prompt).toContain("Use the shared instructions.");
    expect(exec).not.toHaveBeenCalled();
  });

  it("falls back to the home base when no matching project base exists", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: ["---", "extends: true", "baseline: { tests: 1 }", "---", ""].join("\n"),
      "/home/user/.poe-code/experiments/bases/test-duration.md": [
        "---",
        "metric:",
        "  name: tests",
        "  script: node scripts/metric-tests.mjs",
        "  direction: maximize",
        "---",
        "# Global base prompt",
        "",
        "Use the home-level instructions."
      ].join("\n")
    });
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { tests: 2 },
        output: "tests: score=2, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
        agent: "claude-code"
      })
    );
    expect(runAgent.mock.calls[0]?.[0].prompt).toContain("# Global base prompt");
    expect(runAgent.mock.calls[0]?.[0].prompt).toContain("Use the home-level instructions.");
    expect(exec).not.toHaveBeenCalled();
  });

  it("keeps the document body while inheriting missing frontmatter from the base", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: [
        "---",
        "extends: true",
        "baseline: { tests: 1 }",
        "---",
        "# Document prompt",
        "",
        "Prefer the local instructions."
      ].join("\n"),
      "/repo/.poe-code/experiments/bases/test-duration.md": [
        "---",
        "metric:",
        "  name: tests",
        "  script: node scripts/metric-tests.mjs",
        "  direction: maximize",
        "---",
        "# Base prompt",
        "",
        "This body should stay a fallback only."
      ].join("\n")
    });
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { tests: 2 },
        output: "tests: score=2, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
        agent: "claude-code"
      })
    );
    expect(runAgent.mock.calls[0]?.[0].prompt).toContain("# Document prompt");
    expect(runAgent.mock.calls[0]?.[0].prompt).toContain("Prefer the local instructions.");
    expect(runAgent.mock.calls[0]?.[0].prompt).not.toContain("# Base prompt");
    expect(exec).not.toHaveBeenCalled();
  });

  it("lets document agent override the defaults agent", async () => {
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
        "---",
        "# Improve the tests"
      ].join("\n")
    });
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { tests: 2 },
        output: "tests: score=2, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
        agent: "codex"
      })
    );
  });

  it("ignores matching bases when the document does not set extends", async () => {
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
        "---",
        "# Document prompt",
        "",
        "Use the local instructions."
      ].join("\n"),
      "/repo/.poe-code/experiments/bases/test-duration.md": [
        "---",
        "agent: codex",
        "metric:",
        "  name: duration",
        "  script: node scripts/metric-duration.mjs",
        "  direction: minimize",
        "---",
        "# Base prompt",
        "",
        "This should not be used."
      ].join("\n")
    });
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { tests: 2 },
        output: "tests: score=2, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
        agent: "claude-code"
      })
    );
    expect(runAgent.mock.calls[0]?.[0].prompt).toContain("# Document prompt");
    expect(runAgent.mock.calls[0]?.[0].prompt).toContain("Use the local instructions.");
    expect(runAgent.mock.calls[0]?.[0].prompt).not.toContain("# Base prompt");
    expect(exec).not.toHaveBeenCalled();
  });

  it("initializes the journal file even when no experiments are run", async () => {
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 })
    });
    const git = createLoopGit();
    const exec = createLoopExec([]);
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
    await expect(fs.readFile(journalFilePath(docPath), "utf8")).resolves.toBe("");
  });

  it("returns cancelled immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const docPath = "/repo/.poe-code/experiments/test-duration.md";
    const fs = createFs({
      [docPath]: createDoc({ baseline: 1 })
    });
    const git = createLoopGit();
    const exec = createLoopExec([]);
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
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { test_count: 100 },
        output: "test_count: score=100, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "base-1",
        status: "discard",
        scores: { test_count: 99 },
        output: "test_count: score=99, passed=false",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { test_count: 103 },
        output: "test_count: score=103, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "base-1",
        status: "discard",
        scores: { test_count: 106 },
        output: "test_count: score=106, passed=false",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { tests: 9 },
        output: "tests: score=9, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { tests: 2 },
        output: "tests: score=2, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    let callIndex = 0;
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      callIndex += 1;
      await appendJournalEntry(fs, docPath, {
        commit: `keep-${callIndex}`,
        status: "keep",
        scores: { tests: callIndex + 1 },
        output: `tests: score=${callIndex + 1}, passed=true`,
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { tests: 2 },
        output: "tests: score=2, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });
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
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { duration: 5050 },
        output: "duration: score=5050, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([{ stdout: "5\n", stderr: "", exitCode: 0 }]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { tests: 7 },
        output: "tests: score=7, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
    expect(keepEntry.scores).toEqual({ tests: 7 });
  });

  it("does not run an agent when automatic baseline collection fails", async () => {
    const docPath = "/repo/.poe-code/experiments/no-baseline.md";
    const fs = createFs({ [docPath]: createDoc({ baseline: null }) });
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));

    await expect(
      runExperimentLoop({
        cwd: "/repo",
        homeDir: "/home/user",
        docPath,
        maxExperiments: 1,
        fs,
        git: createLoopGit(),
        exec: createLoopExec([{ stdout: "failed\n", stderr: "", exitCode: 1 }]),
        runAgent
      })
    ).rejects.toThrow("Unable to collect a passing experiment baseline.");

    expect(runAgent).not.toHaveBeenCalled();
  });

  it("persists one authoritative journal result per agent attempt", async () => {
    const docPath = "/repo/.poe-code/experiments/multiple-results.md";
    const fs = createFs({ [docPath]: createDoc({ baseline: 1 }) });
    const firstGit = createLoopGit({ currentHash: vi.fn(async () => "original") });
    const runAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "hidden-keep",
        status: "keep",
        scores: { tests: 2 },
        output: "keep",
        agentOutput: "done",
        durationMs: 1
      });
      await appendJournalEntry(fs, docPath, {
        commit: "discarded",
        status: "discard",
        scores: { tests: 0 },
        output: "discard",
        agentOutput: "done",
        durationMs: 1
      });
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git: firstGit,
      exec: createLoopExec([]),
      runAgent
    });

    const persisted = await new ExperimentJournal(journalFilePath(docPath), fs).readAll();
    expect(persisted.map((entry) => entry.commit)).toEqual(["discarded"]);

    const secondGit = createLoopGit({ currentHash: vi.fn(async () => "original") });
    const secondRunAgent = vi.fn(async (): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "next-discard",
        status: "discard",
        output: "discard",
        agentOutput: "done",
        durationMs: 1
      });
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 2,
      fs,
      git: secondGit,
      exec: createLoopExec([]),
      runAgent: secondRunAgent
    });

    expect(secondRunAgent).toHaveBeenCalledTimes(1);
    expect(secondGit.reset).toHaveBeenCalledWith("original", "/repo");
    expect(secondGit.reset).not.toHaveBeenCalledWith("hidden-keep", "/repo");
  });

  it("uses max_experiments from frontmatter when not provided via options", async () => {
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
        "max_experiments: 2",
        "---",
        "# Improve the tests"
      ].join("\n")
    });
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    let callIndex = 0;
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      callIndex += 1;
      await appendJournalEntry(fs, docPath, {
        commit: `keep-${callIndex}`,
        status: "keep",
        scores: { tests: callIndex + 1 },
        output: `tests: score=${callIndex + 1}, passed=true`,
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    let callIndex = 0;
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      callIndex += 1;
      await appendJournalEntry(fs, docPath, {
        commit: `keep-${callIndex}`,
        status: "keep",
        scores: { tests: callIndex + 1 },
        output: `tests: score=${callIndex + 1}, passed=true`,
        agentOutput: "I refactored the parser module to reduce allocations",
        durationMs: 100
      });
      return {
        stdout: "I refactored the parser module to reduce allocations",
        stderr: "",
        exitCode: 0
      };
    });

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

  it("collects a fresh baseline when the metric changes between attempts", async () => {
    const docPath = "/repo/.poe-code/experiments/changing-metric.md";
    const fs = createFs({ [docPath]: createDoc({ baseline: 1 }) });
    const exec = createLoopExec([{ stdout: "25\n", stderr: "", exitCode: 0 }]);
    let callIndex = 0;
    const runAgent = vi.fn(async (input: AgentRunInput): Promise<AgentRunResult> => {
      callIndex += 1;
      if (callIndex === 1) {
        await fs.writeFile(
          docPath,
          [
            "---",
            "agent: claude-code",
            "metric:",
            "  name: duration",
            "  script: node scripts/metric-duration.mjs",
            "  direction: minimize",
            "baseline: null",
            "---",
            "# Improve the duration"
          ].join("\n")
        );
        await appendJournalEntry(fs, docPath, {
          commit: "keep-tests",
          status: "keep",
          scores: { tests: 2 },
          output: "tests improved",
          agentOutput: "done",
          durationMs: 1
        });
      } else {
        await appendJournalEntry(fs, docPath, {
          commit: "discard-duration",
          status: "discard",
          output: "discard",
          agentOutput: "done",
          durationMs: 1
        });
      }
      return { stdout: input.prompt, stderr: "", exitCode: 0 };
    });

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 2,
      fs,
      git: createLoopGit(),
      exec,
      runAgent
    });

    expect(exec).toHaveBeenCalledWith("node scripts/metric-duration.mjs", {
      cwd: "/repo",
      timeout: 180_000
    });
    expect(String(runAgent.mock.calls[1]?.[0].prompt)).toContain("duration: minimize, script: `node scripts/metric-duration.mjs`, (baseline: 25)");
  });

  it("does not reuse a baseline when a same-name metric is redefined", async () => {
    const docPath = "/repo/.poe-code/experiments/redefined-metric.md";
    const fs = createFs({ [docPath]: createDoc({ baseline: 1 }) });
    const exec = createLoopExec([{ stdout: "18\n", stderr: "", exitCode: 0 }]);
    let callIndex = 0;
    const runAgent = vi.fn(async (input: AgentRunInput): Promise<AgentRunResult> => {
      callIndex += 1;
      if (callIndex === 1) {
        await fs.writeFile(
          docPath,
          [
            "---",
            "agent: claude-code",
            "metric:",
            "  name: tests",
            "  script: node scripts/metric-duration.mjs",
            "  direction: minimize",
            "baseline: null",
            "---",
            "# Improve the duration"
          ].join("\n")
        );
        await appendJournalEntry(fs, docPath, {
          commit: "keep-quality",
          status: "keep",
          scores: { tests: 2 },
          output: "quality improved",
          agentOutput: "done",
          durationMs: 1
        });
      } else {
        await appendJournalEntry(fs, docPath, {
          commit: "discard-duration",
          status: "discard",
          output: "discard",
          agentOutput: "done",
          durationMs: 1
        });
      }
      return { stdout: input.prompt, stderr: "", exitCode: 0 };
    });

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 2,
      fs,
      git: createLoopGit(),
      exec,
      runAgent
    });

    expect(String(runAgent.mock.calls[1]?.[0].prompt)).toContain("tests: minimize, script: `node scripts/metric-duration.mjs`, (baseline: 18)");
    expect(String(runAgent.mock.calls[1]?.[0].prompt)).not.toContain("(baseline: 2)");
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
    const git = createLoopGit({ currentHash: vi.fn(async () => "base-1") });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { tests: 2 },
        output: "tests: score=2, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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
    const git = createLoopGit({ currentHash: vi.fn(async () => "abc1234") });
    const exec = createLoopExec([]);
    const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => {
      await appendJournalEntry(fs, docPath, {
        commit: "keep-1",
        status: "keep",
        scores: { tests: 2 },
        output: "tests: score=2, passed=true",
        agentOutput: "done",
        durationMs: 100
      });
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

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

describe("createExperimentLoopSimulation", () => {
  it("keeps a single-metric experiment when the score improves", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 1,
      docContent: createExperimentDoc({
        baseline: { tests: 1 }
      }),
      files: {
        "src/index.ts": "export const value = 1;\n"
      },
      turns: [
        agentMakesChanges({
          "src/index.ts": "export const value = 2;\n"
        })
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": metricResult({ score: 2 })
      }
    });

    const { result, readFile, readJournal } = await sim.run();
    const entries = await readJournal();

    expect(result).toMatchObject({
      stopReason: "max_experiments",
      experimentsCompleted: 1,
      experimentsKept: 1
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        status: "keep",
        scores: { tests: 2 }
      })
    );
    expect(await readFile("src/index.ts")).toBe("export const value = 2;\n");
  });

  it("applies agent file changes when paths are absolute", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 1,
      docContent: createExperimentDoc({
        baseline: { tests: 1 }
      }),
      files: {
        "src/index.ts": "export const value = 1;\n"
      },
      turns: [
        agentMakesChanges({
          "/repo/src/index.ts": "export const value = 2;\n"
        })
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": metricResult({ score: 2 })
      }
    });

    const { readFile } = await sim.run();

    expect(await readFile("src/index.ts")).toBe("export const value = 2;\n");
  });

  it("discards a single-metric experiment when the score does not improve", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 1,
      docContent: createExperimentDoc({
        baseline: { tests: 2 }
      }),
      files: {
        "src/index.ts": "export const value = 1;\n"
      },
      turns: [
        agentMakesChanges({
          "src/index.ts": "export const value = 99;\n"
        })
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": metricResult({ score: 2 })
      }
    });

    const { result, git, readFile, readJournal } = await sim.run();
    const entries = await readJournal();

    expect(result.experimentsKept).toBe(0);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        status: "discard",
        scores: { tests: 2 }
      })
    );
    expect(await readFile("src/index.ts")).toBe("export const value = 1;\n");
    expect(git.resetCalls).toEqual([{ commitHash: "base-1", cwd: "/repo" }]);
  });

  it("keeps a metric chain when every score passes and improves", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 1,
      docContent: createExperimentDoc({
        metric: [
          { name: "tests", script: "node scripts/metric-tests.mjs", direction: "maximize" },
          {
            name: "test_duration",
            script: "node scripts/metric-duration.mjs",
            direction: "minimize"
          }
        ],
        baseline: {
          tests: 1,
          test_duration: 10
        }
      }),
      turns: [
        agentMakesChanges({
          "src/index.ts": "export const faster = true;\n"
        })
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": metricResult({ score: 2 }),
        "node scripts/metric-duration.mjs": metricResult({ score: 9 })
      }
    });

    const { result, execCalls, readJournal } = await sim.run();
    const [entry] = await readJournal();

    expect(result.experimentsKept).toBe(1);
    expect(entry).toEqual(
      expect.objectContaining({
        status: "keep",
        scores: { tests: 2, test_duration: 9 }
      })
    );
    expect(execCalls.map((call) => call.command)).toEqual([
      "node scripts/metric-tests.mjs",
      "node scripts/metric-duration.mjs"
    ]);
  });

  it("short-circuits a metric chain when the first metric fails", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 1,
      docContent: createExperimentDoc({
        metric: [
          { name: "tests", script: "node scripts/metric-tests.mjs", direction: "maximize" },
          {
            name: "test_duration",
            script: "node scripts/metric-duration.mjs",
            direction: "minimize"
          }
        ],
        baseline: {
          tests: 1,
          test_duration: 10
        }
      }),
      turns: [agentMakesChanges()],
      metricResults: {
        "node scripts/metric-tests.mjs": metricResult({ score: 0, exitCode: 1 }),
        "node scripts/metric-duration.mjs": metricResult({ score: 9 })
      }
    });

    const { execCalls, readJournal } = await sim.run();
    const [entry] = await readJournal();

    expect(entry?.status).toBe("discard");
    expect(execCalls.map((call) => call.command)).toEqual(["node scripts/metric-tests.mjs"]);
  });

  it("discards a metric chain when the second metric fails", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 1,
      docContent: createExperimentDoc({
        metric: [
          { name: "tests", script: "node scripts/metric-tests.mjs", direction: "maximize" },
          {
            name: "test_duration",
            script: "node scripts/metric-duration.mjs",
            direction: "minimize"
          }
        ],
        baseline: {
          tests: 1,
          test_duration: 10
        }
      }),
      turns: [agentMakesChanges()],
      metricResults: {
        "node scripts/metric-tests.mjs": metricResult({ score: 2 }),
        "node scripts/metric-duration.mjs": metricResult({ score: 11, exitCode: 1 })
      }
    });

    const { execCalls, readJournal } = await sim.run();
    const [entry] = await readJournal();

    expect(entry?.status).toBe("discard");
    expect(execCalls.map((call) => call.command)).toEqual([
      "node scripts/metric-tests.mjs",
      "node scripts/metric-duration.mjs"
    ]);
  });

  it("injects prior journal entries into later agent prompts", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 2,
      docContent: createExperimentDoc({
        baseline: { tests: 1 }
      }),
      turns: [
        agentMakesChanges({
          "src/index.ts": "export const step = 1;\n"
        }),
        agentMakesChanges(
          {
            "src/index.ts": "export const step = 2;\n"
          },
          {
            assertPrompt: (prompt) => {
              expect(prompt).toContain(
                "commit\tstatus\tscores\tdurationMs\ttimestamp\toutput\tagentOutput"
              );
              expect(prompt).toContain("commit-1\tkeep\t{");
            }
          }
        )
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": [metricResult({ score: 2 }), metricResult({ score: 3 })]
      }
    });

    const { result } = await sim.run();

    expect(result.experimentsKept).toBe(2);
  });

  it("returns a cancelled stop reason when the abort signal fires", async () => {
    const controller = new AbortController();
    const sim = createExperimentLoopSimulation({
      maxExperiments: 3,
      signal: controller.signal,
      docContent: createExperimentDoc({
        baseline: { tests: 1 }
      }),
      turns: [
        agentMakesChanges(
          {
            "src/index.ts": "export const done = true;\n"
          },
          {
            assertPrompt: () => {
              controller.abort();
            }
          }
        )
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": metricResult({ score: 2 })
      }
    });

    const { result } = await sim.run();

    expect(result).toMatchObject({
      stopReason: "cancelled",
      experimentsCompleted: 1,
      experimentsKept: 1
    });
  });

  it("re-reads the prompt from disk on each iteration", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 2,
      docContent: createExperimentDoc({
        baseline: { tests: 1 },
        body: "# Original prompt\n\nDo the original thing.\n"
      }),
      turns: [
        agentMakesChanges(
          { "src/a.ts": "1" },
          {
            assertPrompt: async (_prompt, ctx) => {
              const doc = await ctx.readFile("/repo/.poe-code/experiments/plan.md");
              const updated = doc.replace("Original prompt", "Updated prompt");
              await ctx.writeFile("/repo/.poe-code/experiments/plan.md", updated);
            }
          }
        ),
        agentMakesChanges(
          { "src/b.ts": "2" },
          {
            assertPrompt: (prompt) => {
              expect(prompt).toContain("Updated prompt");
            }
          }
        )
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": [metricResult({ score: 2 }), metricResult({ score: 3 })]
      }
    });

    const { result } = await sim.run();

    expect(result.experimentsKept).toBe(2);
  });

  it("preserves user edits when persistDoc writes back", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 2,
      docContent: createExperimentDoc({
        baseline: { tests: 1 },
        body: "# Speed up tests\n\nOriginal constraints.\n"
      }),
      turns: [
        agentMakesChanges(
          { "src/a.ts": "1" },
          {
            assertPrompt: async (_prompt, ctx) => {
              const doc = await ctx.readFile("/repo/.poe-code/experiments/plan.md");
              const updated = doc.replace("Original constraints", "New constraints added by user");
              await ctx.writeFile("/repo/.poe-code/experiments/plan.md", updated);
            }
          }
        ),
        agentMakesChanges({ "src/b.ts": "2" })
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": [metricResult({ score: 2 }), metricResult({ score: 3 })]
      }
    });

    const { readDoc } = await sim.run();
    const doc = await readDoc();

    expect(doc).toContain("New constraints added by user");
  });

  it("collects baseline from metrics when baseline is null", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 1,
      docContent: createExperimentDoc({
        baseline: null
      }),
      turns: [agentMakesChanges({ "src/a.ts": "1" })],
      metricResults: {
        "node scripts/metric-tests.mjs": [metricResult({ score: 5 }), metricResult({ score: 6 })]
      }
    });

    const { result, readJournal } = await sim.run();
    const entries = await readJournal();

    expect(entries.at(-1)).toEqual(
      expect.objectContaining({ status: "keep", scores: { tests: 6 } })
    );
    expect(result.experimentsKept).toBe(1);
  });

  it("cycles agents round-robin across experiments", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 4,
      docContent: createExperimentDoc({
        agent: ["claude-code", "codex"],
        baseline: { tests: 1 }
      }),
      turns: [
        agentMakesChanges({ "src/a.ts": "1" }),
        agentMakesChanges({ "src/b.ts": "2" }),
        agentMakesChanges({ "src/c.ts": "3" }),
        agentMakesChanges({ "src/d.ts": "4" })
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": [
          metricResult({ score: 2 }),
          metricResult({ score: 3 }),
          metricResult({ score: 4 }),
          metricResult({ score: 5 })
        ]
      }
    });

    const { runs } = await sim.run();

    expect(runs.map((run) => run.agent)).toEqual(["claude-code", "codex", "claude-code", "codex"]);
  });
});
