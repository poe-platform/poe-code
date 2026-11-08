import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createJoinCommand } from "./join.js";
import type { TableTextCommandsOptions } from "safe-bash-table-text-engine/table-text/internal";
export type JoinCommandsOptions = TableTextCommandsOptions;
export type { TableTextLimits as JoinLimits } from "safe-bash-table-text-engine/table-text/internal";
export { createJoinCommand } from "./join.js";
export function createJoinCommands(options: JoinCommandsOptions = {}): readonly CommandDefinition[] { return [createJoinCommand(options)]; }
export function joinCommands(options: JoinCommandsOptions = {}): VirtualShellPlugin {
 const commands = createJoinCommands(options);
 return { name: "join-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
