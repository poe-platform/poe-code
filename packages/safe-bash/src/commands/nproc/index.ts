import {
  createNprocCommand as createRawNprocCommand,
  createNprocCommands as createRawNprocCommands,
  type NprocCommandsOptions,
} from "safe-bash-command-nproc";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";

export * from "safe-bash-command-nproc";

export function createNprocCommand(options: NprocCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawNprocCommand(options), options);
}

export function createNprocCommands(options: NprocCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawNprocCommands(options), options);
}

export function nprocCommands(options: NprocCommandsOptions = {}): VirtualShellPlugin {
  const commands = createNprocCommands(options);
  const replace = (options as { replace?: boolean }).replace ?? false;
  return {
    name: "nproc-commands",
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
