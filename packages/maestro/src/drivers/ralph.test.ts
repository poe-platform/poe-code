import * as fs from "node:fs/promises";
import type { SpawnMode } from "@poe-code/agent-spawn";
import type { AgentRunInput, RalphRunOptions, RalphRunResult } from "@poe-code/ralph";
import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createConfig, createDriverContext, createTask } from "../__test_utils__/fixtures.js";
import { createMockSpawn } from "../__test_utils__/mock-spawn.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { AttemptEvent } from "../agent/runner.js";
import type { FailureCategory } from "../runtime/phases.js";
import { createRalphDriver, ralphDriver } from "./ralph.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    default: fs.promises
  };
});

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

describe("ralphDriver", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vol.reset();
  });

  it("copies the plan file into the task workspace before running ralph", async () => {
    const source = planDoc("Implement the thing");
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": source
    });
    const driver = createRalphDriver({
      runRalph: async (options) => {
        await expect(fs.readFile(options.docPath, "utf8")).resolves.toBe(source);
        expect(options.docPath).toBe("/repo/workspaces/task-1/ralph-plan.md");
        return result(options.docPath, "completed");
      }
    });

    const outcome = await driver.run(createDriverContext(ralphContextDefaults));

    expect(outcome).toEqual({ reason: "normal" });
  });

  it("does not follow an existing workspace plan symlink while copying the plan", async () => {
    const source = planDoc("Implement the thing");
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": source,
      "/outside/workspace-plan.md": "outside-state\n"
    });
    vol.mkdirSync("/repo/workspaces/task-1", { recursive: true });
    vol.symlinkSync("/outside/workspace-plan.md", "/repo/workspaces/task-1/ralph-plan.md");
    const driver = createRalphDriver({
      runRalph: async (options) => {
        await expect(fs.readFile(options.docPath, "utf8")).resolves.toBe(source);
        expect((await fs.lstat(options.docPath)).isSymbolicLink()).toBe(false);
        return result(options.docPath, "completed");
      }
    });

    const outcome = await driver.run(createDriverContext(ralphContextDefaults));

    expect(outcome).toEqual({ reason: "normal" });
    expect(vol.readFileSync("/outside/workspace-plan.md", "utf8")).toBe("outside-state\n");
    expect(vol.lstatSync("/repo/workspaces/task-1/ralph-plan.md").isSymbolicLink()).toBe(false);
  });

  it("fails before running ralph when the plan cannot be copied into the workspace", async () => {
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Copy failure")
    });
    vi.spyOn(fs, "readFile").mockRejectedValueOnce("copy denied");
    const runRalph = vi.fn(async (options: RalphRunOptions) =>
      result(options.docPath, "completed")
    );
    const driver = createRalphDriver({ runRalph });

    await expect(driver.run(createDriverContext(ralphContextDefaults))).resolves.toEqual({
      reason: "abnormal",
      failure: "step_failed",
      failedStep: "ralph",
      error: "copy denied"
    });
    expect(runRalph).not.toHaveBeenCalled();
  });

  it("drives a 1-iteration plan to completion and persists ralph frontmatter updates", async () => {
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Implement the thing")
    });
    const driver = createRalphDriver({
      runRalph: scriptedRalph({
        iterations: [
          {
            afterRun: async (options) => {
              await fs.writeFile(
                options.docPath,
                planDoc("Implement the thing", { status: "completed", iteration: 1 }),
                "utf8"
              );
            }
          }
        ]
      })
    });
    const events: AttemptEvent[] = [];
    const mockSpawn = createMockSpawn();
    const ctx = createDriverContext({
      ...ralphContextDefaults,
      events,
      spawn: mockSpawn.spawn
    });

    const outcome = await driver.run(ctx);

    expect(outcome).toEqual({ reason: "normal" });
    expect(vol.readFileSync("/repo/workspaces/task-1/ralph-plan.md", "utf8")).toContain(
      "state: completed"
    );
    expect(vol.readFileSync("/repo/docs/plans/ralph-plan.md", "utf8")).toContain("iteration: 1");
    expect(
      events.filter((event) => event.type === "attempt_phase").map((event) => event.to)
    ).toEqual(["running-step", "succeeded"]);
    expect(
      events.filter((event) => event.type === "agent_event").map((event) => event.step)
    ).toEqual(["ralph"]);
  });

  it("overwrites the original plan with ralph's updated plan and advances mtime", async () => {
    const original = planDoc("Persist me");
    const updated = planDoc("Persist me\n\nDone", { status: "completed", iteration: 1 });
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": original
    });
    vol.utimesSync(
      "/repo/docs/plans/ralph-plan.md",
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-01T00:00:00.000Z")
    );
    const beforeMtime = (await fs.stat("/repo/docs/plans/ralph-plan.md")).mtimeMs;
    const driver = createRalphDriver({
      runRalph: async (options) => {
        await fs.writeFile(options.docPath, updated, "utf8");
        return result(options.docPath, "completed");
      }
    });

    const outcome = await driver.run(createDriverContext(ralphContextDefaults));

    expect(outcome).toEqual({ reason: "normal" });
    await expect(fs.readFile("/repo/docs/plans/ralph-plan.md", "utf8")).resolves.toBe(updated);
    expect((await fs.stat("/repo/docs/plans/ralph-plan.md")).mtimeMs).toBeGreaterThan(beforeMtime);
  });

  it.each([
    { name: "null", planPath: null },
    { name: "undefined", planPath: undefined }
  ])("fails when planPath is $name", async ({ planPath }) => {
    const ctx = createDriverContext({
      ...ralphContextDefaults,
      planPath
    } as Parameters<typeof createDriverContext>[0]);

    await expect(ralphDriver.run(ctx)).resolves.toEqual({
      reason: "abnormal",
      failure: "step_failed",
      failedStep: "ralph",
      error: "ralph driver requires a file-backed task"
    });
  });

  it("maps Ralph stopReason completed to a succeeded outcome", async () => {
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Complete")
    });
    const events: AttemptEvent[] = [];
    const driver = createRalphDriver({
      runRalph: async (options) => result(options.docPath, "completed")
    });

    const outcome = await driver.run(createDriverContext({ ...ralphContextDefaults, events }));

    expect(outcome).toEqual({ reason: "normal" });
    expect(events.filter((event) => event.type === "attempt_phase").at(-1)).toMatchObject({
      to: "succeeded"
    });
  });

  it("maps Ralph stopReason cancelled to a canceled outcome", async () => {
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Cancel")
    });
    const events: AttemptEvent[] = [];
    const driver = createRalphDriver({
      runRalph: async (options) => result(options.docPath, "cancelled")
    });

    const outcome = await driver.run(createDriverContext({ ...ralphContextDefaults, events }));

    expect(outcome).toEqual({ reason: "abnormal", failure: "canceled" });
    expect(events.filter((event) => event.type === "attempt_phase").at(-1)).toMatchObject({
      to: "canceled",
      failure: "canceled"
    });
  });

  it.each([
    "workspace_error",
    "prompt_render_error",
    "agent_startup_error",
    "step_failed",
    "step_timeout",
    "agent_crashed"
  ] satisfies FailureCategory[])(
    "maps Ralph stopReason failed with reported %s to that failure category",
    async (failure) => {
      vol.fromJSON({
        "/repo/docs/plans/ralph-plan.md": planDoc("Fail")
      });
      const events: AttemptEvent[] = [];
      const driver = createRalphDriver({
        runRalph: async (options) => ({
          ...result(options.docPath, "failed"),
          failure
        })
      });

      const outcome = await driver.run(createDriverContext({ ...ralphContextDefaults, events }));

      expect(outcome).toEqual({
        reason: "abnormal",
        failure,
        failedStep: "ralph",
        error: `ralph reported ${failure}`
      });
      expect(events.filter((event) => event.type === "attempt_phase").at(-1)).toMatchObject({
        to: "failed",
        failure
      });
    }
  );

  it("maps Ralph stopReason failed without a reported reason to step_failed", async () => {
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Fail")
    });
    const driver = createRalphDriver({
      runRalph: async (options) => result(options.docPath, "failed")
    });

    await expect(driver.run(createDriverContext(ralphContextDefaults))).resolves.toEqual({
      reason: "abnormal",
      failure: "step_failed",
      failedStep: "ralph",
      error: "ralph reported step_failed"
    });
  });

  it("maps Ralph stopReason timeout to step_timeout", async () => {
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Timeout")
    });
    const driver = createRalphDriver({
      runRalph: async (options) =>
        ({
          ...result(options.docPath, "failed"),
          stopReason: "timeout"
        }) as RalphRunResult
    });

    await expect(driver.run(createDriverContext(ralphContextDefaults))).resolves.toEqual({
      reason: "abnormal",
      failure: "step_timeout",
      failedStep: "ralph",
      error: "ralph reported timeout"
    });
  });

  it("maps an abort mid-iteration to canceled without persisting partial plan changes", async () => {
    const original = planDoc("Stop cleanly");
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": original
    });
    const controller = new AbortController();
    const driver = createRalphDriver({
      runRalph: async (options) => {
        await fs.writeFile(options.docPath, planDoc("Partial work", { iteration: 1 }), "utf8");
        controller.abort();
        return result(options.docPath, "cancelled");
      }
    });
    const ctx = createDriverContext({
      ...ralphContextDefaults,
      abort: controller.signal
    });

    await expect(driver.run(ctx)).resolves.toEqual({
      reason: "abnormal",
      failure: "canceled"
    });
    await expect(fs.readFile("/repo/docs/plans/ralph-plan.md", "utf8")).resolves.toBe(original);
  });

  it("maps an AbortError thrown by ralph to canceled", async () => {
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Throw abort")
    });
    const abortError = new Error("stop");
    abortError.name = "AbortError";
    const driver = createRalphDriver({
      runRalph: async () => {
        throw abortError;
      }
    });

    await expect(driver.run(createDriverContext(ralphContextDefaults))).resolves.toEqual({
      reason: "abnormal",
      failure: "canceled"
    });
  });

  it("maps spawn activity timeouts to step_timeout", async () => {
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Time out")
    });
    const timeoutError = new Error("no activity for 1500ms");
    timeoutError.name = "ActivityTimeoutError";
    const driver = createRalphDriver({
      runRalph: async () => {
        throw timeoutError;
      }
    });

    await expect(driver.run(createDriverContext(ralphContextDefaults))).resolves.toEqual({
      reason: "abnormal",
      failure: "step_timeout",
      failedStep: "ralph",
      error: "no activity for 1500ms"
    });
  });

  it("returns step_failed without corrupting the original plan when persistence fails", async () => {
    const original = planDoc("Keep original");
    const updated = planDoc("Updated", { status: "completed", iteration: 1 });
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": original
    });
    let tempPath: string | undefined;
    const realWriteFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (filePath, content, options) => {
      if (String(filePath).startsWith(`/repo/docs/plans/.ralph-plan.md.${process.pid}.`)) {
        tempPath = String(filePath);
        await realWriteFile(filePath, "partial\n", options);
        throw new Error("disk full");
      }

      return realWriteFile(filePath, content, options);
    });
    const driver = createRalphDriver({
      runRalph: async (options) => {
        await realWriteFile(options.docPath, updated, "utf8");
        return result(options.docPath, "completed");
      }
    });

    await expect(driver.run(createDriverContext(ralphContextDefaults))).resolves.toEqual({
      reason: "abnormal",
      failure: "step_failed",
      failedStep: "ralph",
      error: "disk full"
    });
    await expect(fs.readFile("/repo/docs/plans/ralph-plan.md", "utf8")).resolves.toBe(original);
    expect(tempPath).toBeDefined();
    await expect(fs.readFile(tempPath as string, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans temp writes that only inherit existing-path codes", async () => {
    const original = planDoc("Keep original");
    const updated = planDoc("Updated", { status: "completed", iteration: 1 });
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": original
    });
    const tempPaths: string[] = [];
    const realWriteFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (filePath, content, options) => {
      const targetPath = String(filePath);
      if (targetPath.startsWith(`/repo/docs/plans/.ralph-plan.md.${process.pid}.`)) {
        tempPaths.push(targetPath);
        await realWriteFile(filePath, "partial\n", options);
        throw new Error("disk full");
      }

      return realWriteFile(filePath, content, options);
    });
    const driver = createRalphDriver({
      runRalph: async (options) => {
        await realWriteFile(options.docPath, updated, "utf8");
        return result(options.docPath, "completed");
      }
    });

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(driver.run(createDriverContext(ralphContextDefaults))).resolves.toEqual({
        reason: "abnormal",
        failure: "step_failed",
        failedStep: "ralph",
        error: "disk full"
      });
    });

    expect(tempPaths).toHaveLength(1);
    await expect(fs.readFile(tempPaths[0] as string, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not follow a temp symlink inserted before plan publication", async () => {
    const original = planDoc("Keep original");
    const updated = planDoc("Updated", { status: "completed", iteration: 1 });
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": original,
      "/outside/ralph-plan.tmp": "outside-state\n"
    });
    let tempPath: string | undefined;
    const realWriteFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (filePath, content, options) => {
      const targetPath = String(filePath);
      if (targetPath.startsWith(`/repo/docs/plans/.ralph-plan.md.${process.pid}.`)) {
        tempPath = targetPath;
        vol.symlinkSync("/outside/ralph-plan.tmp", targetPath);
      }

      return realWriteFile(filePath, content, options);
    });
    const driver = createRalphDriver({
      runRalph: async (options) => {
        await realWriteFile(options.docPath, updated, "utf8");
        return result(options.docPath, "completed");
      }
    });

    await expect(driver.run(createDriverContext(ralphContextDefaults))).resolves.toMatchObject({
      reason: "abnormal",
      failure: "step_failed",
      failedStep: "ralph"
    });
    expect(tempPath).toBeDefined();
    expect(vol.readFileSync("/outside/ralph-plan.tmp", "utf8")).toBe("outside-state\n");
    expect(vol.lstatSync(tempPath as string).isSymbolicLink()).toBe(true);
    await expect(fs.readFile("/repo/docs/plans/ralph-plan.md", "utf8")).resolves.toBe(original);
  });

  it("returns step_failed when archive fallback probing hits an unexpected fs error", async () => {
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Stat failure")
    });
    const realLstat = fs.lstat.bind(fs);
    vi.spyOn(fs, "lstat").mockImplementation(async (filePath) => {
      if (filePath === "/repo/workspaces/task-1/ralph-plan.md") {
        throw Object.assign(new Error("stat denied"), { code: "EACCES" });
      }

      return realLstat(filePath);
    });
    const driver = createRalphDriver({
      runRalph: async (options) => result(options.docPath, "completed")
    });

    await expect(driver.run(createDriverContext(ralphContextDefaults))).resolves.toEqual({
      reason: "abnormal",
      failure: "step_failed",
      failedStep: "ralph",
      error: "stat denied"
    });
  });

  it("returns step_failed when archive fallback probing only inherits missing-path codes", async () => {
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Stat failure")
    });
    const realLstat = fs.lstat.bind(fs);
    const statError = new Error("stat failed");
    vi.spyOn(fs, "lstat").mockImplementation(async (filePath) => {
      if (filePath === "/repo/workspaces/task-1/ralph-plan.md") {
        throw statError;
      }

      return realLstat(filePath);
    });
    const driver = createRalphDriver({
      runRalph: async (options) => result(options.docPath, "completed")
    });

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(driver.run(createDriverContext(ralphContextDefaults))).resolves.toEqual({
        reason: "abnormal",
        failure: "step_failed",
        failedStep: "ralph",
        error: "stat failed"
      });
    });
  });

  it("persists ralph output from the archive fallback when the workspace plan was moved", async () => {
    const updated = planDoc("Archived update", { status: "completed", iteration: 1 });
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Archive me")
    });
    const driver = createRalphDriver({
      runRalph: async (options) => {
        await fs.mkdir("/repo/workspaces/task-1/archive", { recursive: true });
        await fs.writeFile("/repo/workspaces/task-1/archive/ralph-plan.md", updated, "utf8");
        await fs.rm(options.docPath);
        return result(options.docPath, "completed");
      }
    });

    const outcome = await driver.run(createDriverContext(ralphContextDefaults));

    expect(outcome).toEqual({ reason: "normal" });
    await expect(fs.readFile("/repo/docs/plans/ralph-plan.md", "utf8")).resolves.toBe(updated);
    await expect(fs.readFile("/repo/workspaces/task-1/ralph-plan.md", "utf8")).resolves.toBe(
      updated
    );
  });

  it("does not follow a workspace symlink inserted before archive fallback restore", async () => {
    const updated = planDoc("Archived update", { status: "completed", iteration: 1 });
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Archive me"),
      "/outside/workspace-plan.md": "outside-state\n"
    });
    const driver = createRalphDriver({
      runRalph: async (options) => {
        await fs.mkdir("/repo/workspaces/task-1/archive", { recursive: true });
        await fs.writeFile("/repo/workspaces/task-1/archive/ralph-plan.md", updated, "utf8");
        await fs.rm(options.docPath);
        await fs.symlink("/outside/workspace-plan.md", options.docPath);
        return result(options.docPath, "completed");
      }
    });

    const outcome = await driver.run(createDriverContext(ralphContextDefaults));

    expect(outcome).toEqual({ reason: "normal" });
    expect(vol.readFileSync("/outside/workspace-plan.md", "utf8")).toBe("outside-state\n");
    expect(vol.lstatSync("/repo/workspaces/task-1/ralph-plan.md").isSymbolicLink()).toBe(false);
    await expect(fs.readFile("/repo/workspaces/task-1/ralph-plan.md", "utf8")).resolves.toBe(
      updated
    );
    await expect(fs.readFile("/repo/docs/plans/ralph-plan.md", "utf8")).resolves.toBe(updated);
  });

  it("fails cleanly when ralph removes the workspace plan and the archive fallback is missing", async () => {
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Missing archive")
    });
    const driver = createRalphDriver({
      runRalph: async (options) => {
        await fs.rm(options.docPath);
        return result(options.docPath, "completed");
      }
    });

    await expect(driver.run(createDriverContext(ralphContextDefaults))).resolves.toMatchObject({
      reason: "abnormal",
      failure: "step_failed",
      failedStep: "ralph"
    });
  });

  it("forwards ralph runAgent input to spawn with the per-task workspace cwd", async () => {
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Forward this prompt", {
        agent: "codex",
        model: "openai/gpt-5.4"
      })
    });
    const controller = new AbortController();
    const mockSpawn = createMockSpawn({
      codex: [
        {
          kind: "assert",
          fn: (call) => {
            expect(call).toEqual({
              agent: "codex",
              prompt: "Forward this prompt",
              model: "openai/gpt-5.4",
              mode: "yolo",
              cwd: "/repo/workspaces/task-1",
              skills: ["audit"],
              logDir: "/repo/logs",
              logFileName: "task.jsonl",
              hooks: { from: "claude" },
              signal: controller.signal
            });
          }
        }
      ]
    });
    const driver = createRalphDriver({
      runRalph: scriptedRalph({
        iterations: [
          {
            agent: "codex",
            model: "openai/gpt-5.4",
            mode: "yolo",
            prompt: "Forward this prompt",
            skills: ["audit"],
            logDir: "/repo/logs",
            logFileName: "task.jsonl",
            hooks: { from: "claude" }
          }
        ]
      })
    });
    const ctx = createDriverContext({
      ...ralphContextDefaults,
      abort: controller.signal,
      spawn: mockSpawn.spawn
    });

    await driver.run(ctx);

    expect(mockSpawn.calls).toHaveLength(1);
  });

  it("uses unique temp paths for concurrent plan publication", async () => {
    const updated = planDoc("Updated", { status: "completed", iteration: 1 });
    vol.fromJSON({ "/repo/docs/plans/ralph-plan.md": planDoc("Original") });
    const writes: string[] = [];
    const writeOptions: unknown[] = [];
    const realWriteFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (filePath, content, options) => {
      if (String(filePath).startsWith("/repo/docs/plans/.ralph-plan.md.")) {
        writes.push(String(filePath));
        writeOptions.push(options);
      }
      return realWriteFile(filePath, content, options);
    });
    const driver = createRalphDriver({
      runRalph: async (options) => {
        await realWriteFile(options.docPath, updated, "utf8");
        return result(options.docPath, "completed");
      }
    });

    await Promise.all([
      driver.run(createDriverContext(ralphContextDefaults)),
      driver.run(createDriverContext(ralphContextDefaults))
    ]);

    expect(new Set(writes).size).toBe(2);
    expect(writeOptions).toEqual([
      { encoding: "utf8", flag: "wx" },
      { encoding: "utf8", flag: "wx" }
    ]);
  });

  it("runs three Ralph iterations, emits three agent events, and succeeds once", async () => {
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Iterate", { iterations: 3 })
    });
    const events: AttemptEvent[] = [];
    const mockSpawn = createMockSpawn();
    const driver = createRalphDriver({
      runRalph: scriptedRalph({
        iterations: [
          { prompt: "Iteration 1" },
          { prompt: "Iteration 2" },
          {
            prompt: "Iteration 3",
            afterRun: async (options) => {
              await fs.writeFile(
                options.docPath,
                planDoc("Iterate", { status: "completed", iteration: 3, iterations: 3 }),
                "utf8"
              );
            }
          }
        ]
      })
    });

    const outcome = await driver.run(
      createDriverContext({ ...ralphContextDefaults, events, spawn: mockSpawn.spawn })
    );

    expect(outcome).toEqual({ reason: "normal" });
    expect(events.filter((event) => event.type === "agent_event")).toEqual([
      agentEvent(1, true),
      agentEvent(2, true),
      agentEvent(3, true)
    ]);
    expect(
      events.filter((event) => event.type === "attempt_phase" && event.to === "succeeded")
    ).toHaveLength(1);
    expect(mockSpawn.calls.map((call) => call.prompt)).toEqual([
      "Iteration 1",
      "Iteration 2",
      "Iteration 3"
    ]);
  });
});

