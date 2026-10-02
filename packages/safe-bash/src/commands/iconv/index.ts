export * from "safe-bash-command-iconv";
export { createIconvCommand, createIconvCommands, iconvCommands, evalSyncIconv } from "safe-bash-command-iconv";

import { syncCommandEvaluators } from "../internal.js";
import { evalSyncIconv } from "safe-bash-command-iconv";
syncCommandEvaluators.evalSyncIconv = evalSyncIconv;
