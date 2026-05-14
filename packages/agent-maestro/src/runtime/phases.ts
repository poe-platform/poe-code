export type AttemptPhase =
  | "preparing-workspace"
  | "running-setup"
  | "running-step"
  | "running-teardown"
  | "succeeded"
  | "failed"
  | "canceled";

export type FailureCategory =
  | "workspace_error"
  | "prompt_render_error"
  | "agent_startup_error"
  | "step_failed"
  | "step_timeout"
  | "agent_crashed"
  | "canceled";

export interface AttemptState {
  phase: AttemptPhase;
  step?: string;
  failure?: FailureCategory;
  failedStep?: string;
  error?: string;
}

export const ATTEMPT_TRANSITIONS: Readonly<Record<AttemptPhase, readonly AttemptPhase[]>> = {
  "preparing-workspace": ["running-setup", "running-step", "failed", "canceled"],
  "running-setup": ["running-step", "running-teardown", "failed", "canceled"],
  "running-step": ["running-step", "running-teardown", "succeeded", "failed", "canceled"],
  "running-teardown": ["succeeded", "failed", "canceled"],
  succeeded: [],
  failed: [],
  canceled: [],
};

type TransitionContext = Partial<Omit<AttemptState, "phase">>;

export function transitionPhase(
  current: AttemptState,
  next: AttemptPhase,
  ctx: TransitionContext,
): AttemptState {
  if (!ATTEMPT_TRANSITIONS[current.phase].includes(next)) {
    throw new Error(`Illegal attempt phase transition: ${current.phase} -> ${next}`);
  }

  const nextState: AttemptState = {
    ...current,
    phase: next,
  };

  if (ctx.step !== undefined) {
    nextState.step = ctx.step;
  }
  if (ctx.failure !== undefined) {
    nextState.failure = ctx.failure;
  }
  if (ctx.failedStep !== undefined) {
    nextState.failedStep = ctx.failedStep;
  }
  if (ctx.error !== undefined) {
    nextState.error = ctx.error;
  }

  return nextState;
}
