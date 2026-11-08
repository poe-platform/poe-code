import {
  createFmtCommand as createRawFmtCommand,
  createFmtCommands as createRawFmtCommands,
  type FmtCommandsOptions,
} from "safe-bash-command-fmt";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";

export * from "safe-bash-command-fmt";

export function createFmtCommand(options: FmtCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawFmtCommand(options), options);
}

export function createFmtCommands(options: FmtCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawFmtCommands(options), options);
}

export function fmtCommands(options: FmtCommandsOptions = {}): VirtualShellPlugin {
  const commands = createFmtCommands(options);
  const replace = (options as { replace?: boolean }).replace ?? false;
  return {
    name: "fmt-commands",
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
