import { builtInDirectContextExecutors } from "safe-bash-io-engine/internal";
import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createFactorCommand as createRawFactorCommand } from "./command.js";
import type { FactorCommandsOptions } from "./internal.js";

export type { FactorCommandsOptions, FactorLimits } from "./internal.js";

export function createFactorCommand(options: FactorCommandsOptions = {}): CommandDefinition {
  const def = createRawFactorCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createFactorCommands(options: FactorCommandsOptions = {}): readonly CommandDefinition[] {
  return [createFactorCommand(options)];
}

export function factorCommands(options: FactorCommandsOptions = {}): VirtualShellPlugin {
  const commands = createFactorCommands(options);
  return { name: "factor-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
