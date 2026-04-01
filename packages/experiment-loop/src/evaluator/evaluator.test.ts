import { describe, expect, it, vi } from "vitest";
import { evaluate, evaluateChain } from "./evaluator.js";
import type { ExecFn, MetricDef } from "../types.js";

function createExec(
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

describe("evaluate", () => {
  it("returns a passing result when the metric exits 0 with a valid score", async () => {
    const { exec, execMock } = createExec([
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
    const { exec } = createExec([
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
    const { exec } = createExec([
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

  it("parses the score from the last non-empty stdout line", async () => {
    const { exec } = createExec([
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
    const { exec, execMock } = createExec([
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
    const { exec, execMock } = createExec([
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
    const { exec, execMock } = createExec([
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
    const { exec, execMock } = createExec([
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
