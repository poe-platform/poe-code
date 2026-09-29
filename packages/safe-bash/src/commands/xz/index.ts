import {
  createXzCommand as createBaseXzCommand,
  createXzCommands as createBaseXzCommands,
  type XzCommandsOptions,
  type CompressionCommandOptions,
} from "safe-bash-command-xz";
import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";

export type { XzCommandsOptions, CompressionCommandOptions };

function isDefaultXzOptions(options?: XzCommandsOptions): boolean {
  return options === undefined || options.maxDecodedBytes === undefined;
}

export function createXzCommand(options: XzCommandsOptions = {}): CommandDefinition {
  const def = createBaseXzCommand(options);
  if (isDefaultXzOptions(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createXzCommands(options: XzCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createBaseXzCommands(options);
  if (isDefaultXzOptions(options)) {
    for (const def of defs) builtInDirectContextExecutors.add(def.execute);
  }
  return defs;
}

export function xzCommands(options: XzCommandsOptions = {}): VirtualShellPlugin {
  const commands = createXzCommands(options);
  return {
    name: "xz-commands",
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) {
        host.commands.register(command, { replace: options.replace ?? false });
      }
    },
  };
}
