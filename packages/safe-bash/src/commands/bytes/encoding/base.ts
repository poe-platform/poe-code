export * from "safe-bash-base-encoding-engine/base";

import { syncCommandEvaluators } from "../../internal.js";
import { evalSyncBase32 } from "safe-bash-base-encoding-engine/base";
syncCommandEvaluators.evalSyncBase32 = evalSyncBase32;
