import {
  createHostnameCommand as createRawHostnameCommand,
  createHostnameCommands as createRawHostnameCommands,
  type HostnameCommandsOptions,
} from "safe-bash-command-hostname";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";

export * from "safe-bash-command-hostname";

export function createHostnameCommand(options: HostnameCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawHostnameCommand(options), options);
}

export function createHostnameCommands(options: HostnameCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawHostnameCommands(options), options);
}

export function hostnameCommands(options: HostnameCommandsOptions = {}): VirtualShellPlugin {
  const commands = createHostnameCommands(options);
  const replace = (options as { replace?: boolean }).replace ?? false;
  return {
    name: "hostname-commands",
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
