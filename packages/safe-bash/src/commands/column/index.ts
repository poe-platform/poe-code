import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createColumnCommand } from "./column.js";
import type { ColumnCommandsOptions } from "./options.js";

export { createColumnCommand } from "./column.js";
export type { ColumnCommandsOptions, ColumnLimits } from "./options.js";

export function createColumnCommands(options: ColumnCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = [createColumnCommand(options)];
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function columnCommands(options: ColumnCommandsOptions = {}): VirtualShellPlugin {
  const commands = createColumnCommands(options), replace = options.replace ?? false;
  return { name: "column-commands", setup(host) {
    if (!replace) for (const command of commands) {
      if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    }
    for (const command of commands) host.commands.register(command, { replace });
  } };
}
