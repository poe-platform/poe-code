import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createGrepCommand, type GrepCommandsOptions, type GrepLimits } from "safe-bash-command-grep/index";
import { alias } from "safe-bash-command-grep/aliases";
export type RgrepCommandsOptions = GrepCommandsOptions;
export type RgrepLimits = GrepLimits;

export function createRgrepCommand(options: RgrepCommandsOptions = {}): CommandDefinition {
  return alias("rgrep", createGrepCommand(options));
}

export function createRgrepCommands(options: RgrepCommandsOptions = {}): readonly CommandDefinition[] {
  return [createRgrepCommand(options)];
}

export function rgrepCommands(options: RgrepCommandsOptions = {}): VirtualShellPlugin {
  const commands = createRgrepCommands(options);
  return {
    name: "rgrep-commands",
    setup(host) {
      if (!options.replace) for (const command of commands) {
        if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
