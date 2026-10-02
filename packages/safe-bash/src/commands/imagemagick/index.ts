import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createImagemagickCommands as createRawImagemagickCommands,
  runIdentifyCliSync,
  runConvertCliSync,
  runMogrifyCliSync,
  runCompositeCliSync,
  runMontageCliSync,
  runCompareCliSync,
  runMagickCliSync,
  type ImageMagickCommandOptions,
  type ImagemagickCommandsOptions,
} from "safe-bash-command-imagemagick";

export * from "safe-bash-command-imagemagick";
export type ImagemagickCommandOptions = ImageMagickCommandOptions;

export function createImagemagickCommands(options: ImagemagickCommandsOptions = {}): readonly CommandDefinition[] {
  syncCommandEvaluators.evalSyncIdentify = evalSyncIdentify;
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

const KNOWN_PREFIX_FORMATS = new Set([
  "png", "png8", "png24", "png32", "jpg", "jpeg", "gif", "bmp", "bmp2", "bmp3",
  "webp", "tiff", "tif", "ppm", "pgm", "pbm", "pnm", "pam", "svg", "ico", "cur",
  "tga", "hdr", "exr", "avif", "heic", "txt", "info", "json", "null", "histogram"
]);

export function evalSyncIdentify(
  cmdName: string,
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  try {
    if (opArgs[0] === "-version" || opArgs[0] === "--version") {
      return runIdentifyCliSync(opArgs, new Map()).stdout;
    }
    const vfsFiles = new Map<string, Uint8Array>();
    if (inBytes !== undefined) vfsFiles.set("-", inBytes);
    for (let i = 0; i < opArgs.length; i++) {
      const token = opArgs[i]!;
      if (token === "-" || token.endsWith(":-")) continue;
      if (token.startsWith("-") || token.startsWith("+") || token === "(" || token === ")") continue;
      let candidate = token.toLowerCase().startsWith("tile:") ? token.slice(5) : token;
      const prefixMatch = /^([a-zA-Z0-9]+):(.*)$/.exec(candidate);
      if (prefixMatch && KNOWN_PREFIX_FORMATS.has(prefixMatch[1]!.toLowerCase())) {
        candidate = prefixMatch[2]!;
      }
      const bracketMatch = /^(.*)\[([^\]]+)\]$/.exec(candidate);
      if (bracketMatch) {
        candidate = bracketMatch[1]!;
      }
      if (!candidate) continue;
      const b = readFileSync?.(candidate);
      if (b) {
        if (b.byteLength > 262144) return undefined;
        vfsFiles.set(candidate, b);
      }
    }
    const existingSnap = new Map(vfsFiles);
    const res =
      cmdName === "identify"
        ? runIdentifyCliSync(opArgs, vfsFiles, inBytes)
        : cmdName === "magick"
          ? runMagickCliSync(opArgs, vfsFiles, inBytes)
          : cmdName === "convert"
            ? runConvertCliSync(opArgs, vfsFiles, inBytes)
            : cmdName === "mogrify"
              ? runMogrifyCliSync(opArgs, vfsFiles)
              : cmdName === "composite"
                ? runCompositeCliSync(opArgs, vfsFiles, inBytes)
                : cmdName === "montage"
                  ? runMontageCliSync(opArgs, vfsFiles, inBytes)
                  : cmdName === "compare"
                    ? runCompareCliSync(opArgs, vfsFiles, inBytes)
                    : undefined;
    if (!res || res.exitCode !== 0 || res.stderr) return undefined;
    let hasWrites = false;
    for (const [key, val] of vfsFiles.entries()) {
      if (existingSnap.get(key) !== val) {
        if (!key || key === "-" || key.endsWith("/") || key.endsWith("/.") || key.includes("/./") || /(?:^|\/)\.\.(?:\/|$)/u.test(key)) return undefined;
        hasWrites = true;
      }
    }
    if (hasWrites && !writeFileSync) return undefined;
    let outText = res.stdout;
    if (res.stdoutBytes) {
      if (res.stdoutBytes.includes(0)) return undefined;
      try {
        outText = new TextDecoder("utf-8", { fatal: true }).decode(res.stdoutBytes);
      } catch {
        return undefined;
      }
    }
    if (outText.includes("\0")) return undefined;
    if (hasWrites && writeFileSync) {
      for (const [key, val] of vfsFiles.entries()) {
        if (existingSnap.get(key) !== val) {
          if (key === "-") return undefined;
          if (!writeFileSync(key, val)) return undefined;
        }
      }
    }
    return outText;
  } catch {
    return undefined;
  }
}
