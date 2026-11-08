import { builtInDirectContextExecutors } from "safe-bash-io-engine/internal";
import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createHexdumpCommand as createRawHexdumpCommand, createHdCommand as createRawHdCommand } from "./command.js";
import type { HexdumpCommandsOptions } from "./internal.js";

export type { HexdumpCommandsOptions, HexdumpLimits } from "./internal.js";

export function createHexdumpCommand(options: HexdumpCommandsOptions = {}): CommandDefinition {
  const def = createRawHexdumpCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createHdCommand(options: HexdumpCommandsOptions = {}): CommandDefinition {
  const def = createRawHdCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createHexdumpCommands(options: HexdumpCommandsOptions = {}): readonly CommandDefinition[] {
  return [createHexdumpCommand(options), createHdCommand(options)];
}

export function hexdumpCommands(options: HexdumpCommandsOptions = {}): VirtualShellPlugin {
  const commands = createHexdumpCommands(options);
  return { name: "hexdump-commands", setup(host) {
    if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
