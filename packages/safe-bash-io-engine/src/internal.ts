import { builtInDirectContextExecutors } from "safe-bash-contracts/runtime-control";
import { pathOf } from "safe-bash-query-engine/path";
import { UsageError, publicDiagnosticMessage } from "safe-bash-contracts/diagnostics";
import { assertCommandRequirements } from "safe-bash-contracts/command-requirements";
import { writeDiagnostic } from "safe-bash-contracts/escaping";
import { inputRequirements } from "./portable-requirements.js";
import { RecordBuffer } from "./record-buffer.js";
import { gnuInformation } from "./gnu-information.js";
import { getRuntimeBackingFileSystem } from "safe-bash-contracts/runtime-control";
import {
  FsError, readBytes, toByteSource, writeBytes,
  type ByteSource, type CommandContext, type CommandDefinition, type CommandHandler,
  type CommandResult,
} from "safe-bash-contracts";

const syncResolved = Symbol.for("safe-bash.syncResolved");
const sharedSmallOutputBuf = new Uint8Array(64);
const sharedSmallOutputViews: Uint8Array[] = Array.from({ length: 65 }, (_, i) => sharedSmallOutputBuf.subarray(0, i));
const resolvedVoid: Promise<void> = Object.defineProperty(
  Promise.resolve(),
  syncResolved,
  { value: true },
);
export const RESOLVED_EXIT_ZERO: Promise<CommandResult> = Object.defineProperty(
  Promise.resolve({ exitCode: 0 }),
  syncResolved,
  { value: true },
);
export const RESOLVED_EXIT_ONE: Promise<CommandResult> = Object.defineProperty(
  Promise.resolve({ exitCode: 1 }),
  syncResolved,
  { value: true },
);

async function handleDefineError(
  context: CommandContext,
  error: unknown,
  failureCode: number,
  usageFailureCode: number,
): Promise<CommandResult> {
  context.signal.throwIfAborted();
  await diagnostic(context, error);
  return { exitCode: error instanceof UsageError ? usageFailureCode : failureCode };
}

export const encoder: InstanceType<typeof TextEncoder> = new TextEncoder();
export const decoder: InstanceType<typeof TextDecoder> = new TextDecoder();
export const bufferLimit = Infinity;
export { builtInDirectContextExecutors } from "safe-bash-contracts/runtime-control";

export { isDefaultCommandOptions, registerDefaultExecutor, registerDefaultExecutors } from "safe-bash-contracts/command";

type SyncCsvEvaluator = (input: Uint8Array | undefined, args: readonly string[], readFile?: (path: string) => Uint8Array | undefined) => string | undefined;

export interface SyncCommandEvaluators {
  evalSyncCsvlook?: SyncCsvEvaluator;
  evalSyncCsvjson?: SyncCsvEvaluator;
  evalSyncCsvsort?: SyncCsvEvaluator;
  evalSyncCsvformat?: SyncCsvEvaluator;
  evalSyncCsvstat?: SyncCsvEvaluator;
  evalSyncIn2csv?: SyncCsvEvaluator;
  evalSyncCsvstack?: SyncCsvEvaluator;
  evalSyncCsvjoin?: SyncCsvEvaluator;

  evalSyncOpenssl?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncSqlite3?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncGpg?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncSsh?: (opArgs: readonly string[]) => string | undefined;
  evalSyncSshKeygen?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean, cwd?: string) => string | undefined;
  evalSyncPdfinfo?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined) => string | undefined;
  evalSyncPdffonts?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined) => string | undefined;
  evalSyncPdfdetach?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncPdftotext?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncPdftohtml?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncExiftool?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncQpdf?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncPdftk?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncSips?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncIdentify?: (cmdName: string, inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncPdfimages?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncFfmpeg?: (inBytes: Uint8Array | readonly string[] | undefined, opArgs?: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncFfprobe?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined) => string | undefined;
  evalSyncGh?: (execute: any, opArgs: readonly string[], env: Readonly<Record<string, string>>, cwd?: string, readFileSync?: (path: string) => Uint8Array | undefined) => string | undefined;
  evalSyncPdftoppm?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncPdftocairo?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncMmdc?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncPandoc?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncSoffice?: (opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncSsconvert?: (execute: CommandHandler, opArgs: readonly string[], inBytes?: Uint8Array, readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncWkhtmltopdf?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncOp?: (execute: any, opArgs: readonly string[], env: Readonly<Record<string, string>>) => string | undefined;
  evalSyncGit?: (stdinBytes: Uint8Array | undefined, opArgs: readonly string[], cwd: string, inspectNode?: any, readFile?: any, executeFn?: any, writeFileSync?: (path: string, bytes: Uint8Array, mode?: number) => boolean, mkdirSync?: (path: string) => boolean, rmSync?: (path: string) => boolean) => string | undefined;
  evalSyncTimeout?: (opArgs: readonly string[]) => string | undefined;
  evalSyncSplit?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncCsplit?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncCurl?: (opArgs: readonly string[]) => string | undefined;
  evalSyncWget?: (opArgs: readonly string[]) => string | undefined;
  evalSyncSponge?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncTruncate?: (opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncInstall?: (opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array, mode?: number) => boolean, statTypeSync?: (filePath: string) => string | undefined, mkdirSync?: (filePath: string, mode?: number) => boolean) => string | undefined;
  evalSyncApplyPatch?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean, removeFileSync?: (filePath: string) => boolean, mkdirSync?: (filePath: string) => boolean) => string | undefined;
  evalSyncMktemp?: (opArgs: readonly string[], env: Readonly<Record<string, string>>, statTypeSync?: (filePath: string) => string | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean, mkdirSync?: (filePath: string) => boolean) => string | undefined;
  evalSyncTee?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], writeFileSync?: (filePath: string, bytes: Uint8Array, append: boolean) => boolean) => string | undefined;
  evalSyncTouch?: (opArgs: readonly string[], statTypeSync?: (filePath: string) => string | undefined, readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array, append: boolean) => boolean, utimesNodeSync?: (filePath: string, update: (stat: { atimeMs: number; mtimeMs: number }) => { atimeMs?: number; mtimeMs?: number }) => boolean, tz?: string) => string | undefined;
  evalSyncCp?: (opArgs: readonly string[], statTypeSync?: (filePath: string) => string | undefined, readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array, append: boolean, mode?: number) => boolean, statModeSync?: (filePath: string) => number | undefined, umask?: number) => string | undefined;
  evalSyncMv?: (opArgs: readonly string[], statTypeSync?: (filePath: string) => string | undefined, readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array, append: boolean, mode?: number) => boolean, rmSync?: (filePath: string) => boolean, statModeSync?: (filePath: string) => number | undefined) => string | undefined;
  evalSyncRmdir?: (opArgs: readonly string[], statTypeSync?: (filePath: string) => string | undefined, listDirSync?: (filePath: string) => readonly string[] | ReadonlyMap<string, unknown> | undefined, rmSync?: (filePath: string) => boolean) => string | undefined;
  evalSyncSleep?: (opArgs: readonly string[]) => string | undefined;
  evalSyncChmod?: (opArgs: readonly string[], umask: number, chmodNodeSync?: (filePath: string, change: (stat: { type: "file" | "directory" | "symlink"; mode: number }) => number) => boolean) => string | undefined;
  evalSyncPatch?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array, append: boolean) => boolean) => string | undefined;
  evalSyncMkdir?: (opArgs: readonly string[], umask: number, statTypeSync?: (filePath: string) => string | undefined, mkdirSync?: (filePath: string, recursive: boolean, mode: number) => boolean) => string | undefined;
  evalSyncRm?: (opArgs: readonly string[], statTypeSync?: (filePath: string) => string | undefined, listDirSync?: (filePath: string) => readonly string[] | ReadonlyMap<string, unknown> | undefined, rmSync?: (filePath: string) => boolean) => string | undefined;
  evalSyncLn?: (opArgs: readonly string[], statTypeSync?: (filePath: string) => string | undefined, rmSync?: (filePath: string) => boolean, linkSync?: (srcOrTarget: string, dstPath: string, symbolic: boolean) => boolean) => string | undefined;
  evalSyncCat?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined) => string | undefined;
  evalSyncHeadTail?: (name: "head" | "tail", inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined) => string | undefined;
  evalSyncWc?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], singleByte: boolean, readFileSync?: (filePath: string) => Uint8Array | undefined) => string | undefined;
}

export const syncCommandEvaluators: SyncCommandEvaluators = {};

export { UsageError } from "safe-bash-contracts/diagnostics";

export interface ParsedOptions {
  readonly flags: Set<string>;
  readonly values: Map<string, string[]>;
  readonly operands: string[];
}

const specificationsCache = new Map<string, ReadonlyMap<string, boolean>>();

