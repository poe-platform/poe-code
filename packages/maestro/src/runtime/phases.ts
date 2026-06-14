export type AttemptPhase =
  | "preparing-workspace"
  | "running-step"
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

export const ATTEMPT_TRANSITIONS: Readonly<Record<AttemptPhase, readonly AttemptPhase[]>> = Object.freeze({
  "preparing-workspace": Object.freeze(["running-step", "failed", "canceled"] satisfies AttemptPhase[]),
  "running-step": Object.freeze(["running-step", "succeeded", "failed", "canceled"] satisfies AttemptPhase[]),
  succeeded: Object.freeze([] satisfies AttemptPhase[]),
  failed: Object.freeze([] satisfies AttemptPhase[]),
  canceled: Object.freeze([] satisfies AttemptPhase[]),
});

type TransitionContext = Partial<Omit<AttemptState, "phase">>;

export function transitionPhase(
  current: AttemptState | null,
  next: AttemptPhase,
  ctx: TransitionContext,
): AttemptState {
  if (current === null) {
    if (next !== "preparing-workspace") {
      throw new Error(`Illegal attempt phase transition: null -> ${next}`);
    }

    return validatedState({ phase: next }, next, ctx);
  }

  if (!ATTEMPT_TRANSITIONS[current.phase].includes(next)) {
    throw new Error(`Illegal attempt phase transition: ${current.phase} -> ${next}`);
  }

  return validatedState(
    {
      ...current,
      phase: next,
    },
    next,
    ctx,
  );
}

function validatedState(
  baseState: AttemptState,
  next: AttemptPhase,
  ctx: TransitionContext,
): AttemptState {
  const nextState: AttemptState = {
    ...baseState,
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

  if (next === "failed" && nextState.failure === undefined) {
    throw new Error("Failure category is required for failed phase");
  }

  if ((next === "succeeded" || next === "canceled") && nextState.failure !== undefined) {
    throw new Error(`Failure category must be absent for ${next} phase`);
  }

  return nextState;
}
