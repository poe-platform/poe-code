import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createTacWithSettings } from "./tac.js";
import { settings, type StreamInspectionCommandsOptions } from "safe-bash-text-stream-engine/stream-inspection/shared";
export type TacCommandsOptions = StreamInspectionCommandsOptions;
export type { StreamInspectionLimits as TacLimits } from "safe-bash-text-stream-engine/stream-inspection/shared";
export function createTacCommand(options: TacCommandsOptions = {}): CommandDefinition { return createTacWithSettings(settings(options)); }
export function createTacCommands(options: TacCommandsOptions = {}): readonly CommandDefinition[] { return [createTacCommand(options)]; }
export function tacCommands(options: TacCommandsOptions = {}): VirtualShellPlugin {
 const commands = createTacCommands(options);
 return { name: "tac-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
