import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { command } from "safe-bash-checksum-engine";
import { resolveInputLimit, type ByteInputOptions, type ByteInputLimits } from "safe-bash-byte-input-engine";
export interface Sha1sumCommandsOptions extends ByteInputOptions { readonly replace?: boolean; }
export type Sha1sumLimits = ByteInputLimits;
export function createSha1sumCommand(options: Sha1sumCommandsOptions = {}): CommandDefinition { return command("sha1sum", "sha1", resolveInputLimit(options)); }
export function createSha1sumCommands(options: Sha1sumCommandsOptions = {}): readonly CommandDefinition[] { return [createSha1sumCommand(options)]; }
export function sha1sumCommands(options: Sha1sumCommandsOptions = {}): VirtualShellPlugin {
 const commands = createSha1sumCommands(options);
 return { name: "sha1sum-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
