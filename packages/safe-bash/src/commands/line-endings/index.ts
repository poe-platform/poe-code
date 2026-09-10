import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createDos2unixCommand, createUnix2dosCommand } from "./command.js";
import type { LineEndingCommandsOptions } from "./internal.js";
export { createDos2unixCommand, createUnix2dosCommand } from "./command.js";
export type { LineEndingCommandsOptions, LineEndingLimits } from "./internal.js";
export function createLineEndingCommands(options: LineEndingCommandsOptions = {}): readonly CommandDefinition[] { return [createDos2unixCommand(options), createUnix2dosCommand(options)]; }
export function lineEndingCommands(options: LineEndingCommandsOptions = {}): VirtualShellPlugin {
  const commands = createLineEndingCommands(options);
  return { name: "line-ending-commands", setup(host) { for (const command of commands) host.commands.register(command, { replace: options.replace ?? false }); } };
}
