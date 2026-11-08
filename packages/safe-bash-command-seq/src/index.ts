import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createSeqWithSettings } from "./seq.js";
import { settings, type StreamFormatCommandsOptions } from "safe-bash-text-stream-engine/stream-format/shared";
export type SeqCommandsOptions = StreamFormatCommandsOptions;
export type { StreamFormatLimits as SeqLimits } from "safe-bash-text-stream-engine/stream-format/shared";
export function createSeqCommand(options: SeqCommandsOptions = {}): CommandDefinition { return createSeqWithSettings(settings(options)); }
export function createSeqCommands(options: SeqCommandsOptions = {}): readonly CommandDefinition[] { return [createSeqCommand(options)]; }
export function seqCommands(options: SeqCommandsOptions = {}): VirtualShellPlugin {
 const commands = createSeqCommands(options);
 return { name: "seq-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
