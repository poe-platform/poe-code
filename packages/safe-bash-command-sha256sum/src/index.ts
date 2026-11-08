import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { command } from "safe-bash-checksum-engine";
import { resolveInputLimit, type ByteInputOptions, type ByteInputLimits } from "safe-bash-byte-input-engine";
export interface Sha256sumCommandsOptions extends ByteInputOptions { readonly replace?: boolean; }
export type Sha256sumLimits = ByteInputLimits;
export function createSha256sumCommand(options: Sha256sumCommandsOptions = {}): CommandDefinition { return command("sha256sum", "sha256", resolveInputLimit(options)); }
export function createSha256sumCommands(options: Sha256sumCommandsOptions = {}): readonly CommandDefinition[] { return [createSha256sumCommand(options)]; }
export function sha256sumCommands(options: Sha256sumCommandsOptions = {}): VirtualShellPlugin {
 const commands = createSha256sumCommands(options);
 return { name: "sha256sum-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
