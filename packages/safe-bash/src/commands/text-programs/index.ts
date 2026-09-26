import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { builtInDirectContextExecutors } from "../internal.js";
import { sedCommand } from "./sed.js";
import { awkCommand } from "./awk.js";
import type { TextProgramOptions } from "./shared.js";

export type { TextProgramOptions } from "./shared.js";

export function createTextProgramCommands(options: TextProgramOptions = {}): readonly CommandDefinition[] {
  const definitions = [sedCommand(options), awkCommand(options)];
  for (let i = 0; i < definitions.length; i++) builtInDirectContextExecutors.add(definitions[i]!.execute);
  return definitions;
}

export function textProgramCommands(options: TextProgramOptions = {}): VirtualShellPlugin {
  return {
    name: "text-program-commands",
    setup(host) {
      const definitions = createTextProgramCommands(options);
      if (!options.replace) for (const definition of definitions) {
        if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
      }
      for (const definition of definitions) host.commands.register(definition, { replace: options.replace ?? false });
    },
  };
}
