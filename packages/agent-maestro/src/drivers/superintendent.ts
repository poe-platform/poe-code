import type { runLoop } from "@poe-code/superintendent";

import type { WorkflowDriver } from "./types.js";

export type SuperintendentEntrypoint = typeof runLoop;

export const superintendentDriver: WorkflowDriver = {
  kind: "superintendent",
  async run() {
    throw new Error("superintendent driver not implemented");
  }
};
