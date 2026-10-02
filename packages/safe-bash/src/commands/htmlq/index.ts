export * from "safe-bash-command-htmlq";

import { syncCommandEvaluators } from "../internal.js";
import { evalSyncHtmlq } from "safe-bash-command-htmlq";
syncCommandEvaluators.evalSyncHtmlq = evalSyncHtmlq;
