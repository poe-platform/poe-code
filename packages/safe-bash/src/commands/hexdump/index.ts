import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createHexdumpCommand, createHdCommand } from "./command.js";
import type { HexdumpCommandsOptions } from "./internal.js";

export { createHexdumpCommand, createHdCommand } from "./command.js";
export type { HexdumpCommandsOptions, HexdumpLimits } from "./internal.js";

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