export function options(
  args: readonly string[], short: string, long: Readonly<Record<string, string | false>> = {},
  stopAtOperand = false, onOperand?: (index: number) => void,
  onValue?: (key: string, index: number, offset: number) => void,
  onOption?: (key: string, value: string | undefined) => void,
): ParsedOptions {
  const flags = new Set<string>();
  const values = new Map<string, string[]>();
  const operands: string[] = [];
  let specifications = specificationsCache.get(short);
  if (!specifications) {
    const built = new Map<string, boolean>();
    for (let index = 0; index < short.length; index++) {
      const key = short[index]!;
      built.set(key, short[index + 1] === ":");
      if (short[index + 1] === ":") index++;
    }
    specifications = built;
    specificationsCache.set(short, specifications);
  }
  let ended = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (ended || argument === "-" || !argument.startsWith("-")) {
      operands.push(argument);
      onOperand?.(index);
      if (stopAtOperand) ended = true;
      continue;
    }
    if (argument === "--") { ended = true; continue; }
    if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = argument.slice(2, equals < 0 ? undefined : equals);
      const alias = long[name];
      const longValue = typeof alias === "string" && alias.endsWith(":");
      const key = alias === false ? name : longValue ? alias.slice(0, -1) : alias;
      if (!key || (alias !== false && !longValue && !specifications.has(key))) throw new UsageError(`unrecognized option '${argument}'`);
      if (longValue || specifications.get(key)) {
        const value = equals >= 0 ? argument.slice(equals + 1) : args[++index];
        if (value === undefined) throw new UsageError(`option '--${name}' requires an argument`);
        onValue?.(key, index, equals >= 0 ? equals + 1 : 0);
        const list = values.get(key);
        if (list) list.push(value);
        else values.set(key, [value]);
      } else if (equals >= 0) throw new UsageError(`option '--${name}' does not take an argument`);
      flags.add(key);
      onOption?.(key, values.get(key)?.at(-1));
      continue;
    }
    for (let offset = 1; offset < argument.length; offset++) {
      const key = argument[offset]!;
      if (!specifications.has(key)) throw new UsageError(`invalid option -- '${key}'`);
      if (specifications.get(key)) {
        const value = argument.slice(offset + 1) || args[++index];
        if (value === undefined) throw new UsageError(`option requires an argument -- '${key}'`);
        onValue?.(key, index, offset + 1 < argument.length ? offset + 1 : 0);
        const list = values.get(key);
        if (list) list.push(value);
        else values.set(key, [value]);
        offset = argument.length;
      }
      flags.add(key);
      onOption?.(key, values.get(key)?.at(-1));
    }
  }
  return { flags, values, operands };
}

export function value(parsed: ParsedOptions, key: string): string | undefined {
  return parsed.values.get(key)?.at(-1);
}

export function integer(text: string, minimum = 0): number {
  if (!/^[+]?[0-9]+$/u.test(text)) throw new UsageError(`invalid number '${text}'`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < minimum) throw new UsageError(`invalid number '${text}'`);
  return number;
}

export function requireOperands(operands: readonly string[], minimum = 1, maximum = Infinity): void {
  if (operands.length < minimum) throw new UsageError("missing operand");
  if (operands.length > maximum) throw new UsageError(`extra operand '${operands[maximum]}'`);
}
export { pathOf } from "safe-bash-query-engine/path";


