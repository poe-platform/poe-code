import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { writeTaskStatus } from "./writer.js";
import { parsePlan } from "./parser.js";
import type { PipelineFileSystem } from "../types.js";

const planPath = "/repo/plan.md";
const statusLock = "/repo/.plan.md.pipeline-status.lock";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(steps = false) {
  const content = [
    "---", "kind: pipeline", "version: 1", "tasks:",
    "  - id: first", "    title: First", "    prompt: first",
    ...(steps ? ["    status:", "      implement: open", "      test: open"] : ["    status: open"]),
    "  - id: second", "    title: Second", "    prompt: second", "    status: open",
    "---", "", "Keep this body."
  ].join("\n");
  const raw = createFsFromVolume(Volume.fromJSON({ [planPath]: content })).promises;
  return { raw, content, fs: raw as unknown as PipelineFileSystem };
}

describe("pipeline status transactions", () => {
  it.each(["different tasks", "different steps", "normalized path aliases"])("preserves concurrent updates for %s", async scenario => {
    const setup = fixture(scenario === "different steps");
    const firstWrite = deferred();
    const secondWrite = deferred();
    const contention = deferred();
    const release = deferred();
    let temporaryWrites = 0;
    const fs: PipelineFileSystem = {
      ...setup.fs,
      async writeFile(file, data, options) {
        if (file.endsWith(".tmp")) {
          temporaryWrites += 1;
          if (temporaryWrites === 1) { firstWrite.resolve(); await release.promise; }
          else secondWrite.resolve();
        }
        try { await setup.fs.writeFile(file, data, options); }
        catch (error) {
          if (file === statusLock && (error as { code?: string }).code === "EEXIST") contention.resolve();
          throw error;
        }
      }
    };
    const first = writeTaskStatus({ fs, planPath, taskId: "first", status: "done", ...(scenario === "different steps" ? { stepName: "implement" } : {}) });
    let second: Promise<void> | undefined;
    try {
      await firstWrite.promise;
      second = writeTaskStatus({
        fs: { ...fs }, planPath: scenario === "normalized path aliases" ? "/repo/../repo/plan.md" : planPath,
        taskId: scenario === "different steps" ? "first" : "second", status: "done",
        ...(scenario === "different steps" ? { stepName: "test" } : {})
      });
      await expect(Promise.race([contention.promise.then(() => "waiting"), secondWrite.promise.then(() => "stale write"), second.then(() => "finished")])).resolves.toBe("waiting");
      release.resolve();
      await Promise.all([first, second]);
      const content = await setup.raw.readFile(planPath, "utf8") as string;
      const plan = parsePlan(content, { availableSteps: { implement: { prompt: "implement" }, test: { prompt: "test" } } });
      expect(plan.tasks[0]?.status).toEqual(scenario === "different steps" ? { implement: "done", test: "done" } : "done");
      expect(plan.tasks[1]?.status).toBe(scenario === "different steps" ? "open" : "done");
      expect(content).toContain("Keep this body.");
      expect(await setup.raw.readdir("/repo")).toEqual(["plan.md"]);
    } finally {
      release.resolve();
      await Promise.allSettled([first, second]);
    }
  });

  it.each(["write", "rename"])("releases the status transaction after a %s failure", async stage => {
    const setup = fixture();
    const failure = new Error(`status ${stage} failed`);
    const fs: PipelineFileSystem = {
      ...setup.fs,
      async writeFile(file, data, options) {
        if (stage === "write" && file.endsWith(".tmp")) throw failure;
        await setup.fs.writeFile(file, data, options);
      },
      async rename(from, to) {
        if (stage === "rename") throw failure;
        await setup.fs.rename(from, to);
      }
    };
    await expect(writeTaskStatus({ fs, planPath, taskId: "first", status: "done" })).rejects.toBe(failure);
    expect(await setup.raw.readFile(planPath, "utf8")).toBe(setup.content);
    expect(await setup.raw.readdir("/repo")).toEqual(["plan.md"]);
    await writeTaskStatus({ fs: setup.fs, planPath, taskId: "second", status: "done" });
    expect(parsePlan(await setup.raw.readFile(planPath, "utf8") as string).tasks.map(task => task.status)).toEqual(["open", "done"]);
  });

  it("allows status transactions for different plans to overlap", async () => {
    const setup = fixture();
    await setup.raw.writeFile("/repo/other.md", setup.content);
    const release = deferred();
    const writes = vi.fn(async () => { await release.promise; });
    const fs: PipelineFileSystem = { ...setup.fs, async writeFile(file, data, options) {
      if (file.endsWith(".tmp")) await writes();
      await setup.fs.writeFile(file, data, options);
    } };
    const operations = [planPath, "/repo/other.md"].map(file => writeTaskStatus({ fs, planPath: file, taskId: "first", status: "done" }));
    try {
      await vi.waitFor(() => expect(writes).toHaveBeenCalledTimes(2));
      release.resolve();
      await Promise.all(operations);
      expect(await setup.raw.readdir("/repo")).toEqual(["other.md", "plan.md"]);
    } finally {
      release.resolve();
      await Promise.allSettled(operations);
    }
  });
});
