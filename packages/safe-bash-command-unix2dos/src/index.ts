import { builtInDirectContextExecutors, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { createLineEndingExecutor } from "safe-bash-line-ending-engine/command";
import type { LineEndingCommandsOptions } from "safe-bash-line-ending-engine";
export { evalSyncLineEndings } from "safe-bash-line-ending-engine/sync";
export function createUnix2dosCommand(options: LineEndingCommandsOptions = {}): CommandDefinition {
  const command: CommandDefinition = {
    name: "unix2dos",
    description: "Convert DOS and Unix line endings in bounded VFS files or streams",
    execute: createLineEndingExecutor("unix2dos", options),
  };
  if (options.limits === undefined) builtInDirectContextExecutors.add(command.execute);
  return command;
}
export function createUnix2dosCommands(options: LineEndingCommandsOptions = {}): readonly CommandDefinition[] {
  return [createUnix2dosCommand(options)];
}
export function unix2dosCommands(options: LineEndingCommandsOptions = {}): VirtualShellPlugin {
  const commands = createUnix2dosCommands(options);
  return { name: "unix2dos-commands", setup(host) {
    if (!options.replace && host.commands.has("unix2dos")) throw new Error("Command already registered: unix2dos");
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
export type { LineEndingCommandsOptions as Unix2dosCommandsOptions, LineEndingLimits as Unix2dosLimits } from "safe-bash-line-ending-engine";
