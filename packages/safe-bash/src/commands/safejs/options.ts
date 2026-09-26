import { UsageError } from "../internal.js";
import type { SafeJsCommandLimits } from "./types.js";

/** No quotas are enabled by default. */
export const defaultSafeJsLimits: Readonly<Partial<SafeJsCommandLimits>> = Object.freeze({});

/** Internal arithmetic uses Infinity for omitted quotas; runtime budgets remain optional. */
const unlimitedLimits: Readonly<SafeJsCommandLimits> = Object.freeze({
  maxSourceBytes: Infinity, maxInputBytes: Infinity, maxOutputBytes: Infinity,
  timeoutMs: Infinity, maxSteps: Infinity, maxCallDepth: Infinity, stringLength: Infinity,
  arrayLength: Infinity, dataSize: Infinity,
});

export function commandLimits(options: Partial<SafeJsCommandLimits> = {}): SafeJsCommandLimits {
  for (const [name, value] of Object.entries(options)) {
    if (!Object.hasOwn(unlimitedLimits, name)) throw new TypeError(`Unknown SafeJS limit: ${name}`);
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < (name === "timeoutMs" ? 1 : 0))) throw new RangeError(`Invalid SafeJS limit: ${name}`);
  }
  return Object.freeze({ ...unlimitedLimits, ...options });
}

export interface Invocation { readonly source?: string; readonly file: string; readonly args: readonly string[]; readonly print: boolean; readonly help: boolean; readonly inputType?: "module" | "commonjs"; readonly check?: boolean; readonly preloads?: readonly string[]; readonly sourceMaps?: boolean; readonly output?: string; readonly nodeOptions?: readonly string[]; readonly envFiles?: readonly { path: string; optional: boolean }[] }

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
