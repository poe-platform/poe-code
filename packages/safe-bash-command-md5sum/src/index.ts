import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { command } from "safe-bash-checksum-engine";
import { resolveInputLimit, type ByteInputOptions, type ByteInputLimits } from "safe-bash-byte-input-engine";
export interface Md5sumCommandsOptions extends ByteInputOptions { readonly replace?: boolean; }
export type Md5sumLimits = ByteInputLimits;
export function createMd5sumCommand(options: Md5sumCommandsOptions = {}): CommandDefinition { return command("md5sum", "md5", resolveInputLimit(options)); }
export function createMd5sumCommands(options: Md5sumCommandsOptions = {}): readonly CommandDefinition[] { return [createMd5sumCommand(options)]; }
export function md5sumCommands(options: Md5sumCommandsOptions = {}): VirtualShellPlugin {
 const commands = createMd5sumCommands(options);
 return { name: "md5sum-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
