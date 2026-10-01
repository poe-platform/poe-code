import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createTarCommand, type ArchiveCommandsOptions } from "safe-bash-command-tar";
import { createZipCommand } from "safe-bash-command-zip";
import { createUnzipCommand } from "safe-bash-command-unzip";


export function createArchiveCommands(options: ArchiveCommandsOptions = {}): readonly CommandDefinition[] {
  return [createTarCommand(options), createZipCommand(options), createUnzipCommand(options)];
}

export function archiveCommands(options: ArchiveCommandsOptions = {}): VirtualShellPlugin {
  const commands = createArchiveCommands(options);
  return { name: "archive-commands", setup(host) {
    if (!options.replace) {
      for (const command of commands) {
        if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
      }
    }
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
export * from "safe-bash-command-tar";
export { createZipCommand, createZipCommands, zipCommands, evalSyncZip, type ZipCommandsOptions, type ZipLimits } from "safe-bash-command-zip";
export { createUnzipCommand, createUnzipCommands, unzipCommands, evalSyncUnzip, type UnzipCommandsOptions, type UnzipLimits } from "safe-bash-command-unzip";