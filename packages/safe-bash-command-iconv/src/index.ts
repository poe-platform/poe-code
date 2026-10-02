import { builtInDirectContextExecutors } from "safe-bash-io-engine/internal";
import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createIconvCommand as createRawIconvCommand } from "./command.js";
import type { IconvCommandsOptions } from "./internal.js";

export type { IconvCommandsOptions, IconvLimits } from "./internal.js";

export function createIconvCommand(options: IconvCommandsOptions = {}): CommandDefinition {
  const def = createRawIconvCommand(options);
  if (options.limits === undefined) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createIconvCommands(options: IconvCommandsOptions = {}): readonly CommandDefinition[] {
  return [createIconvCommand(options)];
}

export function iconvCommands(options: IconvCommandsOptions = {}): VirtualShellPlugin {
  const commands = createIconvCommands(options);
  return { name: "iconv-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}

type SyncIconvEncoding = "ascii" | "latin1" | "utf8";
const SYNC_ICONV_ALIASES: Record<string, SyncIconvEncoding> = {
  ASCII: "ascii", "US-ASCII": "ascii", "ANSI_X3.4-1968": "ascii",
  LATIN1: "latin1", "LATIN-1": "latin1", "ISO-8859-1": "latin1", "ISO8859-1": "latin1",
  UTF8: "utf8", "UTF-8": "utf8",
};

export function evalSyncIconv(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): Uint8Array | undefined {
  let fromRaw: string | undefined;
  let toRaw: string | undefined;
  let outputFile: string | undefined;
  let discard = false;
  let ended = false;
  const files: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (ended || a === "-" || !a.startsWith("-")) { files.push(a); continue; }
    if (a === "--") { ended = true; continue; }
    if (a === "--silent" || a === "-s") continue;
    if (a === "-c") { discard = true; continue; }
    if (a === "-sc" || a === "-cs") { discard = true; continue; }
    if (a.startsWith("--from-code=")) { fromRaw = a.slice(12); continue; }
    if (a === "--from-code" || a === "-f") { fromRaw = opArgs[++i]; if (!fromRaw) return undefined; continue; }
    if (a.startsWith("-f") && a.length > 2) { fromRaw = a.slice(2); continue; }
    if (a.startsWith("--to-code=")) { toRaw = a.slice(10); continue; }
    if (a === "--to-code" || a === "-t") { toRaw = opArgs[++i]; if (!toRaw) return undefined; continue; }
    if (a.startsWith("-t") && a.length > 2) { toRaw = a.slice(2); continue; }
    if (a.startsWith("--output=")) { outputFile = a.slice(9); if (!outputFile) return undefined; continue; }
    if (a === "--output" || a === "-o") { outputFile = opArgs[++i]; if (!outputFile) return undefined; continue; }
    if (a.startsWith("-o") && a.length > 2) { outputFile = a.slice(2); continue; }
    return undefined;
  }
  if (!fromRaw || !toRaw) return undefined;
  if (outputFile === "-") outputFile = undefined;
  if (outputFile !== undefined) {
    const normOut = outputFile.replace(/^\.\/+/u, "").replace(/\/+$/u, "");
    for (const f of files) {
      if (f !== "-" && f.replace(/^\.\/+/u, "").replace(/\/+$/u, "") === normOut) {
        return undefined;
      }
    }
  }
  if (fromRaw.includes("//")) return undefined;
  const toParts = toRaw.split("//");
  for (let i = 1; i < toParts.length; i++) {
    if (toParts[i]!.toUpperCase() === "IGNORE") discard = true;
    else return undefined;
  }
  const fromEnc = SYNC_ICONV_ALIASES[fromRaw.toUpperCase()];
  const toEnc = SYNC_ICONV_ALIASES[toParts[0]!.toUpperCase()];
  if (!fromEnc || !toEnc) return undefined;

  let src = inBytes;
  if (files.length === 1 && files[0] !== "-") {
    if (!readFileSync) return undefined;
    const fBytes = readFileSync(files[0]!);
    if (!fBytes || fBytes.byteLength > 16384) return undefined;
    src = fBytes;
  } else if (files.length > 1) {
    if (!readFileSync) return undefined;
    const parts: Uint8Array[] = [];
    let totalLen = 0;
    let stdinUsed = false;
    for (const f of files) {
      let chunk: Uint8Array | undefined;
      if (f === "-") {
        if (stdinUsed || !inBytes) return undefined;
        stdinUsed = true;
        chunk = inBytes;
      } else {
        chunk = readFileSync(f);
      }
      if (!chunk || totalLen + chunk.byteLength > 16384) return undefined;
      parts.push(chunk);
      totalLen += chunk.byteLength;
    }
    const merged = new Uint8Array(totalLen);
    let pos = 0;
    for (const p of parts) { merged.set(p, pos); pos += p.byteLength; }
    src = merged;
  }
  if (!src || src.byteLength > 16384) return undefined;

  const out: number[] = [];
  let offset = 0;
  while (offset < src.byteLength) {
    const first = src[offset]!;
    let cp = -1;
    let count = 1;
    if (fromEnc === "ascii") {
      if (first < 128) cp = first;
    } else if (fromEnc === "latin1") {
      cp = first;
    } else {
      if (first < 128) {
        cp = first;
      } else if (first >= 0xc2 && first < 0xe0 && offset + 1 < src.byteLength) {
        const b1 = src[offset + 1]!;
        if ((b1 & 0xc0) === 0x80) { cp = ((first & 0x1f) << 6) | (b1 & 0x3f); count = 2; }
      } else if (first >= 0xe0 && first < 0xf0 && offset + 2 < src.byteLength) {
        const b1 = src[offset + 1]!, b2 = src[offset + 2]!;
        if ((b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80) {
          const val = ((first & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
          if (val >= 0x800 && (val < 0xd800 || val > 0xdfff)) { cp = val; count = 3; }
        }
      } else if (first >= 0xf0 && first < 0xf5 && offset + 3 < src.byteLength) {
        const b1 = src[offset + 1]!, b2 = src[offset + 2]!, b3 = src[offset + 3]!;
        if ((b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80 && (b3 & 0xc0) === 0x80) {
          const val = ((first & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
          if (val >= 0x10000 && val <= 0x10ffff) { cp = val; count = 4; }
        }
      }
    }
    if (cp === -1) {
      if (!discard) return undefined;
      offset += count;
      continue;
    }
    if (toEnc === "ascii") {
      if (cp >= 128) {
        if (!discard) return undefined;
      } else {
        out.push(cp);
      }
    } else if (toEnc === "latin1") {
      if (cp >= 256) {
        if (!discard) return undefined;
      } else {
        out.push(cp);
      }
    } else {
      if (cp < 128) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
    offset += count;
  }
  const outArr = new Uint8Array(out);
  if (outputFile !== undefined) {
    if (!writeFileSync || outputFile.endsWith("/") || /(?:^|\/)\.\.(?:\/|$)/.test(outputFile) || !writeFileSync(outputFile, outArr)) return undefined;
    return new Uint8Array(0);
  }
  // Text-only shortcuts cannot retain binary ShellValue provenance.
  if (out.some(byte => byte === 0 || byte >= 128)) return undefined;
  return outArr;
}

import { syncCommandEvaluators } from "safe-bash-contracts/runtime-control";
syncCommandEvaluators.evalSyncIconv = evalSyncIconv;
