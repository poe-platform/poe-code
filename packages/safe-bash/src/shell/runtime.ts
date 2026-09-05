import { cancelTurn, monotonicNow, registerYieldCheckpoint, scheduleTurn, yieldTurn, type TurnHandle } from "../contracts/yield.js";
import {
  ACCESS_MODES, FsError, composeMiddleware, createBytePipe, pipeBytes, resolvePath, toByteSource, validateExitCode, writeText,
} from "../contracts/index.js";
import type {
  ByteSink, ByteSource, CommandContext, CommandInvoker, CommandRegistry, CommandResult, FileSystem, Middleware,
} from "../contracts/index.js";
import { concatShellValues, shellValueByteLength, shellValueBytes, shellValueFromBytes, shellValueText } from "../contracts/value.js";
import type { ShellValue, ValueReservation } from "../contracts/value.js";
import { createCommandArguments, getCommandArguments } from "../contracts/command.js";
import type { CommandArguments } from "../contracts/command.js";
import { ValueArena } from "./value-state.js";
import type { HeldValue, ValueScope, ValueStore } from "./value-state.js";
import type { Command, HereDocument, Pipeline, Redirect, Script, Word, WordPart } from "./parser.js";
import { compoundEntryWords, HereDocumentSyntaxError, hereDocumentWords, parseShellInputUnit, parseShellUnit } from "./parser.js";
import { SourceLineIndex } from "./source-line-index.js";
import { ShellLimitError, ShellSyntaxError } from "./types.js";
import type { ShellCommandContext, ShellInvokeOptions, ShellLimits } from "./types.js";
import { fileInput, ShellInput } from "./input.js";
import { evaluateArithmetic, prepareArithmetic } from "./arithmetic.js";
import { defaultMaxParseUnits, ParseBudget } from "./parse-budget.js";
import { BraceExpansionFailure, expandBraces } from "./brace-expansion.js";
import { evaluatePositionalArithmetic } from "./arithmetic-parameters.js";
import { compilePattern, matchesPattern } from "./pattern.js";
import { nextCodePointOffset, previousCodePointOffset, scanString, stringCheckpoint } from "./string-operations.js";
import { byteLocale } from "./locale.js";
import { functionDisplay } from "./display.js";
import { ConditionalUnsupported, evaluateConditional } from "./conditional.js";
import { invocationScope, throwCleanupFailures, type InvocationScope } from "./cleanup.js";
import { bindFileOutputBudget, openFileOutput } from "../contracts/filesystem-output.js";
import { outputFailure } from "../contracts/io.js";
import { executionCommands } from "../commands/execution.js";
import { formatPrintf, printfCommand } from "../commands/basic.js";
import { UsageError } from "../commands/internal.js";
import { cloneGetoptsState, createGetoptsState, GetoptsError, scanGetopts, withGetoptsIndex } from "./getopts.js";
import type { GetoptsState } from "./getopts.js";
import {
  activateChildCancellation, prepareChildCancellation, selectRuntimeCancellationOutcome, subscribeCancellation,
} from "./cancellation.js";
import type {
  CancellationAdmissionSnapshot, CancellationBoundary, CancellationControlOriginInput, CancellationOrigin,
  CancellationReport, CancellationSelection, CapturedCancellationOutcome, PreparedChildCancellation,
} from "./cancellation.js";
import { getArrayAssignment, getArraySelector, copyArraySelector, numericIndex, literalIndex, isQuoteMarker } from "./arrays/syntax.js";
import type { ArrayAssignment } from "./arrays/syntax.js";
import { ArrayFailure, ArrayOwner, exactSum } from "./arrays/ledger.js";
import { controlNames, IndexedBinding, textToken } from "./arrays/bindings.js";
import { arrayStore, guestArrays, requireArrays, snapshotState, stateMonitor, trackState } from "./arrays/state.js";
import { publishPipelineStatus } from "./pipestatus.js";
import type { Restoration } from "./arrays/state.js";
import type { Admission } from "./arrays/ledger.js";
import type { BindingWatch, OwnedText } from "./arrays/bindings.js";
import { EreProfileLimitError, EreSyntaxError, EreUnsupportedError } from "../commands/regex-execution/ere/errors.js";
import { EreLedger } from "../commands/regex-execution/ere/limits.js";
import { compileEre } from "../commands/regex-execution/ere/syntax.js";
import { matchEre } from "../commands/regex-execution/ere/matcher.js";
import type { EreFragment } from "../commands/regex-execution/ere/types.js";

export const defaultLimits: Required<ShellLimits> = {
  maxParseUnits: defaultMaxParseUnits,
  maxInputBytes: 32 * 1024 * 1024,
  maxOutputBytes: 16 * 1024 * 1024,
  maxCommands: 10_000,
  maxRedirects: 64,
  maxPipelineStages: 64,
  maxLoopIterations: 10_000,
  maxSubstitutionDepth: 64,
  maxSourceBytes: 1024 * 1024,
  maxExpansionFields: 10_000,
  maxExpansionBytes: 16 * 1024 * 1024,
  maxWallClockMs: 30_000,
  maxCpuMs: 30_000,
  pipeHighWaterMark: 64 * 1024,
};

const shellBuiltinNames = new Set([
  ":", "true", "false", "pwd", "cd", "set", "shift", "export", "local", "unset", "read",
  "exit", "return", "break", "continue", "command", "builtin", "type", "readonly", "echo", "printf", "test", "[", ".", "source", "eval", "getopts", "let", "pushd", "dirs", "popd", "shopt",
]);

const implementedBuiltins = new Set([...shellBuiltinNames].filter(name => !["echo", "printf", "test", "["].includes(name)));
const specialBuiltinNames = new Set([":", ".", "break", "continue", "eval", "exit", "export", "readonly", "return", "set", "shift", "unset"]);
const unsupportedSetOptionNames = new Set([
  "allexport", "emacs", "errtrace", "functrace", "hashall", "histexpand", "history",
  "ignoreeof", "interactive-comments", "keyword", "monitor", "noclobber", "noexec", "noglob", "nolog",
  "notify", "onecmd", "physical", "posix", "privileged", "verbose", "vi", "xtrace",
]);
type Discovery = { kind: "function" | "builtin" | "command" | "interpreter" | "file"; name: string };

export function resolveLimits(...limits: (ShellLimits | undefined)[]): Required<ShellLimits> {
  const result = Object.assign({}, defaultLimits, ...limits) as Required<ShellLimits>;
  for (const [key, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value < (key === "pipeHighWaterMark" ? 1 : 0)) {
      throw new RangeError(`${key} must be a ${key === "pipeHighWaterMark" ? "positive" : "nonnegative"} safe integer`);
    }
  }
  return result;
}

const budgetedSinks = new WeakMap<ByteSink, { budget: Budget; write: ByteSink["write"] }>();

export class Budget {
  readonly parsing: ParseBudget;
  readonly values: ValueArena;
  commands = 0;
  iterations = 0;
  bytes = 0;
  sourceBytes = 0;
  readonly controller = new AbortController();
  readonly signal: AbortSignal;
  #wallClockTimer: ReturnType<typeof setTimeout> | undefined;
  #wallClockDeadline = 0;
  #pipelineStages = 0;
  readonly #cpuStarted = monotonicNow();

  constructor(readonly limits: Required<ShellLimits>, signal?: AbortSignal) {
    this.signal = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
    this.parsing = new ParseBudget(limits.maxParseUnits, this.signal, error => this.controller.abort(error));
    this.values = new ValueArena(limits.maxExpansionBytes, limits.maxExpansionFields, () => this.signal.throwIfAborted(), limit => this.fail(limit));
    this.#wallClockDeadline = Date.now() + limits.maxWallClockMs;
    this.#armWallClock();
  }

  #armWallClock(): void {
    const remaining = this.#wallClockDeadline - Date.now();
    if (remaining <= 0) {
      this.controller.abort(new ShellLimitError("maxWallClockMs"));
      return;
    }
    this.#wallClockTimer = setTimeout(() => this.#armWallClock(), Math.min(remaining, 2_147_483_647));
    const timer = this.#wallClockTimer as ReturnType<typeof setTimeout> & { unref?: () => void };
    timer.unref?.();
  }

  close(): void {
    if (this.#wallClockTimer !== undefined) clearTimeout(this.#wallClockTimer);
    this.#wallClockTimer = undefined;
  }

  fail(limit: keyof ShellLimits): never {
    const error = new ShellLimitError(limit);
    this.controller.abort(error);
    throw error;
  }

  cpuCheckpoint(): void {
    this.signal.throwIfAborted();
    if (monotonicNow() - this.#cpuStarted > this.limits.maxCpuMs) this.fail("maxCpuMs");
  }

  tick(): void {
    this.cpuCheckpoint();
    this.signal.throwIfAborted();
    if (++this.commands > this.limits.maxCommands) this.fail("maxCommands");
  }

  reservePipelineStages(count: number): () => void {
    this.signal.throwIfAborted();
    if (count > this.limits.maxPipelineStages - this.#pipelineStages) this.fail("maxPipelineStages");
    this.#pipelineStages += count;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#pipelineStages -= count;
    };
  }

  loop(): void {
    this.signal.throwIfAborted();
    if (++this.iterations > this.limits.maxLoopIterations) this.fail("maxLoopIterations");
  }

  source(bytes: number): void {
    this.signal.throwIfAborted();
    if (bytes > this.limits.maxSourceBytes - this.sourceBytes) this.fail("maxSourceBytes");
    this.sourceBytes += bytes;
  }

  sink(sink: ByteSink, signal = this.signal): ByteSink {
    const ownership = budgetedSinks.get(sink);
    if (ownership?.budget === this && ownership.write === sink.write) return signalSink(sink, signal);
    const output: ByteSink = {
      ...(sink[outputFailure] ? { [outputFailure]: sink[outputFailure] } : {}),
      ...(sink.ownedOutput ? { ownedOutput: {
        consumerClosed: sink.ownedOutput.consumerClosed,
        write: async (chunk: Uint8Array) => {
          signal.throwIfAborted();
          if (!(chunk instanceof Uint8Array)) throw new TypeError("Shell output must be Uint8Array");
          if (chunk.byteLength > this.limits.maxOutputBytes - this.bytes) this.fail("maxOutputBytes");
          this.bytes += chunk.byteLength;
          await interruptible(sink.ownedOutput!.write(chunk), signal);
        },
      } } : {}),
      write: async (chunk) => {
        signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array)) throw new TypeError("Shell output must be Uint8Array");
        if (chunk.byteLength > this.limits.maxOutputBytes - this.bytes) this.fail("maxOutputBytes");
        this.bytes += chunk.byteLength;
        await interruptible(sink.write(chunk), signal);
      },
    };
    budgetedSinks.set(output, { budget: this, write: output.write });
    return output;
  }
}

export async function interruptible<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    throw signal.reason;
  }
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([promise, aborted]); }
  finally { signal.removeEventListener("abort", abort!); }
}

export class Capture implements ByteSink {
  readonly chunks: Uint8Array[] = [];
  length = 0;
  #tail: Uint8Array | undefined;
  #tailLength = 0;

