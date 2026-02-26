import { describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../../../../src/utils/file-system.js";
import { parsePlan } from "../plan/parser.js";
import { buildLoop } from "./loop.js";
import { createRalphSimulation, completeTurn } from "../testing/simulation.js";

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const vol = Volume.fromJSON(files, "/");
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

const noLock = async () => async () => {};

describe("buildLoop", () => {
  it("completes a story and marks it done", async () => {
    const planPath = "/.agents/tasks/plan.json";
    const promptPath = "/.agents/poe-code-ralph/PROMPT_build.md";
    const errorsLogPath = "/.poe-code-ralph/errors.log";
    const runId = "20260201-221816-14669";

    const fs = createMemFs({
      [promptPath]: [
        "# Test Prompt",
        "ID: {{STORY_ID}}",
        "{{STORY_BLOCK}}",
        "Commit: {{COMMIT}}",
        "Run: {{RUN_ID}} Iter: {{ITERATION}}",
        "Gates:",
        "{{QUALITY_GATES}}",
        ""
      ].join("\n"),
      [errorsLogPath]: "",
      [planPath]: JSON.stringify(
        {
          version: 1,
          project: "Test",
          goals: [],
          nonGoals: [],
          qualityGates: ["npm run test", "npm run lint"],
          stories: [
            {
              id: "US-001",
              title: "Do the thing",
              status: "open",
              dependsOn: [],
              description: "As a user, I want a thing.",
              acceptanceCriteria: ["Criterion A", "Criterion B"]
            }
          ]
        },
        null,
        2
      )
    });

    let capturedPrompt = "";
    const spawn = vi.fn(async (_agent: string, options: { prompt: string; useStdin?: boolean }) => {
      capturedPrompt = options.prompt;
      expect(options.useStdin).toBe(true);
      return {
        stdout: "<promise>COMPLETE</promise>",
        stderr: "",
        exitCode: 0
      };
    });

    const result = await buildLoop({
      planPath,
      maxIterations: 3,
      commit: true,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => []
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    expect(result.iterationsCompleted).toBe(1);
    expect(result.storiesDone).toEqual(["US-001"]);
    expect(spawn).toHaveBeenCalledWith("codex", expect.objectContaining({ useStdin: true }));
    expect(capturedPrompt).toContain("ID: US-001");
    expect(capturedPrompt).toContain("### US-001: Do the thing");
    expect(capturedPrompt).toContain("- [ ] Criterion A");
    expect(capturedPrompt).toContain("Commit: true");
    expect(capturedPrompt).toContain("Run: 20260201-221816-14669 Iter: 1");
    expect(capturedPrompt).toContain("npm run test");

    const updated = parsePlan(await fs.readFile(planPath, "utf8"));
    expect(updated.stories[0]?.status).toBe("done");
    expect(updated.stories[0]?.completedAt).toBeTruthy();

    const logPath = `/.poe-code-ralph/runs/run-${runId}-iter-1.log`;
    const metaPath = `/.poe-code-ralph/runs/run-${runId}-iter-1.md`;
    expect(await fs.readFile(logPath, "utf8")).toContain("<promise>COMPLETE</promise>");
    expect(await fs.readFile(metaPath, "utf8")).toContain("- Status: success");
  });

  it("uses configured paths for prompt variables and errors log", async () => {
    const planPath = "/.agents/tasks/plan.json";
    const promptPath = "/.agents/poe-code-ralph/PROMPT_build.md";
    const runId = "20260201-221816-14669";

    const fs = createMemFs({
      [promptPath]: [
        "Progress: {{PROGRESS_PATH}}",
        "Guardrails: {{GUARDRAILS_PATH}}",
        "Errors: {{ERRORS_LOG_PATH}}",
        "Activity: {{ACTIVITY_LOG_PATH}}",
        ""
      ].join("\n"),
      [planPath]: JSON.stringify(
        {
          version: 1,
          project: "Test",
          goals: [],
          nonGoals: [],
          qualityGates: [],
          stories: [
            {
              id: "US-001",
              title: "Do the thing",
              status: "open",
              dependsOn: [],
              description: "As a user, I want a thing.",
              acceptanceCriteria: []
            }
          ]
        },
        null,
        2
      )
    });

    let capturedPrompt = "";
    const spawn = vi.fn(async (_agent: string, options: { prompt: string; useStdin?: boolean }) => {
      capturedPrompt = options.prompt;
      return {
        stdout: "",
        stderr: "boom",
        exitCode: 1
      };
    });

    const result = await buildLoop({
      planPath,
      progressPath: "custom/progress.md",
      guardrailsPath: "custom/guardrails.md",
      errorsLogPath: "custom/errors.log",
      activityLogPath: "custom/activity.log",
      maxIterations: 1,
      commit: true,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => []
        },
        now: () => new Date("2026-02-02T00:00:00.000Z")
      }
    });

    expect(result.stopReason).toBe("max_iterations");
    expect(capturedPrompt).toContain("Progress: /custom/progress.md");
    expect(capturedPrompt).toContain("Guardrails: /custom/guardrails.md");
    expect(capturedPrompt).toContain("Errors: /custom/errors.log");
    expect(capturedPrompt).toContain("Activity: /custom/activity.log");

    expect(await fs.readFile("/custom/errors.log", "utf8")).toContain("boom");
  });

  it("resets story to open when agent fails", async () => {
    const planPath = "/.agents/tasks/plan.json";
    const promptPath = "/.agents/poe-code-ralph/PROMPT_build.md";
    const errorsLogPath = "/.poe-code-ralph/errors.log";
    const runId = "20260201-221816-14669";

    const fs = createMemFs({
      [promptPath]: "ID: {{STORY_ID}}\n{{STORY_BLOCK}}\n",
      [errorsLogPath]: "",
      [planPath]: JSON.stringify(
        {
          version: 1,
          project: "Test",
          goals: [],
          nonGoals: [],
          qualityGates: [],
          stories: [
            {
              id: "US-001",
              title: "Do the thing",
              status: "open",
              dependsOn: [],
              description: "As a user, I want a thing.",
              acceptanceCriteria: ["Criterion A"]
            }
          ]
        },
        null,
        2
      )
    });

    const spawn = async () => {
      return {
        stdout: "crash",
        stderr: "boom\n",
        exitCode: 1
      };
    };

    const result = await buildLoop({
      planPath,
      maxIterations: 1,
      commit: false,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => []
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    expect(result.iterationsCompleted).toBe(1);
    expect(result.storiesDone).toEqual([]);

    const updated = parsePlan(await fs.readFile(planPath, "utf8"));
    expect(updated.stories[0]?.status).toBe("open");

    expect(await fs.readFile(errorsLogPath, "utf8")).toContain("boom");
    const metaPath = `/.poe-code-ralph/runs/run-${runId}-iter-1.md`;
    expect(await fs.readFile(metaPath, "utf8")).toContain("- Status: failure");
  });

  it("detects completion only from stdout (not stderr)", async () => {
    const planPath = "/.agents/tasks/plan.json";
    const promptPath = "/.agents/poe-code-ralph/PROMPT_build.md";
    const errorsLogPath = "/.poe-code-ralph/errors.log";
    const runId = "20260201-221816-14669";

    const fs = createMemFs({
      [promptPath]: "ID: {{STORY_ID}}\n{{STORY_BLOCK}}\n",
      [errorsLogPath]: "",
      [planPath]: JSON.stringify(
        {
          version: 1,
          project: "Test",
          goals: [],
          nonGoals: [],
          qualityGates: [],
          stories: [
            {
              id: "US-001",
              title: "Do the thing",
              status: "open",
              dependsOn: [],
              description: "As a user, I want a thing.",
              acceptanceCriteria: ["Criterion A"]
            }
          ]
        },
        null,
        2
      )
    });

    const spawn = async () => ({
      stdout: "not done",
      stderr: "<promise>COMPLETE</promise>",
      exitCode: 0
    });

    const result = await buildLoop({
      planPath,
      maxIterations: 1,
      commit: true,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => []
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    expect(result.iterations[0]?.status).toBe("incomplete");
    const updated = parsePlan(await fs.readFile(planPath, "utf8"));
    expect(updated.stories[0]?.status).toBe("open");
  });

  it("auto-skips story after max failures in non-interactive mode", async () => {
    const planPath = "/.agents/tasks/plan.json";
    const promptPath = "/.agents/poe-code-ralph/PROMPT_build.md";
    const errorsLogPath = "/.poe-code-ralph/errors.log";
    const runId = "20260201-221816-14669";

    const fs = createMemFs({
      [promptPath]: "ID: {{STORY_ID}}\n{{STORY_BLOCK}}\n",
      [errorsLogPath]: "",
      [planPath]: JSON.stringify(
        {
          version: 1,
          project: "Test",
          goals: [],
          nonGoals: [],
          qualityGates: [],
          stories: [
            {
              id: "US-001",
              title: "Flaky story",
              status: "open",
              dependsOn: [],
              description: "As a user, I want a thing.",
              acceptanceCriteria: ["Criterion A"]
            }
          ]
        },
        null,
        2
      )
    });

    const spawn = vi.fn(async () => ({
      stdout: "crash",
      stderr: "boom\n",
      exitCode: 1
    }));

    let stderrOutput = "";
    const stderr = { write: (chunk: string) => (stderrOutput += chunk) };

    const result = await buildLoop({
      planPath,
      maxIterations: 10,
      maxFailures: 3,
      commit: true,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        stderr,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => []
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    // Agent should only be called 3 times (threshold), then story is auto-skipped
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(result.stopReason).toBe("no_actionable_stories");

    const errors = await fs.readFile(errorsLogPath, "utf8");
    expect(errors).toContain("[OVERBAKE]");
    expect(stderrOutput).toContain("[OVERBAKE]");
  });

  it("auto-skips story after repeated incomplete iterations", async () => {
    const planPath = "/.agents/tasks/plan.json";
    const promptPath = "/.agents/poe-code-ralph/PROMPT_build.md";
    const errorsLogPath = "/.poe-code-ralph/errors.log";
    const runId = "20260201-221816-14669";

    const fs = createMemFs({
      [promptPath]: "ID: {{STORY_ID}}\n{{STORY_BLOCK}}\n",
      [errorsLogPath]: "",
      [planPath]: JSON.stringify(
        {
          version: 1,
          project: "Test",
          goals: [],
          nonGoals: [],
          qualityGates: [],
          stories: [
            {
              id: "US-001",
              title: "Already done story",
              status: "open",
              dependsOn: [],
              description: "Dep already installed but agent cannot verify.",
              acceptanceCriteria: ["Criterion A"]
            }
          ]
        },
        null,
        2
      )
    });

    // Agent exits 0 but never prints COMPLETE (simulates stuck agent)
    const spawn = vi.fn(async () => ({
      stdout: "checked dep, already there, pnpm install failed ENOTFOUND",
      stderr: "",
      exitCode: 0
    }));

    let stderrOutput = "";
    const stderr = { write: (chunk: string) => (stderrOutput += chunk) };

    const result = await buildLoop({
      planPath,
      maxIterations: 10,
      maxFailures: 3,
      commit: true,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        stderr,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => []
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    // Should stop after 3 attempts, not loop all 10
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(result.stopReason).toBe("no_actionable_stories");

    expect(stderrOutput).toContain("[OVERBAKE]");
    expect(stderrOutput).toContain("US-001");
    const errors = await fs.readFile(errorsLogPath, "utf8");
    expect(errors).toContain("[OVERBAKE]");
  });

  it("does not warn when non-successes are broken by success", async () => {
    const planPath = "/.agents/tasks/plan.json";
    const promptPath = "/.agents/poe-code-ralph/PROMPT_build.md";
    const errorsLogPath = "/.poe-code-ralph/errors.log";
    const runId = "20260201-221816-14669";

    const fs = createMemFs({
      [promptPath]: "ID: {{STORY_ID}}\n{{STORY_BLOCK}}\n",
      [errorsLogPath]: "",
      [planPath]: JSON.stringify(
        {
          version: 1,
          project: "Test",
          goals: [],
          nonGoals: [],
          qualityGates: [],
          stories: [
            {
              id: "US-001",
              title: "Intermittent story",
              status: "open",
              dependsOn: [],
              description: "As a user, I want a thing.",
              acceptanceCriteria: ["Criterion A"]
            }
          ]
        },
        null,
        2
      )
    });

    // Only success resets the streak; failure→success→failure should not trigger
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "fail 1", stderr: "boom", exitCode: 1 })
      .mockResolvedValueOnce({ stdout: "<promise>COMPLETE</promise>", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "fail 2", stderr: "boom", exitCode: 1 });

    let stderrOutput = "";
    const stderr = { write: (chunk: string) => (stderrOutput += chunk) };

    const result = await buildLoop({
      planPath,
      maxIterations: 3,
      maxFailures: 2,
      commit: true,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        stderr,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => []
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    // Story completes on iter 2 (success), so iter 3 has no actionable stories
    expect(result.iterationsCompleted).toBe(2);
    expect(result.stopReason).toBe("no_actionable_stories");
    expect(await fs.readFile(errorsLogPath, "utf8")).not.toContain("[OVERBAKE]");
    expect(stderrOutput).not.toContain("[OVERBAKE]");
  });

  it("passes model to spawn when provided", async () => {
    const planPath = "/.agents/tasks/plan.json";
    const promptPath = "/.agents/poe-code-ralph/PROMPT_build.md";
    const errorsLogPath = "/.poe-code-ralph/errors.log";
    const runId = "20260201-221816-14669";

    const fs = createMemFs({
      [promptPath]: "ID: {{STORY_ID}}\n{{STORY_BLOCK}}\n",
      [errorsLogPath]: "",
      [planPath]: JSON.stringify(
        {
          version: 1,
          project: "Test",
          goals: [],
          nonGoals: [],
          qualityGates: [],
          stories: [
            {
              id: "US-001",
              title: "Do the thing",
              status: "open",
              dependsOn: [],
              description: "As a user, I want a thing.",
              acceptanceCriteria: []
            }
          ]
        },
        null,
        2
      )
    });

    const spawn = vi.fn(async () => ({
      stdout: "<promise>COMPLETE</promise>",
      stderr: "",
      exitCode: 0
    }));

    await buildLoop({
      planPath,
      maxIterations: 1,
      commit: true,
      agent: "codex",
      model: "claude-opus-4-6",
      staleSeconds: 0,
      cwd: "/",
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => []
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    expect(spawn).toHaveBeenCalledWith("codex", expect.objectContaining({ model: "claude-opus-4-6" }));
  });

  it("writes per-iteration headline to stdout before spawn", async () => {
    const planPath = "/.agents/tasks/plan.json";
    const promptPath = "/.agents/poe-code-ralph/PROMPT_build.md";
    const errorsLogPath = "/.poe-code-ralph/errors.log";
    const runId = "20260201-221816-14669";

    const fs = createMemFs({
      [promptPath]: "ID: {{STORY_ID}}\n{{STORY_BLOCK}}\n",
      [errorsLogPath]: "",
      [planPath]: JSON.stringify(
        {
          version: 1,
          project: "Test",
          goals: [],
          nonGoals: [],
          qualityGates: [],
          stories: [
            {
              id: "US-001",
              title: "Do the thing",
              status: "open",
              dependsOn: [],
              description: "As a user, I want a thing.",
              acceptanceCriteria: []
            }
          ]
        },
        null,
        2
      )
    });

    const spawn = vi.fn(async () => ({
      stdout: "<promise>COMPLETE</promise>",
      stderr: "",
      exitCode: 0
    }));

    let stdoutOutput = "";
    const stdout = { write: (chunk: string) => (stdoutOutput += chunk) };

    await buildLoop({
      planPath,
      maxIterations: 3,
      commit: true,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        stdout,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => []
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    expect(stdoutOutput).toContain("1/3");
    expect(stdoutOutput).toContain("Do the thing");
  });

  it("passes model as undefined to spawn when not provided", async () => {
    const planPath = "/.agents/tasks/plan.json";
    const promptPath = "/.agents/poe-code-ralph/PROMPT_build.md";
    const errorsLogPath = "/.poe-code-ralph/errors.log";
    const runId = "20260201-221816-14669";

    const fs = createMemFs({
      [promptPath]: "ID: {{STORY_ID}}\n{{STORY_BLOCK}}\n",
      [errorsLogPath]: "",
      [planPath]: JSON.stringify(
        {
          version: 1,
          project: "Test",
          goals: [],
          nonGoals: [],
          qualityGates: [],
          stories: [
            {
              id: "US-001",
              title: "Do the thing",
              status: "open",
              dependsOn: [],
              description: "As a user, I want a thing.",
              acceptanceCriteria: []
            }
          ]
        },
        null,
        2
      )
    });

    const spawn = vi.fn(async () => ({
      stdout: "<promise>COMPLETE</promise>",
      stderr: "",
      exitCode: 0
    }));

    await buildLoop({
      planPath,
      maxIterations: 1,
      commit: true,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => []
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    expect(spawn).toHaveBeenCalledWith("codex", expect.objectContaining({ model: undefined }));
  });

  it("pauses on overbake and supports continue/skip/abort decisions", async () => {
    const planPath = "/.agents/tasks/plan.json";
    const promptPath = "/.agents/poe-code-ralph/PROMPT_build.md";
    const errorsLogPath = "/.poe-code-ralph/errors.log";
    const runId = "20260201-221816-14669";

    const fs = createMemFs({
      [promptPath]: "ID: {{STORY_ID}}\n{{STORY_BLOCK}}\n",
      [errorsLogPath]: "",
      [planPath]: JSON.stringify(
        {
          version: 1,
          project: "Test",
          goals: [],
          nonGoals: [],
          qualityGates: [],
          stories: [
            {
              id: "US-001",
              title: "Overbaked story",
              status: "open",
              dependsOn: [],
              description: "As a user, I want a thing.",
              acceptanceCriteria: ["Criterion A"]
            },
            {
              id: "US-002",
              title: "Next story",
              status: "open",
              dependsOn: [],
              description: "As a user, I want another thing.",
              acceptanceCriteria: []
            }
          ]
        },
        null,
        2
      )
    });

    const spawn = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "fail", stderr: "boom", exitCode: 1 })
      .mockResolvedValueOnce({ stdout: "fail", stderr: "boom", exitCode: 1 })
      .mockResolvedValueOnce({ stdout: "fail", stderr: "boom", exitCode: 1 })
      .mockResolvedValueOnce({ stdout: "<promise>COMPLETE</promise>", stderr: "", exitCode: 0 });

    const promptOverbake = vi.fn(async () => "skip" as const);

    const result = await buildLoop({
      planPath,
      maxIterations: 4,
      maxFailures: 3,
      pauseOnOverbake: true,
      commit: true,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      deps: {
        fs,
        lock: noLock,
        runId,
        spawn,
        promptOverbake,
        stderr: { write: () => {} },
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => []
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    expect(promptOverbake).toHaveBeenCalledTimes(1);
    expect(result.iterationsCompleted).toBe(4);
    expect(result.storiesDone).toEqual(["US-002"]);

    const updated = parsePlan(await fs.readFile(planPath, "utf8"));
    expect(updated.stories.find((s) => s.id === "US-001")?.status).toBe("open");
    expect(updated.stories.find((s) => s.id === "US-002")?.status).toBe("done");

    // Abort decision exits early.
    const abortSpawn = vi.fn(async () => ({ stdout: "fail", stderr: "boom", exitCode: 1 }));
    const abortPrompt = vi.fn(async () => "abort" as const);
    const abortFs = createMemFs({
      [promptPath]: "ID: {{STORY_ID}}\n{{STORY_BLOCK}}\n",
      [errorsLogPath]: "",
      [planPath]: JSON.stringify(
        {
          version: 1,
          project: "Test",
          goals: [],
          nonGoals: [],
          qualityGates: [],
          stories: [
            {
              id: "US-001",
              title: "Overbaked story",
              status: "open",
              dependsOn: [],
              description: "As a user, I want a thing.",
              acceptanceCriteria: []
            }
          ]
        },
        null,
        2
      )
    });
    const abortResult = await buildLoop({
      planPath,
      maxIterations: 10,
      maxFailures: 3,
      pauseOnOverbake: true,
      commit: true,
      agent: "codex",
      staleSeconds: 0,
      cwd: "/",
      deps: {
        fs: abortFs,
        lock: noLock,
        runId,
        spawn: abortSpawn,
        promptOverbake: abortPrompt,
        stderr: { write: () => {} },
        git: {
          getHead: () => null,
          getCommitList: () => [],
          getChangedFiles: () => [],
          getDirtyFiles: () => []
        },
        now: () => new Date("2026-02-02T06:00:00.000Z")
      }
    });

    expect(abortPrompt).toHaveBeenCalledTimes(1);
    expect(abortSpawn).toHaveBeenCalledTimes(3);
    expect(abortResult.stopReason).toBe("overbake_abort");
  });

  it("runs verification phase after all stories complete", async () => {
    const sim = createRalphSimulation({
      plan: {
        stories: [{ id: "US-001", title: "Build feature" }],
        requirements: [
          {
            id: "R-001",
            title: "Namespacing",
            scenarios: [{ name: "Basic", when: "namespace is called", then: "returns namespaced" }]
          }
        ]
      },
      turns: [
        completeTurn(), // US-001 completes
        completeTurn((prompt) => {
          expect(prompt).toContain("R-001");
          expect(prompt).toContain("Namespacing");
        }) // R-001 verification passes
      ]
    });

    const { result, getRequirement } = await sim.run();
    expect(result.storiesDone).toEqual(["US-001"]);
    expect(result.stopReason).toBe("all_verified");

    const req = await getRequirement("R-001");
    expect(req?.status).toBe("passed");
    expect(req?.verifiedAt).toBeTruthy();
  });

  it("skips verification when plan has no requirements", async () => {
    const sim = createRalphSimulation({
      plan: {
        stories: [{ id: "US-001", title: "Build feature" }]
      },
      turns: [completeTurn()]
    });

    const { result } = await sim.run();
    expect(result.storiesDone).toEqual(["US-001"]);
    expect(result.stopReason).toBe("no_actionable_stories");
  });

  it("resets requirement to pending on verification failure", async () => {
    const sim = createRalphSimulation({
      plan: {
        stories: [{ id: "US-001", title: "Build feature" }],
        requirements: [
          { id: "R-001", title: "Namespacing", scenarios: [] }
        ]
      },
      config: { maxIterations: 3 },
      turns: [
        completeTurn(), // US-001 completes
        { output: { stdout: "not done", exitCode: 0 } } // R-001 incomplete
      ]
    });

    const { result, getRequirement } = await sim.run();
    expect(result.storiesDone).toEqual(["US-001"]);

    const req = await getRequirement("R-001");
    expect(req?.status).toBe("pending");
  });

  it("stops verification after overbaking threshold", async () => {
    const sim = createRalphSimulation({
      plan: {
        stories: [{ id: "US-001", title: "Build feature" }],
        requirements: [
          { id: "R-001", title: "Namespacing", scenarios: [] }
        ]
      },
      config: { maxIterations: 10, maxFailures: 2, pauseOnOverbake: false },
      turns: [
        completeTurn(), // US-001 completes
        { output: { stdout: "fail", stderr: "boom", exitCode: 1 } }, // R-001 fail 1
        { output: { stdout: "fail", stderr: "boom", exitCode: 1 } } // R-001 fail 2 → overbake skip
      ]
    });

    const { result } = await sim.run();
    // Overbake skips R-001, then no more requirements → loop ends
    expect(result.iterationsCompleted).toBe(3);
    expect(result.storiesDone).toEqual(["US-001"]);
  });

  it("verifies multiple requirements sequentially", async () => {
    const sim = createRalphSimulation({
      plan: {
        stories: [{ id: "US-001", title: "Build feature" }],
        requirements: [
          { id: "R-001", title: "First req", scenarios: [] },
          { id: "R-002", title: "Second req", scenarios: [] }
        ]
      },
      turns: [
        completeTurn(), // US-001 completes
        completeTurn((prompt) => expect(prompt).toContain("R-001")),
        completeTurn((prompt) => expect(prompt).toContain("R-002"))
      ]
    });

    const { result, getRequirement } = await sim.run();
    expect(result.stopReason).toBe("all_verified");
    expect((await getRequirement("R-001"))?.status).toBe("passed");
    expect((await getRequirement("R-002"))?.status).toBe("passed");
  });

  it("verification prompt contains scenario details", async () => {
    const sim = createRalphSimulation({
      plan: {
        stories: [{ id: "US-001", title: "Build feature" }],
        requirements: [
          {
            id: "R-001",
            title: "Namespacing",
            description: "Tools SHALL be namespaced.",
            scenarios: [
              { name: "Basic", when: "namespace is called", then: "returns namespaced" }
            ]
          }
        ]
      },
      turns: [
        completeTurn(),
        completeTurn((prompt) => {
          expect(prompt).toContain("Namespacing");
          expect(prompt).toContain("Tools SHALL be namespaced.");
          expect(prompt).toContain("**Basic**");
          expect(prompt).toContain("When: namespace is called");
          expect(prompt).toContain("Then: returns namespaced");
        })
      ]
    });

    await sim.run();
  });

  it("shares iteration budget between stories and verification", async () => {
    const sim = createRalphSimulation({
      plan: {
        stories: [{ id: "US-001", title: "Build feature" }],
        requirements: [
          { id: "R-001", title: "Namespacing", scenarios: [] }
        ]
      },
      config: { maxIterations: 1 },
      turns: [completeTurn()] // US-001 uses the only iteration
    });

    const { result, getRequirement } = await sim.run();
    expect(result.storiesDone).toEqual(["US-001"]);
    expect(result.stopReason).toBe("max_iterations");

    const req = await getRequirement("R-001");
    expect(req?.status).toBe("pending");
  });
});