export function codeOf(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

const EXIT_ZERO_RESULT = { exitCode: 0 };
const EXIT_ONE_RESULT = { exitCode: 1 };
const EXIT_TWO_RESULT = { exitCode: 2 };
export const RETURN_EXIT_ZERO = (): { exitCode: number } => EXIT_ZERO_RESULT;
export const RETURN_EXIT_ONE = (): { exitCode: number } => EXIT_ONE_RESULT;
export const RETURN_EXIT_TWO = (): { exitCode: number } => EXIT_TWO_RESULT;

export function outputRange(context: CommandContext, src: Uint8Array, len: number): Promise<void> {
  context.signal.throwIfAborted();
  const stdout = context.stdout as { isPipeStage?: boolean; writeRangeSync?: (src: Uint8Array, len: number) => boolean; writeSync?: (chunk: Uint8Array) => boolean };
  if (!stdout.isPipeStage) {
    if (typeof stdout.writeRangeSync === "function" && stdout.writeRangeSync(src, len) !== false) {
      return resolvedVoid;
    }
    if (typeof stdout.writeSync === "function" && stdout.writeSync(src.subarray(0, len)) !== false) {
      return resolvedVoid;
    }
  }
  return writeBytes(context.stdout, stdout.isPipeStage ? src.subarray(0, len) : src.slice(0, len), context.signal);
}

export function output(context: CommandContext, text: string | Uint8Array): Promise<void> {
  context.signal.throwIfAborted();
  const stdout = context.stdout as { isPipeStage?: boolean; writeSync?: (chunk: Uint8Array) => boolean; writeRangeSync?: (src: Uint8Array, len: number) => boolean };
  if (typeof text === "string" && !stdout.isPipeStage) {
    const len = text.length;
    if (len <= 64 && (typeof stdout.writeRangeSync === "function" || typeof stdout.writeSync === "function")) {
      let ascii = true;
      for (let i = 0; i < len; i++) {
        const code = text.charCodeAt(i);
        if (code >= 0x80) { ascii = false; break; }
        sharedSmallOutputBuf[i] = code;
      }
      if (ascii) {
        const ok = typeof stdout.writeRangeSync === "function"
          ? stdout.writeRangeSync(sharedSmallOutputBuf, len)
          : stdout.writeSync!(sharedSmallOutputViews[len]!);
        if (ok !== false) return resolvedVoid;
      }
    }
  }
  const bytes = typeof text === "string" ? encoder.encode(text) : text;
  if (!stdout.isPipeStage && typeof stdout.writeSync === "function" && stdout.writeSync(bytes) !== false) {
    return resolvedVoid;
  }
  return writeBytes(context.stdout, bytes, context.signal);
}

export async function diagnostic(context: CommandContext, error: unknown): Promise<void> {
  context.signal.throwIfAborted();
  await writeDiagnostic(context.stderr, `${context.command}: ${publicDiagnosticMessage(error, context.onInternalError)}\n`, context.signal);
}

function finishDefineInfoAsync(
  infoPromise: Promise<CommandResult | undefined>,
  handler: CommandHandler,
  context: CommandContext,
  failureCode: number,
  usageFailureCode: number,
): Promise<CommandResult> {
  return infoPromise.then(
    info => info ?? handler(context),
  ).catch(error => handleDefineError(context, error, failureCode, usageFailureCode));
}

function finishDefineResAsync(
  res: CommandResult | Promise<CommandResult>,
  context: CommandContext,
  failureCode: number,
  usageFailureCode: number,
): Promise<CommandResult> {
  return Promise.resolve(res).catch(error => handleDefineError(context, error, failureCode, usageFailureCode));
}

export function define(name: string, handler: CommandHandler, failureCode = 1, usageFailureCode = 2): CommandDefinition {
  const definition: CommandDefinition = {
    name,
    execute(context): Promise<CommandResult> {
      try {
        context.signal.throwIfAborted();
        const infoPromise = gnuInformation(name, context);
        if (infoPromise) {
          return finishDefineInfoAsync(infoPromise, handler, context, failureCode, usageFailureCode);
        }
        const res = handler(context);
        if (
          res === RESOLVED_EXIT_ZERO ||
          res === RESOLVED_EXIT_ONE ||
          Boolean(res && typeof res === "object" && (res as unknown as Record<symbol, unknown>)[syncResolved])
        ) {
          return res as Promise<CommandResult>;
        }
        return finishDefineResAsync(res, context, failureCode, usageFailureCode);
      } catch (error) {
        return handleDefineError(context, error, failureCode, usageFailureCode);
      }
    },
  };
  builtInDirectContextExecutors.add(definition.execute);
  return definition;
}

export async function eachOperand(
  context: CommandContext, operands: readonly string[], operation: (operand: string) => Promise<void>,
): Promise<{ exitCode: number }> {
  let exitCode = 0;
  for (const operand of operands) {
    context.signal.throwIfAborted();
    try { await operation(operand); }
    catch (error) { await diagnostic(context, error); exitCode = 1; }
  }
  return { exitCode };
}

export function input(context: CommandContext, name = "-"): ByteSource {
  if (name === "-") {
    if (!context.signal.aborted && (context.stdin as { readonly abortSignal?: AbortSignal }).abortSignal === context.signal) {
      return context.stdin;
    }
    return readBytes(context.stdin, context.signal);
  }
  const backing = getRuntimeBackingFileSystem(context.fs);
  if (
    !context.signal.aborted &&
    backing !== undefined &&
    backing.capabilitiesFor === undefined &&
    context.fs.readStream &&
    context.fs.capabilities.streamingRead !== false &&
    context.fs.capabilities.read !== false &&
    Object.getPrototypeOf(backing)?.constructor?.name === "MemoryFileSystem" &&
    !Object.prototype.hasOwnProperty.call(backing, "readStream")
  ) {
    const resolvedPath = pathOf(context, name);
    if (resolvedPath !== "/dev" && !resolvedPath.startsWith("/dev/")) {
      return context.fs.readStream(resolvedPath, { signal: context.signal });
    }
  }
  return inputFileSlow(context, name);
}

function inputFileSlow(context: CommandContext, name: string): ByteSource {
  return readBytes({ [Symbol.asyncIterator]() {
    context.signal.throwIfAborted();
    const resolvedPath = pathOf(context, name);
    const backing = getRuntimeBackingFileSystem(context.fs);
    const skipCapsFor = !context.fs.capabilitiesFor || (
      backing?.capabilitiesFor === undefined &&
      resolvedPath !== "/dev" &&
      !resolvedPath.startsWith("/dev/")
    );
    if (skipCapsFor && context.fs.readStream && context.fs.capabilities.streamingRead !== false) {
      assertCommandRequirements(context, inputRequirements, FILE_REQUIREMENT_MODES);
      if (
        backing !== undefined &&
        backing.capabilitiesFor === undefined &&
        Object.getPrototypeOf(backing)?.constructor?.name === "MemoryFileSystem" &&
        !Object.prototype.hasOwnProperty.call(backing, "readStream")
      ) {
        return context.fs.readStream(resolvedPath, { signal: context.signal })[Symbol.asyncIterator]();
      }
      let iterator: (AsyncIterator<Uint8Array> & { tryNextSync?: () => IteratorResult<Uint8Array> | undefined }) | undefined;
      let closing: Promise<void> | undefined;
      let finished = false;
      let readFailure: { reason: unknown } | undefined;
      const close = (): Promise<void> => closing ??= Promise.resolve().then(async () => {
        if (!finished) {
          finished = true;
          try { await iterator?.return?.(); }
          catch (error) {
            // A canceled stream can repeat its cancellation from return() even
            // when next() never rejected. It is not a separate cleanup failure.
            if (context.signal.aborted && Object.is(error, context.signal.reason)) return;
            if (!readFailure || !Object.is(error, readFailure.reason)) throw error;
          }
        }
      });
      context.registerCleanup?.(close);
      try {
        context.signal.throwIfAborted();
        iterator = context.fs.readStream(resolvedPath, { signal: context.signal })[Symbol.asyncIterator]();
        if (context.signal.aborted) {
          void close().catch(() => {});
          context.signal.throwIfAborted();
        }
      } catch (error) {
        return fileInputSource(context, name, { [Symbol.asyncIterator]: () => ({ async next() { throw error; } }) });
      }
      const source = { [Symbol.asyncIterator]: () => ({
        tryNextSync() {
          if (finished || closing) return { done: true as const, value: undefined };
          try {
            const result = iterator!.tryNextSync?.();
            if (result?.done) finished = true;
            return result;
          } catch (reason) { readFailure = { reason }; throw reason; }
        },
        async next() {
          if (finished || closing) return { done: true as const, value: undefined };
          try {
            const result = await iterator!.next();
            if (result.done) finished = true;
            return result;
          } catch (reason) { readFailure = { reason }; throw reason; }
        },
        async return() {
          await close();
          return { done: true as const, value: undefined };
        },
      }) };
      const reader = readBytes(source, context.signal) as AsyncGenerator<Uint8Array> & { tryNextSync(): IteratorResult<Uint8Array> | undefined };
      let fallback: AsyncGenerator<Uint8Array> | undefined;
      let emitted = false;
      return {
        abortSignal: context.signal,
        tryNextSync() {
          if (fallback) return undefined;
          const result = reader.tryNextSync();
          if (result && !result.done && result.value.byteLength) emitted = true;
          return result;
        },
        async next() {
          if (fallback) return fallback.next();
          try {
            const result = await reader.next();
            if (!result.done && result.value.byteLength) emitted = true;
            return result;
          } catch (error) {
            context.signal.throwIfAborted();
            if (emitted || !(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
            fallback = fileInputSource(context, name, false);
            return fallback.next();
          }
        },
        return: (value?: unknown) => (fallback ?? reader).return(value),
        throw: (error?: unknown) => (fallback ?? reader).throw(error),
      };
    }
    return fileInputSource(context, name);
  } }, context.signal);
}

async function* fileInputSource(context: CommandContext, name: string, stream?: ByteSource | false): AsyncGenerator<Uint8Array> {
    context.signal.throwIfAborted();
    await assertInputRequirements(context, [name]);
    const path = pathOf(context, name);
    const capabilities = await context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities;
    if (stream !== false && context.fs.readStream && capabilities.streamingRead !== false) {
      let emitted = false;
      let reading = true;
      try {
        for await (const chunk of readBytes(stream ?? context.fs.readStream(path, { signal: context.signal }), context.signal)) {
          reading = false;
          if (chunk.byteLength) emitted = true;
          yield chunk;
          reading = true;
        }
        return;
      } catch (error) {
        context.signal.throwIfAborted();
        if (!reading || emitted || !(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
      }
    }
    if (capabilities.read === false) throw new FsError("ENOTSUP", { syscall: "readFile", path });
    yield* readBytes({
      async *[Symbol.asyncIterator]() {
        const bytes = await context.fs.readFile(path, { signal: context.signal });
        context.signal.throwIfAborted();
        if (bytes.byteLength > bufferLimit) throw new FsError("EFBIG", { syscall: "readFile", path });
        yield bytes;
      },
    }, context.signal);
}

const FILE_REQUIREMENT_MODES = ["file"] as const;
const STDIN_REQUIREMENT_MODES = ["stdin"] as const;

export function assertInputRequirements(context: CommandContext, names: readonly string[]): Promise<void> | void {
  let hasFile = false;
  for (let i = 0; i < names.length; i++) {
    if (names[i] !== "-") { hasFile = true; break; }
  }
  assertCommandRequirements(context, inputRequirements, hasFile ? FILE_REQUIREMENT_MODES : STDIN_REQUIREMENT_MODES);
  if (!hasFile || !context.fs.capabilitiesFor) return;
  if (getRuntimeBackingFileSystem(context.fs)?.capabilitiesFor === undefined) {
    let hasDev = false;
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!;
      if (name === "-") continue;
      const p = pathOf(context, name);
      if (p === "/dev" || p.startsWith("/dev/")) { hasDev = true; break; }
    }
    if (!hasDev) return;
  }
  return assertInputRequirementsAsync(context, names);
}

async function assertInputRequirementsAsync(context: CommandContext, names: readonly string[]): Promise<void> {
  if (!context.fs.capabilitiesFor) return;
  for (const name of names) {
    if (name === "-") continue;
    try {
      const capabilities = await context.fs.capabilitiesFor(pathOf(context, name), { signal: context.signal });
      assertCommandRequirements(context, inputRequirements, ["file"], capabilities);
    } catch (error) {
      context.signal.throwIfAborted();
      if (codeOf(error) === "ENOTSUP" || codeOf(error) === "EROFS") throw error;
    }
  }
}

export function concatenate(chunks: readonly Uint8Array[], size = chunks.reduce((sum, chunk) => sum + chunk.length, 0)): Uint8Array {
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function collect(source: ByteSource, signal: AbortSignal, limit = bufferLimit): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    signal.throwIfAborted();
    size += chunk.length;
    if (size > limit) throw new FsError("EFBIG", { message: `buffer limit exceeded (${limit} bytes)` });
    chunks.push(new Uint8Array(chunk));
  }
  return concatenate(chunks, size);
}

export interface Line { readonly bytes: Uint8Array; readonly terminated: boolean }

export async function* lines(source: ByteSource, separator = 10, admit?: (size: number) => void): AsyncGenerator<Line> {
  const pending = new RecordBuffer(bufferLimit);
  try {
    for await (const chunk of source) {
      let start = 0;
      while (start < chunk.length) {
        const offset = chunk.indexOf(separator, start);
        if (offset < 0) break;
        yield { bytes: pending.finish(admit, chunk, start, offset), terminated: true };
        start = offset + 1;
      }
      pending.append(chunk, start);
    }
    if (pending.size) yield { bytes: pending.finish(admit), terminated: false };
  } finally { pending.clear(); }
}

export function emptyInput(): ByteSource { return toByteSource(""); }

export function replaceArgument(source: string | Uint8Array, pattern: string, replacement: string): string | Uint8Array {
  if (typeof source === "string") return source.split(pattern).join(replacement);
  const needle = encoder.encode(pattern);
  if (!needle.length) throw new UsageError("replacement string cannot be empty");
  const substituted = encoder.encode(replacement);
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (let offset = 0; offset <= source.length - needle.length;) {
    if (needle.every((byte, index) => source[offset + index] === byte)) {
      chunks.push(source.subarray(start, offset), substituted);
      offset += needle.length;
      start = offset;
    } else offset++;
  }
  chunks.push(source.subarray(start));
  return concatenate(chunks);
}

export function escapeBytes(text: string | Uint8Array, zeroOctal = false, bareOctal = false,
  unicode?: { utf8: boolean; missingDigit: (escape: string) => void }): { bytes: Uint8Array; stop: boolean } {
  if (unicode && typeof text === "string") text = encoder.encode(text);
  if (typeof text === "string") {
    const chunks: Uint8Array[] = [];
    const control: Record<string, number> = { a: 7, b: 8, e: 27, E: 27, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92 };
    for (let index = 0; index < text.length;) {
      if (text[index] !== "\\" || index + 1 === text.length) {
        const character = String.fromCodePoint(text.codePointAt(index)!);
        chunks.push(encoder.encode(character)); index += character.length; continue;
      }
      const next = text[index + 1]!;
      if (next === "c") return { bytes: concatenate(chunks), stop: true };
      if (control[next] !== undefined) { chunks.push(Uint8Array.of(control[next])); index += 2; continue; }
      const rest = text.slice(index + 1);
      const octal = zeroOctal ? (bareOctal ? /^(?:0([0-7]{0,3})|([1-7][0-7]{0,2}))/u : /^0([0-7]{0,3})/u).exec(rest) : /^([0-7]{1,3})/u.exec(rest);
      if (octal) { chunks.push(Uint8Array.of(parseInt(octal[1] || octal[2] || "0", 8) & 255)); index += 1 + octal[0].length; continue; }
      const hexadecimal = /^x([0-9a-fA-F]{1,2})/u.exec(rest);
      if (hexadecimal) { chunks.push(Uint8Array.of(parseInt(hexadecimal[1]!, 16))); index += 1 + hexadecimal[0].length; continue; }
      chunks.push(encoder.encode(`\\${next}`)); index += 2;
    }
    return { bytes: concatenate(chunks), stop: false };
  }
  const source = text;
  // C-locale fallback normalizes short escapes to four/eight uppercase digits.
  const bytes = new Uint8Array(source.length * (unicode && !unicode.utf8 ? 3 : 1));
  const control: Record<number, number> = { 97: 7, 98: 8, 101: 27, 69: 27, 102: 12, 110: 10, 114: 13, 116: 9, 118: 11, 92: 92 };
  let size = 0;
  for (let index = 0; index < source.length;) {
    if (source[index] !== 92 || index + 1 === source.length) { bytes[size++] = source[index++]!; continue; }
    const next = source[index + 1]!;
    if (next === 99) return { bytes: bytes.subarray(0, size), stop: true };
    if (control[next] !== undefined) { bytes[size++] = control[next]; index += 2; continue; }
    if (zeroOctal ? next === 48 || bareOctal && next >= 49 && next <= 55 : next >= 48 && next <= 55) {
      let offset = index + (zeroOctal && next === 48 ? 2 : 1);
      const end = Math.min(source.length, offset + 3);
      let value = 0;
      while (offset < end && source[offset]! >= 48 && source[offset]! <= 55) value = value * 8 + source[offset++]! - 48;
      bytes[size++] = value & 255;
      index = offset;
      continue;
    }
    if (unicode && (next === 117 || next === 85)) {
      const digits = next === 117 ? 4 : 8;
      let offset = index + 2;
      const end = Math.min(source.length, offset + digits);
      let value = 0;
      while (offset < end) {
        const digit = source[offset]!;
        const number = digit >= 48 && digit <= 57 ? digit - 48 : digit >= 65 && digit <= 70 ? digit - 55 : digit >= 97 && digit <= 102 ? digit - 87 : -1;
        if (number < 0) break;
        value = value * 16 + number;
        offset++;
      }
      if (offset === index + 2) unicode.missingDigit(String.fromCharCode(next));
      else {
        // Bash discards values outside its signed 32-bit wide-character range.
        if (value < 0x80000000) {
          if (!unicode.utf8 && value > 127) {
            const literal = encoder.encode(`\\${value <= 0xffff ? "u" : "U"}${value.toString(16).toUpperCase().padStart(value <= 0xffff ? 4 : 8, "0")}`);
            bytes.set(literal, size);
            size += literal.length;
          } else if (value < 128) bytes[size++] = value;
          else {
            // Match Bash's byte encoding, including surrogate and extended values.
            const length = value < 0x800 ? 2 : value < 0x10000 ? 3 : value < 0x200000 ? 4 : value < 0x4000000 ? 5 : 6;
            for (let position = length - 1; position > 0; position--) {
              bytes[size + position] = 0x80 | value & 0x3f;
              value = Math.floor(value / 64);
            }
            bytes[size] = (0xff << (8 - length) & 0xff) | value;
            size += length;
          }
        }
        index = offset;
        continue;
      }
    }
    if (next === 120) {
      let offset = index + 2;
      const end = Math.min(source.length, offset + 2);
      let value = 0;
      while (offset < end) {
        const digit = source[offset]!;
        const number = digit >= 48 && digit <= 57 ? digit - 48 : digit >= 65 && digit <= 70 ? digit - 55 : digit >= 97 && digit <= 102 ? digit - 87 : -1;
        if (number < 0) break;
        value = value * 16 + number;
        offset++;
      }
      if (offset > index + 2) { bytes[size++] = value; index = offset; continue; }
      unicode?.missingDigit("x");
    }
    bytes[size++] = 92;
    bytes[size++] = next;
    index += 2;
  }
  return { bytes: bytes.subarray(0, size), stop: false };
}


import { gnuInformationSync as gnuInfoSyncInternal } from "./gnu-information.js";
import { touchTimes } from "./commands/touch-times.js";

export function evalSyncTee(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  writeFileSync?: (filePath: string, bytes: Uint8Array, append: boolean) => boolean,
): string | undefined {
  const gnuInfo = gnuInfoSyncInternal("tee", opArgs);
  if (gnuInfo !== undefined) return gnuInfo;
  let append = false;
  let ended = false;
  const operands: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (ended || !a.startsWith("-") || a === "-") {
      if (a === "-") return undefined;
      operands.push(a);
      continue;
    }
    if (a === "--") { ended = true; continue; }
    if (a === "-a" || a === "--append") { append = true; continue; }
    if (a === "-i" || a === "--ignore-interrupts" || a === "-p" || a === "--output-error" || a === "--output-error=warn" || a === "--output-error=warn-nopipe") continue;
    if (a.startsWith("-") && !a.startsWith("--")) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "a") append = true;
        else if (ch === "i" || ch === "p") continue;
        else return undefined;
      }
      continue;
    }
    return undefined;
  }
  const data = inBytes ?? new Uint8Array(0);
  if (data.includes(0)) return undefined;
  for (const op of operands) {
    if (!writeFileSync || !writeFileSync(op, data, append)) return undefined;
  }
  return decoder.decode(data);
}

