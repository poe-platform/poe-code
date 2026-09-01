import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { parse, stringify } from "yaml";
import { describe, expect, it, vi } from "vitest";
import type { PipelineFileSystem } from "@poe-code/pipeline";
import { runPipeline, type AgentRunInput, type PipelineRunOptions } from "./pipeline.js";

const planPath = "/repo/custom/plan.md";
const archivePath = "/repo/custom/archive/plan.md";
const otherPath = "/repo/docs/plans/plan.md";
const otherContent = "Unrelated unfinished plan must remain unchanged.\n";
const body = "\n# Finalization fixture\n\nKeep this requirement.\n";
const runLock = path.join(
  tmpdir(),
  "poe-code-pipeline",
  `${createHash("sha256").update(planPath).digest("hex")}.lock`
);
type TestFs = ReturnType<typeof createFsFromVolume>["promises"];
type Metadata = {
  finalization?: string;
  state?: string;
  tasks: Array<{
    id: string;
    title: string;
    prompt: string;
    status: string | Record<string, string>;
  }>;
};

function task(id: string, status: string | Record<string, string> = "open") {
  return { id, title: id, prompt: id, status };
}

function document(overrides: Record<string, unknown> = {}) {
  return `---\n${stringify({ kind: "pipeline", version: 1, setup: { prompt: "setup" }, teardown: { prompt: "teardown" }, tasks: [task("work")], ...overrides })}---${body}`;
}

function runner() {
  return vi.fn(async (input: AgentRunInput) => ({ stdout: input.prompt, stderr: "", exitCode: 0 }));
}

function fixture(overrides: Record<string, unknown> = {}) {
  const volume = Volume.fromJSON({ [planPath]: document(overrides), [otherPath]: otherContent });
  const raw = createFsFromVolume(volume).promises;
  const runAgent = runner();
  const options: PipelineRunOptions = {
    agent: "fixture-agent",
    cwd: "/repo",
    homeDir: "/home/fixture",
    plan: planPath,
    logDir: "/logs",
    archive: false,
    fs: raw as unknown as PipelineFileSystem,
    runAgent
  };
  return { volume, raw, runAgent, options };
}

function restart(setup: ReturnType<typeof fixture>, overrides: Partial<PipelineRunOptions> = {}) {
  const volume = Volume.fromJSON(setup.volume.toJSON());
  const raw = createFsFromVolume(volume).promises;
  const runAgent = runner();
  return {
    volume,
    raw,
    runAgent,
    options: {
      ...setup.options,
      signal: undefined,
      fs: raw as unknown as PipelineFileSystem,
      runAgent,
      ...overrides
    }
  };
}

async function metadata(fs: TestFs, file = planPath): Promise<Metadata> {
  const content = String(await fs.readFile(file, "utf8"));
  return parse(content.slice(4, content.indexOf("\n---", 4))) as Metadata;
}

async function edit(fs: TestFs, change: (data: Metadata) => void, appended = "") {
  const content = String(await fs.readFile(planPath, "utf8"));
  const end = content.indexOf("\n---", 4);
  const data = parse(content.slice(4, end)) as Metadata;
  change(data);
  await fs.writeFile(planPath, `---\n${stringify(data)}---${content.slice(end + 4)}${appended}`);
}

