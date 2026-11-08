import type { AttemptOutcome } from "../agent/runner.js";
import type { FailureCategory } from "../runtime/phases.js";
import type { WorkflowDriver, WorkflowDriverContext } from "./types.js";

const FAILURE: FailureCategory = "step_failed";

export function createUnsupportedWorkflowDriver(kind: string): WorkflowDriver {
  return {
    kind,
    async run(ctx) {
      return runUnsupportedDriver(kind, ctx);
    }
  };
}

function runUnsupportedDriver(kind: string, ctx: WorkflowDriverContext): AttemptOutcome {
  const error =
    `${kind} workflow driver is not implemented. ` +
    `Register a compatible "${kind}" driver before dispatching ${kind} tasks.`;

  ctx.emit({
    type: "attempt_phase",
    task_id: ctx.task.qualifiedId,
    from: null,
    to: "preparing-workspace"
  });
  ctx.emit({
    type: "attempt_phase",
    task_id: ctx.task.qualifiedId,
    from: "preparing-workspace",
    to: "failed",
    failure: FAILURE
  });
  ctx.logger.warn("unsupported workflow driver", {
    task_id: ctx.task.qualifiedId,
    kind
  });

  return {
    reason: "abnormal",
    failure: FAILURE,
    failedStep: kind,
    error
  };
}
