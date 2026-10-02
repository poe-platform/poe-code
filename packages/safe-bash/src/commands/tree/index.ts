export * from "safe-bash-command-tree";

import { syncCommandEvaluators } from "../internal.js";
import { evalSyncTree } from "safe-bash-command-tree";
syncCommandEvaluators.evalSyncTree = evalSyncTree;
