import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockTaskList } from "../__test_utils__/index.js";
import type { ResolvedConfig } from "./schema.js";
import { resolveConfig } from "./schema.js";
import { validateDispatch, type DispatchPreflightCode } from "./validate.js";

const { verifyGhProject } = vi.hoisted(() => ({
  verifyGhProject: vi.fn()
}));

vi.mock("@poe-code/task-list", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/task-list")>()),
  verifyGhProject
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    default: fs.promises
  };
});

function cfg(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    tasks: { type: "markdown-dir", path: "/repo/tasks" },
    states: {
      planned: { prompt: "Plan" },
      "in-progress": { prompt: "Implement" },
      done: { terminal: true },
      archived: { terminal: true }
    },
    activeStateNames: ["planned", "in-progress"],
    terminalStateNames: ["done", "archived"],
    stateOrder: ["planned", "in-progress", "done", "archived"],
    polling: { intervalMs: 30_000 },
    workspace: { root: "/tmp/poe-code-maestro" },
    agent: {
      service: "codex",
      list: "backlog",
      maxConcurrentAgents: 1,
      maxRetryBackoffMs: 300_000
    },
    ...overrides
  };
}

function taskList(lists: readonly string[] = ["backlog"]) {
  return createMockTaskList({ lists });
}

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

const coveredPreflightCodes: Record<DispatchPreflightCode, true> = {
  missing_tasks_config: true,
  tasks_unreachable: true,
  no_active_states: true,
  no_terminal_states: true,
  unknown_initial_state: true,
  list_not_found: true,
  board_not_provisioned: true
};

