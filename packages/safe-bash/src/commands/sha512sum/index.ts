import {
  createSha512sumCommand as createRawSha512sumCommand,
  createSha512sumCommands as createRawSha512sumCommands,
  type Sha512sumCommandsOptions,
} from "safe-bash-command-sha512sum";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";

export * from "safe-bash-command-sha512sum";

export function createSha512sumCommand(options: Sha512sumCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawSha512sumCommand(options), options);
}

export function createSha512sumCommands(options: Sha512sumCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawSha512sumCommands(options), options);
}

export function sha512sumCommands(options: Sha512sumCommandsOptions = {}): VirtualShellPlugin {
  const commands = createSha512sumCommands(options);
  const replace = (options as { replace?: boolean }).replace ?? false;
  return {
    name: "sha512sum-commands",
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
