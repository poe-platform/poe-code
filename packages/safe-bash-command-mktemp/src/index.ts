import type { VirtualShellPlugin } from "safe-bash-contracts";
import { createMktempCommand } from "./command.js";
import type { MetadataCommandsOptions } from "safe-bash-metadata-engine";
export * from "./command.js";
export type { MetadataCommandsOptions as MktempCommandsOptions, MetadataLimits as MktempLimits } from "safe-bash-metadata-engine";
export function createMktempCommands(options: MetadataCommandsOptions = {}) { return [createMktempCommand(options)]; }
export function mktempCommands(options: MetadataCommandsOptions = {}): VirtualShellPlugin {
  const commands = createMktempCommands(options);
  return { name: "mktemp-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
