export * from "safe-bash-command-getopt";
export { createGetoptCommand, createGetoptCommands, getoptCommands, evalSyncGetopt } from "safe-bash-command-getopt";

import { syncCommandEvaluators } from "../internal.js";
import { evalSyncGetopt } from "safe-bash-command-getopt";
syncCommandEvaluators.evalSyncGetopt = evalSyncGetopt;
