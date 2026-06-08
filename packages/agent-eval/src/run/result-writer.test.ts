import { createFsFromVolume, vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalRunResult } from "../types.js";
import type { NormalizedTrace } from "./trace/types.js";

const mocks = vi.hoisted(() => ({
  failedRenameTarget: undefined as string | undefined,
  randomUUIDs: [] as string[],
  randomUUIDCounter: 0
}));

vi.mock("node:crypto", () => ({
  randomUUID: () => mocks.randomUUIDs.shift() ?? `fallback-uuid-${mocks.randomUUIDCounter += 1}`
}));

vi.mock("node:fs/promises", () => {
  const fs = createFsFromVolume(vol).promises;
  return {
    lstat: fs.lstat.bind(fs),
    mkdir: fs.mkdir.bind(fs),
    readFile: fs.readFile.bind(fs),
    rename: async (sourcePath: string, targetPath: string) => {
      if (targetPath === mocks.failedRenameTarget) {
        throw new Error("simulated commit failure");
      }
      await fs.rename(sourcePath, targetPath);
    },
    rm: fs.rm.bind(fs),
    writeFile: fs.writeFile.bind(fs)
  };
});

const { writeRunArtifacts, writeRunCompletion, writeRunEvidence, writeRunResult } = await import(
  "./result-writer.js"
);

