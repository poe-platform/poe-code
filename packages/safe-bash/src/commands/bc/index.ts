import {
  createBcCommand as createRawBcCommand,
  createBcCommands as createRawBcCommands,
  type BcCommandsOptions,
} from "safe-bash-command-bc";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";

export * from "safe-bash-command-bc";

export function createBcCommand(options: BcCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawBcCommand(options), options);
}

export function createBcCommands(options: BcCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawBcCommands(options), options);
}

export function bcCommands(options: BcCommandsOptions = {}): VirtualShellPlugin {
  const commands = createBcCommands(options);
  const replace = (options as { replace?: boolean }).replace ?? false;
  return {
    name: "bc-commands",
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
