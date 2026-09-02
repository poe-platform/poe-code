import { createFsFromVolume, Volume } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSharedVitest, sharedVitestStages } from "./test-vitest-workspaces.mjs";

const mocks = vi.hoisted(() => ({ createVitest: vi.fn(), reportStarted: vi.fn(), reportFinished: vi.fn(), reportModule: vi.fn(), reporterOptions: vi.fn() }));
vi.mock("vitest/node", () => ({
  createVitest: mocks.createVitest,
  DefaultReporter: class {
    constructor(options: unknown) {
      mocks.reporterOptions(options);
    }
    onTestRunStart(specifications: unknown) {
      mocks.reportStarted(specifications);
    }
    onTestRunEnd(files: unknown, errors: unknown, reason: unknown) {
      mocks.reportFinished(files, errors, reason);
    }
    printTestModule(module: unknown) {
      mocks.reportModule(module);
    }
  }
}));

function fixture() {
  const fileSystem = createFsFromVolume(Volume.fromJSON({
    "/repo/packages/alpha/package.json": JSON.stringify({ scripts: { "test:unit": "cd ../.. && vitest run packages/alpha/src" } }),
    "/repo/packages/alpha/src/unit.test.ts": "",
    "/repo/packages/beta/package.json": JSON.stringify({ scripts: { "test:unit": "cd ../.. && vitest run --passWithNoTests packages/beta/src" } }),
    "/repo/packages/beta/src/unit.test.ts": "",
    "/repo/packages/native/package.json": JSON.stringify({ scripts: { "test:unit": "node --test" } })
  })) as unknown as typeof import("node:fs");
  const plan = {
    root: "/repo",
    rootManifest: {
      name: "root",
      scripts: {
        "test:unit": "vitest run --config vitest.root.config.ts",
        "test:unit:shared": "node scripts/test-vitest-workspaces.mjs"
      } as Record<string, string>
    },
    concurrency: 1,
    testArguments: [] as string[],
    testStages: [
      { id: "//#test:unit", name: "root", path: null, event: "test:unit" },
      { id: "alpha#test:unit", name: "alpha", path: "packages/alpha", event: "test:unit" },
      { id: "native#test:unit", name: "native", path: "packages/native", event: "test:unit" },
      { id: "beta#test:unit", name: "beta", path: "packages/beta", event: "test:unit" }
    ],
    buildStages: [{ id: "native#build", name: "native", path: "packages/native" }]
  };
  return { fileSystem, plan };
}

