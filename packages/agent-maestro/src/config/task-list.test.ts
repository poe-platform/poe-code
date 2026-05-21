import { describe, expect, it } from "vitest";
import { resolveConfiguredTaskListOptions } from "./task-list.js";

describe("resolveConfiguredTaskListOptions", () => {
  it("derives file backend state events only from non-terminal states", () => {
    const options = resolveConfiguredTaskListOptions({
      tasks: {
        type: "markdown-dir",
        path: "/repo/tasks"
      },
      stateOrder: ["in-progress", "planned", "done", "archived"],
      terminalStateNames: ["done", "archived"]
    });

    expect(options).toMatchObject({
      type: "markdown-dir",
      path: "/repo/tasks",
      stateMachine: {
        initial: "in-progress",
        states: ["in-progress", "planned", "done", "archived"],
        events: {
          "in-progress": { from: ["planned"], to: "in-progress" },
          planned: { from: ["in-progress"], to: "planned" },
          done: { from: ["in-progress", "planned"], to: "done" },
          archived: { from: ["in-progress", "planned"], to: "archived" }
        }
      }
    });
  });

  it("leaves non-file task backends unchanged", () => {
    const tasks = {
      type: "gh-issues",
      repo: "owner/repo",
      project: { owner: "owner", number: 1 }
    } as const;

    expect(
      resolveConfiguredTaskListOptions({
        tasks,
        stateOrder: ["planned", "done"],
        terminalStateNames: ["done"]
      })
    ).toBe(tasks);
  });
});
