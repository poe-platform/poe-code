import type { runHarnessPair } from "@poe-code/agent-harness";

import type { WorkflowDriver } from "./types.js";

export type HarnessEntrypoint = typeof runHarnessPair;

export const harnessDriver: WorkflowDriver = {
  kind: "harness",
  async run() {
    throw new Error("harness driver not implemented");
  }
};
