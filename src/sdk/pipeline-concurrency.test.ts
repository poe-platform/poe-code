import { createFsFromVolume, Volume } from "memfs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineFileSystem } from "@poe-code/pipeline";
import { runPipeline, type PipelineRunOptions } from "./pipeline.js";

const planPath = "/repo/docs/plans/plan.md";
const runLock = path.join(tmpdir(), "poe-code-pipeline", `${createHash("sha256").update(planPath).digest("hex")}.lock`);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function document(phases = false) {
  return [
    "---", "kind: pipeline", "version: 1",
    ...(phases ? ["setup:", "  prompt: setup", "teardown:", "  prompt: teardown"] : []),
    "tasks:",
    "  - id: first", "    title: First", "    prompt: first", "    status: open",
    "  - id: second", "    title: Second", "    prompt: second", "    status: open",
    "---", "", "Keep this plan body."
  ].join("\n");
}

function fixture(phases = false) {
  const volume = Volume.fromJSON({ [planPath]: document(phases), "/repo/keep.txt": "unchanged" });
  volume.mkdirSync(path.dirname(runLock), { recursive: true });
  const raw = createFsFromVolume(volume).promises;
  const waiting = deferred();
  const fs = {
    ...raw,
    async writeFile(file: string, content: string, options?: { encoding?: BufferEncoding; flag?: string }) {
      try {
        await raw.writeFile(file, content, options);
      } catch (error) {
        if (file === runLock && (error as { code?: string }).code === "EEXIST") waiting.resolve();
        throw error;
      }
    }
  } as unknown as PipelineFileSystem;
  const options = { agent: "fixture-agent", cwd: "/repo", homeDir: "/home/fixture", plan: planPath, logDir: "/logs", archive: false, maxRuns: 1, fs };
  async function statuses() {
    const content = await raw.readFile(planPath, "utf8") as string;
    const plan = parse(content.slice(4, content.indexOf("\n---", 4))) as { tasks: Array<{ id: string; status: string }> };
    return Object.fromEntries(plan.tasks.map(task => [task.id, task.status]));
  }
  async function assertReleased() {
    expect((await raw.readdir("/repo/docs/plans")).filter(file => String(file).endsWith(".lock") || String(file).endsWith(".tmp"))).toEqual([]);
    expect(await raw.readdir(path.dirname(runLock))).toEqual([]);
    expect(await raw.readFile("/repo/keep.txt", "utf8")).toBe("unchanged");
  }
  return { volume, raw, fs, waiting, options, statuses, assertReleased };
}

