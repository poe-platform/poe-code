import { UsageError } from "../internal.js";
import type { SafeJsCommandLimits } from "./types.js";

export const defaultSafeJsLimits: Readonly<SafeJsCommandLimits> = Object.freeze({
  maxSourceBytes: 1024 * 1024, maxInputBytes: 8 * 1024 * 1024, maxOutputBytes: 8 * 1024 * 1024,
  timeoutMs: 5000, maxSteps: 100_000, maxCallDepth: 128, stringLength: 1024 * 1024,
  arrayLength: 100_000, dataSize: 16 * 1024 * 1024,
});

export function commandLimits(options: Partial<SafeJsCommandLimits> = {}): SafeJsCommandLimits {
  const result = { ...defaultSafeJsLimits, ...options };
  for (const [name, value] of Object.entries(result)) {
    if (!Object.hasOwn(defaultSafeJsLimits, name)) throw new TypeError(`Unknown SafeJS limit: ${name}`);
    if (!Number.isSafeInteger(value) || value < (name === "timeoutMs" ? 1 : 0)) throw new RangeError(`Invalid SafeJS limit: ${name}`);
  }
  if (result.timeoutMs > 2_147_483_647) throw new RangeError("SafeJS timeoutMs exceeds timer range");
  return Object.freeze(result);
}

export interface Invocation { readonly source?: string; readonly file: string; readonly args: readonly string[]; readonly print: boolean; readonly help: boolean }

export function invocation(args: readonly string[]): Invocation {
  let print = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "-h" || argument === "--help") return { file: "-", args: [], print, help: true };
    if (argument === "-p" || argument === "--print") { print = true; continue; }
    if (argument === "-e" || argument === "--eval" || argument.startsWith("--eval=") || argument.startsWith("-e")) {
      const source = argument.startsWith("--eval=") ? argument.slice(7) : argument.length > 2 && argument !== "--eval" ? argument.slice(2) : args[++index];
      if (source === undefined) throw new UsageError(`${argument} requires SafeJS source`);
      const rest = args.slice(index + 1);
      return { source, file: "<safejs -e>", args: rest[0] === "--" ? rest.slice(1) : rest, print, help: false };
    }
    if (argument === "--") {
      const file = args[index + 1] ?? "-";
      return { file, args: args.slice(index + 2), print, help: false };
    }
    if (argument !== "-" && argument.startsWith("-")) throw new UsageError(`unrecognized option '${argument}'`);
    return { file: argument, args: args.slice(index + 1), print, help: false };
  }
  return { file: "-", args: [], print, help: false };
}
