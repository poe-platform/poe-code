import { createPagerCommand } from "safe-bash-pager-engine";
import { createMoreCommand } from "safe-bash-command-more";
import type { LessCommandsOptions } from "safe-bash-pager-engine";
import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";

export { settings, evalSyncLess, type LessCommandsOptions, type LessLimits, type PagerCommandsOptions, type PagerLimits, type PagerOptions } from "safe-bash-pager-engine";
export { createMoreCommand } from "safe-bash-command-more";

export function createLessCommand(options: LessCommandsOptions = {}): CommandDefinition {
  return createPagerCommand("less", options);
}

export function createLessCommands(options: LessCommandsOptions = {}): readonly CommandDefinition[] {
  return [createLessCommand(options), createMoreCommand(options)];
}

export const createPagerCommands = createLessCommands;

export function lessCommands(options: LessCommandsOptions = {}): VirtualShellPlugin {
  const commands = createLessCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "less-commands",
    setup(host) {
      if (!replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}

export const pagerCommands = lessCommands;
