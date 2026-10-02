import { evalSyncLineEndings } from "safe-bash-command-dos2unix";
export * from "safe-bash-command-dos2unix";
export {
  createDos2unixCommand, createUnix2dosCommand, createDos2unixCommands, dos2unixCommands,
  createDos2unixCommands as createLineEndingCommands, dos2unixCommands as lineEndingCommands,
} from "safe-bash-command-dos2unix";

export { evalSyncLineEndings } from "safe-bash-command-dos2unix";

import { syncCommandEvaluators } from "../internal.js";
syncCommandEvaluators.evalSyncLineEndings = evalSyncLineEndings;
