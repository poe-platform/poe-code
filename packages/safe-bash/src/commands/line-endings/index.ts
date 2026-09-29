import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createDos2unixCommand as createRawDos2unixCommand,
  createUnix2dosCommand as createRawUnix2dosCommand,
  createDos2unixCommands as createRawDos2unixCommands,
  type LineEndingCommandsOptions,
} from "safe-bash-command-dos2unix";

export * from "safe-bash-command-dos2unix";

export function createDos2unixCommand(options: LineEndingCommandsOptions = {}): CommandDefinition {
  const def = createRawDos2unixCommand(options);
  if (options.limits === undefined) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createUnix2dosCommand(options: LineEndingCommandsOptions = {}): CommandDefinition {
  const def = createRawUnix2dosCommand(options);
  if (options.limits === undefined) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createDos2unixCommands(options: LineEndingCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawDos2unixCommands(options);
  if (options.limits === undefined) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export const createLineEndingCommands = createDos2unixCommands;

export function dos2unixCommands(options: LineEndingCommandsOptions = {}): VirtualShellPlugin {
  const commands = createDos2unixCommands(options);
  return {
    name: "dos2unix-commands",
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}

export const lineEndingCommands = dos2unixCommands;

export function evalSyncLineEndings(
  cmdName: "dos2unix" | "unix2dos",
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): Uint8Array | undefined {
  let force = false;
  let toStdout = false;
  let addEol = false;
  let newline = false;
  let endOfOptions = false;
  const files: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (!endOfOptions && a === "--") { endOfOptions = true; continue; }
    if (!endOfOptions && a.startsWith("-")) {
      if (a === "-q" || a === "--quiet") continue;
      if (a === "-f" || a === "--force") { force = true; continue; }
      if (a === "-O" || a === "--to-stdout") { toStdout = true; continue; }
      if (a === "-e" || a === "--add-eol") { addEol = true; continue; }
      if (a === "-l" || a === "--newline") { newline = true; continue; }
      return undefined;
    }
    files.push(a);
  }
  if (files.length > 0 && !toStdout) return undefined;
  const chunks: Uint8Array[] = [];
  if (files.length === 0) {
    if (!inBytes || inBytes.byteLength > 16384) return undefined;
    chunks.push(inBytes);
  } else {
    if (!readFileSync) return undefined;
    for (const f of files) {
      const b = readFileSync(f);
      if (!b || b.byteLength > 16384) return undefined;
      chunks.push(b);
    }
  }
  const out: number[] = [];
  for (const src of chunks) {
    if (src.byteLength >= 2) {
      const b0 = src[0]!, b1 = src[1]!;
      if ((b0 === 0xff && b1 === 0xfe) || (b0 === 0xfe && b1 === 0xff) || (b0 === 0xef && b1 === 0xbb) || (b0 === 0x84 && b1 === 0x31)) {
        return undefined;
      }
    }
    if (!force) {
      for (let i = 0; i < src.byteLength; i++) {
        const c = src[i]!;
        if (c < 32 && c !== 9 && c !== 10 && c !== 12 && c !== 13) return undefined;
      }
    }
    let last = -1;
    if (cmdName === "dos2unix") {
      for (let i = 0; i < src.byteLength; i++) {
        const c = src[i]!;
        if (c === 13 && i + 1 < src.byteLength && src[i + 1] === 10) {
          out.push(10);
          if (newline) out.push(10);
          last = 10;
          i++;
        } else {
          out.push(c);
          last = c;
        }
      }
      if (addEol && last !== -1 && last !== 10) out.push(10);
    } else {
      let prev = 0;
      for (let i = 0; i < src.byteLength; i++) {
        const c = src[i]!;
        if (c === 10 && prev !== 13) {
          out.push(13, 10);
          if (newline) out.push(13, 10);
        } else {
          out.push(c);
          if (newline && c === 10) out.push(13, 10);
        }
        last = c;
        prev = c;
      }
      if (addEol && last !== -1 && last !== 10) out.push(13, 10);
    }
  }
  return new Uint8Array(out);
}
