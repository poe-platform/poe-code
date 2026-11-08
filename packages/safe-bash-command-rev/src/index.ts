import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createRevWithSettings } from "./rev.js";
import { settings, type StreamFormatCommandsOptions } from "safe-bash-text-stream-engine/stream-format/shared";
export type RevCommandsOptions = StreamFormatCommandsOptions;
export type { StreamFormatLimits as RevLimits } from "safe-bash-text-stream-engine/stream-format/shared";
export function createRevCommand(options: RevCommandsOptions = {}): CommandDefinition { return createRevWithSettings(settings(options)); }
export function createRevCommands(options: RevCommandsOptions = {}): readonly CommandDefinition[] { return [createRevCommand(options)]; }
export function revCommands(options: RevCommandsOptions = {}): VirtualShellPlugin {
 const commands = createRevCommands(options);
 return { name: "rev-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
