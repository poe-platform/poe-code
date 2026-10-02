export * from "safe-bash-command-find/find";
export { createFindDefinitions as findCommands } from "safe-bash-command-find/find";

import { syncCommandEvaluators } from "./internal.js";
import { evalSyncFind } from "safe-bash-command-find/find";
syncCommandEvaluators.evalSyncFind = evalSyncFind;
