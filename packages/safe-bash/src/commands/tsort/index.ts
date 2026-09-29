import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createTsortCommand as createRawTsortCommand } from "./command.js";
import type { TsortCommandsOptions } from "./internal.js";

export type { TsortCommandsOptions, TsortLimits } from "./internal.js";

export function createTsortCommand(options: TsortCommandsOptions = {}): CommandDefinition {
  const def = createRawTsortCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createTsortCommands(options: TsortCommandsOptions = {}): readonly CommandDefinition[] {
  return [createTsortCommand(options)];
}

export function tsortCommands(options: TsortCommandsOptions = {}): VirtualShellPlugin {
  const commands = createTsortCommands(options);
  return { name: "tsort-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
