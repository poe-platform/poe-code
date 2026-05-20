import { isActivityTimeoutError, type SpawnMode } from "@poe-code/agent-spawn";
import type { StepDefinition } from "@poe-code/pipeline";
import type { Task } from "@poe-code/task-list";

import { renderStepPrompt, renderTaskPrompt } from "../prompt/render.js";
import {
  transitionPhase,
  type AttemptPhase,
  type AttemptState,
  type FailureCategory
} from "../runtime/phases.js";
import type { AttemptOutcome } from "../agent/runner.js";
import type { WorkflowDriver, WorkflowDriverContext } from "./types.js";

export const pipelineDriver: WorkflowDriver = {
  kind: "pipeline",
  async run(ctx) {
    const run = new PipelineDriverRun(ctx);
    return run.run();
  }
};

class PipelineDriverRun {
  private state: AttemptState = { phase: "preparing-workspace" };
  private task: Task;

  constructor(private readonly ctx: WorkflowDriverContext) {
    this.task = ctx.task;
  }

  async run(): Promise<AttemptOutcome> {
    this.emitInitialPhase();

    if (this.ctx.abort.aborted) {
      return this.cancel();
    }

    const hasSetup = this.ctx.steps.setup !== undefined;
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

    for (const [name, step] of Object.entries(this.ctx.steps.steps)) {
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
    const step = this.ctx.steps.setup;
    if (!step) {
      return undefined;
    }

    this.transition("running-setup", { step: "setup" });
    return this.runStep("setup", step);
  }

  private async runNamedStep(
    name: string,
    step: StepDefinition
  ): Promise<AttemptOutcome | undefined> {
    this.transition("running-step", { step: name });
    return this.runStep(name, step);
  }

  private async runTeardownBestEffort(): Promise<void> {
    const step = this.ctx.steps.teardown;
    if (!step || this.state.phase === "canceled") {
      return;
    }

    this.transition("running-teardown", { step: "teardown" });
    const outcome = await this.runStep("teardown", step);
    if (outcome) {
      this.ctx.logger.warn("teardown failed", {
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
      const task = await this.refreshTask();
      const taskPrompt = renderTaskPrompt(this.ctx.taskPromptTemplate ?? "", {
        task,
        attempt: this.ctx.attempt
      });
      prompt = renderStepPrompt(step, {
        prompt: taskPrompt,
        task,
        attempt: this.ctx.attempt
      });
    } catch (error) {
      return this.failure("prompt_render_error", name, error);
    }

    try {
      const result = await this.ctx.spawn(step.agent ?? this.ctx.cfg.agent.service, {
        prompt,
        model: step.model,
        mode: step.mode as SpawnMode,
        signal: this.ctx.abort
      });
      this.ctx.emit({
        type: "agent_event",
        task_id: this.task.qualifiedId,
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
      if (this.ctx.abort.aborted || isAbortError(error)) {
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
    if (this.ctx.abort.aborted) {
      return this.cancel();
    }

    const result = await this.ctx.reconcile?.({
      task: this.task,
      attempt: this.ctx.attempt,
      cfg: this.ctx.cfg
    });

    if (result === "canceled" || this.ctx.abort.aborted) {
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
    this.ctx.emit({
      type: "attempt_phase",
      task_id: this.task.qualifiedId,
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
    this.ctx.emit({
      type: "attempt_phase",
      task_id: this.task.qualifiedId,
      from: previous.phase,
      to: this.state.phase,
      step: isRunningPhase(this.state.phase) ? this.state.step : undefined,
      failure: this.state.failure
    });
  }

  private async refreshTask(): Promise<Task> {
    if (this.ctx.refreshTask === undefined) {
      return this.task;
    }

    this.task = await this.ctx.refreshTask(this.task.qualifiedId);
    return this.task;
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
