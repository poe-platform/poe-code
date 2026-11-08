import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createBaseCommand } from "safe-bash-base-encoding-engine/base";
import { resolveInputLimit, type ByteInputOptions, type ByteInputLimits } from "safe-bash-byte-input-engine";
export interface Base32CommandsOptions extends ByteInputOptions { readonly replace?: boolean; }
export type Base32Limits = ByteInputLimits;
export function createBase32Command(options: Base32CommandsOptions = {}): CommandDefinition { return createBaseCommand("base32", resolveInputLimit(options)); }
export function createBase32Commands(options: Base32CommandsOptions = {}): readonly CommandDefinition[] { return [createBase32Command(options)]; }
export function base32Commands(options: Base32CommandsOptions = {}): VirtualShellPlugin {
 const commands = createBase32Commands(options);
 return { name: "base32-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
