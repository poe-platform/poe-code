import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createConfig,
  createDriverContext,
  createTask,
  successSpawn
} from "../__test_utils__/fixtures.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { AttemptEvent } from "../agent/runner.js";
import { ralphDriver } from "./ralph.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    default: fs.promises
  };
});

describe("ralphDriver", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("drives a 1-iteration plan to completion and persists ralph frontmatter updates", async () => {
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Implement the thing")
    });
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({
      ...ralphContextDefaults,
      events,
      spawn: vi.fn(async () => successSpawn())
    });

    const outcome = await ralphDriver.run(ctx);

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

  it("fails when planPath is null", async () => {
    const ctx = createDriverContext({ ...ralphContextDefaults, planPath: null });

    await expect(ralphDriver.run(ctx)).resolves.toEqual({
      reason: "abnormal",
      failure: "step_failed",
      failedStep: "ralph",
      error: "ralph driver requires a file-backed task"
    });
  });

  it("maps an abort mid-iteration to canceled", async () => {
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Stop cleanly")
    });
    const controller = new AbortController();
    const abortError = new Error("stop");
    abortError.name = "AbortError";
    const ctx = createDriverContext({
      ...ralphContextDefaults,
      abort: controller.signal,
      spawn: vi.fn(async () => {
        controller.abort();
        throw abortError;
      })
    });

    await expect(ralphDriver.run(ctx)).resolves.toEqual({
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
    const ctx = createDriverContext({
      ...ralphContextDefaults,
      spawn: vi.fn(async () => {
        throw timeoutError;
      })
    });

    await expect(ralphDriver.run(ctx)).resolves.toEqual({
      reason: "abnormal",
      failure: "step_timeout",
      failedStep: "ralph",
      error: "no activity for 1500ms"
    });
  });

  it("forwards ralph runAgent input to spawn unchanged", async () => {
    vol.fromJSON({
      "/repo/docs/plans/ralph-plan.md": planDoc("Forward this prompt", {
        agent: "codex",
        model: "openai/gpt-5.4"
      })
    });
    const controller = new AbortController();
    const spawn = vi.fn(async () => successSpawn());
    const ctx = createDriverContext({
      ...ralphContextDefaults,
      abort: controller.signal,
      spawn
    });

    await ralphDriver.run(ctx);

    expect(spawn).toHaveBeenCalledWith("codex", {
      cwd: "/repo/workspaces/task-1",
      prompt: "Forward this prompt",
      model: "openai/gpt-5.4",
      signal: controller.signal
    });
  });
});

function planDoc(body: string, options: { agent?: string; model?: string } = {}): string {
  const agent = options.model
    ? `${options.agent ?? "codex"}:${options.model}`
    : (options.agent ?? "codex");

  return ["---", `agent: ${agent}`, "iterations: 1", "---", body].join("\n");
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
