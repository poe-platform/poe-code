import { type CommandDefinition, type VirtualShellPlugin } from "virtual-bash";
import { createTimeEnvCommands, timeEnvCommands, type SleepScheduler,
  type TimeEnvCommandsOptions } from "./node_modules/virtual-bash/dist/commands/time-env/index.js";

const scheduler: SleepScheduler = { now: () => 0, setTimeout: () => 1, clearTimeout: () => {} };
const options: TimeEnvCommandsOptions = { clock: () => 1704164645123, scheduler,
  defaultTimeZone: "UTC", maxTimerMilliseconds: 50, limits: { maxFormatWidth: 32, maxOutputBytes: 64 } };
const commands: readonly CommandDefinition[] = createTimeEnvCommands(options);
const plugin: VirtualShellPlugin = timeEnvCommands(options);
void commands;
void plugin;
