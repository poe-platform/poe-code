import {
  createIdCommand as createRawIdCommand,
  createIdCommands as createRawIdCommands,
  type IdCommandsOptions,
} from "safe-bash-command-id";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";

export * from "safe-bash-command-id";

export function createIdCommand(options: IdCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawIdCommand(options), options);
}

export function createIdCommands(options: IdCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawIdCommands(options), options);
}

export function idCommands(options: IdCommandsOptions = {}): VirtualShellPlugin {
  const commands = createIdCommands(options);
  const replace = (options as { replace?: boolean }).replace ?? false;
  return {
    name: "id-commands",
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
