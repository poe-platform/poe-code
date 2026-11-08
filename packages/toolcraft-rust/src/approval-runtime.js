import { approvalCommandsPolicy, mergeApprovalsGroup } from "./approval-commands.js";
import { invokeWithHumanInLoop } from "./approval-gate.js";

export function createHumanInLoop(options) {
  const runtimeOptions = approvalCommandsPolicy("runtime", [options]);
  return {
    runtimeOptions,
    invoke: (node, ctx, commandPath) => invokeWithHumanInLoop(node, ctx, runtimeOptions, commandPath),
    mergeApprovalsGroup
  };
}
