import { createFsFromVolume, Volume } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalRunOptions, EvalRunResult } from "../types.js";

const mocks = vi.hoisted(() => ({
  fs: undefined as unknown as ReturnType<typeof createFsFromVolume>["promises"],
  failAggregates: false,
  failAggregateRenames: false,
  failAggregateTempExistsOnce: false,
  runEval: vi.fn<[EvalRunOptions], Promise<EvalRunResult>>()
}));

vi.mock("node:fs/promises", () => ({
  mkdir: (...args: unknown[]) => mocks.fs.mkdir(...(args as Parameters<typeof mocks.fs.mkdir>)),
  lstat: (...args: unknown[]) => mocks.fs.lstat(...(args as Parameters<typeof mocks.fs.lstat>)),
  rename: async (...args: unknown[]) => {
    const [, targetPath] = args as Parameters<typeof mocks.fs.rename>;
    if (mocks.failAggregateRenames && String(targetPath).includes("/aggregate-")) {
      throw new Error("aggregate commit failed");
    }
    await mocks.fs.rename(...(args as Parameters<typeof mocks.fs.rename>));
  },
  rm: (...args: unknown[]) => mocks.fs.rm(...(args as Parameters<typeof mocks.fs.rm>)),
  writeFile: async (...args: unknown[]) => {
    const [targetPath] = args as Parameters<typeof mocks.fs.writeFile>;
    if (
      mocks.failAggregateTempExistsOnce &&
      String(targetPath).includes("aggregate-") &&
      String(targetPath).endsWith(".tmp")
    ) {
      mocks.failAggregateTempExistsOnce = false;
      throw new Error("aggregate temp exists");
    }
    if (mocks.failAggregates && String(targetPath).includes("aggregate-")) {
      await mocks.fs.writeFile(...(args as Parameters<typeof mocks.fs.writeFile>));
      throw new Error("aggregate publication failed");
    }
    await mocks.fs.writeFile(...(args as Parameters<typeof mocks.fs.writeFile>));
  }
}));
vi.mock("./run.js", () => ({ runEval: mocks.runEval }));
vi.mock("../source/open.js", () => ({ openSource: vi.fn(async () => ({ rootDir: "/source" })) }));
vi.mock("../source/registry.js", () => ({
  listEvals: vi.fn(async () => ["task"]),
  loadEval: vi.fn(async () => ({ plan: { kind: "plan" }, weights: { tests: 1, judge: 0 } }))
}));

const { runMatrix } = await import("./matrix.js");

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

describe("runMatrix publication", () => {
  beforeEach(() => {
    mocks.fs = createFsFromVolume(Volume.fromJSON({ "/runs/.keep": "" }, "/")).promises;
    mocks.failAggregates = false;
    mocks.failAggregateRenames = false;
    mocks.failAggregateTempExistsOnce = false;
    mocks.runEval.mockReset().mockImplementation(async (opts) => result(opts));
  });

  it("does not yield completed cell results before aggregate publication succeeds", async () => {
    mocks.failAggregates = true;
    const iterator = runMatrix(options(["model-one"]))[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toThrow("aggregate publication failed");

    const [matrixId] = (await mocks.fs.readdir("/runs")).filter((name) => name !== ".keep");
    const files = await mocks.fs.readdir(`/runs/${String(matrixId)}`);
    expect(files.filter((name) => String(name).includes(".tmp"))).toEqual([]);
  });

  it("cleans staged aggregate files when publication commit fails", async () => {
    mocks.failAggregateRenames = true;
    const iterator = runMatrix(options(["model-one"]))[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toThrow("aggregate commit failed");

    const [matrixId] = (await mocks.fs.readdir("/runs")).filter((name) => name !== ".keep");
    const files = await mocks.fs.readdir(`/runs/${String(matrixId)}`);
    expect(files.filter((name) => String(name).includes(".tmp"))).toEqual([]);
    expect(files.filter((name) => String(name).startsWith("aggregate-"))).toEqual([]);
  });

  it("does not retry aggregate writes for inherited existing-path error codes", async () => {
    mocks.failAggregateTempExistsOnce = true;
    const iterator = runMatrix(options(["model-one"]))[Symbol.asyncIterator]();

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(iterator.next()).rejects.toThrow("aggregate temp exists");
    });
  });

  it("rejects source-relative symlinked output parents before running cells", async () => {
    await mocks.fs.mkdir("/source", { recursive: true });
    await mocks.fs.mkdir("/outside", { recursive: true });
    await mocks.fs.symlink("/outside", "/source/runs");

    const iterator = runMatrix({ ...options(["model-one"]), outDir: "/source/runs" })[
      Symbol.asyncIterator
    ]();

    await expect(iterator.next()).rejects.toThrow(/symbolic link/);
    expect(mocks.runEval).not.toHaveBeenCalled();
    await expect(mocks.fs.readdir("/outside")).resolves.toEqual([]);
  });

  it("writes distinct aggregates for model identifiers that sanitize alike", async () => {
    const results: EvalRunResult[] = [];
    for await (const result of runMatrix(options(["model/a", "model-a"]))) {
      results.push(result);
    }

    const [matrixId] = (await mocks.fs.readdir("/runs")).filter((name) => name !== ".keep");
    const files = await mocks.fs.readdir(`/runs/${String(matrixId)}`);
    expect(files.filter((name) => String(name).startsWith("aggregate-"))).toHaveLength(2);
    expect(results.map((result) => result.model)).toEqual(["model/a", "model-a"]);
  });
});

function options(models: readonly string[]) {
  return {
    sourceDir: "/source",
    evalIds: ["task"],
    agents: ["codex"],
    models,
    repeats: 1,
    outDir: "/runs",
    verifyOracle: false,
    judge: "off" as const
  };
}

function result(opts: EvalRunOptions): EvalRunResult {
  return {
    runId: `run-${opts.model}`,
    eval: opts.evalId,
    agent: opts.agent,
    model: opts.model,
    planKind: "plan",
    verdict: "pass",
    correctness: 1,
    iterations: 1,
    durationMs: 10,
    usage: { inputTokens: 1, outputTokens: 1 },
    tests: { passed: 1, total: 1, pass_rate: 1, cases: [] },
    scoring: {
      tests: { configured: true, required: true, configuredWeight: 1, effectiveWeight: 1, status: "executed" },
      judge: { configured: false, required: false, configuredWeight: 0, effectiveWeight: 0, status: "disabled" }
    },
    cheated: false,
    cheatReport: { cheated: false, violations: [] },
    trace: { available: false }
  };
}
