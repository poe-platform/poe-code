import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createCommCommand } from "./comm.js";
import type { TableTextCommandsOptions } from "safe-bash-table-text-engine/table-text/internal";
export type CommCommandsOptions = TableTextCommandsOptions;
export type { TableTextLimits as CommLimits } from "safe-bash-table-text-engine/table-text/internal";
export { createCommCommand } from "./comm.js";
export function createCommCommands(options: CommCommandsOptions = {}): readonly CommandDefinition[] { return [createCommCommand(options)]; }
export function commCommands(options: CommCommandsOptions = {}): VirtualShellPlugin {
 const commands = createCommCommands(options);
 return { name: "comm-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
