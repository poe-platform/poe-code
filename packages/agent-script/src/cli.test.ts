import path from "node:path";

import { describe, expect, it } from "vitest";

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
