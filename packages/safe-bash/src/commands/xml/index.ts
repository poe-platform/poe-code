export * from "safe-bash-command-xmllint";
export { createXmlCommands, xmlCommands, createXmllintCommand, createXmllintCommands, xmllintCommands, defaultXmlQueryLimits, evalSyncXmllint } from "safe-bash-command-xmllint";
export { evalSyncXq } from "safe-bash-command-xq";

import { syncCommandEvaluators } from "../internal.js";
import { evalSyncXmllint } from "safe-bash-command-xmllint";
import { evalSyncXq } from "safe-bash-command-xq";
syncCommandEvaluators.evalSyncXmllint = evalSyncXmllint;
syncCommandEvaluators.evalSyncXq = evalSyncXq;