describe("writeRunArtifacts", () => {
  beforeEach(() => {
    vol.reset();
    mocks.failedRenameTarget = undefined;
    mocks.randomUUIDs = [];
    mocks.randomUUIDCounter = 0;
  });

  it("writes all required artifacts and omits judge.json when the judge did not run", async () => {
    await writeRunArtifacts("/runs/run-1", {
      result: createResult(),
      events: [{ sessionUpdate: "tool_call", toolCall: "read" }],
      trace: createTrace(),
      cheatReport: { cheated: false, violations: [] },
      planMd: "# Plan\n",
      evalYaml: "id: task\n"
    });

    expect(JSON.parse(await readText("/runs/run-1/result.json"))).toEqual(createResult());
    expect(await readText("/runs/run-1/events.jsonl")).toBe(
      `${JSON.stringify({ sessionUpdate: "tool_call", toolCall: "read" })}\n`
    );
    expect(JSON.parse(await readText("/runs/run-1/trace.json"))).toEqual(createTrace());
    expect(JSON.parse(await readText("/runs/run-1/cheat-report.json"))).toEqual({
      cheated: false,
      violations: []
    });
    expect(await readText("/runs/run-1/plan.md")).toBe("# Plan\n");
    expect(await readText("/runs/run-1/eval.yaml")).toBe("id: task\n");
    await expect(readText("/runs/run-1/judge.json")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes judge.json when the judge ran", async () => {
    await writeRunArtifacts("/runs/run-1", {
      result: createResult({ judge: { completeness: 4, mean: 4 } }),
      events: [],
      trace: createTrace(),
      cheatReport: { cheated: false, violations: [] },
      judge: { completeness: 4, mean: 4 },
      planMd: "# Plan\n",
      evalYaml: "id: task\n"
    });

    expect(await readText("/runs/run-1/events.jsonl")).toBe("");
    expect(JSON.parse(await readText("/runs/run-1/judge.json"))).toEqual({
      completeness: 4,
      mean: 4
    });
  });

  it("rejects an evidence directory symlink before writing artifacts", async () => {
    const { fs } = await import("memfs");
    await fs.promises.mkdir("/outside", { recursive: true });
    await fs.promises.mkdir("/runs", { recursive: true });
    await fs.promises.symlink("/outside", "/runs/run-1");

    await expect(
      writeRunArtifacts("/runs/run-1", {
        result: createResult(),
        events: [],
        trace: createTrace(),
        cheatReport: { cheated: false, violations: [] },
        planMd: "# Plan\n",
        evalYaml: "id: task\n"
      })
    ).rejects.toThrow("Run artifact directory must not be a symbolic link.");
    await expect(readText("/outside/plan.md")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symlinked evidence parent before writing artifacts", async () => {
    const { fs } = await import("memfs");
    await fs.promises.mkdir("/outside", { recursive: true });
    await fs.promises.symlink("/outside", "/runs");

    await expect(
      writeRunArtifacts("/runs/run-1", {
        result: createResult(),
        events: [],
        trace: createTrace(),
        cheatReport: { cheated: false, violations: [] },
        planMd: "# Plan\n",
        evalYaml: "id: task\n"
      })
    ).rejects.toThrow(/symbolic link/);
    await expect(readText("/outside/plan.md")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls back newly committed evidence when one artifact commit fails", async () => {
    mocks.failedRenameTarget = "/runs/run-1/trace.json";

    await expect(
      writeRunEvidence("/runs/run-1", {
        events: [{ sessionUpdate: "tool_call", toolCall: "read" }],
        trace: createTrace(),
        cheatReport: { cheated: false, violations: [] },
        planMd: "# Plan\n",
        evalYaml: "id: task\n"
      })
    ).rejects.toThrow("simulated commit failure");

    for (const fileName of ["events.jsonl", "trace.json", "cheat-report.json", "plan.md", "eval.yaml"]) {
      await expect(readText(`/runs/run-1/${fileName}`)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("preserves the prior completion pair when a replacement commit fails", async () => {
    const { fs } = await import("memfs");
    await fs.promises.mkdir("/runs/run-1", { recursive: true });
    await fs.promises.writeFile(
      "/runs/run-1/result.json",
      `${JSON.stringify(createResult({ correctness: 0, judge: { completeness: 1, mean: 1 } }))}\n`
    );
    await fs.promises.writeFile(
      "/runs/run-1/judge.json",
      `${JSON.stringify({ completeness: 1, mean: 1 })}\n`
    );
    mocks.failedRenameTarget = "/runs/run-1/result.json";

    await expect(
      writeRunCompletion("/runs/run-1", {
        result: createResult({ judge: { completeness: 5, mean: 5 } }),
        judge: { completeness: 5, mean: 5 }
      })
    ).rejects.toThrow("simulated commit failure");

    expect(JSON.parse(await readText("/runs/run-1/judge.json"))).toEqual({ completeness: 1, mean: 1 });
    expect(JSON.parse(await readText("/runs/run-1/result.json"))).toMatchObject({
      correctness: 0,
      judge: { mean: 1 }
    });
  });

  it("restores the prior result when the judge replacement fails", async () => {
    const { fs } = await import("memfs");
    await fs.promises.mkdir("/runs/run-1", { recursive: true });
    await fs.promises.writeFile(
      "/runs/run-1/result.json",
      `${JSON.stringify(createResult({ correctness: 0, judge: { completeness: 1, mean: 1 } }))}\n`
    );
    await fs.promises.writeFile(
      "/runs/run-1/judge.json",
      `${JSON.stringify({ completeness: 1, mean: 1 })}\n`
    );
    mocks.failedRenameTarget = "/runs/run-1/judge.json";

    await expect(
      writeRunCompletion("/runs/run-1", {
        result: createResult({ judge: { completeness: 5, mean: 5 } }),
        judge: { completeness: 5, mean: 5 }
      })
    ).rejects.toThrow("simulated commit failure");

    expect(JSON.parse(await readText("/runs/run-1/judge.json"))).toEqual({ completeness: 1, mean: 1 });
    expect(JSON.parse(await readText("/runs/run-1/result.json"))).toMatchObject({
      correctness: 0,
      judge: { mean: 1 }
    });
  });

  it("does not follow or remove a colliding temporary result symlink", async () => {
    const { fs } = await import("memfs");
    const collisionPath = `/runs/run-1/.result.json.${process.pid}.collision.tmp`;
    await fs.promises.mkdir("/runs/run-1", { recursive: true });
    await fs.promises.mkdir("/outside", { recursive: true });
    await fs.promises.writeFile("/outside/result-tmp.json", "outside-state\n");
    await fs.promises.symlink("/outside/result-tmp.json", collisionPath);
    mocks.randomUUIDs = ["collision", "safe"];

    await writeRunResult("/runs/run-1", createResult());

    expect(await readText("/outside/result-tmp.json")).toBe("outside-state\n");
    expect((await fs.promises.lstat(collisionPath)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await readText("/runs/run-1/result.json"))).toEqual(createResult());
  });
});

async function readText(path: string): Promise<string> {
  const { fs } = await import("memfs");
  return fs.promises.readFile(path, "utf8") as Promise<string>;
}

function createTrace(): NormalizedTrace {
  return {
    events: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0
    }
  };
}

function createResult(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
  return {
    runId: "run-1",
    eval: "task",
    agent: "codex",
    model: "openai/gpt-5",
    planKind: "plan",
    verdict: "pass",
    correctness: 1,
    iterations: 0,
    durationMs: 1,
    usage: {
      inputTokens: 0,
      outputTokens: 0
    },
    tests: {
      passed: 1,
      total: 1,
      pass_rate: 1,
      cases: []
    },
    scoring: {
      tests: {
        configured: true,
        required: true,
        configuredWeight: 1,
        effectiveWeight: 1,
        status: "executed"
      },
      judge: {
        configured: true,
        required: false,
        configuredWeight: 0,
        effectiveWeight: 0,
        status: "disabled",
        reason: "disabled"
      }
    },
    cheated: false,
    cheatReport: {
      cheated: false,
      violations: []
    },
    ...overrides
  };
}
