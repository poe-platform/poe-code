import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createTreeCommand } from "./tree.js";
import type { TreeCommandsOptions } from "./options.js";
export { createTreeCommand } from "./tree.js";
export type { TreeCommandsOptions, TreeLimits } from "./options.js";

export function createTreeCommands(options: TreeCommandsOptions = {}): readonly CommandDefinition[] {
  return [createTreeCommand(options)];
}

export function treeCommands(options: TreeCommandsOptions = {}): VirtualShellPlugin {
  const commands = createTreeCommands(options);
  const replace = options.replace ?? false;
  return { name: "tree-commands", setup(host) {
    if (!replace) for (const command of commands) {
      if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    }
    for (const command of commands) host.commands.register(command, { replace });
  } };
}
