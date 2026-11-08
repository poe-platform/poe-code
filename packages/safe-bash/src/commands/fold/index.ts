import {
  createFoldCommand as createRawFoldCommand,
  createFoldCommands as createRawFoldCommands,
  type FoldCommandsOptions,
} from "safe-bash-command-fold";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";

export * from "safe-bash-command-fold";

export function createFoldCommand(options: FoldCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawFoldCommand(options), options);
}

export function createFoldCommands(options: FoldCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawFoldCommands(options), options);
}

export function foldCommands(options: FoldCommandsOptions = {}): VirtualShellPlugin {
  const commands = createFoldCommands(options);
  const replace = (options as { replace?: boolean }).replace ?? false;
  return {
    name: "fold-commands",
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
