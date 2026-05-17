import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runCli } from "./cli.js";

function createSink(): {
  output: () => string;
  write: (chunk: string) => void;
} {
  const chunks: string[] = [];

  return {
    output: () => chunks.join(""),
    write: (chunk) => {
      chunks.push(chunk);
    }
  };
}

function readLastJsonLine(output: string): unknown {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return JSON.parse(lines.at(-1) ?? "");
}

describe("agent-script CLI", () => {
  it("prints usage and exits zero for help", async () => {
    const stdout = createSink();
    const stderr = createSink();

    const exitCode = await runCli(["--help"], { stdout, stderr });

    expect(exitCode).toBe(0);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("Usage: node --experimental-strip-types");
    expect(stderr.output()).toContain("user-script mode");
    expect(stderr.output()).toContain("demo fallback mode");
  });

  it("prints usage when no filepath is provided", async () => {
    const stdout = createSink();
    const stderr = createSink();

    const exitCode = await runCli([], { stdout, stderr });

    expect(exitCode).toBe(1);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("Usage: node --experimental-strip-types");
  });

  it.each([
    [
      "single-file pipeline",
      "pipeline.md",
      {
        kind: "pipeline",
        taskIds: ["inspect-worktree", "review-diff"]
      }
    ],
    [
      "superintendent document",
      "superintendent.md",
      {
        kind: "superintendent",
        rounds: 1,
        inspectors: 3
      }
    ],
    [
      "experiment loop",
      "experiment.md",
      {
        kind: "experiment",
        kept: 2,
        baseline: 10
      }
    ]
  ])("runs the %s example end-to-end", async (_label, filename, expected) => {
    const stdout = createSink();
    const stderr = createSink();
    const cwd = path.join(process.cwd(), "packages/agent-script");
    const filepath = path.join("examples", filename);

    const exitCode = await runCli([filepath], { cwd, stdout, stderr });

    expect(exitCode).toBe(0);
    expect(stderr.output()).toBe("");
    expect(readLastJsonLine(stdout.output())).toEqual({
      ok: true,
      returnValue: expected
    });
  });

  it("runs a markdown js block and prints the result envelope", async () => {
    const stdout = createSink();
    const stderr = createSink();

    const exitCode = await runCli(["script.md"], {
      readFile: async () =>
        ["---", "kind: custom", "---", "", "```js", "return 42;", "```"].join("\n"),
      stdout,
      stderr
    });

    expect(exitCode).toBe(0);
    expect(stderr.output()).toBe("");
    expect(stdout.output()).toBe(`${JSON.stringify({ ok: true, returnValue: 42 })}\n`);
  });

  it("writes fixed markdown back to disk when --fix is passed", async () => {
    const stdout = createSink();
    const stderr = createSink();
    const writeFile = vi.fn();

    const exitCode = await runCli(["--fix", "script.md"], {
      readFile: async () =>
        [
          "---",
          "kind: custom",
          "---",
          "",
          "```js",
          'const x = "ok";',
          "const value = `${x}`;",
          "return value;",
          "```"
        ].join("\n"),
      stdout,
      stderr,
      writeFile
    });

    expect(exitCode).toBe(0);
    expect(stderr.output()).toBe("");
    expect(writeFile).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "script.md"),
      [
        "---",
        "kind: custom",
        "---",
        "",
        "```js",
        'const x = "ok";',
        "const value = String(x);",
        "return value;",
        "```"
      ].join("\n"),
      { encoding: "utf8" }
    );
  });

  it("prints lint warnings without failing the script", async () => {
    const stdout = createSink();
    const stderr = createSink();

    const exitCode = await runCli(["script.md"], {
      readFile: async () =>
        ["```js", "if (false) {", "  while (true) {}", "}", "return 42;", "```"].join("\n"),
      stdout,
      stderr
    });

    expect(exitCode).toBe(0);
    expect(stdout.output()).toBe(`${JSON.stringify({ ok: true, returnValue: 42 })}\n`);
    expect(stderr.output()).toContain("Lint warnings:");
    expect(stderr.output()).toContain("AS-UNBOUNDED-LOOP");
  });

  it("prints script errors and exits non-zero", async () => {
    const stdout = createSink();
    const stderr = createSink();

    const exitCode = await runCli(["script.md"], {
      readFile: async () => ["```js", 'throw Error("boom");', "```"].join("\n"),
      stdout,
      stderr
    });

    expect(exitCode).toBe(1);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("boom");
  });

  it("falls back to the bundled pipeline demo when no js block exists", async () => {
    const stdout = createSink();
    const stderr = createSink();

    const exitCode = await runCli(["pipeline.md"], {
      readFile: async () =>
        [
          "---",
          "kind: pipeline-demo",
          "version: 1",
          "agents:",
          "  builder:",
          "    agent: claude-code",
          "  reviewer:",
          "    agent: claude-code",
          "tasks:",
          "  - id: inspect-worktree",
          "    title: Inspect worktree",
          "    prompt: Summarize the worktree.",
          "  - id: review-diff",
          "    title: Review diff",
          "    prompt: Review the diff.",
          "---",
          "",
          "# Pipeline demo"
        ].join("\n"),
      stdout,
      stderr
    });

    expect(exitCode).toBe(0);
    expect(stderr.output()).toBe("");
    expect(readLastJsonLine(stdout.output())).toEqual({
      ok: true,
      returnValue: {
        kind: "pipeline-demo",
        taskIds: ["inspect-worktree", "review-diff"]
      }
    });
  });

  it("fails clearly when no js block exists and the demo kind is unknown", async () => {
    const stdout = createSink();
    const stderr = createSink();

    const exitCode = await runCli(["unknown.md"], {
      readFile: async () => ["---", "kind: unknown-demo", "---", "", "# Unknown"].join("\n"),
      stdout,
      stderr
    });

    expect(exitCode).toBe(1);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("Unsupported demo kind: unknown-demo");
  });

  it("exits non-zero before running when the js block fails lint", async () => {
    const stdout = createSink();
    const stderr = createSink();

    const exitCode = await runCli(["lint.md"], {
      readFile: async () =>
        ["```js", 'import { missing } from "agent";', "return missing();", "```"].join("\n"),
      stdout,
      stderr
    });

    expect(exitCode).toBe(1);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("Lint failed");
    expect(stderr.output()).toContain("does not export 'missing'");
  });

  it("returns an error when the markdown file does not exist", async () => {
    const stdout = createSink();
    const stderr = createSink();

    const exitCode = await runCli(["examples/missing.md"], {
      cwd: path.join(process.cwd(), "packages/agent-script"),
      stdout,
      stderr
    });

    expect(exitCode).toBe(1);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("ENOENT");
  });
});
