export * from "safe-bash-command-which";

import { syncCommandEvaluators } from "../internal.js";
import { evalSyncWhich } from "safe-bash-command-which";
syncCommandEvaluators.evalSyncWhich = evalSyncWhich;
