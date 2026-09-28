import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createExpandWithSettings } from "./expand.js";
import { settings, type StreamInspectionCommandsOptions } from "safe-bash-text-stream-engine/stream-inspection/shared";
export type ExpandCommandsOptions = StreamInspectionCommandsOptions;
export type { StreamInspectionLimits as ExpandLimits } from "safe-bash-text-stream-engine/stream-inspection/shared";
export function createExpandCommand(options: ExpandCommandsOptions = {}): CommandDefinition { return createExpandWithSettings(settings(options)); }
export function createExpandCommands(options: ExpandCommandsOptions = {}): readonly CommandDefinition[] { return [createExpandCommand(options)]; }
export function expandCommands(options: ExpandCommandsOptions = {}): VirtualShellPlugin {
 const commands = createExpandCommands(options);
 return { name: "expand-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
