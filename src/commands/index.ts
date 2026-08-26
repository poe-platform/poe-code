import { type CommandDefinition, type CommandHandler, type VirtualShellPlugin } from "../contracts/index.js";
import { basicCommands } from "./basic.js";

export interface StandardCommandsOptions {
  readonly execute?: CommandHandler;
  readonly replace?: boolean;
}

export function createStandardCommands(_options: StandardCommandsOptions = {}): readonly CommandDefinition[] {
  return basicCommands();
}

export function standardCommands(options: StandardCommandsOptions = {}): VirtualShellPlugin {
  return {
    name: "standard-commands",
    setup(host) {
      const commands = createStandardCommands(options);
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
