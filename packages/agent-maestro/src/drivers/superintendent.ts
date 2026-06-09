import type { runLoop } from "@poe-code/superintendent";

import type { WorkflowDriver } from "./types.js";
import { createUnsupportedWorkflowDriver } from "./unsupported.js";

export type SuperintendentEntrypoint = typeof runLoop;

export const superintendentDriver: WorkflowDriver =
  createUnsupportedWorkflowDriver("superintendent");
