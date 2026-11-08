import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { jqCommand } from "./jq.js";
import type { StructuredCommandsOptions } from "./limits.js";

export { defaultJqLimits } from "./limits.js";
export type { JqLimits, StructuredCommandsOptions } from "./limits.js";

export function createStructuredCommands(options: StructuredCommandsOptions = {}): readonly CommandDefinition[] {
  return [jqCommand(options)];
}
export function structuredCommands(options: StructuredCommandsOptions = {}): VirtualShellPlugin {
  const definitions = createStructuredCommands(options);
  return {
    name: "structured-commands",
    setup(host) {
      if (!options.replace) for (const definition of definitions) {
        if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
      }
      for (const definition of definitions) host.commands.register(definition, { replace: options.replace ?? false });
    },
  };
}
