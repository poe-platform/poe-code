import { UserError } from "../user-error.js";
import { mergeApprovalsGroup } from "./approvals-commands.js";
import { invokeWithHumanInLoop } from "./gate.js";
import type {
  HumanInLoopRuntimeInstance,
  HumanInLoopRuntimeOptions
} from "./runtime-options.js";

export function createHumanInLoop(
  options: HumanInLoopRuntimeOptions
): HumanInLoopRuntimeInstance {
  if (options?.provider === undefined) {
    throw new UserError(
      'createHumanInLoop requires a provider — import one from "toolcraft/human-in-loop" (e.g. osascriptProvider) or pass your own'
    );
  }

  const runtimeOptions: HumanInLoopRuntimeOptions = { ...options };

  return {
    runtimeOptions,
    invoke: (node, ctx, commandPath) =>
      invokeWithHumanInLoop(node, ctx, runtimeOptions, commandPath),
    mergeApprovalsGroup
  };
}
