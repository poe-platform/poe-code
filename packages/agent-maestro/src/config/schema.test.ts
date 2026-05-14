import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "./schema.js";

describe("resolveConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("applies maestro config defaults", () => {
    const cfg = resolveConfig(
      {
        tasks: { type: "markdown-dir", path: "./tasks" },
        agent: { list: "backlog" }
      },
      "/repo"
    );

    expect(cfg).toEqual({
      tasks: { type: "markdown-dir", path: path.resolve("/repo", "tasks") },
      active_states: ["planned", "in-progress"],
      terminal_states: ["done", "archived"],
      polling: { intervalMs: 30_000 },
      workspace: { root: path.join(os.tmpdir(), "poe-code-maestro") },
      agent: {
        service: "codex",
        list: "backlog",
        maxConcurrentAgents: 1,
        maxTurns: 20,
        maxRetryBackoffMs: 300_000
      },
      stepOverrides: {}
    });
  });

  it("resolves $VAR values and expands ~ paths", () => {
    process.env.MAESTRO_TASKS = "/repo/tasks";
    process.env.MAESTRO_WORKSPACE = "~/maestro";

    const cfg = resolveConfig(
      {
        tasks: { type: "markdown-dir", path: "$MAESTRO_TASKS" },
        workspace: { root: "$MAESTRO_WORKSPACE" },
        agent: { list: "backlog" }
      },
      "/repo"
    );

    expect(cfg.tasks).toMatchObject({ path: "/repo/tasks" });
    expect(cfg.workspace.root).toBe(path.join(os.homedir(), "maestro"));
  });

  it("keeps missing required fields for preflight validation", () => {
    const cfg = resolveConfig({}, "/repo");

    expect(cfg.tasks).toBeUndefined();
    expect(cfg.agent.list).toBeUndefined();
  });

  it("picks up step_overrides", () => {
    const cfg = resolveConfig(
      {
        tasks: { type: "markdown-dir", path: "./tasks" },
        agent: { list: "backlog" },
        step_overrides: {
          test: { model: "claude-sonnet-4.6" }
        }
      },
      "/repo"
    );

    expect(cfg.stepOverrides).toEqual({
      test: { model: "claude-sonnet-4.6" }
    });
  });
});
