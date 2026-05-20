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

describe("resolveConfig", () => {
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
        maxTurns: 20,
        maxRetryBackoffMs: 300_000
      }
    });
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
