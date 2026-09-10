import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createTsortCommand } from "./command.js";
import type { TsortCommandsOptions } from "./internal.js";

export { createTsortCommand } from "./command.js";
export type { TsortCommandsOptions, TsortLimits } from "./internal.js";

export function createTsortCommands(options: TsortCommandsOptions = {}): readonly CommandDefinition[] {
  return [createTsortCommand(options)];
}

export function tsortCommands(options: TsortCommandsOptions = {}): VirtualShellPlugin {
  const commands = createTsortCommands(options);
  return { name: "tsort-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
