import type { CommandDefinition,VirtualShellPlugin } from "safe-bash-contracts";
import type { TextProgramOptions } from "safe-bash-io-engine/commands/text-programs/shared";
import { awkCommand as createAwkCommand } from "./awk.js";
export type { TextProgramOptions as AwkCommandsOptions,TextProgramOptions } from "safe-bash-io-engine/commands/text-programs/shared";
export { awkCommand,awkCommand as createAwkCommand } from "./awk.js";
export type AwkLimits = Omit<TextProgramOptions, "replace" | "regexExecutor" | "regex">;

export function createAwkCommands(options: TextProgramOptions = {}): readonly CommandDefinition[] { return [createAwkCommand(options)]; }
export function awkCommands(options: TextProgramOptions = {}): VirtualShellPlugin {
  const commands = createAwkCommands(options);
  return { name: "awk-commands", setup(host) {
    if (!options.replace) for (const command of commands) {
      if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    }
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
