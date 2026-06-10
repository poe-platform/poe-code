import { describe, expect, it } from "vitest";
import { resolveConfiguredTaskListOptions } from "./task-list.js";

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

  it("does not use inherited task config", async () => {
    await withObjectPrototypeProperties(
      {
        tasks: {
          type: "markdown-dir",
          path: "/polluted/tasks"
        }
      },
      () => {
        expect(() =>
          resolveConfiguredTaskListOptions({
            stateOrder: ["planned", "done"],
            terminalStateNames: ["done"]
          })
        ).toThrow("missing tasks config");
      }
    );
  });

  it("does not treat inherited path as file backend configuration", async () => {
    const tasks = {
      type: "markdown-dir"
    } as const;

    await withObjectPrototypeProperties({ path: "/polluted/tasks" }, () => {
      expect(
        resolveConfiguredTaskListOptions({
          tasks,
          stateOrder: ["planned", "done"],
          terminalStateNames: ["done"]
        })
      ).toBe(tasks);
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

  it("does not treat inherited gh-issues project as configured", async () => {
    await withObjectPrototypeProperties(
      {
        project: { owner: "owner", number: 1 }
      },
      () => {
        const options = resolveConfiguredTaskListOptions({
          tasks: {
            type: "gh-issues",
            repo: "owner/repo"
          },
          stateOrder: ["draft", "released"],
          terminalStateNames: ["released"]
        });

        expect(options).toMatchObject({
          type: "gh-issues",
          repo: "owner/repo",
          stateMachine: {
            initial: "draft",
            states: ["draft", "released"]
          }
        });
      }
    );
  });

  it("derives workflow states for label-backed GitHub issues without a project", () => {
    const options = resolveConfiguredTaskListOptions({
      tasks: {
        type: "gh-issues",
        repo: "owner/repo",
        state: { labelPrefix: "status:" }
      },
      stateOrder: ["draft", "fix", "released"],
      terminalStateNames: ["released"]
    });

    expect(options).toMatchObject({
      type: "gh-issues",
      repo: "owner/repo",
      state: { labelPrefix: "status:" },
      stateMachine: {
        initial: "draft",
        states: ["draft", "fix", "released"]
      }
    });
  });
});
