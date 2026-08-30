import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createPasteCommand } from "./paste.js";
import { createCommCommand } from "./comm.js";
import { createJoinCommand } from "./join.js";
import { settings, type TableTextCommandsOptions } from "./internal.js";
export type { TableTextCommandsOptions, TableTextLimits } from "./internal.js";

export function createTableTextCommands(options: TableTextCommandsOptions = {}): readonly CommandDefinition[] {
  settings(options);
  return [createPasteCommand(options), createCommCommand(options), createJoinCommand(options)];
}

export function tableTextCommands(options: TableTextCommandsOptions = {}): VirtualShellPlugin {
  const commands = createTableTextCommands(options);
  return { name: "table-text-commands", setup(host) {
    if (!options.replace) for (const definition of commands) {
      if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
    }
    for (const definition of commands) host.commands.register(definition, { replace: options.replace ?? false });
  } };
}
