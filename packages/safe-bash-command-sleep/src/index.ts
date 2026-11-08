import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createSleepWithSettings } from "./sleep.js";
import { settings, type TimeEnvCommandsOptions } from "safe-bash-calendar-engine/time-env/shared";
export type SleepCommandsOptions = TimeEnvCommandsOptions;
export type { TimeEnvLimits as SleepLimits } from "safe-bash-calendar-engine/time-env/shared";
export function createSleepCommand(options: SleepCommandsOptions = {}): CommandDefinition { return createSleepWithSettings(settings(options)); }
export function createSleepCommands(options: SleepCommandsOptions = {}): readonly CommandDefinition[] { return [createSleepCommand(options)]; }
export function sleepCommands(options: SleepCommandsOptions = {}): VirtualShellPlugin {
 const commands = createSleepCommands(options);
 return { name: "sleep-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
