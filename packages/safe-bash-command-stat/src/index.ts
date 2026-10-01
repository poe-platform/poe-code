import type { VirtualShellPlugin } from "safe-bash-contracts";
import { createStatCommand } from "./command.js";
import type { MetadataCommandsOptions } from "safe-bash-metadata-engine";
export * from "./command.js";
export type { MetadataCommandsOptions as StatCommandsOptions, MetadataLimits as StatLimits } from "safe-bash-metadata-engine";
export function createStatCommands(options: MetadataCommandsOptions = {}) { return [createStatCommand(options)]; }
export function statCommands(options: MetadataCommandsOptions = {}): VirtualShellPlugin {
  const commands = createStatCommands(options);
  return { name: "stat-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
