import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createImagemagickCommands as createRawImagemagickCommands,
  runIdentifyCliSync,
  type ImagemagickCommandOptions,
  type ImagemagickCommandsOptions,
} from "safe-bash-command-imagemagick";

export * from "safe-bash-command-imagemagick";

export function createImagemagickCommands(options: ImagemagickCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawImagemagickCommands(options);
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function imagemagickPlugin(options: ImagemagickCommandOptions = {}): VirtualShellPlugin {
  const commands = createImagemagickCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "imagemagick",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}

export const imagemagickCommands = imagemagickPlugin;

export function evalSyncIdentify(
  cmdName: string,
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    let args = opArgs;
    if (cmdName === "magick") {
      if (opArgs[0] === "-version" || opArgs[0] === "--version") {
        return runIdentifyCliSync(opArgs, new Map()).stdout;
      }
      if (opArgs[0] !== "identify") return undefined;
      args = opArgs.slice(1);
    } else if (cmdName === "convert") {
      if (opArgs[0] === "-version" || opArgs[0] === "--version") {
        return runIdentifyCliSync(opArgs, new Map()).stdout;
      }
      return undefined;
    }
    const files = new Map<string, Uint8Array>();
    if (inBytes !== undefined) files.set("-", inBytes);
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === "-format") {
        i++;
      } else if (!a.startsWith("-") && a !== "-") {
        const b = readFileSync?.(a);
        if (b) {
          if (b.byteLength > 262144) return undefined;
          files.set(a, b);
        }
      }
    }
    const res = runIdentifyCliSync(args, files, inBytes);
    if (res.exitCode !== 0 || res.stderr) return undefined;
    return res.stdout;
  } catch {
    return undefined;
  }
}
