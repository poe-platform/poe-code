import { describe, expect, it, vi } from "vitest";

import { createDriverContext } from "../__test_utils__/fixtures.js";
import { experimentDriver } from "./experiment.js";
import { harnessDriver } from "./harness.js";
import { superintendentDriver } from "./superintendent.js";

describe("unsupported workflow drivers", () => {
  it.each([
    ["experiment", experimentDriver],
    ["harness", harnessDriver],
    ["superintendent", superintendentDriver]
  ])("returns a failed outcome for %s without throwing", async (kind, driver) => {
    const events: Parameters<ReturnType<typeof createDriverContext>["emit"]>[0][] = [];
    const warn = vi.fn();
    const ctx = createDriverContext({
      events,
      logger: { warn }
    });

    await expect(driver.run(ctx)).resolves.toEqual({
      reason: "abnormal",
      failure: "step_failed",
      failedStep: kind,
      error:
        `${kind} workflow driver is not implemented. ` +
        `Register a compatible "${kind}" driver before dispatching ${kind} tasks.`
    });
    expect(events).toEqual([
      {
        type: "attempt_phase",
        task_id: "tasks/task-1",
        from: null,
        to: "preparing-workspace"
      },
      {
        type: "attempt_phase",
        task_id: "tasks/task-1",
        from: "preparing-workspace",
        to: "failed",
        failure: "step_failed"
      }
    ]);
    expect(warn).toHaveBeenCalledWith("unsupported workflow driver", {
      task_id: "tasks/task-1",
      kind
    });
  });
});
