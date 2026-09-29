import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
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
  const def = createRawFfmpegCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createFfprobeCommand(options: FfmpegCommandsOptions = {}): CommandDefinition {
  const def = createRawFfprobeCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createFfmpegCommands(options: FfmpegCommandsOptions = {}): FfmpegCommandPair {
  const pair = createRawFfmpegCommands(options);
  for (let i = 0; i < pair.length; i++) builtInDirectContextExecutors.add(pair[i]!.execute);
  return pair;
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

syncCommandEvaluators.evalSyncFfmpeg = evalSyncFfmpeg;
syncCommandEvaluators.evalSyncFfprobe = evalSyncFfprobe;