type ScriptedIteration = {
  agent?: string;
  model?: string;
  mode?: SpawnMode;
  prompt?: string;
  skills?: string[];
  logDir?: string;
  logFileName?: string;
  hooks?: AgentRunInput["hooks"];
  success?: boolean;
  afterRun?: (options: RalphRunOptions) => Promise<void>;
};

type DriverRalphRunResult = Omit<RalphRunResult, "stopReason"> & {
  stopReason: RalphRunResult["stopReason"] | "timeout";
  failure?: FailureCategory;
};

function scriptedRalph(options: {
  iterations: ScriptedIteration[];
  stopReason?: DriverRalphRunResult["stopReason"];
}): (runOptions: RalphRunOptions) => Promise<RalphRunResult> {
  return async (runOptions) => {
    for (const [index, iteration] of options.iterations.entries()) {
      const runResult = await runOptions.runAgent?.({
        agent: iteration.agent ?? "codex",
        prompt: iteration.prompt ?? `Iteration ${index + 1}`,
        cwd: runOptions.cwd,
        model: iteration.model,
        mode: iteration.mode,
        skills: iteration.skills,
        logDir: iteration.logDir,
        logFileName: iteration.logFileName,
        hooks: iteration.hooks,
        signal: runOptions.signal
      } as AgentRunInput & { mode?: SpawnMode });

      await iteration.afterRun?.(runOptions);
      runOptions.onIterationComplete?.(
        index + 1,
        index + 10,
        iteration.success ?? runResult?.exitCode === 0
      );
    }

    return result(runOptions.docPath, options.stopReason ?? "completed", options.iterations.length);
  };
}