describe("shared Vitest task selection", () => {
  it("combines only compatible Vitest tasks while retaining native tasks and build prerequisites", () => {
    const { fileSystem, plan } = fixture();
    const before = structuredClone(plan);
    const stages = sharedVitestStages(plan, fileSystem);
    expect(stages).toHaveLength(2);
    expect(stages[0]).toMatchObject({ id: "//#test:unit", path: null, event: "test:unit:shared" });
    expect(stages[0].phases).toEqual([
      { name: "root", path: null, selectors: [], passWithNoTests: false },
      { name: "alpha", path: "packages/alpha", selectors: ["packages/alpha/src"], passWithNoTests: false },
      { name: "beta", path: "packages/beta", selectors: ["packages/beta/src"], passWithNoTests: true }
    ]);
    expect(stages[1]).toBe(plan.testStages[2]);
    expect(plan).toEqual(before);
  });

  for (const hook of ["pretest:unit", "posttest:unit"]) {
    it(`keeps a workspace ${hook} on its native npm route`, () => {
      const { fileSystem, plan } = fixture();
      fileSystem.writeFileSync("/repo/packages/alpha/package.json", JSON.stringify({
        scripts: { "test:unit": "cd ../.. && vitest run packages/alpha/src", [hook]: "node hook.mjs" }
      }));
      const stages = sharedVitestStages(plan, fileSystem);
      expect(stages.map(stage => stage.name)).toEqual(["root", "alpha", "native"]);
      expect(stages[0].phases.map(phase => phase.name)).toEqual(["root", "beta"]);
      expect(stages[1]).toBe(plan.testStages[1]);
    });
  }

  for (const hook of ["pretest:unit", "posttest:unit", "pretest:unit:shared", "posttest:unit:shared"]) {
    it(`does not replace a root ${hook} lifecycle`, () => {
      const { fileSystem, plan } = fixture();
      plan.rootManifest.scripts[hook] = "node hook.mjs";
      expect(sharedVitestStages(plan, fileSystem)).toBe(plan.testStages);
    });
  }

  it("leaves explicit test arguments on the existing native route", () => {
    const { fileSystem, plan } = fixture();
    plan.testArguments = ["--reporter=json", "--testNamePattern=selected"];
    expect(sharedVitestStages(plan, fileSystem)).toBe(plan.testStages);
  });

  it("retains the shared context when native workspace tasks run concurrently", () => {
    const { fileSystem, plan } = fixture();
    plan.concurrency = 4;
    const stages = sharedVitestStages(plan, fileSystem);
    expect(stages).toHaveLength(2);
    expect(stages[0].phases.map(phase => phase.name)).toEqual(["root", "alpha", "beta"]);
    expect(stages[1].name).toBe("native");
  });

  it("shares explicitly selected workspace phases without running root tests", () => {
    const { fileSystem, plan } = fixture();
    plan.testStages = plan.testStages.filter(stage => stage.path !== null);
    const stages = sharedVitestStages({ ...plan, ciGroup: "cached" }, fileSystem);
    expect(stages[0].path).toBeNull();
    expect(stages[0].phases.map(phase => phase.name)).toEqual(["alpha", "beta"]);
    expect(stages[0].testArguments).toEqual(["--ci-group=cached", "packages/alpha", "packages/beta"]);
  });

  it("requires the declared shared command and supported root selection", () => {
    for (const field of ["test:unit", "test:unit:shared"]) {
      const { fileSystem, plan } = fixture();
      plan.rootManifest.scripts[field] = "node custom.mjs";
      expect(sharedVitestStages(plan, fileSystem)).toBe(plan.testStages);
    }
  });

  it("does not add excluded or undeclared tasks back into the plan", () => {
    const { fileSystem, plan } = fixture();
    plan.testStages = plan.testStages.filter(stage => stage.name !== "beta");
    const stages = sharedVitestStages(plan, fileSystem);
    expect(stages[0].phases.map(phase => phase.name)).toEqual(["root", "alpha"]);
  });

  it("keeps custom workspace configuration on its original route", () => {
    const { fileSystem, plan } = fixture();
    fileSystem.writeFileSync("/repo/packages/alpha/package.json", JSON.stringify({
      scripts: { "test:unit": "cd ../.. && vitest run --config custom.config.ts packages/alpha/src" }
    }));
    const stages = sharedVitestStages(plan, fileSystem);
    expect(stages[0].phases.map(phase => phase.name)).toEqual(["root", "beta"]);
    expect(stages[1]).toBe(plan.testStages[1]);
  });

  it("does not add a shared process when there is only the root task", () => {
    const { fileSystem, plan } = fixture();
    plan.testStages = plan.testStages.filter(stage => stage.path === null);
    expect(sharedVitestStages(plan, fileSystem)).toBe(plan.testStages);
  });
});

