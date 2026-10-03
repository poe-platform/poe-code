import { registerDefaultExecutor, registerDefaultExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createFfmpegCommand as createRawFfmpegCommand,
  createFfprobeCommand as createRawFfprobeCommand,
  createFfmpegCommands as createRawFfmpegCommands,
  evalSyncFfmpeg,
  evalSyncFfprobe,
  type FfmpegCommandPair,
  type FfmpegCommandsOptions,
} from "safe-bash-command-ffmpeg";

export * from "safe-bash-command-ffmpeg";
export { evalSyncFfmpeg, evalSyncFfprobe };

export function createFfmpegCommand(options: FfmpegCommandsOptions = {}): CommandDefinition {
  syncCommandEvaluators.evalSyncFfmpeg = evalSyncFfmpeg;
  syncCommandEvaluators.evalSyncFfprobe = evalSyncFfprobe;
  const def = createRawFfmpegCommand(options);
  return registerDefaultExecutor(def, options);
}

export function createFfprobeCommand(options: FfmpegCommandsOptions = {}): CommandDefinition {
  syncCommandEvaluators.evalSyncFfmpeg = evalSyncFfmpeg;
  syncCommandEvaluators.evalSyncFfprobe = evalSyncFfprobe;
  const def = createRawFfprobeCommand(options);
  return registerDefaultExecutor(def, options);
}

export function createFfmpegCommands(options: FfmpegCommandsOptions = {}): FfmpegCommandPair {
  syncCommandEvaluators.evalSyncFfmpeg = evalSyncFfmpeg;
  syncCommandEvaluators.evalSyncFfprobe = evalSyncFfprobe;
  const pair = createRawFfmpegCommands(options);
  return registerDefaultExecutors(pair, options);
}

export function ffmpegCommands(options: FfmpegCommandsOptions = {}): VirtualShellPlugin {
  const definitions = createFfmpegCommands(options);
  return {
    name: "ffmpeg-commands",
    setup(host) {
      if (!options.replace) {
        for (const definition of definitions) {
          if (host.commands.has(definition.name)) {
            throw new Error(`Command already registered: ${definition.name}`);
          }
        }
      }
      for (const definition of definitions) {
        host.commands.register(definition, { replace: options.replace ?? false });
      }
    },
  };
}
