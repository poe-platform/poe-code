import type { ResolvedStepsConfig } from "@poe-code/pipeline";
import type { Task } from "@poe-code/task-list";

import type { ResolvedConfig } from "../config/schema.js";
import type { AttemptEvent, AttemptOutcome } from "../agent/runner.js";

export interface WorkflowDriverContext {
  task: Task;
  attempt: number | null;
  workspaceDir: string;
  planPath: string | null;
  cfg: ResolvedConfig;
  steps: ResolvedStepsConfig;
  abort: AbortSignal;
  emit: (event: AttemptEvent) => void;
  spawn: typeof import("@poe-code/agent-spawn").spawn;
  logger: { warn(msg: string, meta?: Record<string, unknown>): void };
}

export interface WorkflowDriver {
  readonly kind: string;
  run(ctx: WorkflowDriverContext): Promise<AttemptOutcome>;
}
