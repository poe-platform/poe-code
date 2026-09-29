import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createCalCommand as createRawCalCommand,
  createNcalCommand as createRawNcalCommand,
  createCalCommands as createRawCalCommands,
  evalSyncCal,
  type CalCommandsOptions,
} from "safe-bash-command-cal";

export * from "safe-bash-command-cal";
export { evalSyncCal };

function isDefaultCalOptions(options?: CalCommandsOptions): boolean {
  return options?.clock === undefined && options?.limits === undefined;
}

export function createCalCommand(options: CalCommandsOptions = {}): CommandDefinition {
  const def = createRawCalCommand(options);
  if (isDefaultCalOptions(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createNcalCommand(options: CalCommandsOptions = {}): CommandDefinition {
  const def = createRawNcalCommand(options);
  if (isDefaultCalOptions(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createCalCommands(options: CalCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawCalCommands(options);
  if (isDefaultCalOptions(options)) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export function calCommands(options: CalCommandsOptions = {}): VirtualShellPlugin {
  const commands = createCalCommands(options);
  return {
    name: "cal-commands",
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
