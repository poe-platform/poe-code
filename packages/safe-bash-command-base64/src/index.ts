import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createBaseCommand } from "safe-bash-base-encoding-engine/base";
import { resolveInputLimit, type ByteInputOptions, type ByteInputLimits } from "safe-bash-byte-input-engine";
export interface Base64CommandsOptions extends ByteInputOptions { readonly replace?: boolean; }
export type Base64Limits = ByteInputLimits;
export function createBase64Command(options: Base64CommandsOptions = {}): CommandDefinition { return createBaseCommand("base64", resolveInputLimit(options)); }
export function createBase64Commands(options: Base64CommandsOptions = {}): readonly CommandDefinition[] { return [createBase64Command(options)]; }
export function base64Commands(options: Base64CommandsOptions = {}): VirtualShellPlugin {
 const commands = createBase64Commands(options);
 return { name: "base64-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
