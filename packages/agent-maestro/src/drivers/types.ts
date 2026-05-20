import type { Task } from "@poe-code/task-list";

import type { ResolvedConfig } from "../config/schema.js";
import type {
  AttemptEvent,
  AttemptOutcome,
  AttemptReconcileResult
} from "../agent/runner.js";

export interface WorkflowDriverContext {
  task: Task;
  attempt: number | null;
  workspaceDir: string;
  planPath: string | null;
  cfg: ResolvedConfig;
  abort: AbortSignal;
  emit: (event: AttemptEvent) => void;
  spawn: typeof import("@poe-code/agent-spawn").spawn;
  taskPromptTemplate?: string;
  refreshTask?: (qualifiedId: string) => Promise<Task>;
  reconcile?: (ctx: {
    task: Task;
    attempt: number | null;
    cfg: ResolvedConfig;
  }) => Promise<AttemptReconcileResult>;
  logger: { warn(msg: string, meta?: Record<string, unknown>): void };
}

export interface WorkflowDriver {
  readonly kind: string;
  run(ctx: WorkflowDriverContext): Promise<AttemptOutcome>;
}