export function evalSyncTouch(
  opArgs: readonly string[],
  statTypeSync?: (filePath: string) => string | undefined,
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array, append: boolean) => boolean,
  utimesNodeSync?: (filePath: string, update: (stat: { atimeMs: number; mtimeMs: number }) => { atimeMs?: number; mtimeMs?: number }) => boolean,
  tz = "UTC",
): string | undefined {
  const gnuInfo = gnuInfoSyncInternal("touch", opArgs);
  if (gnuInfo !== undefined) return gnuInfo;
  let noCreate = false;
  let flagA = false;
  let flagM = false;
  let dateStr: string | undefined;
  let stampStr: string | undefined;
  let refPath: string | undefined;
  let ended = false;
  const operands: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (ended || !a.startsWith("-") || a === "-") {
      if (a === "-") return undefined;
      operands.push(a);
      continue;
    }
    if (a === "--") { ended = true; continue; }
    if (a === "-c" || a === "--no-create") { noCreate = true; continue; }
    if (a === "-a") { flagA = true; continue; }
    if (a === "-m") { flagM = true; continue; }
    if (a === "-f" || a === "-h" || a === "--no-dereference") continue;
    if (a === "-d" || a === "--date" || a.startsWith("--date=")) {
      const val = a.startsWith("--date=") ? a.slice(7) : opArgs[++i];
      if (val === undefined) return undefined;
      dateStr = val;
      continue;
    }
    if (a === "-t") {
      const val = opArgs[++i];
      if (!val) return undefined;
      stampStr = val;
      continue;
    }
    if (a === "-r" || a === "--reference" || a.startsWith("--reference=")) {
      const val = a.startsWith("--reference=") ? a.slice(12) : opArgs[++i];
      if (!val) return undefined;
      refPath = val;
      continue;
    }
    if (a === "--time" || a.startsWith("--time=")) {
      const val = a.startsWith("--time=") ? a.slice(7) : opArgs[++i];
      if (val === "atime" || val === "access" || val === "use") { flagA = true; continue; }
      if (val === "mtime" || val === "modify") { flagM = true; continue; }
      return undefined;
    }
    if (a.startsWith("-") && !a.startsWith("--")) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "c") noCreate = true;
        else if (ch === "a") flagA = true;
        else if (ch === "m") flagM = true;
        else if (ch === "f" || ch === "h") continue;
        else if (ch === "d" || ch === "t" || ch === "r") {
          const rest = a.slice(j + 1) || opArgs[++i];
          if (rest === undefined) return undefined;
          if (ch === "d") dateStr = rest;
          else if (ch === "t") stampStr = rest;
          else refPath = rest;
          break;
        } else return undefined;
      }
      continue;
    }
    return undefined;
  }
  if (operands.length === 0 || !statTypeSync || !readFileSync || !writeFileSync) return undefined;
  if ((stampStr !== undefined ? 1 : 0) + (refPath !== undefined ? 1 : 0) > 1) return undefined;
  if (stampStr !== undefined && dateStr !== undefined) return undefined;
  let refTimes: { atimeMs: number; mtimeMs: number } | undefined;
  if (refPath !== undefined) {
    if (!utimesNodeSync || !utimesNodeSync(refPath, st => { refTimes = { atimeMs: st.atimeMs, mtimeMs: st.mtimeMs }; return {}; }) || !refTimes) {
      return undefined;
    }
  }
  const updateAccess = flagA || !flagM;
  const updateModify = flagM || !flagA;
  let parsedTimes: { atimeMs: number; mtimeMs: number } | undefined;
  try {
    if (dateStr !== undefined || stampStr !== undefined || refTimes !== undefined) {
      if (!utimesNodeSync) return undefined;
      const base = refTimes ?? { atimeMs: Date.now(), mtimeMs: Date.now() };
      parsedTimes = touchTimes(dateStr, stampStr, tz, base);
    }
  } catch {
    return undefined;
  }
  for (const f of operands) {
    const st = statTypeSync(f);
    if (st === "missing") {
      if (noCreate) continue;
      if (!writeFileSync(f, new Uint8Array(0), false)) return undefined;
      if (utimesNodeSync && parsedTimes) {
        if (!utimesNodeSync(f, () => ({
          ...(updateAccess ? { atimeMs: parsedTimes!.atimeMs } : {}),
          ...(updateModify ? { mtimeMs: parsedTimes!.mtimeMs } : {}),
        }))) return undefined;
      }
    } else if (st === "file" || st === "directory") {
      if (utimesNodeSync) {
        const now = Date.now();
        const target = parsedTimes ?? { atimeMs: now, mtimeMs: now };
        if (!utimesNodeSync(f, () => ({
          ...(updateAccess ? { atimeMs: target.atimeMs } : {}),
          ...(updateModify ? { mtimeMs: target.mtimeMs } : {}),
        }))) return undefined;
      } else if (st === "file") {
        const cur = readFileSync(f);
        if (!cur || !writeFileSync(f, cur, false)) return undefined;
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }
  return "";
}

export function evalSyncCp(
  opArgs: readonly string[],
  statTypeSync?: (filePath: string) => string | undefined,
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array, append: boolean, mode?: number) => boolean,
  statModeSync?: (filePath: string) => number | undefined,
  umask = 0o022,
): string | undefined {
  const gnuInfo = gnuInfoSyncInternal("cp", opArgs);
  if (gnuInfo !== undefined) return gnuInfo;
  let verbose = false;
  let noTargetDir = false;
  let noClobber = false;
  let preserve = false;
  let targetDir: string | undefined;
  let ended = false;
  const operands: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (ended || !a.startsWith("-") || a === "-") {
      operands.push(a);
      continue;
    }
    if (a === "--") { ended = true; continue; }
    if (a === "-v" || a === "--verbose") { verbose = true; continue; }
    if (a === "-f" || a === "--force") continue;
    if (a === "-n" || a === "--no-clobber") { noClobber = true; continue; }
    if (a === "-p" || a === "--preserve") { preserve = true; continue; }
    if (a === "-T" || a === "--no-target-directory") { noTargetDir = true; continue; }
    if (a === "-t" || a === "--target-directory" || a.startsWith("--target-directory=")) {
      const td = a.startsWith("--target-directory=") ? a.slice(19) : opArgs[++i];
      if (!td) return undefined;
      targetDir = td;
      continue;
    }
    if (a.startsWith("-") && !a.startsWith("--")) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "v") verbose = true;
        else if (ch === "f") continue;
        else if (ch === "n") noClobber = true;
        else if (ch === "p") preserve = true;
        else if (ch === "T") noTargetDir = true;
        else if (ch === "t") {
          const rest = a.slice(j + 1) || opArgs[++i];
          if (!rest) return undefined;
          targetDir = rest;
          break;
        } else return undefined;
      }
      continue;
    }
    return undefined;
  }
  if (!statTypeSync || !readFileSync || !writeFileSync || (noTargetDir && targetDir !== undefined)) return undefined;
  let sources: string[];
  let destBase: string;
  let intoDir = false;
  if (targetDir !== undefined) {
    if (operands.length === 0 || statTypeSync(targetDir) !== "directory") return undefined;
    sources = operands;
    destBase = targetDir;
    intoDir = true;
  } else {
    if (operands.length < 2) return undefined;
    destBase = operands[operands.length - 1]!;
    sources = operands.slice(0, -1);
    const dstSt = statTypeSync(destBase);
    if (dstSt === "directory") {
      if (noTargetDir) return undefined;
      intoDir = true;
    } else if (operands.length > 2) {
      return undefined;
    }
  }
  let out = "";
  for (const src of sources) {
    if (statTypeSync(src) !== "file") return undefined;
    let dst = destBase;
    if (intoDir) {
      const base = src.replace(/\/+$/, "").split("/").pop() || "";
      if (!base) return undefined;
      dst = `${destBase.replace(/\/+$/, "")}/${base}`;
    }
    if (src === dst) return undefined;
    const finalSt = statTypeSync(dst);
    if (finalSt !== "missing" && finalSt !== "file") return undefined;
    if (finalSt === "file" && noClobber) continue;
    const srcMode = statModeSync ? statModeSync(src) : undefined;
    const createMode = preserve ? ((srcMode ?? 0o666) & 0o777) : (((srcMode ?? 0o666) & 0o777) & ~umask);
    const bytes = readFileSync(src);
    if (!bytes || !writeFileSync(dst, bytes, false, createMode)) return undefined;
    if (verbose) out += `'${src}' -> '${dst}'\n`;
  }
  return out;
}

