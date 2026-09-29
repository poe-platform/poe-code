import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createExiftoolCommand as createRawExiftoolCommand,
  createExiftoolCommands as createRawExiftoolCommands,
  type ExiftoolCommandOptions,
  type ExiftoolCommandsOptions,
} from "safe-bash-command-exiftool";

export * from "safe-bash-command-exiftool";

function isDefaultExiftoolOptions(options?: ExiftoolCommandOptions): boolean {
  if (!options) return true;
  return options.limits === undefined;
}

export function createExiftoolCommand(options: ExiftoolCommandOptions = {}): CommandDefinition {
  const def = createRawExiftoolCommand(options);
  if (isDefaultExiftoolOptions(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createExiftoolCommands(options: ExiftoolCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawExiftoolCommands(options);
  if (isDefaultExiftoolOptions(options)) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export function exiftoolCommands(options: ExiftoolCommandOptions = {}): VirtualShellPlugin {
  const command = createExiftoolCommand(options);
  return {
    name: "exiftool",
    setup(host) {
      host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
