export * from "safe-bash-command-du";

import { syncCommandEvaluators } from "../internal.js";
import { evalSyncDu } from "safe-bash-command-du";
syncCommandEvaluators.evalSyncDu = evalSyncDu;
