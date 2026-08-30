import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { settings, type SplitCommandsOptions } from "./options.js";
import { createSplitCommand } from "./split.js";
export type { SplitCommandsOptions, SplitLimits } from "./options.js";

export function createSplitCommands(options: SplitCommandsOptions = {}): readonly CommandDefinition[] {
  return [createSplitCommand(settings(options))];
}

export function splitCommands(options: SplitCommandsOptions = {}): VirtualShellPlugin {
  const commands = createSplitCommands(options);
  return { name: "split-commands", setup(host) {
    if (!options.replace) for (const command of commands) {
      if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    }
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
