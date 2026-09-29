import {
  createOdCommand as createRawOdCommand,
  createOdCommands as createRawOdCommands,
  type OdCommandsOptions,
} from "safe-bash-command-od";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";

export * from "safe-bash-command-od";

export function createOdCommand(options: number | OdCommandsOptions = {}): CommandDefinition {
  const commandOptions = typeof options === "number" ? { maxInputBytes: options } : options;
  return registerDefaultExecutor(createRawOdCommand(commandOptions), commandOptions);
}

export function createOdCommands(options: OdCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawOdCommands(options), options);
}

export function odCommands(options: OdCommandsOptions = {}): VirtualShellPlugin {
  const commands = createOdCommands(options);
  const replace = (options as { replace?: boolean }).replace ?? false;
  return {
    name: "od-commands",
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
