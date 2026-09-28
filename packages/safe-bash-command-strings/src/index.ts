import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createStringsWithSettings } from "./strings.js";
import { settings, type StreamInspectionCommandsOptions } from "safe-bash-text-stream-engine/stream-inspection/shared";
export type StringsCommandsOptions = StreamInspectionCommandsOptions;
export type { StreamInspectionLimits as StringsLimits } from "safe-bash-text-stream-engine/stream-inspection/shared";
export function createStringsCommand(options: StringsCommandsOptions = {}): CommandDefinition { return createStringsWithSettings(settings(options)); }
export function createStringsCommands(options: StringsCommandsOptions = {}): readonly CommandDefinition[] { return [createStringsCommand(options)]; }
export function stringsCommands(options: StringsCommandsOptions = {}): VirtualShellPlugin {
 const commands = createStringsCommands(options);
 return { name: "strings-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