function success() {
  return { stdout: "", stderr: "", exitCode: 0 };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const runCases = [
  { name: "next open tasks", first: {}, second: {}, prompts: ["first", "second"], statuses: { first: "done", second: "done" } },
  { name: "different explicit tasks", first: { task: "first" }, second: { task: "second" }, prompts: ["first", "second"], statuses: { first: "done", second: "done" } },
  { name: "the same explicit task", first: { task: "first" }, second: { task: "first" }, prompts: ["first"], statuses: { first: "done", second: "open" } },
  { name: "equivalent relative paths", first: {}, second: { plan: "docs/plans/../plans/plan.md" }, prompts: ["first", "second"], statuses: { first: "done", second: "done" } },
  { name: "directory aliases", first: {}, second: { plan: "/repo/linked-plans/plan.md" }, prompts: ["first", "second"], statuses: { first: "done", second: "done" } },
  { name: "setup through teardown", phases: true, first: { maxRuns: Infinity }, second: { maxRuns: Infinity }, prompts: ["setup", "first", "second", "teardown"], statuses: { first: "done", second: "done" } }
];

describe("SDK pipeline run coordination", () => {
  it.each(runCases)("coordinates $name across filesystem clients", async scenario => {
    const setup = fixture(scenario.phases);
    if (scenario.name === "directory aliases") {
      setup.volume.symlinkSync("/repo/docs/plans", "/repo/linked-plans");
      setup.fs.rename = async (from, to) => setup.raw.rename(
        path.join(await setup.raw.realpath(path.dirname(from)) as string, path.basename(from)),
        path.join(await setup.raw.realpath(path.dirname(to)) as string, path.basename(to))
      );
    }
    const entered = deferred();
    const additionalAgent = deferred();
    const release = deferred();
    const runAgent = vi.fn(async (_input: { prompt: string }) => {
      if (runAgent.mock.calls.length === 1) {
        entered.resolve();
        await release.promise;
      } else additionalAgent.resolve();
      return success();
    });
    const first = runPipeline({ ...setup.options, ...scenario.first, runAgent });
    let second: ReturnType<typeof runPipeline> | undefined;
    try {
      await entered.promise;
      second = runPipeline({ ...setup.options, ...scenario.second, fs: { ...setup.fs }, runAgent });
      await expect(Promise.race([
        setup.waiting.promise.then(() => "waiting"),
        additionalAgent.promise.then(() => "duplicate agent"),
        second.then(() => "finished")
      ])).resolves.toBe("waiting");
      expect(runAgent).toHaveBeenCalledTimes(1);
      release.resolve();
      const results = await Promise.all([first, second]);
      expect(results.every(result => ["max_runs", "completed", "nothing_to_run"].includes(result.stopReason))).toBe(true);
      expect(runAgent.mock.calls.map(([input]) => input.prompt)).toEqual(scenario.prompts);
      expect(await setup.statuses()).toEqual(scenario.statuses);
      if (scenario.prompts.length === 1 || scenario.phases) expect(results[1]?.stopReason).toBe("nothing_to_run");
      await setup.assertReleased();
    } finally {
      release.resolve();
      await Promise.allSettled([first, second]);
    }
  });

  it("allows different plans to execute at the same time", async () => {
    const setup = fixture();
    const otherPlan = "/repo/docs/plans/other.md";
    await setup.raw.writeFile(otherPlan, document());
    const release = deferred();
    const runAgent = vi.fn(async () => { await release.promise; return success(); });
    const runs = [planPath, otherPlan].map(plan => runPipeline({ ...setup.options, plan, runAgent }));
    try {
      await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(2));
      release.resolve();
      await expect(Promise.all(runs)).resolves.toHaveLength(2);
      await setup.assertReleased();
    } finally {
      release.resolve();
      await Promise.allSettled(runs);
    }
  });

  it("keeps long-lived execution metadata out of the agent's checkout", async () => {
    const setup = fixture();
    await expect(runPipeline({ ...setup.options, runAgent: async () => {
      expect(await setup.raw.readdir("/repo/docs/plans")).toEqual(["plan.md"]);
      return success();
    } })).resolves.toMatchObject({ runsCompleted: 1 });
    await setup.assertReleased();
  });

  it("cancels a waiting caller without releasing the active owner's lock", async () => {
    const setup = fixture();
    const entered = deferred();
    const release = deferred();
    const controller = new AbortController();
    const firstAgent = vi.fn(async () => { entered.resolve(); await release.promise; return success(); });
    const nextAgent = vi.fn(async () => success());
    const first = runPipeline({ ...setup.options, runAgent: firstAgent });
    let second: ReturnType<typeof runPipeline> | undefined;
    try {
      await entered.promise;
      second = runPipeline({ ...setup.options, fs: { ...setup.fs }, signal: controller.signal, runAgent: nextAgent });
      void second.catch(() => undefined);
      await expect(Promise.race([setup.waiting.promise.then(() => "waiting"), second.then(() => "finished")])).resolves.toBe("waiting");
      controller.abort();
      await expect(second).rejects.toMatchObject({ name: "AbortError" });
      expect(nextAgent).not.toHaveBeenCalled();
      await expect(setup.raw.stat(runLock)).resolves.toBeDefined();
      expect(await setup.statuses()).toEqual({ first: "open", second: "open" });
      release.resolve();
      await first;
      await expect(runPipeline({ ...setup.options, runAgent: nextAgent })).resolves.toMatchObject({ runsCompleted: 1 });
      expect(nextAgent).toHaveBeenCalledTimes(1);
      expect(await setup.statuses()).toEqual({ first: "done", second: "done" });
      await setup.assertReleased();
    } finally {
      controller.abort();
      release.resolve();
      await Promise.allSettled([first, second]);
    }
  });

  it("releases ownership when cancellation arrives during acquisition", async () => {
    const setup = fixture();
    const controller = new AbortController();
    const writeFile = setup.fs.writeFile.bind(setup.fs);
    setup.fs.writeFile = async (file, content, options) => {
      await writeFile(file, content, options);
      if (file === runLock) controller.abort();
    };
    const runAgent = vi.fn(async () => success());
    await expect(runPipeline({ ...setup.options, signal: controller.signal, runAgent })).rejects.toMatchObject({ name: "AbortError" });
    expect(runAgent).not.toHaveBeenCalled();
    await setup.assertReleased();
  });

  it("cancels while waiting to persist status without releasing another writer's lock", async () => {
    const setup = fixture();
    const statusLock = "/repo/docs/plans/.plan.md.pipeline-status.lock";
    await setup.raw.writeFile(statusLock, "other writer");
    const controller = new AbortController();
    const waiting = deferred();
    const writeFile = setup.fs.writeFile.bind(setup.fs);
    setup.fs.writeFile = async (file, content, options) => {
      try { await writeFile(file, content, options); }
      catch (error) { if (file === statusLock) waiting.resolve(); throw error; }
    };
    const operation = runPipeline({ ...setup.options, signal: controller.signal, runAgent: async () => success() });
    void operation.catch(() => undefined);
    try {
      await expect(Promise.race([waiting.promise.then(() => "waiting"), operation.then(() => "finished")])).resolves.toBe("waiting");
      controller.abort();
      await expect(operation).rejects.toMatchObject({ name: "AbortError" });
      expect(await setup.statuses()).toEqual({ first: "open", second: "open" });
      expect(await setup.raw.readFile(statusLock, "utf8")).toBe("other writer");
      await expect(setup.raw.stat(runLock)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      controller.abort();
      await operation.catch(() => undefined);
    }
  });

  it.each(["agent exception", "setup exception", "teardown exception", "plan callback", "task callback", "status failure", "agent cancellation"])(
    "releases ownership after %s", async scenario => {
      const setup = fixture(scenario === "setup exception" || scenario === "teardown exception");
      const failure = new Error(scenario);
      if (scenario === "agent cancellation") failure.name = "AbortError";
      const options: PipelineRunOptions = {
        ...setup.options, maxRuns: Infinity,
        runAgent: async input => {
          if (scenario === "agent exception" || scenario === "agent cancellation" || input.prompt === scenario.split(" ")[0]) throw failure;
          return success();
        },
        ...(scenario === "plan callback" ? { onPlanResolved: () => { throw failure; } } : {}),
        ...(scenario === "task callback" ? { onTaskComplete: () => { throw failure; } } : {})
      };
      if (scenario === "status failure") {
        const rename = setup.fs.rename.bind(setup.fs);
        let failed = false;
        setup.fs.rename = async (from, to) => {
          if (!failed && to === planPath) { failed = true; throw failure; }
          await rename(from, to);
        };
      }
      const operation = runPipeline(options);
      if (scenario === "agent cancellation") await expect(operation).resolves.toMatchObject({ stopReason: "cancelled" });
      else await expect(operation).rejects.toBe(failure);
      await setup.assertReleased();
      const retry = await runPipeline({ ...setup.options, maxRuns: Infinity, runAgent: async () => success() });
      expect(["completed", "nothing_to_run"]).toContain(retry.stopReason);
      expect(await setup.statuses()).toEqual({ first: "done", second: "done" });
      await setup.assertReleased();
    }
  );

  it("bounds contention without deleting an existing owner's lock", async () => {
    const setup = fixture();
    await setup.raw.writeFile(runLock, "other owner");
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const runAgent = vi.fn(async () => success());
    const outcome = runPipeline({ ...setup.options, runAgent }).then(value => ({ value }), error => ({ error }));
    await expect(Promise.race([setup.waiting.promise.then(() => "waiting"), outcome.then(() => "finished")])).resolves.toBe("waiting");
    await vi.advanceTimersByTimeAsync(30_010);
    expect(await outcome).toMatchObject({ error: expect.objectContaining({ message: expect.stringContaining("Timed out waiting for pipeline run lock") }) });
    expect(runAgent).not.toHaveBeenCalled();
    expect(await setup.raw.readFile(runLock, "utf8")).toBe("other owner");
  });

  it.each([false, true])("reports release failure, operation also fails=%s", async operationFails => {
    const setup = fixture();
    const operationError = new Error("agent failed");
    const releaseError = new Error("release failed");
    const unlink = setup.fs.unlink.bind(setup.fs);
    setup.fs.unlink = async file => { if (file === runLock) throw releaseError; await unlink(file); };
    const outcome = await runPipeline({ ...setup.options, runAgent: async () => {
      if (operationFails) throw operationError;
      return success();
    } }).catch(error => error);
    if (operationFails) {
      expect(outcome).toBeInstanceOf(AggregateError);
      expect(outcome.errors).toEqual([operationError, releaseError]);
    } else expect(outcome).toBe(releaseError);
  });

  it("does not execute after an acquisition I/O error", async () => {
    const setup = fixture();
    const failure = Object.assign(new Error("lock unavailable"), { code: "EACCES" });
    const writeFile = setup.fs.writeFile.bind(setup.fs);
    setup.fs.writeFile = async (file, content, options) => { if (file === runLock) throw failure; await writeFile(file, content, options); };
    const runAgent = vi.fn(async () => success());
    await expect(runPipeline({ ...setup.options, runAgent })).rejects.toBe(failure);
    expect(runAgent).not.toHaveBeenCalled();
    await setup.assertReleased();
  });

  it("does not create ownership for an already-cancelled call", async () => {
    const setup = fixture();
    const controller = new AbortController();
    controller.abort();
    const before = setup.volume.toJSON();
    const runAgent = vi.fn(async () => success());
    await expect(runPipeline({ ...setup.options, signal: controller.signal, runAgent })).rejects.toMatchObject({ name: "AbortError" });
    expect(runAgent).not.toHaveBeenCalled();
    expect(setup.volume.toJSON()).toEqual(before);
  });
});
