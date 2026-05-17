import type { runExperimentLoop } from "@poe-code/experiment-loop";

import type { WorkflowDriver } from "./types.js";

export type ExperimentEntrypoint = typeof runExperimentLoop;

export const experimentDriver: WorkflowDriver = {
  kind: "experiment",
  async run() {
    throw new Error("experiment driver not implemented");
  }
};
