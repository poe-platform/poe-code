import {
  createDdCommand as createRawDdCommand,
  createDdCommands as createRawDdCommands,
  type DdCommandsOptions,
} from "safe-bash-command-dd";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";

export * from "safe-bash-command-dd";

export function createDdCommand(options: DdCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawDdCommand(options), options);
}

export function createDdCommands(options: DdCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawDdCommands(options), options);
}

export function ddCommands(options: DdCommandsOptions = {}): VirtualShellPlugin {
  const command = createDdCommand(options);
  return {
    name: "dd-commands",
    setup(host) {
      host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
