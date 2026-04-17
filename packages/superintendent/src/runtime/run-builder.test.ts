import type { SuperintendentDoc } from "../document/parse.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { autonomousMock } = vi.hoisted(() => ({
  autonomousMock: vi.fn<
    (
      agent: string,
      options: { mode?: string; prompt: string; cwd?: string }
    ) => Promise<unknown>
  >()
}));

vi.mock("@poe-code/agent-spawn", () => ({
  spawn: Object.assign(vi.fn(), {
    autonomous: autonomousMock
  })
}));

const document: SuperintendentDoc = {
  filePath: "/repo/docs/plans/feature.md",
  body: "# Feature plan\n\n## Task Board\n\n- [ ] Ship the builder\n",
  frontmatter: {
    kind: "superintendent",
    version: 1,
    builder: {
      agent: "claude-code",
      mode: "yolo",
      prompt: "Work on {{plan.path}} after {{superintendent.summary}}"
    },
    superintendent: {
      agent: "claude-code",
      prompt: "Review {{builder.summary}}"
    },
    owner: {
      agent: "claude-code",
      prompt: "Approve {{superintendent.summary}}"
    },
    status: {
      state: "in_progress",
      round: 0,
      review_turn: 0
    }
  }
};

describe("runBuilder", () => {
  beforeEach(() => {
    autonomousMock.mockReset();
  });

  it("resolves the builder prompt before invoking spawn.autonomous", async () => {
    autonomousMock.mockImplementation(async (agent, { mode, prompt, cwd }) => {
      expect(agent).toBe("claude-code");
      expect(mode).toBe("yolo");
      expect(cwd).toBe("/repo/docs/plans");
      expect(prompt).toBe("Work on /repo/docs/plans/feature.md after Previous round complete");
      expect(prompt).not.toContain("{{plan.path}}");
      expect(prompt).not.toContain("{{superintendent.summary}}");
      return "Implemented the next task\nUpdated tests and docs";
    });

    const { runBuilder } = await import("./run-builder.js");

    await runBuilder(document, {
      superintendent: {
        summary: "Previous round complete"
      }
    });

    expect(autonomousMock).toHaveBeenCalledTimes(1);
  });

  it("returns a BuilderResult with summary, log, and empty log_path when not provided", async () => {
    autonomousMock.mockResolvedValue("Implemented the next task\nUpdated tests and docs");

    const { runBuilder } = await import("./run-builder.js");

    await expect(runBuilder(document, {})).resolves.toEqual({
      summary: "Implemented the next task",
      log: "Implemented the next task\nUpdated tests and docs",
      log_path: ""
    });
  });

  it("uses explicit summary, log, and logFile fields from structured autonomous output", async () => {
    autonomousMock.mockResolvedValue({
      summary: "Builder finished cleanly",
      log: "Applied the requested changes",
      logFile: "/tmp/spawn-logs/20260415-120000-000-claude-code.jsonl"
    });

    const { runBuilder } = await import("./run-builder.js");

    await expect(runBuilder(document, {})).resolves.toEqual({
      summary: "Builder finished cleanly",
      log: "Applied the requested changes",
      log_path: "/tmp/spawn-logs/20260415-120000-000-claude-code.jsonl"
    });
  });

  it("propagates spawn failures", async () => {
    autonomousMock.mockRejectedValue(new Error("builder failed"));

    const { runBuilder } = await import("./run-builder.js");

    await expect(runBuilder(document, {})).rejects.toThrow("builder failed");
  });

  it("uses an absolute cwd from the builder config unchanged", async () => {
    autonomousMock.mockImplementation(async (_, { cwd }) => {
      expect(cwd).toBe("/other/workspace");
      return "ok";
    });

    const { runBuilder } = await import("./run-builder.js");

    await runBuilder(
      {
        ...document,
        frontmatter: {
          ...document.frontmatter,
          builder: { ...document.frontmatter.builder, cwd: "/other/workspace" }
        }
      },
      {}
    );
  });

  it("resolves a relative builder cwd against the document directory", async () => {
    autonomousMock.mockImplementation(async (_, { cwd }) => {
      expect(cwd).toBe("/repo/packages/agent-kit");
      return "ok";
    });

    const { runBuilder } = await import("./run-builder.js");

    await runBuilder(
      {
        ...document,
        frontmatter: {
          ...document.frontmatter,
          builder: { ...document.frontmatter.builder, cwd: "../../packages/agent-kit" }
        }
      },
      {}
    );
  });

  it("uses the prompt override verbatim when provided, skipping template resolution", async () => {
    autonomousMock.mockImplementation(async (_, { prompt }) => {
      expect(prompt).toBe("Fix the failing test in foo.test.ts");
      return "Done";
    });

    const { runBuilder } = await import("./run-builder.js");

    await runBuilder(document, {}, { promptOverride: "Fix the failing test in foo.test.ts" });

    expect(autonomousMock).toHaveBeenCalledTimes(1);
  });
});
