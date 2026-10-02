import { evalSyncShuf } from "./sync.js";
import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createShufCommand } from "./shuf.js";
import type { ShufCommandsOptions } from "./options.js";

export { createShufCommand } from "./shuf.js";
export type { ShufCommandsOptions } from "./options.js";

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

export { settings, type ShufLimits, type ShufOptions } from "./options.js";
export { RandomIntegers } from "./random.js";

export { evalSyncShuf } from "./sync.js";

import { syncCommandEvaluators } from "safe-bash-contracts/runtime-control";
syncCommandEvaluators.evalSyncShuf = evalSyncShuf;
