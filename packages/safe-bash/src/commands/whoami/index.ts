import {
  createWhoamiCommand as createRawWhoamiCommand,
  createWhoamiCommands as createRawWhoamiCommands,
  type WhoamiCommandsOptions,
} from "safe-bash-command-whoami";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";

export * from "safe-bash-command-whoami";

export function createWhoamiCommand(options: WhoamiCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawWhoamiCommand(options), options);
}

export function createWhoamiCommands(options: WhoamiCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawWhoamiCommands(options), options);
}

export function whoamiCommands(options: WhoamiCommandsOptions = {}): VirtualShellPlugin {
  const commands = createWhoamiCommands(options);
  const replace = (options as { replace?: boolean }).replace ?? false;
  return {
    name: "whoami-commands",
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