describe("sequential shared Vitest execution", () => {
  const rootFile = { moduleId: "/repo/src/root.test.ts" };
  const alphaFile = { moduleId: "/repo/packages/alpha/src/unit.test.ts" };
  const betaFile = { moduleId: "/repo/packages/beta/src/unit.test.ts" };
  const phases = [
    { name: "root", path: null, selectors: [], passWithNoTests: false },
    { name: "alpha", path: "packages/alpha", selectors: ["packages/alpha/src"], passWithNoTests: false },
    { name: "beta", path: "packages/beta", selectors: ["packages/beta/src"], passWithNoTests: true }
  ];

  function contexts() {
    const discovery = {
      globTestSpecifications: vi.fn(async () => [rootFile]),
      close: vi.fn(async () => undefined)
    };
    const execution = {
      config: { pool: "threads", maxWorkers: 2, isolate: true, poolOptions: {}, globalSetup: [], coverage: { enabled: false } },
      standalone: vi.fn(async () => undefined),
      globTestSpecifications: vi.fn(async (filters?: string[]) => filters === undefined
        ? [rootFile, alphaFile, betaFile]
        : filters[0] === "packages/alpha/src" ? [alphaFile] : [betaFile]),
      runTestSpecifications: vi.fn(async (_specifications: unknown[], _allTestsRun: boolean) => ({ testModules: [{ ok: (): boolean => true }], unhandledErrors: [] as Error[] })),
      close: vi.fn(async () => undefined),
      snapshot: { summary: {} },
      state: { getTestModules: vi.fn(() => [rootFile, alphaFile, betaFile]) }
    };
    mocks.createVitest.mockResolvedValueOnce(discovery).mockResolvedValueOnce(execution);
    return { discovery, execution };
  }

  beforeEach(() => {
    mocks.createVitest.mockReset();
    mocks.reportStarted.mockReset();
    mocks.reportFinished.mockReset();
    mocks.reportModule.mockReset();
    mocks.reporterOptions.mockReset();
  });

  it("discovers actual root ownership and runs every workspace phase without changing workers", async () => {
    const { discovery, execution } = contexts();
    const environment = { VITEST: process.env.VITEST, NODE_ENV: process.env.NODE_ENV };
    await runSharedVitest("/repo", phases);
    expect(mocks.createVitest.mock.calls.map(call => call[1].config)).toEqual([
      "/repo/vitest.root.config.ts", "/repo/vitest.config.ts"
    ]);
    expect(execution.runTestSpecifications.mock.calls.map(call => call[0])).toEqual([[rootFile], [alphaFile], [betaFile]]);
    expect(discovery.close).toHaveBeenCalledOnce();
    expect(execution.close).toHaveBeenCalledOnce();
    expect(execution.config.maxWorkers).toBe(2);
    expect(execution.config.isolate).toBe(true);
    expect({ VITEST: process.env.VITEST, NODE_ENV: process.env.NODE_ENV }).toEqual(environment);
  });

  it("waits for each phase before starting another", async () => {
    const { execution } = contexts();
    let finish!: () => void;
    execution.runTestSpecifications.mockImplementationOnce(() => new Promise(resolve => {
      finish = () => resolve({ testModules: [{ ok: () => true }], unhandledErrors: [] });
    }));
    const running = runSharedVitest("/repo", phases);
    await vi.waitFor(() => expect(execution.runTestSpecifications).toHaveBeenCalledOnce());
    expect(execution.close).not.toHaveBeenCalled();
    finish();
    await running;
    expect(execution.runTestSpecifications).toHaveBeenCalledTimes(3);
  });

  it("sets and restores the native Vitest TEST startup marker", async () => {
    const { discovery, execution } = contexts();
    const previous = process.env.TEST;
    process.env.TEST = "sentinel";
    mocks.createVitest.mockReset().mockImplementationOnce(async () => {
      expect(process.env.TEST).toBe("true");
      return discovery;
    }).mockResolvedValueOnce(execution);
    try {
      await runSharedVitest("/repo", phases);
      expect(process.env.TEST).toBe("sentinel");
    } finally {
      if (previous === undefined) delete process.env.TEST;
      else process.env.TEST = previous;
    }
  });

  it("rejects overlapping ownership before executing any tests", async () => {
    const { execution } = contexts();
    execution.globTestSpecifications.mockImplementation(async filters => filters === undefined ? [rootFile, alphaFile] : [rootFile]);
    await expect(runSharedVitest("/repo", phases)).rejects.toThrow("overlap");
    expect(execution.runTestSpecifications).not.toHaveBeenCalled();
    expect(execution.close).toHaveBeenCalledOnce();
  });

  it("rejects root files absent from the shared configuration", async () => {
    const { execution } = contexts();
    execution.globTestSpecifications.mockResolvedValue([alphaFile, betaFile]);
    await expect(runSharedVitest("/repo", phases)).rejects.toThrow("Root test file");
    expect(execution.runTestSpecifications).not.toHaveBeenCalled();
  });

  it("rejects an unexpected empty workspace and honors explicit passWithNoTests", async () => {
    const first = contexts();
    first.execution.globTestSpecifications.mockImplementation(async filters => filters === undefined ? [rootFile] : []);
    await expect(runSharedVitest("/repo", phases)).rejects.toThrow("No test files: alpha");
    const second = contexts();
    second.execution.globTestSpecifications.mockImplementation(async filters => filters === undefined ? [rootFile, alphaFile] : filters[0] === "packages/alpha/src" ? [alphaFile] : []);
    await runSharedVitest("/repo", phases);
    expect(second.execution.runTestSpecifications).toHaveBeenCalledTimes(2);
  });

  for (const failure of ["test", "unhandled"] as const) {
    it(`stops after a ${failure} failure and closes the runner`, async () => {
      const { execution } = contexts();
      execution.runTestSpecifications.mockResolvedValueOnce({
        testModules: [{ ok: () => failure !== "test" }],
        unhandledErrors: failure === "unhandled" ? [new Error("unhandled sentinel")] : []
      });
      await expect(runSharedVitest("/repo", phases)).rejects.toThrow("root");
      expect(execution.runTestSpecifications).toHaveBeenCalledOnce();
      expect(execution.close).toHaveBeenCalledOnce();
    });
  }

  it("preserves discovery and cleanup failures without retrying cleanup", async () => {
    const { discovery, execution } = contexts();
    const primary = new Error("discovery failed");
    const cleanup = new Error("close failed");
    discovery.globTestSpecifications.mockRejectedValueOnce(primary);
    discovery.close.mockRejectedValueOnce(cleanup);
    await expect(runSharedVitest("/repo", phases)).rejects.toMatchObject({ errors: [primary, cleanup] });
    expect(discovery.close).toHaveBeenCalledOnce();
    expect(execution.standalone).not.toHaveBeenCalled();
  });

  it("refuses disabled per-file isolation", async () => {
    const { execution } = contexts();
    execution.config.isolate = false;
    await expect(runSharedVitest("/repo", phases)).rejects.toThrow("isolation");
    expect(execution.runTestSpecifications).not.toHaveBeenCalled();
  });

  it("prints one complete summary, but reports a failure immediately", async () => {
    const { execution } = contexts();
    await runSharedVitest("/repo", phases);
    const reporter = mocks.createVitest.mock.calls[1][1].reporters[0];
    reporter.ctx = execution;
    reporter.onTestRunStart([rootFile]);
    reporter.onTestRunStart([alphaFile]);
    reporter.onTestRunStart([betaFile]);
    expect(mocks.reportStarted).toHaveBeenCalledExactlyOnceWith([rootFile]);
    reporter.onTestRunEnd([{ state: () => "passed" }], [], "passed");
    reporter.onTestRunEnd([{ state: () => "passed" }], [], "passed");
    expect(mocks.reportFinished).not.toHaveBeenCalled();
    reporter.onTestRunEnd([{ state: () => "passed" }], [], "passed");
    expect(mocks.reportFinished).toHaveBeenCalledWith(execution.state.getTestModules(), [], "passed");
    reporter.phasesRemaining = 3;
    reporter.onTestRunEnd([{ state: () => "failed" }], [], "failed");
    expect(mocks.reportFinished).toHaveBeenCalledTimes(2);
    reporter.phasesRemaining = 3;
    reporter.onTestRunEnd([{ state: () => "passed" }], [], "interrupted");
    expect(mocks.reportFinished).toHaveBeenCalledTimes(3);
    expect(mocks.reportFinished).toHaveBeenLastCalledWith(execution.state.getTestModules(), [], "interrupted");
    reporter.phasesRemaining = 3;
    reporter.onTestRunEnd([{ state: () => "passed" }], [], "failed");
    expect(mocks.reportFinished).toHaveBeenCalledTimes(4);
    expect(mocks.reportFinished).toHaveBeenLastCalledWith(execution.state.getTestModules(), [], "failed");
  });

  it("omits per-case progress and successful module output while retaining failed modules", async () => {
    contexts();
    await runSharedVitest("/repo", phases);
    const reporter = mocks.createVitest.mock.calls[1][1].reporters[0];
    expect(mocks.reporterOptions).toHaveBeenCalledWith({ summary: false });
    for (const state of ["passed", "skipped", "pending", "queued"]) {
      reporter.printTestModule({ state: () => state });
    }
    expect(mocks.reportModule).not.toHaveBeenCalled();
    const failed = { state: () => "failed" };
    reporter.printTestModule(failed);
    expect(mocks.reportModule).toHaveBeenCalledExactlyOnceWith(failed);
  });

  it("identifies each nonempty phase before execution instead of printing individual progress dots", async () => {
    const { execution } = contexts();
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      execution.runTestSpecifications.mockImplementation(async () => {
        expect(output).toHaveBeenLastCalledWith(`Unit workspace ${phases[execution.runTestSpecifications.mock.calls.length - 1]!.name}: running 1 files`);
        return { testModules: [{ ok: () => true }], unhandledErrors: [] };
      });
      await runSharedVitest("/repo", phases);
      expect(output).toHaveBeenCalledTimes(3);
    } finally {
      output.mockRestore();
    }
  });

  it("reports snapshot notices before the next phase clears their state", async () => {
    const { execution } = contexts();
    await runSharedVitest("/repo", phases);
    const reporter = mocks.createVitest.mock.calls[1][1].reporters[0];
    reporter.ctx = execution;
    for (const summary of [
      { added: 1 }, { unmatched: 1 }, { updated: 1 }, { filesRemoved: 1 },
      { unchecked: 1 }, { filesRemovedList: ["obsolete.snap"] }
    ]) {
      mocks.reportFinished.mockClear();
      reporter.phasesRemaining = 3;
      execution.snapshot.summary = summary;
      reporter.onTestRunEnd([{ state: () => "passed" }], [], "passed");
      expect(mocks.reportFinished).toHaveBeenCalledOnce();
      expect(mocks.reportFinished).toHaveBeenCalledWith(execution.state.getTestModules(), [], "passed");
    }
  });
});
