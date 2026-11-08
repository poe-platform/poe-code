import {
  createYqCommand as createRawYqCommand,
  createYqCommands as createRawYqCommands,
  yqCommands as rawYqCommands,
  type YqCommandsOptions,
} from "safe-bash-command-yq";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";
export * from "safe-bash-command-yq";

export function createYqCommand(options: YqCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawYqCommand(options), options);
}

export function createYqCommands(options: YqCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawYqCommands(options), options);
}

export function yqCommands(options: YqCommandsOptions = {}): VirtualShellPlugin {
  const commands = createYqCommands(options);
  const base = rawYqCommands(options);
  return {
    ...base,
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}

import { evalSyncYqPrep, formatSyncYqYamlLines } from "safe-bash-command-yq/sync";
export { evalSyncYqPrep, formatSyncYqYamlLines } from "safe-bash-command-yq/sync";

import { syncCommandEvaluators } from "../internal.js";
syncCommandEvaluators.evalSyncYqPrep = evalSyncYqPrep;
syncCommandEvaluators.formatSyncYqYamlLines = formatSyncYqYamlLines;
