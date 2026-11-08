import { createPagerCommand, type PagerCommandsOptions, type PagerLimits } from "safe-bash-pager-engine";
import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";

export type MoreCommandsOptions = PagerCommandsOptions;
export type MoreLimits = PagerLimits;

export function createMoreCommand(options: MoreCommandsOptions = {}): CommandDefinition {
  return createPagerCommand("more", options);
}

export function createMoreCommands(options: MoreCommandsOptions = {}): readonly CommandDefinition[] {
  return [createMoreCommand(options)];
}

export function moreCommands(options: MoreCommandsOptions = {}): VirtualShellPlugin {
  const commands = createMoreCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "more-commands",
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
