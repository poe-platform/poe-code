import {
  createSpongeCommand as createRawSpongeCommand,
  createSpongeCommands as createRawSpongeCommands,
  spongeCommands as rawSpongeCommands,
  type SpongeCommandsOptions,
} from "safe-bash-command-sponge";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { builtInDirectContextExecutors, isDefaultCommandOptions, syncCommandEvaluators } from "../internal.js";

export * from "safe-bash-command-sponge";
import { evalSyncSponge } from "safe-bash-command-sponge";

syncCommandEvaluators.evalSyncSponge = evalSyncSponge;

export function createSpongeCommand(options: SpongeCommandsOptions = {}): CommandDefinition {
  const def = createRawSpongeCommand(options);
  if (isDefaultCommandOptions(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createSpongeCommands(options: SpongeCommandsOptions = {}): readonly CommandDefinition[] {
  return createRawSpongeCommands(options).map(def => {
    if (isDefaultCommandOptions(options)) builtInDirectContextExecutors.add(def.execute);
    return def;
  });
}

export function spongeCommands(options: SpongeCommandsOptions = {}): VirtualShellPlugin {
  const plugin = rawSpongeCommands(options);
  return {
    ...plugin,
    setup(host) {
      for (const def of createSpongeCommands(options)) {
        if (!options.replace && host.commands.has(def.name)) throw new Error(`Command already registered: ${def.name}`);
        host.commands.register(def, { replace: options.replace ?? false });
      }
    },
  };
}
