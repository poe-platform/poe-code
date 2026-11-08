import { builtInDirectContextExecutors, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { createLineEndingExecutor } from "safe-bash-line-ending-engine/command";
import type { LineEndingCommandsOptions } from "safe-bash-line-ending-engine";
export { evalSyncLineEndings } from "safe-bash-line-ending-engine/sync";
import { createUnix2dosCommand } from "safe-bash-command-unix2dos";
export { createUnix2dosCommand } from "safe-bash-command-unix2dos";
export function createDos2unixCommand(options: LineEndingCommandsOptions = {}): CommandDefinition {
  const command: CommandDefinition = {
    name: "dos2unix",
    description: "Convert DOS and Unix line endings in bounded VFS files or streams",
    execute: createLineEndingExecutor("dos2unix", options),
  };
  if (options.limits === undefined) builtInDirectContextExecutors.add(command.execute);
  return command;
}
export function createDos2unixCommands(options: LineEndingCommandsOptions = {}): readonly CommandDefinition[] {
  return [createDos2unixCommand(options), createUnix2dosCommand(options)];
}

export function dos2unixCommands(options: LineEndingCommandsOptions = {}): VirtualShellPlugin {
  const commands = createDos2unixCommands(options);
  return { name: "line-ending-commands", setup(host) {
    if (!options.replace) {
      for (const command of commands) {
        if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
      }
    }
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}

export type {
  LineEndingCommandsOptions, LineEndingLimits,
  LineEndingCommandsOptions as Dos2unixCommandsOptions, LineEndingLimits as Dos2unixLimits,
} from "safe-bash-line-ending-engine";
