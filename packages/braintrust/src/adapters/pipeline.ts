import type { PipelineRunOptions } from "@poe-code/pipeline";

import type { BraintrustClient } from "../client.js";
import { makePipelineRowState } from "../row-builder.js";

export type PipelineCallbackFields = Pick<
  PipelineRunOptions,
  "onPlanResolved" | "onTaskStart" | "onTaskComplete" | "onLockStatusChange"
>;

export function createPipelineCallbacks(
  client: BraintrustClient,
): PipelineCallbackFields {
  const state = makePipelineRowState(client);

  return {
    onPlanResolved(summary) {
      void summary;
    },
    onTaskStart(progress) {
      state.start(progress);
    },
    onTaskComplete(progress) {
      state.complete(progress);
    },
    onLockStatusChange(status) {
      void status;
    },
  };
}
