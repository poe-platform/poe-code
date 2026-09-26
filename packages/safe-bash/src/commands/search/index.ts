import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { builtInDirectContextExecutors } from "../internal.js";
import { rgCommand } from "./rg.js";
import type { SearchOptions } from "./options.js";

export type { SearchOptions } from "./options.js";

export function createSearchCommands(options: SearchOptions = {}): readonly CommandDefinition[] {
  const definitions = [rgCommand(options)];
  for (let i = 0; i < definitions.length; i++) builtInDirectContextExecutors.add(definitions[i]!.execute);
  return definitions;
}

export function searchCommands(options: SearchOptions = {}): VirtualShellPlugin {
  return {
    name: "search-commands",
    setup(host) {
      const definitions = createSearchCommands(options);
      if (!options.replace) for (const definition of definitions) {
        if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
      }
      for (const definition of definitions) host.commands.register(definition, { replace: options.replace ?? false });
    },
  };
}
