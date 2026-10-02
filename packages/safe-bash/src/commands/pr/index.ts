export * from "safe-bash-command-pr";
export { createPrCommand, createPrCommands, prCommands, evalSyncPr } from "safe-bash-command-pr";

import { syncCommandEvaluators } from "../internal.js";
import { evalSyncPr } from "safe-bash-command-pr";
syncCommandEvaluators.evalSyncPr = evalSyncPr;
