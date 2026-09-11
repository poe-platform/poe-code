import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createPrCommand } from "./command.js";
import type { PrCommandsOptions } from "./internal.js";

export { createPrCommand } from "./command.js";
export type { PrCommandsOptions, PrLimits } from "./internal.js";

export function createPrCommands(options: PrCommandsOptions = {}): readonly CommandDefinition[] {
  return [createPrCommand(options)];
}

export function prCommands(options: PrCommandsOptions = {}): VirtualShellPlugin {
  const commands = createPrCommands(options);
  return { name: "pr-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
