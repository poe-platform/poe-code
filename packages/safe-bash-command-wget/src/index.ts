import type { CommandDefinition,VirtualShellPlugin } from "safe-bash-contracts";
import type { NetworkCommandsOptions } from "safe-bash-network-engine/types";
import { createWgetCommand } from "./wget.js";
export type { NetworkCommandsOptions as WgetCommandsOptions,NetworkLimits as WgetLimits } from "safe-bash-network-engine/types";
export { createWgetCommand } from "./wget.js";
export function createWgetCommands(options: NetworkCommandsOptions = {}): readonly CommandDefinition[] { return [createWgetCommand(options)]; }
export function wgetCommands(options: NetworkCommandsOptions = {}): VirtualShellPlugin {
 const commands = createWgetCommands(options);
 return { name: "wget-commands", setup(host) {
 if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
 for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
