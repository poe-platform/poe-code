import {
  createFdCommand as createRawFdCommand,
  createFdCommands as createRawFdCommands,
  type FdCommandsOptions,
} from "safe-bash-command-fd";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";

export * from "safe-bash-command-fd";

export function createFdCommand(options: FdCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawFdCommand(options), options);
}

export function createFdCommands(options: FdCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawFdCommands(options), options);
}

export function fdCommands(options: FdCommandsOptions = {}): VirtualShellPlugin {
  const commands = createFdCommands(options);
  const replace = (options as { replace?: boolean }).replace ?? false;
  return {
    name: "fd-commands",
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

import { syncCommandEvaluators } from "../internal.js";
import { evalSyncFd } from "safe-bash-command-fd";
syncCommandEvaluators.evalSyncFd = evalSyncFd;
