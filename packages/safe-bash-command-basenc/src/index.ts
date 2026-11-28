import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createBaseCommand } from "safe-bash-base-encoding-engine/base";
import { resolveInputLimit, type ByteInputOptions, type ByteInputLimits } from "safe-bash-byte-input-engine";
export interface BasencCommandsOptions extends ByteInputOptions { readonly replace?: boolean; }
export type BasencLimits = ByteInputLimits;
export function createBasencCommand(options: BasencCommandsOptions = {}): CommandDefinition { return createBaseCommand("basenc", resolveInputLimit(options)); }
export function createBasencCommands(options: BasencCommandsOptions = {}): readonly CommandDefinition[] { return [createBasencCommand(options)]; }
export function basencCommands(options: BasencCommandsOptions = {}): VirtualShellPlugin {
 const commands = createBasencCommands(options);
 return { name: "basenc-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
