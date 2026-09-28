import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createDateWithSettings } from "./date.js";
import { settings, type TimeEnvCommandsOptions } from "safe-bash-calendar-engine/time-env/shared";
export type DateCommandsOptions = TimeEnvCommandsOptions;
export type { TimeEnvLimits as DateLimits } from "safe-bash-calendar-engine/time-env/shared";
export function createDateCommand(options: DateCommandsOptions = {}): CommandDefinition { return createDateWithSettings(settings(options)); }
export function createDateCommands(options: DateCommandsOptions = {}): readonly CommandDefinition[] { return [createDateCommand(options)]; }
export function dateCommands(options: DateCommandsOptions = {}): VirtualShellPlugin {
 const commands = createDateCommands(options);
 return { name: "date-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
