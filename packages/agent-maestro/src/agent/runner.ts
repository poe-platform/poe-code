import { spawn as defaultSpawn, isActivityTimeoutError, type SpawnMode } from "@poe-code/agent-spawn";
import type { ResolvedStepsConfig, StepDefinition } from "@poe-code/pipeline";
import type { Task } from "@poe-code/task-list";

import type { ResolvedConfig } from "../config/schema.js";
import { renderStepPrompt, renderTaskPrompt } from "../prompt/render.js";
import {
  transitionPhase,
  type AttemptPhase,
  type AttemptState,
  type FailureCategory
} from "../runtime/phases.js";

export interface AttemptOutcome {
  reason: "normal" | "abnormal";
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
    };

export interface AttemptDeps {
  spawn?: typeof defaultSpawn;
  taskPromptTemplate?: string;
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
  steps: ResolvedStepsConfig;
  deps: AttemptDeps;
  abort: AbortSignal;
}): Promise<AttemptOutcome> {
  const runner = new AttemptRunner(args);
  return runner.run();
}

type RunnerArgs = Parameters<typeof runAttempt>[0];

class AttemptRunner {
  private state: AttemptState = { phase: "preparing-workspace" };

  constructor(private readonly args: RunnerArgs) {}

  async run(): Promise<AttemptOutcome> {
    this.emitInitialPhase();

    if (this.args.abort.aborted) {
      return this.cancel();
    }

    const hasSetup = this.args.steps.setup !== undefined;
    const setupFailure = await this.runSetup();
    if (setupFailure) {
      if (setupFailure.failure === "canceled") {
        return this.cancel();
      }

      await this.runTeardownBestEffort();
      return this.fail(setupFailure);
    }

    if (hasSetup) {
      const setupBoundary = await this.checkBoundary();
      if (setupBoundary) {
        return setupBoundary;
      }
    }

    for (const [name, step] of Object.entries(this.args.steps.steps)) {
      const stepFailure = await this.runNamedStep(name, step);
      if (stepFailure) {
        if (stepFailure.failure === "canceled") {
          return this.cancel();
        }

        await this.runTeardownBestEffort();
        return this.fail(stepFailure);
      }

      const boundary = await this.checkBoundary();
      if (boundary) {
        return boundary;
      }
    }

    await this.runTeardownBestEffort();
    this.transition("succeeded", {});
    return { reason: "normal" };
  }

  private async runSetup(): Promise<AttemptOutcome | undefined> {
    const step = this.args.steps.setup;
    if (!step) {
      return undefined;
    }

    this.transition("running-setup", { step: "setup" });
    return this.runStep("setup", step);
  }

  private async runNamedStep(name: string, step: StepDefinition): Promise<AttemptOutcome | undefined> {
    this.transition("running-step", { step: name });
    return this.runStep(name, step);
  }

  private async runTeardownBestEffort(): Promise<void> {
    const step = this.args.steps.teardown;
    if (!step || this.state.phase === "canceled") {
      return;
    }

    this.transition("running-teardown", { step: "teardown" });
    const outcome = await this.runStep("teardown", step);
    if (outcome) {
      this.args.deps.logger?.warn("teardown failed", {
        reason: outcome.reason,
        failure: outcome.failure,
        failedStep: outcome.failedStep,
        error: outcome.error
      });
    }
  }

  private async runStep(
    name: string,
    step: StepDefinition
  ): Promise<AttemptOutcome | undefined> {
    let prompt: string;

    try {
      const taskPrompt = renderTaskPrompt(this.args.deps.taskPromptTemplate ?? "", {
        task: this.args.task,
        attempt: this.args.attempt
      });
      prompt = renderStepPrompt(step, {
        prompt: taskPrompt,
        task: this.args.task,
        attempt: this.args.attempt
      });
    } catch (error) {
      return this.failure("prompt_render_error", name, error);
    }

    try {
      const spawn = this.args.deps.spawn ?? defaultSpawn;
      const result = await spawn(step.agent ?? this.args.cfg.agent.service, {
        prompt,
        model: step.model,
        mode: step.mode as SpawnMode,
        signal: this.args.abort
      });
      this.args.deps.onEvent?.({
        type: "agent_event",
        task_id: this.args.task.qualifiedId,
        step: name,
        session_id: result.threadId ?? "",
        event: "exit",
        payload: { exitCode: result.exitCode }
      });

      if (result.exitCode !== 0) {
        return {
          reason: "abnormal",
          failure: "step_failed",
          failedStep: name,
          error: `exitCode=${result.exitCode}`
        };
      }
    } catch (error) {
      if (this.args.abort.aborted || isAbortError(error)) {
        return { reason: "abnormal", failure: "canceled" };
      }

      if (isActivityTimeoutError(error)) {
        return this.failure("step_timeout", name, error);
      }

      return this.failure("agent_crashed", name, error);
    }

    return undefined;
  }

  private async checkBoundary(): Promise<AttemptOutcome | undefined> {
    if (this.args.abort.aborted) {
      return this.cancel();
    }

    const result = await this.args.deps.reconcile?.({
      task: this.args.task,
      attempt: this.args.attempt,
      cfg: this.args.cfg
    });

    if (result === "canceled" || this.args.abort.aborted) {
      return this.cancel();
    }

    return undefined;
  }

  private cancel(): AttemptOutcome {
    this.transition("canceled", { failure: "canceled" });
    return { reason: "abnormal", failure: "canceled" };
  }

  private fail(outcome: AttemptOutcome): AttemptOutcome {
    this.transition("failed", {
      failure: outcome.failure,
      failedStep: outcome.failedStep,
      error: outcome.error
    });
    return outcome;
  }

  private failure(
    failure: FailureCategory,
    failedStep: string,
    error: unknown
  ): AttemptOutcome {
    return {
      reason: "abnormal",
      failure,
      failedStep,
      error: errorMessage(error)
    };
  }

  private emitInitialPhase(): void {
    this.args.deps.onEvent?.({
      type: "attempt_phase",
      task_id: this.args.task.qualifiedId,
      from: null,
      to: "preparing-workspace"
    });
  }

  private transition(
    next: AttemptPhase,
    ctx: Partial<Omit<AttemptState, "phase">>
  ): void {
    const previous = this.state;
    this.state = transitionPhase(previous, next, ctx);
    this.args.deps.onEvent?.({
      type: "attempt_phase",
      task_id: this.args.task.qualifiedId,
      from: previous.phase,
      to: this.state.phase,
      step: isRunningPhase(this.state.phase) ? this.state.step : undefined,
      failure: this.state.failure
    });
  }
}

function isRunningPhase(phase: AttemptPhase): boolean {
  return phase === "running-setup" || phase === "running-step" || phase === "running-teardown";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
