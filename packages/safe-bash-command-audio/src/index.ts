import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createFfprobeCommand, type FfprobeCommandsOptions } from "safe-bash-command-ffprobe";
import { createSoxCommand, type SoxCommandsOptions } from "safe-bash-command-sox";
import { createSoxiCommand } from "safe-bash-command-soxi";
export * from "safe-bash-command-ffprobe";
export {
  createSoxCommand,
  createSoxCommands,
  soxCommands,
  type SoxCommandsOptions,
  type SoxLimits
} from "safe-bash-command-sox";
export * from "safe-bash-command-soxi";
export interface AudioCommandsOptions {
  readonly replace?: boolean;
  readonly ffprobe?: FfprobeCommandsOptions;
  readonly sox?: SoxCommandsOptions;
}
export function createAudioCommands(
  options: AudioCommandsOptions = {}
): readonly CommandDefinition[] {
  return [
    createFfprobeCommand(options.ffprobe),
    createSoxCommand(options.sox),
    createSoxiCommand(options.sox)
  ];
}
export function audioCommands(options: AudioCommandsOptions = {}): VirtualShellPlugin {
  const commands = createAudioCommands(options);
  return {
    name: "audio-commands",
    setup(host) {
      if (!options.replace)
        for (const command of commands)
          if (host.commands.has(command.name))
            throw new Error(`Command already registered: ${command.name}`);
      for (const command of commands)
        host.commands.register(command, { replace: options.replace ?? false });
    }
  };
}
