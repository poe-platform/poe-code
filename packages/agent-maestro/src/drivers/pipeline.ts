import { isActivityTimeoutError, type SpawnMode } from "@poe-code/agent-spawn";
import type { Task } from "@poe-code/task-list";

import type { StateDefinition } from "../config/schema.js";
import { renderPromptTemplate, renderTaskPrompt } from "../prompt/render.js";
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

    let task: Task;

    try {
      task = await this.refreshTask();
    } catch (error) {
      return this.fail(this.failure("step_failed", this.task.state, error));
    }

    const stateName = task.state;
    const state = hasOwnState(this.ctx.cfg.states, stateName)
      ? this.ctx.cfg.states[stateName]
      : undefined;
    if (state === undefined) {
      this.warnUnconfiguredState(task, stateName);
      this.ctx.emit({
        type: "unconfigured_state",
        task_id: task.qualifiedId,
        state: stateName
      });
      return { reason: "skip", skipReason: "unconfigured_state" };
    }

    if (state.terminal === true) {
      return { reason: "skip", skipReason: "terminal_state" };
    }

    const outcome = await this.runStatePrompt(stateName, state, task);
    if (outcome) {
      if (outcome.reason === "skip" || outcome.failure === "canceled") {
        return outcome;
      }

      return this.fail(outcome);
    }

    this.transition("succeeded", {});
    return { reason: "normal" };
  }

  private async runStatePrompt(
    stateName: string,
    state: StateDefinition,
    task: Task
  ): Promise<AttemptOutcome | undefined> {
    if (state.prompt === undefined) {
      this.warnUnconfiguredState(task, stateName);
      this.ctx.emit({
        type: "unconfigured_state",
        task_id: task.qualifiedId,
        state: stateName
      });
      return { reason: "skip", skipReason: "unconfigured_state" };
    }

    let prompt: string;

    try {
      const taskPrompt = renderTaskPrompt(this.ctx.taskPromptTemplate ?? "", {
        task,
        attempt: this.ctx.attempt
      });
      prompt = renderPromptTemplate(state.prompt, {
        prompt: taskPrompt,
        task,
        attempt: this.ctx.attempt
      });
    } catch (error) {
      return this.failure("prompt_render_error", stateName, error);
    }

    this.transition("running-step", { step: stateName });

    try {
      const result = await this.ctx.spawn(state.agent ?? this.ctx.cfg.agent.service, {
        prompt,
        model: state.model,
        mode: (state.mode ?? "yolo") as SpawnMode,
        signal: this.ctx.abort
      });
      this.ctx.emit({
        type: "agent_event",
        task_id: this.task.qualifiedId,
        step: stateName,
        session_id: result.threadId ?? "",
        event: "exit",
        payload: { exitCode: result.exitCode }
      });

      if (result.exitCode !== 0) {
        return {
          reason: "abnormal",
          failure: "step_failed",
          failedStep: stateName,
          error: `exitCode=${result.exitCode}`
        };
      }
    } catch (error) {
      if (this.ctx.abort.aborted || isAbortError(error)) {
        return this.cancel();
      }

      if (isActivityTimeoutError(error)) {
        return this.failure("step_timeout", stateName, error);
      }

      if (isAgentStartupError(error)) {
        return this.failure("agent_startup_error", stateName, error);
      }

      return this.failure("agent_crashed", stateName, error);
    }

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

  private warnUnconfiguredState(task: Task, stateName: string): void {
    this.ctx.logger.warn("unconfigured state", {
      task_id: task.qualifiedId,
      state: stateName
    });
  }

  private cancel(): AttemptOutcome {
    this.transition("canceled", {});
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
  return phase === "running-step";
}

function hasOwnState(states: Record<string, unknown>, state: string): boolean {
  return Object.prototype.hasOwnProperty.call(states, state);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isAgentStartupError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AgentStartupError" ||
      (error as Error & { failure?: unknown }).failure === "agent_startup_error")
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
