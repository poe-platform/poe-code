import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createGhCommand as createRawGhCommand,
  createGhCommands as createRawGhCommands,
  evalSyncGh,
  type GhCommandOptions,
  type GhCommandsOptions,
} from "safe-bash-command-gh";

export * from "safe-bash-command-gh";
export { evalSyncGh };

export function createGhCommand(options: GhCommandOptions = {}): CommandDefinition {
  const def = createRawGhCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createGhCommands(options: GhCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawGhCommands(options);
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function ghCommands(options: GhCommandsOptions = {}): VirtualShellPlugin {
  const command = createGhCommand(options);
  return {
    name: "gh-commands",
    setup(host) {
      host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}

syncCommandEvaluators.evalSyncGh = evalSyncGh;