export function evalSyncMv(
  opArgs: readonly string[],
  statTypeSync?: (filePath: string) => string | undefined,
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array, append: boolean, mode?: number) => boolean,
  rmSync?: (filePath: string) => boolean,
  statModeSync?: (filePath: string) => number | undefined,
): string | undefined {
  const gnuInfo = gnuInfoSyncInternal("mv", opArgs);
  if (gnuInfo !== undefined) return gnuInfo;
  let verbose = false;
  let noTargetDir = false;
  let noClobber = false;
  let targetDir: string | undefined;
  let ended = false;
  const operands: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (ended || !a.startsWith("-") || a === "-") {
      operands.push(a);
      continue;
    }
    if (a === "--") { ended = true; continue; }
    if (a === "-v" || a === "--verbose") { verbose = true; continue; }
    if (a === "-f" || a === "--force") continue;
    if (a === "-n" || a === "--no-clobber") { noClobber = true; continue; }
    if (a === "-T" || a === "--no-target-directory") { noTargetDir = true; continue; }
    if (a === "-t" || a === "--target-directory" || a.startsWith("--target-directory=")) {
      const td = a.startsWith("--target-directory=") ? a.slice(19) : opArgs[++i];
      if (!td) return undefined;
      targetDir = td;
      continue;
    }
    if (a.startsWith("-") && !a.startsWith("--")) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "v") verbose = true;
        else if (ch === "f") continue;
        else if (ch === "n") noClobber = true;
        else if (ch === "T") noTargetDir = true;
        else if (ch === "t") {
          const rest = a.slice(j + 1) || opArgs[++i];
          if (!rest) return undefined;
          targetDir = rest;
          break;
        } else return undefined;
      }
      continue;
    }
    return undefined;
  }
  if (!statTypeSync || !readFileSync || !writeFileSync || !rmSync || (noTargetDir && targetDir !== undefined)) return undefined;
  let sources: string[];
  let destBase: string;
  let intoDir = false;
  if (targetDir !== undefined) {
    if (operands.length === 0 || statTypeSync(targetDir) !== "directory") return undefined;
    sources = operands;
    destBase = targetDir;
    intoDir = true;
  } else {
    if (operands.length < 2) return undefined;
    destBase = operands[operands.length - 1]!;
    sources = operands.slice(0, -1);
    const dstSt = statTypeSync(destBase);
    if (dstSt === "directory") {
      if (noTargetDir) return undefined;
      intoDir = true;
    } else if (operands.length > 2) {
      return undefined;
    }
  }
  let out = "";
  for (const src of sources) {
    if (statTypeSync(src) !== "file") return undefined;
    let dst = destBase;
    if (intoDir) {
      const base = src.replace(/\/+$/, "").split("/").pop() || "";
      if (!base) return undefined;
      dst = `${destBase.replace(/\/+$/, "")}/${base}`;
    }
    if (src === dst) return undefined;
    const finalSt = statTypeSync(dst);
    if (finalSt !== "missing" && finalSt !== "file") return undefined;
    if (finalSt === "file" && noClobber) continue;
    const srcMode = statModeSync ? statModeSync(src) : undefined;
    const bytes = readFileSync(src);
    if (!bytes) return undefined;
    if (finalSt === "file" && !rmSync(dst)) return undefined;
    if (!writeFileSync(dst, bytes, false, srcMode) || !rmSync(src)) return undefined;
    if (verbose) out += `renamed '${src}' -> '${dst}'\n`;
  }
  return out;
}

export function evalSyncRmdir(
  opArgs: readonly string[],
  statTypeSync?: (filePath: string) => string | undefined,
  listDirSync?: (filePath: string) => readonly string[] | ReadonlyMap<string, unknown> | undefined,
  rmSync?: (filePath: string) => boolean,
): string | undefined {
  const gnuInfo = gnuInfoSyncInternal("rmdir", opArgs);
  if (gnuInfo !== undefined) return gnuInfo;
  let verbose = false;
  let parents = false;
  let ignoreNonEmpty = false;
  let ended = false;
  const operands: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (ended || !a.startsWith("-") || a === "-") {
      operands.push(a);
      continue;
    }
    if (a === "--") { ended = true; continue; }
    if (a === "-v" || a === "--verbose") { verbose = true; continue; }
    if (a === "-p" || a === "--parents") { parents = true; continue; }
    if (a === "--ignore-fail-on-non-empty") { ignoreNonEmpty = true; continue; }
    if (a.startsWith("-") && !a.startsWith("--")) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "v") verbose = true;
        else if (ch === "p") parents = true;
        else return undefined;
      }
      continue;
    }
    return undefined;
  }
  if (operands.length === 0 || !statTypeSync || !listDirSync || !rmSync) return undefined;
  const plan: string[][] = [];
  for (const rawDir of operands) {
    const chain: string[] = [];
    let cur = rawDir;
    while (true) {
      if (cur === "/" || cur === "." || cur === ".." || cur.endsWith("/.") || cur.endsWith("/..")) return undefined;
      if (statTypeSync(cur) !== "directory") return undefined;
      const entries = listDirSync(cur);
      if (!entries) return undefined;
      const count = "size" in entries ? entries.size : entries.length;
      const expectedCount = chain.length === 0 ? 0 : 1;
      if (count !== expectedCount) {
        if (ignoreNonEmpty) break;
        return undefined;
      }
      chain.push(cur);
      if (!parents) break;
      const trimmed = cur.replace(/\/+$/, "");
      const slash = trimmed.lastIndexOf("/");
      if (slash <= 0) break;
      cur = trimmed.slice(0, slash);
    }
    plan.push(chain);
  }
  let out = "";
  for (const chain of plan) {
    for (const cur of chain) {
      if (!rmSync(cur)) return undefined;
      if (verbose) out += `rmdir: removing directory, '${cur}'\n`;
    }
  }
  return out;
}

