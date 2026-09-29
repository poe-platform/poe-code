import {
  createXxdCommand as createRawXxdCommand,
  createXxdCommands as createRawXxdCommands,
  type XxdCommandsOptions,
} from "safe-bash-command-xxd";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";

export * from "safe-bash-command-xxd";

export function createXxdCommand(options: XxdCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawXxdCommand(options), options);
}

export function createXxdCommands(options: XxdCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawXxdCommands(options), options);
}

export function xxdCommands(options: XxdCommandsOptions = {}): VirtualShellPlugin {
  const commands = createXxdCommands(options);
  const replace = (options as { replace?: boolean }).replace ?? false;
  return {
    name: "xxd-commands",
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
