import {
  createNumfmtCommand as createRawNumfmtCommand,
  createNumfmtCommands as createRawNumfmtCommands,
  type NumfmtCommandsOptions,
} from "safe-bash-command-numfmt";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";

export * from "safe-bash-command-numfmt";

export function createNumfmtCommand(options: NumfmtCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawNumfmtCommand(options), options);
}

export function createNumfmtCommands(options: NumfmtCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawNumfmtCommands(options), options);
}

export function numfmtCommands(options: NumfmtCommandsOptions = {}): VirtualShellPlugin {
  const commands = createNumfmtCommands(options);
  const replace = (options as { replace?: boolean }).replace ?? false;
  return {
    name: "numfmt-commands",
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
