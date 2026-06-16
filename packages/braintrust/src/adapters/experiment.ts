import type { ExperimentRunOptions } from "@poe-code/experiment-loop";

import type { BraintrustClient } from "../client.js";
import { makeExperimentIterationState } from "../row-builder.js";

export type ExperimentCallbackFields = Pick<
  ExperimentRunOptions,
  | "onExperimentStart"
  | "onBaselineCollected"
  | "onMetricResult"
  | "onCommit"
  | "onReset"
  | "onExperimentComplete"
>;

export function createExperimentCallbacks(
  client: BraintrustClient,
  experimentName: string,
): ExperimentCallbackFields {
  const state = makeExperimentIterationState(client, experimentName);

  return {
    onExperimentStart(index, agent) {
      return state.start(index, agent);
    },
    onBaselineCollected(baseline) {
      state.baseline(baseline);
    },
    onMetricResult(metric, result) {
      if (result.score !== null) {
        state.metric(metric.name, result.score);
      }
    },
    onCommit(commitHash) {
      state.commit(commitHash);
    },
    onReset(targetHash) {
      state.reset(targetHash);
    },
    onExperimentComplete(index, entry) {
      return state.complete(index, entry);
    },
  };
}