export function evalSyncSleep(opArgs: readonly string[]): string | undefined {
  const gnuInfo = gnuInfoSyncInternal("sleep", opArgs);
  if (gnuInfo !== undefined) return gnuInfo;
  if (opArgs.length === 0) return undefined;
  let count = 0;
  for (const a of opArgs) {
    if (a === "--") continue;
    if (!/^\+?0+(\.0+)?[smhd]?$/u.test(a)) return undefined;
    count++;
  }
  return count > 0 ? "" : undefined;
}

syncCommandEvaluators.evalSyncTee = evalSyncTee;
syncCommandEvaluators.evalSyncTouch = evalSyncTouch;
syncCommandEvaluators.evalSyncCp = evalSyncCp;
syncCommandEvaluators.evalSyncMv = evalSyncMv;
syncCommandEvaluators.evalSyncRmdir = evalSyncRmdir;
syncCommandEvaluators.evalSyncSleep = evalSyncSleep;


export function evalSyncMkdir(
  opArgs: readonly string[],
  umask: number,
  statTypeSync?: (filePath: string) => string | undefined,
  mkdirSync?: (filePath: string, recursive: boolean, mode: number) => boolean,
): string | undefined {
  const gnuInfo = gnuInfoSyncInternal("mkdir", opArgs);
  if (gnuInfo !== undefined) return gnuInfo;
  if (!statTypeSync || !mkdirSync) return undefined;
  let parents = false;
  let verbose = false;
  let modeSpec: string | undefined;
  let ended = false;
  const operands: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (ended || !a.startsWith("-") || a === "-") {
      operands.push(a);
      continue;
    }
    if (a === "--") { ended = true; continue; }
    if (a === "-p" || a === "--parents") { parents = true; continue; }
    if (a === "-v" || a === "--verbose") { verbose = true; continue; }
    if (a === "-m" || a === "--mode") {
      modeSpec = opArgs[++i];
      if (modeSpec === undefined) return undefined;
      continue;
    }
    if (a.startsWith("--mode=")) { modeSpec = a.slice(7); continue; }
    if (a.startsWith("-m") && a.length > 2) { modeSpec = a.slice(2); continue; }
    if (a.startsWith("-") && !a.startsWith("--")) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "p") parents = true;
        else if (ch === "v") verbose = true;
        else if (ch === "m") {
          const rest = a.slice(j + 1);
          modeSpec = rest || opArgs[++i];
          if (modeSpec === undefined) return undefined;
          break;
        } else return undefined;
      }
      continue;
    }
    return undefined;
  }
  if (operands.length === 0) return undefined;
  let mode = 0o777 & ~umask;
  if (modeSpec !== undefined) {
    if (/^[0-7]{1,4}$/.test(modeSpec)) {
      mode = Number.parseInt(modeSpec, 8);
    } else {
      let cur = mode;
      for (const clause of modeSpec.split(",")) {
        const m = /^([ugoa]*)((?:[+=-][rwxXstugo]*)+)$/.exec(clause);
        if (!m) return undefined;
        const who = m[1]!;
        const all = !who || who.includes("a");
        const uMask = (all || who.includes("u") ? 0o4700 : 0) | (all || who.includes("g") ? 0o2070 : 0) | (all || who.includes("o") ? 0o1007 : 0);
        for (const opMatch of m[2]!.matchAll(/([+=-])([rwxXstugo]*)/g)) {
          const op = opMatch[1]!;
          const perms = opMatch[2]!;
          let bits = 0;
          for (const ch of perms) {
            if (ch === "r") bits |= 0o0444;
            else if (ch === "w") bits |= 0o0222;
            else if (ch === "x" || ch === "X") bits |= 0o0111;
            else if (ch === "s") bits |= 0o6000;
            else if (ch === "t") bits |= 0o1000;
            else return undefined;
          }
          const masked = bits & (who ? uMask : (0o7000 | (0o0777 & ~umask)));
          if (op === "+") cur |= masked;
          else if (op === "-") cur &= ~masked;
          else cur = (cur & ~uMask) | (bits & uMask);
        }
      }
      mode = cur & 0o7777;
    }
  }
  for (const dir of operands) {
    const st = statTypeSync(dir);
    if (parents) {
      if (st !== "missing" && st !== "directory") return undefined;
    } else {
      if (st !== "missing") return undefined;
    }
  }
  let out = "";
  for (const dir of operands) {
    if (parents && verbose) {
      const parts = dir.split("/").filter(Boolean);
      let cur = dir.startsWith("/") ? "" : ".";
      for (let idx = 0; idx < parts.length; idx++) {
        const part = parts[idx]!;
        cur = cur === "" ? "/" + part : cur === "." ? part : cur + "/" + part;
        const st = statTypeSync(cur);
        if (st === "directory") continue;
        if (st !== "missing") return undefined;
        const stepMode = idx === parts.length - 1 ? mode : (0o777 & ~umask);
        if (!mkdirSync(cur, false, stepMode)) return undefined;
        out += `mkdir: created directory '${cur}'\n`;
      }
      continue;
    }
    const st = statTypeSync(dir);
    if (parents && st === "directory") continue;
    if (!mkdirSync(dir, parents, mode)) return undefined;
    if (verbose) out += `mkdir: created directory '${dir}'\n`;
  }
  return out;
}

export function evalSyncRm(
  opArgs: readonly string[],
  statTypeSync?: (filePath: string) => string | undefined,
  listDirSync?: (filePath: string) => readonly string[] | ReadonlyMap<string, unknown> | undefined,
  rmSync?: (filePath: string) => boolean,
): string | undefined {
  const gnuInfo = gnuInfoSyncInternal("rm", opArgs);
  if (gnuInfo !== undefined) return gnuInfo;
  if (!statTypeSync || !listDirSync || !rmSync) return undefined;
  let force = false;
  let recursive = false;
  let dirFlag = false;
  let verbose = false;
  let ended = false;
  const operands: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (ended || !a.startsWith("-") || a === "-") {
      operands.push(a);
      continue;
    }
    if (a === "--") { ended = true; continue; }
    if (a === "-f" || a === "--force") { force = true; continue; }
    if (a === "-r" || a === "-R" || a === "--recursive") { recursive = true; continue; }
    if (a === "-d" || a === "--dir") { dirFlag = true; continue; }
    if (a === "-v" || a === "--verbose") { verbose = true; continue; }
    if (a.startsWith("-") && !a.startsWith("--")) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "f") force = true;
        else if (ch === "r" || ch === "R") recursive = true;
        else if (ch === "d") dirFlag = true;
        else if (ch === "v") verbose = true;
        else return undefined;
      }
      continue;
    }
    return undefined;
  }
  if (operands.length === 0) return force ? "" : undefined;
  for (const f of operands) {
    if (f === "/" || f === "." || f === ".." || f.endsWith("/.") || f.endsWith("/..")) return undefined;
    const st = statTypeSync(f);
    if (st === "missing") {
      if (!force) return undefined;
    } else if (st === "directory") {
      const entries = listDirSync(f);
      const count = entries ? ("size" in entries ? entries.size : entries.length) : 1;
      if (!recursive) {
        if (!dirFlag || count > 0) return undefined;
      }
    } else if (st !== "file" && st !== "symlink") {
      return undefined;
    }
  }
  const collectRmVerbose = (p: string): string => {
    let chunk = "";
    const st = statTypeSync(p);
    if (st === "directory" && recursive) {
      const entries = listDirSync(p);
      const names = entries ? (Array.isArray(entries) ? entries : [...entries.keys()]) : [];
      for (const name of names) {
        chunk += collectRmVerbose(p.endsWith("/") ? `${p}${name}` : `${p}/${name}`);
      }
    }
    chunk += `removed '${p}'\n`;
    return chunk;
  };
  let out = "";
  for (const f of operands) {
    const st = statTypeSync(f);
    if (st === "missing") continue;
    const verboseLines = verbose ? collectRmVerbose(f) : "";
    if (!rmSync(f)) return undefined;
    if (verbose) out += verboseLines;
  }
  return out;
}

syncCommandEvaluators.evalSyncMkdir = evalSyncMkdir;
syncCommandEvaluators.evalSyncRm = evalSyncRm;

