import { describe, expect, it } from "bun:test";
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
});