describe("validateDispatch", () => {
  beforeEach(() => {
    vol.reset();
    verifyGhProject.mockReset();
  });

  it("fails when tasks config is missing", async () => {
    expect(coveredPreflightCodes.missing_tasks_config).toBe(true);

    await expect(validateDispatch(cfg({ tasks: undefined }), taskList())).resolves.toEqual({
      ok: false,
      code: "missing_tasks_config"
    });
  });

  it("fails when tasks config contains an empty resolved value", async () => {
    await expect(
      validateDispatch(cfg({ tasks: { type: "markdown-dir", path: "" } }), taskList())
    ).resolves.toEqual({ ok: false, code: "missing_tasks_config" });
  });

  it("fails when markdown-dir tasks config is missing its path", async () => {
    await expect(
      validateDispatch(
        cfg({ tasks: { type: "markdown-dir" } as ResolvedConfig["tasks"] }),
        taskList()
      )
    ).resolves.toEqual({ ok: false, code: "missing_tasks_config" });
  });

  it("does not accept inherited markdown-dir task fields", async () => {
    await withObjectPrototypeProperties({ path: "/polluted/tasks" }, async () => {
      await expect(
        validateDispatch(
          cfg({ tasks: { type: "markdown-dir" } as ResolvedConfig["tasks"] }),
          taskList()
        )
      ).resolves.toEqual({ ok: false, code: "missing_tasks_config" });
    });
  });

  it("fails when yaml-file tasks config is missing its path", async () => {
    await expect(
      validateDispatch(cfg({ tasks: { type: "yaml-file" } as ResolvedConfig["tasks"] }), taskList())
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
        taskList()
      )
    ).resolves.toEqual({ ok: false, code: "missing_tasks_config" });

    expect(verifyGhProject).not.toHaveBeenCalled();
  });

  it("does not accept inherited gh-issues project fields", async () => {
    await withObjectPrototypeProperties(
      {
        project: { owner: "octo", number: 7 }
      },
      async () => {
        await expect(
          validateDispatch(
            cfg({
              tasks: {
                type: "gh-issues",
                repo: "octo/repo"
              } as ResolvedConfig["tasks"]
            }),
            taskList()
          )
        ).resolves.toEqual({ ok: false, code: "missing_tasks_config" });

        expect(verifyGhProject).not.toHaveBeenCalled();
      }
    );
  });

  it("fails when the configured task list does not exist", async () => {
    expect(coveredPreflightCodes.list_not_found).toBe(true);

    await expect(validateDispatch(cfg(), taskList(["triage"]))).resolves.toEqual({
      ok: false,
      code: "list_not_found",
      list: "backlog"
    });
  });

  it("does not use an inherited agent list", async () => {
    const base = cfg();

    await withObjectPrototypeProperties({ list: "backlog" }, async () => {
      await expect(
        validateDispatch(
          cfg({
            agent: {
              service: base.agent.service,
              maxConcurrentAgents: base.agent.maxConcurrentAgents,
              maxRetryBackoffMs: base.agent.maxRetryBackoffMs
            }
          }),
          taskList()
        )
      ).resolves.toEqual({
        ok: false,
        code: "list_not_found",
        list: ""
      });
    });
  });

  it("fails when the task backend cannot be reached", async () => {
    expect(coveredPreflightCodes.tasks_unreachable).toBe(true);

    await expect(validateDispatch(cfg(), unreachableTaskList())).resolves.toEqual({
      ok: false,
      code: "tasks_unreachable"
    });
  });

  it("fails when no states are active", async () => {
    expect(coveredPreflightCodes.no_active_states).toBe(true);

    await expect(
      validateDispatch(
        cfg({
          states: {
            done: { terminal: true }
          },
          activeStateNames: [],
          terminalStateNames: ["done"],
          stateOrder: ["done"]
        }),
        taskList()
      )
    ).resolves.toEqual({
      ok: false,
      code: "no_active_states"
    });
  });

  it("rejects terminal-only state maps after config resolution", async () => {
    const resolved = resolveConfig(
      {
        tasks: { type: "markdown-dir", path: "./tasks" },
        states: {
          done: { terminal: true },
          archived: { terminal: true }
        },
        agent: { list: "backlog" }
      },
      "/repo"
    );

    await expect(validateDispatch(resolved, taskList())).resolves.toEqual({
      ok: false,
      code: "no_active_states"
    });
  });

  it("fails when no states are terminal", async () => {
    expect(coveredPreflightCodes.no_terminal_states).toBe(true);

    await expect(
      validateDispatch(
        cfg({
          states: {
            planned: { prompt: "Plan" }
          },
          activeStateNames: ["planned"],
          terminalStateNames: [],
          stateOrder: ["planned"]
        }),
        taskList()
      )
    ).resolves.toEqual({
      ok: false,
      code: "no_terminal_states"
    });
  });

  it("fails when the initial state is not declared", async () => {
    expect(coveredPreflightCodes.unknown_initial_state).toBe(true);

    await expect(
      validateDispatch(
        cfg({
          stateOrder: ["missing", "planned", "done"]
        }),
        taskList()
      )
    ).resolves.toEqual({
      ok: false,
      code: "unknown_initial_state",
      state: "missing"
    });
  });

  it("does not treat inherited prototype names as declared initial states", async () => {
    await expect(
      validateDispatch(
        cfg({
          activeStateNames: ["constructor"],
          stateOrder: ["constructor", "done"]
        }),
        taskList()
      )
    ).resolves.toEqual({
      ok: false,
      code: "unknown_initial_state",
      state: "constructor"
    });
  });

  it("requires agent.list for gh-issues tasks", async () => {
    const base = cfg();

    await expect(
      validateDispatch(
        cfg({
          tasks: {
            type: "gh-issues",
            repo: "octo/repo",
            project: { owner: "octo", number: 7 }
          },
          agent: {
            ...base.agent,
            list: undefined
          }
        }),
        taskList()
      )
    ).resolves.toEqual({
      ok: false,
      code: "list_not_found",
      list: ""
    });
  });

  it("fails when a gh-issues project board is not provisioned", async () => {
    expect(coveredPreflightCodes.board_not_provisioned).toBe(true);

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
        taskList()
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

  it("accepts label-backed gh-issues tasks without requiring a project board", async () => {
    await expect(
      validateDispatch(
        cfg({
          tasks: {
            type: "gh-issues",
            repo: "octo/repo",
            state: { labelPrefix: "status:" }
          }
        }),
        taskList()
      )
    ).resolves.toEqual({ ok: true });

    expect(verifyGhProject).not.toHaveBeenCalled();
  });

  it("returns ok when config, list, and board are valid", async () => {
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
        taskList()
      )
    ).resolves.toEqual({ ok: true });
  });

  it("returns ok when a loaded workflow is well-formed and the backend responds", async () => {
    const { loadWorkflow } = await import("./load.js");
    vol.fromJSON({
      "/repo/WORKFLOW.md": [
        "---",
        "tasks:",
        "  type: markdown-dir",
        "  path: ./tasks",
        "states:",
        "  planned:",
        "    prompt: Plan",
        "  done:",
        "    terminal: true",
        "agent:",
        "  list: backlog",
        "---",
        "",
        "Body"
      ].join("\n")
    });

    const workflow = await loadWorkflow("/repo/WORKFLOW.md");
    const resolved = resolveConfig(workflow.config, "/repo");

    await expect(validateDispatch(resolved, taskList())).resolves.toEqual({ ok: true });
  });
});

function unreachableTaskList() {
  return createMockTaskList({
    lists: ["backlog"],
    failures: { transient: { lists: new Error("offline") } }
  });
}

describe("workflow state validation", () => {
  it("fails when a state has both prompt and terminal true", () => {
    expect(() =>
      resolveConfig(
        {
          states: {
            planned: { prompt: "Plan", terminal: true }
          }
        },
        "/repo"
      )
    ).toThrow("exactly one");
  });

  it("treats a state with neither prompt nor terminal true as inactive", () => {
    const cfg = resolveConfig(
      {
        states: {
          planned: { terminal: false },
          running: { prompt: "Run" },
          done: { terminal: true }
        }
      },
      "/repo"
    );

    expect(cfg.states.planned).toEqual({ terminal: false });
    expect(cfg.activeStateNames).toEqual(["running"]);
    expect(cfg.terminalStateNames).toEqual(["done"]);
  });

  it("fails when states is empty", () => {
    expect(() => resolveConfig({ states: {} }, "/repo")).toThrow("at least one state");
  });

  it("fails when a state mode is not supported", () => {
    expect(() =>
      resolveConfig(
        {
          states: {
            planned: { prompt: "Plan", mode: "inspect" }
          }
        },
        "/repo"
      )
    ).toThrow('mode must be "yolo", "auto", "edit", or "read"');
  });

  it("fails when states is missing", () => {
    expect(() => resolveConfig({}, "/repo")).toThrow("requires a states map");
  });
});
