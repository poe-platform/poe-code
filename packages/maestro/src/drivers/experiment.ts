import type { runExperimentLoop } from "@poe-code/experiment-loop";

import type { WorkflowDriver } from "./types.js";
import { createUnsupportedWorkflowDriver } from "./unsupported.js";

export type ExperimentEntrypoint = typeof runExperimentLoop;

export const experimentDriver: WorkflowDriver = createUnsupportedWorkflowDriver("experiment");
