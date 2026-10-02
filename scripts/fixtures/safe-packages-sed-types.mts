import { createSedCommand, createSedCommands, sedCommands, type SedCommandsOptions, type SedLimits } from '@poe-platform/safe-bash/commands/sed';
import type { CommandDefinition } from '@poe-platform/safe-bash/contracts/command';
import type { VirtualShellPlugin } from '@poe-platform/safe-bash/contracts/plugin';
const limits: SedLimits = { maxProgramInstructions: 100, maxBufferBytes: 1024, maxSteps: 1000 };
const options: SedCommandsOptions = { ...limits, replace: true };
const command: CommandDefinition = createSedCommand(options);
const commands: readonly CommandDefinition[] = createSedCommands(options);
const plugin: VirtualShellPlugin = sedCommands(options);
void [command, commands, plugin];
