import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createFfprobeCommand, type MediaCommandsOptions } from "./media.js";
export { createFfprobeCommand } from "./media.js";
export interface FfprobeLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
}
export type FfprobeCommandsOptions = MediaCommandsOptions;

export function createFfprobeCommands(
  options: FfprobeCommandsOptions = {}
): readonly CommandDefinition[] {
  return [createFfprobeCommand(options)];
}
export function ffprobeCommands(options: FfprobeCommandsOptions = {}): VirtualShellPlugin {
  const command = createFfprobeCommand(options);
  return {
    name: "ffprobe-commands",
    setup(host) {
      host.commands.register(command, { replace: options.replace ?? false });
    }
  };
}
