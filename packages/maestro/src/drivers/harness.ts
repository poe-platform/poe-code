import type { runHarnessPair } from "@poe-code/agent-harness";

import type { WorkflowDriver } from "./types.js";
import { createUnsupportedWorkflowDriver } from "./unsupported.js";

export type HarnessEntrypoint = typeof runHarnessPair;

export const harnessDriver: WorkflowDriver = createUnsupportedWorkflowDriver("harness");
