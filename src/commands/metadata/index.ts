import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createChmodCommand } from "./chmod.js";
import { settings, type MetadataCommandsOptions } from "./internal.js";
export type { MetadataCommandsOptions, MetadataLimits } from "./internal.js";

export function createMetadataCommands(options: MetadataCommandsOptions = {}): readonly CommandDefinition[] {
  settings(options);
  return [createChmodCommand(options)];
}

export function metadataCommands(options: MetadataCommandsOptions = {}): VirtualShellPlugin {
  const commands = createMetadataCommands(options);
  return { name: "metadata-commands", setup(host) {
    if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
