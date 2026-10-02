export * from "safe-bash-command-cmp";

export { createCmpCommand, createCmpCommands, cmpCommands, cmpCommand, evalSyncCmp } from "safe-bash-command-cmp";

import { syncCommandEvaluators } from "./internal.js";
import { evalSyncCmp } from "safe-bash-command-cmp";
syncCommandEvaluators.evalSyncCmp = evalSyncCmp;
