import { spawn as defaultSpawn } from "@poe-code/agent-spawn";
import type { Task } from "@poe-code/task-list";

import type { ResolvedConfig } from "../config/schema.js";
import { resolveWorkflowKind } from "../drivers/kind.js";
import { getDriver } from "../drivers/registry.js";
import type { WorkflowDriverContext } from "../drivers/types.js";
import type { AttemptPhase, FailureCategory } from "../runtime/phases.js";

export interface AttemptOutcome {
  reason: "normal" | "abnormal" | "skip";
  skipReason?: "terminal_state" | "unconfigured_state";
  failure?: FailureCategory;
  failedStep?: string;
  error?: string;
}

export type AttemptReconcileResult = "continue" | "canceled";

export type AttemptEvent =
  | {
      type: "attempt_phase";
      task_id: string;
      from: AttemptPhase | null;
      to: AttemptPhase;
      step?: string;
      failure?: FailureCategory;
    }
  | {
      type: "agent_event";
      task_id: string;
      step: string;
      session_id: string;
      event: string;
      payload?: unknown;
    }
  | {
      type: "unconfigured_state";
      task_id: string;
      state: string;
    };

export interface AttemptDeps {
  spawn?: typeof defaultSpawn;
  taskPromptTemplate?: string;
  refreshTask?: (qualifiedId: string) => Promise<Task>;
  reconcile?: (ctx: {
    task: Task;
    attempt: number | null;
    cfg: ResolvedConfig;
  }) => Promise<AttemptReconcileResult>;
  onEvent?: (event: AttemptEvent) => void;
  logger?: {
    warn(message: string, meta?: Record<string, unknown>): void;
  };
}

export async function runAttempt(args: {
  task: Task;
  attempt: number | null;
  cfg: ResolvedConfig;
  workspaceDir?: string;
  planPath?: string | null;
  deps: AttemptDeps;
  abort: AbortSignal;
}): Promise<AttemptOutcome> {
  const runner = new AttemptRunner(args);
  return runner.run();
}

type RunnerArgs = Parameters<typeof runAttempt>[0];

class AttemptRunner {
  constructor(private readonly args: RunnerArgs) {}

  async run(): Promise<AttemptOutcome> {
    const planKind = resolveWorkflowKind(this.args.task);
    const driver = getDriver(planKind);

    if (driver === undefined) {
      throw new Error(`no driver registered for kind ${planKind}`);
    }

    return driver.run(this.createDriverContext());
  }

  private createDriverContext(): WorkflowDriverContext {
    return {
      task: this.args.task,
      attempt: this.args.attempt,
      workspaceDir: this.args.workspaceDir ?? "",
      planPath: this.args.task.sourcePath ?? null,
      cfg: this.args.cfg,
      abort: this.args.abort,
      emit: (event) => this.args.deps.onEvent?.(event),
      spawn: this.args.deps.spawn ?? defaultSpawn,
      taskPromptTemplate: this.args.deps.taskPromptTemplate,
      refreshTask: this.args.deps.refreshTask,
      reconcile: this.args.deps.reconcile,
      logger: this.args.deps.logger ?? noopLogger
    };
  }
}

const noopLogger = {
  warn() {}
} satisfies NonNullable<AttemptDeps["logger"]>;
