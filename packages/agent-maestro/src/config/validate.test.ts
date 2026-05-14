import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "./schema.js";
import { validateDispatch } from "./validate.js";

const { verifyGhProject } = vi.hoisted(() => ({
  verifyGhProject: vi.fn()
}));

vi.mock("@poe-code/task-list", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/task-list")>()),
  verifyGhProject
}));

function cfg(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    tasks: { type: "markdown-dir", path: "/repo/tasks" },
    active_states: ["planned", "in-progress"],
    terminal_states: ["done", "archived"],
    polling: { intervalMs: 30_000 },
    workspace: { root: "/tmp/poe-code-maestro" },
    agent: {
      service: "codex",
      list: "backlog",
      maxConcurrentAgents: 1,
      maxTurns: 20,
      maxRetryBackoffMs: 300_000
    },
    stepOverrides: {},
    ...overrides
  };
}

function taskList(lists: readonly string[] = ["backlog"]) {
  return {
    lists: vi.fn().mockResolvedValue(lists)
  };
}

describe("validateDispatch", () => {
  beforeEach(() => {
    verifyGhProject.mockReset();
  });

  it("fails when tasks config is missing", async () => {
    await expect(
      validateDispatch(cfg({ tasks: undefined }), taskList(), { steps: { implement: step() } })
    ).resolves.toEqual({ ok: false, code: "missing_tasks_config" });
  });

  it("fails when tasks config contains an empty resolved value", async () => {
    await expect(
      validateDispatch(cfg({ tasks: { type: "markdown-dir", path: "" } }), taskList(), {
        steps: { implement: step() }
      })
    ).resolves.toEqual({ ok: false, code: "missing_tasks_config" });
  });

  it("fails when markdown-dir tasks config is missing its path", async () => {
    await expect(
      validateDispatch(
        cfg({ tasks: { type: "markdown-dir" } as ResolvedConfig["tasks"] }),
        taskList(),
        {
          steps: { implement: step() }
        }
      )
    ).resolves.toEqual({ ok: false, code: "missing_tasks_config" });
  });

  it("fails when yaml-file tasks config is missing its path", async () => {
    await expect(
      validateDispatch(
        cfg({ tasks: { type: "yaml-file" } as ResolvedConfig["tasks"] }),
        taskList(),
        {
          steps: { implement: step() }
        }
      )
    ).resolves.toEqual({ ok: false, code: "missing_tasks_config" });
  });

  it("fails when gh-issues tasks config is missing required project fields", async () => {
    await expect(
      validateDispatch(
        cfg({
          tasks: {
            type: "gh-issues",
            repo: "octo/repo",
            project: { owner: "octo" }
          } as ResolvedConfig["tasks"]
        }),
        taskList(),
        { steps: { implement: step() } }
      )
    ).resolves.toEqual({ ok: false, code: "missing_tasks_config" });

    expect(verifyGhProject).not.toHaveBeenCalled();
  });

  it("fails when steps config is missing", async () => {
    await expect(validateDispatch(cfg(), taskList(), undefined)).resolves.toEqual({
      ok: false,
      code: "missing_steps_config"
    });
  });

  it("fails when no steps are defined", async () => {
    await expect(validateDispatch(cfg(), taskList(), { steps: {} })).resolves.toEqual({
      ok: false,
      code: "no_steps_defined"
    });
  });

  it("fails when the configured task list does not exist", async () => {
    await expect(
      validateDispatch(cfg(), taskList(["triage"]), { steps: { implement: step() } })
    ).resolves.toEqual({ ok: false, code: "list_not_found", list: "backlog" });
  });

  it("fails when a gh-issues project board is not provisioned", async () => {
    verifyGhProject.mockResolvedValue({
      ok: false,
      project: null,
      statusField: null,
      missingProject: true,
      missingStatusField: true,
      missingOptions: ["planned"]
    });

    await expect(
      validateDispatch(
        cfg({
          tasks: {
            type: "gh-issues",
            repo: "octo/repo",
            project: { owner: "octo", number: 7 }
          }
        }),
        taskList(),
        { steps: { implement: step() } }
      )
    ).resolves.toEqual({
      ok: false,
      code: "board_not_provisioned",
      report: expect.objectContaining({ ok: false })
    });

    expect(verifyGhProject).toHaveBeenCalledWith({
      owner: "octo",
      number: 7,
      requiredStates: ["planned", "in-progress", "done", "archived"]
    });
  });

  it("returns ok when config, list, steps, and board are valid", async () => {
    verifyGhProject.mockResolvedValue({
      ok: true,
      project: { id: "PVT", number: 7, owner: "octo" },
      statusField: { id: "status", options: [] },
      missingProject: false,
      missingStatusField: false,
      missingOptions: []
    });

    await expect(
      validateDispatch(
        cfg({
          tasks: {
            type: "gh-issues",
            repo: "octo/repo",
            project: { owner: "octo", number: 7 }
          }
        }),
        taskList(),
        { steps: { implement: step() } }
      )
    ).resolves.toEqual({ ok: true });
  });
});

function step() {
  return { mode: "yolo" as const, prompt: "Do it" };
}
