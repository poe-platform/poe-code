import os from "node:os";
import path from "node:path";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "./schema.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    default: fs.promises
  };
});

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

describe("resolveConfig", () => {
  it("rejects an unresolved environment variable used as workspace root", () => {
    delete process.env.MAESTRO_MISSING_WORKSPACE;

    expect(() =>
      resolveConfig(
        {
          states: { planned: { prompt: "Plan" } },
          workspace: { root: "$MAESTRO_MISSING_WORKSPACE" }
        },
        "/repo"
      )
    ).toThrow("workspace.root must not resolve to an empty path");
  });

  it("preserves __proto__ as an own configured state", () => {
    const states = Object.create(null) as Record<string, unknown>;
    states.__proto__ = { prompt: "Plan safely" };

    const config = resolveConfig({ states }, "/repo");

    expect(Object.hasOwn(config.states, "__proto__")).toBe(true);
    expect(config.states.__proto__).toEqual({ prompt: "Plan safely" });
    expect(config.activeStateNames).toContain("__proto__");
  });

  it("does not accept inherited top-level workflow fields", async () => {
    await withObjectPrototypeProperties(
      {
        states: {
          planned: { prompt: "Polluted plan" },
          done: { terminal: true }
        },
        tasks: { type: "markdown-dir", path: "./polluted-tasks" }
      },
      () => {
        expect(() => resolveConfig({}, "/repo")).toThrow("requires a states map");
      }
    );
  });

  it("does not resolve inherited task fields", async () => {
    await withObjectPrototypeProperties({ path: "./polluted-tasks" }, () => {
      const cfg = resolveConfig(
        {
          tasks: { type: "markdown-dir" },
          states: {
            planned: { prompt: "Plan" },
            done: { terminal: true }
          }
        },
        "/repo"
      );

      expect(cfg.tasks).toEqual({ type: "markdown-dir" });
      expect(Object.hasOwn(cfg.tasks ?? {}, "path")).toBe(false);
    });
  });

  it("does not validate inherited state definition fields", async () => {
    await withObjectPrototypeProperties(
      {
        terminal: true,
        agent: "polluted-agent",
        model: "polluted-model",
        mode: "read"
      },
      () => {
        const cfg = resolveConfig(
          {
            states: {
              planned: { prompt: "Plan" },
              done: { terminal: true }
            }
          },
          "/repo"
        );

        expect(cfg.states.planned).toEqual({ prompt: "Plan" });
        expect(Object.hasOwn(cfg.states.planned ?? {}, "agent")).toBe(false);
        expect(Object.hasOwn(cfg.states.planned ?? {}, "model")).toBe(false);
        expect(Object.hasOwn(cfg.states.planned ?? {}, "mode")).toBe(false);
      }
    );
  });

  it("accepts auto as an explicit state mode", () => {
    const cfg = resolveConfig(
      {
        states: {
          planned: { prompt: "Plan", mode: "auto" },
          done: { terminal: true }
        }
      },
      "/repo"
    );

    expect(cfg.states.planned).toEqual({ prompt: "Plan", mode: "auto" });
  });

  const originalEnv = { ...process.env };

  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("applies maestro config defaults", () => {
    const cfg = resolveConfig(
      {
        tasks: { type: "markdown-dir", path: "./tasks" },
        states: {
          planned: { prompt: "Plan" },
          done: { terminal: true }
        },
        agent: { list: "backlog" }
      },
      "/repo"
    );

    expect(cfg).toEqual({
      tasks: { type: "markdown-dir", path: path.resolve("/repo", "tasks") },
      states: {
        planned: { prompt: "Plan" },
        done: { terminal: true }
      },
      activeStateNames: ["planned"],
      terminalStateNames: ["done"],
      stateOrder: ["planned", "done"],
      polling: { intervalMs: 30_000 },
      workspace: { root: path.join(os.tmpdir(), "poe-code-maestro") },
      agent: {
        service: "codex",
        list: "backlog",
        maxConcurrentAgents: 1,
        maxRetryBackoffMs: 300_000
      }
    });
  });

  it("applies all defaults when optional fields are missing", () => {
    const cfg = resolveConfig(
      {
        tasks: { type: "markdown-dir", path: "./tasks" },
        states: {
          planned: { prompt: "Plan" },
          done: { terminal: true }
        }
      },
      "/repo/workflows"
    );

    expect(cfg.polling).toEqual({ intervalMs: 30_000 });
    expect(cfg.workspace).toEqual({ root: path.join(os.tmpdir(), "poe-code-maestro") });
    expect(cfg.agent).toEqual({
      service: "codex",
      list: undefined,
      maxConcurrentAgents: 1,
      maxRetryBackoffMs: 300_000
    });
  });

  it("rejects unsupported agent turn limits instead of silently ignoring them", () => {
    expect(() =>
      resolveConfig(
        {
          states: {
            planned: { prompt: "Plan" },
            done: { terminal: true }
          },
          agent: { max_turns: 1 }
        },
        "/repo"
      )
    ).toThrow("agent.max_turns is not supported");
  });

  it.each([
    ["polling.interval_ms", { polling: { interval_ms: -1 } }, "positive integer"],
    ["agent.max_retry_backoff_ms", { agent: { max_retry_backoff_ms: -1 } }, "non-negative integer"],
    ["agent.max_concurrent_agents", { agent: { max_concurrent_agents: 0 } }, "positive integer"]
  ])("rejects invalid %s", (_field, override, message) => {
    expect(() =>
      resolveConfig(
        {
          states: {
            planned: { prompt: "Plan" },
            done: { terminal: true }
          },
          ...override
        },
        "/repo"
      )
    ).toThrow(message);
  });

  it.each([
    ["polling.interval_ms", { polling: { interval_ms: "1" } }],
    ["workspace.root", { workspace: { root: 123 } }],
    ["agent.service", { agent: { service: 99 } }],
    ["agent.list", { agent: { list: false } }],
    ["agent.max_concurrent_agents", { agent: { max_concurrent_agents: "2" } }],
    ["agent.max_retry_backoff_ms", { agent: { max_retry_backoff_ms: "3" } }]
  ])("rejects wrong-type %s values instead of using defaults", (field, override) => {
    expect(() =>
      resolveConfig(
        {
          tasks: { type: "markdown-dir", path: "./tasks" },
          states: {
            planned: { prompt: "Plan" },
            done: { terminal: true }
          },
          ...override
        },
        "/repo"
      )
    ).toThrow(field);
  });

  it("rejects blank state prompts", () => {
    expect(() =>
      resolveConfig(
        {
          tasks: { type: "markdown-dir", path: "./tasks" },
          states: {
            planned: { prompt: "   " },
            done: { terminal: true }
          }
        },
        "/repo"
      )
    ).toThrow('State "planned" prompt must not be empty.');
  });

  it.each(["", "   "])("rejects blank state names: %s", (stateName) => {
    expect(() =>
      resolveConfig(
        {
          tasks: { type: "markdown-dir", path: "./tasks" },
          states: {
            [stateName]: { prompt: "Plan" },
            done: { terminal: true }
          }
        },
        "/repo"
      )
    ).toThrow("State names must not be empty.");
  });

  it("resolves $VAR values and expands ~ paths", () => {
    process.env.MAESTRO_TASKS = "/repo/tasks";
    process.env.MAESTRO_WORKSPACE = "~/maestro";

    const cfg = resolveConfig(
      {
        tasks: { type: "markdown-dir", path: "$MAESTRO_TASKS" },
        states: {
          planned: { prompt: "Plan" },
          done: { terminal: true }
        },
        workspace: { root: "$MAESTRO_WORKSPACE" },
        agent: { list: "backlog" }
      },
      "/repo"
    );

    expect(cfg.tasks).toMatchObject({ path: "/repo/tasks" });
    expect(cfg.workspace.root).toBe(path.join(os.homedir(), "maestro"));
  });

  it("resolves relative workspace roots against the workflow directory", () => {
    const cfg = resolveConfig(
      {
        tasks: { type: "markdown-dir", path: "./tasks" },
        states: {
          planned: { prompt: "Plan" },
          done: { terminal: true }
        },
        workspace: { root: "./.poe-code/maestro" }
      },
      "/repo/workflows"
    );

    expect(cfg.workspace.root).toBe(path.resolve("/repo/workflows", ".poe-code/maestro"));
  });

  it("expands literal home workspace roots", () => {
    const cfg = resolveConfig(
      {
        tasks: { type: "markdown-dir", path: "./tasks" },
        states: {
          planned: { prompt: "Plan" },
          done: { terminal: true }
        },
        workspace: { root: "~/maestro" }
      },
      "/repo"
    );

    expect(cfg.workspace.root).toBe(path.join(os.homedir(), "maestro"));
  });

  it("keeps missing required fields for preflight validation", () => {
    const cfg = resolveConfig(
      {
        states: {
          planned: { prompt: "Plan" },
          done: { terminal: true }
        }
      },
      "/repo"
    );

    expect(cfg.tasks).toBeUndefined();
    expect(cfg.agent.list).toBeUndefined();
  });

  it("parses states from WORKFLOW.md frontmatter", async () => {
    const { loadWorkflow } = await import("./load.js");
    vol.fromJSON({
      "/repo/WORKFLOW.md": [
        "---",
        "tasks:",
        "  type: markdown-dir",
        "  path: ./tasks",
        "states:",
        "  planned:",
        "    prompt: Plan it",
        "  done:",
        "    terminal: true",
        "---",
        "",
        "Implement {{ task.name }}."
      ].join("\n")
    });

    const workflow = await loadWorkflow("/repo/WORKFLOW.md");
    const cfg = resolveConfig(workflow.config, path.dirname(workflow.sourcePath));

    expect(cfg.states).toEqual({
      planned: { prompt: "Plan it" },
      done: { terminal: true }
    });
    expect(cfg.activeStateNames).toEqual(["planned"]);
    expect(cfg.terminalStateNames).toEqual(["done"]);
    expect(cfg.stateOrder).toEqual(["planned", "done"]);
  });

  it("preserves state declaration order from YAML", async () => {
    const { loadWorkflow } = await import("./load.js");
    vol.fromJSON({
      "/repo/WORKFLOW.md": [
        "---",
        "states:",
        "  queued:",
        "    prompt: Queue prompt",
        "  planning:",
        "    prompt: Planning prompt",
        "  reviewing:",
        "    prompt: Review prompt",
        "  done:",
        "    terminal: true",
        "---",
        "",
        "Body"
      ].join("\n")
    });

    const workflow = await loadWorkflow("/repo/WORKFLOW.md");
    const cfg = resolveConfig(workflow.config, "/repo");

    expect(cfg.stateOrder).toEqual(["queued", "planning", "reviewing", "done"]);
    expect(cfg.activeStateNames).toEqual(["queued", "planning", "reviewing"]);
    expect(cfg.terminalStateNames).toEqual(["done"]);
  });

  it("allows terminal-only state maps for dispatch validation to reject", () => {
    const cfg = resolveConfig(
      {
        states: {
          done: { terminal: true },
          archived: { terminal: true }
        }
      },
      "/repo"
    );

    expect(cfg.activeStateNames).toEqual([]);
    expect(cfg.terminalStateNames).toEqual(["done", "archived"]);
  });

  it("treats states without prompt as inactive", () => {
    const cfg = resolveConfig(
      {
        states: {
          planned: {},
          running: { prompt: "Run" },
          done: { terminal: true }
        }
      },
      "/repo"
    );

    expect(cfg.states.planned).toEqual({});
    expect(cfg.activeStateNames).toEqual(["running"]);
    expect(cfg.terminalStateNames).toEqual(["done"]);
  });

  it("leaves missing agent.list for gh-issues available to validation", () => {
    const cfg = resolveConfig(
      {
        tasks: {
          type: "gh-issues",
          repo: "octo/repo",
          project: { owner: "octo", number: 7 }
        },
        states: {
          planned: { prompt: "Plan" },
          done: { terminal: true }
        }
      },
      "/repo"
    );

    expect(cfg.agent.list).toBeUndefined();
  });

  it("rejects duplicate state names in workflow YAML", async () => {
    const { loadWorkflow } = await import("./load.js");
    vol.fromJSON({
      "/repo/WORKFLOW.md": [
        "---",
        "states:",
        "  planned:",
        "    prompt: Plan",
        "  planned:",
        "    prompt: Duplicate",
        "  done:",
        "    terminal: true",
        "---",
        "",
        "Body"
      ].join("\n")
    });

    await expect(loadWorkflow("/repo/WORKFLOW.md")).rejects.toMatchObject({
      code: "invalid_yaml"
    });
  });

  it("round-trips state agent and model overrides without filling missing values", () => {
    const cfg = resolveConfig(
      {
        states: {
          implementation: {
            prompt: "Implement",
            agent: "claude",
            model: "claude-sonnet-4-6"
          },
          review: { prompt: "Review" },
          handoff: {
            prompt: "Handoff",
            agent: undefined,
            model: undefined,
            mode: undefined
          },
          done: { terminal: true }
        }
      },
      "/repo"
    );

    expect(cfg.states.implementation).toMatchObject({
      agent: "claude",
      model: "claude-sonnet-4-6"
    });
    expect(cfg.states.review?.agent).toBeUndefined();
    expect(cfg.states.review?.model).toBeUndefined();
    expect(cfg.states.handoff?.agent).toBeUndefined();
    expect(cfg.states.handoff?.model).toBeUndefined();
    expect(cfg.states.handoff?.mode).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(cfg.states.handoff, "agent")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(cfg.states.handoff, "model")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(cfg.states.handoff, "mode")).toBe(true);
  });
});
