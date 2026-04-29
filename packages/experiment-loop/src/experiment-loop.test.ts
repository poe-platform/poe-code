import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import {
  experimentDocumentSchema,
  experimentDocumentSchemaId,
  parseExperimentFrontmatter,
  writeExperimentFrontmatter
} from "./frontmatter/frontmatter.js";
import { runExperimentLoop } from "./run/loop.js";
import type { ExecFn, ExperimentFileSystem } from "./types.js";

function createFs(files: Record<string, string> = {}): ExperimentFileSystem {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
}

async function createGitRepo(): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "poe-code-experiment-loop-"));

  execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Codex"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "codex@example.com"], {
    cwd: repoRoot,
    stdio: "ignore"
  });

  await fs.writeFile(path.join(repoRoot, "README.md"), "# Repo\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "chore: init"], { cwd: repoRoot, stdio: "ignore" });

  return repoRoot;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dirPath) => {
      await fs.rm(dirPath, { recursive: true, force: true });
    })
  );
});

describe("@poe-code/experiment-loop public exports", () => {
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
        agents: { type: "object" },
        metric: {},
        maxKept: { type: "integer" }
      },
      required: ["kind", "version"]
    });
  });
});

describe("parseExperimentFrontmatter", () => {
  it("parses declarative harness data and preserves the script body", () => {
    const content = [
      "---",
      "$schema: https://poe-platform.github.io/poe-code/schemas/plans/experiment.schema.json",
      "kind: experiment",
      "version: 1",
      "agents:",
      "  experimenter:",
      "    agent: claude-code",
      "    prompt: Improve the tests",
      "metric:",
      "  - name: tests",
      "    direction: maximize",
      "  - name: duration",
      "    direction: minimize",
      "maxKept: 3",
      "---",
      "```js",
      'return "ok";',
      "```"
    ].join("\n");

    expect(parseExperimentFrontmatter(content)).toEqual({
      frontmatter: {
        agents: {
          experimenter: {
            agent: "claude-code",
            prompt: "Improve the tests"
          }
        },
        metric: [
          {
            name: "tests",
            direction: "maximize"
          },
          {
            name: "duration",
            direction: "minimize"
          }
        ],
        maxKept: 3
      },
      body: ['```js', 'return "ok";', "```"].join("\n")
    });
  });

  it("returns empty frontmatter when the markdown has no frontmatter", () => {
    expect(parseExperimentFrontmatter("# Experiment\n")).toEqual({
      frontmatter: {},
      body: "# Experiment\n"
    });
  });
});

describe("writeExperimentFrontmatter", () => {
  it("round-trips the declarative frontmatter and body", async () => {
    const fs = createFs();
    const docPath = "/repo/docs/plans/experiment.md";

    await writeExperimentFrontmatter(
      docPath,
      {
        agents: {
          experimenter: {
            agent: "claude-code",
            prompt: "Ship a focused improvement"
          }
        },
        metric: {
          name: "tests",
          direction: "maximize"
        },
        maxKept: 5
      },
      ['```js', 'return "done";', "```", ""].join("\n"),
      fs
    );

    const written = await fs.readFile(docPath, "utf8");

    expect(written).toContain("agents:\n");
    expect(written).toContain("maxKept: 5\n");
    expect(parseExperimentFrontmatter(written)).toEqual({
      frontmatter: {
        agents: {
          experimenter: {
            agent: "claude-code",
            prompt: "Ship a focused improvement"
          }
        },
        metric: {
          name: "tests",
          direction: "maximize"
        },
        maxKept: 5
      },
      body: ['```js', 'return "done";', "```", ""].join("\n")
    });
  });
});

