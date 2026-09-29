import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createPdftoppmCommand as createRawPdftoppmCommand,
  createPdftocairoCommand as createRawPdftocairoCommand,
  createPdftoppmCommands as createRawPdftoppmCommands,
  runPdftoppmCliSync,
  runPdftocairoCliSync,
  type PdftoppmCommandOptions,
  type PdftoppmCommandsOptions,
} from "safe-bash-command-pdftoppm";

export * from "safe-bash-command-pdftoppm";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function createPdftoppmCommand(options: PdftoppmCommandOptions = {}): CommandDefinition {
  const def = createRawPdftoppmCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createPdftocairoCommand(options: PdftoppmCommandOptions = {}): CommandDefinition {
  const def = createRawPdftocairoCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createPdftoppmCommands(options: PdftoppmCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawPdftoppmCommands(options);
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function pdftoppmCommands(options: PdftoppmCommandsOptions = {}): VirtualShellPlugin {
  const commands = createPdftoppmCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "pdftoppm",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}

export const pdftoppmPlugin = pdftoppmCommands;

export function evalSyncPdftoppm(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    const files = new Map<string, Uint8Array>();
    if (inBytes !== undefined) files.set("-", inBytes);
    const positionals: string[] = [];
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "-v" || a === "--version" || a === "-h" || a === "-help" || a === "--help" || a === "-?") {
        const res = runPdftoppmCliSync(opArgs, files);
        return res.exitCode === 0 && !res.stderr ? res.stdout : undefined;
      }
      if (
        a === "-r" || a === "-rx" || a === "-ry" || a === "-scale-to" || a === "-scale-to-x" ||
        a === "-scale-to-y" || a === "-f" || a === "-l" || a === "-x" || a === "-y" ||
        a === "-W" || a === "-H" || a === "-sz" || a === "-sep" || a === "-setpageno" ||
        a === "-defaultgray" || a === "-defaultrgb" || a === "-defaultcmyk" || a === "-upw" ||
        a === "-opw" || a === "-tiffcompression" || a === "-aa" || a === "-aaVector" ||
        a === "-thinlinemode" || a === "-freetype" || a === "-jpegopt"
      ) {
        i++;
      } else if (!a.startsWith("-") || a === "-") {
        positionals.push(a);
      }
    }
    if (positionals.length > 1 && positionals[1] !== "-") return undefined;
    const input = positionals[0] ?? "-";
    if (input !== "-") {
      const b = readFileSync?.(input);
      if (!b || b.byteLength > 262144) return undefined;
      files.set(input, b);
    } else if (!files.has("-")) {
      return undefined;
    }
    const res = runPdftoppmCliSync(opArgs, files);
    if (res.exitCode !== 0 || res.stderr) return undefined;
    if (res.stdoutBytes) {
      if (res.stdoutBytes.includes(0)) return undefined;
      return utf8Decoder.decode(res.stdoutBytes);
    }
    return res.stdout;
  } catch {
    return undefined;
  }
}

export function evalSyncPdftocairo(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    const files = new Map<string, Uint8Array>();
    if (inBytes !== undefined) files.set("-", inBytes);
    const positionals: string[] = [];
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "-v" || a === "--version" || a === "-h" || a === "-help" || a === "--help" || a === "-?") {
        const res = runPdftocairoCliSync(opArgs, files);
        return res.exitCode === 0 && !res.stderr ? res.stdout : undefined;
      }
      if (
        a === "-r" || a === "-rx" || a === "-ry" || a === "-scale-to" || a === "-scale-to-x" ||
        a === "-scale-to-y" || a === "-f" || a === "-l" || a === "-x" || a === "-y" ||
        a === "-W" || a === "-H" || a === "-sz" || a === "-sep" || a === "-setpageno" ||
        a === "-defaultgray" || a === "-defaultrgb" || a === "-defaultcmyk" || a === "-upw" ||
        a === "-opw" || a === "-tiffcompression" || a === "-aa" || a === "-aaVector" ||
        a === "-thinlinemode" || a === "-freetype" || a === "-jpegopt" ||
        a === "-antialias" || a === "-icc" || a === "-paper" || a === "-paperw" || a === "-paperh"
      ) {
        i++;
      } else if (!a.startsWith("-") || a === "-") {
        positionals.push(a);
      }
    }
    const input = positionals[0] ?? "-";
    const output = positionals[1] ?? (input === "-" ? "-" : "");
    if (output !== "-") return undefined;
    if (input !== "-") {
      const b = readFileSync?.(input);
      if (!b || b.byteLength > 262144) return undefined;
      files.set(input, b);
    } else if (!files.has("-")) {
      return undefined;
    }
    const res = runPdftocairoCliSync(opArgs, files);
    if (res.exitCode !== 0 || res.stderr) return undefined;
    if (res.stdoutBytes) {
      if (res.stdoutBytes.includes(0)) return undefined;
      return utf8Decoder.decode(res.stdoutBytes);
    }
    return res.stdout;
  } catch {
    return undefined;
  }
}
