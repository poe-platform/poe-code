import type { CommandDefinition, VirtualShellPlugin } from 'safe-bash-contracts';
import { createFdCommandWithMatcher, type FdCommandOptions } from './command.js';
import { createFdMatcher } from './matching.js';
export { createFdCommandWithMatcher, formatFdPath } from './command.js';
export type { FdCommandOptions, FdMatcher, FdMatchingScope, FdLimits } from './command.js';

export function createFdCommand(options: FdCommandOptions = {}): CommandDefinition {
  return createFdCommandWithMatcher(async (context, run) => run(createFdMatcher(context, options)), options);
}
export function createFdCommands(options: FdCommandOptions = {}): readonly CommandDefinition[] {
  return [createFdCommand(options)];
}
export type { FdCommandOptions as FdCommandsOptions, FdCommandOptions as FdOptions } from './command.js';
export function fdCommands(options: FdCommandOptions = {}): VirtualShellPlugin {
  const command = createFdCommand(options);
  return {name: 'fd-commands', setup(host) { host.commands.register(command, {replace: options.replace ?? false}); }};
}
