import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createNlWithSettings } from "./nl.js";
import { settings, type StreamFormatCommandsOptions } from "safe-bash-text-stream-engine/stream-format/shared";
export type NlCommandsOptions = StreamFormatCommandsOptions;
export type { StreamFormatLimits as NlLimits } from "safe-bash-text-stream-engine/stream-format/shared";
export function createNlCommand(options: NlCommandsOptions = {}): CommandDefinition { return createNlWithSettings(settings(options)); }
export function createNlCommands(options: NlCommandsOptions = {}): readonly CommandDefinition[] { return [createNlCommand(options)]; }
export function nlCommands(options: NlCommandsOptions = {}): VirtualShellPlugin {
 const commands = createNlCommands(options);
 return { name: "nl-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
