import type { CommandDefinition,VirtualShellPlugin } from "safe-bash-contracts";
import type { TextProgramOptions } from "safe-bash-io-engine/commands/text-programs/shared";
import { sedCommand as createSedCommand } from "./sed.js";
export type { TextProgramOptions as SedCommandsOptions,TextProgramOptions } from "safe-bash-io-engine/commands/text-programs/shared";
export { sedCommand as createSedCommand,sedCommand } from "./sed.js";
export type SedLimits = Omit<TextProgramOptions, "replace" | "regexExecutor" | "regex">;

export function createSedCommands(options: TextProgramOptions = {}): readonly CommandDefinition[] { return [createSedCommand(options)]; }
export function sedCommands(options: TextProgramOptions = {}): VirtualShellPlugin {
  const commands = createSedCommands(options);
  return { name: "sed-commands", setup(host) {
    if (!options.replace) for (const command of commands) {
      if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    }
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
