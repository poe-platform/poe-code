import type { VirtualShellPlugin } from "safe-bash-contracts";
import { createChmodCommand } from "./command.js";
import type { MetadataCommandsOptions } from "safe-bash-metadata-engine";
export * from "./command.js";
export type { MetadataCommandsOptions as ChmodCommandsOptions, MetadataLimits as ChmodLimits } from "safe-bash-metadata-engine";
export function createChmodCommands(options: MetadataCommandsOptions = {}) { return [createChmodCommand(options)]; }
export function chmodCommands(options: MetadataCommandsOptions = {}): VirtualShellPlugin {
  const commands = createChmodCommands(options);
  return { name: "chmod-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
