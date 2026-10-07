import { Pattern } from "safe-bash-regex-engine";
import { Budget } from "safe-bash-regex-engine/text/budget";
import { FsError } from "safe-bash-contracts";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { yieldTurn } from "safe-bash-contracts/yield";

import { posixPath as pathPosix } from "safe-bash-contracts/path";

import {
  commandRuntimeIdentity,
  getCommandArguments,
  readBytes,
  writeBytes,
  writeText,
  type ByteSource,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
} from "safe-bash-contracts";

export interface LessLimits {
  readonly maxInputBytes: number;
}

export interface LessCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<LessLimits>;
  readonly maxInputBytes?: number;
}

export type PagerLimits = LessLimits;
export type PagerCommandsOptions = LessCommandsOptions;
export type PagerOptions = LessCommandsOptions;

export function settings(options: LessCommandsOptions = {}): LessLimits {
  const limits: LessLimits = {
    maxInputBytes: options.limits?.maxInputBytes ?? options.maxInputBytes ?? Infinity,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) throw new RangeError(`Invalid less limit: ${name}`);
  }
  return Object.freeze(limits);
}

async function readSourceText(source: ByteSource, signal: AbortSignal, admit: (bytes: number) => void): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let quantum = 0;
  let chunksRead = 0;
  for await (const chunk of readBytes(source, signal)) {
    total += chunk.byteLength;
    admit(chunk.byteLength);
    signal.throwIfAborted();
    quantum += Math.max(1, chunk.byteLength);
    if (quantum >= 16384 || ++chunksRead >= 128) { quantum = 0; chunksRead = 0; await yieldTurn(signal); }
    chunks.push(chunk);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(merged);
}

