import {
  createDdCommand as createRawDdCommand,
  createDdCommands as createRawDdCommands,
  type DdCommandsOptions,
} from "safe-bash-command-dd";
import type { CommandDefinition, VirtualShellPlugin } from "./contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "./commands/internal.js";

export * from "safe-bash-command-dd";

export function createDdCommand(options: DdCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawDdCommand(options), options);
}

export function createDdCommands(options: DdCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawDdCommands(options), options);
}

export function ddCommands(options: DdCommandsOptions = {}): VirtualShellPlugin {
  const commands = createDdCommands(options);
  const replace = (options as { replace?: boolean }).replace ?? false;
  return {
    name: "dd-commands",
    setup(host) {
      if (!replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}
