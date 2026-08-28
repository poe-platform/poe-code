import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import type { WhichCommandsOptions } from "./options.js";
import { createWhichCommand } from "./which.js";

export { createWhichCommand } from "./which.js";
export type { WhichCommandsOptions, WhichLimits } from "./options.js";

export function createWhichCommands(options: WhichCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createWhichCommand(options)]);
}

export function whichCommands(options: WhichCommandsOptions = {}): VirtualShellPlugin {
  const commands = createWhichCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "which-commands",
    setup(host) {
      if (!replace) for (const command of commands) {
        if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
      }
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}
