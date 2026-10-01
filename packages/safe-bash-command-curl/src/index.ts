import type { CommandDefinition,VirtualShellPlugin } from "safe-bash-contracts";
import type { NetworkCommandsOptions } from "safe-bash-network-engine/types";
import { createCurlCommand } from "./curl.js";
export type { NetworkCommandsOptions as CurlCommandsOptions,NetworkLimits as CurlLimits } from "safe-bash-network-engine/types";
export { createCurlCommand } from "./curl.js";
export function createCurlCommands(options: NetworkCommandsOptions = {}): readonly CommandDefinition[] { return [createCurlCommand(options)]; }
export function curlCommands(options: NetworkCommandsOptions = {}): VirtualShellPlugin {
 const commands = createCurlCommands(options);
 return { name: "curl-commands", setup(host) {
 if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
 for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
