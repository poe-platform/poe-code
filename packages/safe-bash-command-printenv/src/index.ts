import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createPrintenvWithSettings } from "./printenv.js";
import { settings, type TimeEnvCommandsOptions } from "safe-bash-calendar-engine/time-env/shared";
export type PrintenvCommandsOptions = TimeEnvCommandsOptions;
export type { TimeEnvLimits as PrintenvLimits } from "safe-bash-calendar-engine/time-env/shared";
export function createPrintenvCommand(options: PrintenvCommandsOptions = {}): CommandDefinition { return createPrintenvWithSettings(settings(options)); }
export function createPrintenvCommands(options: PrintenvCommandsOptions = {}): readonly CommandDefinition[] { return [createPrintenvCommand(options)]; }
export function printenvCommands(options: PrintenvCommandsOptions = {}): VirtualShellPlugin {
 const commands = createPrintenvCommands(options);
 return { name: "printenv-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
