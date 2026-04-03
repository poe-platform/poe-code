import { describe, expect, it } from "vitest";
import { parsePlan } from "./parser.js";

describe("parsePlan", () => {
  it("parses a stepless task plan", () => {
    const plan = parsePlan([
      "tasks:",
      "  - id: task-1",
      "    title: Fix timeout",
      "    prompt: Fix the timeout regression",
      "    status: open",
      ""
    ].join("\n"));

    expect(plan).toEqual({
      tasks: [
        {
          id: "task-1",
          title: "Fix timeout",
          prompt: "Fix the timeout regression",
          status: "open"
        }
      ]
    });
  });

  it("parses a stepped task plan and preserves step order", () => {
    const plan = parsePlan(
      [
        "tasks:",
        "  - id: task-1",
        "    title: Harden auth",
        "    prompt: Improve auth validation",
        "    status:",
        "      implement: done",
        "      test: open",
        "      commit: open",
        ""
      ].join("\n"),
      {
        availableSteps: {
          implement: { mode: "edit", instruction: "Implement" },
          test: { mode: "edit", instruction: "Test" },
          commit: { mode: "edit", instruction: "Commit" }
        }
      }
    );

    expect(plan.tasks[0]?.status).toEqual({
      implement: "done",
      test: "open",
      commit: "open"
    });
  });

  it("allows mixed scalar and stepped tasks", () => {
    const plan = parsePlan(
      [
        "tasks:",
        "  - id: one",
        "    title: One",
        "    prompt: First",
        "    status: done",
        "  - id: two",
        "    title: Two",
        "    prompt: Second",
        "    status:",
        "      implement: open",
        ""
      ].join("\n"),
      {
        availableSteps: {
          implement: { mode: "edit", instruction: "Implement" }
        }
      }
    );

    expect(plan.tasks).toHaveLength(2);
  });

  it("rejects duplicate task ids", () => {
    expect(() =>
      parsePlan([
        "tasks:",
        "  - id: dup",
        "    title: One",
        "    prompt: A",
        "    status: open",
        "  - id: dup",
        "    title: Two",
        "    prompt: B",
        "    status: done",
        ""
      ].join("\n"))
    ).toThrow(/duplicate task id/i);
  });

  it("rejects invalid scalar task statuses", () => {
    expect(() =>
      parsePlan([
        "tasks:",
        "  - id: task-1",
        "    title: Invalid",
        "    prompt: Invalid",
        "    status: maybe",
        ""
      ].join("\n"))
    ).toThrow(/invalid task status/i);
  });

  it("rejects unknown steps referenced by task status maps", () => {
    expect(() =>
      parsePlan(
        [
          "tasks:",
          "  - id: task-1",
          "    title: Harden auth",
          "    prompt: Improve auth validation",
          "    status:",
          "      unknown_step: open",
          ""
        ].join("\n"),
        {
          availableSteps: {
            implement: { mode: "edit", instruction: "Implement" }
          }
        }
      )
    ).toThrow(/unknown step "unknown_step"/i);
  });

  it("accepts an empty tasks array", () => {
    const plan = parsePlan("tasks: []\n");
    expect(plan.tasks).toEqual([]);
  });

  it("parses mcp block with command, args, and env", () => {
    const plan = parsePlan([
      "mcp:",
      "  my-server:",
      "    command: npx",
      "    args:",
      "      - my-server",
      "    env:",
      "      FOO: bar",
      "tasks: []",
      ""
    ].join("\n"));

    expect(plan.mcp).toEqual({
      "my-server": { command: "npx", args: ["my-server"], env: { FOO: "bar" } }
    });
  });

  it("parses mcp block with command only", () => {
    const plan = parsePlan([
      "mcp:",
      "  minimal:",
      "    command: my-tool",
      "tasks: []",
      ""
    ].join("\n"));

    expect(plan.mcp).toEqual({ minimal: { command: "my-tool" } });
  });

  it("omits mcp when not present", () => {
    const plan = parsePlan("tasks: []\n");
    expect(plan.mcp).toBeUndefined();
  });

  it("rejects mcp that is not an object", () => {
    expect(() =>
      parsePlan([
        "mcp: not-an-object",
        "tasks: []",
        ""
      ].join("\n"))
    ).toThrow(/mcp.*must be an object/i);
  });

  it("rejects mcp server entry missing command", () => {
    expect(() =>
      parsePlan([
        "mcp:",
        "  bad-server:",
        "    args: [foo]",
        "tasks: []",
        ""
      ].join("\n"))
    ).toThrow(/command.*non-empty string/i);
  });

  it("parses setup and teardown from plan", () => {
    const plan = parsePlan([
      "setup:",
      "  instruction: Prepare workspace",
      "teardown:",
      "  mode: read",
      "  instruction: Run final checks",
      "tasks:",
      "  - id: task-1",
      "    title: Fix",
      "    prompt: Fix it",
      "    status: open",
      ""
    ].join("\n"));

    expect(plan.setup).toEqual({ mode: "yolo", instruction: "Prepare workspace" });
    expect(plan.teardown).toEqual({ mode: "read", instruction: "Run final checks" });
  });

  it("omits setup and teardown when not present", () => {
    const plan = parsePlan("tasks: []\n");
    expect(plan.setup).toBeUndefined();
    expect(plan.teardown).toBeUndefined();
  });

  it("rejects setup missing instruction", () => {
    expect(() =>
      parsePlan([
        "setup:",
        "  mode: read",
        "tasks: []",
        ""
      ].join("\n"))
    ).toThrow(/setup.*missing an instruction/i);
  });

  it("maps setup: false to null (disabled)", () => {
    const plan = parsePlan([
      "setup: false",
      "tasks: []",
      ""
    ].join("\n"));

    expect(plan.setup).toBeNull();
  });

  it("maps teardown: false to null (disabled)", () => {
    const plan = parsePlan([
      "teardown: false",
      "tasks: []",
      ""
    ].join("\n"));

    expect(plan.teardown).toBeNull();
  });
});
