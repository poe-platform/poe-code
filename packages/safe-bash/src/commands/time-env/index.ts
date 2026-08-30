import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createPrintenvCommand } from "./printenv.js";
import { createDateCommand } from "./date.js";
import { createSleepCommand } from "./sleep.js";
import { settings, type TimeEnvCommandsOptions } from "./shared.js";
export type { TimeEnvCommandsOptions, TimeEnvLimits, SleepScheduler } from "./shared.js";

export function createTimeEnvCommands(options: TimeEnvCommandsOptions = {}): readonly CommandDefinition[] {
  const configuration = settings(options);
  return [createDateCommand(configuration), createSleepCommand(configuration), createPrintenvCommand(configuration)];
}

export function timeEnvCommands(options: TimeEnvCommandsOptions = {}): VirtualShellPlugin {
  const commands = createTimeEnvCommands(options);
  return { name: "time-env-commands", setup(host) {
    if (!options.replace) for (const definition of commands) {
      if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
    }
    for (const definition of commands) host.commands.register(definition, { replace: options.replace ?? false });
  } };
}
