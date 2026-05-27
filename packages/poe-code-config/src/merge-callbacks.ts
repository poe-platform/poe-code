type BivariantCallback<Args extends unknown[], Return = void> = {
  callback(...args: Args): Return;
}["callback"];

export type PipelineCallbackFields = {
  onPlanResolved?: BivariantCallback<[summary: unknown]>;
  onTaskStart?: BivariantCallback<[progress: unknown]>;
  onTaskComplete?: BivariantCallback<[progress: unknown]>;
};

export type ExperimentCallbackFields = {
  onExperimentStart?: BivariantCallback<[index: number, agent: string]>;
  onBaselineCollected?: BivariantCallback<[baseline: Record<string, number>]>;
  onMetricResult?: BivariantCallback<[metric: unknown, result: unknown]>;
  onCommit?: BivariantCallback<[commitHash: string]>;
  onReset?: BivariantCallback<[targetHash: string]>;
  onExperimentComplete?: BivariantCallback<[index: number, entry: unknown]>;
};

export type LoopCallbacks = {
  onBuilderStart?: () => void;
  onBuilderComplete?: BivariantCallback<[result: unknown]>;
  onBuilderFailed?: BivariantCallback<[error: Error]>;
  onInspectorStart?: BivariantCallback<[name: string]>;
  onInspectorComplete?: BivariantCallback<[result: unknown]>;
  onInspectorFailed?: BivariantCallback<[name: string, error: Error]>;
  onSuperintendentStart?: () => void;
  onSuperintendentComplete?: BivariantCallback<[result: unknown]>;
  onOwnerStart?: () => void;
  onOwnerComplete?: BivariantCallback<[result: unknown]>;
  onRoundComplete?: BivariantCallback<[round: number]>;
  onLoopComplete?: BivariantCallback<[state: unknown]>;
  onStateChange?: BivariantCallback<[state: unknown]>;
  shouldPause?: () => boolean;
  shouldStop?: () => boolean;
};

type Callback = (this: unknown, ...args: never[]) => unknown;
type CallbackFields = Record<string, Callback | undefined>;

export function mergePipelineCallbacks(
  user: PipelineCallbackFields | undefined,
  added: PipelineCallbackFields | undefined
): PipelineCallbackFields | undefined {
  return mergeCallbacks(user, added);
}

export function mergeExperimentCallbacks(
  user: ExperimentCallbackFields | undefined,
  added: ExperimentCallbackFields | undefined
): ExperimentCallbackFields | undefined {
  return mergeCallbacks(user, added);
}

export function mergeLoopCallbacks(
  user: LoopCallbacks | undefined,
  added: LoopCallbacks | undefined
): LoopCallbacks | undefined {
  return mergeCallbacks(user, added);
}

function mergeCallbacks<T extends object>(
  user: T | undefined,
  added: T | undefined
): T | undefined {
  if (!user) {
    return added;
  }

  if (!added) {
    return user;
  }

  const userCallbacks = user as unknown as CallbackFields;
  const addedCallbacks = added as unknown as CallbackFields;
  const result: CallbackFields = {};
  const keys = new Set([...Object.keys(user), ...Object.keys(added)]);

  for (const key of keys) {
    const userCallback = userCallbacks[key];
    const addedCallback = addedCallbacks[key];

    if (userCallback && addedCallback) {
      result[key] = function mergedCallback(this: unknown, ...args: never[]) {
        const userResult = userCallback.apply(this, args);

        try {
          addedCallback.apply(this, args);
        } catch (error) {
          console.warn(`Added callback ${key} failed`, error);
        }

        return userResult;
      };
      continue;
    }

    result[key] = userCallback ?? addedCallback;
  }

  return result as unknown as T;
}
