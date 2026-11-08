import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createUnexpandWithSettings } from "./unexpand.js";
import { settings, type StreamFormatCommandsOptions } from "safe-bash-text-stream-engine/stream-format/shared";
export type UnexpandCommandsOptions = StreamFormatCommandsOptions;
export type { StreamFormatLimits as UnexpandLimits } from "safe-bash-text-stream-engine/stream-format/shared";
export function createUnexpandCommand(options: UnexpandCommandsOptions = {}): CommandDefinition { return createUnexpandWithSettings(settings(options)); }
export function createUnexpandCommands(options: UnexpandCommandsOptions = {}): readonly CommandDefinition[] { return [createUnexpandCommand(options)]; }
export function unexpandCommands(options: UnexpandCommandsOptions = {}): VirtualShellPlugin {
 const commands = createUnexpandCommands(options);
 return { name: "unexpand-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
