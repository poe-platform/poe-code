import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createGetconfCommand as createRawGetconfCommand,
  createGetconfCommands as createRawGetconfCommands,
  type GetconfCommandsOptions,
} from "safe-bash-command-getconf";

export * from "safe-bash-command-getconf";

function isDefaultGetconfOptions(options?: GetconfCommandsOptions): boolean {
  return options?.processors === undefined && options?.variables === undefined && options?.limits === undefined;
}

export function createGetconfCommand(options: GetconfCommandsOptions = {}): CommandDefinition {
  const def = createRawGetconfCommand(options);
  if (isDefaultGetconfOptions(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createGetconfCommands(options: GetconfCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawGetconfCommands(options);
  if (isDefaultGetconfOptions(options)) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export function getconfCommands(options: GetconfCommandsOptions = {}): VirtualShellPlugin {
  const commands = createGetconfCommands(options);
  return {
    name: "getconf-commands",
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) {
            throw new Error(`Command already registered: ${command.name}`);
          }
        }
      }
      for (const command of commands) {
        host.commands.register(command, { replace: options.replace ?? false });
      }
    },
  };
}
