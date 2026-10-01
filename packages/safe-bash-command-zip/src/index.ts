import type { CommandDefinition,VirtualShellPlugin } from "safe-bash-contracts";
import { builtInDirectContextExecutors } from "safe-bash-contracts/runtime-control";
import type { ArchiveCommandsOptions } from "safe-bash-io-engine/commands/archive/internal";
import { createZipCommand as createBaseCommand } from "./zip.js";
export function createZipCommand(options: ArchiveCommandsOptions = {}): CommandDefinition {
 const command = createBaseCommand(options);
 if (options.limits === undefined && options.zipHost === undefined) builtInDirectContextExecutors.add(command.execute);
 return command;
}
export type { ArchiveCommandsOptions,ArchiveCommandsOptions as ZipCommandsOptions,ArchiveLimits as ZipLimits } from "safe-bash-io-engine/commands/archive/internal";
export * from "./sync.js";

export function createZipCommands(options: ArchiveCommandsOptions = {}): readonly CommandDefinition[] { return [createZipCommand(options)]; }
export function zipCommands(options: ArchiveCommandsOptions = {}): VirtualShellPlugin {
  const commands = createZipCommands(options);
  return { name: "zip-commands", setup(host) {
    if (!options.replace) for (const command of commands) {
      if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    }
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