  async write(chunk: Uint8Array): Promise<void> {
    if (!chunk.byteLength) return;
    let offset = 0;
    while (offset < chunk.byteLength) {
      if (!this.#tail || this.#tailLength === this.#tail.byteLength) {
        this.#tail = new Uint8Array(Math.max(4096, Math.min(64 * 1024, chunk.byteLength - offset)));
        this.#tailLength = 0;
        this.chunks.push(this.#tail.subarray(0, 0));
      }
      const size = Math.min(chunk.byteLength - offset, this.#tail.byteLength - this.#tailLength);
      this.#tail.set(chunk.subarray(offset, offset + size), this.#tailLength);
      this.#tailLength += size;
      offset += size;
      this.chunks[this.chunks.length - 1] = this.#tail.subarray(0, this.#tailLength);
    }
    this.length += chunk.byteLength;
  }

  bytes(): Uint8Array {
    const bytes = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  takeBytes(): Uint8Array {
    const chunk = this.chunks.length === 1 ? this.chunks[0] : undefined;
    const bytes = chunk && chunk.byteLength === chunk.buffer.byteLength ? chunk : this.bytes();
    this.chunks.length = 0;
    this.length = 0;
    this.#tail = undefined;
    this.#tailLength = 0;
    return bytes;
  }
}

interface GetoptsBinding {
  cursor: GetoptsState;
  integer: boolean;
}

interface SavedVariable {
  value: string | undefined;
  heldValue?: HeldValue;
  exported: boolean;
  readOnly?: boolean;
  getopts?: GetoptsBinding;
  superseded?: boolean;
}

interface TypedSavedVariable {
  readonly owner: ArrayOwner;
  readonly binding: IndexedBinding | undefined;
  readonly tickets: Admission;
  readonly prepared: { readonly name: OwnedText; readonly admission: Admission };
  readonly watch: BindingWatch;
  overlayVersion?: number;
  readonly scalarLegacy: boolean;
}

const typedSavedVariables = new WeakMap<SavedVariable, TypedSavedVariable>();
const valueScope = Symbol("shell value allocation scope");
const invokedValues = new WeakMap<WordPart, ShellValue>();

export interface State {
  cwd: string;
  variables: Record<string, string>;
  exported: Set<string>;
  functions: Map<string, Command>;
  positional: string[];
  positionalSetVersion?: number;
  sourceDepth?: number;
  arg0?: string;
  profile?: "bash" | "sh";
  readonlyVariables?: Set<string>;
  pathUnset?: boolean;
  status: number;
  substitutionStatus: number;
  depth: number;
  loopDepth: number;
  functionDepth: number;
  locals: Map<string, SavedVariable>[];
  getopts?: GetoptsBinding;
  directoryStack?: { readonly entries: readonly string[]; readonly bytes: number };
  directoryStackCwdPublication?: symbol;
  dotglob?: boolean;
  braceexpand?: boolean;
  pipefail: boolean;
  errexit?: boolean;
  nounset?: boolean;
  isolated?: boolean;
  redirectAssignments?: ReadonlyMap<string, ShellValue>;
}

interface IO {
  readonly [invocationScope]: InvocationScope;
  readonly [valueScope]?: ValueScope;
  readonly parameterDepth?: number;
  readonly execution?: { readonly ignoreErrexit: boolean };
  readonly stdin: ByteSource;
  readonly stdinIsDefault?: boolean;
  readonly stdout: ByteSink;
  readonly stderr: ByteSink;
  readonly diagnosticLine?: number;
  readonly diagnosticOffset?: number;
  readonly substitutionDiagnosticLine?: number;
  readonly substitutionDiagnosticLines?: ReadonlyMap<Command, number>;
  readonly scriptName?: string;
  descriptors?: ReadonlyMap<number, Descriptor>;
}

interface Descriptor {
  closed?: boolean;
  readonly input?: ByteSource;
  readonly stdinIsDefault?: boolean;
  readonly output?: ByteSink;
}

function isolateIO(io: IO): IO {
  return { ...io, ...(io.descriptors ? { descriptors: new Map([...io.descriptors].map(([number, descriptor]) => [number, { ...descriptor }])) } : {}) };
}

function activeIO(io: IO): IO {
  const input = io.descriptors?.get(0);
  const output = io.descriptors?.get(1);
  const error = io.descriptors?.get(2);
  if (!(input?.closed && input.input === io.stdin) && !(output?.closed && output.output === io.stdout) && !(error?.closed && error.output === io.stderr)) return io;
  return {
    ...io,
    ...(input?.closed && input.input === io.stdin ? { stdin: closedSource, stdinIsDefault: false } : {}),
    ...(output?.closed && output.output === io.stdout ? { stdout: closedSink } : {}),
    ...(error?.closed && error.output === io.stderr ? { stderr: closedSink } : {}),
  };
}

interface OutputFile {
  data: Uint8Array | undefined;
  references: number;
}

function appendOutputBytes(current: Uint8Array, chunk: Uint8Array): Uint8Array {
  const length = current.length + chunk.length;
  const bytes = current.buffer.byteLength - current.byteOffset >= length
    ? new Uint8Array(current.buffer, current.byteOffset, length)
    : new Uint8Array(Math.max(length, current.length * 2, 64));
  if (bytes.buffer !== current.buffer) bytes.set(current);
  bytes.set(chunk, current.length);
  return bytes.subarray(0, length);
}

type OutputCompletion = { reason: unknown } | { status: number };

class Flow extends Error {
  constructor(readonly kind: "exit" | "return" | "break" | "continue", readonly status: number, public levels = 1) {
    super(kind);
  }
}

const completedFlows = new WeakSet<Flow>();

function completedExit(status: number, kind: Flow["kind"] = "exit", levels = 1): Flow {
  const flow = new Flow(kind, status, levels);
  completedFlows.add(flow);
  return flow;
}

class ExecutionFailure extends Error {
  constructor(readonly original: unknown, readonly io: IO, readonly diagnostic?: string) { super(message(original)); }
}

class ExpansionFailure extends Error {
  constructor(message: string, readonly line?: number) { super(message); }
}

class CommandFailure extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

class FatalCommandFailure extends CommandFailure {}

class ParameterExpansionFailure extends ExpansionFailure {}

class NounsetFailure extends ExpansionFailure {}

class NounsetDiagnosticFailure extends Flow {
  constructor(readonly reason: unknown) { super("exit", 1); }
}

class PipelineClosed extends Error {
  readonly code = "EPIPE";
  constructor() { super("Pipeline consumer exited"); }
}

function signalSink(sink: ByteSink, signal: AbortSignal): ByteSink {
  const ownership = budgetedSinks.get(sink);
  const owned = ownership?.write === sink.write ? ownership : undefined;
  const write = owned ? owned.write.bind(sink) : (chunk: Uint8Array) => sink.write(chunk);
  const output: ByteSink = {
    ...(sink[outputFailure] ? { [outputFailure]: sink[outputFailure] } : {}),
    ...(sink.ownedOutput ? { ownedOutput: {
      consumerClosed: sink.ownedOutput.consumerClosed,
      async write(chunk: Uint8Array) { signal.throwIfAborted(); await interruptible(sink.ownedOutput!.write(chunk), signal); },
    } } : {}),
    async write(chunk) { signal.throwIfAborted(); await interruptible(write(chunk), signal); },
  };
  if (owned) budgetedSinks.set(output, { budget: owned.budget, write: output.write });
  return output;
}

async function cloneState(state: State, signal: AbortSignal, scope?: InvocationScope, inheritLocals = true): Promise<State> {
  const destination = await snapshotState(state, () => ({
    ...state,
    variables: Object.assign(Object.create(null) as Record<string, string>, state.variables),
    exported: new Set(state.exported), functions: new Map(state.functions), positional: [...state.positional],
    readonlyVariables: new Set(state.readonlyVariables),
    getopts: cloneGetoptsBinding(state),
    directoryStack: { entries: [...state.directoryStack?.entries ?? []], bytes: state.directoryStack?.bytes ?? 0 },
    locals: inheritLocals ? state.locals.map((scope) => new Map([...scope].map(([name, saved]) => [name, { ...saved, ...(saved.getopts ? { getopts: { integer: saved.getopts.integer, cursor: cloneGetoptsState(saved.getopts.cursor) } } : {}) }]))) : [],
  }), signal, async (destination, owner) => {
    const store = arrayStore(destination) ?? requireArrays(destination);
    for (let index = 0; index < destination.locals.length; index++) {
      const sourceFrame = state.locals[index]!;
      const copiedFrame = destination.locals[index]!;
      for (const [name, saved] of sourceFrame) {
        const typed = typedSavedVariables.get(saved);
        if (typed) {
          const copied = copiedFrame.get(name);
          if (!copied) throw new ArrayFailure("stale state snapshot");
          const savedOwner = ArrayOwner.create(owner.ledger, owner);
          let binding: IndexedBinding | undefined;
          let releaseBinding: Promise<void> | undefined;
          try {
            scope?.register(async () => { await savedOwner.completion; await releaseBinding; });
            const watch = await store.watch(name, savedOwner, signal);
            const tickets = savedOwner.reserve({ generation: true, version: true, epoch: true, slots: 1, metadata: 64, work: 14 });
            const token = await textToken(savedOwner, name, signal);
            const admission = savedOwner.reserve({ slots: 1, metadata: 32, work: 5 });
            binding = typed.binding?.retain();
            typedSavedVariables.set(copied, { owner: savedOwner, binding, tickets, prepared: { name: token, admission }, watch, scalarLegacy: typed.scalarLegacy });
            tickets.cleanup = () => {
              if (typedSavedVariables.delete(copied) && scope) releaseBinding = scope.cleanup(async () => { await binding?.release(); });
            };
          } catch (error) { await binding?.release(); await savedOwner.close(); throw error; }
        }
        await owner.ledger.checkpoint(signal);
      }
    }
  }, scope);
  try {
    for (const frame of destination.locals) for (const saved of frame.values()) {
      if (saved.heldValue) saved.heldValue = stateMonitor(destination)!.values.scope.hold(saved.heldValue.value);
    }
    return destination;
  } catch (error) { stateMonitor(destination)?.closeValues(); throw error; }
}

function cloneGetoptsBinding(state: State): GetoptsBinding {
  return { cursor: state.getopts ? cloneGetoptsState(state.getopts.cursor) : createGetoptsState(), integer: state.getopts?.integer ?? false };
}

function saveVariable(state: State, name: string): SavedVariable {
  const monitor = stateMonitor(state);
  const value = monitor?.values.get(name, state.variables[name] ?? "");
  const heldValue = state.variables[name] !== undefined && value !== undefined ? monitor!.values.scope.hold(value) : undefined;
  return { value: state.variables[name], ...(heldValue ? { heldValue } : {}), exported: state.exported.has(name), readOnly: state.readonlyVariables?.has(name) ?? false, ...(name === "OPTIND" ? { getopts: cloneGetoptsBinding(state) } : {}) };
}

function publishVariable(state: State, name: string, value: ShellValue): void {
  const text = shellValueText(value);
  const store = stateMonitor(state)?.values;
  if (store) store.publish(name, value, () => { state.variables[name] = text; return true; });
  else state.variables[name] = text;
}

async function restoreVariable(state: State, name: string, saved: SavedVariable): Promise<void> {
  try {
  const restoreScalar = (): void => {
    const store = stateMonitor(state)?.values;
    if (saved.value === undefined) delete state.variables[name];
    else if (saved.heldValue && store) {
      store.restoreHeld(name, saved.heldValue, () => { state.variables[name] = saved.value!; });
      delete saved.heldValue;
    } else publishVariable(state, name, saved.value);
  };
  const typed = typedSavedVariables.get(saved);
  if (typed) {
    typedSavedVariables.delete(saved);
    const store = requireArrays(state);
    let released: Promise<void> | undefined;
    stateMonitor(state)!.publish(typed.tickets, name, () => {
      if (typed.binding) {
        delete state.variables[name];
        released = store.publish(name, typed.binding, typed.tickets, typed.prepared, true);
      } else {
        released = store.remove(name, typed.tickets);
        restoreScalar();
      }
      if (saved.exported) state.exported.add(name);
      else state.exported.delete(name);
      if (!typed.scalarLegacy || name === "OPTIND") {
        if (saved.readOnly) { state.readonlyVariables ??= new Set(); state.readonlyVariables.add(name); }
        else state.readonlyVariables?.delete(name);
      }
      if (name === "OPTIND" && saved.getopts) state.getopts = saved.getopts;
    });
    typed.watch.close();
    await released;
    await typed.owner.close();
    return;
  }
  restoreScalar();
  if (saved.exported) state.exported.add(name);
  else state.exported.delete(name);
  if (name === "OPTIND" && saved.getopts) {
    state.getopts = { integer: saved.getopts.integer, cursor: cloneGetoptsState(saved.getopts.cursor) };
    if (!saved.readOnly) state.readonlyVariables?.delete(name);
    else { state.readonlyVariables ??= new Set(); state.readonlyVariables.add(name); }
  }
  } finally { saved.heldValue?.release(); delete saved.heldValue; }
}

function localDeclarationOptions(args: readonly string[], signal: AbortSignal): { readonly indexed: boolean; readonly offset: number; readonly error: string | undefined } {
  signal.throwIfAborted();
  let indexed = false;
  let offset = 0;
  while (args[offset]?.startsWith("-")) {
    signal.throwIfAborted();
    const option = args[offset++]!;
    if (option === "--") break;
    if (option !== "-a") return { indexed, offset, error: option };
    indexed = true;
  }
  return { indexed, offset, error: undefined };
}

function decimalIndex(value: string): number {
  let position = 0;
  while (position < value.length && /[\t\n\v\f\r ]/u.test(value[position]!)) position++;
  const negative = value[position] === "-";
  if (negative || value[position] === "+") position++;
  let index = 0;
  for (; position < value.length; position++) {
    const digit = value.charCodeAt(position) - 48;
    if (digit < 0 || digit > 9) break;
    index = (Math.imul(index, 10) + digit) | 0;
  }
  return negative ? -index | 0 : index;
}

function saturatedProduct(left: number, right: number): number {
  return right !== 0 && left > Math.floor(Number.MAX_SAFE_INTEGER / right) ? Number.MAX_SAFE_INTEGER : left * right;
}

function saturatedSum(left: number, right: number): number {
  return left > Number.MAX_SAFE_INTEGER - right ? Number.MAX_SAFE_INTEGER : left + right;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function filesystemDiagnostic(error: unknown, target: string): string | undefined {
  const descriptions: Readonly<Record<string, string>> = { ENOENT: "No such file or directory", EACCES: "Permission denied", EPERM: "Operation not permitted", ENOTDIR: "Not a directory", EISDIR: "Is a directory", ELOOP: "Too many levels of symbolic links", ENOSPC: "No space left on device", EROFS: "Read-only file system" };
  const description = descriptions[errorCode(error) ?? ""];
  return description ? `${target}: ${description}` : undefined;
}

function cdUtf8Width(codePoint: number): number {
  return codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
}

function cdDiagnostic(fragments: readonly string[]): string {
  const chunks: string[] = [];
  let bytes = 0;
  let suffixBoundary = 0;
  let units = 0;
  for (const fragment of fragments) {
    let index = 0;
    while (index < fragment.length) {
      const codePoint = fragment.codePointAt(index)!;
      const width = cdUtf8Width(codePoint);
      if (bytes + width > 65_792) {
        chunks.push(fragment.slice(0, index));
        return `${chunks.join("").slice(0, suffixBoundary)} [truncated]`;
      }
      bytes += width;
      const length = codePoint > 0xffff ? 2 : 1;
      index += length;
      units += length;
      if (bytes <= 65_780) suffixBoundary = units;
    }
    chunks.push(fragment);
  }
  return chunks.join("");
}

class CdLookup {
  private spent = 0;
  private probes = 0;

  constructor(private readonly signal: AbortSignal) {}

  private async charge(amount: number): Promise<void> {
    this.signal.throwIfAborted();
    if (amount > 8_388_608 - this.spent) throw new Error("cd: helper work limit exceeded");
    while (amount > 0) {
      const step = Math.min(amount, 128 - this.spent % 128);
      this.spent += step;
      amount -= step;
      if (this.spent % 128 === 0) {
        this.signal.throwIfAborted();
        await yieldTurn(this.signal);
        this.signal.throwIfAborted();
      }
    }
  }

  private async scan(value: string, search = false): Promise<{
    bytes: number; components: { start: number; end: number; bytes: number }[];
  }> {
    let bytes = 0;
    let start = 0;
    let startBytes = 0;
    let slots = 1;
    const components: { start: number; end: number; bytes: number }[] = [];
    for (let index = 0; index < value.length;) {
      const codePoint = value.codePointAt(index)!;
      const width = cdUtf8Width(codePoint);
      if (bytes + width > 65_536) throw new Error(search ? "cd: CDPATH exceeds 65536 UTF-8 bytes" : "cd: path exceeds 65536 UTF-8 bytes");
      if (search && codePoint === 58 && ++slots > 4096) throw new Error("cd: CDPATH exceeds 4096 components");
      await this.charge(width);
      if (search && codePoint === 58) {
        components.push({ start, end: index, bytes: bytes - startBytes });
        start = index + 1;
        startBytes = bytes + width;
      }
      bytes += width;
      index += codePoint > 0xffff ? 2 : 1;
    }
    if (search) components.push({ start, end: value.length, bytes: bytes - startBytes });
    return { bytes, components };
  }

  async find(fs: FileSystem, cwd: string, target: string, cdpath: string | undefined): Promise<{ path: string; print: boolean }> {
    const targetBytes = (await this.scan(target)).bytes;
    const absolute = target.startsWith("/");
    const cwdBytes = absolute ? 0 : (await this.scan(cwd)).bytes;
    const eligible = !absolute && target !== "." && target !== ".." && !target.startsWith("./") && !target.startsWith("../");
    const search = eligible && cdpath ? await this.scan(cdpath, true) : undefined;
    const probe = async (component: string, componentBytes: number): Promise<string> => {
      const rawBytes = absolute ? targetBytes : component.startsWith("/") ? componentBytes + 1 + targetBytes
        : cwdBytes + 1 + (component ? componentBytes + 1 : 0) + targetBytes;
      if (rawBytes > 65_536) throw new Error("cd: path exceeds 65536 UTF-8 bytes");
      await this.charge(2 * rawBytes);
      const raw = absolute ? target : component.startsWith("/") ? `${component}/${target}`
        : component ? `${cwd}/${component}/${target}` : `${cwd}/${target}`;
      const path = resolvePath(cwd, raw);
      await this.scan(path);
      this.signal.throwIfAborted();
      if (++this.probes > 4097) throw new Error("cd: probe limit exceeded");
      await this.charge(1);
      this.signal.throwIfAborted();
      const stat = await fs.stat(path, { signal: this.signal });
      this.signal.throwIfAborted();
      if (stat.type !== "directory") throw new FsError("ENOTDIR", { path });
      await this.charge(1);
      this.signal.throwIfAborted();
      await fs.access(path, ACCESS_MODES.X_OK, { signal: this.signal });
      this.signal.throwIfAborted();
      return path;
    };
    for (const component of search?.components ?? []) {
      try {
        const path = await probe(cdpath!.slice(component.start, component.end), component.bytes);
        return { path, print: component.start !== component.end };
      } catch (error) {
        this.signal.throwIfAborted();
        if (!(error instanceof FsError) || !["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) throw error;
      }
    }
    return { path: await probe("", 0), print: false };
  }
}

class DirectoryStackWork {
  private spent = 0;
  private flushed = 0;
  private outputBytes = 0;
  private chunk = "";
  private chunkBytes = 0;

  constructor(private readonly name: string, private readonly signal: AbortSignal, private readonly stdout: ByteSink) {}

  fail(text: string, status = 1): never {
    throw new CommandFailure(cdDiagnostic([this.name, ": ", text]), status);
  }

  async charge(amount: number): Promise<void> {
    this.signal.throwIfAborted();
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 8_388_608 - this.spent) this.fail("helper work limit exceeded");
    while (amount > 0) {
      const step = Math.min(amount, 128 - this.spent % 128);
      this.spent += step;
      amount -= step;
      if (this.spent % 128 === 0) await this.flushWork();
    }
  }

  async flushWork(): Promise<void> {
    this.signal.throwIfAborted();
    if (this.flushed === this.spent) return;
    await yieldTurn(this.signal);
    this.signal.throwIfAborted();
    this.flushed = this.spent;
  }

  async scan(value: string, kind: "argument" | "path" | "HOME"): Promise<number> {
    let bytes = 0;
    for (let offset = 0; offset < value.length;) {
      const point = value.codePointAt(offset)!;
      const width = cdUtf8Width(point);
      if (width > 65_536 - bytes) this.fail(`${kind} exceeds 65536 UTF-8 bytes`);
      await this.charge(width);
      bytes += width;
      offset += point > 0xffff ? 2 : 1;
    }
    return bytes;
  }

  async number(token: string): Promise<bigint> {
    let phase: "leading" | "sign" | "digits" | "trailing" = "leading";
    let negative = false;
    let digits = false;
    let value = 0n;
    await this.charge(1);
    for (let offset = 1; offset < token.length; offset++) {
      await this.charge(1);
      const code = token.charCodeAt(offset);
      const whitespace = code === 32 || code >= 9 && code <= 13;
      if (phase === "leading" && whitespace) continue;
      if (phase === "leading" && (code === 43 || code === 45)) {
        negative = code === 45;
        phase = "sign";
        continue;
      }
      if (code >= 48 && code <= 57 && phase !== "trailing") {
        phase = "digits";
        digits = true;
        value = value * 10n + BigInt(code - 48);
        if (value > (negative ? 9_223_372_036_854_775_808n : 9_223_372_036_854_775_807n)) this.fail("invalid directory stack index", 2);
      } else if (phase === "digits" && whitespace || phase === "trailing" && whitespace) phase = "trailing";
      else this.fail("invalid directory stack index", 2);
    }
    if (!digits) this.fail("invalid directory stack index", 2);
    return negative ? -value : value;
  }

  async emit(text: string): Promise<void> {
    for (let offset = 0; offset < text.length;) {
      const point = text.codePointAt(offset)!;
      const width = cdUtf8Width(point);
      if (width > 8_388_608 - this.outputBytes) this.fail("display exceeds 8388608 UTF-8 bytes");
      await this.charge(width);
      if (width > 16_384 - this.chunkBytes) await this.flushOutput();
      const units = point > 0xffff ? 2 : 1;
      this.chunk += text.slice(offset, offset + units);
      this.chunkBytes += width;
      this.outputBytes += width;
      offset += units;
    }
  }

  async flushOutput(): Promise<void> {
    this.signal.throwIfAborted();
    if (!this.chunkBytes) return;
    const text = this.chunk;
    this.chunk = "";
    this.chunkBytes = 0;
    await writeText(this.stdout, text);
    this.signal.throwIfAborted();
  }

  async display(cwd: string, entries: readonly string[], options: { long: boolean; lines: boolean; verbose: boolean; index?: number }, home: string | undefined): Promise<void> {
    await this.scan(cwd, "path");
    const homeBytes = !options.long && home !== undefined ? await this.scan(home, "HOME") : 0;
    const start = options.index ?? 0;
    const end = options.index ?? entries.length;
    for (let index = start; index <= end; index++) {
      await this.charge(1);
      let entry = index === 0 ? cwd : entries[index - 1]!;
      if (homeBytes > 1 && home !== undefined && entry.length >= home.length) {
        let matches = true;
        for (let offset = 0; offset < home.length; offset++) {
          await this.charge(1);
          if (entry.charCodeAt(offset) !== home.charCodeAt(offset)) { matches = false; break; }
        }
        if (matches) {
          if (entry.length > home.length) await this.charge(1);
          if (entry.length === home.length || entry[home.length] === "/") entry = `~${entry.slice(home.length)}`;
        }
      }
      if (index !== start && !options.lines && !options.verbose) await this.emit(" ");
      if (options.verbose) await this.emit(`${String(index).padStart(2, " ")}  `);
      await this.emit(entry);
      if (options.lines || options.verbose) await this.emit("\n");
    }
    if (!options.lines && !options.verbose) await this.emit("\n");
    await this.flushOutput();
  }
}

const closedSink: ByteSink = { async write() { throw Object.assign(new Error("Bad file descriptor"), { code: "EBADF" }); } };
const closedSource: ByteSource = { [Symbol.asyncIterator]() {
  let closed = false;
  let completion = Promise.resolve();
  const enqueue = <Value>(operation: () => Value | PromiseLike<Value>): Promise<Value> => {
    const pending = completion.then(operation);
    completion = pending.then(() => {}, () => {});
    return pending;
  };
  const iterator: AsyncIterableIterator<Uint8Array> = {
    next() {
      return enqueue<IteratorResult<Uint8Array>>(() => {
        if (closed) return { done: true, value: undefined };
        closed = true;
        throw Object.assign(new Error("Bad file descriptor"), { code: "EBADF" });
      });
    },
    return(value?: unknown) { return enqueue(async () => { closed = true; return { done: true, value: await value }; }); },
    throw(error?: unknown) { return enqueue(() => { closed = true; throw error; }); },
    [Symbol.asyncIterator]() { return this; },
  };
  return iterator;
} };

interface RuntimeOutcomeFrame {
  report?: CancellationReport | undefined;
}

interface InvokeOutcomeRecord {
  readonly promise: Promise<CommandResult>;
  readonly boundary: CancellationBoundary;
  finalized: boolean;
  consumed: boolean;
  selection?: CancellationSelection<CommandResult> | undefined;
}

/** Internal to the shell/runtime pair; it is not exported by the package root. */
export class RuntimeCancellationState {
  readonly #records = new Set<InvokeOutcomeRecord>();
  #diagnostics = new WeakMap<object, NounsetDiagnosticFailure>();
  #closed = false;

  recordDiagnostic(promise: Promise<CommandResult>, failure: NounsetDiagnosticFailure): void {
    if (!this.#closed) this.#diagnostics.set(promise, failure);
  }

  consumeDiagnostic(rawReturn: unknown): NounsetDiagnosticFailure | undefined {
    if (rawReturn === null || typeof rawReturn !== "object" && typeof rawReturn !== "function") return undefined;
    const failure = this.#diagnostics.get(rawReturn);
    this.#diagnostics.delete(rawReturn);
    return failure;
  }

  bind(promise: Promise<CommandResult>, boundary: CancellationBoundary): InvokeOutcomeRecord {
    if (this.#closed) throw new Error("Cancellation outcome admission is closed");
    const record: InvokeOutcomeRecord = { promise, boundary, finalized: false, consumed: false };
    this.#records.add(record);
    return record;
  }

  finalize(record: InvokeOutcomeRecord, selection: CancellationSelection<CommandResult>): void {
    if (record.consumed || !this.#records.has(record)) return;
    record.selection = selection;
    record.finalized = true;
  }

  consume(rawReturn: unknown, capturedReason: unknown): CancellationReport | undefined {
    for (const record of this.#records) {
      if (record.promise !== rawReturn) continue;
      record.consumed = true;
      this.#records.delete(record);
      const selection = record.selection;
      if (!record.finalized || selection?.outcome.kind !== "throw"
        || !Object.is(selection.outcome.reason, capturedReason)) return undefined;
      return selection.report;
    }
    return undefined;
  }

  discard(record: InvokeOutcomeRecord | undefined): void {
    if (!record) return;
    record.consumed = true;
    this.#records.delete(record);
  }

  close(): void {
    this.#closed = true;
    for (const record of this.#records) record.consumed = true;
    this.#records.clear();
    this.#diagnostics = new WeakMap();
  }
}

interface CancellationAdmissionOwner {
  assertAdmissionOpen(): void;
}

class InvocationCancellationOwner implements CancellationAdmissionOwner {
  readonly finalized: Promise<void>;
  readonly #failures: unknown[];
  readonly #outcomes: RuntimeCancellationState;
  readonly #publicPromise: Promise<CommandResult> | undefined;
  #resolveFinalized!: () => void;
  #admissionOpen = true;
  #boundary: CancellationBoundary | undefined;
  #boundaryClosed = false;
  #record: InvokeOutcomeRecord | undefined;
  #observedOrigin: CancellationOrigin | undefined;
  #captureCancellation: ((origin: CancellationOrigin) => void) | undefined;
  #detach: (() => void) | undefined;
  #finish: Promise<CancellationSelection<CommandResult>> | undefined;

  constructor(
    parent: InvocationScope,
    readonly prepared: PreparedChildCancellation,
    outcomes: RuntimeCancellationState,
    publicPromise?: Promise<CommandResult>,
  ) {
    this.#failures = parent.failures;
    this.#outcomes = outcomes;
    this.#publicPromise = publicPromise;
    this.finalized = new Promise<void>(resolve => { this.#resolveFinalized = resolve; });
    parent.register(async () => {
      this.requestClose();
      await this.finalized;
    });
  }

  assertAdmissionOpen(): void {
    if (!this.#admissionOpen) throw new Error("Cancellation invocation admission is closed");
  }

  requestClose(): void { this.#admissionOpen = false; }

  activate(): CancellationBoundary {
    this.assertAdmissionOpen();
    const boundary = activateChildCancellation(this.prepared);
    this.#boundary = boundary;
    try {
      this.#detach = subscribeCancellation(boundary, origin => { this.#captureCancellation?.(origin); });
      if (this.#publicPromise) this.#record = this.#outcomes.bind(this.#publicPromise, boundary);
      return boundary;
    } catch (error) {
      this.#closeBoundary();
      throw error;
    }
  }

  capture(
    execute: () => Promise<CommandResult>,
    frame: RuntimeOutcomeFrame,
  ): Promise<CapturedCancellationOutcome<CommandResult>> {
    return new Promise(resolve => {
      let settled = false;
      let raw: Promise<CommandResult> | undefined;
      let queuedOrigin = false;
      const settle = (captured: CapturedCancellationOutcome<CommandResult>): void => {
        if (settled) return;
        settled = true;
        this.#captureCancellation = undefined;
        resolve(captured);
      };
      this.#captureCancellation = origin => {
        if (settled || queuedOrigin) return;
        queuedOrigin = true;
        queueMicrotask(() => {
          if (settled) return;
          this.#observedOrigin = origin;
          settle({ kind: "throw", reason: origin.signal.reason });
          void raw?.catch(() => undefined);
        });
      };
      try { raw = Promise.resolve(execute()); }
      catch (reason) { settle({ kind: "throw", reason }); return; }
      void raw.then(
        value => settle({ kind: "return", value }),
        reason => settle(frame.report && Object.is(frame.report.origin.signal.reason, reason)
          ? { kind: "throw", reason, report: frame.report }
          : { kind: "throw", reason }),
      );
      if (settled) void raw.catch(() => undefined);
    });
  }

  finish(barrier: Promise<void>, captured: CapturedCancellationOutcome<CommandResult>): Promise<CancellationSelection<CommandResult>> {
    this.#finish ??= this.#finishOnce(barrier, captured);
    return this.#finish;
  }

  async abandon(barrier: Promise<void>): Promise<void> {
    this.requestClose();
    try { await barrier; }
    finally {
      this.#outcomes.discard(this.#record);
      this.#closeBoundary();
      this.#resolveFinalized();
    }
  }

  async #finishOnce(barrier: Promise<void>, captured: CapturedCancellationOutcome<CommandResult>): Promise<CancellationSelection<CommandResult>> {
    this.requestClose();
    try {
      await barrier;
      this.#closeBoundary();
      const selection = selectRuntimeCancellationOutcome(this.#boundary!, captured, this.#observedOrigin);
      if (this.#record) this.#outcomes.finalize(this.#record, selection);
      return selection;
    } finally { this.#resolveFinalized(); }
  }

  #closeBoundary(): void {
    if (!this.#boundary || this.#boundaryClosed) return;
    this.#boundaryClosed = true;
    try { this.#detach?.(); } catch (error) { this.#failures.push(error); }
    this.#detach = undefined;
    const result = this.#boundary.close();
    this.#failures.push(...result.failures);
  }
}

export class Runtime {
  constructor(
    readonly fs: FileSystem,
    readonly commands: CommandRegistry,
    readonly middleware: readonly Middleware[],
    readonly budget: Budget,
    readonly signal: AbortSignal = budget.signal,
    readonly fileWrites = new Map<string, Promise<void>>(),
    readonly outputFiles = new Map<string, OutputFile>(),
    readonly commandSignal: AbortSignal = signal,
    readonly cancellation: CancellationBoundary,
    readonly cancellationState: RuntimeCancellationState,
    readonly cancellationOwner: CancellationAdmissionOwner | undefined,
    readonly cancellationDepth: number,
    readonly cancellationMaxDepth: number,
    readonly outcomeFrame: RuntimeOutcomeFrame | undefined = undefined,
  ) { registerYieldCheckpoint(this.signal, () => this.budget.cpuCheckpoint()); }

  private async ereDiagnostic(io: IO, detail: string): Promise<void> {
    try { await this.diagnostic(io, detail); }
    catch (reason) {
      this.signal.throwIfAborted();
      if (reason instanceof ShellLimitError) throw reason;
      throw new NounsetDiagnosticFailure(reason);
    }
  }

  private async ere(subject: string, pattern: Word, state: State, io: IO): Promise<number> {
    const scope = io[invocationScope];
    scope.assertOpen();
    const store = requireArrays(state);
    let operation: ArrayOwner | undefined;
    let holding: ReturnType<ArrayOwner["hold"]> | undefined;
    let staged: IndexedBinding | undefined;
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => closing ??= Promise.resolve().then(async () => {
      try { await staged?.release(); } finally { try { await operation?.close(); } finally { holding?.release(); } }
    });
    let primary = false;
    try {
      operation = ArrayOwner.create(store.owner.ledger, store.owner);
      holding = store.owner.hold();
      await this.prepareArrayObservers(state, operation);
      operation.reserve({ metadata: 64, allocatedSlots: 1, work: 2 });
      const fragments: EreFragment[] = [];
      await this.word(pattern, state, io, false, false, false, false, (text, literal) => {
        operation!.reserve({ metadata: 64, allocatedSlots: 1, payload: Buffer.byteLength(text), work: text.length + 2 });
        fragments.push({ text, literal });
      });
      const collation = state.variables.LC_ALL || state.variables.LC_COLLATE || state.variables.LANG || "C";
      const characters = state.variables.LC_ALL || state.variables.LC_CTYPE || state.variables.LANG || "C";
      if (![collation, characters].every(locale => locale === "C" || locale === "POSIX")) {
        await this.ereDiagnostic(io, "[[ unsupported ERE profile: locale must be C or POSIX");
        return 2;
      }
      await textToken(operation, subject, this.signal);
      const name = "BASH_REMATCH";
      const watch = await store.watch(name, operation, this.signal);
      const ledger = new EreLedger({
        maxExpansionBytes: this.budget.limits.maxExpansionBytes,
        maxExpansionFields: this.budget.limits.maxExpansionFields,
      });
      let result: Awaited<ReturnType<typeof matchEre>>;
      try {
        const program = await compileEre(fragments, ledger, this.signal);
        result = await matchEre(program, subject, ledger, this.signal);
      }
      catch (error) {
        this.signal.throwIfAborted();
        if (error instanceof EreSyntaxError || error instanceof EreUnsupportedError) {
          await this.ereDiagnostic(io, `[[ ${error.message}`);
          return 2;
        }
        throw error;
      }
      const status = result.matched ? 0 : 1;
      this.signal.throwIfAborted();
      scope.assertOpen();
      if (state.readonlyVariables?.has(name)) { await this.ereDiagnostic(io, `${name}: readonly variable`); return status; }
      if (state.exported.has(name)) throw new ArrayFailure("exported binding cannot be indexed");
      if (!watch.valid()) throw new ArrayFailure("stale binding");
      const supersede = await stateMonitor(state)!.prepareTypedPublication(name, operation, this.signal);
      const tickets = operation.reserve({ generation: true, version: true, epoch: true, work: 8 });
      const prepared = await store.prepareName(name, operation, this.signal);
      staged = IndexedBinding.create(store.owner);
      if (result.matched) for (let index = 0; index < result.captures.length; index++) {
        const span = result.captures[index]!;
        const size = span === null ? 0 : span.end - span.start;
        operation.reserve({ payload: size, metadata: 32, work: size + 2 });
        const value = span === null ? "" : subject.slice(span.start, span.end);
        const token = await textToken(staged.owner, value, this.signal);
        try { staged.insert(index, token); } catch (error) { token.release(); throw error; }
      }
      this.signal.throwIfAborted();
      scope.assertOpen();
      if (state.readonlyVariables?.has(name)) { await this.ereDiagnostic(io, `${name}: readonly variable`); return status; }
      if (state.exported.has(name)) throw new ArrayFailure("exported binding cannot be indexed");
      if (!watch.valid()) throw new ArrayFailure("stale binding");
      let released: Promise<void> | undefined;
      stateMonitor(state)!.publish(tickets, name, () => {
        supersede();
        delete state.variables[name];
        released = store.publish(name, staged!, tickets, prepared);
      });
      staged = undefined;
      watch.close();
      await released;
      return status;
    } catch (error) { primary = true; throw error; }
    finally {
      await close().catch(error => {
        if (primary) scope.failures.push(error);
        else throw new NounsetDiagnosticFailure(error);
      });
    }
  }

  static rootCancellationAdmission(budget: Budget): CancellationAdmissionSnapshot {
    const maxDepth = saturatedSum(budget.limits.maxCommands, saturatedSum(budget.limits.maxSubstitutionDepth, 1));
    return {
      depth: 0,
      maxDepth,
      resourceLimit: Runtime.cancellationResourceLimit(budget, 0, maxDepth, 2),
    };
  }

  private static cancellationResourceLimit(budget: Budget, depth: number, maxDepth: number, controls: number): number {
    const remainingCommands = Math.max(0, budget.limits.maxCommands - budget.commands);
    const remainingDepth = Math.max(0, maxDepth - depth);
    return saturatedSum(saturatedSum(4, controls), saturatedSum(remainingCommands, remainingDepth));
  }

  private cancellationAdmission(depth: number, controls = 0): CancellationAdmissionSnapshot {
    return {
      depth,
      maxDepth: this.cancellationMaxDepth,
      resourceLimit: Runtime.cancellationResourceLimit(this.budget, depth, this.cancellationMaxDepth, controls),
    };
  }

  private observeRuntimeReturn<Value>(
    rawReturn: Value | PromiseLike<Value>,
    frame: RuntimeOutcomeFrame,
    downstream: () => Promise<CommandResult> | undefined = () => undefined,
  ): Promise<Value> {
    const raw = rawReturn as unknown;
    return Promise.resolve(rawReturn).then(
      value => {
        if (raw !== downstream()) frame.report = undefined;
        return value;
      },
      reason => {
        const report = this.cancellationState.consume(raw, reason);
        if (report) frame.report = report;
        else if (raw !== downstream()) frame.report = undefined;
        const diagnostic = this.cancellationState.consumeDiagnostic(raw);
        if (diagnostic) throw diagnostic;
        throw reason;
      },
    );
  }

  private invokeChild(
    options: ShellInvokeOptions,
    state: State,
    parent: InvocationScope,
    validate: () => void,
    execute: (runtime: Runtime, scope: InvocationScope) => Promise<CommandResult>,
  ): Promise<CommandResult> {
    const publicPromise: Promise<CommandResult> = Promise.resolve().then(async () => {
      if (!this.cancellation.deliverySignal.aborted) parent.assertOpen();
      const childDepth = this.cancellationDepth + 1;
      const prepared = prepareChildCancellation(
        this.cancellation,
        options,
        this.cancellationAdmission(childDepth),
      );
      this.cancellationOwner?.assertAdmissionOpen();
      validate();

      let scope: InvocationScope | undefined;
      let boundary: CancellationBoundary;
      let owner: InvocationCancellationOwner | undefined;
      try {
        if (prepared.owned) {
          owner = new InvocationCancellationOwner(parent, prepared, this.cancellationState, publicPromise);
          scope = parent.child();
          boundary = owner.activate();
        } else {
          scope = parent.child();
          boundary = activateChildCancellation(prepared);
        }
      } catch (error) {
        if (owner) await owner.abandon(scope?.close() ?? Promise.resolve());
        else await scope?.close();
        throw error;
      }

      const frame: RuntimeOutcomeFrame = {};
      const runtime = new Runtime(
        this.fs,
        this.commands,
        this.middleware,
        this.budget,
        AbortSignal.any([boundary.deliverySignal, scope.signal]),
        this.fileWrites,
        this.outputFiles,
        boundary.deliverySignal,
        boundary,
        this.cancellationState,
        owner ?? this.cancellationOwner,
        prepared.owned ? childDepth : this.cancellationDepth,
        this.cancellationMaxDepth,
        frame,
      );
      let captured: CapturedCancellationOutcome<CommandResult>;
      const executeChild = (): Promise<CommandResult> => execute(runtime, scope);
      if (owner) captured = await owner.capture(executeChild, frame);
      else {
        try { captured = { kind: "return", value: await executeChild() }; }
        catch (reason) {
          captured = frame.report && Object.is(frame.report.origin.signal.reason, reason)
            ? { kind: "throw", reason, report: frame.report }
            : { kind: "throw", reason };
        }
      }

      let selection: CancellationSelection<CommandResult>;
      if (owner) selection = await owner.finish(scope.close(), captured);
      else {
        await scope.close();
        const close = boundary.close();
        scope.failures.push(...close.failures);
        selection = selectRuntimeCancellationOutcome(boundary, captured);
      }
      if (selection.outcome.kind === "throw") {
        const reason = selection.outcome.reason;
        if (reason instanceof NounsetDiagnosticFailure) {
          this.cancellationState.recordDiagnostic(publicPromise, reason);
          throw reason.reason;
        }
        throw reason;
      }
      return selection.outcome.value;
    });
    return publicPromise;
  }

  private clearOutcomeReport(): void {
    if (this.outcomeFrame) this.outcomeFrame.report = undefined;
  }

  diagnostic(io: IO, text: string): Promise<void> {
    return writeText(io.stderr, `${io.scriptName ?? "shell"}: line ${io.diagnosticLine ?? 1}: ${text}\n`);
  }

  writeVariable(state: State, name: string, value: ShellValue, origin: "assignment" | "arithmetic" | "getopts" = "assignment"): void {
    if (arrayStore(state)?.get(name)) throw new ArrayFailure(origin === "arithmetic" ? "indexed arithmetic is unsupported" : "indexed write requires prepared publication");
    if (state.readonlyVariables?.has(name)) throw new Error(`${name}: readonly variable`);
    if (shellValueByteLength(value) > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
    if (name === "OPTIND" && state.getopts?.integer && origin !== "arithmetic") {
      try { value = String(evaluateArithmetic(prepareArithmetic(shellValueText(value) || "0", this.budget.parsing), this.arithmeticVariables(state), this.budget.parsing)); }
      catch (error) { this.rethrowArithmeticControl(error); throw new ExpansionFailure(message(error)); }
    }
    publishVariable(state, name, value);
    if (name === "OPTIND" && origin !== "getopts") this.syncGetopts(state);
  }

  private syncGetopts(state: State): void {
    state.getopts ??= cloneGetoptsBinding(state);
    const value = state.variables.OPTIND;
    if (value === undefined) {
      state.getopts.integer = false;
      state.getopts.cursor = createGetoptsState();
    } else state.getopts.cursor = withGetoptsIndex(state.getopts.cursor, decimalIndex(value));
  }

  private reconcileGetopts(state: State, previous: string | undefined): void {
    if (state.variables.OPTIND !== previous) this.syncGetopts(state);
  }

  private unsetVariable(state: State, name: string, internal = false): void {
    if (state.readonlyVariables?.has(name)) throw new Error(`${name}: readonly variable`);
    delete state.variables[name];
    state.exported.delete(name);
    if (name === "OPTIND" && !internal) this.syncGetopts(state);
  }

  private rethrowArithmeticControl(error: unknown): void {
    this.signal.throwIfAborted();
    if (error instanceof NounsetFailure || error instanceof Flow || error instanceof ShellLimitError || error instanceof ShellSyntaxError) throw error;
  }

  arithmeticVariables(state: State, line?: number): Record<string, string> {
    return new Proxy(state.variables, {
      get: (target, key) => {
        this.signal.throwIfAborted();
        if (arrayStore(state)?.get(String(key))) throw new ArrayFailure("indexed arithmetic is unsupported");
        const value = Reflect.get(target, key);
        if (state.nounset && typeof key === "string" && value === undefined) throw new NounsetFailure(`${key}: unbound variable`, line);
        return value;
      },
      set: (_target, key, value: string) => { this.writeVariable(state, String(key), value, "arithmetic"); return true; },
    });
  }

  variable(state: State, name: string): string | undefined {
    const binding = arrayStore(state)?.get(name);
    return binding ? binding.get(0) : state.variables[name];
  }

  private requireParameter(value: string | undefined, name: string, state: State, io: IO, line?: number): void {
    if (state.nounset && value === undefined) throw new NounsetFailure(`${name}: unbound variable`, io.diagnosticLine ?? line);
  }

  async assignVariable(state: State, name: string, value: ShellValue, origin: "assignment" | "getopts" = "assignment"): Promise<void> {
    if (!arrayStore(state)?.get(name)) { this.writeVariable(state, name, value, origin); return; }
    await this.arrayZero(state, name, async () => shellValueText(value));
  }

  async prepareVariable(state: State, name: string, saved: SavedVariable, scalarLegacy = false): Promise<void> {
    const store = requireArrays(state);
    const failures = stateMonitor(state)!.session.scope.failures;
    const owner = ArrayOwner.create(store.owner.ledger, store.owner);
    let holding: ReturnType<ArrayOwner["hold"]> | undefined;
    let binding: IndexedBinding | undefined;
    let primaryPresent = false;
    let primary: unknown;
    const cleanup = async (action: () => void | Promise<void>): Promise<void> => {
      try { await action(); }
      catch (error) {
        if (primaryPresent) failures.push(error);
        else { primaryPresent = true; primary = error; }
      }
    };
    try {
      holding = store.owner.hold();
      const watch = await store.watch(name, owner, this.signal);
      const tickets = owner.reserve({ generation: true, version: true, epoch: true, slots: 1, metadata: 64, work: 14 });
      const token = await textToken(owner, name, this.signal);
      const admission = owner.reserve({ slots: 1, metadata: 32, work: 5 });
      if (saved.value !== undefined) await textToken(owner, saved.value, this.signal);
      if (!watch.valid()) throw new ArrayFailure("stale binding");
      binding = scalarLegacy ? undefined : store.get(name)?.retain();
      typedSavedVariables.set(saved, { owner, binding, tickets, prepared: { name: token, admission }, watch, scalarLegacy });
      tickets.cleanup = () => { typedSavedVariables.delete(saved); };
    } catch (error) {
      primaryPresent = true;
      primary = error;
      await cleanup(() => binding?.release());
      await cleanup(() => owner.close());
    } finally { await cleanup(() => holding?.release()); }
    if (primaryPresent) throw primary;
  }

  async prepareArrayObservers(state: State, owner: ArrayOwner): Promise<void> {
    owner.reserve({ metadata: 128, work: 6 });
    for (const frame of state.locals) for (const [name, saved] of frame) {
      if (!typedSavedVariables.has(saved)) await this.prepareVariable(state, name, saved);
      await owner.ledger.checkpoint(this.signal);
    }
    for (const frame of stateMonitor(state)!.overlayFrames()) for (const [name, record] of frame) {
      const saved = record as SavedVariable;
      if (!saved.superseded && !typedSavedVariables.has(saved)) await this.prepareVariable(state, name, saved, true);
      await owner.ledger.checkpoint(this.signal);
    }
  }

  async discardVariable(saved: SavedVariable): Promise<void> {
    saved.heldValue?.release();
    delete saved.heldValue;
    const typed = typedSavedVariables.get(saved);
    if (!typed) return;
    typedSavedVariables.delete(saved);
    typed.watch.close();
    await typed.binding?.release();
    await typed.owner.close();
  }

  async indexedEnvironment(state: State, env: Readonly<Record<string, string>>): Promise<void> {
    const store = requireArrays(state);
    const operation = ArrayOwner.create(store.owner.ledger, store.owner);
    const holding = store.owner.hold();
    const epoch = stateMonitor(state)!.epoch;
    try {
      const keys = Object.keys(env);
      operation.reserve({ metadata: 128 + keys.length * 64, allocatedSlots: keys.length * 2, work: keys.length * 5 + 8 });
      for (const key of keys) {
        const value = env[key];
        if (key.includes("\0") || key.includes("=") || typeof value !== "string" || value.includes("\0")) throw new TypeError("Invalid invoke environment entry");
        if (state.readonlyVariables?.has(key)) throw new ArrayFailure("readonly environment collision");
      }
      const publications = new Map<string, Admission>();
      for (const key of keys) {
        await textToken(store.owner, key, this.signal);
        await textToken(store.owner, env[key]!, this.signal);
        publications.set(key, operation.reserve({ generation: true, version: true, epoch: true, work: 8 }));
      }
      const controls = operation.reserve({ epoch: true, work: state.exported.size + keys.length + 5 });
      this.signal.throwIfAborted();
      if (stateMonitor(state)!.epoch !== epoch) throw new ArrayFailure("stale state snapshot");
      stateMonitor(state)!.publish(controls, undefined, () => {
        for (const key of state.exported) delete state.variables[key];
        state.exported = new Set(keys);
      });
      for (const key of keys) {
        const tickets = publications.get(key)!;
        stateMonitor(state)!.publish(tickets, key, () => {
          void store.remove(key, tickets);
          publishVariable(state, key, env[key]!);
        });
      }
    } finally { try { await operation.close(); } finally { holding.release(); } }
  }

  async unsetIndexed(state: State, name: string, index?: number | "members"): Promise<void> {
    const store = requireArrays(state);
    const operation = ArrayOwner.create(store.owner.ledger, store.owner);
    const holding = store.owner.hold();
    let staged: IndexedBinding | undefined;
    try {
      if (state.readonlyVariables?.has(name)) throw new ArrayFailure("readonly binding");
      const watch = await store.watch(name, operation, this.signal);
      const tickets = operation.reserve({ generation: true, version: true, epoch: true, work: 8 });
      const current = store.get(name);
      if (index !== undefined && current) {
        staged = index === "members" ? IndexedBinding.create(store.owner) : await current.copy(this.signal);
        let maximum = -1;
        for (const key of staged.values.keys()) {
          operation.reserve({ work: 2 }).release();
          if (key !== index && key > maximum) maximum = key;
          await operation.ledger.checkpoint(this.signal, 2);
        }
        if (typeof index === "number") staged.values.get(index)?.slot.release();
        staged.maximum = maximum;
      }
      this.signal.throwIfAborted();
      if (state.readonlyVariables?.has(name)) throw new ArrayFailure("readonly binding");
      if (!watch.valid()) throw new ArrayFailure("stale binding");
      let released: Promise<void> | undefined;
      stateMonitor(state)!.publish(tickets, name, () => {
        if (staged) released = store.publish(name, staged, tickets);
        else if (index === undefined) {
          released = store.remove(name, tickets);
          delete state.variables[name];
          state.exported.delete(name);
        } else if (index === 0 || index === "members") delete state.variables[name];
      });
      staged = undefined;
      watch.close();
      await released;
    } finally { try { await staged?.release(); await operation.close(); } finally { holding.release(); } }
  }

  async arrayZero(state: State, name: string, expand: () => Promise<string>, append = false, freeze = false): Promise<void> {
    const store = requireArrays(state);
    const operation = ArrayOwner.create(store.owner.ledger, store.owner);
    const holding = store.owner.hold();
    let staged: IndexedBinding | undefined;
    try {
      const watch = await store.watch(name, operation, this.signal);
      const tickets = operation.reserve({ generation: true, version: true, epoch: true, work: 8 });
      let frozenAttributes: Set<string> | undefined;
      if (freeze) {
        store.owner.reserve({ metadata: state.readonlyVariables ? 32 : 96, slots: 1, work: 5 });
        if (!state.readonlyVariables) frozenAttributes = stateMonitor(state)!.prepareCollection(new Set<string>(), "readonlyVariables");
      }
      const expanded = await expand();
      this.signal.throwIfAborted();
      if (state.readonlyVariables?.has(name)) throw new ArrayFailure("readonly binding");
      if (!watch.valid()) throw new ArrayFailure("stale binding");
      const current = store.get(name);
      if (!current) throw new ArrayFailure("stale binding");
      staged = await current.copy(this.signal);
      const value = append ? await this.arrayJoin(operation, [current.get(0) ?? "", expanded], "") : expanded;
      const token = await textToken(staged.owner, value, this.signal);
      try { staged.insert(0, token); } catch (error) { token.release(); throw error; }
      const supersede = await stateMonitor(state)!.prepareTypedPublication(name, operation, this.signal);
      this.signal.throwIfAborted();
      if (state.readonlyVariables?.has(name)) throw new ArrayFailure("readonly binding");
      if (!watch.valid()) throw new ArrayFailure("stale binding");
      let released: Promise<void> | undefined;
      stateMonitor(state)!.publish(tickets, name, () => {
        supersede();
        released = store.publish(name, staged!, tickets);
        if (freeze) { state.readonlyVariables ??= frozenAttributes!; state.readonlyVariables.add(name); }
      });
      staged = undefined;
      watch.close();
      await released;
    } finally { try { await staged?.release(); await operation.close(); } finally { holding.release(); } }
  }

  async arrayJoin(owner: ArrayOwner, values: readonly string[], separator: string): Promise<string> {
    let bytes = 0;
    for (const value of values) {
      owner.reserve({ work: value.length + 1 }).release();
      bytes = exactSum(bytes, Buffer.byteLength(value));
      await owner.ledger.checkpoint(this.signal, value.length + 1);
    }
    bytes = exactSum(bytes, Math.max(0, values.length - 1) * Buffer.byteLength(separator));
    owner.reserve({ metadata: exactSum(96, values.length * 32), payload: bytes, allocatedSlots: values.length, work: values.length * 3 + 7 });
    this.signal.throwIfAborted();
    const result = values.join(separator);
    await owner.ledger.checkpoint(this.signal);
    return result;
  }

  async arrayAssignment(assignment: ArrayAssignment, state: State, io: IO): Promise<void> {
    const name = assignment.name;
    this.signal.throwIfAborted();
    if (state.readonlyVariables?.has(name)) throw new ArrayFailure("readonly binding");
    if (controlNames.has(name)) throw new ArrayFailure("control binding cannot be indexed");
    if (state.exported.has(name)) throw new ArrayFailure("exported binding cannot be indexed");
    const store = requireArrays(state);
    const operation = ArrayOwner.create(store.owner.ledger, store.owner);
    const holding = store.owner.hold();
    let staged: IndexedBinding | undefined;
    try {
      const watch = await store.watch(name, operation, this.signal);
      const current = store.get(name);
      const initialMaximum = current?.maximum ?? (state.variables[name] === undefined ? -1 : 0);
      let planned: number | null = assignment.append && assignment.kind === "compound" ? initialMaximum + 1 : 0;
      if (assignment.kind === "element") {
        operation.reserve({ work: assignment.index.decimal.length + 1 }).release();
        if (numericIndex(assignment.index) === undefined) throw new ArrayFailure("index outside 0..2147483647");
      } else for (const entry of assignment.entries) {
        operation.reserve({ work: entry.value.parts.length + (entry.index?.decimal.length ?? 0) + 2 }).release();
        if (entry.index) {
          const index = numericIndex(entry.index);
          if (index === undefined) throw new ArrayFailure("index outside 0..2147483647");
          planned = index + 1;
        } else {
          const quotedScalar = (part: WordPart): boolean => {
            const selector = getArraySelector(part);
            return part.quoted && !(part.kind === "variable" && (part.name === "@" || selector?.kind === "members" && selector.separator === "@"));
          };
          const certain = entry.value.parts.every(part => part.kind === "text" ? part.quoted || !/[*?[]/u.test(part.value) : quotedScalar(part));
          const demanded = entry.value.parts.some(part => part.kind === "text" ? part.quoted || part.value.length > 0 : quotedScalar(part));
          if (demanded && planned !== null && planned > 2147483647) throw new ArrayFailure("index outside 0..2147483647");
          if (certain && planned !== null) {
            planned++;
          } else planned = null;
        }
        await operation.ledger.checkpoint(this.signal, entry.value.parts.length + 2);
      }
      const supersede = await stateMonitor(state)!.prepareTypedPublication(name, operation, this.signal);
      await this.prepareArrayObservers(state, operation);
      const tickets = operation.reserve({ generation: true, version: true, epoch: true, work: 8 });
      const prepared = await store.prepareName(name, operation, this.signal);
      const preserve = assignment.kind === "element" || assignment.append;
      staged = preserve && current ? await current.copy(this.signal) : IndexedBinding.create(store.owner);
      if (preserve && !current && state.variables[name] !== undefined) {
        const token = await textToken(staged.owner, state.variables[name]!, this.signal);
        try { staged.insert(0, token); } catch (error) { token.release(); throw error; }
      }
      let writes = 0;
      let cursor = assignment.append && assignment.kind === "compound" ? initialMaximum + 1 : 0;
      const insert = async (index: number, value: string) => {
        if (index > 2147483647) throw new ArrayFailure("index outside 0..2147483647");
        const token = await textToken(staged!.owner, value, this.signal);
        try { staged!.insert(index, token); } catch (error) { token.release(); throw error; }
        writes++;
      };
      if (assignment.kind === "element") {
        const index = numericIndex(assignment.index)!;
        const fields = await this.word(assignment.value, state, io, false);
        let value = await this.arrayJoin(operation, fields, "");
        if (assignment.append) value = await this.arrayJoin(operation, [staged.get(index) ?? "", value], "");
        await insert(index, value);
      } else for (const entry of assignment.entries) {
        const original = compoundEntryWords.get(entry);
        if (entry.index && original && state.braceexpand !== false && original.parts.some(part => part.kind === "text" && !part.quoted && part.value.includes("{"))) {
          let expandedEntry = false;
          for await (const expanded of expandBraces(original, this.budget, this.signal)) {
            if (expanded === original) break;
            expandedEntry = true;
            const values = await this.valueWord(expanded, state, io, true, false, false, false, undefined, false);
            for (const value of values) { await insert(cursor, shellValueText(value)); cursor++; }
          }
          if (expandedEntry) continue;
        }
        const fields = await this.word(entry.value, state, io, entry.index === undefined);
        if (entry.index) {
          const index = numericIndex(entry.index)!;
          await insert(index, await this.arrayJoin(operation, fields, ""));
          cursor = index + 1;
        } else for (const value of fields) { await insert(cursor, value); cursor++; }
      }
      this.signal.throwIfAborted();
      if (state.readonlyVariables?.has(name)) throw new ArrayFailure("readonly binding");
      if (!watch.valid()) throw new ArrayFailure("stale binding");
      if (!(assignment.kind === "compound" && assignment.append && writes === 0)) {
        let released: Promise<void> | undefined;
        stateMonitor(state)!.publish(tickets, name, () => {
          supersede();
          delete state.variables[name];
          released = store.publish(name, staged!, tickets, prepared);
        });
        staged = undefined;
        await released;
      }
      watch.close();
    } finally { try { await staged?.release(); await operation.close(); } finally { holding.release(); } }
  }

  async run(script: Script, state: State, io: IO): Promise<number> {
    return (await this.runUnit(script, state, io)).exitCode;
  }

  async runUnit(script: Script, state: State, io: IO): Promise<{ exitCode: number; terminated: boolean }> {
    state = trackState(state, this.budget, io[invocationScope]);
    try { return { exitCode: await this.script(script, state, io), terminated: false }; }
    catch (error) {
      if (error instanceof NounsetDiagnosticFailure) {
        if (state.isolated) throw error;
        throw error.reason;
      }
      if (error instanceof Flow && error.kind === "exit") return { exitCode: error.status, terminated: true };
      throw error;
    }
  }

  async script(script: Script, state: State, io: IO): Promise<number> {
    for (const list of script.lists) {
      for (let index = 0; index < list.pipelines.length; index++) {
        const operator = list.operators[index - 1];
        if ((operator === "&&" && state.status !== 0) || (operator === "||" && state.status === 0)) continue;
        const pipeline = list.pipelines[index]!;
        const ignored = io.execution?.ignoreErrexit || index < list.pipelines.length - 1 || pipeline.negate;
        const completion = stateMonitor(state)?.restoration();
        try {
          const status = await this.pipeline(pipeline, state, ignored ? { ...io, execution: { ignoreErrexit: true } } : io);
          if (completion) completion.apply(() => { state.status = status; });
          else state.status = status;
        } finally { completion?.close(); }
      }
    }
    return script.lists.length ? state.status : 0;
  }

  async pipeline(pipeline: Pipeline, state: State, io: IO): Promise<number> {
    this.signal.throwIfAborted();
    let status: number;
    if (pipeline.commands.length === 1) status = await this.command(pipeline.commands[0]!, state, io, false, pipeline.negate);
    else {
      const release = this.budget.reservePipelineStages(pipeline.commands.length);
      const retained = new Set<Promise<unknown>>();
      let setupClosed = false;
      const retain = (work: Promise<unknown>): void => {
        retained.add(work);
        const settled = (): void => {
          retained.delete(work);
          if (setupClosed && !retained.size) release();
        };
        void work.then(settled, settled);
      };
      const pipes: ReturnType<typeof createBytePipe>[] = [];
      const controllers: AbortController[] = [];
      const written = new Set<number>();
      const completed = new Set<number>();
      const closing = new Set<TurnHandle>();
      let statuses: number[];
      try {
        for (let index = 1; index < pipeline.commands.length; index++) pipes.push(createBytePipe({
          highWaterMark: this.budget.limits.pipeHighWaterMark, signal: this.signal,
        }));
        for (let index = 0; index < pipeline.commands.length; index++) controllers.push(new AbortController());
        const tasks = pipeline.commands.map(async (command, index) => {
          const incoming = pipes[index - 1];
          const outgoing = pipes[index];
          const childDepth = this.cancellationDepth + 1;
          const controls: readonly CancellationControlOriginInput[] = [
            { role: "pipeline-control", signal: controllers[index]!.signal },
          ];
          const prepared = prepareChildCancellation(
            this.cancellation,
            undefined,
            this.cancellationAdmission(childDepth, controls.length),
            controls,
          );
          const owner = new InvocationCancellationOwner(io[invocationScope], prepared, this.cancellationState);
          let boundary: CancellationBoundary;
          try { boundary = owner.activate(); }
          catch (error) { await owner.abandon(Promise.resolve()); throw error; }
          const signal = AbortSignal.any([boundary.deliverySignal, io[invocationScope].signal]);
          const frame: RuntimeOutcomeFrame = {};
          const runtime = new Runtime(
            this.fs, this.commands, this.middleware, this.budget, signal, this.fileWrites, this.outputFiles,
            boundary.deliverySignal, boundary, this.cancellationState, owner,
            childDepth, this.cancellationMaxDepth, frame,
          );
          const input = new ShellInput(incoming?.readable ?? io.stdin, this.budget, signal);
          const pipeOutput: ByteSink | undefined = outgoing && { [outputFailure]: outgoing.abort, ownedOutput: outgoing.writable.ownedOutput!, write: async (chunk) => {
            try {
              await outgoing.writable.write(chunk);
              if (chunk.byteLength) written.add(index);
            }
            catch (error) {
              if (errorCode(error) === "EPIPE") {
                const closed = new PipelineClosed();
                controllers[index]!.abort(closed);
                throw closed;
              }
              throw error;
            }
          } };
          const executeStage = async (): Promise<CommandResult> => {
            try {
              let exitCode: number;
              try {
                const child = await cloneState(state, this.signal);
                child.isolated = true;
                const work = runtime.runCommandIsolated(command, child, {
                  ...isolateIO(io),
                  stdin: input,
                  ...(incoming ? { stdinIsDefault: false } : {}),
                  stdout: pipeOutput ? this.budget.sink(pipeOutput, signal) : signalSink(io.stdout, signal),
                  stderr: signalSink(io.stderr, signal),
                }).finally(() => stateMonitor(child)?.closeValues());
                retain(work);
                exitCode = await interruptible(work, signal);
              } catch (error) {
                if (!(error instanceof PipelineClosed)) throw error;
                exitCode = 141;
              }
              return { exitCode };
            } finally {
              completed.add(index);
              if (incoming) {
                const upstream = index - 1;
                const close = scheduleTurn(() => {
                  closing.delete(close);
                  if (written.has(upstream) && !completed.has(upstream)) controllers[upstream]!.abort(new PipelineClosed());
                });
                closing.add(close);
                await incoming.abort();
              }
              await input.close().catch((error: unknown) => { if (!(error instanceof PipelineClosed)) throw error; });
              if (outgoing) await outgoing.close().catch(() => undefined);
            }
          };
          let captured: CapturedCancellationOutcome<CommandResult>;
          try { captured = { kind: "return", value: await executeStage() }; }
          catch (reason) {
            captured = frame.report && Object.is(frame.report.origin.signal.reason, reason)
              ? { kind: "throw", reason, report: frame.report }
              : { kind: "throw", reason };
          }
          const selection = await owner.finish(Promise.resolve(), captured);
          if (selection.outcome.kind === "throw") throw selection.outcome.reason;
          return selection.outcome.value.exitCode;
        });
        for (const task of tasks) retain(task);
        statuses = await interruptible(Promise.all(tasks), this.signal);
      } finally {
        try {
          for (const close of closing) cancelTurn(close);
          for (const [index, controller] of controllers.entries()) if (!completed.has(index) || written.has(index)) controller.abort(new PipelineClosed());
          const aborts = pipes.map((pipe) => pipe.abort());
          for (const abort of aborts) retain(abort);
          await Promise.all(aborts);
        } finally {
          setupClosed = true;
          if (!retained.size) release();
        }
      }
      await this.publishStatus(state, statuses, io);
      status = state.pipefail ? statuses.findLast((status) => status !== 0) ?? 0 : statuses.at(-1)!;
    }
    if (pipeline.commands.length > 1) this.errexit(status, state, io);
    return pipeline.negate ? Number(status === 0) : status;
  }

  async runCommandIsolated(command: Command, state: State, io: IO, fileShortcut = false): Promise<number> {
    try { return await this.command(command, state, io, fileShortcut); }
    catch (error) {
      if (error instanceof NounsetDiagnosticFailure) throw error;
      if (error instanceof Flow && (error.kind === "exit" || error.kind === "return")) return error.status;
      throw error;
    }
  }

  errexit(status: number, state: State, io: IO): void {
    this.signal.throwIfAborted();
    if (status !== 0 && state.errexit && !io.execution?.ignoreErrexit) throw new Flow("exit", status);
  }

  private async publishStatus(state: State, statuses: readonly number[], io: IO): Promise<void> {
    this.signal.throwIfAborted();
    try { throwCleanupFailures(io[invocationScope].failures); }
    catch (error) { throw new NounsetDiagnosticFailure(error); }
    await publishPipelineStatus(trackState(state, this.budget, io[invocationScope]), statuses, this.signal, io[invocationScope]);
  }

  async command(command: Command, state: State, io: IO, fileShortcut = false, publicationNegate = false): Promise<number> {
    io[invocationScope].assertOpen();
    const publishes = command.kind === "simple" || command.kind === "subshell" || command.kind === "arithmetic" || command.kind === "conditional";
    let status: number;
    try { status = await io[invocationScope].run(() => this.executeCommand(command, state, io, fileShortcut)); }
    catch (error) {
      if (publishes && error instanceof Flow && completedFlows.has(error)) {
        completedFlows.delete(error);
        this.signal.throwIfAborted();
        if (!io[invocationScope].failures.length) await this.publishStatus(state, [error.status], io);
      }
      throw error;
    }
    if (publishes) {
      const reported = publicationNegate && (command.kind === "conditional" || command.kind === "arithmetic") ? Number(status === 0) : status;
      await this.publishStatus(state, [reported], io);
      this.errexit(status, state, io);
    }
    return status;
  }

  async executeCommand(command: Command, state: State, originalIO: IO, fileShortcut = false): Promise<number> {
    state = trackState(state, this.budget, originalIO[invocationScope]);
    originalIO = activeIO(originalIO);
    originalIO.descriptors ??= new Map<number, Descriptor>([
      [0, { input: originalIO.stdin, ...(originalIO.stdinIsDefault === undefined ? {} : { stdinIsDefault: originalIO.stdinIsDefault }) }],
      [1, { output: originalIO.stdout }], [2, { output: originalIO.stderr }],
    ]);
    const diagnosticLine = (command.line ?? 1) + (originalIO.diagnosticOffset ?? 0);
    originalIO = { ...originalIO, diagnosticLine, substitutionDiagnosticLine: originalIO.substitutionDiagnosticLines?.get(command) ?? diagnosticLine };
    if (command.kind === "subshell") originalIO = isolateIO(originalIO);
    this.budget.tick();
    if (this.budget.commands % 128 === 0) await yieldTurn(this.signal);
    this.signal.throwIfAborted();
    const inputs = new Set<ShellInput>();
    const outputs = new Set<(completion: OutputCompletion) => void | Promise<void>>();
    const finishOutputs = async (status: number): Promise<void> => {
      const pending = [...outputs];
      outputs.clear();
      const settled = await Promise.allSettled(pending.map(close => close({ status })));
      throwCleanupFailures(settled.filter(result => result.status === "rejected").map(result => result.reason));
    };
    const allocation = this.budget.values.scope();
    originalIO = { ...originalIO, [valueScope]: allocation };
    let io = originalIO;
    let diagnosticFailure: NounsetDiagnosticFailure | undefined;
    let snapshotScope: InvocationScope | undefined;
    let finishSnapshot: (() => void) | undefined;
    try {
      const execute = async (): Promise<number> => {
      if (command.kind === "function") {
        if (state.profile === "sh" && specialBuiltinNames.has(command.name)) {
          await this.diagnostic(io, `\`${command.name}': is a special builtin`);
          throw new Flow("exit", 2);
        }
        state.functions.set(command.name, { ...command.body, sourceName: io.scriptName ?? "shell" });
        return 0;
      }
      if (command.kind === "simple") return await this.simple(command, state, originalIO, inputs, outputs, () => {
        snapshotScope = originalIO[invocationScope].child();
        void snapshotScope.run(() => new Promise<void>(resolve => { finishSnapshot = resolve; }));
        return snapshotScope;
      }, fileShortcut);
      io = await this.redirect(command.redirects, state, io, inputs, outputs, command.kind === "subshell", command.kind !== "subshell");
      if (command.kind === "conditional") {
        try {
          return await evaluateConditional(command.expression, {
            fs: this.fs, cwd: state.cwd, signal: this.signal,
            locale: state.variables.LC_ALL || state.variables.LC_COLLATE || state.variables.LANG || "C",
            work: { remaining: this.budget.limits.maxExpansionBytes, signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") },
            expand: async (word, pattern = false) => (await this.word(word, state, io, false, pattern, false, pattern)).join(""),
            regex: (subject, pattern) => this.ere(subject, pattern, state, io),
            option: name => name === "braceexpand" ? state.braceexpand !== false : name === "errexit" ? !!state.errexit : name === "nounset" ? !!state.nounset : name === "pipefail" ? state.pipefail : false,
            present: name => {
              const match = /^([a-zA-Z_][a-zA-Z_0-9]*)(?:\[(0|[1-9][0-9]*|[@*])\])?$/u.exec(name);
              if (!match) throw new ConditionalUnsupported("[[ variable selector: unsupported conditional profile");
              const binding = arrayStore(state)?.get(match[1]!);
              const selector = match[2];
              if (selector === "@" || selector === "*") return binding ? binding.values.size > 0 : this.variable(state, match[1]!) !== undefined;
              const index = selector === undefined ? 0 : numericIndex({ decimal: selector });
              if (index === undefined) throw new ConditionalUnsupported("[[ variable index: unsupported conditional profile");
              return binding ? binding.get(index) !== undefined : index === 0 && this.variable(state, match[1]!) !== undefined;
            },
          });
        } catch (error) {
          this.signal.throwIfAborted();
          if (error instanceof NounsetDiagnosticFailure) { diagnosticFailure = error; throw error; }
          if (error instanceof EreProfileLimitError) {
            try { await this.diagnostic(io, `[[ ${error.message}`); }
            catch (reason) { this.signal.throwIfAborted(); if (reason instanceof ShellLimitError) throw reason; diagnosticFailure = new NounsetDiagnosticFailure(reason); throw diagnosticFailure; }
            return 3;
          }
          if (error instanceof ConditionalUnsupported) {
            try { await this.diagnostic(io, error.message); }
            catch (reason) { this.signal.throwIfAborted(); if (reason instanceof ShellLimitError) throw reason; diagnosticFailure = new NounsetDiagnosticFailure(reason); throw diagnosticFailure; }
            return 2;
          }
          if (error instanceof ExpansionFailure || error instanceof Flow || error instanceof ShellLimitError || error instanceof ShellSyntaxError || error instanceof ArrayFailure) throw error;
          diagnosticFailure = new NounsetDiagnosticFailure(error);
          throw diagnosticFailure;
        }
      }
      if (command.kind === "arithmetic") {
        try {
          return Number(evaluatePositionalArithmetic(command.expression, {
            parseBudget: this.budget.parsing,
            positional: state.positional, arg0: state.arg0 ?? "virtual-bash", owner: arrayStore(state)?.owner,
            maximumBytes: this.budget.limits.maxExpansionBytes,
            checkpoint: () => this.signal.throwIfAborted(),
            requireParameter: (name, value) => this.requireParameter(value, name, state, io),
            limit: () => this.budget.fail("maxExpansionBytes"),
          }, (prepared) => evaluateArithmetic(prepared, this.arithmeticVariables(state, io.diagnosticLine), this.budget.parsing)) === 0n);
        }
        catch (error) { this.rethrowArithmeticControl(error); throw new Error(`((: ${message(error)}`); }
      }
      if (command.kind === "subshell") {
        const child = await cloneState(state, this.signal);
        child.isolated = true;
        child.loopDepth = 0;
        try { return await this.run(command.body, child, io); }
        finally { stateMonitor(child)?.closeValues(); }
      }
      if (command.kind === "group") return await this.script(command.body, state, io);
      if (command.kind === "if") {
        for (const branch of command.branches) {
          if (await this.script(branch.condition, state, { ...io, execution: { ignoreErrexit: true } }) === 0) return await this.script(branch.body, state, io);
        }
        return command.otherwise ? await this.script(command.otherwise, state, io) : 0;
      }
      if (command.kind === "case") {
        const subject = (await this.word(command.subject, state, io, false)).join("");
        const work = { remaining: this.budget.limits.maxExpansionBytes, signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") };
        let status = 0;
        let fallthrough = false;
        let patterns = 0;
        for (const clause of command.clauses) {
          let matched = fallthrough;
          if (!matched) for (const word of clause.patterns) {
            if (++patterns % 128 === 0) await yieldTurn(this.signal);
            const pattern = (await this.word(word, state, io, false, true)).join("");
            if (await matchesPattern(pattern, subject, work)) { matched = true; break; }
          }
          if (!matched) continue;
          if (clause.body.lists.length) status = await this.script(clause.body, state, io);
          if (clause.terminator === ";;" || clause.terminator === "esac") break;
          fallthrough = clause.terminator === ";&";
        }
        return status;
      }
      let status = 0;
      const loopRestoration = stateMonitor(state)?.restoration();
      state.loopDepth++;
      try {
        if (command.kind === "for") {
          const values = command.words ? await this.valueWords(command.words, state, io) : this.positionalValues(state);
          for (const value of values) {
            this.budget.loop();
            await this.assignVariable(state, command.name, value);
            const result = await this.loopBody(command.body, state, io);
            status = result.status;
            if (result.stop) break;
          }
        } else {
          while (true) {
            this.budget.loop();
            const condition = await this.script(command.condition, state, { ...io, execution: { ignoreErrexit: true } });
            if ((condition === 0) !== (command.kind === "while")) break;
            const result = await this.loopBody(command.body, state, io);
            status = result.status;
            if (result.stop) break;
          }
        }
      } finally {
        if (loopRestoration) loopRestoration.apply(() => { state.loopDepth--; });
        else state.loopDepth--;
      }
      return status;
      };
      const status = await execute();
      await finishOutputs(status);
      return status;
    } catch (caught) {
      const diagnostic = caught instanceof ExecutionFailure ? caught.diagnostic : undefined;
      const error = caught instanceof ExecutionFailure ? caught.original : caught;
      if (caught instanceof ExecutionFailure) io = caught.io;
      if (error instanceof NounsetDiagnosticFailure) diagnosticFailure = error;
      this.signal.throwIfAborted();
      if (error instanceof Flow) await finishOutputs(error.status);
      if (error instanceof Flow || error instanceof ShellLimitError || error instanceof ShellSyntaxError) throw error;
      this.clearOutcomeReport();
      if (error instanceof HereDocumentSyntaxError) {
        await writeText(io.stderr, error.diagnostic);
        if (command.kind !== "simple" && command.kind !== "subshell" && command.kind !== "arithmetic" && command.kind !== "conditional") this.errexit(1, state, io);
        return 1;
      }
      if (errorCode(error) === "EPIPE") {
        if (command.kind !== "simple" && command.kind !== "subshell" && command.kind !== "arithmetic" && command.kind !== "conditional") this.errexit(141, state, io);
        return 141;
      }
      const line = error instanceof ExpansionFailure ? error.line ?? io.diagnosticLine ?? 1 : io.diagnosticLine ?? 1;
      if (error instanceof NounsetFailure || error instanceof ParameterExpansionFailure) {
        const detail = error instanceof ParameterExpansionFailure ? diagnostic ?? message(error) : message(error);
        try { await writeText(io.stderr, `${io.scriptName ?? "shell"}: line ${line}: ${detail}\n`); }
        catch (reason) {
          this.signal.throwIfAborted();
          if (reason instanceof ShellLimitError) throw reason;
          diagnosticFailure = new NounsetDiagnosticFailure(reason);
          throw diagnosticFailure;
        }
        throw completedExit(error instanceof ParameterExpansionFailure && !state.isolated ? 127 : 1);
      }
      if (error instanceof ArrayFailure) await writeText(io.stderr, `${io.scriptName ?? "shell"}: line ${line}: ${diagnostic ?? message(error)}\n`);
      else {
        try { await writeText(io.stderr, `${io.scriptName ?? "shell"}: line ${line}: ${diagnostic ?? message(error)}\n`); }
        catch { this.signal.throwIfAborted(); }
      }
      if (error instanceof ExpansionFailure || error instanceof BraceExpansionFailure) throw completedExit(error instanceof ParameterExpansionFailure && !state.isolated ? 127 : 1);
      if (error instanceof FatalCommandFailure) throw completedExit(error.status);
      const status = error instanceof CommandFailure ? error.status : 1;
      if (command.kind !== "simple" && command.kind !== "subshell" && command.kind !== "arithmetic" && command.kind !== "conditional") this.errexit(status, state, io);
      return status;
    } finally {
      try {
        await Promise.allSettled([
          ...[...outputs].map(async close => close({ reason: new FsError("ECANCELED", { syscall: "redirect" }) })),
          ...[...inputs].map(async input => input.close()),
        ]).then(results => {
          const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
          if (diagnosticFailure) io[invocationScope].failures.push(...failures);
          else throwCleanupFailures(failures);
        }).finally(() => allocation.close());
      } finally {
        finishSnapshot?.();
        await snapshotScope?.close();
      }
    }
  }

  async loopBody(body: Script, state: State, io: IO): Promise<{ status: number; stop: boolean }> {
    try { return { status: await this.script(body, state, io), stop: false }; }
    catch (error) {
      if (!(error instanceof Flow) || (error.kind !== "break" && error.kind !== "continue")) throw error;
      if (--error.levels > 0) throw error;
      return { status: 0, stop: error.kind === "break" };
    }
  }

  async document(document: HereDocument, state: State, io: IO, line = document.endLine): Promise<string> {
    this.signal.throwIfAborted();
    let value = "";
    let size = 0;
    let words = 0;
    const warnings: string[] = [];
    try {
      for (const word of hereDocumentWords(document, line, byteLocale(state.variables), warnings, this.budget.parsing)) {
        this.signal.throwIfAborted();
        for (const warning of warnings.splice(0)) await writeText(io.stderr, `shell: warning: ${warning}\n`);
        if (++words % 128 === 0) await yieldTurn(this.signal);
        const part = (await this.word(word, state, io, false)).join("");
        size += Buffer.byteLength(part);
        if (size > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
        value += part;
      }
    } finally {
      for (const warning of warnings.splice(0)) await writeText(io.stderr, `shell: warning: ${warning}\n`);
    }
    return value;
  }

  async redirect(redirects: readonly Redirect[], state: State, io: IO, inputs: Set<ShellInput>, outputs: Set<(completion: OutputCompletion) => void | Promise<void>>, isolatedInlineInput = false, persistMoves = false, fileShortcut = false, line?: number): Promise<IO> {
    this.signal.throwIfAborted();
    if (redirects.length > this.budget.limits.maxRedirects) this.budget.fail("maxRedirects");
    io.descriptors ??= new Map<number, Descriptor>([
      [0, { input: io.stdin, ...(io.stdinIsDefault === undefined ? {} : { stdinIsDefault: io.stdinIsDefault }) }],
      [1, { output: io.stdout }], [2, { output: io.stderr }],
    ]);
    const inputDescriptor = io.descriptors.get(0);
    const outputDescriptor = io.descriptors.get(1);
    const errorDescriptor = io.descriptors.get(2);
    const descriptors = new Map<number, Descriptor>([
      ...io.descriptors ?? [],
      [0, inputDescriptor?.input === io.stdin ? inputDescriptor : { input: io.stdin, ...(io.stdinIsDefault === undefined ? {} : { stdinIsDefault: io.stdinIsDefault }) }],
      [1, outputDescriptor?.output === io.stdout ? outputDescriptor : { output: io.stdout }],
      [2, errorDescriptor?.output === io.stderr ? errorDescriptor : { output: io.stderr }],
    ]);
    const replaced = new Set<number>();
    let errorTarget: string | undefined;
    if (io.stdin === closedSource) descriptors.delete(0);
    if (io.stdout === closedSink) descriptors.delete(1);
    if (io.stderr === closedSink) descriptors.delete(2);
    const currentIO = (): IO => {
      const descriptor = descriptors.get(0)?.closed ? undefined : descriptors.get(0);
      const stdinIsDefault = descriptor?.input ? descriptor.stdinIsDefault : false;
      return {
        [invocationScope]: io[invocationScope],
        ...(io.execution === undefined ? {} : { execution: io.execution }),
        ...(io.diagnosticLine === undefined ? {} : { diagnosticLine: io.diagnosticLine }),
        ...(io.diagnosticOffset === undefined ? {} : { diagnosticOffset: io.diagnosticOffset }),
        ...(io.scriptName === undefined ? {} : { scriptName: io.scriptName }),
        ...(io.substitutionDiagnosticLine === undefined ? {} : { substitutionDiagnosticLine: io.substitutionDiagnosticLine }),
        ...(io.substitutionDiagnosticLines === undefined ? {} : { substitutionDiagnosticLines: io.substitutionDiagnosticLines }),
        stdin: descriptor?.input ?? closedSource,
        ...(stdinIsDefault === undefined ? {} : { stdinIsDefault }),
        stdout: descriptors.get(1)?.closed ? closedSink : descriptors.get(1)?.output ?? closedSink,
        stderr: descriptors.get(2)?.closed ? closedSink : descriptors.get(2)?.output ?? closedSink,
        descriptors,
      };
    };
    try { for (const redirect of redirects) {
      replaced.add(redirect.descriptor);
      if (redirect.document || redirect.operator === "<<<") {
        const hereString = redirect.operator === "<<<";
        let value: string;
        try { value = redirect.document ? await this.document(redirect.document, state, currentIO(), line) : (await this.word(redirect.target, state, currentIO(), false, false, hereString)).join(""); }
        catch (error) {
          if (error instanceof NounsetFailure) throw error;
          if (error instanceof ParameterExpansionFailure && !isolatedInlineInput) throw error;
          if (error instanceof ParameterExpansionFailure) throw new CommandFailure(error.message, state.isolated ? 1 : 127);
          if (error instanceof ExpansionFailure) throw new Error(error.message);
          throw error;
        }
        if (hereString) {
          if (Buffer.byteLength(value) >= this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
          value += "\n";
        }
        const input = new ShellInput(toByteSource(value), this.budget, this.signal);
        inputs.add(input);
        descriptors.set(redirect.descriptor, { input, stdinIsDefault: false });
        continue;
      }
      const targets = await this.word(redirect.target, state, currentIO());
      if (targets.length !== 1) throw new Error("Ambiguous redirect");
      const target = targets[0]!;
      errorTarget = target;
      if (redirect.operator.endsWith("&")) {
        if (target === "-") descriptors.delete(redirect.descriptor);
        else {
          if (!/^\d+-?$/u.test(target)) throw new Error(`${target}: Bad file descriptor`);
          const move = target.endsWith("-");
          if (move && !redirect.move) throw new Error(`${target}: ambiguous redirect`);
          const sourceDescriptor = Number(move ? target.slice(0, -1) : target);
          const descriptor = descriptors.get(sourceDescriptor);
          if (!descriptor || descriptor.closed || (!move && (redirect.operator === "<&" ? !descriptor.input : !descriptor.output))) throw new Error(`${move ? sourceDescriptor : target}: Bad file descriptor`);
          descriptors.set(redirect.descriptor, { ...descriptor });
          if (move && sourceDescriptor !== redirect.descriptor) {
            descriptors.delete(sourceDescriptor);
            if (persistMoves && !replaced.has(sourceDescriptor)) descriptor.closed = true;
          }
        }
      } else {
        const path = resolvePath(state.cwd, target);
        const options = { signal: this.signal };
        if (redirect.operator === "<") {
          await interruptible(this.fs.access(path, 4, options), this.signal);
          const stat = await interruptible(this.fs.stat(path, options), this.signal);
          if (stat.type === "directory" && !fileShortcut) throw new Error(`${target}: Is a directory`);
          const source = stat.type === "directory" ? toByteSource("")
            : await fileInput(this.fs, path, this.budget.limits.maxInputBytes, this.signal);
          const input = new ShellInput(source, this.budget, this.signal);
          inputs.add(input);
          descriptors.set(redirect.descriptor, { input, stdinIsDefault: false });
        } else {
          const append = redirect.operator === ">>";
          const capabilities = await this.fs.capabilitiesFor?.(path, options) ?? this.fs.capabilities;
          const random = capabilities.randomAccessWrite === true;
          let file!: OutputFile;
          await this.fileOperation(path, async () => {
            file = this.outputFiles.get(path) ?? { data: undefined, references: 0 };
            if (!random && file.references) throw new FsError("ENOTSUP", { path, message: "Conflicting sequential output descriptors" });
            file.references++;
            this.outputFiles.set(path, file);
          });
          let closed = false;
          let offset = 0;
          const incremental = async (): Promise<ByteSink> => {
            await this.fileOperation(path, async () => {
              if (append) await this.fs.appendFile(path, new Uint8Array(), options);
              else await this.fs.writeFile(path, new Uint8Array(), { ...options, flag: "w" });
              if (!append) file.data = new Uint8Array();
            });
            return { write: (chunk) => {
              const copy = new Uint8Array(chunk);
              return this.fileOperation(path, async () => {
                if (closed) throw new Error("Output descriptor is closed");
                const current = file.data;
                let atEOF = false;
                if (!append && current && offset === current.length && capabilities.append === true && capabilities.stat !== false) {
                  try {
                    atEOF = (await interruptible(this.fs.stat(path, options), this.signal)).size === offset;
                  } catch {
                    // Metadata is optional for this optimization; writes need no read access.
                    this.signal.throwIfAborted();
                  }
                  this.signal.throwIfAborted();
                }
                if (append || atEOF) {
                  // Preparing a larger view only touches the unpublished tail of current.
                  const bytes = current ? appendOutputBytes(current, copy) : undefined;
                  await this.fs.appendFile(path, copy, options);
                  file.data = bytes;
                } else {
                  const bytes = new Uint8Array(Math.max(current?.length ?? 0, offset + copy.length));
                  if (current) bytes.set(current);
                  bytes.set(copy, offset);
                  await this.fs.writeFile(path, bytes, options);
                  file.data = bytes;
                }
                if (!append) offset += copy.length;
              });
            } };
          };
          const release = (): void => {
            if (closed) return;
            closed = true;
            if (--file.references === 0 && this.outputFiles.get(path) === file) this.outputFiles.delete(path);
          };
          let target;
          try {
            target = await openFileOutput({ fs: this.fs, signal: this.signal, registerCleanup: cleanup => io[invocationScope].register(cleanup) }, path, append ? "a" : "w", random ? incremental : undefined);
          } catch (error) { release(); throw error; }
          outputs.add(async completion => {
            try {
              if (this.signal.aborted) await target.abort(this.signal.reason);
              else if ("reason" in completion) await target.abort(completion.reason);
              else {
                try { await target.finish(); }
                catch (error) {
                  this.signal.throwIfAborted();
                  if (completion.status === 0) throw error;
                }
              }
            } finally { release(); }
          });
          const output = this.budget.sink(target.sink, this.signal);
          descriptors.set(redirect.descriptor, { output });
          if (redirect.operator === "&>") {
            replaced.add(2);
            descriptors.set(2, { output });
          }
        }
      }
    } } catch (error) {
      const diagnostic = errorTarget === undefined ? undefined : filesystemDiagnostic(error, errorTarget);
      throw new ExecutionFailure(error, currentIO(), diagnostic);
    }
    return currentIO();
  }

  async fileOperation(path: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.fileWrites.get(path) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(() => { this.signal.throwIfAborted(); return operation(); });
    this.fileWrites.set(path, pending);
    try { await interruptible(pending, this.signal); }
    finally { if (this.fileWrites.get(path) === pending) this.fileWrites.delete(path); }
  }

  assignment(word: Word): { name: string; value: Word; append: boolean } | undefined {
    const first = word.parts[0];
    if (first?.kind !== "text" || first.quoted) return undefined;
    const match = /^([a-zA-Z_][a-zA-Z_0-9]*)(\+?)=/u.exec(first.value);
    if (!match) return undefined;
    return { name: match[1]!, append: match[2] === "+", value: { offset: word.offset, parts: [{ ...first, value: first.value.slice(match[0].length) }, ...word.parts.slice(1)] } };
  }

  async simple(command: Extract<Command, { kind: "simple" }>, state: State, originalIO: IO, inputs: Set<ShellInput>, outputs: Set<(completion: OutputCompletion) => void | Promise<void>>, createSnapshotScope: () => InvocationScope, fileShortcut = false): Promise<number> {
    state.substitutionStatus = 0;
    const assignments: ({ name: string; value: Word; append: boolean; kind?: undefined } | ArrayAssignment)[] = [];
    let wordIndex = 0;
    for (; wordIndex < command.words.length; wordIndex++) {
      const assignment = getArrayAssignment(command.words[wordIndex]!) ?? this.assignment(command.words[wordIndex]!);
      if (!assignment) break;
      assignments.push(assignment);
    }
    const commandWords = command.words.slice(wordIndex);
    let declarationIndex = 0;
    while (commandWords[declarationIndex]?.plain === "command") {
      declarationIndex++;
      if (commandWords[declarationIndex]?.plain === "--") declarationIndex++;
    }
    const wordValues = await this.valueWords(commandWords, state, originalIO, ["export", "local", "readonly"].includes(commandWords[declarationIndex]?.plain ?? ""));
    const words = wordValues.map(shellValueText);
    const special = state.profile === "sh" && specialBuiltinNames.has(words[0] ?? "");
    const inlineInput = command.redirects.some((redirect) => redirect.document || redirect.operator === "<<<");
    const functionCommand = words.length > 0 && state.functions.has(words[0]!);
    const isolatedInlineInput = inlineInput && words.length > 0 && !shellBuiltinNames.has(words[0]!) && !functionCommand;
    const snapshotScope = isolatedInlineInput ? createSnapshotScope() : undefined;
    let io = snapshotScope ? { ...originalIO, [invocationScope]: snapshotScope } : originalIO;
    const previous = new Map<string, SavedVariable>();
    const assign = async () => {
      for (const assignment of assignments) {
        if (assignment.kind) { await this.arrayAssignment(assignment, state, io); continue; }
        if (arrayStore(state)?.get(assignment.name)) {
          if (words.length) {
            await this.word(assignment.value, state, io, false);
            throw new ArrayFailure("indexed binding cannot be a command prefix");
          }
          await this.arrayZero(state, assignment.name, async () => {
            const fields = await this.word(assignment.value, state, io, false);
            return this.arrayJoin(requireArrays(state).owner, fields, "");
          }, assignment.append);
          continue;
        }
        let value = concatShellValues(await this.valueWord(assignment.value, state, io, false), io[valueScope]);
        if (assignment.append) value = concatShellValues([stateMonitor(state)?.values.get(assignment.name, state.variables[assignment.name] ?? "") ?? state.variables[assignment.name] ?? "", value], io[valueScope]);
        if (state.readonlyVariables?.has(assignment.name)) {
          await this.diagnostic(io, `${assignment.name}: readonly variable`);
          if (state.profile === "sh" || !words.length) throw new Flow("exit", state.profile === "sh" && (special || !words.length) ? 127 : 1);
          continue;
        }
        if (!previous.has(assignment.name)) {
          const saved = saveVariable(state, assignment.name);
          if (words.length && guestArrays(state)) await this.prepareVariable(state, assignment.name, saved, true);
          previous.set(assignment.name, saved);
        }
        this.writeVariable(state, assignment.name, value);
        if (words.length) state.exported.add(assignment.name);
      }
    };
    let overlayOpen = false;
    try {
      if (snapshotScope) state = await cloneState(state, this.signal, snapshotScope);
      if (words.length) {
        stateMonitor(state)?.openOverlay(previous);
        overlayOpen = true;
      }
      if (inlineInput || (state.profile === "sh" || !words.length) && assignments.some(assignment => state.readonlyVariables?.has(assignment.name))) await assign();
      if (inlineInput && functionCommand && previous.size) {
        const redirectState = await cloneState(state, this.signal);
        const variables = redirectState.variables;
        const redirectAssignments = new Map<string, ShellValue>();
        for (const [name, saved] of previous) {
          redirectAssignments.set(name, stateMonitor(state)!.values.get(name, state.variables[name]!));
          if (saved.value === undefined) delete variables[name];
          else publishVariable(redirectState, name, saved.heldValue?.value ?? saved.value);
        }
        redirectState.redirectAssignments = redirectAssignments;
        const savedIndex = previous.get("OPTIND");
        if (savedIndex?.getopts) redirectState.getopts = { integer: savedIndex.getopts.integer, cursor: cloneGetoptsState(savedIndex.getopts.cursor) };
        const parentStore = arrayStore(state);
        const copyOwner = parentStore ? ArrayOwner.create(parentStore.owner.ledger, parentStore.owner) : undefined;
        const holding = parentStore?.owner.hold();
        copyOwner?.reserve({ metadata: 64, work: 3 });
        const publications = new Map<string, { binding: IndexedBinding; tickets: Admission }>();
        if (parentStore && copyOwner) for (const [name, entry] of parentStore.bindings) {
          copyOwner.reserve({ slots: 1, metadata: 32, work: 5 });
          publications.set(name, { binding: entry.binding, tickets: copyOwner.reserve({ generation: true, version: true, epoch: true, work: 8 }) });
        }
        const epoch = stateMonitor(state)?.epoch;
        try {
          io = await this.redirect(command.redirects, redirectState, io, inputs, outputs, false, true, false, command.line ?? 1);
          if (parentStore && stateMonitor(state)!.epoch !== epoch) throw new ArrayFailure("stale state snapshot");
        } finally {
          try {
          const stale = parentStore && stateMonitor(state)!.epoch !== epoch;
          if (!stale) {
          if (parentStore) for (const [name, publication] of publications) {
            const changed = arrayStore(redirectState)!.get(name);
            if (!previous.has(name) && changed && changed !== publication.binding) {
              let released: Promise<void> | undefined;
              stateMonitor(state)!.publish(publication.tickets, name, () => { released = parentStore.publish(name, changed.retain(), publication.tickets); });
              await released;
            }
          }
          state.substitutionStatus = redirectState.substitutionStatus;
          for (const [name, value] of Object.entries(variables)) {
            if (!previous.has(name)) publishVariable(state, name, stateMonitor(redirectState)!.values.get(name, value));
          }
          for (const [name, saved] of previous) {
            saved.value = variables[name];
            const value = stateMonitor(redirectState)!.values.get(name, saved.value ?? "");
            const held = saved.value === undefined ? undefined : stateMonitor(state)!.values.scope.hold(value);
            saved.heldValue?.release();
            if (held) saved.heldValue = held;
            else delete saved.heldValue;
            if (name === "OPTIND") saved.getopts = cloneGetoptsBinding(redirectState);
          }
          if (!previous.has("OPTIND")) state.getopts = cloneGetoptsBinding(redirectState);
          }
          } finally { try { await copyOwner?.close(); } finally { holding?.release(); stateMonitor(redirectState)?.closeValues(); } }
        }
      } else io = await this.redirect(command.redirects, state, io, inputs, outputs, isolatedInlineInput, !words.length || shellBuiltinNames.has(words[0]!) || functionCommand, fileShortcut, command.line ?? 1);
      if (!inlineInput) await assign();
      if (fileShortcut) {
        const input = io.descriptors?.get(command.redirects[0]!.descriptor)?.input;
        if (!input) throw new Error("Bad file descriptor");
        await pipeBytes(input, io.stdout, this.signal);
        return 0;
      }
      return words.length ? await this.dispatch(words[0]!, words.slice(1), state, io, previous, false, wordValues.slice(1)) : state.substitutionStatus;
    } catch (error) {
      if (error instanceof Flow) throw error;
      this.signal.throwIfAborted();
      const original = error instanceof ExecutionFailure ? error.original : error;
      if (special && !(original instanceof ShellLimitError) && !(original instanceof ExpansionFailure) && !(original instanceof Flow) && !(original instanceof ShellSyntaxError)) {
        throw new ExecutionFailure(new FatalCommandFailure(message(original), 1), error instanceof ExecutionFailure ? error.io : io, error instanceof ExecutionFailure ? error.diagnostic : undefined);
      }
      if (error instanceof ExecutionFailure) throw error;
      throw new ExecutionFailure(error, io);
    } finally {
      if (overlayOpen) {
        for (const [key, saved] of previous) await originalIO[invocationScope].cleanup(async () => {
          if (saved.superseded) await this.discardVariable(saved);
          else await restoreVariable(state, key, saved);
        });
        await originalIO[invocationScope].cleanup(() => stateMonitor(state)?.closeOverlay(previous));
      } else for (const saved of previous.values()) saved.heldValue?.release();
    }
  }

  async dispatch(name: string, args: readonly string[], state: State, io: IO, assignments: Map<string, SavedVariable>, bypassFunctions = false, values: readonly ShellValue[] = args): Promise<number> {
    const scope = io[invocationScope].child();
    const runtime = new Runtime(
      this.fs, this.commands, this.middleware, this.budget,
      AbortSignal.any([this.signal, scope.signal]), this.fileWrites, this.outputFiles, this.commandSignal,
      this.cancellation, this.cancellationState, this.cancellationOwner,
      this.cancellationDepth, this.cancellationMaxDepth, this.outcomeFrame,
    );
    try { return await runtime.dispatchScoped(name, values, state, { ...io, [invocationScope]: scope }, assignments, bypassFunctions); }
    finally { await scope.close(); }
  }

  private async dispatchScoped(name: string, values: readonly ShellValue[], state: State, io: IO, assignments: Map<string, SavedVariable>, bypassFunctions: boolean): Promise<number> {
    const { [invocationScope]: scope, ...publicIO } = io;
    const allocation = this.budget.values.scope();
    scope.register(() => allocation.close());
    const argumentValues = this.admitArguments(values, allocation);
    let builtinFailure: { error: unknown; diagnostic: string } | undefined;
    const env = Object.create(null) as Record<string, string>;
    for (const key of state.exported) {
      const value = state.variables[key];
      if (value !== undefined) env[key] = value;
    }
    const initialEnv = { ...env };
    const runtimeFrame: RuntimeOutcomeFrame = {};
    const context: ShellCommandContext = {
      ...publicIO, command: name, args: argumentValues.args, argumentValues, env, cwd: state.cwd, fs: this.fs, signal: this.commandSignal,
      registerCleanup: (cleanup) => scope.register(cleanup),
      invoke: (name, args, options) => {
        const invocation = this.invoke(name, args, options, context, state, scope);
        void invocation.catch(() => undefined);
        return invocation;
      },
    };
    bindFileOutputBudget(context, sink => this.budget.sink(sink, this.signal));
    if (argumentValues.values.every(value => typeof value === "string")) Reflect.deleteProperty(context, "argumentValues");
    const middleware = this.middleware.map<Middleware>((handler) => (context, next) => {
      scope.assertOpen();
      let downstream: Promise<CommandResult> | undefined;
      const raw = handler(context, () => {
        downstream = next();
        return downstream;
      });
      return this.observeRuntimeReturn(raw, runtimeFrame, () => downstream);
    });
    const execute = composeMiddleware(middleware, (forwarded) => scope.run(async () => {
      scope.assertOpen();
      const forwardedValues = getCommandArguments(forwarded);
      const admitted = forwardedValues === argumentValues ? argumentValues : this.admitArguments(forwardedValues.values, allocation);
      const context = { ...forwarded, args: admitted.args, argumentValues: admitted, [invocationScope]: scope };
      const previous = new Map<string, SavedVariable & { overlay: string | undefined }>();
      const cwd = state.cwd;
      const directoryStackCwdPublication = state.directoryStackCwdPublication;
      const environmentKeys = new Set([...Object.keys(initialEnv), ...Object.keys(context.env)]);
      const typedEnvironment = [...environmentKeys].some(key => arrayStore(state)?.get(key) && initialEnv[key] !== context.env[key]);
      const cwdRestoration = stateMonitor(state)?.restoration(true);
      if (typedEnvironment) {
        const store = requireArrays(state);
        store.owner.reserve({ metadata: 64 + environmentKeys.size * 64, allocatedSlots: environmentKeys.size * 2, work: environmentKeys.size * 4 + 4 });
        const publications = new Map<string, Admission>();
        try {
          for (const key of environmentKeys) {
            const value: unknown = Object.hasOwn(context.env, key) ? context.env[key] : undefined;
            if (key.includes("\0") || key.includes("=") || Object.hasOwn(context.env, key) && (typeof value !== "string" || value.includes("\0"))) throw new TypeError("Invalid middleware environment value");
            if (initialEnv[key] === value) continue;
            if (state.readonlyVariables?.has(key)) throw new ArrayFailure("readonly environment collision");
          }
          for (const key of environmentKeys) {
            const value = Object.hasOwn(context.env, key) ? context.env[key] : undefined;
            if (initialEnv[key] === value) continue;
            const saved = { ...saveVariable(state, key), overlay: value };
            await this.prepareVariable(state, key, saved);
            if (value !== undefined) await textToken(store.owner, value, this.signal);
            previous.set(key, saved);
            publications.set(key, store.tickets(key));
          }
          const cwdPublication = store.tickets();
          for (const [key, saved] of previous) {
            if (state.readonlyVariables?.has(key)) throw new ArrayFailure("readonly environment collision");
            if (!typedSavedVariables.get(saved)!.watch.valid()) throw new ArrayFailure("stale binding");
          }
          this.signal.throwIfAborted();
          stateMonitor(state)!.publish(cwdPublication, undefined, () => { state.cwd = resolvePath("/", context.cwd); });
          cwdPublication.release();
          for (const [key, saved] of previous) {
            const publication = publications.get(key)!;
            stateMonitor(state)!.publish(publication, key, () => {
              void store.remove(key, publication);
              if (saved.overlay === undefined) { delete state.variables[key]; state.exported.delete(key); }
              else { publishVariable(state, key, saved.overlay); state.exported.add(key); }
              if (key === "OPTIND") this.reconcileGetopts(state, saved.value);
            });
            typedSavedVariables.get(saved)!.overlayVersion = publication.version;
            publication.release();
          }
        } catch (error) {
          for (const saved of previous.values()) await this.discardVariable(saved);
          for (const publication of publications.values()) publication.release();
          cwdRestoration?.close();
          throw error;
        }
      } else {
      state.cwd = resolvePath("/", context.cwd);
      for (const key of environmentKeys) {
        if (Object.hasOwn(context.env, key) && typeof context.env[key] !== "string") throw new TypeError("Invalid middleware environment value");
        if (initialEnv[key] === context.env[key]) continue;
        const value = context.env[key];
        if (key.includes("\0") || key.includes("=") || (value !== undefined && (typeof value !== "string" || value.includes("\0")))) throw new TypeError("Invalid middleware environment value");
        previous.set(key, { ...saveVariable(state, key), overlay: value });
        if (value === undefined) { delete state.variables[key]; state.exported.delete(key); }
        else { publishVariable(state, key, value); state.exported.add(key); }
        if (key === "OPTIND") this.reconcileGetopts(state, previous.get(key)!.value);
      }
      }
      stateMonitor(state)?.openOverlay(previous);
      try {
        const selected = this.internalDiscovery(context.command, state, bypassFunctions)[0];
        const body = selected?.kind === "function" ? state.functions.get(context.command) : undefined;
        if (body) {
          if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
          const positional = state.positional;
          const savedPositionals = stateMonitor(state)!.positionals.clone();
          const positionalSetVersion = state.positionalSetVersion ?? 0;
          const frameOwner = guestArrays(state)?.owner;
          frameOwner?.reserve({ metadata: 256 + context.args.length * 32, allocatedSlots: context.args.length + 1, work: context.args.length + 16 });
          const getoptsEntry = cloneGetoptsBinding(state);
          const functionRestoration = stateMonitor(state)?.restoration(true);
          let getoptsRestoration: Restoration | undefined;
          const locals = new Map<string, SavedVariable>();
          try {
            getoptsRestoration = stateMonitor(state)?.restoration();
            const stack = state.locals;
            const argumentsCopy = [...context.args];
            const monitor = stateMonitor(state);
            const preparedLocals = frameOwner ? monitor!.prepareCollection(locals, "locals") : locals;
            const preparedArguments = frameOwner ? monitor!.prepareCollection(argumentsCopy, "positional") : argumentsCopy;
            const entry = () => {
              this.replacePositionals(state, context.argumentValues.values, () => { state.positional = preparedArguments; });
              state.functionDepth++;
              state.depth++;
              stack.push(preparedLocals);
            };
            if (frameOwner) {
              const tickets = frameOwner.reserve({ epoch: true, work: 8 });
              monitor!.publish(tickets, undefined, entry);
              tickets.release();
            } else entry();
          } catch (error) { savedPositionals.close(); getoptsRestoration?.close(); functionRestoration?.close(); throw error; }
          try { return { exitCode: await this.command(body, state, { ...io, ...context, scriptName: body.sourceName ?? io.scriptName ?? "shell" }) }; }
          catch (error) {
            if (error instanceof Flow && error.kind === "return") return { exitCode: error.status };
            throw error;
          } finally {
            const restoreControls = () => {
              stateMonitor(state)!.positionals.restore(savedPositionals, () => { state.positional = positional; });
              savedPositionals.close();
              state.positionalSetVersion = positionalSetVersion;
              state.functionDepth--;
              state.depth--;
              state.locals.pop();
            };
            await scope.cleanup(() => {
              if (functionRestoration) functionRestoration.apply(restoreControls, false);
              else restoreControls();
            });
            for (const [name, previous] of locals) await scope.cleanup(async () => {
              const typed = typedSavedVariables.has(previous);
              await restoreVariable(state, name, previous);
              if (!typed && !previous.readOnly) state.readonlyVariables?.delete(name);
            });
            if (locals.has("OPTIND")) await scope.cleanup(() => {
              const restoreGetopts = () => {
                state.getopts ??= getoptsEntry;
                state.getopts.cursor = getoptsEntry.cursor;
              };
              if (getoptsRestoration) getoptsRestoration.apply(restoreGetopts);
              else restoreGetopts();
            });
            await scope.cleanup(() => getoptsRestoration?.close());
            await scope.cleanup(() => functionRestoration?.close());
          }
        }
        if (selected?.kind === "builtin") {
          if (context.command === "command" || context.command === "builtin" || context.command === "type") return { exitCode: await this.discoveryBuiltin(context, state, io, assignments) };
          const special = state.profile === "sh" && !bypassFunctions && specialBuiltinNames.has(context.command);
          if (special) assignments.clear();
          if (context.command === "." || context.command === "source") return { exitCode: await this.sourceBuiltin(context, state, { ...io, ...context }, special) };
          if (context.command === "eval") return { exitCode: await this.evalBuiltin(context, state, { ...io, ...context }, special) };
          const builtinWork = this.builtin(context, state, assignments, (error, diagnostic) => { builtinFailure = { error, diagnostic }; }, bypassFunctions);
          const builtin = arrayStore(state) ? await interruptible(builtinWork, this.signal) : await builtinWork;
          if (builtin !== undefined) {
            if (special && builtin !== 0 && context.command !== "shift") throw new Flow("exit", builtin);
            return { exitCode: builtin };
          }
        }
        const definition = this.commands.get(context.command);
        if (context.command === "printf" && definition?.execute === printfCommand.execute && context.args[0]?.startsWith("-v")) {
          return { exitCode: await this.printfVariable(context, state, assignments) };
        }
        if (!definition) {
          if (context.command === "bash" || context.command === "sh") return { exitCode: await this.interpreter(context, state, io) };
          if (context.command.includes("/") || state.variables.PATH === undefined && state.pathUnset) return { exitCode: await this.scriptFile(context, state, io, context.command, context.args, true) };
          const target = await this.searchPath(context.command, state);
          if (target !== undefined) return { exitCode: await this.scriptFile(context, state, io, target, context.args, true) };
          await this.diagnostic({ ...io, ...context }, `${context.command}: command not found`);
          return { exitCode: 127 };
        }
        const raw = definition.execute(forwarded);
        const observed = this.observeRuntimeReturn(raw, runtimeFrame);
        return await interruptible(observed, this.signal);
      } finally {
        const restoreCwd = () => {
          if (context.command !== "cd" && state.cwd === context.cwd && state.directoryStackCwdPublication === directoryStackCwdPublication) state.cwd = cwd;
        };
        await scope.cleanup(() => {
          if (cwdRestoration) cwdRestoration.apply(restoreCwd, false);
          else restoreCwd();
        });
        for (const [key, saved] of previous) await scope.cleanup(async () => {
          const typed = typedSavedVariables.get(saved);
          if (typed) {
            const owned = typed.binding ? typed.watch.watch.version === typed.overlayVersion : state.variables[key] === saved.overlay && typed.watch.watch.typedVersion === typed.watch.typedVersion;
            if (owned) await restoreVariable(state, key, saved);
            else await this.discardVariable(saved);
            return;
          }
          if (saved.superseded || state.variables[key] !== saved.overlay) { await this.discardVariable(saved); return; }
          await restoreVariable(state, key, saved);
        });
        await scope.cleanup(() => stateMonitor(state)?.closeOverlay(previous));
        await scope.cleanup(() => cwdRestoration?.close());
      }
    }));
    try { return validateExitCode((await interruptible(execute(context), this.signal)).exitCode); }
    catch (error) {
      if (builtinFailure && error === builtinFailure.error) throw new ExecutionFailure(error, io, builtinFailure.diagnostic);
      if (runtimeFrame.report && Object.is(runtimeFrame.report.origin.signal.reason, error) && this.outcomeFrame) {
        this.outcomeFrame.report = runtimeFrame.report;
      }
      throw error;
    }
  }

  internalDiscovery(name: string, state: State, bypassFunctions = false): Discovery[] {
    const matches: Discovery[] = [];
    if (!bypassFunctions && state.functions.has(name)) matches.push({ kind: "function", name });
    if (implementedBuiltins.has(name)) matches.push({ kind: "builtin", name });
    else if (this.commands.has(name)) matches.push({ kind: "command", name });
    else if (name === "bash" || name === "sh") matches.push({ kind: "interpreter", name });
    if (state.profile === "sh" && specialBuiltinNames.has(name)) matches.sort((left, right) => Number(right.kind === "builtin") - Number(left.kind === "builtin"));
    return matches;
  }

  async discoveryBuiltin(context: CommandContext, state: State, io: IO, assignments: Map<string, SavedVariable>): Promise<number> {
    const args = [...context.args];
    const command = context.command === "command";
    const builtin = context.command === "builtin";
    let mode: "describe" | "name" | "kind" | "path" = "describe";
    let discover = !command && !builtin;
    let all = false;
    let skipFunctions = false;
    let forcePath = false;
    while (args[0]?.startsWith("-") && args[0] !== "-") {
      const option = args.shift()!;
      if (option === "--") break;
      if (builtin) { await this.diagnostic({ ...io, ...context }, `builtin: ${option}: invalid option`); return 2; }
      for (const flag of option.slice(1)) {
        if (command && (flag === "v" || flag === "V")) { discover = true; mode = flag === "v" ? "name" : "describe"; }
        else if (!command && flag === "a") all = true;
        else if (!command && flag === "f") skipFunctions = true;
        else if (!command && flag === "t") mode = "kind";
        else if (!command && (flag === "p" || flag === "P")) { mode = "path"; if (flag === "P") forcePath = true; }
        else {
          if (command && flag !== "p") {
            await this.diagnostic({ ...io, ...context }, `command: -${flag}: invalid option`);
            await writeText(context.stderr, "command: usage: command [-pVv] command [arg ...]\n");
          } else await writeText(context.stderr, `${context.command}: ${option}: unsupported option\n`);
          return 2;
        }
      }
    }
    if (!discover) {
      const target = args.shift();
      if (target === undefined) return 0;
      if (builtin && !shellBuiltinNames.has(target)) {
        await this.diagnostic({ ...io, ...context }, `builtin: ${target}: not a shell builtin`);
        return 1;
      }
      this.budget.tick();
      if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
      const restoration = stateMonitor(state)?.restoration(true);
      try { state.depth++; }
      catch (error) { restoration?.close(); throw error; }
      try { return await this.dispatch(target, args, state, { ...io, ...context }, assignments, true, getCommandArguments(context).values.slice(context.args.length - args.length)); }
      finally {
        const restore = () => { state.depth--; };
        if (restoration) restoration.apply(restore);
        else restore();
      }
    }
    let found = 0;
    for (const name of args) {
      this.signal.throwIfAborted();
      let matches = forcePath || all && mode === "path" ? [] : this.internalDiscovery(name, state, skipFunctions);
      if (!all) matches = matches.slice(0, 1);
      if (all || !matches.length) {
        const paths = await this.searchPaths(name, state, all, true);
        matches.push(...paths.map(path => {
          const absolute = command && mode === "describe";
          if ((absolute || state.profile === "sh") && !name.includes("/") && !path.startsWith("/")) {
            const relative = absolute && path.startsWith("./") ? path.slice(2) : path;
            path = `${state.cwd === "/" ? "" : state.cwd}/${relative}`;
          }
          return { kind: "file" as const, name: path };
        }));
      }
      if (!matches.length) {
        if (mode === "describe") await writeText(context.stderr, `${io.scriptName ?? "shell"}: line ${io.diagnosticLine ?? 1}: ${context.command}: ${name}: not found\n`);
        continue;
      }
      found++;
      for (const match of matches) {
        if (mode === "path" && match.kind !== "file") continue;
        let text: string;
        if (mode === "kind") text = `${match.kind}\n`;
        else if (mode === "name" || mode === "path") text = `${match.name}\n`;
        else if (match.kind === "function") text = `${name} is a function\n${functionDisplay(name, state.functions.get(name)!)}`;
        else text = `${name} is ${match.kind === "builtin" ? "a shell builtin" : match.kind === "command" ? "a registered command" : match.kind === "interpreter" ? "a virtual shell interpreter" : match.name}\n`;
        await writeText(context.stdout, text);
      }
    }
    return (command ? found > 0 || args.length === 0 : found === args.length) ? 0 : 1;
  }

  async searchPath(name: string, state: State): Promise<string | undefined> {
    return (await this.searchPaths(name, state))[0];
  }

  async searchPaths(name: string, state: State, all = false, discovery = false): Promise<string[]> {
    if (!name) return [];
    const path = state.variables.PATH;
    if (path !== undefined && Buffer.byteLength(path) > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
    const components = name.includes("/") || path === undefined ? [undefined] : path.split(":");
    if (components.length > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
    let denied: CommandFailure | undefined;
    const matches: string[] = [];
    for (const component of components) {
      this.signal.throwIfAborted();
      const target = component === undefined ? name : `${component || "."}${component?.endsWith("/") ? "" : "/"}${name}`;
      const resolved = resolvePath(state.cwd, target);
      try {
        const options = { signal: this.signal };
        if ((await interruptible(this.fs.stat(resolved, options), this.signal)).type !== "file") continue;
        if (this.fs.capabilities.permissions !== true) throw new CommandFailure(`${target}: execution permissions are not supported by this filesystem`, 126);
        await interruptible(this.fs.access(resolved, ACCESS_MODES.X_OK, options), this.signal);
        matches.push(target);
        if (!all) return matches;
      } catch (error) {
        this.signal.throwIfAborted();
        if (error instanceof CommandFailure) { if (discovery) continue; throw error; }
        const code = errorCode(error);
        if (code === "ENOENT" || code === "ENOTDIR") continue;
        if (code !== "EACCES" && code !== "EPERM") throw new CommandFailure(filesystemDiagnostic(error, target) ?? `${target}: ${message(error)}`, 126);
        denied ??= new CommandFailure(filesystemDiagnostic(error, target) ?? `${target}: ${message(error)}`, 126);
      }
    }
    if (denied && !matches.length && !discovery) throw denied;
    return matches;
  }

  processState(context: CommandContext, state: State, arg0: string, args: readonly string[]): State {
    if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
    const variables = Object.assign(Object.create(null) as Record<string, string>, context.env, { PWD: state.cwd });
    const exported = new Set(Object.keys(variables));
    variables.OPTIND = "1";
    variables.OPTERR = "1";
    return {
      cwd: state.cwd, variables, exported, functions: new Map(), getopts: { cursor: createGetoptsState(), integer: true },
      directoryStack: { entries: [], bytes: 0 },
      dotglob: false,
      positional: [...args], arg0, profile: context.command === "sh" ? "sh" : "bash", status: 0, substitutionStatus: 0, depth: state.depth + 1,
      loopDepth: 0, functionDepth: 0, locals: [], pipefail: false, isolated: true,
      errexit: false,
    };
  }

  async interpreter(context: CommandContext, state: State, io: IO, loadedSource?: { path: string; source: string }): Promise<number> {
    const args = [...context.args];
    let commandString = false;
    let standardInput = false;
    let errexit = false;
    let braceexpand = true;
    while (args.length && /^[+-]/u.test(args[0]!)) {
      const option = args.shift()!;
      if (option === "--" || option === "-") break;
      if ((option === "-o" || option === "+o") && args[0] === "braceexpand") {
        braceexpand = option === "-o";
        args.shift();
        continue;
      }
      const flags = option.slice(1);
      if (!flags.length || [...flags].some(flag => !(option[0] === "-" ? "cseB" : "eB").includes(flag))) {
        await writeText(context.stderr, `${context.command}: ${option}: unsupported option; supported flags are -c, -s, -e, +e, -B, +B and +/-o braceexpand\n`);
        return 2;
      }
      commandString ||= option.includes("c");
      standardInput ||= option.includes("s");
      if (option.includes("e")) errexit = option.startsWith("-");
      if (option.includes("B")) braceexpand = option.startsWith("-");
    }
    if (!commandString && !standardInput && args.length) return this.scriptFile(context, state, io, args[0]!, args.slice(1), false, errexit, loadedSource, braceexpand);
    const source = commandString ? args.shift() : undefined;
    if (commandString && source === undefined) {
      await writeText(context.stderr, `${context.command}: -c: option requires an argument\n`);
      return 2;
    }
    const arg0 = commandString ? args.shift() ?? context.command : context.command;
    const child = this.processState(context, state, arg0, args);
    child.errexit = errexit;
    child.braceexpand = braceexpand;
    const childIO = isolateIO({ ...io, ...context, execution: { ignoreErrexit: false }, diagnosticLine: 1, diagnosticOffset: 0, scriptName: arg0 });
    if (source !== undefined) {
      this.budget.source(Buffer.byteLength(source));
      return this.runCommandString(source, child, childIO);
    }
    const input = new ShellInput(context.stdin, this.budget, this.signal);
    return this.runStandardInput(input, child, { ...childIO, stdin: input });
  }

  async syntaxFailure(error: ShellSyntaxError, source: string, io: IO, commandString: boolean): Promise<number> {
    const offset = io.diagnosticOffset ?? 0;
    const line = source.slice(0, error.offset).split("\n").length;
    const prefix = `${io.scriptName ?? "shell"}:${commandString ? " -c:" : ""}`;
    if (error.unclosedQuote) await writeText(io.stderr, `${prefix} line ${offset + error.unclosedQuote.line}: unexpected EOF while looking for matching \`${error.unclosedQuote.quote}'\n`);
    else if (error.offset >= source.length && !/Unterminated|nesting|Unsupported/u.test(error.reason)) {
      const context = error.incompleteCommand ? ` from \`${error.incompleteCommand.name}' command on line ${offset + error.incompleteCommand.line}` : "";
      await writeText(io.stderr, `${prefix} line ${offset + source.split("\n").length + Number(!source.endsWith("\n"))}: syntax error: unexpected end of file${context}\n`);
    } else {
      const token = /^[;&|()<>]|^[^\s;&|()<>]+/u.exec(source.slice(error.offset))?.[0] ?? "newline";
      await writeText(io.stderr, `${prefix} line ${offset + line}: syntax error near unexpected token \`${token}'\n${prefix} line ${offset + line}: \`${source.split("\n")[line - 1] ?? ""}'\n`);
    }
    return error.exitCode;
  }

  async runCommandString(source: string, state: State, io: IO): Promise<number> {
    const lineIndex = new SourceLineIndex(source, this.budget.parsing);
    let position = 0;
    let status = 0;
    try {
      do {
        this.signal.throwIfAborted();
        const unit = parseShellUnit(source, position, byteLocale(state.variables), this.budget.parsing, lineIndex);
        for (const warning of unit.script.warnings ?? []) await writeText(io.stderr, `${io.scriptName}: warning: ${warning}\n`);
        if (unit.script.lists.length) {
          const result = await this.runUnit(unit.script, state, io);
          status = result.exitCode;
          if (result.terminated) return status;
        }
        position = unit.next;
      } while (position < source.length);
      return status;
    } catch (error) {
      if (!(error instanceof ShellSyntaxError)) throw error;
      return this.syntaxFailure(error, source, io, true);
    }
  }

  sourceText(bytes: Uint8Array, name: string): string {
    if (bytes.some(byte => byte < 9 || byte > 10 && byte < 13 || byte > 13 && byte < 32 || byte === 127)) throw new CommandFailure(`${name}: cannot execute binary script`, 126);
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new CommandFailure(`${name}: cannot execute binary or non-UTF-8 script`, 126); }
  }

  async runStandardInput(input: ShellInput, state: State, io: IO): Promise<number> {
    let source = "";
    let lineIndex = new SourceLineIndex(source, this.budget.parsing);
    let offset = 0;
    let status = 0;
    let lines = 0;
    while (true) {
      if (++lines % 32 === 0) await yieldTurn(this.signal);
      this.signal.throwIfAborted();
      const bytes = await input.sourceLine();
      const eof = bytes === undefined;
      if (bytes) {
        lineIndex.append(this.sourceText(bytes, io.scriptName ?? "shell"));
        source = lineIndex.source;
      }
      const unitIO = { ...io, diagnosticOffset: offset };
      try {
        const unit = eof ? parseShellUnit(source, 0, byteLocale(state.variables), this.budget.parsing, lineIndex) : parseShellInputUnit(source, byteLocale(state.variables), this.budget.parsing, lineIndex);
        if (unit) {
          for (const warning of unit.script.warnings ?? []) await writeText(io.stderr, `${io.scriptName}: warning: ${warning}\n`);
          if (unit.script.lists.length) {
            const result = await this.runUnit(unit.script, state, unitIO);
            status = result.exitCode;
            if (result.terminated) return status;
          }
          offset += source.slice(0, unit.next).split("\n").length - 1;
          source = source.slice(unit.next);
          lineIndex = new SourceLineIndex(source, this.budget.parsing);
        }
      } catch (error) {
        if (!(error instanceof ShellSyntaxError)) throw error;
        return this.syntaxFailure(error, source, unitIO, false);
      }
      if (eof) return status;
    }
  }

  private static readonly envShebangCommand = executionCommands(() => { throw new Error("Unreserved shebang invocation"); }).find(command => command.name === "env");

  private async shebangState(context: CommandContext, state: State): Promise<State> {
    const child = await cloneState(state, this.signal);
    child.cwd = resolvePath("/", context.cwd);
    if (guestArrays(child) || Object.keys(context.env).some(key => arrayStore(child)?.get(key))) {
      await this.indexedEnvironment(child, context.env);
      this.reconcileGetopts(child, state.variables.OPTIND);
      return child;
    }
    for (const key of child.exported) delete child.variables[key];
    for (const [key, value] of Object.entries(context.env)) {
      if (key.includes("\0") || key.includes("=") || typeof value !== "string" || value.includes("\0")) throw new TypeError("Invalid middleware environment value");
      child.variables[key] = value;
    }
    child.exported = new Set(Object.keys(context.env));
    this.reconcileGetopts(child, state.variables.OPTIND);
    return child;
  }

  private async shebangStage(
    incoming: CommandContext, state: State, io: IO,
    terminal: (runtime: Runtime, context: ShellCommandContext, child: State, childIO: IO) => Promise<CommandResult>,
    prepare?: (runtime: Runtime, context: ShellCommandContext, child: State, childIO: IO) => CommandInvoker,
    replacementInput?: ByteSource,
    existingScope?: InvocationScope,
  ): Promise<number> {
    const scope = existingScope ?? io[invocationScope].child();
    const ownsScope = existingScope === undefined;
    const runtime = new Runtime(
      this.fs, this.commands, this.middleware, this.budget,
      AbortSignal.any([this.signal, scope.signal]), this.fileWrites, this.outputFiles, this.commandSignal,
      this.cancellation, this.cancellationState, this.cancellationOwner,
      this.cancellationDepth, this.cancellationMaxDepth, this.outcomeFrame,
    );
    let input: ShellInput | undefined;
    try {
      const allocation = this.budget.values.scope();
      scope.register(() => allocation.close());
      const argumentValues = this.admitArguments(getCommandArguments(incoming).values, allocation);
      scope.register(async () => {
        try { await input?.close(); }
        catch (error) { if (!this.signal.aborted || error !== this.signal.reason) throw error; }
      });
      if (replacementInput !== undefined) input = new ShellInput(replacementInput, this.budget, this.signal);
      const invocationOverride: { current: CommandInvoker | undefined } = { current: undefined };
      const context: ShellCommandContext = {
        ...incoming, args: argumentValues.args, argumentValues,
        env: Object.assign(Object.create(null) as Record<string, string>, incoming.env),
        stdin: input ?? incoming.stdin,
        stdout: this.budget.sink(incoming.stdout, runtime.signal), stderr: this.budget.sink(incoming.stderr, runtime.signal),
        signal: this.commandSignal, registerCleanup: cleanup => scope.register(cleanup),
        invoke: (name, args, options) => {
          const invocation = invocationOverride.current ? invocationOverride.current(name, args, options) : runtime.invoke(name, args, options, context, child, scope);
          void invocation.catch(() => undefined);
          return invocation;
        },
      };
      bindFileOutputBudget(context, sink => this.budget.sink(sink, runtime.signal));
      if (argumentValues.values.every(value => typeof value === "string")) Reflect.deleteProperty(context, "argumentValues");
      const child = await runtime.shebangState(context, state);
      const childIO = { ...io, ...context, [invocationScope]: scope };
      invocationOverride.current = prepare?.(runtime, context, child, childIO);
      const runtimeFrame: RuntimeOutcomeFrame = {};
      const middleware = this.middleware.map<Middleware>(handler => (context, next) => {
        scope.assertOpen();
        let downstream: Promise<CommandResult> | undefined;
        const raw = handler(context, () => {
          downstream = next();
          return downstream;
        });
        return runtime.observeRuntimeReturn(raw, runtimeFrame, () => downstream);
      });
      const execute = composeMiddleware(middleware, async () => {
        scope.assertOpen();
        const forwardedValues = getCommandArguments(context);
        const admitted = forwardedValues === argumentValues ? argumentValues : runtime.admitArguments(forwardedValues.values, allocation);
        const selected = { ...context, args: admitted.args, argumentValues: admitted };
        const forwarded = await runtime.shebangState(selected, child);
        selected.cwd = forwarded.cwd;
        const raw = terminal(runtime, selected, forwarded, { ...childIO, ...selected });
        return await runtime.observeRuntimeReturn(raw, runtimeFrame);
      });
      try {
        const result = await interruptible(execute(context), runtime.signal);
        runtime.signal.throwIfAborted();
        return validateExitCode(result.exitCode);
      } catch (error) {
        if (runtimeFrame.report && Object.is(runtimeFrame.report.origin.signal.reason, error) && runtime.outcomeFrame) {
          runtime.outcomeFrame.report = runtimeFrame.report;
        }
        throw error;
      }
    } finally { if (ownsScope) await scope.close(); }
  }

  private shebangTarget(context: CommandContext, state: State, io: IO, command: string, args: readonly string[], options: ShellInvokeOptions, target: string, loadedSource: { path: string; source: string }): Promise<CommandResult> {
    return this.invokeChild(options, state, io[invocationScope], () => {
      this.signal.throwIfAborted();
      io[invocationScope].assertOpen();
      if (typeof command !== "string" || command.includes("\0") || !Array.isArray(args)
        || args.some(argument => typeof argument !== "string" || argument.includes("\0"))) {
        throw new TypeError("invoke requires a command and literal string arguments without NUL");
      }
      this.budget.tick();
      if (args.length + 1 > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
      for (const argument of [command, ...args]) {
        if (Buffer.byteLength(argument) > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
      }
    }, (runtime, scope) => runtime.shebangTargetScoped(context, state, io, command, args, options, target, loadedSource, scope));
  }

  private async shebangTargetScoped(context: CommandContext, state: State, io: IO, command: string, args: readonly string[], options: ShellInvokeOptions, target: string, loadedSource: { path: string; source: string }, scope: InvocationScope): Promise<CommandResult> {
    const reserved = command === "bash" || command === "sh";
    const direct = command.includes("/");
    const definition = this.commands.get(command);
    const child = await this.shebangState(context, state);
    child.cwd = resolvePath(context.cwd, options.cwd ?? ".");
    if (!reserved) {
      if (child.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
      child.depth++;
      child.loopDepth = 0;
      child.functionDepth = 0;
      child.sourceDepth = 0;
      child.locals = [];
    }
    const stdinIsDefault = options.stdin === undefined ? context.stdinIsDefault : options.stdinIsDefault ?? false;
    const argumentValues = getCommandArguments({ args, ...(options.argumentValues ? { argumentValues: options.argumentValues } : {}) });
    const selected: CommandContext = {
      ...context, command, args: argumentValues.args, argumentValues, cwd: child.cwd,
      env: options.replaceEnv ? { ...options.env } : { ...context.env, ...options.env, PWD: child.cwd },
      stdin: options.stdin ?? context.stdin,
      stdout: options.stdout ?? context.stdout, stderr: options.stderr ?? context.stderr,
      ...(stdinIsDefault === undefined ? {} : { stdinIsDefault }),
    };
    const exitCode = await this.shebangStage(selected, child, io, async (runtime, forwarded, state, childIO) => {
      if (reserved) {
        if (definition) {
          await runtime.diagnostic(childIO, `${target}: unsupported interpreter override: ${command}`);
          return { exitCode: 126 };
        }
        return { exitCode: await runtime.interpreter(forwarded, state, childIO, loadedSource) };
      }
      if (direct) return { exitCode: await runtime.scriptFile(forwarded, state, childIO, command, forwarded.args, true) };
      if (definition) return definition.execute(forwarded);
      await writeText(forwarded.stderr, `env: ${command}: command not found\n`);
      return { exitCode: 127 };
    }, undefined, options.stdin !== context.stdin ? options.stdin : undefined, scope);
    return { exitCode };
  }

  private async envShebang(context: CommandContext, state: State, io: IO, optionalArgument: string | undefined, target: string, args: readonly string[], loadedSource: { path: string; source: string }): Promise<number> {
    const definition = Runtime.envShebangCommand;
    if (!definition) throw new CommandFailure(`${target}: env interpreter is unavailable`, 126);
    const allocation = this.budget.values.scope();
    io[invocationScope].register(() => allocation.close());
    const incoming = getCommandArguments({ args, ...(context.argumentValues ? { argumentValues: context.argumentValues } : {}) });
    const argumentValues = this.admitArguments([...(optionalArgument === undefined ? [] : [optionalArgument]), target, ...incoming.values], allocation);
    return this.shebangStage({
      ...context, command: "env", args: argumentValues.args, argumentValues,
    }, state, io, async (runtime, forwarded) => {
      let failed = false;
      let failure: unknown;
      let failureReport: CancellationReport | undefined;
      const result = await interruptible(Promise.resolve(definition.execute({
        ...forwarded,
        invoke: (command, arguments_, options) => {
          const raw = forwarded.invoke(command, arguments_, options);
          return raw.catch(error => {
            failed = true;
            failure = error;
            failureReport = runtime.cancellationState.consume(raw, error);
            return { exitCode: 1 };
          });
        },
      })), runtime.signal);
      runtime.signal.throwIfAborted();
      if (failed) {
        if (failureReport && runtime.outcomeFrame) runtime.outcomeFrame.report = failureReport;
        throw failure;
      }
      return { exitCode: validateExitCode(result.exitCode) };
    }, (runtime, forwarded, child, childIO) => (command, arguments_, options = {}) =>
      runtime.shebangTarget(forwarded, child, childIO, command, arguments_, options, target, loadedSource));
  }

  async scriptFile(context: CommandContext, state: State, io: IO, target: string, args: readonly string[], direct: boolean, errexit = false, loadedSource?: { path: string; source: string }, braceexpand = true): Promise<number> {
    if (target === "") throw new CommandFailure(`${context.command}: : No such file or directory`, 127);
    if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
    const path = resolvePath(state.cwd, target);
    let source: string;
    let environmentInterpreter: RegExpExecArray | null = null;
    let interpreterProfile: "bash" | "sh" | undefined;
    try {
      if (loadedSource?.path === path) source = loadedSource.source;
      else {
        const options = { signal: this.signal };
        const stat = await interruptible(this.fs.stat(path, options), this.signal);
        if (stat.type !== "file") throw new CommandFailure(`${target}: ${stat.type === "directory" ? "Is a directory" : "not a regular file"}`, 126);
        if (direct && this.fs.capabilities.permissions !== true) throw new CommandFailure(`${target}: execution permissions are not supported by this filesystem`, 126);
        await interruptible(this.fs.access(path, ACCESS_MODES.R_OK | (direct ? ACCESS_MODES.X_OK : 0), options), this.signal);
        const maxBytes = this.budget.limits.maxSourceBytes - this.budget.sourceBytes;
        if (stat.size > maxBytes) this.budget.fail("maxSourceBytes");
        const bytes = await interruptible(this.fs.readFile(path, { ...options, maxBytes }), this.signal);
        this.budget.source(bytes.byteLength);
        source = this.sourceText(bytes, target);
      }
      if (direct && source.startsWith("#!")) {
        const interpreter = source.split("\n", 1)[0]!.slice(2).replace(/^[ \t]+|[ \t]+$/gu, "");
        environmentInterpreter = /^\/usr\/bin\/env(?:[ \t]+([^\n]*))?$/u.exec(interpreter);
        if (!environmentInterpreter) {
          const shell = /^\/(?:usr\/)?bin\/(bash|sh)(?:[ \t]+([-+]e+))?$/u.exec(interpreter);
          if (!shell) throw new CommandFailure(`${target}: unsupported interpreter: ${interpreter}`, 126);
          interpreterProfile = shell[1] === "sh" ? "sh" : "bash";
          if (shell[2]) errexit = shell[2].startsWith("-");
        }
      }
    } catch (error) {
      this.signal.throwIfAborted();
      if (error instanceof ShellLimitError || error instanceof CommandFailure) throw error;
      if (errorCode(error) === "EFBIG") this.budget.fail("maxSourceBytes");
      throw new CommandFailure(filesystemDiagnostic(error, target) ?? `${target}: ${message(error)}`, errorCode(error) === "ENOENT" ? 127 : 126);
    }
    if (direct && environmentInterpreter) return this.envShebang(context, state, io, environmentInterpreter[1], target, args, { path, source });
    const units: Script[] = [];
    const lineIndex = new SourceLineIndex(source, this.budget.parsing);
    try {
      let position = 0;
      do {
        this.signal.throwIfAborted();
        const unit = parseShellUnit(source, position, byteLocale(context.env), this.budget.parsing, lineIndex);
        units.push(unit.script);
        position = unit.next;
      } while (position < source.length);
    } catch (error) {
      if (!(error instanceof ShellSyntaxError)) throw error;
      const line = source.slice(0, error.offset).split("\n").length;
      await writeText(context.stderr, `${target}: line ${line}: syntax error: ${error.reason}\n`);
      return error.exitCode;
    }
    const child = this.processState(context, state, target, args);
    child.errexit = errexit;
    child.braceexpand = braceexpand;
    if (direct) child.profile = interpreterProfile ?? state.profile ?? "bash";
    const childIO = isolateIO({ ...io, ...context, execution: { ignoreErrexit: false }, diagnosticLine: 1, diagnosticOffset: 0, scriptName: target });
    let status = 0;
    for (const unit of units) {
      for (const warning of unit.warnings ?? []) await writeText(context.stderr, `${target}: warning: ${warning}\n`);
      if (!unit.lists.length) continue;
      const result = await this.runUnit(unit, child, childIO);
      status = result.exitCode;
      if (result.terminated) break;
    }
    return status;
  }

  async runCurrentText(source: string, state: State, io: IO, fatalSyntax: boolean, syntaxName?: string): Promise<number> {
    const lineIndex = new SourceLineIndex(source, this.budget.parsing);
    let position = 0;
    let status = 0;
    let executed = false;
    try {
      do {
        this.signal.throwIfAborted();
        const unit = parseShellUnit(source, position, byteLocale(state.variables), this.budget.parsing, lineIndex);
        for (const warning of unit.script.warnings ?? []) await writeText(io.stderr, `${io.scriptName ?? "shell"}: warning: ${warning}\n`);
        if (unit.script.lists.length) {
          status = await this.script(unit.script, state, io);
          executed = true;
        }
        position = unit.next;
      } while (position < source.length);
      return status;
    } catch (error) {
      if (!(error instanceof ShellSyntaxError)) throw error;
      const status = await this.syntaxFailure(error, source, syntaxName === undefined ? io : { ...io, scriptName: syntaxName }, false);
      if (fatalSyntax && !executed) throw new Flow("exit", status);
      return status;
    }
  }

  async evalBuiltin(context: CommandContext, state: State, io: IO, special: boolean): Promise<number> {
    const args = [...context.args];
    if (args[0] === "--") args.shift();
    else if (args[0]?.startsWith("-") && args[0] !== "-") {
      await this.diagnostic(io, `eval: -${args[0][1]}: invalid option`);
      await writeText(io.stderr, "eval: usage: eval [arg ...]\n");
      if (special) throw new Flow("exit", 2);
      return 2;
    }
    if (!args.length) return 0;
    if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
    const source = args.join(" ");
    this.budget.source(Buffer.byteLength(source));
    this.sourceText(Buffer.from(source), "eval");
    const restoration = stateMonitor(state)?.restoration(true);
    try { state.depth++; }
    catch (error) { restoration?.close(); throw error; }
    try {
      return await this.runCurrentText(source, state, { ...io, diagnosticOffset: (io.diagnosticLine ?? 1) - 1 }, special, `${io.scriptName ?? "shell"}: eval`);
    } finally {
      const restore = () => { state.depth--; };
      if (restoration) restoration.apply(restore);
      else restore();
    }
  }

  async sourceBuiltin(context: CommandContext, state: State, io: IO, special: boolean): Promise<number> {
    const args = [...context.args];
    if (args[0] === "--") args.shift();
    else if (args[0]?.startsWith("-") && args[0] !== "-") {
      await this.diagnostic(io, `${context.command}: ${args[0]}: unsupported option`);
      if (special) throw new Flow("exit", 2);
      return 2;
    }
    const filename = args.shift();
    if (filename === undefined) {
      await this.diagnostic(io, `${context.command}: filename argument required`);
      await writeText(io.stderr, `${context.command}: usage: ${context.command} [-p path] filename [arguments]\n`);
      if (special) throw new Flow("exit", 2);
      return 2;
    }
    if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
    let target = filename;
    let source: string;
    try {
      const options = { signal: this.signal };
      if (filename && !filename.includes("/") && state.variables.PATH) {
        if (Buffer.byteLength(state.variables.PATH) > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
        const components = state.variables.PATH.split(":");
        if (components.length > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
        let found = false;
        for (const component of components) {
          this.signal.throwIfAborted();
          const candidate = `${component || "."}${component.endsWith("/") ? "" : "/"}${filename}`;
          const path = resolvePath(state.cwd, candidate);
          try {
            if ((await interruptible(this.fs.stat(path, options), this.signal)).type !== "file") continue;
            await interruptible(this.fs.access(path, ACCESS_MODES.R_OK, options), this.signal);
            target = candidate;
            found = true;
            break;
          } catch (error) {
            this.signal.throwIfAborted();
            if (!["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(errorCode(error) ?? "")) throw error;
          }
        }
        if (!found && state.profile === "sh") throw new CommandFailure(`${context.command}: ${filename}: file not found`, 1);
      }
      if (!filename) throw new CommandFailure(": No such file or directory", 1);
      const path = resolvePath(state.cwd, target);
      const stat = await interruptible(this.fs.stat(path, options), this.signal);
      if (stat.type === "directory") throw new CommandFailure(`${context.command}: ${target}: is a directory`, 1);
      if (stat.type !== "file") throw new CommandFailure(`${target}: not a regular file`, 1);
      await interruptible(this.fs.access(path, ACCESS_MODES.R_OK, options), this.signal);
      const maxBytes = this.budget.limits.maxSourceBytes - this.budget.sourceBytes;
      if (stat.size > maxBytes) this.budget.fail("maxSourceBytes");
      const bytes = await interruptible(this.fs.readFile(path, { ...options, maxBytes }), this.signal);
      this.budget.source(bytes.byteLength);
      source = this.sourceText(bytes, target);
    } catch (error) {
      this.signal.throwIfAborted();
      if (error instanceof ShellLimitError) throw error;
      if (errorCode(error) === "EFBIG") this.budget.fail("maxSourceBytes");
      const diagnostic = error instanceof CommandFailure ? error.message : filesystemDiagnostic(error, target) ?? `${target}: ${message(error)}`;
      if (special) throw new FatalCommandFailure(diagnostic, 1);
      throw new CommandFailure(diagnostic, error instanceof CommandFailure ? error.status : 1);
    }
    const positional = state.positional;
    const version = state.positionalSetVersion ?? 0;
    const sourceDepth = state.sourceDepth ?? 0;
    const monitor = stateMonitor(state);
    const restoration = monitor?.restoration(true);
    let savedPositionals: ValueStore | undefined;
    try {
      if (args.length) savedPositionals = monitor!.positionals.clone();
      const owner = arrayStore(state)?.owner;
      if (owner) {
        owner.reserve({ metadata: 64 + args.length * 32, allocatedSlots: args.length, work: args.length + 4 });
        monitor!.prepareCollection(args, "positional");
      }
      const entry = () => {
        if (args.length) this.replacePositionals(state, getCommandArguments(context).values.slice(context.args.length - args.length), () => { state.positional = args; });
        state.sourceDepth = (state.sourceDepth ?? 0) + 1;
        state.depth++;
      };
      if (owner) {
        const tickets = owner.reserve({ epoch: true, work: 8 });
        monitor!.publish(tickets, undefined, entry);
        tickets.release();
      } else entry();
    } catch (error) { savedPositionals?.close(); restoration?.close(); throw error; }
    try {
      return await this.runCurrentText(source, state, { ...io, scriptName: target, diagnosticOffset: 0, diagnosticLine: 1 }, special);
    } catch (error) {
      if (error instanceof Flow && error.kind === "return") return error.status;
      throw error;
    } finally {
      const restore = () => {
        state.depth--;
        state.sourceDepth = sourceDepth;
        if (savedPositionals && (state.functionDepth > 0 || (state.positionalSetVersion ?? 0) === version)) {
          monitor!.positionals.restore(savedPositionals, () => {
            state.positional = positional;
            state.positionalSetVersion = version;
          });
        }
      };
      try {
        if (restoration) restoration.apply(restore);
        else restore();
      } finally { savedPositionals?.close(); }
    }
  }

  invoke(name: string, args: readonly string[], options: ShellInvokeOptions = {}, context: ShellCommandContext, state: State, parent: InvocationScope): Promise<{ exitCode: number }> {
    return this.invokeChild(options, state, parent, () => {
      if (typeof name !== "string" || name.includes("\0") || !Array.isArray(args)
        || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
        throw new TypeError("invoke requires a command and literal string arguments without NUL");
      }
      if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
    }, (runtime, scope) => runtime.invokeScoped(name, args, options, context, state, scope));
  }

  private async invokeScoped(name: string, args: readonly string[], options: ShellInvokeOptions, context: ShellCommandContext, state: State, scope: InvocationScope): Promise<{ exitCode: number }> {
    this.signal.throwIfAborted();
    const allocation = this.budget.values.scope();
    scope.register(() => allocation.close());
    const carrier = this.admitArguments(getCommandArguments({ args, ...(options.argumentValues ? { argumentValues: options.argumentValues } : {}) }).values, allocation);
    const child = await cloneState(state, this.signal, scope, false);
    child.cwd = resolvePath(context.cwd, options.cwd ?? ".");
    const env = options.replaceEnv ? { ...options.env } : { ...context.env, ...options.env, PWD: child.cwd };
    if (guestArrays(child) || Object.keys(env).some(key => arrayStore(child)?.get(key))) await this.indexedEnvironment(child, env);
    else {
    for (const key of child.exported) delete child.variables[key];
    for (const [key, value] of Object.entries(env)) {
      if (key.includes("\0") || key.includes("=") || typeof value !== "string" || value.includes("\0")) throw new TypeError("Invalid invoke environment entry");
      publishVariable(child, key, value);
    }
    child.exported = new Set(Object.keys(env));
    }
    this.reconcileGetopts(child, state.variables.OPTIND);
    child.depth++;
    child.loopDepth = 0;
    child.functionDepth = 0;
    child.sourceDepth = 0;
    child.locals = [];
    const input = options.stdin === undefined ? undefined : new ShellInput(options.stdin, this.budget, this.signal);
    const stdinIsDefault = options.stdin === undefined ? context.stdinIsDefault : (options.stdinIsDefault ?? false);
    const io = {
      ...context,
      [invocationScope]: scope,
      stdin: input ?? context.stdin,
      ...(stdinIsDefault === undefined ? {} : { stdinIsDefault }),
      stdout: options.stdout ? this.budget.sink(options.stdout, this.signal) : context.stdout,
      stderr: options.stderr ? this.budget.sink(options.stderr, this.signal) : context.stderr,
    };
    const command: Command = {
      kind: "simple", redirects: [],
      words: [name, ...carrier.values].map((value) => {
        const part: WordPart = { kind: "text", value: shellValueText(value), quoted: true };
        if (typeof value !== "string") invokedValues.set(part, value);
        return { offset: 0, parts: [part] };
      }),
    };
    try { return { exitCode: await this.runCommandIsolated(command, child, io) }; }
    finally { stateMonitor(child)?.closeValues(); await input?.close(); }
  }

  private async setOptions(context: CommandContext & IO, state: State): Promise<number> {
    const { args, stdout, stderr } = context;
    let index = 0;
    let positionals = false;
    while (index < args.length) {
      this.signal.throwIfAborted();
      const option = args[index]!;
      if (option === "--") { index++; positionals = true; break; }
      if (option === "-") { index++; positionals = index < args.length; break; }
      if (option[0] !== "-" && option[0] !== "+") { positionals = true; break; }
      const enabled = option[0] === "-";
      let valid = option.length > 1;
      for (let position = 1; valid && position < option.length; position++) {
        const flag = option[position];
        if (flag === "e") state.errexit = enabled;
        else if (flag === "u") state.nounset = enabled;
        else if (flag === "B") state.braceexpand = enabled;
        else if (flag === "o" && position === option.length - 1) {
          const name = args[index + 1];
          if (name === undefined) {
            const options = [["braceexpand", state.braceexpand !== false], ["errexit", !!state.errexit], ["nounset", !!state.nounset], ["pipefail", state.pipefail]] as const;
            for (const [name, active] of options) await writeText(stdout, enabled ? `${name}\t${active ? "on" : "off"}\n` : `set ${active ? "-" : "+"}o ${name}\n`);
          } else {
            if (name === "errexit") state.errexit = enabled;
            else if (name === "nounset") state.nounset = enabled;
            else if (name === "pipefail") state.pipefail = enabled;
            else if (name === "braceexpand") state.braceexpand = enabled;
            else {
              const unsupported = unsupportedSetOptionNames.has(name);
              await this.diagnostic(context, `set: ${name}: ${unsupported ? "unsupported shell option" : "invalid option name"}`);
              return unsupported ? 1 : 2;
            }
            index++;
          }
        } else valid = false;
      }
      if (!valid) {
        await writeText(stderr, "set: unsupported shell option; supported forms are +/- e/u/B clusters, -- arguments and terminal o with braceexpand, pipefail, errexit or nounset\n");
        return 1;
      }
      index++;
    }
    if (positionals) { this.replacePositionals(state, getCommandArguments(context).values.slice(index)); state.positionalSetVersion = (state.positionalSetVersion ?? 0) + 1; }
    return 0;
  }

  private async letBuiltin(context: CommandContext & IO, state: State): Promise<number> {
    this.signal.throwIfAborted();
    const { maxExpansionBytes: bytes, maxExpansionFields: fields } = this.budget.limits;
    const admit = (value: unknown): void => {
      if (typeof value !== "string" || value.includes("\0")) throw new CommandFailure("let: arguments must be strings without NUL", 2);
      if (value.length > bytes || Buffer.byteLength(value) > bytes) this.budget.fail("maxExpansionBytes");
    };
    const checkpoint = async (): Promise<void> => {
      this.signal.throwIfAborted();
      await yieldTurn(this.signal);
      this.signal.throwIfAborted();
    };
    const { args } = context;
    if (!Array.isArray(args)) throw new CommandFailure("let: argument array required", 2);
    if (args.length + 1 > fields) this.budget.fail("maxExpansionFields");
    admit(context.command);
    for (let index = 0; index < args.length; index++) {
      this.signal.throwIfAborted();
      admit(args[index]);
      if ((index + 1) % 128 === 0) await checkpoint();
    }
    if (args[0] === "--help") throw new CommandFailure("let: --help: unsupported option", 2);
    const offset = args[0] === "--" ? 1 : 0;
    if (args.length === offset) throw new CommandFailure("let: expression expected", 1);
    const variables = new Proxy(this.arithmeticVariables(state, context.diagnosticLine), { get: (target, key) => {
      this.signal.throwIfAborted();
      const value: unknown = Reflect.get(target, key);
      if (typeof value === "string" && (value.length > bytes || Buffer.byteLength(value) > bytes)) this.budget.fail("maxExpansionBytes");
      return value;
    } });
    let value = 0n;
    for (let index = offset; index < args.length; index++) {
      this.signal.throwIfAborted();
      try { value = evaluateArithmetic(prepareArithmetic(args[index]!, this.budget.parsing), variables, this.budget.parsing); }
      catch (error) {
        this.rethrowArithmeticControl(error);
        throw new Error(`let: ${message(error)}`);
      }
      if ((index - offset + 1) % 128 === 0) await checkpoint();
    }
    this.signal.throwIfAborted();
    return Number(value === 0n);
  }

  private async getoptsBuiltin(context: CommandContext & IO, state: State): Promise<number> {
    this.signal.throwIfAborted();
    const { maxExpansionBytes: bytes, maxExpansionFields: fields } = this.budget.limits;
    const admit = (value: unknown): void => {
      if (typeof value !== "string") throw new CommandFailure("getopts: arguments must be strings without NUL", 2);
      if (value.length > bytes || Buffer.byteLength(value) > bytes) this.budget.fail("maxExpansionBytes");
      if (value.includes("\0")) throw new CommandFailure("getopts: arguments must be strings without NUL", 2);
    };
    const checkpoint = async (): Promise<void> => {
      this.signal.throwIfAborted();
      await yieldTurn(this.signal);
      this.signal.throwIfAborted();
    };
    if (!Array.isArray(context.args)) throw new CommandFailure("getopts: argument array required", 2);
    if (context.args.length + 1 > fields) this.budget.fail("maxExpansionFields");
    admit(context.command);
    for (let index = 0; index < context.args.length; index++) {
      this.signal.throwIfAborted();
      admit(context.args[index]);
      if ((index + 1) % 128 === 0) await checkpoint();
    }
    const offset = context.args[0] === "--" ? 1 : 0;
    if (!offset && context.args[0]?.startsWith("-") && context.args[0] !== "-") {
      await this.diagnostic(context, `getopts: -${context.args[0][1]}: invalid option`);
      await writeText(context.stderr, "getopts: usage: getopts optstring name [arg ...]\n");
      return 2;
    }
    if (context.args.length - offset < 2) {
      await writeText(context.stderr, "getopts: usage: getopts optstring name [arg ...]\n");
      return 2;
    }
    const optstring = context.args[offset]!;
    const name = context.args[offset + 1]!;
    const args = context.args.length > offset + 2 ? context.args.slice(offset + 2) : state.positional;
    if (args.length > fields) this.budget.fail("maxExpansionFields");
    for (let index = 0; index < args.length; index++) {
      this.signal.throwIfAborted();
      admit(args[index]);
      if ((index + 1) % 128 === 0) await checkpoint();
    }
    const maxBytes = saturatedProduct(bytes, saturatedSum(args.length, 1));
    const maxSteps = saturatedSum(saturatedProduct(maxBytes, 2), saturatedSum(args.length, 2));
    state.getopts ??= cloneGetoptsBinding(state);
    let result;
    try {
      result = await scanGetopts(state.getopts.cursor, optstring, args, {
        reportErrors: state.variables.OPTERR === undefined || state.variables.OPTERR === "" || decimalIndex(state.variables.OPTERR) !== 0,
        work: { maxArguments: fields, maxBytes, maxSteps, yieldEvery: 128, signal: this.signal, checkpoint },
      });
    } catch (error) {
      this.signal.throwIfAborted();
      if (error instanceof GetoptsError && (error.code === "NON_ASCII_OPTION" || error.code === "INVALID_INPUT")) throw new CommandFailure(`getopts: ${error.message}`, 2);
      throw error;
    }
    this.signal.throwIfAborted();
    state.getopts.cursor = result.state;
    if (result.diagnostic) {
      const explanation = result.diagnostic.kind === "unknown-option" ? "illegal option" : "option requires an argument";
      await writeText(context.stderr, `${state.arg0 ?? context.scriptName ?? "shell"}: ${explanation} -- ${result.diagnostic.option}\n`);
    }
    this.signal.throwIfAborted();
    this.writeVariable(state, "OPTIND", String(result.optind), "getopts");
    if (result.argument.kind === "set") this.writeVariable(state, "OPTARG", result.argument.value, "getopts");
    else this.unsetVariable(state, "OPTARG", true);
    if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name)) throw new Error(`getopts: \`${name}': not a valid identifier`);
    await this.assignVariable(state, name, result.option, "getopts");
    return result.status;
  }

  private async changeDirectory(context: CommandContext & IO, state: State, args: readonly string[], diagnose?: (error: unknown, diagnostic: string) => void, stackHooks?: { name: string; onCwdPublished(): void; emit(text: string): Promise<void> }): Promise<number> {
    const name = stackHooks?.name ?? "cd";
    this.signal.throwIfAborted();
    if (args.length > 1) { await writeText(context.stderr, `${name}: too many arguments\n`); return 1; }
    const target = args[0] === "-" ? state.variables.OLDPWD : (args[0] ?? state.variables.HOME);
    if (target === undefined) { await writeText(context.stderr, `${name}: ${args[0] === "-" ? "OLDPWD" : "HOME"} not set\n`); return 1; }
    let selected: { path: string; print: boolean };
    try {
      selected = await new CdLookup(this.signal).find(this.fs, state.cwd, target || ".", state.variables.CDPATH);
    } catch (error) {
      this.signal.throwIfAborted();
      const description = filesystemDiagnostic(error, "");
      const text = description ? "" : message(error);
      diagnose?.(error, cdDiagnostic(description ? [name, ": ", target, description]
        : stackHooks && text.startsWith("cd: ") ? [name, text.slice(2)] : [text]));
      throw error;
    }
    this.signal.throwIfAborted();
    const { path } = selected;
    this.writeVariable(state, "OLDPWD", state.cwd);
    state.cwd = path;
    stackHooks?.onCwdPublished();
    this.writeVariable(state, "PWD", path);
    state.exported.add("PWD");
    state.exported.add("OLDPWD");
    if (selected.print || args[0] === "-") {
      if (stackHooks) await stackHooks.emit(`${path}\n`);
      else await writeText(context.stdout, `${path}\n`);
    }
    return 0;
  }

  private async directoryStackBuiltin(context: CommandContext & IO, state: State, diagnose?: (error: unknown, diagnostic: string) => void): Promise<number> {
    const { command, args } = context;
    const work = new DirectoryStackWork(command, this.signal, context.stdout);
    const tail = state.directoryStack ?? { entries: [], bytes: 0 };
    const count = tail.entries.length;
    let noCd = false;
    let clear = false;
    let long = false;
    let lines = false;
    let verbose = false;
    let selected: bigint | undefined;
    let target: string | undefined;
    let targetBytes: number | undefined;
    const boundedIndex = (index: bigint): number => {
      if (index < 0n || index > BigInt(count)) work.fail("directory stack index out of range");
      return Number(index);
    };
    const field = async (value: string): Promise<number> => {
      await work.charge(1);
      return work.scan(value, "argument");
    };
    const plan = async (length: number, removed: number | undefined, added: string | undefined, addedBytes: number | undefined, entry: (index: number) => string): Promise<NonNullable<State["directoryStack"]>> => {
      if (length > 4096) work.fail("directory stack exceeds 4096 entries");
      const removedBytes = removed === undefined ? 0 : await work.scan(tail.entries[removed]!, "path");
      const extraBytes = added === undefined ? 0 : addedBytes ?? await work.scan(added, "path");
      const bytes = tail.bytes - removedBytes + extraBytes;
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 4_194_304) work.fail("directory stack exceeds 4194304 UTF-8 bytes");
      await work.charge(length);
      const entries = new Array<string>(length);
      for (let index = 0; index < length; index++) entries[index] = entry(index);
      return { entries, bytes };
    };
    const publish = async (next: NonNullable<State["directoryStack"]>): Promise<void> => {
      await work.flushWork();
      state.directoryStack = next;
    };
    const cd = async (path: string): Promise<number> => {
      await work.flushWork();
      return this.changeDirectory(context, state, [path], diagnose, {
        name: command,
        onCwdPublished() { state.directoryStackCwdPublication = Symbol(); },
        async emit(text) { await work.emit(text); await work.flushOutput(); },
      });
    };
    const display = async (index?: number): Promise<void> => {
      await work.display(state.cwd, state.directoryStack?.entries ?? [], { long, lines, verbose, ...(index !== undefined ? { index } : {}) }, state.variables.HOME);
    };
    try {
      for (let offset = 0; offset < args.length; offset++) {
        const token = args[offset]!;
        const bytes = await field(token);
        if (token === "--") {
          if (command === "pushd" && selected === undefined && offset + 1 < args.length) {
            target = args[offset + 1]!;
            targetBytes = await field(target);
            if (!noCd && offset + 2 < args.length) work.fail("too many arguments");
          }
          break;
        }
        if (command === "dirs" && ["-c", "-l", "-p", "-v"].includes(token)) {
          if (token === "-c") clear = true;
          if (token === "-l") long = true;
          if (token === "-p") lines = true;
          if (token === "-v") verbose = true;
          continue;
        }
        if (command !== "dirs" && token === "-n") { noCd = true; continue; }
        if ((token.startsWith("+") || token.startsWith("-")) && !(command === "pushd" && token === "-")) {
          const number = await work.number(token);
          selected = token.startsWith("+") ? number : BigInt(count) - number;
          if (command === "pushd") boundedIndex(selected);
          continue;
        }
        if (command === "popd" && token === "") break;
        if (command !== "pushd") work.fail("invalid directory stack argument", 2);
        if (selected === undefined) {
          target = token;
          targetBytes = bytes;
          if (!noCd && offset + 1 < args.length) work.fail("too many arguments");
        }
        break;
      }
      if (command === "dirs") {
        if (clear) await publish({ entries: [], bytes: 0 });
        else await display(selected === undefined ? undefined : boundedIndex(selected));
      } else if (command === "pushd") {
        if (selected !== undefined) {
          const index = boundedIndex(selected);
          if (!(noCd && index === 0)) {
            const cwd = state.cwd;
            const at = (fullIndex: number): string => fullIndex === 0 ? cwd : tail.entries[fullIndex - 1]!;
            const next = await plan(count, index === 0 ? undefined : index - 1, index === 0 ? undefined : cwd, undefined,
              slot => at((index + slot + 1) % (count + 1)));
            await publish(next);
            if (!noCd) {
              const status = await cd(at(index));
              if (status !== 0) return status;
              await display();
            }
          }
        } else if (target !== undefined) {
          const saved = noCd ? target : state.cwd;
          const next = await plan(count + 1, undefined, saved, noCd ? targetBytes : undefined,
            slot => slot === 0 ? saved : tail.entries[slot - 1]!);
          if (!noCd) {
            const status = await cd(target);
            if (status !== 0) return status;
          }
          await publish(next);
          await display();
        } else if (!noCd) {
          if (!count) work.fail("no other directory");
          const cwd = state.cwd;
          const next = await plan(count, 0, cwd, undefined, slot => slot === 0 ? cwd : tail.entries[slot]!);
          await publish(next);
          const status = await cd(tail.entries[0]!);
          if (status !== 0) return status;
          await display();
        }
      } else {
        const index = boundedIndex(selected ?? 0n);
        if (!count) work.fail("directory stack empty");
        const removed = Math.max(0, index - 1);
        const next = await plan(count - 1, removed, undefined, undefined,
          slot => tail.entries[slot < removed ? slot : slot + 1]!);
        if (index === 0 && !noCd) {
          const status = await cd(tail.entries[0]!);
          if (status !== 0) return status;
        }
        await publish(next);
        await display();
      }
      return 0;
    } finally {
      await work.flushWork();
    }
  }

  private async shoptBuiltin(context: CommandContext & IO, state: State): Promise<number> {
    let print = false;
    let quiet = false;
    let set = false;
    let unset = false;
    let index = 0;
    for (; index < context.args.length; index++) {
      this.signal.throwIfAborted();
      const option = context.args[index]!;
      if (option === "--") { index++; break; }
      if (!option.startsWith("-") || option === "-") break;
      for (const flag of option.slice(1)) {
        this.signal.throwIfAborted();
        if (flag === "p") print = true;
        else if (flag === "q") quiet = true;
        else if (flag === "s") set = true;
        else if (flag === "u") unset = true;
        else {
          await this.diagnostic(context, `shopt: ${option.startsWith("--") ? option : `-${flag}`}: unsupported option`);
          await writeText(context.stderr, "shopt: usage: shopt [-pqsu] [--] [dotglob ...]\n");
          return 2;
        }
      }
    }
    if (set && unset) {
      await this.diagnostic(context, "shopt: cannot set and unset shell options simultaneously");
      return 1;
    }
    const emit = async (): Promise<void> => {
      if (!quiet) await writeText(context.stdout, print ? `shopt -${state.dotglob ? "s" : "u"} dotglob\n` : `dotglob             \t${state.dotglob ? "on" : "off"}\n`);
    };
    if (index === context.args.length) {
      if ((!set || state.dotglob) && (!unset || !state.dotglob)) await emit();
      return 0;
    }
    let status = 0;
    for (; index < context.args.length; index++) {
      this.signal.throwIfAborted();
      const name = context.args[index]!;
      if (name !== "dotglob") {
        await this.diagnostic(context, `shopt: ${name}: unsupported shell option name (only dotglob is supported)`);
        status = 1;
      } else if (set || unset) state.dotglob = set;
      else {
        await emit();
        if (!state.dotglob) status = 1;
      }
    }
    return status;
  }

  private async printfVariable(context: CommandContext & IO, state: State, assignments: Map<string, SavedVariable>): Promise<number> {
    const incoming = getCommandArguments(context);
    let offset = 0;
    let name = "";
    let index: ReturnType<typeof literalIndex> | undefined;
    while (incoming.args[offset]?.startsWith("-v")) {
      const option = incoming.args[offset++]!;
      const target = option.slice(2) || incoming.args[offset++];
      if (target === undefined) {
        await writeText(context.stderr, "printf: -v: option requires an argument\n");
        return 2;
      }
      const bracket = target.indexOf("[");
      name = bracket < 0 ? target : target.slice(0, bracket);
      if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name) || bracket >= 0 && !target.endsWith("]")) {
        await writeText(context.stderr, `printf: '${target}': not a valid identifier\n`);
        return 2;
      }
      index = undefined;
      if (bracket >= 0) {
        if (target[bracket + 1] === "'" || target[bracket + 1] === '"') {
          await writeText(context.stderr, `printf: '${target}': unsupported indexed-array subscript\n`);
          return 2;
        }
        try { index = literalIndex(target.slice(bracket + 1, -1), 0, this.budget.parsing); }
        catch (error) {
          this.signal.throwIfAborted();
          if (!(error instanceof ShellSyntaxError)) throw error;
          await writeText(context.stderr, `printf: '${target}': unsupported indexed-array subscript\n`);
          return 2;
        }
        if (numericIndex(index) === undefined) {
          await writeText(context.stderr, "printf: index outside 0..2147483647\n");
          return 2;
        }
      }
    }
    const arguments_ = incoming.slice(offset);
    const format = arguments_.args[0] === "--" ? arguments_.args[1] : arguments_.args[0];
    if (format === undefined || arguments_.args[0] !== "--" && format.startsWith("-")) {
      await writeText(context.stderr, "printf: usage: printf [-v var] format [arguments]\n");
      return 2;
    }
    const allocation = this.budget.values.scope();
    context[invocationScope].register(() => allocation.close());
    const chunks: ShellValue[] = [];
    let length = 0;
    let terminated = false;
    const stdout: ByteSink = { write: async chunk => {
      this.budget.cpuCheckpoint();
      if (chunk.byteLength > this.budget.limits.maxExpansionBytes - length) this.budget.fail("maxExpansionBytes");
      length += chunk.byteLength;
      if (terminated || !chunk.byteLength) return;
      const nul = chunk.indexOf(0);
      const bytes = nul < 0 ? chunk : chunk.subarray(0, nul);
      if (bytes.byteLength) chunks.push(shellValueFromBytes(bytes, allocation));
      terminated = nul >= 0;
    } };
    try {
      let status: number;
      try { status = (await formatPrintf({ ...context, args: arguments_.args, argumentValues: arguments_, stdout })).exitCode; }
      catch (error) {
        this.signal.throwIfAborted();
        if (!(error instanceof UsageError)) throw error;
        await writeText(context.stderr, `printf: ${error.message}\n`);
        status = 1;
      }
      const value = concatShellValues(chunks, allocation);
      this.signal.throwIfAborted();
      if (state.readonlyVariables?.has(name)) {
        await writeText(context.stderr, `printf: ${name}: readonly variable\n`);
        return 1;
      }
      if (index || arrayStore(state)?.get(name)) {
        const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
        const decode = (bytes: Uint8Array): string | undefined => {
          try { return decoder.decode(bytes); }
          catch (error) {
            this.signal.throwIfAborted();
            if (!(error instanceof TypeError)) throw error;
            return undefined;
          }
        };
        let text = decode(shellValueBytes(value, allocation));
        if (text !== undefined && index && numericIndex(index) !== 0 && !arrayStore(state)?.get(name) && state.variables[name] !== undefined) {
          const previous = stateMonitor(state)!.values.get(name, state.variables[name]!);
          if (decode(shellValueBytes(previous, allocation)) === undefined) text = undefined;
        }
        if (text === undefined) {
          await writeText(context.stderr, "printf: indexed variables do not support non-UTF-8 bytes\n");
          return 1;
        }
        if (index) await this.arrayAssignment({ kind: "element", name, index, append: false, value: { offset: 0, parts: [{ kind: "text", value: text, quoted: true }] } }, state, context);
        else await this.assignVariable(state, name, text);
      } else this.writeVariable(state, name, value);
      const previous = assignments.get(name);
      if (previous) {
        if (!previous.exported) state.exported.delete(name);
        await this.discardVariable(previous);
        assignments.delete(name);
      }
      return status;
    } finally { allocation.close(); }
  }

  async builtin(context: CommandContext & IO, state: State, assignments: Map<string, SavedVariable>, diagnose?: (error: unknown, diagnostic: string) => void, suppressSpecial = false): Promise<number | undefined> {
    const { command, args, stdout, stderr } = context;
    if (command === ":" || command === "true") return 0;
    if (command === "false") return 1;
    if (command === "shopt") return this.shoptBuiltin(context, state);
    if (command === "let") return this.letBuiltin(context, state);
    if (command === "getopts") return this.getoptsBuiltin(context, state);
    if (command === "pushd" || command === "dirs" || command === "popd") return this.directoryStackBuiltin(context, state, diagnose);
    if (command === "pwd") {
      if (args.some((arg) => arg !== "-L" && arg !== "-P")) { await writeText(stderr, "pwd: invalid option\n"); return 2; }
      const path = args.at(-1) === "-P" ? await this.fs.realpath(state.cwd, { signal: this.signal }) : state.cwd;
      await writeText(stdout, `${path}\n`);
      return 0;
    }
    if (command === "cd") return this.changeDirectory(context, state, args, diagnose);
    if (command === "set") {
      if (state.profile === "bash" && args.length) return this.setOptions(context, state);
      let index = 0;
      let positionals = false;
      while (index < args.length) {
        const option = args[index]!;
        if (option === "--") { index++; positionals = true; break; }
        if (option === "-") { index++; positionals = index < args.length; break; }
        const flags = /^[-+]([eu]*o|[eu]+)$/u.exec(option)?.[1];
        const named = flags?.endsWith("o");
        const name = named ? args[index + 1] : undefined;
        if (flags && (!named || name === "pipefail" || name === "errexit" || name === "nounset")) {
          const enabled = option.startsWith("-");
          for (const flag of flags) {
            if (flag === "e" || flag === "o" && name === "errexit") state.errexit = enabled;
            else if (flag === "u" || flag === "o" && name === "nounset") state.nounset = enabled;
            else if (flag === "o" && name === "pipefail") state.pipefail = enabled;
          }
          index += named ? 2 : 1;
          continue;
        }
        if (/^[+-]/u.test(option)) {
          await writeText(stderr, "set: unsupported shell option; supported forms are +/- e/u clusters, -- arguments and terminal o with pipefail, errexit or nounset\n");
          if (state.profile === "sh" && suppressSpecial) return 2;
          throw new Flow("exit", 2);
        }
        positionals = true;
        break;
      }
      if (positionals) { this.replacePositionals(state, getCommandArguments(context).values.slice(index)); state.positionalSetVersion = (state.positionalSetVersion ?? 0) + 1; }
      if (args.length) return 0;
      await writeText(stderr, "set: supported forms are +/- e/u clusters, -- arguments and terminal o with pipefail, errexit or nounset\n");
      return 2;
    }
    if (command === "shift") {
      const count = args[0] === undefined ? 1 : Number(args[0]);
      if (args.length > 1 || !Number.isSafeInteger(count) || count < 0 || count > state.positional.length) return 1;
      this.replacePositionals(state, this.positionalValues(state).slice(count));
      return 0;
    }
    if (command === "export" || command === "local" || command === "readonly") {
      const declarationArgs = [...args];
      let indexedLocal = false;
      if (command === "local") {
        const options = localDeclarationOptions(declarationArgs, this.signal);
        if (options.error !== undefined) {
          await writeText(stderr, `local: ${options.error}: unsupported option\n`);
          return 2;
        }
        indexedLocal = options.indexed;
        declarationArgs.splice(0, options.offset);
        if (indexedLocal && declarationArgs.length === 0) {
          await writeText(stderr, "local: -a requires a variable name\n");
          return 2;
        }
      }
      if (command === "readonly") {
        while (declarationArgs[0]?.startsWith("-")) {
          const option = declarationArgs.shift();
          if (option === "--") break;
          if (option !== "-p") { await writeText(stderr, `readonly: ${option}: unsupported option\n`); return 2; }
        }
      }
      const locals = state.locals.at(-1);
      if (command === "local" && !locals) { await writeText(stderr, "local: not in a function\n"); return 1; }
      let status = 0;
      if (!declarationArgs.length) {
        const names = command === "readonly" ? state.readonlyVariables ?? [] : state.exported;
        for (const name of names) if (arrayStore(state)?.get(name)) { await this.diagnostic(context, "indexed array: listing indexed bindings is unsupported"); return 2; }
        const prefix = state.profile === "sh" ? command : command === "readonly" ? "declare -r" : "declare -x";
        for (const name of [...names].sort()) await writeText(stdout, `${prefix} ${name}=${JSON.stringify(state.variables[name] ?? "")}\n`);
      }
      const declarationValues = getCommandArguments(context).values;
      const declarationOffset = args.length - declarationArgs.length;
      for (let declarationIndex = 0; declarationIndex < declarationArgs.length; declarationIndex++) {
        const arg = declarationArgs[declarationIndex]!;
        const match = /^([a-zA-Z_][a-zA-Z_0-9]*)(?:=(.*))?$/su.exec(arg);
        if (!match) { await this.diagnostic(context, `${command}: \`${arg}': not a valid identifier`); status = 1; continue; }
        const name = match[1]!;
        if (state.readonlyVariables?.has(name) && (match[2] !== undefined || command === "local")) {
          await this.diagnostic(context, `${name}: readonly variable`); status = 1; continue;
        }
        if (arrayStore(state)?.get(name) && command === "export") {
          await this.diagnostic(context, "indexed array: indexed binding cannot be exported"); status = 1; continue;
        }
        if (command === "local" && indexedLocal) {
          if (controlNames.has(name)) throw new ArrayFailure("control binding cannot be indexed");
          if (state.exported.has(name)) throw new ArrayFailure("exported binding cannot be indexed");
          const existingLocal = locals!.get(name);
          const saved = existingLocal ? undefined : assignments.get(name) ?? saveVariable(state, name);
          let operation: ArrayOwner | undefined;
          let holding: ReturnType<ArrayOwner["hold"]> | undefined;
          let shadow: IndexedBinding | undefined;
          let preparedExisting = false;
          let preparedSaved = false;
          let published = false;
          let primaryPresent = false;
          let primary: unknown;
          try {
            if (existingLocal && !typedSavedVariables.has(existingLocal)) {
              preparedExisting = true;
              await this.prepareVariable(state, name, existingLocal, true);
            }
            if (saved && !typedSavedVariables.has(saved)) {
              preparedSaved = true;
              await this.prepareVariable(state, name, saved);
            }
            const store = requireArrays(state);
            operation = ArrayOwner.create(store.owner.ledger, store.owner);
            holding = store.owner.hold();
            const watch = await store.watch(name, operation, this.signal);
            const tickets = operation.reserve({ generation: true, version: true, epoch: true, work: 8 });
            const prepared = await store.prepareName(name, operation, this.signal);
            const current = store.get(name);
            shadow = !saved && current ? await current.copy(this.signal) : IndexedBinding.create(store.owner);
            const value = match[2] ?? (!saved && !current && Object.hasOwn(state.variables, name) ? state.variables[name] : undefined);
            if (value !== undefined) {
              const token = await textToken(shadow.owner, value, this.signal);
              try { shadow.insert(0, token); } catch (error) { token.release(); throw error; }
            }
            this.signal.throwIfAborted();
            if (state.readonlyVariables?.has(name)) throw new ArrayFailure("readonly binding");
            if (!watch.valid()) throw new ArrayFailure("stale binding");
            let released: Promise<void> | undefined;
            stateMonitor(state)!.publish(tickets, name, () => {
              if (saved) locals!.set(name, saved);
              delete state.variables[name];
              released = store.publish(name, shadow!, tickets, prepared);
            });
            shadow = undefined;
            published = true;
            watch.close();
            await released;
            assignments.delete(name);
          } catch (error) {
            primaryPresent = true;
            primary = error;
          } finally {
            const cleanup = async (action: () => void | Promise<void>): Promise<void> => {
              try { await action(); }
              catch (error) {
                if (primaryPresent) context[invocationScope].failures.push(error);
                else { primaryPresent = true; primary = error; }
              }
            };
            if (preparedSaved && saved && !locals!.has(name)) await cleanup(() => this.discardVariable(saved));
            if (preparedExisting && existingLocal && !published) await cleanup(() => this.discardVariable(existingLocal));
            await cleanup(() => shadow?.release());
            await cleanup(() => operation?.close());
            await cleanup(() => holding?.release());
          }
          if (primaryPresent) throw primary;
          continue;
        }
        if (command === "local" && !locals!.has(name)) {
          const saved = assignments.get(name) ?? saveVariable(state, name);
          if (name === "PIPESTATUS" && arrayStore(state)?.get(name)) {
            await this.prepareVariable(state, name, saved);
            const store = requireArrays(state);
            const operation = ArrayOwner.create(store.owner.ledger, store.owner);
            const holding = store.owner.hold();
            try {
              const tickets = operation.reserve({ generation: true, version: true, epoch: true, work: 8 });
              const value = match[2] ?? "";
              await textToken(operation, value, this.signal);
              this.signal.throwIfAborted();
              if (state.readonlyVariables?.has(name)) throw new ArrayFailure("readonly binding");
              if (!typedSavedVariables.get(saved)!.watch.valid()) throw new ArrayFailure("stale binding");
              let released: Promise<void> | undefined;
              stateMonitor(state)!.publish(tickets, name, () => {
                locals!.set(name, saved);
                released = store.remove(name, tickets);
                state.variables[name] = value;
              });
              await released;
            } finally { try { await operation.close(); } finally { holding.release(); } }
            assignments.delete(name);
            continue;
          }
          if (arrayStore(state)?.get(name)) {
            await this.prepareVariable(state, name, saved);
            const store = requireArrays(state);
            const operation = ArrayOwner.create(store.owner.ledger, store.owner);
            const holding = store.owner.hold();
            let shadow: IndexedBinding | undefined;
            try {
              const tickets = operation.reserve({ generation: true, version: true, epoch: true, work: 8 });
              shadow = IndexedBinding.create(store.owner);
              if (match[2] !== undefined) {
                const token = await textToken(shadow.owner, match[2], this.signal);
                try { shadow.insert(0, token); } catch (error) { token.release(); throw error; }
              }
              this.signal.throwIfAborted();
              if (state.readonlyVariables?.has(name)) throw new ArrayFailure("readonly binding");
              if (!typedSavedVariables.get(saved)!.watch.valid()) throw new ArrayFailure("stale binding");
              let released: Promise<void> | undefined;
              stateMonitor(state)!.publish(tickets, name, () => {
                locals!.set(name, saved);
                released = store.publish(name, shadow!, tickets);
              });
              shadow = undefined;
              await released;
            } finally { try { await shadow?.release(); await operation.close(); } finally { holding.release(); } }
            assignments.delete(name);
            continue;
          }
          if (guestArrays(state)) await this.prepareVariable(state, name, saved);
          locals!.set(name, saved);
          if (!assignments.has(name) && match[2] === undefined) {
            if (name === "PIPESTATUS") state.variables[name] = "";
            else delete state.variables[name];
          }
          if (name === "OPTIND") {
            state.getopts ??= cloneGetoptsBinding(state);
            state.getopts.integer = false;
          }
        }
        if (match[2] !== undefined && arrayStore(state)?.get(name)) {
          await this.arrayZero(state, name, async () => match[2]!, false, command === "readonly");
          assignments.delete(name);
          continue;
        }
        if (match[2] !== undefined) {
          const original = declarationValues[declarationOffset + declarationIndex]!;
          const value = typeof original === "string" ? match[2] : shellValueFromBytes(shellValueBytes(original, context[valueScope]).subarray(name.length + 1), context[valueScope]);
          this.writeVariable(state, name, value);
        }
        else if (command === "local" && name === "OPTIND") this.syncGetopts(state);
        if (command === "export") state.exported.add(name);
        if (command === "readonly") { state.readonlyVariables ??= new Set(); state.readonlyVariables.add(name); }
        const previous = assignments.get(name);
        if (previous && locals?.get(name) !== previous) previous.heldValue?.release();
        assignments.delete(name);
      }
      return status;
    }
    if (command === "unset") {
      let status = 0;
      for (const name of args) {
        const selected = /^([a-zA-Z_][a-zA-Z_0-9]*)\[(.*)\]$/su.exec(name);
        if (selected) {
          const base = selected[1]!;
          const selector = selected[2]!;
          if (state.readonlyVariables?.has(base)) { await this.diagnostic(context, "indexed array: readonly binding"); status = 1; continue; }
          if (selector === "@" || selector === "*") await this.unsetIndexed(state, base, "members");
          else {
            let index: number | undefined;
            try { index = numericIndex(literalIndex(selector, 0, this.budget.parsing)); }
            catch (error) {
              this.signal.throwIfAborted();
              if (error instanceof ShellLimitError) throw error;
              await this.diagnostic(context, "indexed array: unsupported subscript"); status = 2; continue;
            }
            if (index === undefined) { await this.diagnostic(context, "indexed array: index outside 0..2147483647"); status = 1; continue; }
            await this.unsetIndexed(state, base, index);
          }
          continue;
        }
        if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name)) { await writeText(stderr, `unset: ${name}: not a valid identifier\n`); status = 1; continue; }
        if (state.readonlyVariables?.has(name)) { await this.diagnostic(context, `unset: ${name}: cannot unset: readonly variable`); status = 1; continue; }
        if (name === "PATH") state.pathUnset = true;
        if (arrayStore(state)?.get(name)) await this.unsetIndexed(state, name);
        else this.unsetVariable(state, name);
        if (state.profile === "sh") assignments.delete(name);
      }
      return status;
    }
    if (command === "read") {
      const names = [...args];
      let raw = false;
      let count: number | undefined;
      let exact = false;
      let delimiter: number | undefined;
      let invalid = false;
      while (names[0]?.startsWith("-") && names[0] !== "--" && names[0] !== "-") {
        const option = names.shift()!;
        for (let index = 1; index < option.length; index++) {
          const flag = option[index];
          if (flag === "r") { raw = true; continue; }
          if (flag !== "n" && flag !== "N" && flag !== "d") { invalid = true; break; }
          if (flag === "N") exact = true;
          const value = option.slice(index + 1) || names.shift();
          if (value === undefined) invalid = true;
          else if (flag === "d") delimiter = new TextEncoder().encode(value)[0] ?? 0;
          else if (exact && (!/^[ \t]*[+-]?\d+[ \t]*$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 0)) {
            const diagnosticIO: IO = context;
            await writeText(stderr, `${diagnosticIO.scriptName ?? "shell"}: line ${diagnosticIO.diagnosticLine ?? 1}: read: ${value}: invalid ${/^[+-]?0[xX]/u.test(value) ? "hex " : ""}number\n`);
            return 1;
          }
          else if (!exact && (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value)))) invalid = true;
          else count = Number(value);
          break;
        }
        if (invalid) break;
      }
      if (names[0] === "--") names.shift();
      const invalidName = names.find(name => !/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name));
      if (exact && !invalid && invalidName !== undefined) {
        const diagnosticIO: IO = context;
        await writeText(stderr, `${diagnosticIO.scriptName ?? "shell"}: line ${diagnosticIO.diagnosticLine ?? 1}: read: \`${invalidName}': not a valid identifier\n`);
        return 1;
      }
      if (invalid || names.some((name) => !/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name))) {
        await writeText(stderr, "read: invalid variable name or unsupported option\n");
        return 2;
      }
      const input = context.stdin instanceof ShellInput ? context.stdin : new ShellInput(context.stdin, this.budget, this.signal);
      const line = count === 0 && context.stdin === closedSource ? { value: "", escaped: new Set<number>(), terminated: false }
        : await input.line(raw, count === undefined && delimiter === undefined ? undefined : {
          ...(count === undefined ? {} : { count }), ...(delimiter === undefined ? {} : { delimiter }), byteCount: byteLocale(state.variables), exact,
        });
      if (!names.length) {
        if (state.readonlyVariables?.has("REPLY")) { await this.diagnostic(context, "REPLY: readonly variable"); return 1; }
        this.writeVariable(state, "REPLY", line.value);
      }
      else {
        const separators = exact ? "" : state.variables.IFS ?? " \t\n";
        let end = 0;
        let offset = 0;
        let point = 0;
        for (const character of line.value) {
          offset += character.length;
          if (line.escaped.has(point) || !separators.includes(character) || !" \t\n".includes(character)) end = offset;
          point++;
        }
        let position = 0;
        point = 0;
        const separator = (): boolean => position < end && !line.escaped.has(point) && separators.includes(String.fromCodePoint(line.value.codePointAt(position)!));
        const whitespace = (): boolean => separator() && " \t\n".includes(line.value[position]!);
        const advance = (): void => { position += line.value.codePointAt(position)! > 0xffff ? 2 : 1; point++; };
        while (position < end && whitespace()) advance();
        const fields: { start: number; end: number }[] = [];
        while (position < end && fields.length < names.length) {
          const start = position;
          while (position < end && !separator()) advance();
          fields.push({ start, end: position });
          while (position < end && whitespace()) advance();
          if (position < end && separator()) advance();
          while (position < end && whitespace()) advance();
        }
        for (let index = 0; index < names.length; index++) {
          if (state.readonlyVariables?.has(names[index]!)) {
            await this.diagnostic(context, `${names[index]}: readonly variable`);
            return index === names.length - 1 ? 1 : 2;
          }
          const field = fields[index];
          await this.assignVariable(state, names[index]!, field ? line.value.slice(field.start, index === names.length - 1 && position < end ? end : field.end) : "");
        }
      }
      return line.terminated ? 0 : 1;
    }
    if (command === "exit" || command === "return") {
      if (command === "return" && state.functionDepth === 0 && !state.sourceDepth) { await writeText(stderr, "return: not in a function\n"); return 1; }
      if (args.length > 1) { await writeText(stderr, `${command}: too many arguments\n`); return 1; }
      if (args[0] !== undefined && !/^[+-]?\d+$/u.test(args[0])) {
        await writeText(stderr, `${command}: ${args[0]}: numeric argument required\n`);
        throw completedExit(2, command);
      }
      const status = args[0] === undefined ? state.status : Number((BigInt(args[0]) % 256n + 256n) % 256n);
      throw completedExit(status, command);
    }
    if (command === "break" || command === "continue") {
      const levels = args[0] === undefined ? 1 : Number(args[0]);
      if (args.length > 1 || !Number.isSafeInteger(levels) || levels < 1) { await writeText(stderr, `${command}: invalid loop count\n`); return 1; }
      if (!state.loopDepth) { await writeText(stderr, `${command}: only meaningful in a loop\n`); return 0; }
      throw completedExit(0, command, Math.min(levels, state.loopDepth));
    }
    return undefined;
  }

  async words(words: readonly Word[], state: State, io: IO, declaration = false): Promise<string[]> {
    return (await this.valueWords(words, state, io, declaration)).map(shellValueText);
  }

  private async valueWords(words: readonly Word[], state: State, io: IO, declaration = false): Promise<ShellValue[]> {
    const fields: ShellValue[] = [];
    for (const word of words) {
      const values = await this.valueWord(word, state, io, !(declaration && this.assignment(word)), false, false, false, undefined, true);
      if (values.length > this.budget.limits.maxExpansionFields - fields.length) this.budget.fail("maxExpansionFields");
      for (const value of values) fields.push(value);
    }
    return fields;
  }

  async part(part: Exclude<WordPart, { kind: "text" }>, state: State, io: IO, hereString = false): Promise<string> {
    return shellValueText(await this.valuePart(part, state, io, hereString));
  }

  private async valuePart(part: Exclude<WordPart, { kind: "text" }>, state: State, io: IO, hereString = false): Promise<ShellValue> {
    const binding = part.kind === "variable" ? arrayStore(state)?.get(part.name) : undefined;
    const holding = binding ? requireArrays(state).owner.hold() : undefined;
    const selector = getArraySelector(part);
    const index = selector?.kind === "element" ? numericIndex(selector.index) : 0;
    const token = index === undefined || selector?.kind === "members" ? undefined : binding?.values.get(index)?.text;
    token?.retain();
    try {
      const value = await this.partValue(part, state, io, hereString);
      if (binding) await textToken(requireArrays(state).owner, shellValueText(value), this.signal);
      return value;
    } finally { token?.release(); holding?.release(); }
  }

  private parameterOperandIO(word: Word, state: State, io: IO): IO {
    this.signal.throwIfAborted();
    const parameterDepth = (io.parameterDepth ?? 0) + 1;
    if (state.depth + parameterDepth > 64) throw new ShellSyntaxError("Syntax nesting exceeds 64", word.offset);
    return { ...io, parameterDepth };
  }

  private async partValue(part: Exclude<WordPart, { kind: "text" }>, state: State, io: IO, hereString: boolean): Promise<ShellValue> {
    this.signal.throwIfAborted();
    if (part.kind === "failed-substitution") {
      if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
      await writeText(io.stderr, part.diagnostic);
      state.status = state.substitutionStatus = 2;
      return "";
    }
    if (part.kind === "arithmetic") {
      try {
        return String(evaluatePositionalArithmetic(part.expression, {
          parseBudget: this.budget.parsing,
          positional: state.positional, arg0: state.arg0 ?? "virtual-bash", owner: arrayStore(state)?.owner,
          maximumBytes: this.budget.limits.maxExpansionBytes,
          checkpoint: () => this.signal.throwIfAborted(),
          requireParameter: (name, value) => this.requireParameter(value, name, state, io, part.line),
          limit: () => this.budget.fail("maxExpansionBytes"),
        }, (prepared) => evaluateArithmetic(prepared, this.arithmeticVariables(state, io.diagnosticLine ?? part.line), this.budget.parsing)));
      }
      catch (error) { this.rethrowArithmeticControl(error); throw new ExpansionFailure(message(error), io.diagnosticLine ?? part.line); }
    }
    if (part.kind === "substitution") {
      if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
      const parameterDepth = io.parameterDepth ?? 0;
      if (parameterDepth > 0 && state.depth + parameterDepth + 1 > 64) throw new ShellSyntaxError("Syntax nesting exceeds 64", 0);
      const capture = new Capture();
      const child = await cloneState(state, this.signal);
      child.isolated = true;
      if (state.profile !== "sh") child.errexit = false;
      for (const [name, value] of state.redirectAssignments ?? []) {
        this.writeVariable(child, name, value);
        child.exported.add(name);
      }
      delete child.redirectAssignments;
      child.depth++;
      child.loopDepth = 0;
      const pipeline = part.script.lists.length === 1 && part.script.lists[0]!.pipelines.length === 1 ? part.script.lists[0]!.pipelines[0] : undefined;
      const command = pipeline && !pipeline.negate && pipeline.commands.length === 1 ? pipeline.commands[0] : undefined;
      const fileShortcut = command?.kind === "simple" && command.words.length === 0 && command.redirects.length === 1 && command.redirects[0]!.operator === "<";
      const warningLine = io.substitutionDiagnosticLine ?? io.diagnosticLine ?? part.line;
      const substitutionDiagnosticLines = new Map<Command, number>();
      for (const [command, line] of part.script.printedLines ?? []) substitutionDiagnosticLines.set(command,
        part.sourceLine === undefined ? warningLine + (command.line ?? part.line) - part.line : warningLine + line - 1);
      const captureIO = { ...isolateIO(io), substitutionDiagnosticLines, diagnosticOffset: (io.diagnosticLine ?? part.line) - (part.sourceLine ?? part.line), stdout: this.budget.sink(capture, this.signal) };
      try { state.substitutionStatus = fileShortcut ? await this.runCommandIsolated(command, child, captureIO, true) : await this.run(part.script, child, captureIO); }
      finally { stateMonitor(child)?.closeValues(); }
      state.status = state.substitutionStatus;
      const bytes = capture.bytes();
      if (bytes.includes(0)) await writeText(io.stderr, `${io.scriptName ?? "shell"}: line ${warningLine}: warning: command substitution: ignored null byte in input\n`);
      let length = 0;
      for (const byte of bytes) if (byte !== 0) bytes[length++] = byte;
      while (length && bytes[length - 1] === 10) length--;
      const sanitized = bytes.subarray(0, length);
      try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(sanitized); }
      catch (error) {
        if (!(error instanceof TypeError) || (error as NodeJS.ErrnoException).code !== "ERR_ENCODING_INVALID_ENCODED_DATA") throw error;
        return shellValueFromBytes(sanitized, io[valueScope]);
      }
    }
    const selector = getArraySelector(part);
    if (selector) {
      const store = requireArrays(state);
      const binding = store.get(part.name);
      if (selector.kind === "element") {
        const index = numericIndex(selector.index);
        if (index === undefined) throw new ArrayFailure("index outside 0..2147483647");
        const value = binding ? binding.get(index) : index === 0 ? state.variables[part.name] : undefined;
        this.requireParameter(value, `${part.name}[${selector.index}]`, state, io, part.line);
        return part.length ? this.parameterLength(value ?? "") : value ?? "";
      }
      if (part.length) return String(binding?.values.size ?? (state.variables[part.name] === undefined ? 0 : 1));
      const values = await this.arrayMembers(part.name, state);
      return this.arrayJoin(store.owner, values, Array.from(state.variables.IFS ?? " ")[0] ?? "");
    }
    let value = part.name === "?" ? String(state.status)
      : part.name === "-" ? `${state.errexit ? "e" : ""}${state.nounset ? "u" : ""}${state.braceexpand !== false ? "B" : ""}`
      : part.name === "#" ? String(state.positional.length)
      : part.name === "@" || part.name === "*" ? state.positional.join(hereString && (part.name === "@" || !part.quoted) ? " " : Array.from(state.variables.IFS ?? " ")[0] ?? "")
      : /^0+$/u.test(part.name) ? state.arg0 ?? "virtual-bash"
      : /^\d+$/u.test(part.name) ? state.positional[Number(part.name) - 1]
      : this.variable(state, part.name);
    let retained: ShellValue | undefined = value;
    if (!part.length && value !== undefined) {
      if (/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(part.name) && !arrayStore(state)?.get(part.name)) retained = stateMonitor(state)?.values.get(part.name, value) ?? value;
      else if (/^[1-9][0-9]*$/u.test(part.name)) retained = stateMonitor(state)?.positionals.get(String(Number(part.name) - 1), value) ?? value;
      else if (part.name === "@" || part.name === "*") {
        const separator = hereString && (part.name === "@" || !part.quoted) ? " " : Array.from(state.variables.IFS ?? " ")[0] ?? "";
        const values = this.positionalValues(state);
        retained = concatShellValues(values.flatMap((entry, index) => index ? [separator, entry] : [entry]), io[valueScope]);
      }
    }
    if (part.substring) {
      this.requireParameter(value, part.name, state, io, part.line);
      return this.substring(part, value, state, io);
    }
    if (part.operator) {
      if (["#", "##", "%", "%%"].includes(part.operator) || part.operator.startsWith("/")) {
        this.requireParameter(value, part.name, state, io, part.line);
        return this.parameterPattern(part, value ?? "", state, io, hereString);
      }
      const missing = value === undefined || (part.operator.startsWith(":") && value === "");
      const operator = part.operator.at(-1)!;
      if ((operator === "+" && !missing) || (operator !== "+" && missing)) {
        const operandIO = this.parameterOperandIO(part.alternate!, state, io);
        let alternate: string;
        if (operator === "=" && arrayStore(state)?.get(part.name)) {
          alternate = "";
          await this.arrayZero(state, part.name, async () => {
            alternate = await this.arrayJoin(requireArrays(state).owner, await this.word(part.alternate!, state, operandIO, false, false, hereString), "");
            return alternate;
          });
          value = alternate;
          return part.length ? this.parameterLength(value) : value;
        }
        retained = concatShellValues(await this.valueWord(part.alternate!, state, operandIO, false, false, hereString), io[valueScope]);
        alternate = shellValueText(retained);
        if (operator === "?") throw new ParameterExpansionFailure(`${part.name}: ${alternate || (part.operator.startsWith(":") ? "parameter null or not set" : "parameter not set")}`, io.diagnosticLine ?? part.line);
        if (operator === "=") {
          if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(part.name)) throw new Error("Cannot assign special parameter");
          this.writeVariable(state, part.name, retained);
        }
        value = alternate;
      } else if (operator === "+") { value = ""; retained = ""; }
    } else this.requireParameter(value, part.name, state, io, part.line);
    return part.length ? this.parameterLength(value ?? "") : retained ?? "";
  }

  private async parameterLength(value: string): Promise<string> {
    const limit = this.budget.limits.maxExpansionBytes;
    const work = { remaining: Math.min(Number.MAX_SAFE_INTEGER, limit * 4 + 1024), signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") };
    const scanned = await scanString(value, work);
    if (scanned.bytes > limit) this.budget.fail("maxExpansionBytes");
    return String(scanned.count);
  }

  async substring(part: Extract<WordPart, { kind: "variable" }>, value: string | undefined, state: State, io: IO): Promise<string> {
    const owner = arrayStore(state)?.get(part.name) ? requireArrays(state).owner : undefined;
    const expression = part.substring!;
    const line = io.diagnosticLine ?? part.line;
    if (!expression.offset.parts.length && !expression.length) throw new ExpansionFailure(`${expression.source}: bad substitution`, line);
    if (value === undefined) return "";
    const limit = this.budget.limits.maxExpansionBytes;
    if (Buffer.byteLength(value) > limit) this.budget.fail("maxExpansionBytes");
    const scratch = this.budget.values.scope();
    const work = { remaining: Math.min(Number.MAX_SAFE_INTEGER, limit * 4 + 1024), signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") };
    try {
    const variables = new Proxy(this.arithmeticVariables(state, line), { get: (target, key) => {
      this.signal.throwIfAborted();
      const value: unknown = Reflect.get(target, key);
      if (typeof value === "string" && Buffer.byteLength(value) > limit) this.budget.fail("maxExpansionBytes");
      return value;
    } });
    const arithmetic = async (word: Word): Promise<{ value: bigint; source: string }> => {
      const operandIO = this.parameterOperandIO(word, state, io);
      let source = "";
      let bytes = 0;
      let retained: ValueReservation | undefined;
      for (const entry of word.parts) {
        this.signal.throwIfAborted();
        const text = entry.kind === "text" ? entry.value : await this.part(entry, state, operandIO);
        bytes += Buffer.byteLength(text);
        if (bytes > limit) this.budget.fail("maxExpansionBytes");
        owner?.reserve({ metadata: 32, payload: bytes, work: text.length + 4 });
        const pending = stringCheckpoint(work, text.length + 1);
        if (pending) await pending;
        const next = scratch.reserve((source.length + text.length) * 2, 0);
        source += text;
        retained?.release();
        retained = next;
      }
      this.signal.throwIfAborted();
      try { return { value: evaluateArithmetic(prepareArithmetic(source, this.budget.parsing), variables, this.budget.parsing), source }; }
      catch (error) {
        this.rethrowArithmeticControl(error);
        throw new ExpansionFailure(`${part.name}: ${message(error)}`, line);
      }
      finally { retained?.release(); }
    };
    const offsetExpression = await arithmetic(expression.offset);
    let bytes: Buffer | undefined;
    if (byteLocale(state.variables)) {
      scratch.reserve(Buffer.byteLength(value), 0);
      bytes = Buffer.from(value);
    }
    const size = BigInt(bytes?.byteLength ?? (await scanString(value, work)).count);
    const offset = offsetExpression.value < 0n ? size + offsetExpression.value : offsetExpression.value;
    if (offset < 0n || offset > size) return "";
    let end = size;
    if (expression.length) {
      const length = await arithmetic(expression.length);
      end = length.value < 0n ? size + length.value : offset + length.value;
      if (end < offset) throw new ExpansionFailure(`${length.source}: substring expression < 0`, line);
      if (end > size) end = size;
    }
    this.signal.throwIfAborted();
    if (!bytes) {
      const start = (await scanString(value, work, 0, value.length, Number(offset))).end;
      const finish = (await scanString(value, work, start, value.length, Number(end - offset))).end;
      if (finish > start) scratch.reserve((finish - start) * 2, 0);
      return value.slice(start, finish);
    }
    scratch.reserve(Number(end - offset) * 2, 0);
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(Number(offset), Number(end))); }
    catch { throw new ExpansionFailure("substring expansion splits a UTF-8 character in a byte locale", line); }
    } finally { scratch.close(); }
  }

  async parameterPattern(part: Extract<WordPart, { kind: "variable" }>, text: string, state: State, io: IO, hereString: boolean): Promise<string> {
    const limit = this.budget.limits.maxExpansionBytes;
    if (Buffer.byteLength(text) > limit) this.budget.fail("maxExpansionBytes");
    const scratch = this.budget.values.scope();
    const work = { remaining: Math.min(Number.MAX_SAFE_INTEGER, limit * 4 + 1024), signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes"), allocation: scratch };
    try {
    const patternFields = await this.word(part.alternate!, state, this.parameterOperandIO(part.alternate!, state, io), false, true, hereString);
    let patternUnits = 0;
    for (const field of patternFields) {
      const pending = stringCheckpoint(work, field.length + 1);
      if (pending) await pending;
      patternUnits += field.length;
    }
    scratch.reserve(patternUnits * 2, 0);
    const pattern = patternFields.join("");
    const size = (await scanString(text, work)).count;
    const matches = await compilePattern(pattern, work);
    const match = async (start: number, end: number, length: number): Promise<boolean> => {
      const pending = stringCheckpoint(work, length + 1);
      if (pending) await pending;
      return matches(text, start, end);
    };
    const operator = part.operator!;
    if (!operator.startsWith("/")) {
      const longest = operator.length === 2;
      const prefix = operator.startsWith("#");
      let boundary = longest === prefix ? text.length : 0;
      for (let length = longest ? size : 0; longest ? length >= 0 : length <= size; length += longest ? -1 : 1) {
        if (await match(prefix ? 0 : boundary, prefix ? boundary : text.length, length)) {
          const start = prefix ? boundary : 0;
          const end = prefix ? text.length : boundary;
          scratch.reserve((end - start) * 2, 0);
          return text.slice(start, end);
        }
        boundary = longest === prefix ? previousCodePointOffset(text, boundary) : nextCodePointOffset(text, boundary);
      }
      return text;
    }
    scratch.reserve(64, 0);
    const replacements: { value: string; quoted: boolean }[] = [];
    let replacementBytes = 0;
    const replacementIO = part.replacement ? this.parameterOperandIO(part.replacement, state, io) : io;
    for (const [index, entry] of (part.replacement?.parts ?? []).entries()) {
      let value = entry.kind === "text" ? entry.value : await this.part(entry, state, replacementIO, hereString);
      if (index === 0 && !entry.quoted && /^~(?:\/|$)/u.test(value)) {
        const home = state.variables.HOME ?? "~";
        scratch.reserve((home.length + value.length - 1) * 2, 0);
        value = home + value.slice(1);
      }
      replacementBytes += Buffer.byteLength(value);
      if (replacementBytes > limit) this.budget.fail("maxExpansionBytes");
      const pending = stringCheckpoint(work, value.length + 1);
      if (pending) await pending;
      scratch.reserve(64 + value.length * 2, 0);
      replacements.push({ value, quoted: entry.quoted });
    }
    if (!pattern && operator !== "/#" && operator !== "/%") return text;
    let result = "";
    let resultBytes = 0;
    let retained: ValueReservation | undefined;
    const append = async (value: string, start = 0, end = value.length): Promise<void> => {
      resultBytes += (await scanString(value, work, start, end)).bytes;
      if (resultBytes > limit) this.budget.fail("maxExpansionBytes");
      if (start === end) return;
      const fragment = scratch.reserve((end - start) * 2, 0);
      const next = scratch.reserve((result.length + end - start) * 2, 0);
      result += value.slice(start, end);
      fragment.release();
      retained?.release();
      retained = next;
    };
    let position = 0;
    let positionIndex = 0;
    while (positionIndex <= size) {
      let found = false;
      for (let start = position, startIndex = positionIndex; startIndex <= size; startIndex++, start = nextCodePointOffset(text, start)) {
        if (operator === "/#" && start !== 0) break;
        for (let end = text.length, endIndex = size; endIndex >= startIndex; endIndex--, end = previousCodePointOffset(text, end)) {
          if (operator === "/%" && end !== text.length) break;
          if (!await match(start, end, endIndex - startIndex)) continue;
          await append(text, position, start);
          for (const replacement of replacements) {
            if (replacement.quoted) await append(replacement.value);
            else {
              let fragment = 0;
              for (let cursor = 0; cursor < replacement.value.length; cursor++) {
                const pending = stringCheckpoint(work);
                if (pending) await pending;
                if (replacement.value[cursor] !== "&") continue;
                await append(replacement.value, fragment, cursor);
                await append(text, start, end);
                fragment = cursor + 1;
              }
              await append(replacement.value, fragment);
            }
          }
          position = end;
          positionIndex = endIndex;
          found = true;
          if (operator !== "//" || end === text.length) { await append(text, end); return result; }
          if (end === start) {
            position = nextCodePointOffset(text, end);
            positionIndex++;
            await append(text, end, position);
          }
          break;
        }
        if (found) break;
      }
      if (!found) {
        if (positionIndex === 0) return text;
        await append(text, position);
        break;
      }
    }
    return result;
    } finally { scratch.close(); }
  }

  async word(word: Word, state: State, io: IO, split = true, pattern = false, hereString = false, conditionalPattern = false, regexAppend?: (text: string, literal: boolean) => void): Promise<string[]> {
    return (await this.valueWord(word, state, io, split, pattern, hereString, conditionalPattern, regexAppend)).map(shellValueText);
  }

  private async valueWord(word: Word, state: State, io: IO, split = true, pattern = false, hereString = false, conditionalPattern = false, regexAppend?: (text: string, literal: boolean) => void, braces = split && !pattern && !hereString): Promise<ShellValue[]> {
    if (braces && state.braceexpand !== false && word.parts.some(part => part.kind === "text" && !part.quoted && part.value.includes("{"))) {
      const fields: ShellValue[] = [];
      let bytes = 0;
      for await (const expanded of expandBraces(word, this.budget, this.signal)) {
        const values = await this.valueWord(expanded, state, io, split, pattern, hereString, conditionalPattern, regexAppend, false);
        if (values.length > this.budget.limits.maxExpansionFields - fields.length) this.budget.fail("maxExpansionFields");
        for (const value of values) {
          const size = shellValueByteLength(value);
          if (size > this.budget.limits.maxExpansionBytes - bytes) this.budget.fail("maxExpansionBytes");
          bytes += size;
          io[valueScope]?.reserve(32 + (typeof value === "string" ? value.length * 2 : 0), 0);
          fields.push(value);
        }
      }
      return fields;
    }
    const arrayOwned = word.parts.some(part => part.kind === "variable" && (getArraySelector(part) !== undefined || arrayStore(state)?.get(part.name) !== undefined));
    const owner = arrayOwned ? requireArrays(state).owner : undefined;
    const holding = owner?.hold();
    const scratch = !owner && split && state.variables.IFS !== "" && word.parts.some(part => !part.quoted && part.kind !== "text")
      ? this.budget.values.scope() : undefined;
    try {
    if (owner) await this.prepareArrayObservers(state, owner);
    owner?.reserve({ metadata: 128 + word.parts.length * 32, allocatedSlots: word.parts.length + 1, work: word.parts.length + 5 });
    scratch?.reserve(word.parts.length * 32, 0);
    const fields: { fragments: ShellValue[]; bytes: boolean; patterns: string[] | undefined; present: boolean }[] = [];
    const addField = (): void => {
      if (fields.length >= this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
      scratch?.reserve(32, 0);
      owner?.reserve({ metadata: 32, allocatedSlots: 1, work: 3 });
      fields.push({ fragments: [], bytes: false, patterns: undefined, present: false });
    };
    addField();
    let expansionBytes = 0;
    const append = (value: ShellValue, glob: boolean, present: boolean) => {
      const text = shellValueText(value);
      const size = shellValueByteLength(value);
      if (size > this.budget.limits.maxExpansionBytes - expansionBytes) this.budget.fail("maxExpansionBytes");
      expansionBytes += size;
      const field = fields.at(-1)!;
      let escapes = 0;
      if (!glob) {
        const special = conditionalPattern ? "\\*?[]-^()|+!@" : "\\*?[]-^";
        for (const character of text) if (special.includes(character)) escapes++;
      }
      scratch?.reserve(32, 0);
      if (owner) owner.reserve({ payload: size + (escapes ? size + escapes : 0), metadata: 64, work: text.length + 8 });
      if (escapes) {
        scratch?.reserve((field.patterns ? 32 : 32 * (field.fragments.length + 1)) + (text.length + escapes) * 2, 0);
        field.patterns ??= field.fragments.map(shellValueText);
        field.patterns.push(text.replace(conditionalPattern ? /[\\*?[\]\-^()|+!@]/gu : /[\\*?[\]\-^]/gu, "\\$&"));
      } else if (field.patterns) {
        scratch?.reserve(32, 0);
        field.patterns.push(text);
      }
      if (typeof value !== "string" || field.bytes) {
        if (!scratch) io[valueScope]?.reserve(32 * (field.bytes ? 1 : field.fragments.length + 1), field.bytes ? 1 : field.fragments.length + 1);
        if (typeof value !== "string") io[valueScope]?.hold(value);
        field.bytes = true;
      }
      regexAppend?.(text, !glob);
      field.fragments.push(value);
      field.present ||= present;
    };
    const appendSplit = async (value: ShellValue): Promise<void> => {
      this.budget.cpuCheckpoint();
      if (shellValueByteLength(value) === 0) return;
      const separators = state.variables.IFS ?? " \t\n";
      const separatorScope = this.budget.values.scope();
      try {
      separatorScope.reserve(64, 0);
      const points = new Set<number>();
      const addSeparator = (point: number): void => {
        if (points.has(point)) return;
        separatorScope.reserve(32, 0);
        points.add(point);
      };
      let asciiSeparators = true;
      const work = this.splitWork ??= { scanned: 0 };
      for (let index = 0; index < separators.length; index++) {
        const unit = separators.charCodeAt(index);
        asciiSeparators &&= unit <= 127;
        addSeparator(unit);
        addSeparator(separators.codePointAt(index)!);
        if (++work.scanned >= 4096) {
          work.scanned = 0;
          await yieldTurn(this.signal);
        }
      }
      let boundary = false;
      for await (const piece of this.splitValue(value, points, asciiSeparators, io, scratch)) {
        const point = typeof piece === "string" ? piece.codePointAt(0) : undefined;
        if (typeof piece === "string" && point !== undefined && piece.length === (point > 0xffff ? 2 : 1) && points.has(point)) {
          if (!" \t\n".includes(piece)) {
            fields.at(-1)!.present = true;
            addField();
          } else if (fields.at(-1)!.present) boundary = true;
        } else {
          if (boundary) addField();
          boundary = false;
          append(piece, true, true);
        }
      }
      if (boundary) addField();
      } finally { separatorScope.close(); }
    };
    const parts = word.parts.map((part) => ({ part, splitText: false, io }));
    for (let index = 0; index < parts.length; index++) {
      const { part, splitText, io: partIO } = parts[index]!;
      const quotedPresence = part.quoted && !(arrayOwned && isQuoteMarker(part));
      if (part.kind === "variable" && ["-", "+", ":-", ":+"].includes(part.operator ?? "") && /^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(part.name)) {
        const value = this.variable(state, part.name);
        const missing = value === undefined || (part.operator!.startsWith(":") && value === "");
        if (part.operator!.endsWith("+") ? !missing : missing) {
          const operandIO = this.parameterOperandIO(part.alternate!, state, partIO);
          scratch?.reserve(part.alternate!.parts.length * 32, 0);
          const alternate = part.alternate!.parts.map((entry) => ({ part: copyArraySelector(entry, { ...entry, quoted: entry.quoted || part.quoted }), splitText: true, io: operandIO }));
          if (!alternate.length && part.quoted) append("", false, true);
          parts.splice(index + 1, 0, ...alternate);
          continue;
        }
      }
      const selector = getArraySelector(part);
      if (part.kind === "variable" && selector?.kind === "members" && !part.length && split && (!part.quoted || selector.separator === "@")) {
        const members = await this.arrayMembers(part.name, state);
        for (let position = 0; position < members.length; position++) {
          if (position > 0) addField();
          const value = members[position]!;
          if (part.quoted || state.variables.IFS === "") append(value, !part.quoted, part.quoted || value.length > 0);
          else await appendSplit(value);
        }
      } else if (part.kind === "text" && !splitText) {
        let value: ShellValue = invokedValues.get(part) ?? part.byteValue ?? part.value;
        if (typeof value === "string" && index === 0 && !part.quoted && /^~(?:\/|$)/u.test(value)) value = (state.variables.HOME ?? "~") + value.slice(1);
        append(value, !part.quoted, quotedPresence || shellValueByteLength(value) > 0);
      } else if (part.kind === "variable" && part.name === "@" && part.quoted && !part.operator && split) {
        for (let position = 0; position < state.positional.length; position++) {
          if (position > 0) addField();
          append(stateMonitor(state)?.positionals.get(String(position), state.positional[position]!) ?? state.positional[position]!, false, true);
        }
        if (state.positional.length === 0 && word.parts.every((entry) => (entry.kind === "text" && entry.value === "") || entry === part)) fields[0]!.present = false;
      } else {
        const value = part.kind === "text" ? part.byteValue ?? part.value : await this.valuePart(part, state, partIO, hereString);
        if (part.quoted || !split || state.variables.IFS === "") append(value, !part.quoted, quotedPresence || !split || shellValueByteLength(value) > 0);
        else await appendSplit(value);
      }
      if (fields.length > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
      if (owner) await owner.ledger.checkpoint(this.signal);
    }
    const result: ShellValue[] = [];
    let resultBytes = 0;
    for (const field of fields) {
      if (!field.present && split) continue;
      if (scratch && field.fragments.length > 1 && !field.bytes) scratch.reserve(field.fragments.reduce((bytes, value) => bytes + shellValueText(value).length * 2, 0), 0);
      const assembled = concatShellValues(field.fragments, io[valueScope]);
      const projection = shellValueText(assembled);
      if (field.bytes && field.fragments.length > 1 && !field.patterns) {
        scratch?.reserve(field.fragments.length * 32, 0);
        field.patterns = field.fragments.map(shellValueText);
      }
      if (scratch && field.patterns && field.patterns.length > 1) scratch.reserve(field.patterns.reduce((bytes, text) => bytes + text.length * 2, 0), 0);
      const fieldPattern = field.patterns ? field.patterns.join("") : projection;
      const expanded = split ? await this.glob(projection, fieldPattern, state) : [pattern ? fieldPattern : projection];
      for (const text of expanded) {
        if (result.length >= this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
        const value = !pattern && expanded.length === 1 && text === projection ? assembled : text;
        const size = shellValueByteLength(value);
        if (size > this.budget.limits.maxExpansionBytes - resultBytes) this.budget.fail("maxExpansionBytes");
        resultBytes += size;
        scratch?.reserve(32, 0);
        owner?.reserve({ metadata: 32, allocatedSlots: 1, work: 3 });
        result.push(value);
      }
      if (result.length > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
    }
    return result;
    } finally { scratch?.close(); holding?.release(); }
  }

  private splitWork?: { scanned: number };

  private async *splitValue(value: ShellValue, separators: ReadonlySet<number>, asciiSeparators: boolean, io: IO, scratch?: ValueScope): AsyncGenerator<ShellValue> {
    this.budget.cpuCheckpoint();
    const work = this.splitWork ??= { scanned: 0 };
    if (typeof value === "string" || !asciiSeparators) {
      const text = shellValueText(value);
      const slice = (start: number, end: number): string => {
        if (start === 0 && end === text.length) return text;
        scratch?.reserve((end - start) * 2, 0);
        return text.slice(start, end);
      };
      let start = 0;
      for (let index = 0; index < text.length;) {
        const point = text.codePointAt(index)!;
        const character = String.fromCodePoint(point);
        const end = index + character.length;
        if (separators.has(point)) {
          if (start < index) yield slice(start, index);
          yield character;
          start = end;
        } else if (end - start >= 4096) {
          yield slice(start, end);
          start = end;
        }
        work.scanned += character.length;
        index = end;
        if (work.scanned >= 4096) {
          work.scanned = 0;
          await yieldTurn(this.signal);
        }
      }
      if (start < text.length) yield slice(start, text.length);
      return;
    }
    const bytes = shellValueBytes(value, io[valueScope]);
    let start = 0;
    for (let index = 0; index < bytes.length; index++) {
      if (++work.scanned >= 4096) {
        work.scanned = 0;
        await yieldTurn(this.signal);
      }
      const byte = bytes[index]!;
      if (byte > 127 || !separators.has(byte)) continue;
      if (start < index) yield shellValueFromBytes(bytes.subarray(start, index), io[valueScope]);
      yield String.fromCharCode(byte);
      start = index + 1;
    }
    if (start < bytes.length) yield start === 0 ? value : shellValueFromBytes(bytes.subarray(start), io[valueScope]);
  }

  private positionalValues(state: State): ShellValue[] {
    return state.positional.map((text, index) => stateMonitor(state)?.positionals.get(String(index), text) ?? text);
  }

  private replacePositionals(state: State, values: readonly ShellValue[], action?: () => void): void {
    const publish = action ?? (() => { state.positional = values.map(shellValueText); });
    const store = stateMonitor(state)?.positionals;
    if (store) store.replace(values.map((value, index) => [String(index), value] as const), publish);
    else publish();
  }

  private admitArguments(values: readonly ShellValue[], allocation: ValueScope): CommandArguments {
    if (!values.some(value => typeof value !== "string")) return createCommandArguments(values);
    if (values.length > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
    for (const value of values) if (typeof value !== "string") allocation.hold(value);
    return createCommandArguments(values, allocation);
  }

  async arrayMembers(name: string, state: State): Promise<string[]> {
    const store = requireArrays(state);
    const holding = store.owner.hold();
    try {
    const binding = store.get(name);
    store.owner.reserve({ metadata: 64, work: 3 });
    if (!binding) {
      const value = state.variables[name];
      if (value === undefined) return [];
      store.owner.reserve({ metadata: 32, allocatedSlots: 1, work: 3 });
      await textToken(store.owner, value, this.signal);
      return [value];
    }
    binding.retain();
    try {
      const indices = await binding.indices(store.owner, this.signal);
      const values: string[] = [];
      for (const index of indices) {
        store.owner.reserve({ metadata: 32, allocatedSlots: 1, work: 4 });
        const value = binding.get(index)!;
        await textToken(store.owner, value, this.signal);
        values.push(value);
        await store.owner.ledger.checkpoint(this.signal);
      }
      return values;
    } finally { await binding.release(); }
    } finally { holding.release(); }
  }

  async glob(value: string, pattern: string, state: State): Promise<string[]> {
    if (!/(?:^|[^\\])[*?[]/u.test(pattern)) return [value];
    const absolute = pattern.startsWith("/");
    const work = { remaining: Math.min(Number.MAX_SAFE_INTEGER, this.budget.limits.maxExpansionBytes * 4 + 1024), signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") };
    let candidates = [absolute ? "/" : ""];
    for (const segment of pattern.split("/").filter((segment) => segment.length > 0)) {
      const next: string[] = [];
      let candidateBytes = 0;
      const addCandidate = (candidate: string): void => {
        const size = Buffer.byteLength(candidate);
        if (size > this.budget.limits.maxExpansionBytes - candidateBytes) this.budget.fail("maxExpansionBytes");
        candidateBytes += size;
        next.push(candidate);
        if (next.length > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
      };
      if (!/(?:^|[^\\])[*?[]/u.test(segment)) {
        const literal = segment.replace(/\\(.)/gu, "$1");
        for (const candidate of candidates) addCandidate(`${candidate}${candidate && candidate !== "/" ? "/" : ""}${literal}`);
      } else {
        const matches = await compilePattern(segment, work);
        for (const candidate of candidates) {
          let entries;
          try {
            const pending = this.fs.readdir(resolvePath(state.cwd, candidate || "."), { signal: this.signal });
            entries = arrayStore(state) ? await interruptible(pending, this.signal) : await pending;
          }
          catch (error) { if (["ENOENT", "ENOTDIR", "EACCES"].includes(errorCode(error) ?? "")) continue; throw error; }
          for (const entry of entries) {
            if (entry.name !== "." && entry.name !== ".." && (state.dotglob || !entry.name.startsWith(".") || segment.startsWith(".")) && await matches(entry.name)) {
              addCandidate(`${candidate}${candidate && candidate !== "/" ? "/" : ""}${entry.name}`);
            }
          }
        }
      }
      candidates = next;
    }
    const found: string[] = [];
    for (const candidate of candidates) {
      try {
        const pending = this.fs.stat(resolvePath(state.cwd, candidate), { signal: this.signal });
        const stat = arrayStore(state) ? await interruptible(pending, this.signal) : await pending;
        if (!value.endsWith("/") || stat.type === "directory") found.push(candidate + (value.endsWith("/") ? "/" : ""));
      } catch (error) { if (!["ENOENT", "ENOTDIR", "EACCES"].includes(errorCode(error) ?? "")) throw error; }
    }
    return found.length ? found.sort() : [value];
  }
}
