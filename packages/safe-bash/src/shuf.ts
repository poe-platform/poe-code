import { builtInDirectContextExecutors } from "./commands/internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "./contracts/index.js";
import { createShufCommand as createRawShufCommand } from "safe-bash-command-shuf";
import type { ShufCommandsOptions } from "safe-bash-command-shuf";
import type { ShufLimits, ShufOptions } from "safe-bash-command-shuf";

export type { ShufCommandsOptions, ShufLimits, ShufOptions };

export function createShufCommand(options: ShufCommandsOptions = {}): CommandDefinition {
  const def = createRawShufCommand(options);
  if (options.maxInputBytes === undefined && options.maxSampleSize === undefined) {
    builtInDirectContextExecutors.add(def.execute);
  }
  return def;
}

export function createShufCommands(options: ShufCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createShufCommand(options)]);
}

export function shufCommands(options: ShufCommandsOptions = {}): VirtualShellPlugin {
  const commands = createShufCommands(options);
  return {
    name: "shuf-commands",
    setup(host) {
      if (!options.replace) for (const command of commands) {
        if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}

