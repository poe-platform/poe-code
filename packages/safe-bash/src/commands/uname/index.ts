import {
  createUnameCommand as createRawUnameCommand,
  createUnameCommands as createRawUnameCommands,
  type UnameCommandsOptions,
} from "safe-bash-command-uname";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";

export * from "safe-bash-command-uname";

export function createUnameCommand(options: UnameCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawUnameCommand(options), options);
}

export function createUnameCommands(options: UnameCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawUnameCommands(options), options);
}

export function unameCommands(options: UnameCommandsOptions = {}): VirtualShellPlugin {
  const commands = createUnameCommands(options);
  const replace = (options as { replace?: boolean }).replace ?? false;
  return {
    name: "uname-commands",
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
