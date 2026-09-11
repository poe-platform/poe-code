import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createFactorCommand } from "./command.js";
import type { FactorCommandsOptions } from "./internal.js";

export { createFactorCommand } from "./command.js";
export type { FactorCommandsOptions, FactorLimits } from "./internal.js";

export function createFactorCommands(options: FactorCommandsOptions = {}): readonly CommandDefinition[] {
  return [createFactorCommand(options)];
}

export function factorCommands(options: FactorCommandsOptions = {}): VirtualShellPlugin {
  const commands = createFactorCommands(options);
  return { name: "factor-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
