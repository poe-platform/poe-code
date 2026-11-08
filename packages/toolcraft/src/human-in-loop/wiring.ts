import type { CommandNode, Group } from "../index.js";
import { UserError } from "../user-error.js";
import type { HumanInLoopRuntime } from "./types.js";

const WIRING_HINT =
  'pass { humanInLoop: createHumanInLoop({ provider, ... }) } from "toolcraft/human-in-loop"';

/**
 * Human-in-loop config on a command is only allowed when a runtime is wired.
 * Called by every entrypoint (CLI, MCP, SDK) after the root is normalized.
 */
export function assertHumanInLoopWired(
  root: CommandNode<any>,
  humanInLoop: HumanInLoopRuntime | undefined
): void {
  if (humanInLoop !== undefined) {
    return;
  }

  const commandPath = findHumanInLoopCommandPath(root, []);

  if (commandPath !== undefined) {
    throw new UserError(
      `command '${commandPath}' declares humanInLoop but no runtime is wired — ${WIRING_HINT}`
    );
  }
}

export function mergeApprovalsRoot<TServices extends object>(
  root: Group<TServices>,
  options: { approvals?: boolean; humanInLoop?: HumanInLoopRuntime }
): Group<TServices> {
  if (options.approvals !== true) {
    return root;
  }

  if (options.humanInLoop === undefined) {
    throw new UserError(`approvals: true requires a wired humanInLoop runtime — ${WIRING_HINT}`);
  }

  return options.humanInLoop.mergeApprovalsGroup(root);
}

function findHumanInLoopCommandPath(
  node: CommandNode<any>,
  path: string[]
): string | undefined {
  if (node.kind === "command") {
    return node.humanInLoop ? path.join(".") || node.name : undefined;
  }

  for (const child of node.children) {
    const found = findHumanInLoopCommandPath(child, [...path, child.name]);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}