async function assertArchived(fs: TestFs) {
  await expect(fs.stat(planPath)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await metadata(fs, archivePath)).toMatchObject({
    state: "archived",
    finalization: "completed"
  });
  expect(await fs.readFile(archivePath, "utf8")).toContain(body.trim());
  expect(await fs.readFile(otherPath, "utf8")).toBe(otherContent);
  await expect(fs.stat(runLock)).rejects.toMatchObject({ code: "ENOENT" });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Pipeline finalization recovery", () => {
  it.each(["failed", "thrown", "cancelled", "abort-error"] as const)(
    "resumes %s teardown without repeating setup or task work",
    async (failureKind) => {
      const setup = fixture();
      const controller = new AbortController();
      const failure = new Error("Teardown fixture failure");
      setup.runAgent.mockImplementation(async (input) => {
        if (input.prompt !== "teardown") return { stdout: "", stderr: "", exitCode: 0 };
        if (failureKind === "thrown") throw failure;
        if (failureKind === "abort-error")
          throw Object.assign(new Error("Cancelled"), { name: "AbortError" });
        if (failureKind === "cancelled") controller.abort();
        return {
          stdout: "",
          stderr: "Verification failed",
          exitCode: failureKind === "failed" ? 1 : 0
        };
      });
      const first = runPipeline({ ...setup.options, signal: controller.signal });
      if (failureKind === "thrown") await expect(first).rejects.toBe(failure);
      else
        await expect(first).resolves.toMatchObject({
          stopReason: failureKind === "failed" ? "failed" : "cancelled",
          runsCompleted: 1
        });
      const pending = await metadata(setup.raw);
      expect(pending.tasks[0].status).toBe("done");
      const retry = restart(setup, { archive: true });
      await expect(runPipeline(retry.options)).resolves.toMatchObject({
        stopReason: "completed",
        runsCompleted: 0
      });
      expect(pending.finalization).toBe("pending");
      expect(retry.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual(["teardown"]);
      await assertArchived(retry.raw);
    }
  );

  it.each([1, 2])("finalizes when %s task executions exactly exhaust the budget", async (count) => {
    const tasks = Array.from({ length: count }, (_, index) => task(`work-${index}`));
    const setup = fixture({ setup: null, tasks });
    const result = await runPipeline({ ...setup.options, archive: true, maxRuns: count });
    expect(result).toMatchObject({ stopReason: "completed", runsCompleted: count });
    expect(setup.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual([
      ...tasks.map((current) => current.prompt),
      "teardown"
    ]);
    await assertArchived(setup.raw);
  });

  it("does not grant another task execution when unfinished work remains at the budget", async () => {
    const setup = fixture({ setup: null, tasks: [task("first"), task("second")] });
    await expect(runPipeline({ ...setup.options, maxRuns: 1 })).resolves.toMatchObject({
      stopReason: "max_runs",
      runsCompleted: 1
    });
    expect(setup.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual(["first"]);
    expect(await metadata(setup.raw)).toMatchObject({
      finalization: "pending",
      tasks: [{ status: "done" }, { status: "open" }]
    });
    const retry = restart(setup);
    await expect(runPipeline(retry.options)).resolves.toMatchObject({
      stopReason: "completed",
      runsCompleted: 1
    });
    expect(retry.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual([
      "second",
      "teardown"
    ]);
  });

  it("finalizes when the last step exactly reaches the task-execution budget", async () => {
    const setup = fixture({
      setup: null,
      steps: { implement: { prompt: "implement" }, verify: { prompt: "verify" } },
      tasks: [task("work", { implement: "open", verify: "open" })]
    });
    await expect(
      runPipeline({ ...setup.options, archive: true, maxRuns: 2 })
    ).resolves.toMatchObject({ stopReason: "completed", runsCompleted: 2 });
    expect(setup.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual([
      "implement",
      "verify",
      "teardown"
    ]);
    expect((await metadata(setup.raw, archivePath)).tasks[0].status).toEqual({
      implement: "done",
      verify: "done"
    });
    await assertArchived(setup.raw);
  });

  it.each(["pending", "teardown_completed"])(
    "resumes tracked %s finalization with a zero task budget",
    async (finalization) => {
      const setup = fixture({ tasks: [task("work", "done")], finalization });
      await expect(runPipeline({ ...setup.options, maxRuns: 0 })).resolves.toMatchObject({
        stopReason: "completed",
        runsCompleted: 0
      });
      expect(setup.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual(
        finalization === "pending" ? ["teardown"] : []
      );
      expect((await metadata(setup.raw)).finalization).toBe("completed");
    }
  );

  it("does not rerun acknowledged no-archive completion even if a later caller enables archiving", async () => {
    const setup = fixture();
    await expect(runPipeline(setup.options)).resolves.toMatchObject({ stopReason: "completed" });
    const completed = await metadata(setup.raw);
    const retry = restart(setup, { archive: true });
    await expect(runPipeline(retry.options)).resolves.toMatchObject({
      stopReason: "nothing_to_run"
    });
    expect(retry.runAgent).not.toHaveBeenCalled();
    expect(completed.finalization).toBe("completed");
    await expect(retry.raw.stat(planPath)).resolves.toBeDefined();
    await expect(retry.raw.stat(archivePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves the no-op contract for untracked already-complete plans", async () => {
    const setup = fixture({ tasks: [task("work", "done")] });
    const original = await setup.raw.readFile(planPath, "utf8");
    await expect(runPipeline({ ...setup.options, archive: true })).resolves.toMatchObject({
      stopReason: "nothing_to_run",
      runsCompleted: 0
    });
    expect(setup.runAgent).not.toHaveBeenCalled();
    expect(await setup.raw.readFile(planPath, "utf8")).toBe(original);
  });

  it.each(["collision", "unlink"] as const)(
    "retries a failed archive (%s) without repeating acknowledged teardown",
    async (failureKind) => {
      const setup = fixture();
      const failure = Object.assign(new Error("Archive source unavailable"), { code: "EIO" });
      const prior = document({ tasks: [task("old", "done")] });
      if (failureKind === "collision") {
        await setup.raw.mkdir(path.dirname(archivePath), { recursive: true });
        await setup.raw.writeFile(archivePath, prior);
      }
      const fs: PipelineFileSystem = {
        ...setup.options.fs!,
        async unlink(filename) {
          if (failureKind === "unlink" && filename === planPath) throw failure;
          await setup.raw.unlink(filename);
        }
      };
      const first = runPipeline({ ...setup.options, fs, archive: true });
      if (failureKind === "collision")
        await expect(first).rejects.toMatchObject({ name: "TaskAlreadyExistsError" });
      else await expect(first).rejects.toBe(failure);
      const ready = await metadata(setup.raw);
      expect(setup.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual([
        "setup",
        "work",
        "teardown"
      ]);
      if (failureKind === "collision") {
        expect(await setup.raw.readFile(archivePath, "utf8")).toBe(prior);
        await setup.raw.unlink(archivePath);
      } else await expect(setup.raw.stat(archivePath)).rejects.toMatchObject({ code: "ENOENT" });
      const retry = restart(setup, { archive: true });
      await expect(runPipeline(retry.options)).resolves.toMatchObject({
        stopReason: "completed",
        runsCompleted: 0
      });
      expect(ready.finalization).toBe("teardown_completed");
      expect(retry.runAgent).not.toHaveBeenCalled();
      await assertArchived(retry.raw);
    }
  );

  it.each(["teardown_completed", "completed"])(
    "recovers when persisting %s fails",
    async (stage) => {
      const setup = fixture();
      const failure = Object.assign(new Error("Progress write failed"), { code: "EIO" });
      const fs: PipelineFileSystem = {
        ...setup.options.fs!,
        async writeFile(filename, content, options) {
          if (filename.endsWith(".tmp") && String(content).includes(`finalization: ${stage}`))
            throw failure;
          await setup.raw.writeFile(filename, content, options);
        }
      };
      await expect(runPipeline({ ...setup.options, fs })).rejects.toBe(failure);
      expect((await metadata(setup.raw)).finalization).toBe(
        stage === "teardown_completed" ? "pending" : "teardown_completed"
      );
      const retry = restart(setup);
      await expect(runPipeline(retry.options)).resolves.toMatchObject({
        stopReason: "completed",
        runsCompleted: 0
      });
      expect(retry.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual(
        stage === "teardown_completed" ? ["teardown"] : []
      );
      expect((await metadata(retry.raw)).finalization).toBe("completed");
    }
  );

  it("does not archive new work added during teardown or exceed the task budget", async () => {
    const setup = fixture({ setup: null });
    setup.runAgent.mockImplementation(async (input) => {
      if (input.prompt === "teardown")
        await edit(
          setup.raw,
          (data) => {
            data.tasks.push(task("later"));
          },
          "\nA new requirement.\n"
        );
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    await expect(
      runPipeline({ ...setup.options, archive: true, maxRuns: 1 })
    ).resolves.toMatchObject({ stopReason: "max_runs", runsCompleted: 1 });
    expect(setup.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual(["work", "teardown"]);
    expect(await metadata(setup.raw)).toMatchObject({
      finalization: "pending",
      tasks: [{ status: "done" }, { status: "open" }]
    });
    await expect(setup.raw.stat(archivePath)).rejects.toMatchObject({ code: "ENOENT" });
    const retry = restart(setup, { archive: true });
    await expect(runPipeline(retry.options)).resolves.toMatchObject({
      stopReason: "completed",
      runsCompleted: 1
    });
    expect(retry.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual(["later", "teardown"]);
    expect(await retry.raw.readFile(archivePath, "utf8")).toContain("A new requirement.");
    await assertArchived(retry.raw);
  });

  it("does not confuse a completed task filter with completion of the whole plan", async () => {
    const setup = fixture({ setup: null, tasks: [task("first"), task("second")] });
    await expect(
      runPipeline({ ...setup.options, task: "first", archive: true })
    ).resolves.toMatchObject({ stopReason: "completed", runsCompleted: 1 });
    expect(setup.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual(["first"]);
    expect(await metadata(setup.raw)).toMatchObject({
      finalization: "pending",
      tasks: [{ status: "done" }, { status: "open" }]
    });
    const filtered = restart(setup, { task: "first", archive: true });
    await expect(runPipeline(filtered.options)).resolves.toMatchObject({
      stopReason: "nothing_to_run"
    });
    expect(filtered.runAgent).not.toHaveBeenCalled();
    const remaining = restart(setup, { archive: true });
    await expect(runPipeline(remaining.options)).resolves.toMatchObject({
      stopReason: "completed",
      runsCompleted: 1
    });
    expect(remaining.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual([
      "second",
      "teardown"
    ]);
    await assertArchived(remaining.raw);
  });

  it("resets finalization acknowledgement when completed work is reopened", async () => {
    const setup = fixture({ setup: null });
    await runPipeline(setup.options);
    expect((await metadata(setup.raw)).finalization).toBe("completed");
    await edit(setup.raw, (data) => {
      data.tasks[0].status = "open";
    });
    const retry = restart(setup);
    await expect(runPipeline(retry.options)).resolves.toMatchObject({
      stopReason: "completed",
      runsCompleted: 1
    });
    expect(retry.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual(["work", "teardown"]);
    expect((await metadata(retry.raw)).finalization).toBe("completed");
  });

  it("serializes concurrent finalization-only retries", async () => {
    const setup = fixture({ tasks: [task("work", "done")], finalization: "pending" });
    const entered = deferred();
    const release = deferred();
    const waiting = deferred();
    const fs: PipelineFileSystem = {
      ...setup.options.fs!,
      async writeFile(filename, content, options) {
        try {
          await setup.raw.writeFile(filename, content, options);
        } catch (error) {
          if (filename === runLock && (error as { code?: string }).code === "EEXIST")
            waiting.resolve();
          throw error;
        }
      }
    };
    const firstRunner = vi.fn(async () => {
      entered.resolve();
      await release.promise;
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const secondRunner = runner();
    const first = runPipeline({ ...setup.options, fs, runAgent: firstRunner });
    let second: ReturnType<typeof runPipeline> | undefined;
    try {
      await Promise.race([
        entered.promise,
        first.then(() => {
          throw new Error("First retry ended before teardown");
        })
      ]);
      second = runPipeline({ ...setup.options, fs, runAgent: secondRunner });
      await Promise.race([
        waiting.promise,
        second.then(() => {
          throw new Error("Second retry did not wait for the active run");
        })
      ]);
      expect(secondRunner).not.toHaveBeenCalled();
      release.resolve();
      await expect(first).resolves.toMatchObject({ stopReason: "completed", runsCompleted: 0 });
      await expect(second).resolves.toMatchObject({
        stopReason: "nothing_to_run",
        runsCompleted: 0
      });
      expect(firstRunner).toHaveBeenCalledTimes(1);
      expect(secondRunner).not.toHaveBeenCalled();
      expect((await metadata(setup.raw)).finalization).toBe("completed");
    } finally {
      release.resolve();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    }
  });

  it("archives at the exact task budget without inventing a disabled teardown", async () => {
    const setup = fixture({ setup: null, teardown: null });
    await expect(
      runPipeline({ ...setup.options, archive: true, maxRuns: 1 })
    ).resolves.toMatchObject({ stopReason: "completed", runsCompleted: 1 });
    expect(setup.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual(["work"]);
    await assertArchived(setup.raw);
  });
});
