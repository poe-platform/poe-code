import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createDuCommand } from "./du.js";
import type { DuCommandsOptions } from "./options.js";
export { createDuCommand } from "./du.js";
export type { DuCommandsOptions, DuLimits } from "./options.js";

export function createDuCommands(options: DuCommandsOptions = {}): readonly CommandDefinition[] {
  return [createDuCommand(options)];
}

export function duCommands(options: DuCommandsOptions = {}): VirtualShellPlugin {
  const commands = createDuCommands(options);
  const replace = options.replace ?? false;
  return { name: "du-commands", setup(host) {
    if (!replace) for (const command of commands) {
      if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    }
    for (const command of commands) host.commands.register(command, { replace });
  } };
}
