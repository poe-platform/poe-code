import { evalSyncUnzip } from "./sync.js";
import type { CommandDefinition,VirtualShellPlugin } from "safe-bash-contracts";
import { builtInDirectContextExecutors } from "safe-bash-contracts/runtime-control";
import type { ArchiveCommandsOptions } from "safe-bash-io-engine/commands/archive/internal";
import { createUnzipCommand as createBaseCommand } from "./unzip.js";
export function createUnzipCommand(options: ArchiveCommandsOptions = {}): CommandDefinition {
 const command = createBaseCommand(options);
 if (options.limits === undefined && options.zipHost === undefined) builtInDirectContextExecutors.add(command.execute);
 return command;
}
export type { ArchiveCommandsOptions,ArchiveCommandsOptions as UnzipCommandsOptions,ArchiveLimits as UnzipLimits } from "safe-bash-io-engine/commands/archive/internal";
export * from "./sync.js";

export function createUnzipCommands(options: ArchiveCommandsOptions = {}): readonly CommandDefinition[] { return [createUnzipCommand(options)]; }
export function unzipCommands(options: ArchiveCommandsOptions = {}): VirtualShellPlugin {
  const commands = createUnzipCommands(options);
  return { name: "unzip-commands", setup(host) {
    if (!options.replace) for (const command of commands) {
      if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    }
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}

import { syncCommandEvaluators } from "safe-bash-contracts/runtime-control";
syncCommandEvaluators.evalSyncUnzip = evalSyncUnzip;
