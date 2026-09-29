import { builtInDirectContextExecutors } from "./commands/internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "./contracts/index.js";
import { createYesCommand as createRawYesCommand, type YesCommandOptions, type YesCommandsOptions } from "safe-bash-command-yes";

export * from "safe-bash-command-yes";

export function createYesCommand(options: YesCommandOptions = {}): CommandDefinition {
  const command = createRawYesCommand(options);
  if (options.maxRecordBytes === undefined && options.chunkBytes === undefined) builtInDirectContextExecutors.add(command.execute);
  return command;
}

export function createYesCommands(options: YesCommandOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createYesCommand(options)]);
}

export function yesCommands(options: YesCommandsOptions = {}): VirtualShellPlugin {
  const commands = createYesCommands(options);
  const { replace = false } = options;
  if (typeof replace !== "boolean") throw new TypeError("Yes replace must be a boolean");
  return {
    name: "yes-commands",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}