export function createPagerCommand(name: "less" | "more", options: LessCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return {
    name,
    description: `Non-interactive ${name} pager pass-through`,
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      let inputBytes = 0;
      const admit = (bytes: number): void => {
        context.signal.throwIfAborted();
        inputBytes += bytes;
        context.inputBudget?.check(inputBytes);
        if (inputBytes > maxBytes) throw new PublicDiagnostic(`input exceeds maximum size of ${maxBytes} bytes`);
      };
      const maxBytes = Math.min(limits.maxInputBytes, (context as { limits?: { maxInputBytes?: number } }).limits?.maxInputBytes ?? limits.maxInputBytes);
      context.signal.throwIfAborted();
      const args = getCommandArguments(context).args;
      let lineNumbers = false;
      let squeezeBlank = false;
      let ignoreCase = false;
      let startLine = 1;
      let startSearch: string | undefined;
      const files: string[] = [];
      let endOfOptions = false;

      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (!endOfOptions && arg === "--") {
          endOfOptions = true;
          continue;
        }
        if (!endOfOptions && (arg === "--help" || arg === "-?")) {
          await writeText(context.stdout, `Usage: ${name} [-Ns] [+LINE] [+/PATTERN] [FILE...]\n`);
          return { exitCode: 0 };
        }
        if (!endOfOptions && (arg === "--version" || arg === "-V")) {
          await writeText(context.stdout, `${name} (virtual-bash)\n`);
          return { exitCode: 0 };
        }
        if (!endOfOptions && arg.startsWith("+")) {
          const rest = arg.slice(1);
          if (rest.startsWith("/")) {
            startSearch = rest.slice(1);
          } else if (/^\d+$/.test(rest)) {
            startLine = Math.max(1, Number.parseInt(rest, 10));
          }
          continue;
        }
        if (!endOfOptions && arg.startsWith("--")) {
          if (arg === "--LINE-NUMBERS" || arg === "--line-numbers") lineNumbers = true;
          else if (arg === "--squeeze-blank-lines") squeezeBlank = true;
          else if (arg === "--ignore-case" || arg === "--IGNORE-CASE") ignoreCase = true;
          else if (arg === "--pattern" || arg.startsWith("--pattern=")) startSearch = arg === "--pattern" ? (args[++i] ?? "") : arg.slice(10);
          continue;
        }
        if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) {
            const ch = arg[j]!;
            if (ch === "N") lineNumbers = true;
            else if (ch === "n") lineNumbers = false;
            else if (ch === "s") squeezeBlank = true;
            else if (ch === "i" || ch === "I") ignoreCase = true;
            else if (ch === "p") {
              startSearch = j < arg.length - 1 ? arg.slice(j + 1) : (args[++i] ?? "");
              break;
            } else if ("Pxz".includes(ch)) {
              const value = j < arg.length - 1 ? arg.slice(j + 1) : args[++i];
              if (value === undefined || (ch !== "P" && !(ch === "x" ? /^\d+(,\d+)*$/u : /^[+-]?\d+$/u).test(value))) {
                await writeText(context.stderr, `${name}: numeric value required after -${ch}\n`);
                return { exitCode: 1 };
              }
              break;
            }
          }
          continue;
        }
        files.push(arg);
      }

      if (files.length === 0) files.push("-");

      try {
        const passThrough = !lineNumbers && !squeezeBlank && startLine === 1 && !startSearch;
        const texts: string[] = [];
        let exitCode = 0;
        for (const file of files) {
          if (file === "-") {
            if (passThrough) {
              let quantum = 0;
              let chunksRead = 0;
              for await (const chunk of readBytes(context.stdin, context.signal)) {
                admit(chunk.byteLength);
                await writeBytes(context.stdout, chunk, context.signal);
                quantum += Math.max(1, chunk.byteLength);
                if (quantum >= 16384 || ++chunksRead >= 128) { quantum = 0; chunksRead = 0; await yieldTurn(context.signal); }
              }
            } else texts.push(await readSourceText(context.stdin, context.signal, admit));
          } else {
            try {
              const targetPath = pathPosix.resolve(context.cwd, file);
              const remaining = maxBytes - inputBytes;
              const raw = await context.fs.readFile(targetPath, {
                signal: context.signal,
                ...(Number.isFinite(remaining) ? { maxBytes: remaining } : {}),
              });
              context.signal.throwIfAborted();
              admit(raw.byteLength);
              if (passThrough) await writeBytes(context.stdout, raw, context.signal);
              else texts.push(new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(raw));
            } catch (err) {
              context.signal.throwIfAborted();
              if (!(err instanceof FsError)) throw err;
              const msg = err instanceof Error ? err.message : String(err);
              await writeText(context.stderr, `${name}: ${file}: ${msg}\n`);
              exitCode = 1;
            }
          }
        }

        const combined = texts.join("");
        if (!combined) return { exitCode };

        const hasTrailingNewline = combined.endsWith("\n");
        const rawLines = combined.split("\n");
        if (hasTrailingNewline) rawLines.pop();

        let startIdx = Math.max(0, startLine - 1);
        if (startSearch) {
          const pattern = new Pattern(startSearch, true, ignoreCase);
          const budget = new Budget(context, { maxSteps: Infinity, maxBufferBytes: Infinity });
          let found = -1;
          for (let index = 0; index < rawLines.length; index++) {
            context.signal.throwIfAborted();
            if ((index & 127) === 0) await yieldTurn(context.signal);
            if (await pattern.find(rawLines[index]!, budget) !== undefined) { found = index; break; }
          }
          if (found >= 0) startIdx = found;
        }

        let out = "";
        let prevBlank = false;
        for (let idx = startIdx; idx < rawLines.length; idx++) {
          context.signal.throwIfAborted();
          if ((idx & 127) === 0) await yieldTurn(context.signal);
          const line = rawLines[idx]!;
          const isBlank = line.length === 0;
          if (squeezeBlank && isBlank && prevBlank) continue;
          prevBlank = isBlank;
          const prefix = lineNumbers ? `${String(idx + 1).padStart(6, " ")}  ` : "";
          const isLast = idx === rawLines.length - 1;
          out += prefix + line + (!isLast || hasTrailingNewline ? "\n" : "");
        }

        if (out.length > 0) {
          await writeText(context.stdout, out);
        }
        return { exitCode };
      } catch (error) {
        context.signal.throwIfAborted();
        if (!(error instanceof PublicDiagnostic)) throw error;
        await writeText(context.stderr, `${name}: ${error.message}\n`);
        return { exitCode: 1 };
      }
    },
  };
}

const syncLessDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const SYNC_LESS_SIMPLE_FLAGS = new Set(["N", "s", "F", "R", "X", "S", "i", "I", "q", "Q", "e", "E", "m", "M", "w", "W", "c", "d", "f", "u", "n", "G", "g", "J", "K", "L", "r", "U", "V"]);