function result(
  docPath: string,
  stopReason: DriverRalphRunResult["stopReason"],
  iterationsCompleted = 1
): RalphRunResult {
  return {
    stopReason,
    docPath,
    iterationsCompleted,
    totalDurationMs: 1
  } as RalphRunResult;
}

function agentEvent(iteration: number, success: boolean): AttemptEvent {
  return {
    type: "agent_event",
    task_id: "tasks/task-1",
    step: "ralph",
    session_id: "",
    event: "iteration_complete",
    payload: { iteration, durationMs: iteration + 9, success }
  };
}

function planDoc(
  body: string,
  options: {
    agent?: string;
    model?: string;
    iterations?: number;
    status?: "open" | "in_progress" | "completed" | "failed";
    iteration?: number;
  } = {}
): string {
  const agent = options.model
    ? `${options.agent ?? "codex"}:${options.model}`
    : (options.agent ?? "codex");
  const status = options.status
    ? [`status:`, `  state: ${options.status}`, `  iteration: ${options.iteration ?? 0}`]
    : [];

  return [
    "---",
    `agent: ${agent}`,
    `iterations: ${options.iterations ?? 1}`,
    ...status,
    "---",
    body
  ].join("\n");
}

const ralphContextDefaults = {
  task: createTask({
    name: "Ralph task",
    state: "in-progress",
    description: "Run ralph",
    metadata: { kind: "ralph" }
  }),
  workspaceDir: "/repo/workspaces/task-1",
  planPath: "/repo/docs/plans/ralph-plan.md",
  cfg: createConfig({
    tasks: { type: "markdown-dir", path: "/repo/docs/plans" },
    states: {
      planned: { prompt: "Plan {{ prompt }}" },
      "in-progress": { prompt: "Implement {{ prompt }}" },
      done: { terminal: true },
      archived: { terminal: true }
    },
    workspace: { root: "/repo/workspaces" }
  })
} satisfies {
  task: ReturnType<typeof createTask>;
  workspaceDir: string;
  planPath: string;
  cfg: ResolvedConfig;
};
