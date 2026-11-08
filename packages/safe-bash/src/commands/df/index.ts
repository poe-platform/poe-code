import {
  createDfCommand as createRawDfCommand,
  createDfCommands as createRawDfCommands,
  type DfCommandsOptions,
} from "safe-bash-command-df";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";

export * from "safe-bash-command-df";

export function createDfCommand(options: DfCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawDfCommand(options), options);
}

export function createDfCommands(options: DfCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawDfCommands(options), options);
}

export function dfCommands(options: DfCommandsOptions = {}): VirtualShellPlugin {
  const commands = createDfCommands(options);
  const replace = (options as { replace?: boolean }).replace ?? false;
  return {
    name: "df-commands",
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
import { evalSyncDf } from "safe-bash-command-df";
syncCommandEvaluators.evalSyncDf = evalSyncDf;