export function evalSyncLn(
  opArgs: readonly string[],
  statTypeSync?: (filePath: string) => string | undefined,
  rmSync?: (filePath: string) => boolean,
  linkSync?: (srcOrTarget: string, dstPath: string, symbolic: boolean) => boolean,
): string | undefined {
  const gnuInfo = gnuInfoSyncInternal("ln", opArgs);
  if (gnuInfo !== undefined) return gnuInfo;
  if (!statTypeSync || !rmSync || !linkSync) return undefined;
  let symbolic = false;
  let relative = false;
  let force = false;
  let verbose = false;
  let noDeref = false;
  let noTargetDir = false;
  let targetDir: string | undefined;
  let ended = false;
  const operands: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (ended || !a.startsWith("-") || a === "-") {
      operands.push(a);
      continue;
    }
    if (a === "--") { ended = true; continue; }
    if (a === "-s" || a === "--symbolic") { symbolic = true; continue; }
    if (a === "-r" || a === "--relative") { relative = true; continue; }
    if (a === "-f" || a === "--force") { force = true; continue; }
    if (a === "-v" || a === "--verbose") { verbose = true; continue; }
    if (a === "-n" || a === "--no-dereference") { noDeref = true; continue; }
    if (a === "-T" || a === "--no-target-directory") { noTargetDir = true; continue; }
    if (a === "-t" || a === "--target-directory" || a.startsWith("--target-directory=")) {
      const td = a.startsWith("--target-directory=") ? a.slice(19) : opArgs[++i];
      if (!td) return undefined;
      targetDir = td;
      continue;
    }
    if (a.startsWith("-") && !a.startsWith("--")) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "s") symbolic = true;
        else if (ch === "r") relative = true;
        else if (ch === "f") force = true;
        else if (ch === "v") verbose = true;
        else if (ch === "n") noDeref = true;
        else if (ch === "T") noTargetDir = true;
        else if (ch === "t") {
          const rest = a.slice(j + 1) || opArgs[++i];
          if (!rest) return undefined;
          targetDir = rest;
          break;
        } else return undefined;
      }
      continue;
    }
    return undefined;
  }
  if ((noTargetDir && targetDir !== undefined) || (relative && !symbolic)) return undefined;
  const normRel = (p: string): string[] => {
    const outParts: string[] = [];
    for (const seg of p.split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") {
        if (outParts.length > 0 && outParts[outParts.length - 1] !== "..") outParts.pop();
        else if (!p.startsWith("/")) outParts.push("..");
      } else outParts.push(seg);
    }
    return outParts;
  };
  const computeRelTarget = (srcPath: string, dstPath: string): string | undefined => {
    if (srcPath.startsWith("/") !== dstPath.startsWith("/")) return undefined;
    const dstDir = dstPath.includes("/") ? dstPath.slice(0, dstPath.lastIndexOf("/")) || "/" : ".";
    const fromParts = normRel(dstDir);
    const toParts = normRel(srcPath);
    if (fromParts.includes("..") || toParts.includes("..")) return undefined;
    let common = 0;
    while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common++;
    const up = Array.from({ length: fromParts.length - common }, () => "..");
    const rel = [...up, ...toParts.slice(common)].join("/");
    return rel || ".";
  };
  const pairs: [string, string][] = [];
  if (targetDir !== undefined) {
    if (operands.length === 0 || statTypeSync(targetDir) !== "directory") return undefined;
    for (const s of operands) {
      const base = s.replace(/\/+$/, "").split("/").pop() || "";
      if (!base) return undefined;
      pairs.push([s, `${targetDir.replace(/\/+$/, "")}/${base}`]);
    }
  } else if (operands.length === 1) {
    if (noTargetDir) return undefined;
    const s = operands[0]!;
    const base = s.replace(/\/+$/, "").split("/").pop() || "";
    if (!base) return undefined;
    pairs.push([s, `./${base}`]);
  } else if (operands.length >= 2) {
    const last = operands[operands.length - 1]!;
    const dstSt = statTypeSync(last);
    if (!noDeref && dstSt === "directory") {
      if (noTargetDir) return undefined;
      for (let idx = 0; idx < operands.length - 1; idx++) {
        const s = operands[idx]!;
        const base = s.replace(/\/+$/, "").split("/").pop() || "";
        if (!base) return undefined;
        pairs.push([s, `${last.replace(/\/+$/, "")}/${base}`]);
      }
    } else if (operands.length === 2) {
      pairs.push([operands[0]!, last]);
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }
  let out = "";
  for (const [src, dst] of pairs) {
    if (!symbolic && statTypeSync(src) !== "file") return undefined;
    if (src === dst) return undefined;
    let linkTarget = src;
    if (relative) {
      const rel = computeRelTarget(src, dst);
      if (!rel) return undefined;
      linkTarget = rel;
    }
    const finalSt = statTypeSync(dst);
    if (finalSt === "file" || finalSt === "symlink") {
      if (!force) return undefined;
      if (!rmSync(dst)) return undefined;
    } else if (finalSt !== "missing") {
      return undefined;
    }
    if (!linkSync(linkTarget, dst, symbolic)) return undefined;
    if (verbose) out += `'${dst}' ${symbolic ? "->" : "=>"} '${linkTarget}'\n`;
  }
  return out;
}

syncCommandEvaluators.evalSyncLn = evalSyncLn;

export function evalSyncCat(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  const gnuInfo = gnuInfoSyncInternal("cat", opArgs);
  if (gnuInfo !== undefined) return gnuInfo;
  let flagN = false;
  let flagB = false;
  let flagS = false;
  let flagE = false;
  let flagT = false;
  let flagV = false;
  let ended = false;
  const operands: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (ended || !a.startsWith("-") || a === "-") {
      operands.push(a);
      continue;
    }
    if (a === "--") { ended = true; continue; }
    if (a === "--number") { flagN = true; continue; }
    if (a === "--number-nonblank") { flagB = true; continue; }
    if (a === "--squeeze-blank") { flagS = true; continue; }
    if (a === "--show-ends") { flagE = true; continue; }
    if (a === "--show-tabs") { flagT = true; continue; }
    if (a === "--show-nonprinting") { flagV = true; continue; }
    if (a === "--show-all") { flagV = true; flagE = true; flagT = true; continue; }
    if (a.startsWith("-") && !a.startsWith("--")) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "n") flagN = true;
        else if (ch === "b") flagB = true;
        else if (ch === "s") flagS = true;
        else if (ch === "E") flagE = true;
        else if (ch === "T") flagT = true;
        else if (ch === "v") flagV = true;
        else if (ch === "A") { flagV = true; flagE = true; flagT = true; }
        else if (ch === "e") { flagV = true; flagE = true; }
        else if (ch === "t") { flagV = true; flagT = true; }
        else if (ch === "u") continue;
        else return undefined;
      }
      continue;
    }
    return undefined;
  }
  const chunks: Uint8Array[] = [];
  let totalIn = 0;
  if (operands.length === 0) {
    if (inBytes === undefined) return undefined;
    chunks.push(inBytes);
    totalIn += inBytes.byteLength;
  } else {
    for (const op of operands) {
      if (op === "-") {
        if (inBytes === undefined) return undefined;
        chunks.push(inBytes);
        totalIn += inBytes.byteLength;
      } else {
        if (!readFileSync) return undefined;
        const b = readFileSync(op);
        if (!b) return undefined;
        chunks.push(b);
        totalIn += b.byteLength;
      }
      if (totalIn > 16384) return undefined;
    }
  }
  if (!flagN && !flagB && !flagS && !flagE && !flagT && !flagV) {
    for (const c of chunks) {
      if (c.includes(0)) return undefined;
    }
    if (chunks.length === 1) return decoder.decode(chunks[0]!);
    const merged = new Uint8Array(totalIn);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.byteLength;
    }
    return decoder.decode(merged);
  }
  let lineStart = true;
  let blankCount = 0;
  let num = 1;
  let pendingCr = false;
  const showEndsOnlyCr = flagE && !flagV;
  const out: number[] = [];
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.byteLength; i++) {
      const byte = chunk[i]!;
      if (pendingCr) {
        pendingCr = false;
        if (byte === 10) { out.push(94, 77); }
        else { out.push(13); }
      }
      if (lineStart && byte === 10 && flagS && blankCount > 0) continue;
      if (lineStart && (flagB ? byte !== 10 : flagN)) {
        const digits = String(num++);
        const pad = Math.max(0, 6 - digits.length);
        for (let k = 0; k < pad; k++) out.push(32);
        for (let k = 0; k < digits.length; k++) out.push(digits.charCodeAt(k));
        out.push(9);
      }
      if (byte === 10) {
        if (flagE) out.push(36);
        out.push(10);
        blankCount = lineStart ? blankCount + 1 : 0;
        lineStart = true;
      } else {
        lineStart = false;
        blankCount = 0;
        if (byte === 13 && showEndsOnlyCr) {
          pendingCr = true;
        } else if (byte === 9) {
          if (flagT) out.push(94, 73);
          else out.push(9);
        } else if (flagV) {
          let visible = byte;
          if (visible >= 128) {
            out.push(77, 45);
            visible -= 128;
          }
          if (visible < 32) out.push(94, visible + 64);
          else if (visible === 127) out.push(94, 63);
          else out.push(visible);
        } else {
          if (byte === 0) return undefined;
          out.push(byte);
        }
      }
    }
  }
  if (pendingCr) out.push(13);
  return decoder.decode(Uint8Array.from(out));
}