export function evalSyncLess(
  stdinBytes: Uint8Array | undefined,
  args: readonly string[],
  readFile?: (path: string) => Uint8Array | undefined,
): string | undefined {
  let lineNumbers = false;
  let squeezeBlank = false;
  let startLine = 1;
  let startSearch: string | undefined;
  const files: string[] = [];
  let parsingFlags = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (parsingFlags && arg === "--") {
      parsingFlags = false;
      continue;
    }
    if (parsingFlags && arg.startsWith("+")) {
      const rest = arg.slice(1);
      if (rest.startsWith("/")) {
        startSearch = rest.slice(1);
      } else if (/^\d+$/u.test(rest)) {
        startLine = Math.max(1, Number.parseInt(rest, 10));
      } else {
        return undefined;
      }
      continue;
    }
    if (parsingFlags && arg.startsWith("--")) {
      if (arg === "--LINE-NUMBERS" || arg === "--line-numbers") lineNumbers = true;
      else if (arg === "--squeeze-blank-lines") squeezeBlank = true;
      else if (arg === "--ignore-case" || arg === "--IGNORE-CASE") continue;
      else if (arg === "--pattern" || arg.startsWith("--pattern=")) {
        const pat = arg === "--pattern" ? args[++i] : arg.slice(10);
        if (pat === undefined) return undefined;
        startSearch = pat;
      } else if (arg === "--quit-if-one-screen" || arg === "--raw-control-chars" || arg === "--RAW-CONTROL-CHARS" || arg === "--no-init" || arg === "--chop-long-lines") {
        // pass-through
      } else {
        return undefined;
      }
      continue;
    }
    if (parsingFlags && arg.startsWith("-") && arg !== "-") {
      for (let j = 1; j < arg.length; j++) {
        const ch = arg[j]!;
        if (ch === "p") {
          startSearch = j < arg.length - 1 ? arg.slice(j + 1) : (args[++i] ?? "");
          break;
        }
        if ("Pxz".includes(ch)) {
          const value = j < arg.length - 1 ? arg.slice(j + 1) : args[++i];
          if (value === undefined || (ch !== "P" && !(ch === "x" ? /^\d+(,\d+)*$/u : /^[+-]?\d+$/u).test(value))) return undefined;
          break;
        }
        if (ch === "n") { lineNumbers = false; continue; }
        if (ch === "i" || ch === "I") continue;
        if (!SYNC_LESS_SIMPLE_FLAGS.has(ch) || ch === "V") return undefined;
        if (ch === "N") lineNumbers = true;
        else if (ch === "s") squeezeBlank = true;
      }
      continue;
    }
    files.push(arg);
  }

  if (startSearch) return undefined;
  const chunks: string[] = [];
  if (files.length === 0) {
    if (!stdinBytes || stdinBytes.includes(0)) return undefined;
    try { chunks.push(syncLessDecoder.decode(stdinBytes)); } catch { return undefined; }
  } else {
    let stdinUsed = false;
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      if (f === "-") {
        if (!stdinBytes || stdinBytes.includes(0)) return undefined;
        if (stdinUsed) continue;
        stdinUsed = true;
        try { chunks.push(syncLessDecoder.decode(stdinBytes)); } catch { return undefined; }
      } else {
        const b = readFile ? readFile(f) : undefined;
        if (!b || b.includes(0)) return undefined;
        try { chunks.push(syncLessDecoder.decode(b)); } catch { return undefined; }
      }
    }
  }
  const combined = chunks.join("");
  if (!combined) return "";
  if (!lineNumbers && !squeezeBlank && startLine === 1 && !startSearch) {
    return combined;
  }
  const hasTrailingNewline = combined.endsWith("\n");
  const rawLines = combined.split("\n");
  if (hasTrailingNewline) rawLines.pop();
  const startIdx = Math.max(0, startLine - 1);
  let out = "";
  let prevBlank = false;
  for (let idx = startIdx; idx < rawLines.length; idx++) {
    const line = rawLines[idx]!;
    const isBlank = line.length === 0;
    if (squeezeBlank && isBlank && prevBlank) continue;
    prevBlank = isBlank;
    const prefix = lineNumbers ? `${String(idx + 1).padStart(6, " ")}  ` : "";
    const isLast = idx === rawLines.length - 1;
    out += prefix + line + (!isLast || hasTrailingNewline ? "\n" : "");
  }
  return out;
}

import { syncCommandEvaluators } from "safe-bash-contracts/runtime-control";
syncCommandEvaluators.evalSyncLess = evalSyncLess;
