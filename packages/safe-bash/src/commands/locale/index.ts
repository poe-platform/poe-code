import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createLocaleCommand as createRawLocaleCommand,
  createLocaleCommands as createRawLocaleCommands,
  type LocaleCommandsOptions,
} from "safe-bash-command-locale";

export * from "safe-bash-command-locale";

function isDefaultLocaleOptions(options?: LocaleCommandsOptions): boolean {
  return (
    options?.locales === undefined &&
    options?.charmaps === undefined &&
    options?.defaultLocale === undefined &&
    options?.limits === undefined
  );
}

export function createLocaleCommand(options: LocaleCommandsOptions = {}): CommandDefinition {
  const def = createRawLocaleCommand(options);
  if (isDefaultLocaleOptions(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createLocaleCommands(options: LocaleCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawLocaleCommands(options);
  if (isDefaultLocaleOptions(options)) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export function localeCommands(options: LocaleCommandsOptions = {}): VirtualShellPlugin {
  const commands = createLocaleCommands(options);
  return {
    name: "locale-commands",
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
