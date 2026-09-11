import { PublicDiagnostic } from "../diagnostics.js";
import type { CommandDefinition, VirtualShellPlugin } from "../contracts/index.js";
import { grepCommands } from "./grep.js";
import { diagnostic } from "./internal.js";
import { createStandardCommandsWithGrep, type StandardCommandsOptions } from "./standard.js";

export type { StandardCommandsOptions, ExecutionCommandsOptions } from "./standard.js";

export function createStandardCommands(options: StandardCommandsOptions = {}): readonly CommandDefinition[] {
  return createStandardCommandsWithGrep(options, grepCommands({ ...options.regex, ...(options.regexExecutor === undefined ? {} : { regexExecutor: options.regexExecutor }) }));
}

export function standardCommands(options: StandardCommandsOptions = {}): VirtualShellPlugin {
  return {
    name: "standard-commands",
    setup(host) {
      const commands = createStandardCommands({ ...options, execute: options.execute ?? (async context => {
        const command = host.commands.get(context.command);
        if (command) return command.execute(context);
        await diagnostic(context, new PublicDiagnostic("command not found"));
        return { exitCode: 127 };
      }) });
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