describe("runExperimentLoop", () => {
  it("runs the markdown js block through runHarness with the registered modules", async () => {
    const cwd = await createGitRepo();
    tempDirs.push(cwd);
    const homeDir = path.join(cwd, ".home");
    const docPath = path.join(cwd, ".poe-code/experiments/plan.md");
    const onExperimentStart = vi.fn();
    const onMetricResult = vi.fn();

    await fs.mkdir(path.dirname(docPath), { recursive: true });
    await fs.writeFile(
      docPath,
      [
        "---",
        "$schema: https://poe-platform.github.io/poe-code/schemas/plans/experiment.schema.json",
        "kind: experiment",
        "version: 1",
        "agents:",
        "  experimenter:",
        "    agent: claude-code",
        "    prompt: Improve the metric",
        "metric:",
        "  name: tests",
        "  direction: maximize",
        "maxKept: 2",
        "---",
        "",
        "```js",
        'import { spawn } from "agent";',
        'import { agents, meta } from "harness";',
        'import { head } from "git";',
        'import { event } from "log";',
        'import { run as runMetric } from "metric";',
        'import { now, uuid } from "time";',
        "",
        'event("experiment.start", { index: 1, agent: agents.experimenter.agent });',
        "return {",
        '  stopReason: "max_kept",',
        "  experimentsCompleted: 1,",
        "  experimentsKept: 1,",
        "  totalDurationMs: 7,",
        "  gitHead: await head(),",
        "  metricScore: await runMetric(meta.frontmatter.metric.name),",
        '  summary: (await spawn(agents.experimenter, { prompt: "Run the experiment" })).summary,',
        "  maxKept: meta.frontmatter.maxKept,",
        "  hasUuid: uuid()",
        "};",
        "```",
        ""
      ].join("\n"),
      "utf8"
    );

    const exec = vi.fn(async (command: string) => {
      if (command === "npm run --silent 'metric:tests'") {
        return {
          stdout: "42\n",
          stderr: "",
          exitCode: 0
        };
      }

      throw new Error(`Unexpected exec call: ${command}`);
    }) as ExecFn;

    const result = await runExperimentLoop({
      cwd,
      homeDir,
      docPath,
      exec,
      onExperimentStart,
      onMetricResult,
      runAgent: vi.fn(async (input) => ({
        stdout: `agent:${input.agent}`,
        stderr: "",
        exitCode: 0
      }))
    });

    expect(result).toEqual({
      stopReason: "max_kept",
      docPath,
      experimentsCompleted: 1,
      experimentsKept: 1,
      totalDurationMs: 7
    });
    expect(onExperimentStart).toHaveBeenCalledWith(1, "claude-code");
    expect(onMetricResult).toHaveBeenCalledWith(
      {
        name: "tests",
        direction: "maximize"
      },
      {
        score: 42,
        passed: true,
        output: "42\n"
      }
    );
    expect(exec).toHaveBeenCalledWith("npm run --silent 'metric:tests'", {
      cwd
    });
  });

  it("exposes runtime overrides to the harness script", async () => {
    const cwd = await createGitRepo();
    tempDirs.push(cwd);
    const homeDir = path.join(cwd, ".home");
    const docPath = path.join(cwd, ".poe-code/experiments/plan.md");

    await fs.mkdir(path.dirname(docPath), { recursive: true });
    await fs.writeFile(
      docPath,
      [
        "---",
        "$schema: https://poe-platform.github.io/poe-code/schemas/plans/experiment.schema.json",
        "kind: experiment",
        "version: 1",
        "agents:",
        "  experimenter:",
        "    agent: claude-code",
        "metric:",
        "  name: tests",
        "  direction: maximize",
        "maxKept: 2",
        "---",
        "",
        "```js",
        'import { agents, meta } from "harness";',
        "return {",
        '  stopReason: "max_experiments",',
        "  experimentsCompleted: meta.frontmatter.maxExperiments,",
        "  experimentsKept: meta.frontmatter.maxKept,",
        "  totalDurationMs: meta.frontmatter.maxExperiments,",
        "  agent: agents.experimenter.agent",
        "};",
        "```",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = await runExperimentLoop({
      cwd,
      homeDir,
      docPath,
      agent: "codex",
      maxExperiments: 3,
      runAgent: vi.fn(async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0
      }))
    });

    expect(result).toEqual({
      stopReason: "max_experiments",
      docPath,
      experimentsCompleted: 3,
      experimentsKept: 2,
      totalDurationMs: 3
    });
  });

  it("rejects experiment docs without a fenced js block", async () => {
    const cwd = await createGitRepo();
    tempDirs.push(cwd);
    const homeDir = path.join(cwd, ".home");
    const docPath = path.join(cwd, ".poe-code/experiments/legacy.md");

    await fs.mkdir(path.dirname(docPath), { recursive: true });
    await fs.writeFile(
      docPath,
      [
        "---",
        "$schema: https://poe-platform.github.io/poe-code/schemas/plans/experiment.schema.json",
        "kind: experiment",
        "version: 1",
        "agents:",
        "  experimenter:",
        "    agent: claude-code",
        "metric:",
        "  name: tests",
        "  direction: maximize",
        "---",
        "",
        "# Legacy brief",
        "",
        "This used to be prose, not a harness script."
      ].join("\n"),
      "utf8"
    );

    await expect(
      runExperimentLoop({
        cwd,
        homeDir,
        docPath,
        runAgent: vi.fn(async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0
        }))
      })
    ).rejects.toThrow(/fenced `js` block/i);
  });
});
