export * from "safe-bash-command-file";

import { syncCommandEvaluators } from "../internal.js";
import { evalSyncFile } from "safe-bash-command-file";
syncCommandEvaluators.evalSyncFile = evalSyncFile;