export function evalSyncHeadTail(
  name: "head" | "tail",
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  const gnuInfo = gnuInfoSyncInternal(name, opArgs);
  if (gnuInfo !== undefined) return gnuInfo;
  let mode: "n" | "c" = "n";
  let countStr = "10";
  let headerMode: "default" | "q" | "v" = "default";
  let zeroTerminated = false;
  let ended = false;
  const operands: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (ended || (!a.startsWith("-") && !(name === "tail" && i === 0 && /^\+[0-9]+$/.test(a))) || a === "-") {
      operands.push(a);
      continue;
    }
    if (a === "--") { ended = true; continue; }
    if (a === "-q" || a === "--quiet" || a === "--silent") { headerMode = "q"; continue; }
    if (a === "-v" || a === "--verbose") { headerMode = "v"; continue; }
    if (a === "-z" || a === "--zero-terminated") { zeroTerminated = true; continue; }
    if (a === "-n" || a === "--lines") {
      if (i + 1 >= opArgs.length) return undefined;
      mode = "n";
      countStr = opArgs[++i]!;
      continue;
    }
    if (a === "-c" || a === "--bytes") {
      if (i + 1 >= opArgs.length) return undefined;
      mode = "c";
      countStr = opArgs[++i]!;
      continue;
    }
    if (a.startsWith("--lines=")) { mode = "n"; countStr = a.slice(8); continue; }
    if (a.startsWith("--bytes=")) { mode = "c"; countStr = a.slice(8); continue; }
    if (/^-[0-9]+$/.test(a) || (name === "tail" && i === 0 && /^\+[0-9]+$/.test(a))) {
      mode = "n";
      countStr = a.startsWith("-") ? a.slice(1) : a;
      continue;
    }
    if (a.startsWith("-") && !a.startsWith("--")) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "q") headerMode = "q";
        else if (ch === "v") headerMode = "v";
        else if (ch === "z") zeroTerminated = true;
        else if (ch === "n" || ch === "c") {
          mode = ch;
          const rest = a.slice(j + 1) || opArgs[++i];
          if (!rest) return undefined;
          countStr = rest;
          break;
        } else return undefined;
      }
      continue;
    }
    return undefined;
  }
  const mCount = /^([+-]?)([0-9]{1,6})(b|kB|K|MB|M)?$/.exec(countStr);
  if (!mCount) return undefined;
  const mult = mCount[3] === "b" ? 512 : mCount[3] === "kB" ? 1000 : mCount[3] === "K" ? 1024 : mCount[3] === "MB" ? 1000000 : mCount[3] === "M" ? 1048576 : 1;
  const count = Number(mCount[2]!) * mult;
  const isPlus = countStr.startsWith("+");
  const isMinus = countStr.startsWith("-");
  if (name === "head" && isPlus) return undefined;
  if (name === "tail" && isMinus && mode === "c") return undefined;
  const targets = operands.length > 0 ? operands : ["-"];
  const showHeaders = headerMode === "v" || (headerMode !== "q" && targets.length > 1);
  let out = "";
  for (let idx = 0; idx < targets.length; idx++) {
    const t = targets[idx]!;
    let bytes: Uint8Array | undefined;
    if (t === "-") {
      if (inBytes === undefined) return undefined;
      bytes = inBytes;
    } else {
      if (!readFileSync) return undefined;
      bytes = readFileSync(t);
    }
    if (!bytes || (!zeroTerminated && bytes.includes(0))) return undefined;
    const text = decoder.decode(bytes);
    if (showHeaders) {
      out += `${idx > 0 ? "\n" : ""}==> ${t === "-" ? "standard input" : t} <==\n`;
    }
    if (mode === "c") {
      if (name === "head") {
        out += isMinus ? (count === 0 ? text : decoder.decode(bytes.subarray(0, Math.max(0, bytes.byteLength - count)))) : decoder.decode(bytes.subarray(0, count));
      } else {
        out += isPlus ? decoder.decode(bytes.subarray(Math.max(0, count - 1))) : (count === 0 ? "" : decoder.decode(bytes.subarray(Math.max(0, bytes.byteLength - count))));
      }
    } else {
      // Split preserving record terminators
      const termCode = zeroTerminated ? 0 : 10;
      const lines: string[] = [];
      let start = 0;
      for (let k = 0; k < text.length; k++) {
        if (text.charCodeAt(k) === termCode) {
          lines.push(text.slice(start, k + 1));
          start = k + 1;
        }
      }
      if (start < text.length) lines.push(text.slice(start));
      let selected: string[];
      if (name === "head") {
        selected = isMinus ? (count === 0 ? lines : lines.slice(0, Math.max(0, lines.length - count))) : lines.slice(0, count);
      } else {
        selected = isPlus ? lines.slice(Math.max(0, count - 1)) : (count === 0 ? [] : lines.slice(-count));
      }
      out += selected.join("");
    }
  }
  return out;
}

syncCommandEvaluators.evalSyncCat = evalSyncCat;
syncCommandEvaluators.evalSyncHeadTail = evalSyncHeadTail;

export function evalSyncWc(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  singleByte: boolean,
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  const gnuInfo = gnuInfoSyncInternal("wc", opArgs);
  if (gnuInfo !== undefined) return gnuInfo;
  const flags = new Set<string>();
  let totalMode = "auto";
  let hasFiles0From = false;
  let ended = false;
  const operands: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (ended || !a.startsWith("-") || a === "-") {
      operands.push(a);
      continue;
    }
    if (a === "--") { ended = true; continue; }
    if (a === "--lines") { flags.add("l"); continue; }
    if (a === "--words") { flags.add("w"); continue; }
    if (a === "--chars") { flags.add("m"); continue; }
    if (a === "--bytes") { flags.add("c"); continue; }
    if (a === "--max-line-length") { flags.add("L"); continue; }
    if (a === "--total") {
      if (i + 1 >= opArgs.length) return undefined;
      totalMode = opArgs[++i]!;
      continue;
    }
    if (a.startsWith("--total=")) {
      totalMode = a.slice(8);
      continue;
    }
    if (a === "--files0-from" || a.startsWith("--files0-from=")) {
      hasFiles0From = true;
      const f0 = a === "--files0-from" ? opArgs[++i] : a.slice(14);
      if (!f0) return undefined;
      const fBytes = f0 === "-" ? inBytes : readFileSync?.(f0);
      if (!fBytes || fBytes.byteLength > 16384) return undefined;
      const fText = decoder.decode(fBytes);
      const parts = fText.endsWith("\0") ? fText.slice(0, -1).split("\0") : (fText.length === 0 ? [] : fText.split("\0"));
      for (const p of parts) {
        if (!p) return undefined;
        operands.push(p);
      }
      continue;
    }
    if (a.startsWith("-") && !a.startsWith("--")) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "l" || ch === "w" || ch === "m" || ch === "c" || ch === "L") {
          flags.add(ch);
        } else {
          return undefined;
        }
      }
      continue;
    }
    return undefined;
  }
  if (!["auto", "always", "only", "never"].includes(totalMode)) return undefined;
  if (flags.size === 0) {
    flags.add("l");
    flags.add("w");
    flags.add("c");
  }
  const selected = ["l", "w", "m", "c", "L"].filter(f => flags.has(f));
  if (hasFiles0From && operands.length === 0) return "";
  const names = operands.length > 0 ? operands : ["-"];
  const buffers: Uint8Array[] = [];
  let totalBytesAll = 0;
  for (const name of names) {
    let b: Uint8Array | undefined;
    if (name === "-") {
      if (inBytes === undefined) return undefined;
      b = inBytes;
    } else {
      if (!readFileSync) return undefined;
      b = readFileSync(name);
      if (!b) return undefined;
    }
    totalBytesAll += b.byteLength;
    if (totalBytesAll > 65536) return undefined;
    if (!singleByte && (flags.has("w") || flags.has("L")) && b.some(byte => byte >= 128)) {
      return undefined;
    }
    buffers.push(b);
  }
  let width = 1;
  if (totalMode !== "only" && (names.length > 1 || selected.length > 1)) {
    let totalSize = 0;
    for (let i = 0; i < names.length; i++) {
      if (names[i] === "-") {
        width = Math.max(width, 7);
      } else {
        totalSize += buffers[i]!.byteLength;
      }
    }
    width = Math.max(width, String(totalSize).length);
  }
  const totals: Record<string, number> = { l: 0, w: 0, m: 0, c: 0, L: 0 };
  const rows: string[] = [];
  const formatRow = (counts: Record<string, number>, label?: string): string =>
    selected.map(f => String(counts[f]).padStart(width)).join(" ") + (label === undefined ? "" : ` ${label}`) + "\n";

  for (let idx = 0; idx < names.length; idx++) {
    const name = names[idx]!;
    const buf = buffers[idx]!;
    let l = 0;
    let w = 0;
    let m = 0;
    const c = buf.byteLength;
    let maxL = 0;
    let columns = 0;
    let inWord = false;
    for (let i = 0; i < buf.byteLength; i++) {
      const byte = buf[i]!;
      if (byte === 10) {
        l++;
        inWord = false;
        if (columns > maxL) maxL = columns;
        columns = 0;
      } else if (byte === 32 || (byte >= 9 && byte <= 13)) {
        inWord = false;
        if (byte === 9) columns += 8 - (columns & 7);
        else if (byte === 13 || byte === 12) {
          if (columns > maxL) maxL = columns;
          columns = 0;
        } else if (byte === 32) {
          columns++;
        }
      } else if (byte >= 33 && byte < 127) {
        if (!inWord) {
          w++;
          inWord = true;
        }
        columns++;
      }
    }
    if (columns > maxL) maxL = columns;
    if (singleByte) {
      m = c;
    } else if (flags.has("m")) {
      m = Array.from(decoder.decode(buf)).length;
    }
    const counts: Record<string, number> = { l, w, m, c, L: maxL };
    totals.l! += l;
    totals.w! += w;
    totals.m! += m;
    totals.c! += c;
    totals.L = Math.max(totals.L!, maxL);
    if (totalMode !== "only") {
      rows.push(formatRow(counts, operands.length > 0 ? name : undefined));
    }
  }
  if (totalMode === "only") {
    rows.push(formatRow(totals));
  } else if (totalMode === "always" || (totalMode === "auto" && names.length > 1)) {
    rows.push(formatRow(totals, "total"));
  }
  return rows.join("");
}

syncCommandEvaluators.evalSyncWc = evalSyncWc;
