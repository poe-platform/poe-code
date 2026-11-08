import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createPasteCommand } from "./paste.js";
import type { TableTextCommandsOptions } from "safe-bash-table-text-engine/table-text/internal";
export type PasteCommandsOptions = TableTextCommandsOptions;
export type { TableTextLimits as PasteLimits } from "safe-bash-table-text-engine/table-text/internal";
export { createPasteCommand } from "./paste.js";
export function createPasteCommands(options: PasteCommandsOptions = {}): readonly CommandDefinition[] { return [createPasteCommand(options)]; }
export function pasteCommands(options: PasteCommandsOptions = {}): VirtualShellPlugin {
 const commands = createPasteCommands(options);
 return { name: "paste-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
