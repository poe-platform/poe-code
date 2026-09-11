import { cancelTurn, monotonicNow, registerYieldCheckpoint, scheduleTurn, yieldTurn, type TurnHandle } from "../contracts/yield.js";
import {
  ACCESS_MODES, FsError, composeMiddleware, createBytePipe, pipeBytes, resolvePath, validateExitCode, writeText,
} from "../contracts/index.js";
import type {
  ByteSink, ByteSource, CommandContext, CommandInvoker, CommandRegistry, CommandResult, FileSystem, Middleware,
} from "../contracts/index.js";
import { concatShellValues, shellValueByteLength, shellValueBytes, shellValueFromBytes, shellValueText } from "../contracts/value.js";
import type { ShellValue } from "../contracts/value.js";
import { createCommandArguments, getCommandArguments } from "../contracts/command.js";
import type { CommandArguments } from "../contracts/command.js";
import { ValueArena } from "./value-state.js";
import type { HeldValue, ValueScope, ValueStore } from "./value-state.js";
import type { AndOr, Command, HereDocument, Pipeline, Redirect, Script, Word, WordPart } from "./parser.js";
import { HereDocumentSyntaxError, functionReprintedLines, hereDocumentWords, parseCompoundArrayValue, parseShellInputUnit, parseShellUnit } from "./parser.js";
import { ShellLimitError, ShellSyntaxError } from "./types.js";
import type { ShellCommandContext, ShellInvokeOptions, ShellLimits } from "./types.js";
import { forkExtensions } from "./extensions.js";
import type { PreparedShellChild, ShellBindingReference, ShellBindingResult, ShellChildPreparation, ShellExecutionCheckpoint, ShellExtensionBindings, ShellExtensionContext, ShellExtensionEvent, ShellExtensionInput, ShellExtensionState, ShellIndexedWriter } from "./extensions.js";
import { prepareBytesInput, prepareFileInput, ShellInput } from "./input.js";
import { observeDescriptor, PipeDescriptorFrame, pipeObservation, type PipeDescriptorReference } from "./descriptors.js";
import { evaluateArithmetic, prepareArithmetic } from "./arithmetic.js";
import { evaluatePositionalArithmetic } from "./arithmetic-parameters.js";
import { compilePattern, matchesPattern } from "./pattern.js";
import { byteLocale } from "./locale.js";
import { diagnosticCommandName } from "./diagnostic-name.js";
import { functionDisplay } from "./display.js";
import { ConditionalUnsupported, evaluateConditional } from "./conditional.js";
import { invocationScope, throwCleanupFailures, InvocationScope } from "./cleanup.js";
import { bindFileOutputBudget, openFileOutput } from "../contracts/filesystem-output.js";
import type { CommandFileDescriptor } from "../contracts/filesystem-descriptor.js";
import { outputFailure } from "../contracts/io.js";
import { executionCommands } from "../commands/execution.js";
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
import type { BindingWatch, OwnedText, PreparedBinding } from "./arrays/bindings.js";
import { EreProfileLimitError, EreSyntaxError, EreUnsupportedError } from "../commands/regex-execution/ere/errors.js";
import { EreLedger } from "../commands/regex-execution/ere/limits.js";
import { compileEre } from "../commands/regex-execution/ere/syntax.js";
import { matchEre } from "../commands/regex-execution/ere/matcher.js";
import type { EreFragment } from "../commands/regex-execution/ere/types.js";

export const defaultLimits: Required<ShellLimits> = {
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
const extensionExitFailures = new WeakMap<ShellExtensionState, { reason: unknown }>();
const specialBuiltinNames = new Set([":", ".", "break", "continue", "eval", "exit", "export", "readonly", "return", "set", "shift", "unset"]);
const unsupportedSetOptionNames = new Set([
  "allexport", "braceexpand", "emacs", "errtrace", "functrace", "hashall", "histexpand", "history",
  "ignoreeof", "interactive-comments", "keyword", "monitor", "noclobber", "noexec", "noglob", "nolog",
  "notify", "onecmd", "physical", "posix", "privileged", "verbose", "vi", "xtrace",
]);
type Discovery = { kind: "function" | "builtin" | "command" | "interpreter" | "file"; name: string };

function commandSpelling(command: Extract<Command, { kind: "simple" | "arithmetic" | "conditional" }>): string {
  if (command.kind === "arithmetic") return `((${command.source}))`;
  if (command.kind === "conditional") return `[[${command.source}]]`;
  const redirects = command.redirects.map(redirect => {
    const target = redirect.target.spelling ?? redirect.target.plain ?? "";
    if (redirect.operator === ">&" || redirect.operator === "<&") return `${redirect.descriptor}${redirect.operator}${target}`;
    const implicit = redirect.operator.startsWith("<") ? 0 : 1;
    return `${redirect.descriptor === implicit ? "" : redirect.descriptor}${redirect.operator} ${target}`;
  });
  return [...command.words.map(word => word.spelling ?? word.plain ?? ""), ...redirects].join(" ");
}

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

class ExecutionCleanup {
  readonly controller = new AbortController();
  readonly failures: unknown[] = [];
  readonly #pending: { readonly cleanup: () => void | Promise<void>; readonly allocation: ValueScope }[] = [];
  #closed = false;
  #drain: Promise<void> | undefined;
  #failure: { reason: unknown } | undefined;

  constructor(private readonly budget: Budget) {}

  register(cleanup: () => void | Promise<void>): void {
    this.budget.signal.throwIfAborted();
    if (this.#failure) throw this.#failure.reason;
    if (this.#closed) throw new TypeError("Execution cleanup enrollment is closed");
    if (typeof cleanup !== "function") throw new TypeError("Execution cleanup must be callable");
    this.budget.cpuCheckpoint();
    const allocation = this.budget.values.scope();
    try {
      allocation.reserve(96, 1);
      this.#pending.push({ cleanup, allocation });
    } catch (reason) { allocation.close(); throw reason; }
  }

  abort(reason: unknown): void {
    this.#failure ??= { reason };
    if (this.#pending.length || this.#drain) this.controller.abort(reason);
  }

  drain(): Promise<void> {
    return this.#drain ??= Promise.resolve().then(async () => {
      const retained: ValueScope[] = [];
      try {
        while (this.#pending.length) {
          const pending = this.#pending.splice(0);
          const results = await Promise.allSettled(pending.map(async entry => {
            let failed = false;
            try { await entry.cleanup(); }
            catch (reason) { failed = true; retained.push(entry.allocation); throw reason; }
            finally { if (!failed) entry.allocation.close(); }
          }));
          for (const result of results) if (result.status === "rejected") this.failures.push(result.reason);
        }
      } finally {
        this.#closed = true;
        for (const allocation of retained) allocation.close();
      }
    });
  }
}

export class Budget {
  readonly values: ValueArena;
  readonly executionCleanup = new ExecutionCleanup(this);
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

  async writeCounted(chunk: Uint8Array, write: () => Promise<number>, signal = this.signal): Promise<number> {
    signal.throwIfAborted();
    if (!(chunk instanceof Uint8Array)) throw new TypeError("Shell output must be Uint8Array");
    const reserved = chunk.byteLength;
    if (reserved > this.limits.maxOutputBytes - this.bytes) this.fail("maxOutputBytes");
    this.bytes += reserved;
    try {
      const count = await write();
      if (!Number.isSafeInteger(count) || count < 0 || count > reserved) throw new FsError("EIO", { syscall: "write", message: "invalid byte count" });
      this.bytes -= reserved - count;
      signal.throwIfAborted();
      return count;
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    }
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
const functionDiagnostics = new WeakMap<Command, Readonly<{ offset: number; lines?: ReadonlyMap<Command, number> }>>();
const childIdentities = new WeakMap<Budget, number>();

export interface State {
  extensions?: ShellExtensionState | undefined;
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
  pipefail: boolean;
  errexit?: boolean;
  nounset?: boolean;
  isolated?: boolean;
  redirectAssignments?: ReadonlyMap<string, ShellValue>;
}

interface IO {
  readonly [invocationScope]: InvocationScope;
  readonly [valueScope]?: ValueScope;
  readonly execution?: { readonly ignoreErrexit: boolean };
  readonly stdin: ByteSource;
  readonly stdinIsDefault?: boolean;
  readonly asyncDefaultInput?: ByteSource | undefined;
  readonly stdout: ByteSink;
  readonly stderr: ByteSink;
  readonly diagnosticLine?: number;
  readonly diagnosticOffset?: number;
  assignmentDiagnosticContext?: { name: string | undefined } | undefined;
  readonly functionCommandLines?: ReadonlyMap<Command, number> | undefined;
  readonly diagnosticCommandLines?: ReadonlyMap<Command, number> | undefined;
  readonly substitutionDiagnosticLine?: number;
  readonly substitutionDiagnosticLines?: ReadonlyMap<Command, number>;
  readonly scriptName?: string;
  readonly terminal?: {
    readonly target: Command | Pipeline;
    readonly frame: PreparedDescriptorFrame;
    io?: IO;
    beforeExit?(status: number, io: IO): Promise<void>;
    published?: number;
    completed?: boolean;
  } | undefined;
  descriptors?: ReadonlyMap<number, Descriptor>;
}

interface Descriptor {
  closed?: boolean;
  readonly input?: ByteSource;
  readonly stdinIsDefault?: boolean;
  readonly output?: ByteSink;
  readonly file?: CommandFileDescriptor;
  readonly pipe?: PipeDescriptorReference;
  readonly lifetime?: DescriptorLifetime;
}

class DescriptorLifetime {
  #references = 1;
  #ownerReleased = false;
  #closing: Promise<void> | undefined;

  constructor(private readonly finalize: () => void | Promise<void>) {}

  acquire(): () => Promise<void> {
    if (!this.#references) throw new FsError("EBADF");
    this.#references++;
    let released = false;
    return () => {
      if (released) return this.#closing ?? Promise.resolve();
      released = true;
      return this.#release();
    };
  }

  release(): Promise<void> {
    if (this.#ownerReleased) return this.#closing ?? Promise.resolve();
    this.#ownerReleased = true;
    return this.#release();
  }

  #release(): Promise<void> {
    if (--this.#references) return Promise.resolve();
    return this.#closing ??= Promise.resolve().then(this.finalize);
  }
}

class PreparedDescriptorFrame {
  #bindings = new Map<number, { lifetime: DescriptorLifetime; release(): Promise<void> }>();
  #work: Promise<void> = Promise.resolve();
  #closing: Promise<void> | undefined;

  constructor(private readonly references: PipeDescriptorFrame, private readonly budget: Budget) {
    references.scope.register(() => this.close());
  }

  acquire(descriptors: ReadonlyMap<number, Descriptor>): void {
    if (this.#closing) throw new FsError("EBADF");
    for (const [number, descriptor] of descriptors) {
      if (descriptor.closed || !descriptor.lifetime) continue;
      const allocation = this.budget.values.scope();
      try {
        allocation.reserve(64, 1);
        const release = descriptor.lifetime.acquire();
        this.#bindings.set(number, { lifetime: descriptor.lifetime, async release() {
          try { await release(); } finally { allocation.close(); }
        } });
      } catch (reason) { allocation.close(); throw reason; }
    }
  }

  reconcile(descriptors: ReadonlyMap<number, Descriptor>): Promise<void> {
    if (this.#closing) return Promise.reject(new FsError("EBADF"));
    const previous = this.#bindings;
    this.#bindings = new Map();
    const failures: unknown[] = [];
    const inherited = new Set([...previous.values()].map(binding => binding.lifetime));
    const surviving = new Map([...descriptors].filter(([, descriptor]) => descriptor.lifetime && inherited.has(descriptor.lifetime)));
    try { this.acquire(surviving); } catch (reason) { failures.push(reason); }
    const activePipes = new Set([...descriptors.values()].filter(descriptor => !descriptor.closed).map(descriptor => descriptor.pipe));
    this.#work = this.#work.then(async () => {
      const retired = await Promise.allSettled([
        ...[...previous.values()].map(binding => binding.release()),
        ...[...this.references.references].filter(reference => !activePipes.has(reference)).map(reference => reference.close()),
      ]);
      failures.push(...retired.filter(result => result.status === "rejected").map(result => result.reason));
      throwCleanupFailures(failures);
    });
    return this.#work;
  }

  close(): Promise<void> {
    return this.#closing ??= Promise.resolve().then(async () => {
      const failures: unknown[] = [];
      try { await this.#work; } catch (reason) { failures.push(reason); }
      const retired = await Promise.allSettled([...this.#bindings.values()].map(binding => binding.release()));
      this.#bindings.clear();
      failures.push(...retired.filter(result => result.status === "rejected").map(result => result.reason));
      throwCleanupFailures(failures);
    });
  }
}

function isolateIO(io: IO, references: PipeDescriptorFrame): IO {
  const descriptors = new Map<number, Descriptor>();
  for (const [number, descriptor] of io.descriptors ?? []) {
    if (number === 0 && descriptor.input !== io.stdin || number === 1 && descriptor.output !== io.stdout || number === 2 && descriptor.output !== io.stderr) continue;
    if (descriptor.closed || !descriptor.pipe) descriptors.set(number, { ...descriptor });
    else {
      const pipe = references.acquire(descriptor.pipe);
      descriptors.set(number, { ...descriptor, pipe });
    }
  }
  if (!descriptors.has(0)) descriptors.set(0, { input: io.stdin, ...(io.stdinIsDefault === undefined ? {} : { stdinIsDefault: io.stdinIsDefault }) });
  if (!descriptors.has(1)) descriptors.set(1, { output: io.stdout });
  if (!descriptors.has(2)) descriptors.set(2, { output: io.stderr });
  return { ...io, descriptors, ...(io.assignmentDiagnosticContext === undefined ? {} : { assignmentDiagnosticContext: { ...io.assignmentDiagnosticContext } }) };
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

interface OutputFinalizer {
  (completion: OutputCompletion): void | Promise<void>;
  readonly descriptor?: CommandFileDescriptor;
}

class Flow extends Error {
  constructor(readonly kind: "exit" | "return" | "break" | "continue" | "discard", readonly status: number, public levels = 1, readonly previousStatus?: number, readonly expansionFailure = false) {
    super(kind);
  }
}

const completedFlows = new WeakSet<Flow>();

function completedExit(status: number, kind: Flow["kind"] = "exit", levels = 1, previousStatus?: number, expansionFailure = false): Flow {
  const flow = new Flow(kind, status, levels, previousStatus, expansionFailure);
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

class DiscardCommandFailure extends CommandFailure {
  constructor(readonly variableName: string, status: number, readonly origin: "assignment" | "declaration") { super(`${variableName}: readonly variable`, status); }
}

class ParameterExpansionFailure extends ExpansionFailure {}

class NounsetFailure extends ExpansionFailure {}

class NounsetDiagnosticFailure extends Flow {
  constructor(readonly reason: unknown) { super("exit", 1); }
}

class ExtensionCheckpointFailure extends NounsetDiagnosticFailure {}

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

async function cloneState(state: State, signal: AbortSignal): Promise<State> {
  const destination = await snapshotState(state, () => ({
    ...state,
    variables: Object.assign(Object.create(null) as Record<string, string>, state.variables),
    exported: new Set(state.exported), functions: new Map(state.functions), positional: [...state.positional],
    readonlyVariables: new Set(state.readonlyVariables),
    getopts: cloneGetoptsBinding(state),
    directoryStack: { entries: [...state.directoryStack?.entries ?? []], bytes: state.directoryStack?.bytes ?? 0 },
    locals: state.locals.map((scope) => new Map([...scope].map(([name, saved]) => [name, { ...saved, ...(saved.getopts ? { getopts: { integer: saved.getopts.integer, cursor: cloneGetoptsState(saved.getopts.cursor) } } : {}) }]))),
  }), signal, async (destination, owner) => {
    const store = arrayStore(destination) ?? requireArrays(destination);
    for (let index = 0; index < state.locals.length; index++) {
      const sourceFrame = state.locals[index]!;
      const copiedFrame = destination.locals[index]!;
      for (const [name, saved] of sourceFrame) {
        const typed = typedSavedVariables.get(saved);
        if (typed) {
          const copied = copiedFrame.get(name);
          if (!copied) throw new ArrayFailure("stale state snapshot");
          const savedOwner = ArrayOwner.create(owner.ledger, owner);
          let binding: IndexedBinding | undefined;
          try {
            const watch = await store.watch(name, savedOwner, signal);
            const tickets = savedOwner.reserve({ generation: true, version: true, epoch: true, slots: 1, metadata: 64, work: 14 });
            const token = await textToken(savedOwner, name, signal);
            const admission = savedOwner.reserve({ slots: 1, metadata: 32, work: 5 });
            binding = typed.binding?.retain();
            typedSavedVariables.set(copied, { owner: savedOwner, binding, tickets, prepared: { name: token, admission }, watch, scalarLegacy: typed.scalarLegacy });
            tickets.cleanup = () => { typedSavedVariables.delete(copied); };
          } catch (error) { await binding?.release(); await savedOwner.close(); throw error; }
        }
        await owner.ledger.checkpoint(signal);
      }
    }
  });
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

function shellCharacterWidth(bytes: Uint8Array, offset: number, byteCount: boolean): number {
  if (byteCount) return 1;
  const first = bytes[offset]!;
  const length = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 1;
  if (offset + length > bytes.length) return 1;
  for (let index = 1; index < length; index++) {
    const byte = bytes[offset + index]!;
    if (byte < 0x80 || byte > 0xbf || index === 1 && (first === 0xe0 && byte < 0xa0 || first === 0xed && byte > 0x9f || first === 0xf0 && byte < 0x90 || first === 0xf4 && byte > 0x8f)) return 1;
  }
  return length;
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

  async diagnostic(io: IO, text: ShellValue): Promise<void> {
    const prefix = `${io.scriptName ?? "shell"}: line ${io.diagnosticLine ?? 1}: `;
    if (typeof text === "string") return writeText(io.stderr, `${prefix}${text}\n`);
    const allocation = this.budget.values.scope();
    try {
      const value = concatShellValues([prefix, text, "\n"], allocation);
      await io.stderr.write(shellValueBytes(value, allocation));
    } finally { allocation.close(); }
  }

  writeVariable(state: State, name: string, value: ShellValue, origin: "assignment" | "arithmetic" | "getopts" = "assignment"): void {
    if (arrayStore(state)?.get(name)) throw new ArrayFailure(origin === "arithmetic" ? "indexed arithmetic is unsupported" : "indexed write requires prepared publication");
    if (state.readonlyVariables?.has(name)) throw new Error(`${name}: readonly variable`);
    if (shellValueByteLength(value) > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
    if (name === "OPTIND" && state.getopts?.integer && origin !== "arithmetic") {
      try { value = String(evaluateArithmetic(prepareArithmetic(shellValueText(value) || "0"), this.arithmeticVariables(state))); }
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
    await this.arrayZero(state, name, async () => value);
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

  private assertArrayWritable(state: State, name: string, origin: "assignment" | "declaration" = "assignment"): void {
    if (!state.readonlyVariables?.has(name)) return;
    if (state.extensions?.syntax.indexedDeclarations?.includes("readonly")) throw new DiscardCommandFailure(name, 1, origin);
    throw new ArrayFailure("readonly binding");
  }

  async arrayZero(state: State, name: string, expand: () => Promise<ShellValue>, append = false, freeze = false): Promise<void> {
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
      this.assertArrayWritable(state, name);
      if (!watch.valid()) throw new ArrayFailure("stale binding");
      const current = store.get(name);
      if (!current) throw new ArrayFailure("stale binding");
      staged = await current.copy(this.signal);
      const value = append ? await this.arrayJoin(operation, [current.getValue(0) ?? "", expanded], "") : expanded;
      const token = await textToken(staged.owner, value, this.signal);
      try { staged.insert(0, token); } catch (error) { token.release(); throw error; }
      const supersede = await stateMonitor(state)!.prepareTypedPublication(name, operation, this.signal);
      this.signal.throwIfAborted();
      this.assertArrayWritable(state, name);
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

  async arrayJoin(owner: ArrayOwner, values: readonly string[], separator: string): Promise<string>;
  async arrayJoin(owner: ArrayOwner, values: readonly ShellValue[], separator: ShellValue): Promise<ShellValue>;
  async arrayJoin(owner: ArrayOwner, values: readonly ShellValue[], separator: ShellValue): Promise<ShellValue> {
    const raw = typeof separator !== "string" || values.some(value => typeof value !== "string");
    let bytes = 0;
    for (const value of values) {
      const length = typeof value === "string" ? value.length : shellValueByteLength(value);
      owner.reserve({ work: length + 1 }).release();
      bytes = exactSum(bytes, shellValueByteLength(value));
      await owner.ledger.checkpoint(this.signal, length + 1);
    }
    bytes = exactSum(bytes, Math.max(0, values.length - 1) * shellValueByteLength(separator));
    owner.reserve({ metadata: exactSum(exactSum(96, values.length * 32), raw ? exactSum(bytes * 2, 64) : 0), payload: bytes, allocatedSlots: values.length * (raw ? 2 : 1), work: values.length * 3 + 7 });
    this.signal.throwIfAborted();
    const allocation = raw ? this.budget.values.scope() : undefined;
    try {
      const result = raw ? concatShellValues(values.flatMap((value, index) => index ? [separator, value] : [value]), allocation) : values.join(separator as string);
      await owner.ledger.checkpoint(this.signal);
      return result;
    } finally { allocation?.close(); }
  }

  async arrayAssignment(assignment: ArrayAssignment, state: State, io: IO, declaration?: "readonly", origin: "assignment" | "declaration" = "assignment"): Promise<void> {
    const name = assignment.name;
    this.signal.throwIfAborted();
    this.assertArrayWritable(state, name, origin);
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
            return part.quoted && !(part.kind === "variable" && (part.name === "@" || selector && selector.kind !== "element" && selector.separator === "@"));
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
      let frozenAttributes: Set<string> | undefined;
      if (declaration && !state.readonlyVariables?.has(name)) {
        store.owner.reserve({ metadata: state.readonlyVariables ? 32 : 96, slots: 1, work: 5 });
        if (!state.readonlyVariables) frozenAttributes = stateMonitor(state)!.prepareCollection(new Set<string>(), "readonlyVariables");
      }
      const prepared = await store.prepareName(name, operation, this.signal);
      const preserve = assignment.kind === "element" || assignment.append;
      staged = preserve && current ? await current.copy(this.signal) : IndexedBinding.create(store.owner);
      if (preserve && !current && state.variables[name] !== undefined) {
        const token = await textToken(staged.owner, stateMonitor(state)?.values.get(name, state.variables[name]!) ?? state.variables[name]!, this.signal);
        try { staged.insert(0, token); } catch (error) { token.release(); throw error; }
      }
      let writes = 0;
      let cursor = assignment.append && assignment.kind === "compound" ? initialMaximum + 1 : 0;
      const insert = async (index: number, value: ShellValue) => {
        if (index > 2147483647) throw new ArrayFailure("index outside 0..2147483647");
        const token = await textToken(staged!.owner, value, this.signal);
        try { staged!.insert(index, token); } catch (error) { token.release(); throw error; }
        writes++;
      };
      if (assignment.kind === "element") {
        const index = numericIndex(assignment.index)!;
        const fields = await this.valueWord(assignment.value, state, io, false);
        let value = await this.arrayJoin(operation, fields, "");
        if (assignment.append) value = await this.arrayJoin(operation, [staged.getValue(index) ?? "", value], "");
        await insert(index, value);
      } else for (const entry of assignment.entries) {
        const fields = await this.valueWord(entry.value, state, io, entry.index === undefined);
        if (entry.index) {
          const index = numericIndex(entry.index)!;
          await insert(index, await this.arrayJoin(operation, fields, ""));
          cursor = index + 1;
        } else for (const value of fields) { await insert(cursor, value); cursor++; }
      }
      this.signal.throwIfAborted();
      this.assertArrayWritable(state, name, origin);
      if (!watch.valid()) throw new ArrayFailure("stale binding");
      if (declaration || !(assignment.kind === "compound" && assignment.append && writes === 0)) {
        let released: Promise<void> | undefined;
        stateMonitor(state)!.publish(tickets, name, () => {
          supersede();
          delete state.variables[name];
          released = store.publish(name, staged!, tickets, prepared);
          if (declaration) { state.readonlyVariables ??= frozenAttributes!; state.readonlyVariables.add(name); }
        });
        staged = undefined;
        await released;
      }
      watch.close();
    } finally { try { await staged?.release(); await operation.close(); } finally { holding.release(); } }
  }

  async run(script: Script, state: State, io: IO): Promise<number> {
    return this.finishShell(state, io, (await this.runUnit(script, state, io)).exitCode);
  }

  private extensionContext(state: State, io: IO, command = "", args: readonly string[] = [], argumentValues: readonly ShellValue[] = args): ShellExtensionContext {
    const frame = state.extensions!;
    let bindings: ShellExtensionBindings | undefined;
    let input: ShellExtensionInput | undefined;
    const createBindings = this.extensionBindings.bind(this, state, io);
    const createInput = this.extensionInput.bind(this, state, io);
    const signal = AbortSignal.any([this.signal, this.budget.executionCleanup.controller.signal]);
    return {
      command, args, argumentValues, status: state.status, functionDepth: state.functionDepth, sourceDepth: state.sourceDepth ?? 0,
      stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, signal, scope: frame,
      get bindings() { return bindings ??= createBindings(); },
      get input() { return input ??= createInput(); },
      variable: name => state.variables[name],
      accountSource: source => this.budget.source(shellValueByteLength(source)),
      diagnostic: message => this.diagnostic(io, message),
      evaluate: async (source, options) => {
        this.signal.throwIfAborted();
        if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
        this.budget.source(shellValueByteLength(source));
        const byteSource = typeof source !== "string";
        const text = byteSource ? Buffer.from(shellValueBytes(source)).toString("latin1") : source;
        const restoration = stateMonitor(state)?.restoration(true);
        try {
          state.depth++;
          return await this.runCurrentText(text, state, { ...io, diagnosticOffset: (io.diagnosticLine ?? 1) - 1 }, false, options?.name === undefined ? undefined : `${io.scriptName ?? "shell"}: ${options.name}`, byteSource, false);
        } finally {
          if (restoration) restoration.apply(() => { state.depth--; });
          else state.depth--;
        }
      },
      registerCleanup: cleanup => {
        let completion: Promise<void> | undefined;
        const close = (): Promise<void> => completion ??= Promise.resolve().then(cleanup);
        frame.cleanup.push(close);
        io[invocationScope].register(close);
      },
      registerExecutionCleanup: cleanup => {
        this.budget.executionCleanup.register(cleanup);
        return AbortSignal.any([this.commandSignal, this.budget.signal, this.budget.executionCleanup.controller.signal]);
      },
      interruptWait: status => {
        validateExitCode(status);
        return !signal.aborted && (frame.waiting?.(status) ?? false);
      },
      waitInterruptibly: async operation => {
        signal.throwIfAborted();
        const scope = io[invocationScope];
        scope.assertOpen();
        if (typeof operation !== "function") throw new TypeError("Cooperative wait requires a callable operation");
        if (frame.waiting) throw new Error("A cooperative wait is already active in this shell scope");
        const controller = new AbortController();
        const reason = Object.freeze({});
        let interruption: { status: number } | undefined;
        const interrupt = (status: number): boolean => {
          if (interruption || signal.aborted || scope.signal.aborted) return false;
          interruption = { status };
          controller.abort(reason);
          return true;
        };
        const close = (): void => { if (frame.waiting === interrupt) delete frame.waiting; };
        scope.register(close);
        frame.waiting = interrupt;
        try {
          const value = await scope.run(() => operation(AbortSignal.any([signal, scope.signal, controller.signal])));
          signal.throwIfAborted();
          return { kind: "completed", value };
        } catch (error) {
          signal.throwIfAborted();
          if (interruption && error === reason) return { kind: "interrupted", status: interruption.status };
          throw error;
        } finally { close(); }
      },
    };
  }

  private extensionBindings(state: State, io: IO): ShellExtensionBindings {
    const scope = io[invocationScope];
    scope.assertOpen();
    const allocation = this.budget.values.scope();
    const references = new Set<() => Promise<void>>();
    scope.register(async () => {
      try { await Promise.all([...references].map(close => close())); }
      finally { allocation.close(); }
    });
    const assertOpen = (): void => { this.signal.throwIfAborted(); scope.assertOpen(); allocation.assertOpen(); };
    const checkName = (name: string): void => {
      assertOpen();
      if (typeof name !== "string" || !/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name)) throw new TypeError("Invalid binding name");
    };
    const checkIndex = (index: number, maximum: 2147483647 | 4294967295 = 2147483647): void => {
      if (!Number.isSafeInteger(index) || index < 0 || index > maximum) throw new RangeError(`Binding index outside 0..${maximum}`);
    };
    const retain = (value: ShellValue | undefined): ShellValue | undefined => {
      if (value !== undefined && typeof value !== "string") allocation.hold(value);
      return value;
    };
    return Object.freeze({
      describe: (name: string) => {
        checkName(name);
        const kind = arrayStore(state)?.get(name) ? "indexed" : state.variables[name] === undefined ? "unset" : "scalar";
        return Object.freeze({ kind, readonly: state.readonlyVariables?.has(name) ?? false, exported: state.exported.has(name) });
      },
      get: (name: string, index = 0) => {
        checkName(name);
        checkIndex(index, 4294967295);
        const binding = arrayStore(state)?.get(name);
        const scalar = state.variables[name];
        return retain(binding ? binding.getValue(index) : index === 0 && scalar !== undefined ? stateMonitor(state)?.values.get(name, scalar) ?? scalar : undefined);
      },
      assign: async (name: string, value: ShellValue) => {
        checkName(name);
        await scope.run(() => this.assignVariable(state, name, value));
        assertOpen();
      },
      prepareReference: async (reference: ShellValue): Promise<ShellBindingResult<ShellBindingReference>> => {
        assertOpen();
        let owned: ValueScope | undefined;
        let closed = false;
        let completion: Promise<void> | undefined;
        const work = new Set<Promise<unknown>>();
        const close = (): Promise<void> => {
          closed = true;
          return completion ??= Promise.resolve().then(async () => {
            await Promise.allSettled([...work]);
            try { owned?.close(); }
            finally { references.delete(close); }
          });
        };
        references.add(close);
        const failure = (value: ShellValue, suffix: string, prefix = ""): ShellBindingResult<never> => {
          const diagnostic = concatShellValues([prefix, value, suffix], allocation);
          allocation.hold(diagnostic);
          return Object.freeze({ ok: false, diagnostic });
        };
        try {
          owned = this.budget.values.scope();
          owned.hold(reference);
          const text = shellValueText(reference);
          const match = /^([a-zA-Z_][a-zA-Z_0-9]*)(?:\[([^\[\]]+)\])?$/u.exec(text);
          if (!match) {
            const result = failure(reference, "': not a valid identifier", "`");
            await close();
            return result;
          }
          const name = match[1]!;
          const subscript = match[2];
          const reservation = owned.reserve(128 + text.length * 2, 1);
          const run = (action: () => Promise<ShellBindingResult<void>>): Promise<ShellBindingResult<void>> => {
            try {
              assertOpen();
              if (closed) throw new Error("Binding reference is closed");
              if (work.size) throw new Error("Binding reference is busy");
              const pending = scope.run(() => Promise.resolve().then(() => {
                this.signal.throwIfAborted();
                return action();
              }));
              work.add(pending);
              void pending.then(() => { work.delete(pending); }, () => { work.delete(pending); });
              return pending;
            } catch (error) { return Promise.reject(error); }
          };
          const handle: ShellBindingReference = Object.freeze({
            unbindName: () => run(async () => {
              if (state.readonlyVariables?.has(text)) return failure(reference, ": cannot unset: readonly variable");
              if (arrayStore(state)?.get(text)) await this.unsetIndexed(state, text);
              else this.unsetVariable(state, text);
              return Object.freeze({ ok: true, value: undefined });
            }),
            assignInteger: (value: number) => run(async () => {
              if (!Number.isSafeInteger(value)) throw new TypeError("Binding integer must be a safe integer");
              if (state.readonlyVariables?.has(name)) return failure(name, ": readonly variable");
              if (subscript === undefined) await this.assignVariable(state, name, String(value));
              else {
                const index = literalIndex(subscript, name.length + 1);
                await this.arrayAssignment({
                  kind: "element", name, index, append: false,
                  value: { offset: 0, parts: [{ kind: "text", value: String(value), quoted: true }] },
                }, state, io);
              }
              return Object.freeze({ ok: true, value: undefined });
            }),
            close,
          });
          reservation.commit(handle);
          return Object.freeze({ ok: true, value: handle });
        } catch (error) {
          try { await close(); }
          catch (cleanup) { scope.failures.push(cleanup); }
          throw error;
        }
      },
      openIndexed: async (name: string, options: { readonly clear?: boolean } = {}) => {
        checkName(name);
        const clear = options.clear;
        if (clear !== undefined && typeof clear !== "boolean") throw new TypeError("Invalid indexed writer options");
        return this.incrementalIndexed(state, io, name, clear === true);
      },
      prepare: async (name: string, options: { readonly kind: "indexed"; readonly clear?: boolean }) => {
        checkName(name);
        if (options.kind !== "indexed" || options.clear !== undefined && typeof options.clear !== "boolean") throw new TypeError("Unsupported binding preparation");
        if (state.readonlyVariables?.has(name)) throw new ArrayFailure("readonly binding");
        if (controlNames.has(name)) throw new ArrayFailure("control binding cannot be indexed");
        if (state.exported.has(name)) throw new ArrayFailure("exported binding cannot be indexed");
        const clear = options.clear === true;
        const store = requireArrays(state);
        let prepared: PreparedBinding | undefined;
        let preparing: Promise<void> | undefined;
        let active: Promise<void> | undefined;
        let closed = false;
        let completion: Promise<void> | undefined;
        const close = (): Promise<void> => {
          closed = true;
          return completion ??= (async () => {
            await Promise.allSettled([preparing, active]);
            await prepared?.close();
          })();
        };
        scope.register(close);
        const validate = (): void => {
          assertOpen();
          if (closed) throw new ArrayFailure("binding transaction is closed");
          if (state.readonlyVariables?.has(name)) throw new ArrayFailure("readonly binding");
          if (state.exported.has(name)) throw new ArrayFailure("exported binding cannot be indexed");
          prepared!.validate();
        };
        const run = (action: () => Promise<void>): Promise<void> => {
          try {
            validate();
            if (active) throw new ArrayFailure("binding transaction is busy");
            const work = scope.run(action);
            active = work;
            void work.then(() => { if (active === work) active = undefined; }, () => { if (active === work) active = undefined; });
            return work;
          } catch (error) { return Promise.reject(error); }
        };
        try {
          preparing = scope.run(async () => {
            prepared = await store.prepare(name, this.signal, !clear);
            validate();
            if (!clear && !store.get(name) && state.variables[name] !== undefined) {
              const value = stateMonitor(state)!.values.get(name, state.variables[name]!);
              const token = await textToken(prepared.binding.owner, value, this.signal);
              try { validate(); prepared.binding.insert(0, token); }
              catch (error) { token.release(); throw error; }
            }
            validate();
          });
          await preparing;
          return Object.freeze({
            get: (index: number) => { validate(); checkIndex(index); return retain(prepared!.binding.getValue(index)); },
            set: (index: number, value: ShellValue) => run(async () => {
              checkIndex(index);
              const token = await textToken(prepared!.binding.owner, value, this.signal);
              try { validate(); prepared!.binding.insert(index, token); }
              catch (error) { token.release(); throw error; }
            }),
            unset: (index: number) => run(async () => {
              checkIndex(index);
              const binding = prepared!.binding;
              binding.values.get(index)?.slot.release();
              let maximum = -1;
              for (const key of binding.values.keys()) {
                maximum = Math.max(maximum, key);
                await binding.owner.ledger.checkpoint(this.signal, 2);
                validate();
              }
              binding.maximum = maximum;
            }),
            commit: () => run(async () => {
              await this.prepareArrayObservers(state, prepared!.binding.owner);
              const supersede = await stateMonitor(state)!.prepareTypedPublication(name, prepared!.binding.owner, this.signal);
              validate();
              let retirement: Promise<void> | undefined;
              stateMonitor(state)!.publish(prepared!.tickets, name, () => {
                supersede();
                delete state.variables[name];
                retirement = prepared!.publish();
              });
              await retirement;
              this.signal.throwIfAborted();
            }),
            close,
          });
        } catch (error) { await close(); throw error; }
      },
    });
  }

  private async incrementalIndexed(state: State, io: IO, name: string, clear: boolean): Promise<ShellIndexedWriter> {
    const scope = io[invocationScope];
    scope.assertOpen();
    this.signal.throwIfAborted();
    if (state.readonlyVariables?.has(name)) throw new ArrayFailure("readonly binding");
    if (controlNames.has(name)) throw new ArrayFailure("control binding cannot be indexed");
    const store = requireArrays(state);
    const owner = store.owner;
    const monitor = stateMonitor(state)!;
    let lifetime: ArrayOwner | undefined;
    let holding: Admission | undefined;
    let identity: object | undefined;
    let admittedLocal: SavedVariable | undefined;
    let preparing: Promise<void> | undefined;
    let active: Promise<void> | undefined;
    let closed = false;
    let completion: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closed = true;
      return completion ??= (async () => {
        await Promise.allSettled([preparing, active]);
        try { await lifetime?.close(); }
        finally { holding?.release(); }
      })();
    };
    scope.register(close);
    const localIdentity = (): SavedVariable | undefined => {
      for (let index = state.locals.length - 1; index >= 0; index--) {
        owner.reserve({ work: 2 }).release();
        const saved = state.locals[index]!.get(name);
        if (saved) return saved;
      }
      return undefined;
    };
    const validate = (): void => {
      this.signal.throwIfAborted();
      scope.assertOpen();
      if (closed) throw new ArrayFailure("indexed writer is closed");
      owner.assertOpen();
      if (arrayStore(state) !== store || store.owner !== owner || identity !== undefined && store.bindings.get(name) !== identity) throw new ArrayFailure("incremental target identity changed");
      if (localIdentity() !== admittedLocal) throw new ArrayFailure("incremental target local identity changed");
    };
    try {
      admittedLocal = localIdentity();
      preparing = scope.run(async () => {
        holding = owner.hold();
        lifetime = ArrayOwner.create(owner.ledger, owner);
        lifetime.reserve({ metadata: 192, work: 12 });
        await textToken(lifetime, name, this.signal);
        const watch = await store.watch(name, lifetime, this.signal);
        try {
          await this.prepareArrayObservers(state, lifetime);
          validate();
          if (state.readonlyVariables?.has(name)) throw new ArrayFailure("readonly binding");
          if (!watch.valid()) throw new ArrayFailure("binding changed during writer admission");
          if (clear || !store.get(name)) {
            const prepared = await store.prepare(name, this.signal, false);
            try {
              if (!clear && state.variables[name] !== undefined) {
                const value = monitor.values.get(name, state.variables[name]!);
                const token = await textToken(prepared.binding.owner, value, this.signal);
                try { prepared.validate(); prepared.binding.insert(0, token); }
                catch (error) { token.release(); throw error; }
              }
              validate();
              if (state.readonlyVariables?.has(name)) throw new ArrayFailure("readonly binding");
              if (!watch.valid()) throw new ArrayFailure("binding changed during writer admission");
              prepared.validate();
              let retirement: Promise<void> | undefined;
              monitor.publish(prepared.tickets, name, () => {
                delete state.variables[name];
                retirement = prepared.publish();
              });
              await retirement;
            } finally { await prepared.close(); }
          }
          identity = store.bindings.get(name);
          if (!identity) throw new ArrayFailure("incremental target is not indexed");
          validate();
        } finally { watch.close(); }
      });
      await preparing;
    } catch (error) {
      try { await close(); } catch (cleanup) { scope.failures.push(cleanup); }
      throw error;
    }
    return Object.freeze({
      set: (index: number, value: ShellValue): Promise<void> => {
        try {
          validate();
          if (!Number.isSafeInteger(index) || index < 0 || index > 4294967295) throw new ArrayFailure("index outside 0..4294967295");
          if (active) throw new ArrayFailure("indexed writer is busy");
          const work = scope.run(async () => {
            const current = store.get(name)!;
            const operation = ArrayOwner.create(owner.ledger, lifetime!);
            let retained = false;
            let staged: IndexedBinding | undefined;
            let token: OwnedText | undefined;
            try {
              current.retain();
              retained = true;
              const watch = await store.watch(name, operation, this.signal);
              const tickets = operation.reserve({ generation: true, version: true, epoch: true, work: 8 });
              await this.prepareArrayObservers(state, operation);
              token = await textToken(operation, value, this.signal);
              validate();
              if (!watch.valid() || store.get(name) !== current) throw new ArrayFailure("incremental target changed during write");
              if (current.references > 2) staged = await current.copy(this.signal);
              validate();
              if (!watch.valid() || store.get(name) !== current) throw new ArrayFailure("incremental target changed during write");
              const target = staged ?? current;
              let retirement: Promise<void> | undefined;
              monitor.publish(tickets, name, () => {
                target.insert(index, token!);
                token = undefined;
                if (staged) retirement = store.publish(name, staged, tickets);
                else store.revise(name, current, tickets);
              });
              staged = undefined;
              watch.close();
              await retirement;
              this.signal.throwIfAborted();
            } finally {
              token?.release();
              try { await staged?.release(); }
              finally {
                try { if (retained) await current.release(); }
                finally { await operation.close(); }
              }
            }
          });
          active = work;
          void work.then(() => { if (active === work) active = undefined; }, () => { if (active === work) active = undefined; });
          return work;
        } catch (error) { return Promise.reject(error); }
      },
      close,
    });
  }

  private extensionInput(state: State, io: IO): ShellExtensionInput {
    const scope = io[invocationScope];
    const assertOpen = (): void => { this.signal.throwIfAborted(); scope.assertOpen(); };
    assertOpen();
    const checkDescriptor = (descriptor: number): void => {
      assertOpen();
      if (!Number.isSafeInteger(descriptor) || descriptor < 0) throw new RangeError("Invalid input descriptor");
    };
    return Object.freeze({ validateOpen: (descriptor: number): void => {
      checkDescriptor(descriptor);
      const entry = io.descriptors?.get(descriptor);
      const input = entry?.input ?? (!io.descriptors && descriptor === 0 ? io.stdin : undefined);
      const output = entry?.output ?? (!io.descriptors ? descriptor === 1 ? io.stdout : descriptor === 2 ? io.stderr : undefined : undefined);
      if (entry?.closed || (!input || input === closedSource) && (!output || output === closedSink)) throw new FsError("EBADF", { message: "Closed input descriptor" });
    }, observe: (descriptor: number) => {
      checkDescriptor(descriptor);
      const entry = io.descriptors?.get(descriptor);
      const input = entry?.input ?? (!io.descriptors && descriptor === 0 ? io.stdin : undefined);
      const output = entry?.output ?? (!io.descriptors ? descriptor === 1 ? io.stdout : descriptor === 2 ? io.stderr : undefined : undefined);
      if (entry?.closed || (!input || input === closedSource) && (!output || output === closedSink)) throw new FsError("EBADF", { syscall: "observe" });
      const readable = input !== undefined && input !== closedSource;
      if (entry?.pipe) return observeDescriptor(pipeObservation(entry.pipe.endpoint, input instanceof ShellInput ? () => input.probeRead() : undefined), scope, this.budget, this.signal);
      const file = (input instanceof ShellInput ? input.descriptor : undefined) ?? entry?.file;
      const stat = file?.stat.bind(file);
      const method = file?.capabilities.readObservation === true ? file.probeRead : undefined;
      if (file?.capabilities.readObservation === true && typeof method !== "function") throw new FsError("ENOTSUP", { syscall: "probeRead" });
      const probe = method?.bind(file);
      return observeDescriptor({ readable, async probeRead(signal) {
        signal.throwIfAborted();
        const local = input instanceof ShellInput ? input.probeRead() : undefined;
        if (!file && local) return local;
        const timeout = local?.timeout ?? (stat && (await stat({ signal })).type === "file" ? "ignore" : "unknown");
        if (input instanceof ShellInput && input.bufferedBytes > 0) return { readiness: "ready", timeout };
        if (probe) return { readiness: await probe({ signal }), timeout };
        if (local) return local;
        return { readiness: timeout === "ignore" ? "ready" : "unknown", timeout };
      } }, scope, this.budget, this.signal);
    }, borrow: (descriptor: number) => {
      checkDescriptor(descriptor);
      const entry = io.descriptors?.get(descriptor);
      const source = entry?.closed ? undefined : entry?.input ?? (descriptor === 0 && !io.descriptors ? io.stdin : undefined);
      if (!source) throw new FsError("EBADF", { message: "Unreadable input descriptor" });
      if (!(source instanceof ShellInput)) throw new FsError("ENOTSUP", { message: "Input descriptor has no enrolled shared cursor" });
      const resource: { input?: ShellInput } = {};
      let closed = false;
      let completion: Promise<void> | undefined;
      const release = (): Promise<void> => {
        closed = true;
        return completion ??= Promise.resolve().then(() => resource.input?.close());
      };
      scope.register(release);
      const input = new ShellInput(source, this.budget, this.signal);
      resource.input = input;
      const stdinIsDefault = entry?.stdinIsDefault ?? (descriptor === 0 ? io.stdinIsDefault : undefined);
      return Object.freeze({
        ...(stdinIsDefault === undefined ? {} : { stdinIsDefault }),
        read: async (raw: boolean, options: { readonly count?: number; readonly delimiter?: number; readonly exact?: boolean; readonly timeoutMs?: number } = {}) => {
          assertOpen();
          if (closed) throw new Error("Input borrow is closed");
          const { count, delimiter, exact, timeoutMs } = options;
          if (typeof raw !== "boolean" || count !== undefined && (!Number.isSafeInteger(count) || count < 0) || delimiter !== undefined && (!Number.isInteger(delimiter) || delimiter < 0 || delimiter > 255) || exact !== undefined && typeof exact !== "boolean" || timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new TypeError("Invalid input read options");
          return scope.run(() => input.line(raw, { ...(count === undefined ? {} : { count }), ...(delimiter === undefined ? {} : { delimiter }), ...(exact === undefined ? {} : { exact }), ...(timeoutMs === undefined ? {} : { timeoutMs }), byteCount: byteLocale(state.variables) }));
        },
        record: async (options: { readonly delimiter?: number } = {}) => {
          assertOpen();
          if (closed) throw new Error("Input borrow is closed");
          const { delimiter } = options;
          if (delimiter !== undefined && (!Number.isInteger(delimiter) || delimiter < 0 || delimiter > 255)) throw new TypeError("Invalid input record options");
          return scope.run(() => input.record(delimiter === undefined ? {} : { delimiter }));
        },
        readiness: () => {
          assertOpen();
          if (closed) throw new Error("Input borrow is closed");
          return input.readiness();
        },
        release,
      });
    } });
  }

  private async startExtensions(state: State, io: IO): Promise<void> {
    const frame = state.extensions;
    if (!frame || frame.started) return;
    frame.started = true;
    for (const [name, builtin] of frame.builtins) if (shellBuiltinNames.has(name) && builtin.replace !== true) throw new TypeError(`Extension builtin conflicts with existing builtin: ${name}`);
    for (const entry of frame.entries) await entry.instance.start?.(this.extensionContext(state, io));
  }

  private async extensionEvent(event: ShellExtensionEvent, state: State, io: IO, status: number, command = ""): Promise<boolean> {
    if (!state.extensions) return false;
    this.signal.throwIfAborted();
    await this.startExtensions(state, io);
    const previous = state.status;
    state.status = status;
    state.extensions.eventDepth = (state.extensions.eventDepth ?? 0) + 1;
    try {
      for (const entry of state.extensions.entries) {
        this.signal.throwIfAborted();
        const result = await entry.instance.event?.(event, this.extensionContext(state, io, command));
        if (result !== undefined) {
          if (event !== "command" || !result || (result.action !== "skip" && result.action !== "return")) throw new TypeError("Invalid extension lifecycle control");
          if (result.action === "return") throw new Flow("return", validateExitCode(result.status), 1, status);
          return true;
        }
      }
      return false;
    } finally {
      state.extensions.eventDepth!--;
      if (!this.signal.aborted) state.status = previous;
    }
  }

  private async extensionCheckpoint(point: ShellExecutionCheckpoint, state: State, io: IO): Promise<void> {
    try {
      for (const checkpoint of state.extensions!.checkpoints) {
        await io[invocationScope].run(() => Promise.resolve().then(async () => {
          const context = this.extensionContext(state, io);
          context.signal.throwIfAborted();
          await checkpoint(point, context);
          context.signal.throwIfAborted();
        }));
      }
    } catch (reason) {
      this.signal.throwIfAborted();
      if (reason instanceof Flow) throw reason;
      throw new ExtensionCheckpointFailure(reason);
    }
  }

  private async beginShellExit(state: State, io: IO, status: number): Promise<number> {
    const frame = state.extensions;
    if (!frame || frame.exiting) return status;
    if (frame.exitStatus !== undefined) return frame.exitStatus;
    this.signal.throwIfAborted();
    state = trackState(state, this.budget, io[invocationScope]);
    frame.exiting = true;
    try {
      try { await this.extensionEvent("exit", state, io, status); }
      catch (error) { if (error instanceof Flow && error.kind === "exit" && !(error instanceof ExtensionCheckpointFailure)) { if (!error.expansionFailure) status = error.status; } else throw error; }
      this.signal.throwIfAborted();
    } catch (reason) { extensionExitFailures.set(frame, { reason }); }
    finally { frame.exiting = false; }
    frame.exitStatus = status;
    return status;
  }

  async finishShell(state: State, io: IO, status: number): Promise<number> {
    const frame = state.extensions;
    if (!frame || frame.exiting) return status;
    let failure: { reason: unknown } | undefined;
    try {
      status = await this.beginShellExit(state, io, status);
      failure = extensionExitFailures.get(frame);
    } catch (reason) { failure = { reason }; }
    try { await this.releaseExtensions(state); }
    catch (cleanup) {
      this.signal.throwIfAborted();
      if (failure?.reason instanceof ExtensionCheckpointFailure) io[invocationScope].failures.push(cleanup);
      else {
        if (failure) throw new AggregateError([failure.reason, cleanup], "Shell completion and extension cleanup failed");
        throw cleanup;
      }
    }
    this.signal.throwIfAborted();
    if (failure) throw failure.reason instanceof ExtensionCheckpointFailure && !state.isolated ? failure.reason.reason : failure.reason;
    return status;
  }

  private async releaseExtensions(state: State): Promise<void> {
    const cleanup = await Promise.allSettled(state.extensions?.cleanup.map(close => close()) ?? []);
    this.signal.throwIfAborted();
    throwCleanupFailures(cleanup.filter(result => result.status === "rejected").map(result => result.reason));
  }

  private async finishReturn(event: "function-return" | "source-return", state: State, io: IO, status: number, previous = status): Promise<number> {
    while (true) {
      try { await this.extensionEvent(event, state, io, previous); return status; }
      catch (error) {
        if (error instanceof ExtensionCheckpointFailure) throw error;
        if (error instanceof Flow && error.kind === "return") { status = error.status; previous = error.previousStatus ?? status; continue; }
        if (error instanceof Flow && error.kind === "exit") throw new Flow("exit", await this.beginShellExit(state, io, error.status), 1, error.previousStatus);
        throw error;
      }
    }
  }

  async runUnit(script: Script, state: State, io: IO): Promise<{ exitCode: number; terminated: boolean }> {
    state = trackState(state, this.budget, io[invocationScope]);
    try {
      await this.startExtensions(state, io);
      return { exitCode: await this.inputUnit(script, state, io), terminated: false };
    }
    catch (error) {
      if (error instanceof NounsetDiagnosticFailure) {
        if (state.isolated) throw error;
        throw error.reason;
      }
      if (error instanceof Flow && error.kind === "exit") return { exitCode: await this.finishShell(state, io, error.status), terminated: true };
      throw error;
    }
  }

  private async inputUnit(script: Script, state: State, io: IO): Promise<number> {
    try { return await this.script(script, state, io); }
    catch (error) {
      if (!(error instanceof Flow) || error.kind !== "discard") throw error;
      this.signal.throwIfAborted();
      throwCleanupFailures(io[invocationScope].failures);
      state.status = error.status;
      return error.status;
    }
  }

  async script(script: Script, state: State, io: IO): Promise<number> {
    if (state.extensions?.syntax.indexedDeclarations?.includes("readonly")) io.assignmentDiagnosticContext ??= { name: undefined };
    for (const list of script.lists) {
      if (list.terminator) {
        const hook = state.extensions?.listTerminators.get(list.terminator.operator);
        if (!hook) throw new TypeError("Missing captured shell list terminator handler");
        let admissionOpen = true;
        let preparation: Promise<PreparedShellChild> | undefined;
        let failure: { reason: unknown } | undefined;
        let status = 0;
        try {
          status = validateExitCode(await hook.execute({
            ...this.extensionContext(state, io),
            prepareChild: options => {
              if (!admissionOpen || preparation) return Promise.reject(this.commandSignal.aborted ? this.commandSignal.reason : new TypeError("Shell child preparation is single-use and dispatch-scoped"));
              preparation = this.prepareListChild(list, script, state, io, options);
              void preparation.catch(() => undefined);
              return preparation;
            },
          }));
        } catch (reason) { failure = { reason }; }
        finally { admissionOpen = false; }
        await preparation?.catch(() => undefined);
        this.commandSignal.throwIfAborted();
        if (failure) throw failure.reason;
        state.status = status;
        continue;
      }
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

  private async prepareListChild(list: AndOr, script: Script, state: State, io: IO, options: ShellChildPreparation): Promise<PreparedShellChild> {
    this.signal.throwIfAborted();
    if (!options || !(options.signal instanceof AbortSignal) || typeof options.registerCleanup !== "function"
      || options.stdin !== "inherit" && options.stdin !== "async-default") throw new TypeError("Invalid shell child preparation");
    const signal = AbortSignal.any([this.commandSignal, options.signal, this.budget.executionCleanup.controller.signal]);
    signal.throwIfAborted();
    const scope = new InvocationScope(signal);
    const references = new PipeDescriptorFrame(scope);
    const descriptors = new PreparedDescriptorFrame(references, this.budget);
    let child: State | undefined;
    let runtime: Runtime | undefined;
    let execution: Promise<number> | undefined;
    let closing: Promise<void> | undefined;
    let closed = false;
    let ready!: () => void;
    const acquisition = new Promise<void>(resolve => { ready = resolve; });
    const close = (): Promise<void> => {
      closed = true;
      return closing ??= Promise.resolve().then(async () => {
        await acquisition;
        await execution?.catch(() => undefined);
        await scope.close();
        if (child) stateMonitor(child)?.closeValues();
        throwCleanupFailures(scope.failures);
      });
    };
    try {
      options.registerCleanup(close);
      if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
      child = await cloneState(state, signal);
      if (closed) throw new TypeError("Shell child preparation is closed");
      signal.throwIfAborted();
      child.extensions = forkExtensions(state.extensions, "subshell");
      child.isolated = true;
      child.depth++;
      const allocation = this.budget.values.scope();
      scope.register(() => allocation.close());
      const childIO = isolateIO({ ...io, [invocationScope]: scope, [valueScope]: allocation }, references);
      descriptors.acquire(childIO.descriptors!);
      Object.assign(childIO, { terminal: list.pipelines.length === 1 ? { target: list.pipelines[0]!, frame: descriptors } : undefined });
      if (options.stdin === "async-default") {
        Object.assign(childIO, { asyncDefaultInput: (async function* () {})() });
      }
      runtime = new Runtime(this.fs, this.commands, this.middleware, this.budget, signal, this.fileWrites, this.outputFiles,
        signal, this.cancellation, this.cancellationState, this.cancellationOwner, this.cancellationDepth, this.cancellationMaxDepth);
      const processId = (childIdentities.get(this.budget) ?? 1000) + 1;
      if (!Number.isSafeInteger(processId)) throw new RangeError("Shell child identity exhausted");
      childIdentities.set(this.budget, processId);
      const childScript: Script = { ...script, lists: [{ pipelines: list.pipelines, operators: list.operators }] };
      return Object.freeze({ processId, run: (): Promise<number> => {
        if (closed || execution) return Promise.reject(new TypeError("Prepared shell child run is single-use"));
        execution = Promise.resolve().then(async () => {
          signal.throwIfAborted();
          try { return await runtime!.run(childScript, child!, childIO); }
          catch (reason) {
            if (reason instanceof NounsetDiagnosticFailure) throw reason.reason;
            throw reason;
          }
        });
        return execution;
      } });
    } catch (reason) {
      ready();
      try { await close(); } catch { this.commandSignal.throwIfAborted(); }
      throw reason;
    } finally { ready(); }
  }

  async pipeline(pipeline: Pipeline, state: State, io: IO): Promise<number> {
    this.signal.throwIfAborted();
    const terminal = io.terminal?.target === pipeline ? io.terminal : undefined;
    let status: number;
    if (pipeline.commands.length === 1) status = await this.command(pipeline.commands[0]!, state,
      terminal ? { ...io, terminal: { target: pipeline.commands[0]!, frame: terminal.frame } } : io, false, pipeline.negate);
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
        if (state.extensions && !state.extensions.eventDepth) {
          for (const command of pipeline.commands) {
            if (command.kind === "simple" || command.kind === "arithmetic" || command.kind === "conditional") {
              this.writeVariable(state, "BASH_COMMAND", commandSpelling(command));
            }
          }
        }
        for (let index = 1; index < pipeline.commands.length; index++) pipes.push(createBytePipe({
          highWaterMark: this.budget.limits.pipeHighWaterMark, signal: this.signal,
        }));
        for (let index = 0; index < pipeline.commands.length; index++) controllers.push(new AbortController());
        let transferred!: () => void;
        let pendingTransfers = pipeline.commands.length;
        const transfer = new Promise<void>(resolve => { transferred = resolve; });
        const retireBaseline = terminal ? transfer.then(() => terminal.frame.reconcile(new Map())) : Promise.resolve();
        retain(retireBaseline);
        void retireBaseline.catch(() => undefined);
        let preparedStages = 0;
        let acceptPreparation: (() => void) | undefined;
        let rejectPreparation: ((reason: unknown) => void) | undefined;
        const installation = state.extensions?.checkpoints.length ? new Promise<void>((resolve, reject) => {
          acceptPreparation = () => { if (++preparedStages === pipeline.commands.length) resolve(); };
          rejectPreparation = reject;
        }).then(async () => {
          await retireBaseline;
          await this.extensionCheckpoint("child-job-install", state, io);
        }) : undefined;
        if (installation) {
          retain(installation);
          void installation.catch(() => undefined);
        }
        const tasks = pipeline.commands.map(async (command, index) => {
          let admitted = false;
          const admit = (): void => {
            if (admitted) return;
            admitted = true;
            if (--pendingTransfers === 0) transferred();
          };
          try {
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
          let captured: CapturedCancellationOutcome<CommandResult>;
          const preparationCleanup: (() => void | Promise<void>)[] = [];
          let stageOwnsCleanup = false;
          try {
          const references = new PipeDescriptorFrame(io[invocationScope]);
          preparationCleanup.push(() => references.close());
          const descriptorFrame = new PreparedDescriptorFrame(references, this.budget);
          preparationCleanup.push(() => descriptorFrame.close());
          const reading = incoming?.endpoints?.read;
          const writing = outgoing?.endpoints?.write;
          const readReference = reading && references.open(reading, this.budget);
          const writeReference = writing && references.open(writing, this.budget);
          const input = incoming
            ? new ShellInput(reading?.readable ?? incoming.readable, this.budget, signal, { provenance: "stream", poll: () => incoming.readiness() })
            : new ShellInput(io.stdin, this.budget, signal);
          preparationCleanup.push(() => input.close());
          const writable = writing?.writable ?? outgoing?.writable;
          const failOutput = writable?.[outputFailure]?.bind(writable);
          const pipeOutput: ByteSink | undefined = outgoing && { ...(failOutput ? { [outputFailure]: failOutput } : {}), ownedOutput: writable!.ownedOutput!, write: async (chunk) => {
            try {
              await writable!.write(chunk);
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
            let preparedChild: State | undefined;
            let preparationFailed = false;
            let started = false;
            let checkpointFailure: ExtensionCheckpointFailure | undefined;
            let outcome: CapturedCancellationOutcome<CommandResult>;
            try {
              let exitCode: number;
              try {
                const child = await cloneState(state, this.signal);
                preparedChild = child;
                child.extensions = undefined;
                child.extensions = forkExtensions(state.extensions, "pipeline");
                child.isolated = true;
                const inherited = isolateIO(io, references);
                const childIO: IO = {
                  ...inherited,
                  stdin: input,
                  ...(incoming ? { asyncDefaultInput: undefined } : {}),
                  ...(incoming ? { stdinIsDefault: false } : {}),
                  stdout: pipeOutput ? this.budget.sink(pipeOutput, signal) : signalSink(io.stdout, signal),
                  stderr: signalSink(io.stderr, signal),
                  terminal: { target: command, frame: descriptorFrame },
                };
                const descriptors = new Map(childIO.descriptors);
                descriptors.set(0, incoming ? { input, stdinIsDefault: false, ...(readReference ? { pipe: readReference } : {}) } : { ...descriptors.get(0), input });
                descriptors.set(1, outgoing ? { output: childIO.stdout, ...(writeReference ? { pipe: writeReference } : {}) } : { ...descriptors.get(1), output: childIO.stdout });
                descriptors.set(2, { ...descriptors.get(2), output: childIO.stderr });
                childIO.descriptors = descriptors;
                descriptorFrame.acquire(descriptors);
                admit();
                acceptPreparation?.();
                await retireBaseline;
                if (installation) {
                  await installation;
                  signal.throwIfAborted();
                }
                const execution = runtime.runCommandIsolated(command, child, childIO).then(status => runtime.finishShell(child, childIO, status));
                const work = (child.extensions?.checkpoints.length ? execution.catch(reason => {
                  if (reason instanceof ExtensionCheckpointFailure) checkpointFailure = reason;
                  throw reason;
                }) : execution).finally(async () => {
                  try { await runtime.releaseExtensions(child); }
                  catch (cleanup) {
                    if (checkpointFailure) io[invocationScope].failures.push(cleanup);
                    else throw cleanup;
                  }
                  finally { stateMonitor(child)?.closeValues(); }
                });
                preparedChild = undefined;
                started = true;
                retain(work);
                exitCode = await interruptible(work, signal);
              } catch (error) {
                if (error instanceof ExtensionCheckpointFailure) checkpointFailure = error;
                if (!started) {
                  preparationFailed = true;
                  rejectPreparation?.(error);
                }
                if (!(error instanceof PipelineClosed)) throw error;
                exitCode = 141;
              }
              outcome = { kind: "return", value: { exitCode } };
            } catch (reason) {
              outcome = { kind: "throw", reason };
            } finally {
              admit();
              const cleanupFailures: unknown[] = [];
              if (preparedChild) {
                const child = preparedChild;
                await io[invocationScope].cleanup(async () => {
                  try { await runtime.releaseExtensions(child); }
                  finally { stateMonitor(child)?.closeValues(); }
                });
              }
              completed.add(index);
              if (incoming && !reading) {
                const upstream = index - 1;
                const close = scheduleTurn(() => {
                  closing.delete(close);
                  if (written.has(upstream) && !completed.has(upstream)) controllers[upstream]!.abort(new PipelineClosed());
                });
                closing.add(close);
                try { await incoming.abort(); }
                catch (reason) { cleanupFailures.push(reason); }
              }
              try { await input.close().catch((error: unknown) => { if (!(error instanceof PipelineClosed)) throw error; }); }
              catch (reason) { cleanupFailures.push(reason); }
              try { await descriptorFrame.close(); }
              catch (reason) { cleanupFailures.push(reason); }
              try { await references.close(); }
              catch (reason) { cleanupFailures.push(reason); }
              if (outgoing && !writing) await outgoing.close().catch(() => undefined);
              if (checkpointFailure || installation && preparationFailed) io[invocationScope].failures.push(...cleanupFailures);
              else if (cleanupFailures.length) {
                io[invocationScope].failures.push(...cleanupFailures.slice(1));
                outcome = { kind: "throw", reason: cleanupFailures[0] };
              }
            }
            if (outcome.kind === "throw") throw outcome.reason;
            return outcome.value;
          };
          stageOwnsCleanup = true;
          captured = { kind: "return", value: await executeStage() };
          } catch (reason) {
            rejectPreparation?.(reason);
            if (!stageOwnsCleanup) await Promise.all(preparationCleanup.map(cleanup => io[invocationScope].cleanup(cleanup)));
            captured = frame.report && Object.is(frame.report.origin.signal.reason, reason)
              ? { kind: "throw", reason, report: frame.report }
              : { kind: "throw", reason };
          }
          const selection = await owner.finish(Promise.resolve(), captured);
          if (selection.outcome.kind === "throw") throw selection.outcome.reason;
          return selection.outcome.value.exitCode;
          } catch (reason) {
            rejectPreparation?.(reason);
            throw reason;
          } finally { admit(); }
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
    if (pipeline.commands.length > 1) await this.errexit(status, state, io);
    return pipeline.negate && !terminal ? Number(status === 0) : status;
  }

  async runCommandIsolated(command: Command, state: State, io: IO, fileShortcut = false): Promise<number> {
    try {
      await this.startExtensions(state, io);
      return await this.command(command, state, io, fileShortcut);
    }
    catch (error) {
      if (error instanceof NounsetDiagnosticFailure) throw error;
      if (error instanceof Flow && (error.kind === "exit" || error.kind === "discard")) return this.finishShell(state, io, error.status);
      if (error instanceof Flow && error.kind === "return") return error.status;
      throw error;
    }
  }

  async errexit(status: number, state: State, io: IO): Promise<void> {
    this.signal.throwIfAborted();
    if (status !== 0 && !io.execution?.ignoreErrexit) {
      await this.extensionEvent("error", state, io, status);
      if (state.errexit) throw new Flow("exit", status);
    }
  }

  private async publishStatus(state: State, statuses: readonly number[], io: IO): Promise<void> {
    this.signal.throwIfAborted();
    try { throwCleanupFailures(io[invocationScope].failures); }
    catch (error) { throw new NounsetDiagnosticFailure(error); }
    await publishPipelineStatus(trackState(state, this.budget, io[invocationScope]), statuses, this.signal, io[invocationScope]);
  }

  async command(command: Command, state: State, io: IO, fileShortcut = false, publicationNegate = false): Promise<number> {
    io[invocationScope].assertOpen();
    if (state.extensions && (command.kind === "simple" || command.kind === "arithmetic" || command.kind === "conditional")) {
      io = { ...io, diagnosticLine: io.diagnosticCommandLines?.get(command) ?? (command.line ?? 1) + (io.diagnosticOffset ?? 0) };
      const description = commandSpelling(command);
      if (!state.extensions.eventDepth) this.writeVariable(state, "BASH_COMMAND", description);
      if (await this.extensionEvent("command", state, io, state.status, description)) return state.status;
    }
    const publishes = command.kind === "simple" || command.kind === "subshell" || command.kind === "arithmetic" || command.kind === "conditional";
    const terminal = io.terminal?.target === command ? io.terminal : undefined;
    if (terminal) terminal.beforeExit = async (status, completionIO) => {
      if (publishes) {
        const reported = publicationNegate && (command.kind === "conditional" || command.kind === "arithmetic") ? Number(status === 0) : status;
        await this.publishStatus(state, [reported], completionIO);
        terminal.published = status;
        await this.errexit(status, state, completionIO);
      }
    };
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
    if (terminal && state.extensions?.exitStatus !== undefined) state.extensions.exitStatus = status;
    if (publishes) {
      const reported = publicationNegate && (command.kind === "conditional" || command.kind === "arithmetic") ? Number(status === 0) : status;
      if (terminal?.published !== status) await this.publishStatus(state, [reported], io);
      if (!terminal?.completed) await this.errexit(status, state, io);
    }
    return status;
  }

  async executeCommand(command: Command, state: State, originalIO: IO, fileShortcut = false): Promise<number> {
    const terminal = originalIO.terminal?.target === command ? originalIO.terminal : undefined;
    originalIO.descriptors ??= new Map<number, Descriptor>([
      [0, { input: originalIO.stdin, ...(originalIO.stdinIsDefault === undefined ? {} : { stdinIsDefault: originalIO.stdinIsDefault }) }],
      [1, { output: originalIO.stdout }], [2, { output: originalIO.stderr }],
    ]);
    originalIO = { ...originalIO, terminal: undefined };
    state = trackState(state, this.budget, originalIO[invocationScope]);
    if (originalIO.asyncDefaultInput) {
      if (!command.redirects.some(redirect => redirect.descriptor === 0)) {
        const descriptors = new Map(originalIO.descriptors);
        descriptors.set(0, { input: originalIO.asyncDefaultInput, stdinIsDefault: true });
        originalIO = { ...originalIO, descriptors, stdin: originalIO.asyncDefaultInput, stdinIsDefault: true, asyncDefaultInput: undefined };
      } else originalIO = { ...originalIO, asyncDefaultInput: undefined };
    }
    originalIO = activeIO(originalIO);
    const diagnosticLine = originalIO.diagnosticCommandLines?.get(command) ?? (command.line ?? 1) + (originalIO.diagnosticOffset ?? 0);
    originalIO = { ...originalIO, diagnosticLine, substitutionDiagnosticLine: originalIO.substitutionDiagnosticLines?.get(command) ?? diagnosticLine };
    const references = new PipeDescriptorFrame(originalIO[invocationScope]);
    if (command.kind === "subshell") originalIO = isolateIO(originalIO, references);
    this.budget.tick();
    if (this.budget.commands % 128 === 0) await yieldTurn(this.signal);
    this.signal.throwIfAborted();
    const inputs = new Set<{ close(): void | Promise<void> }>();
    const outputs = new Set<OutputFinalizer>();
    const outputFailures: { descriptor: CommandFileDescriptor; reason: unknown }[] = [];
    let outputStatus: number | undefined;
    const finishOutputs = async (status: number): Promise<void> => {
      const pending = [...outputs];
      outputs.clear();
      const settled = await Promise.allSettled(pending.map(close => close({ status })));
      for (const [index, result] of settled.entries()) {
        const descriptor = pending[index]?.descriptor;
        if (result.status === "rejected" && descriptor) outputFailures.push({ descriptor, reason: result.reason });
      }
      if (status !== 0) outputStatus = status;
      throwCleanupFailures(settled.filter(result => result.status === "rejected").map(result => result.reason));
    };
    const allocation = this.budget.values.scope();
    originalIO = { ...originalIO, [valueScope]: allocation };
    let io = originalIO;
    let diagnosticFailure: NounsetDiagnosticFailure | undefined;
    try {
      const execute = async (): Promise<number> => {
      if (command.kind === "function") {
        if (state.profile === "sh" && (specialBuiltinNames.has(command.name) || state.extensions?.builtins.get(command.name)?.special)) {
          await this.diagnostic(io, `\`${command.name}': is a special builtin`);
          throw new Flow("exit", 2);
        }
        const body = { ...command.body, sourceName: io.scriptName ?? "shell" };
        const offset = io.diagnosticOffset ?? 0;
        const bodyLine = io.functionCommandLines?.get(command.body);
        if (bodyLine !== undefined) body.line = bodyLine - offset;
        functionDiagnostics.set(body, { offset, ...(bodyLine === undefined ? {} : { lines: io.functionCommandLines! }) });
        state.functions.set(command.name, body);
        return 0;
      }
      if (command.kind === "simple") {
        const status = await this.simple(command, state, originalIO, inputs, outputs, fileShortcut, terminal);
        if (originalIO.assignmentDiagnosticContext) originalIO.assignmentDiagnosticContext.name = undefined;
        return status;
      }
      io = await this.redirect(command.redirects, state, io, inputs, outputs, command.kind === "subshell", command.kind !== "subshell");
      if (terminal) {
        terminal.io = io;
        await terminal.frame.reconcile(io.descriptors!);
      }
      if (command.kind === "conditional") {
        if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = "[[";
        try {
          return await evaluateConditional(command.expression, {
            fs: this.fs, cwd: state.cwd, signal: this.signal,
            locale: state.variables.LC_ALL || state.variables.LC_COLLATE || state.variables.LANG || "C",
            work: { remaining: this.budget.limits.maxExpansionBytes, signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") },
            expand: async (word, pattern = false) => (await this.word(word, state, io, false, pattern, false, pattern)).join(""),
            regex: (subject, pattern) => this.ere(subject, pattern, state, io),
            option: name => name === "errexit" ? !!state.errexit : name === "nounset" ? !!state.nounset : name === "pipefail" ? state.pipefail : state.extensions?.options.get(name)?.enabled ?? false,
            present: name => {
              const match = /^([a-zA-Z_][a-zA-Z_0-9]*)(?:\[(0|[1-9][0-9]*|[@*])\])?$/u.exec(name);
              if (!match) throw new ConditionalUnsupported("[[ variable selector: unsupported conditional profile");
              const binding = arrayStore(state)?.get(match[1]!);
              const selector = match[2];
              if (selector === "@" || selector === "*") return binding ? binding.values.size > 0 : this.variable(state, match[1]!) !== undefined;
              const index = selector === undefined ? 0 : numericIndex({ decimal: selector }, 4294967295);
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
        if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = "((";
        try {
          return Number(evaluatePositionalArithmetic(command.expression, {
            positional: state.positional, arg0: state.arg0 ?? "virtual-bash", owner: arrayStore(state)?.owner,
            maximumBytes: this.budget.limits.maxExpansionBytes,
            checkpoint: () => this.signal.throwIfAborted(),
            requireParameter: (name, value) => this.requireParameter(value, name, state, io),
            limit: () => this.budget.fail("maxExpansionBytes"),
          }, (prepared) => evaluateArithmetic(prepared, this.arithmeticVariables(state, io.diagnosticLine))) === 0n);
        }
        catch (error) { this.rethrowArithmeticControl(error); throw new Error(`((: ${message(error)}`); }
      }
      if (command.kind === "subshell") {
        const child = await cloneState(state, this.signal);
        child.extensions = undefined;
        let started = false;
        try {
          child.extensions = forkExtensions(state.extensions, "subshell");
          child.isolated = true;
          child.loopDepth = 0;
          if (state.extensions?.checkpoints.length) await this.extensionCheckpoint("child-job-install", state, io);
          started = true;
          return await this.run(command.body, child, io);
        } finally {
          try {
            if (!started && child.extensions?.cleanup.length) await io[invocationScope].cleanup(() => this.releaseExtensions(child));
          } finally { stateMonitor(child)?.closeValues(); }
        }
      }
      if (command.kind === "group") return await this.script(command.body, state, io);
      if (command.kind === "if") {
        for (const branch of command.branches) {
          if (await this.script(branch.condition, state, { ...io, execution: { ignoreErrexit: true } }) === 0) return await this.script(branch.body, state, io);
        }
        return command.otherwise ? await this.script(command.otherwise, state, io) : 0;
      }
      if (command.kind === "case") {
        if (state.extensions) {
          const description = `case ${command.subject.spelling ?? command.subject.plain ?? ""} in `;
          if (!state.extensions.eventDepth) this.writeVariable(state, "BASH_COMMAND", description);
          if (await this.extensionEvent("command", state, io, state.status, description)) return state.status;
        }
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
            if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = undefined;
            await this.assignVariable(state, command.name, value);
            if (state.extensions) {
              const description = `for ${command.name} in ${command.words?.map(word => word.spelling ?? word.plain ?? "").join(" ") ?? '"$@"'}`;
              if (!state.extensions.eventDepth) this.writeVariable(state, "BASH_COMMAND", description);
              if (await this.extensionEvent("command", state, io, state.status, description)) continue;
            }
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
      let status = await execute();
      if (terminal) {
        await terminal.beforeExit?.(status, terminal.io ?? io);
        status = await this.finishShell(state, terminal.io ?? io, status);
        terminal.completed = true;
      }
      await finishOutputs(status);
      return status;
    } catch (caught) {
      const diagnostic = caught instanceof ExecutionFailure ? caught.diagnostic : undefined;
      const error = caught instanceof ExecutionFailure ? caught.original : caught;
      if (caught instanceof ExecutionFailure) io = caught.io;
      if (error instanceof NounsetDiagnosticFailure) diagnosticFailure = error;
      this.signal.throwIfAborted();
      if (error instanceof Flow) {
        if (terminal && error.kind === "exit" && !(error instanceof NounsetDiagnosticFailure)) {
          await this.finishShell(state, terminal.io ?? io, error.status);
          terminal.completed = true;
        }
        try { await finishOutputs(error.status); }
        catch (reason) {
          this.signal.throwIfAborted();
          if (!outputFailures.length) throw reason;
          await writeText(io.stderr, `${io.scriptName ?? "shell"}: line ${io.diagnosticLine ?? 1}: ${message(reason)}\n`);
          for (const failure of outputFailures) failure.descriptor.acknowledgeCloseFailure(failure.reason);
        }
      }
      if (error instanceof Flow || error instanceof ShellLimitError || error instanceof ShellSyntaxError) throw error;
      this.clearOutcomeReport();
      if (error instanceof HereDocumentSyntaxError) {
        await writeText(io.stderr, error.diagnostic);
        if (command.kind !== "simple" && command.kind !== "subshell" && command.kind !== "arithmetic" && command.kind !== "conditional") await this.errexit(1, state, io);
        return 1;
      }
      if (errorCode(error) === "EPIPE") {
        for (const failure of outputFailures) failure.descriptor.acknowledgeCloseFailure(failure.reason);
        if (command.kind !== "simple" && command.kind !== "subshell" && command.kind !== "arithmetic" && command.kind !== "conditional") await this.errexit(141, state, io);
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
        throw completedExit(error instanceof ParameterExpansionFailure && !state.isolated ? 127 : 1, "exit", 1, undefined, true);
      }
      if (error instanceof ArrayFailure) await writeText(io.stderr, `${io.scriptName ?? "shell"}: line ${line}: ${diagnostic ?? message(error)}\n`);
      else {
        try {
          const origin = io.assignmentDiagnosticContext;
          const namedDeclaration = error instanceof DiscardCommandFailure && error.origin === "declaration" && origin?.name !== undefined;
          const detail = diagnostic ?? `${namedDeclaration ? `${origin.name}: ` : ""}${message(error)}`;
          await writeText(io.stderr, `${io.scriptName ?? "shell"}: line ${line}: ${detail}\n`);
          for (const failure of outputFailures) failure.descriptor.acknowledgeCloseFailure(failure.reason);
        }
        catch { this.signal.throwIfAborted(); }
      }
      if (error instanceof ExpansionFailure) throw completedExit(error instanceof ParameterExpansionFailure && !state.isolated ? 127 : 1);
      if (error instanceof FatalCommandFailure) throw completedExit(error.status);
      if (error instanceof DiscardCommandFailure) throw completedExit(error.status, "discard");
      const status = outputStatus ?? (error instanceof CommandFailure ? error.status : 1);
      if (command.kind !== "simple" && command.kind !== "subshell" && command.kind !== "arithmetic" && command.kind !== "conditional") await this.errexit(status, state, io);
      return status;
    } finally {
      await Promise.allSettled([
        references.close(),
        ...[...outputs].map(async close => close({ reason: new FsError("ECANCELED", { syscall: "redirect" }) })),
        ...[...inputs].map(async input => input.close()),
      ]).then(results => {
        const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
        if (diagnosticFailure) io[invocationScope].failures.push(...failures);
        else throwCleanupFailures(failures);
      }).finally(() => allocation.close());
    }
  }

  async loopBody(body: Script, state: State, io: IO): Promise<{ status: number; stop: boolean }> {
    let status = 0;
    let control: Flow | undefined;
    try { status = await this.script(body, state, io); }
    catch (error) {
      if (!(error instanceof Flow) || (error.kind !== "break" && error.kind !== "continue")) throw error;
      control = error;
    }
    if (state.extensions?.checkpoints.length) await this.extensionCheckpoint("loop-body-complete", state, io);
    if (control && --control.levels > 0) throw control;
    return { status, stop: control?.kind === "break" };
  }

  async document(document: HereDocument, state: State, io: IO, line = document.endLine): Promise<ShellValue> {
    this.signal.throwIfAborted();
    let value = "";
    let fragments: ShellValue[] | undefined;
    const allocation = this.budget.values.scope();
    let size = 0;
    let words = 0;
    const warnings: string[] = [];
    try {
      for (const word of hereDocumentWords(document, line, byteLocale(state.variables), warnings, state.extensions?.syntax)) {
        this.signal.throwIfAborted();
        for (const warning of warnings.splice(0)) await writeText(io.stderr, `shell: warning: ${warning}\n`);
        if (++words % 128 === 0) await yieldTurn(this.signal);
        for (const part of await this.valueWord(word, state, io, false, false, false, false, undefined, true)) {
          size += shellValueByteLength(part);
          if (size > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
          if (!fragments && typeof part === "string") value += part;
          else {
            if (!fragments) {
              allocation.reserve(64, 2);
              fragments = [value];
            }
            allocation.reserve(32, 1);
            fragments.push(part);
          }
        }
      }
      return fragments ? concatShellValues(fragments, io[valueScope] ?? allocation) : value;
    } finally {
      try {
        for (const warning of warnings.splice(0)) await writeText(io.stderr, `shell: warning: ${warning}\n`);
      } finally { allocation.close(); }
    }
  }

  async redirect(redirects: readonly Redirect[], state: State, io: IO, inputs: Set<{ close(): void | Promise<void> }>, outputs: Set<OutputFinalizer>, isolatedInlineInput = false, persistMoves = false, fileShortcut = false, line?: number): Promise<IO> {
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
    const references = new PipeDescriptorFrame(io[invocationScope]);
    inputs.add(references);
    const replaceDescriptor = async (number: number, next?: Descriptor): Promise<void> => {
      const previous = descriptors.get(number)?.pipe;
      if (previous && references.references.has(previous)) await previous.close();
      if (next) descriptors.set(number, next);
      else descriptors.delete(number);
    };
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
        ...(io.assignmentDiagnosticContext === undefined ? {} : { assignmentDiagnosticContext: io.assignmentDiagnosticContext }),
        ...(io.functionCommandLines === undefined ? {} : { functionCommandLines: io.functionCommandLines }),
        ...(io.diagnosticCommandLines === undefined ? {} : { diagnosticCommandLines: io.diagnosticCommandLines }),
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
        let value: ShellValue;
        try { value = redirect.document ? await this.document(redirect.document, state, currentIO(), line) : concatShellValues(await this.valueWord(redirect.target, state, currentIO(), false, false, hereString), io[valueScope]); }
        catch (error) {
          if (error instanceof NounsetFailure) throw error;
          if (error instanceof ParameterExpansionFailure && !isolatedInlineInput) throw error;
          if (error instanceof ParameterExpansionFailure) throw new CommandFailure(error.message, state.isolated ? 1 : 127);
          if (error instanceof ExpansionFailure) throw new Error(error.message);
          throw error;
        }
        if (hereString) {
          if (shellValueByteLength(value) >= this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
          value = concatShellValues([value, "\n"], io[valueScope]);
        }
        const prepared = prepareBytesInput(typeof value === "string" ? value : shellValueBytes(value, io[valueScope]), this.budget);
        const input = new ShellInput(prepared.source, this.budget, this.signal, prepared.options);
        const lifetime = new DescriptorLifetime(async () => { try { await input.close(); } finally { await prepared.close(); } });
        inputs.add({ close: () => lifetime.release() });
        io[invocationScope].register(() => lifetime.release());
        await replaceDescriptor(redirect.descriptor, { input, stdinIsDefault: false, lifetime });
        continue;
      }
      const targets = await this.word(redirect.target, state, currentIO());
      if (targets.length !== 1) throw new Error("Ambiguous redirect");
      const target = targets[0]!;
      errorTarget = target;
      if (redirect.operator.endsWith("&")) {
        if (target === "-") await replaceDescriptor(redirect.descriptor);
        else {
          if (!/^\d+-?$/u.test(target)) throw new Error(`${target}: Bad file descriptor`);
          const move = target.endsWith("-");
          if (move && !redirect.move) throw new Error(`${target}: ambiguous redirect`);
          const sourceDescriptor = Number(move ? target.slice(0, -1) : target);
          const descriptor = descriptors.get(sourceDescriptor);
          if (!descriptor || descriptor.closed || (!move && (redirect.operator === "<&" ? !descriptor.input : !descriptor.output))) throw new Error(`${move ? sourceDescriptor : target}: Bad file descriptor`);
          const pipe = descriptor.pipe && references.acquire(descriptor.pipe);
          await replaceDescriptor(redirect.descriptor, { ...descriptor, ...(pipe ? { pipe } : {}) });
          if (move && sourceDescriptor !== redirect.descriptor) {
            descriptors.delete(sourceDescriptor);
            if (descriptor.pipe && (references.references.has(descriptor.pipe) || persistMoves && !replaced.has(sourceDescriptor))) await descriptor.pipe.close();
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
          const inputOwner: { input?: ShellInput } = {};
          let closing: Promise<void> | undefined;
          const cleanups: (() => void | Promise<void>)[] = [];
          const close = (): Promise<void> => closing ??= (async () => {
            const failures: unknown[] = [];
            try { await inputOwner.input?.close(); } catch (error) { failures.push(error); }
            for (const cleanup of cleanups) {
              try { await cleanup(); }
              catch (error) { if (!failures.some(failure => Object.is(failure, error))) failures.push(error); }
            }
            throwCleanupFailures(failures.filter(error => !(error instanceof PipelineClosed
              && this.signal.aborted && Object.is(error, this.signal.reason))));
          })();
          const lifetime = new DescriptorLifetime(close);
          inputs.add({ close: () => lifetime.release() });
          io[invocationScope].register(() => lifetime.release());
          const prepared = stat.type === "directory" ? prepareBytesInput("", this.budget)
            : await prepareFileInput({ fs: this.fs, signal: this.signal, cleanupFailurePrioritySignal: this.budget.signal, registerCleanup: close => {
              cleanups.push(close);
            } }, path, this.budget);
          if (!cleanups.includes(prepared.close)) cleanups.push(prepared.close);
          io[invocationScope].assertOpen();
          const input = new ShellInput(prepared.source, this.budget, this.signal, prepared.options);
          inputOwner.input = input;
          await replaceDescriptor(redirect.descriptor, { input, stdinIsDefault: false, lifetime });
        } else {
          const append = redirect.operator === ">>";
          const capabilities = await this.fs.capabilitiesFor?.(path, options) ?? this.fs.capabilities;
          const canonical = capabilities.open === true;
          const random = capabilities.randomAccessWrite === true;
          let file!: OutputFile;
          if (!canonical) await this.fileOperation(path, async () => {
            file = this.outputFiles.get(path) ?? { data: undefined, references: 0 };
            if (!random && capabilities.independentWriteStreams !== true && file.references) throw new FsError("ENOTSUP", { path, message: "Conflicting sequential output descriptors" });
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
            if (canonical) return;
            if (--file.references === 0 && this.outputFiles.get(path) === file) this.outputFiles.delete(path);
          };
          let target;
          try {
            const context = { fs: this.fs, signal: this.signal, cleanupFailurePrioritySignal: this.budget.signal, registerCleanup: (cleanup: () => void | Promise<void>) => io[invocationScope].register(cleanup) };
            if (canonical) bindFileOutputBudget(context, sink => this.budget.sink(sink, this.signal), (chunk, write) => this.budget.writeCounted(chunk, write, this.signal));
            target = await openFileOutput(context, path, canonical ? { flag: append ? "a" : "w", descriptor: true } : append ? "a" : "w", !canonical && random ? incremental : undefined);
          } catch (error) { release(); throw error; }
          const finalize: OutputFinalizer = async completion => {
            try {
              if (this.signal.aborted) await target.abort(this.signal.reason);
              else if ("reason" in completion) await target.abort(completion.reason);
              else {
                try { await target.finish(); }
                catch (error) {
                  this.signal.throwIfAborted();
                  if (completion.status === 0 || target.descriptor && !target.signal.aborted) throw error;
                }
              }
            } finally { release(); }
          };
          let completion: Parameters<OutputFinalizer>[0] | undefined;
          const lifetime = new DescriptorLifetime(() => finalize(completion ?? { status: 0 }));
          const ownerFinalize: OutputFinalizer = value => { completion ??= value; return lifetime.release(); };
          outputs.add(Object.assign(ownerFinalize, target.descriptor ? { descriptor: target.descriptor } : {}));
          const output = canonical ? target.sink : this.budget.sink(target.sink, this.signal);
          if (canonical) budgetedSinks.set(output, { budget: this.budget, write: output.write });
          const binding: Descriptor = { output, lifetime, ...(target.descriptor ? { file: target.descriptor } : {}) };
          await replaceDescriptor(redirect.descriptor, binding);
          if (redirect.operator === "&>") {
            replaced.add(2);
            await replaceDescriptor(2, { ...binding });
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

  async simple(command: Extract<Command, { kind: "simple" }>, state: State, originalIO: IO, inputs: Set<{ close(): void | Promise<void> }>, outputs: Set<OutputFinalizer>, fileShortcut = false, terminal?: IO["terminal"]): Promise<number> {
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
    while ((commandWords[declarationIndex]?.plain === "command" || commandWords[declarationIndex]?.plain === "builtin") && !state.extensions?.builtins.has(commandWords[declarationIndex]!.plain!)) {
      declarationIndex++;
      if (commandWords[declarationIndex]?.plain === "--") declarationIndex++;
    }
    const declarationName = commandWords[declarationIndex]?.plain ?? "";
    const declarationBuiltin = state.extensions?.builtins.get(declarationName);
    const declaration = declarationBuiltin ? declarationBuiltin.expansion === "declaration" : ["export", "local", "readonly"].includes(declarationName);
    const indexedDeclaration = declaration && state.extensions?.syntax.indexedDeclarations?.some(name => name === declarationName) === true;
    const wordValues = await this.valueWords(commandWords, state, originalIO, declaration, indexedDeclaration);
    const words = wordValues.map(shellValueText);
    const special = state.profile === "sh" && (specialBuiltinNames.has(words[0] ?? "") || !!state.extensions?.builtins.get(words[0] ?? "")?.special);
    const inlineInput = command.redirects.some((redirect) => redirect.document || redirect.operator === "<<<");
    const functionCommand = words.length > 0 && state.functions.has(words[0]!);
    const isolatedInlineInput = inlineInput && words.length > 0 && !shellBuiltinNames.has(words[0]!) && !state.extensions?.builtins.has(words[0]!) && !functionCommand;
    if (isolatedInlineInput) state = await cloneState(state, this.signal);
    let io = originalIO;
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
            const fields = await this.valueWord(assignment.value, state, io, false);
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
    if (words.length) stateMonitor(state)?.openOverlay(previous);
    try {
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
      } else io = await this.redirect(command.redirects, state, io, inputs, outputs, isolatedInlineInput, !words.length || shellBuiltinNames.has(words[0]!) || !!state.extensions?.builtins.has(words[0]!) || functionCommand, fileShortcut, command.line ?? 1);
      if (terminal) {
        terminal.io = io;
        await terminal.frame.reconcile(io.descriptors!);
      }
      if (!inlineInput) await assign();
      if (fileShortcut) {
        const input = io.descriptors?.get(command.redirects[0]!.descriptor)?.input;
        if (!input) throw new Error("Bad file descriptor");
        await pipeBytes(input, io.stdout, this.signal);
        return 0;
      }
      return words.length ? await this.dispatch(wordValues[0]!, words.slice(1), state, io, previous, false, wordValues.slice(1), previous) : state.substitutionStatus;
    } catch (error) {
      if (error instanceof Flow) {
        if ((error.kind === "break" || error.kind === "continue" || error.kind === "return") && io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = undefined;
        throw error;
      }
      this.signal.throwIfAborted();
      const original = error instanceof ExecutionFailure ? error.original : error;
      if (special && !(original instanceof ShellLimitError) && !(original instanceof ExpansionFailure) && !(original instanceof Flow) && !(original instanceof ShellSyntaxError)) {
        throw new ExecutionFailure(new FatalCommandFailure(message(original), 1), error instanceof ExecutionFailure ? error.io : io, error instanceof ExecutionFailure ? error.diagnostic : undefined);
      }
      if (error instanceof ExecutionFailure) throw error;
      throw new ExecutionFailure(error, io);
    } finally {
      if (words.length) {
        for (const [key, saved] of previous) await originalIO[invocationScope].cleanup(async () => {
          if (saved.superseded) await this.discardVariable(saved);
          else await restoreVariable(state, key, saved);
        });
        await originalIO[invocationScope].cleanup(() => stateMonitor(state)?.closeOverlay(previous));
      } else for (const saved of previous.values()) saved.heldValue?.release();
      if (isolatedInlineInput) stateMonitor(state)?.closeValues();
    }
  }

  async dispatch(name: ShellValue, args: readonly string[], state: State, io: IO, assignments: Map<string, SavedVariable>, bypassFunctions = false, values: readonly ShellValue[] = args, temporaryEnvironment?: ReadonlyMap<string, SavedVariable>): Promise<number> {
    const scope = io[invocationScope].child();
    const runtime = new Runtime(
      this.fs, this.commands, this.middleware, this.budget,
      AbortSignal.any([this.signal, scope.signal]), this.fileWrites, this.outputFiles, this.commandSignal,
      this.cancellation, this.cancellationState, this.cancellationOwner,
      this.cancellationDepth, this.cancellationMaxDepth, this.outcomeFrame,
    );
    try { return await runtime.dispatchScoped(name, values, state, { ...io, [invocationScope]: scope }, assignments, bypassFunctions, temporaryEnvironment); }
    finally { await scope.close(); }
  }

  private async dispatchScoped(nameValue: ShellValue, values: readonly ShellValue[], state: State, io: IO, assignments: Map<string, SavedVariable>, bypassFunctions: boolean, temporaryEnvironment?: ReadonlyMap<string, SavedVariable>): Promise<number> {
    const { [invocationScope]: scope, ...publicIO } = io;
    const allocation = this.budget.values.scope();
    scope.register(() => allocation.close());
    if (typeof nameValue !== "string") allocation.hold(nameValue);
    const name = shellValueText(nameValue);
    let currentName = nameValue;
    const readName = (): string => shellValueText(currentName);
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
    if (typeof nameValue !== "string") Object.defineProperty(context, "command", {
      configurable: true, enumerable: true, get: readName,
      set(replacement: string) { currentName = replacement; },
    });
    bindFileOutputBudget(context, sink => this.budget.sink(sink, this.signal), (chunk, write) => this.budget.writeCounted(chunk, write, this.signal));
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
      const commandName = Object.getOwnPropertyDescriptor(forwarded, "command")?.get === readName ? currentName : forwarded.command;
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
          let restoredLocals = false;
          const restoreLocals = async (): Promise<void> => {
            if (restoredLocals) return;
            restoredLocals = true;
            for (const [name, previous] of locals) await scope.cleanup(async () => {
              const typed = typedSavedVariables.has(previous);
              await restoreVariable(state, name, previous);
              if (!typed && !previous.readOnly) state.readonlyVariables?.delete(name);
            });
          };
          let primaryFailure = false;
          let outcome: CapturedCancellationOutcome<CommandResult>;
          let checkpointFailure: ExtensionCheckpointFailure | undefined;
          try {
            try {
              await this.extensionEvent("function-enter", state, io, state.status);
              if (await this.extensionEvent("command", state, { ...io, ...context }, state.status, context.command)) outcome = { kind: "return", value: { exitCode: state.status } };
              else {
                const diagnostic = functionDiagnostics.get(body);
                const status = await this.command(body, state, {
                  ...io, ...context, scriptName: body.sourceName ?? io.scriptName ?? "shell",
                  diagnosticOffset: diagnostic?.offset ?? 0,
                  assignmentDiagnosticContext: { name: context.command },
                  functionCommandLines: diagnostic?.lines, diagnosticCommandLines: diagnostic?.lines,
                });
                outcome = { kind: "return", value: { exitCode: await this.finishReturn("function-return", state, { ...io, ...context }, status) } };
              }
            }
            catch (error) {
              if (error instanceof NounsetDiagnosticFailure) throw error;
              if (error instanceof Flow && error.kind === "return") {
                outcome = { kind: "return", value: { exitCode: await this.finishReturn("function-return", state, { ...io, ...context }, error.status, error.previousStatus) } };
              } else {
                if (error instanceof Flow && error.kind === "exit" && state.extensions) {
                  if (error.previousStatus === undefined) await restoreLocals();
                  throw new Flow("exit", await this.beginShellExit(state, { ...io, ...context }, error.status));
                }
                throw error;
              }
            }
          } catch (error) {
            primaryFailure = !(error instanceof Flow) || error instanceof NounsetDiagnosticFailure;
            outcome = { kind: "throw", reason: error };
          } finally {
            await scope.cleanup(async () => {
              try { if (!this.signal.aborted) await this.extensionEvent("function-leave", state, io, state.status); }
              catch (error) {
                if (error instanceof ExtensionCheckpointFailure && !primaryFailure) checkpointFailure = error;
                else throw error;
              }
            });
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
            await restoreLocals();
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
          if (checkpointFailure) {
            this.signal.throwIfAborted();
            throw checkpointFailure;
          }
          if (outcome.kind === "throw") throw outcome.reason;
          return outcome.value;
        }
        if (selected?.kind === "builtin") {
          const extensionBuiltin = state.extensions?.builtins.get(context.command);
          const special = state.profile === "sh" && !bypassFunctions && (specialBuiltinNames.has(context.command) || !!extensionBuiltin?.special);
          if (special) assignments.clear();
          if (extensionBuiltin) {
            const status = validateExitCode(await extensionBuiltin.execute(this.extensionContext(state, { ...io, ...context }, context.command, context.args, context.argumentValues.values)));
            if (special && status !== 0) throw new Flow("exit", status);
            return { exitCode: status };
          }
          if (context.command === "command" || context.command === "builtin" || context.command === "type") return { exitCode: await this.discoveryBuiltin(context, state, io, assignments) };
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
        if (!definition) {
          if (context.command === "bash" || context.command === "sh") return { exitCode: await this.interpreter(context, state, io) };
          if (context.command.includes("/") || state.variables.PATH === undefined && state.pathUnset) return { exitCode: await this.scriptFile(context, state, io, context.command, context.args, true) };
          const target = await this.searchPath(context.command, state);
          if (target !== undefined) return { exitCode: await this.scriptFile(context, state, io, target, context.args, true) };
          const localeValue = (key: string) => temporaryEnvironment?.has(key) && !previous.has(key)
            ? temporaryEnvironment.get(key)!.value ?? "" : state.variables[key] ?? "";
          const displayed = diagnosticCommandName(commandName, byteLocale({
            LC_ALL: localeValue("LC_ALL"), LC_CTYPE: localeValue("LC_CTYPE"), LANG: localeValue("LANG"),
          }), allocation);
          await this.diagnostic({ ...io, ...context }, concatShellValues([displayed, ": command not found"], allocation));
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
    if (implementedBuiltins.has(name) || state.extensions?.builtins.has(name)) matches.push({ kind: "builtin", name });
    else if (this.commands.has(name)) matches.push({ kind: "command", name });
    else if (name === "bash" || name === "sh") matches.push({ kind: "interpreter", name });
    if (state.profile === "sh" && (specialBuiltinNames.has(name) || state.extensions?.builtins.get(name)?.special)) matches.sort((left, right) => Number(right.kind === "builtin") - Number(left.kind === "builtin"));
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
      const targetIndex = context.args.length - args.length;
      const target = args.shift();
      if (target === undefined) return 0;
      const targetValue = getCommandArguments(context).values[targetIndex]!;
      if (builtin && !shellBuiltinNames.has(target) && !state.extensions?.builtins.has(target)) {
        await this.diagnostic({ ...io, ...context }, concatShellValues(["builtin: ", targetValue, ": not a shell builtin"], io[valueScope]));
        return 1;
      }
      this.budget.tick();
      if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
      const restoration = stateMonitor(state)?.restoration(true);
      try { state.depth++; }
      catch (error) { restoration?.close(); throw error; }
      try { return await this.dispatch(targetValue, args, state, { ...io, ...context }, assignments, true, getCommandArguments(context).values.slice(context.args.length - args.length)); }
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

  processState(context: CommandContext, state: State, io: IO, arg0: ShellValue, args: readonly string[]): State {
    if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
    const variables = Object.assign(Object.create(null) as Record<string, string>, context.env, { PWD: state.cwd });
    const exported = new Set(Object.keys(variables));
    variables.OPTIND = "1";
    variables.OPTERR = "1";
    const child: State = {
      extensions: forkExtensions(state.extensions, "process"),
      cwd: state.cwd, variables, exported, functions: new Map(), getopts: { cursor: createGetoptsState(), integer: true },
      directoryStack: { entries: [], bytes: 0 },
      dotglob: false,
      positional: [...args], arg0: shellValueText(arg0), profile: context.command === "sh" ? "sh" : "bash", status: 0, substitutionStatus: 0, depth: state.depth + 1,
      loopDepth: 0, functionDepth: 0, locals: [], pipefail: false, isolated: true,
      errexit: false,
    };
    const values = getCommandArguments(context).values.slice(context.args.length - args.length);
    if (typeof arg0 === "string" && !values.some(value => typeof value !== "string")) return child;
    const tracked = trackState(child, this.budget, io[invocationScope]);
    this.replacePositionals(tracked, values, () => { tracked.positional = [...args]; }, arg0);
    return tracked;
  }

  async interpreter(context: CommandContext, state: State, io: IO, loadedSource?: { path: string; source: string }): Promise<number> {
    const args = [...context.args];
    let commandString = false;
    let standardInput = false;
    let errexit = false;
    while (args.length && /^[+-]/u.test(args[0]!)) {
      const option = args.shift()!;
      if (option === "--" || option === "-") break;
      if (!/^-[cse]+$|^\+e+$/u.test(option)) {
        await writeText(context.stderr, `${context.command}: ${option}: unsupported option; supported flags are -c, -s, -e and +e\n`);
        return 2;
      }
      commandString ||= option.includes("c");
      standardInput ||= option.includes("s");
      if (option.includes("e")) errexit = option.startsWith("-");
    }
    if (!commandString && !standardInput && args.length) return this.scriptFile(context, state, io, args[0]!, args.slice(1), false, errexit, loadedSource);
    const source = commandString ? args.shift() : undefined;
    if (commandString && source === undefined) {
      await writeText(context.stderr, `${context.command}: -c: option requires an argument\n`);
      return 2;
    }
    const arg0 = commandString && args.length ? getCommandArguments(context).values[context.args.length - args.length]! : context.command;
    if (commandString) args.shift();
    const child = this.processState(context, state, io, arg0, args);
    child.errexit = errexit;
    const references = new PipeDescriptorFrame(io[invocationScope]);
    const childIO = isolateIO({ ...io, ...context, execution: { ignoreErrexit: false }, diagnosticLine: 1, diagnosticOffset: 0, assignmentDiagnosticContext: undefined, scriptName: shellValueText(arg0) }, references);
    try {
    if (source !== undefined) {
      this.budget.source(Buffer.byteLength(source));
      return await this.finishShell(child, childIO, await this.runCommandString(source, child, childIO));
    }
    const input = new ShellInput(context.stdin, this.budget, this.signal);
    const descriptors = new Map(childIO.descriptors);
    descriptors.set(0, { ...descriptors.get(0), input });
    const inputIO = { ...childIO, stdin: input, descriptors };
    return await this.finishShell(child, inputIO, await this.runStandardInput(input, child, inputIO));
    } finally { await references.close(); }
  }

  async syntaxFailure(error: ShellSyntaxError, source: string, io: IO, commandString: boolean, includeContext = true): Promise<number> {
    const offset = io.diagnosticOffset ?? 0;
    const line = source.slice(0, error.offset).split("\n").length;
    const prefix = `${io.scriptName ?? "shell"}:${commandString ? " -c:" : ""}`;
    if (error.unclosedQuote) await writeText(io.stderr, `${prefix} line ${offset + error.unclosedQuote.line}: unexpected EOF while looking for matching \`${error.unclosedQuote.quote}'\n`);
    else if (error.offset >= source.length && !/Unterminated|nesting|Unsupported/u.test(error.reason)) {
      const context = includeContext && error.incompleteCommand ? ` from \`${error.incompleteCommand.name}' command on line ${offset + error.incompleteCommand.line}` : "";
      await writeText(io.stderr, `${prefix} line ${offset + source.split("\n").length + Number(!source.endsWith("\n"))}: syntax error: unexpected end of file${context}\n`);
    } else {
      const token = /^[;&|()<>]|^[^\s;&|()<>]+/u.exec(source.slice(error.offset))?.[0] ?? "newline";
      await writeText(io.stderr, `${prefix} line ${offset + line}: syntax error near unexpected token \`${token}'\n${prefix} line ${offset + line}: \`${source.split("\n")[line - 1] ?? ""}'\n`);
    }
    return error.exitCode;
  }

  async runCommandString(source: string, state: State, io: IO): Promise<number> {
    let position = 0;
    let status = 0;
    try {
      do {
        this.signal.throwIfAborted();
        const unit = parseShellUnit(source, position, byteLocale(state.variables), false, state.extensions?.syntax);
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
    let offset = 0;
    let status = 0;
    let lines = 0;
    while (true) {
      if (++lines % 32 === 0) await yieldTurn(this.signal);
      this.signal.throwIfAborted();
      const bytes = await input.sourceLine();
      const eof = bytes === undefined;
      if (bytes) source += this.sourceText(bytes, io.scriptName ?? "shell");
      const unitIO = { ...io, diagnosticOffset: offset };
      try {
        const unit = eof ? parseShellUnit(source, 0, byteLocale(state.variables), false, state.extensions?.syntax) : parseShellInputUnit(source, byteLocale(state.variables), state.extensions?.syntax);
        if (unit) {
          for (const warning of unit.script.warnings ?? []) await writeText(io.stderr, `${io.scriptName}: warning: ${warning}\n`);
          if (unit.script.lists.length) {
            const result = await this.runUnit(unit.script, state, unitIO);
            status = result.exitCode;
            if (result.terminated) return status;
          }
          offset += source.slice(0, unit.next).split("\n").length - 1;
          source = source.slice(unit.next);
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
      bindFileOutputBudget(context, sink => this.budget.sink(sink, runtime.signal), (chunk, write) => this.budget.writeCounted(chunk, write, runtime.signal));
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

  async scriptFile(context: CommandContext, state: State, io: IO, target: string, args: readonly string[], direct: boolean, errexit = false, loadedSource?: { path: string; source: string }): Promise<number> {
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
    try {
      let position = 0;
      do {
        this.signal.throwIfAborted();
        const unit = parseShellUnit(source, position, byteLocale(context.env), false, state.extensions?.syntax);
        units.push(unit.script);
        position = unit.next;
      } while (position < source.length);
    } catch (error) {
      if (!(error instanceof ShellSyntaxError)) throw error;
      const line = source.slice(0, error.offset).split("\n").length;
      await writeText(context.stderr, `${target}: line ${line}: syntax error: ${error.reason}\n`);
      return error.exitCode;
    }
    const child = this.processState(context, state, io, target, args);
    child.errexit = errexit;
    if (direct) child.profile = interpreterProfile ?? state.profile ?? "bash";
    const references = new PipeDescriptorFrame(io[invocationScope]);
    const childIO = isolateIO({ ...io, ...context, execution: { ignoreErrexit: false }, diagnosticLine: 1, diagnosticOffset: 0, assignmentDiagnosticContext: undefined, scriptName: target }, references);
    try {
    let status = 0;
    for (const unit of units) {
      for (const warning of unit.warnings ?? []) await writeText(context.stderr, `${target}: warning: ${warning}\n`);
      if (!unit.lists.length) continue;
      const result = await this.runUnit(unit, child, childIO);
      status = result.exitCode;
      if (result.terminated) break;
    }
    return await this.finishShell(child, childIO, status);
    } finally { await references.close(); }
  }

  async runCurrentText(source: string, state: State, io: IO, fatalSyntax: boolean, syntaxName?: string, byteSource = false, includeSyntaxContext = true): Promise<number> {
    let position = 0;
    let status = 0;
    let executed = false;
    try {
      do {
        this.signal.throwIfAborted();
        const unit = parseShellUnit(source, position, byteLocale(state.variables), byteSource, state.extensions?.syntax);
        for (const warning of unit.script.warnings ?? []) await writeText(io.stderr, `${io.scriptName ?? "shell"}: warning: ${warning}\n`);
        if (unit.script.lists.length) {
          status = await this.inputUnit(unit.script, state, io);
          executed = true;
        }
        position = unit.next;
      } while (position < source.length);
      return status;
    } catch (error) {
      if (!(error instanceof ShellSyntaxError)) throw error;
      const status = await this.syntaxFailure(error, source, syntaxName === undefined ? io : { ...io, scriptName: syntaxName }, false, includeSyntaxContext);
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
      return await this.runCurrentText(source, state, { ...io, diagnosticOffset: (io.diagnosticLine ?? 1) - 1, assignmentDiagnosticContext: { name: context.command } }, special, `${io.scriptName ?? "shell"}: eval`);
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
    let primaryFailure = false;
    let outcome: CapturedCancellationOutcome<number>;
    let leaveFailure: { reason: unknown } | undefined;
    try {
      try {
        await this.extensionEvent("source-enter", state, io, state.status);
        const status = await this.runCurrentText(source, state, { ...io, scriptName: target, diagnosticOffset: 0, diagnosticLine: 1, assignmentDiagnosticContext: undefined }, special);
        outcome = { kind: "return", value: await this.finishReturn("source-return", state, io, status) };
      } catch (error) {
        if (error instanceof Flow && error.kind === "return") outcome = { kind: "return", value: await this.finishReturn("source-return", state, io, error.status, error.previousStatus) };
        else throw error;
      }
    } catch (error) {
      primaryFailure = !(error instanceof Flow) || error instanceof NounsetDiagnosticFailure;
      outcome = { kind: "throw", reason: error instanceof Flow ? error : new NounsetDiagnosticFailure(error) };
    } finally {
      const scope = io[invocationScope];
      try { if (!this.signal.aborted) await this.extensionEvent("source-leave", state, io, state.status); }
      catch (reason) {
        if (primaryFailure) scope.failures.push(reason);
        else leaveFailure = { reason };
      }
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
      } catch (error) { scope.failures.push(error); }
      try { savedPositionals?.close(); }
      catch (error) { scope.failures.push(error); }
      try { restoration?.close(); }
      catch (error) { scope.failures.push(error); }
    }
    if (leaveFailure) {
      this.signal.throwIfAborted();
      throw leaveFailure.reason instanceof Flow ? leaveFailure.reason : new NounsetDiagnosticFailure(leaveFailure.reason);
    }
    if (outcome.kind === "throw") throw outcome.reason;
    return outcome.value;
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
    const child = await cloneState(state, this.signal);
    child.extensions = forkExtensions(state.extensions, "invocation");
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
    const references = new PipeDescriptorFrame(scope);
    const io = isolateIO({
      ...context,
      [invocationScope]: scope,
      stdin: input ?? context.stdin,
      ...(stdinIsDefault === undefined ? {} : { stdinIsDefault }),
      stdout: options.stdout ? this.budget.sink(options.stdout, this.signal) : context.stdout,
      stderr: options.stderr ? this.budget.sink(options.stderr, this.signal) : context.stderr,
    }, references);
    const command: Command = {
      kind: "simple", redirects: [],
      words: [name, ...carrier.values].map((value) => {
        const part: WordPart = { kind: "text", value: shellValueText(value), quoted: true };
        if (typeof value !== "string") invokedValues.set(part, value);
        return { offset: 0, parts: [part] };
      }),
    };
    try { return { exitCode: await this.runCommandIsolated(command, child, io) }; }
    finally {
      try { await this.releaseExtensions(child); }
      finally {
        try { stateMonitor(child)?.closeValues(); await input?.close(); }
        finally { await references.close(); }
      }
    }
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
        else if ([...state.extensions?.options.values() ?? []].some(option => option.flag === flag)) {
          for (const option of state.extensions!.options.values()) if (option.flag === flag) option.enabled = enabled;
        }
        else if (flag === "o" && position === option.length - 1) {
          const name = args[index + 1];
          if (name === undefined) {
            const options = [["errexit", !!state.errexit], ["nounset", !!state.nounset], ["pipefail", state.pipefail], ...[...state.extensions?.options.values() ?? []].map(option => [option.name, option.enabled] as const)] as const;
            for (const [name, active] of options) await writeText(stdout, enabled ? `${name}\t${active ? "on" : "off"}\n` : `set ${active ? "-" : "+"}o ${name}\n`);
          } else {
            if (name === "errexit") state.errexit = enabled;
            else if (name === "nounset") state.nounset = enabled;
            else if (name === "pipefail") state.pipefail = enabled;
            else if (state.extensions?.options.has(name)) state.extensions.options.get(name)!.enabled = enabled;
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
        await writeText(stderr, "set: unsupported shell option; supported forms are +/- e/u clusters, -- arguments and terminal o with pipefail, errexit or nounset\n");
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
      try { value = evaluateArithmetic(prepareArithmetic(args[index]!), variables); }
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
      for (const option of state.extensions?.shoptOptions.values() ?? []) if (!quiet && (!set || option.enabled) && (!unset || !option.enabled)) await writeText(context.stdout, print ? `shopt -${option.enabled ? "s" : "u"} ${option.name}\n` : `${option.name.padEnd(19)}\t${option.enabled ? "on" : "off"}\n`);
      return 0;
    }
    let status = 0;
    for (; index < context.args.length; index++) {
      this.signal.throwIfAborted();
      const name = context.args[index]!;
      const extension = state.extensions?.shoptOptions.get(name);
      if (extension) {
        if (set || unset) extension.enabled = set;
        else {
          if (!quiet) await writeText(context.stdout, print ? `shopt -${extension.enabled ? "s" : "u"} ${name}\n` : `${name.padEnd(19)}\t${extension.enabled ? "on" : "off"}\n`);
          if (!extension.enabled) status = 1;
        }
      } else if (name !== "dotglob") {
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

  private async printDeclarationValue(value: ShellValue, state: State, io: IO): Promise<void> {
    const allocation = this.budget.values.scope();
    try {
      allocation.hold(value);
      const length = shellValueByteLength(value);
      allocation.reserve(length * 8 + 16, 1);
      const bytes = shellValueBytes(value, allocation);
      let text: string | undefined;
      if (!byteLocale(state.variables)) {
        try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
        catch { text = undefined; }
      }
      const ansi = text === undefined ? bytes.some(byte => byte < 32 || byte >= 127) : /[\p{C}\p{Zl}\p{Zp}]/u.test(text);
      let quoted = ansi ? "$'" : '"';
      const controls = ["", "", "", "", "", "", "", "\\a", "\\b", "\\t", "\\n", "\\v", "\\f", "\\r"];
      let visited = 0;
      for (const item of text ?? bytes) {
        if (visited++ % 1024 === 0) { this.budget.cpuCheckpoint(); await yieldTurn(this.signal); }
        const character = typeof item === "number" ? String.fromCharCode(item) : item;
        const code = character.codePointAt(0)!;
        if (ansi && controls[code]) quoted += controls[code];
        else if (ansi && code === 27) quoted += "\\E";
        else if (ansi && (code < 32 || code === 127 || text === undefined && code >= 128 || /[\p{C}\p{Zl}\p{Zp}]/u.test(character))) {
          const encoded = text === undefined ? [code] : new TextEncoder().encode(character);
          for (const byte of encoded) quoted += `\\${byte.toString(8).padStart(3, "0")}`;
        } else if (character === "\\" || (ansi ? character === "'" : character === '"' || character === "$" || character === "`")) quoted += `\\${character}`;
        else quoted += character;
      }
      quoted += ansi ? "'" : '"';
      await writeText(io.stdout, quoted);
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
      const readonlySyntax = state.extensions?.syntax.indexedDeclarations?.includes("readonly") === true;
      let indexedReadonly = false;
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
          const option = declarationArgs.shift()!;
          if (option === "--") break;
          if (!readonlySyntax) {
            if (option !== "-p") { await writeText(stderr, `readonly: ${option}: unsupported option\n`); return 2; }
          } else {
            if (option === "-") { declarationArgs.unshift(option); break; }
            for (const flag of option.slice(1)) {
              if (flag === "a") indexedReadonly = true;
              else if (flag !== "p") {
                await this.diagnostic(context, `readonly: -${flag}: invalid option`);
                await writeText(stderr, "readonly: usage: readonly [-aAf] [name[=value] ...] or readonly -p\n");
                return 2;
              }
            }
          }
        }
      }
      const locals = state.locals.at(-1);
      if (command === "local" && !locals) { await writeText(stderr, "local: not in a function\n"); return 1; }
      let status = 0;
      if (!declarationArgs.length) {
        const names = command === "readonly" ? state.readonlyVariables ?? [] : state.exported;
        if (command === "readonly" && readonlySyntax) {
          const allocation = this.budget.values.scope();
          try {
            const count = state.readonlyVariables?.size ?? 0;
            allocation.reserve(count * 32, count);
            for (const name of [...names].sort()) {
              this.signal.throwIfAborted();
              const binding = arrayStore(state)?.get(name);
              if (indexedReadonly && !binding) continue;
              if (binding) {
                binding.retain();
                try {
                  allocation.reserve(binding.values.size * 16, binding.values.size);
                  await writeText(stdout, `declare -ar ${name}=(`);
                  let first = true;
                  for (const index of [...binding.values.keys()].sort((left, right) => left - right)) {
                    await writeText(stdout, `${first ? "" : " "}[${index}]=`);
                    await this.printDeclarationValue(binding.getValue(index)!, state, context);
                    first = false;
                  }
                  await writeText(stdout, ")\n");
                } finally { await binding.release(); }
              } else {
                await writeText(stdout, `declare -r ${name}`);
                if (Object.hasOwn(state.variables, name)) {
                  await writeText(stdout, "=");
                  await this.printDeclarationValue(stateMonitor(state)?.values.get(name, state.variables[name]!) ?? state.variables[name]!, state, context);
                }
                await writeText(stdout, "\n");
              }
            }
          } finally { allocation.close(); }
          return 0;
        }
        for (const name of names) if (arrayStore(state)?.get(name)) { await this.diagnostic(context, "indexed array: listing indexed bindings is unsupported"); return 2; }
        const prefix = state.profile === "sh" ? command : command === "readonly" ? "declare -r" : "declare -x";
        for (const name of [...names].sort()) await writeText(stdout, `${prefix} ${name}=${JSON.stringify(state.variables[name] ?? "")}\n`);
      }
      const declarationValues = getCommandArguments(context).values;
      const declarationOffset = args.length - declarationArgs.length;
      for (let declarationIndex = 0; declarationIndex < declarationArgs.length; declarationIndex++) {
        const arg = declarationArgs[declarationIndex]!;
        const match = (command === "readonly" && readonlySyntax ? /^([a-zA-Z_][a-zA-Z_0-9]*)(?:\+?=(.*))?$/su : /^([a-zA-Z_][a-zA-Z_0-9]*)(?:=(.*))?$/su).exec(arg);
        if (!match) { await this.diagnostic(context, `${command}: \`${arg}': not a valid identifier`); status = 1; continue; }
        const name = match[1]!;
        const append = command === "readonly" && readonlySyntax && arg[name.length] === "+";
        const assignedValue = (): ShellValue => {
          const original = declarationValues[declarationOffset + declarationIndex]!;
          return typeof original === "string" ? match[2]! : shellValueFromBytes(shellValueBytes(original, context[valueScope]).subarray(name.length + (append ? 2 : 1)), context[valueScope]);
        };
        if (state.readonlyVariables?.has(name) && (match[2] !== undefined || command === "local")) {
          const provenance = readonlySyntax && (command === "readonly" || command === "local" && indexedLocal) ? `${command}: ` : "";
          await this.diagnostic(context, `${provenance}${name}: readonly variable`); status = 1; continue;
        }
        if (arrayStore(state)?.get(name) && command === "export") {
          await this.diagnostic(context, "indexed array: indexed binding cannot be exported"); status = 1; continue;
        }
        if (command === "readonly" && readonlySyntax && (indexedReadonly || match[2]?.startsWith("("))) {
          const assigned = match[2] !== undefined ? assignedValue() : undefined;
          if (match[2]?.startsWith("(")) {
            this.budget.source(shellValueByteLength(assigned!));
            const source = typeof assigned === "string" ? assigned : Buffer.from(shellValueBytes(assigned!, context[valueScope])).toString("latin1");
            const entries = parseCompoundArrayValue(source, byteLocale(state.variables), typeof assigned !== "string", state.extensions?.syntax);
            await this.arrayAssignment({ kind: "compound", name, append, entries }, state, context, "readonly");
          } else if (assigned !== undefined) {
            await this.arrayAssignment({ kind: "element", name, append, index: { decimal: "0" }, value: {
              offset: 0, parts: [{ kind: "text", value: shellValueText(assigned), quoted: true, ...(typeof assigned === "string" ? {} : { byteValue: assigned }) }],
            } }, state, context, "readonly");
          } else if (!arrayStore(state)?.get(name) && Object.hasOwn(state.variables, name) && !state.readonlyVariables?.has(name)) {
            await this.arrayAssignment({ kind: "compound", name, append: true, entries: [] }, state, context, "readonly");
          } else {
            state.readonlyVariables ??= new Set();
            state.readonlyVariables.add(name);
          }
          const previous = assignments.get(name);
          if (previous && locals?.get(name) !== previous) previous.heldValue?.release();
          assignments.delete(name);
          continue;
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
            const value = match[2] !== undefined ? assignedValue() : !saved && !current && Object.hasOwn(state.variables, name) ? stateMonitor(state)?.values.get(name, state.variables[name]!) ?? state.variables[name] : undefined;
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
                const token = await textToken(shadow.owner, assignedValue(), this.signal);
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
          await this.arrayZero(state, name, async () => assignedValue(), append, command === "readonly");
          assignments.delete(name);
          continue;
        }
        if (match[2] !== undefined) {
          this.writeVariable(state, name, append ? concatShellValues([stateMonitor(state)?.values.get(name, state.variables[name] ?? "") ?? state.variables[name] ?? "", assignedValue()], context[valueScope]) : assignedValue());
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
          if (state.readonlyVariables?.has(base)) {
            await this.diagnostic(context, state.extensions?.syntax.indexedDeclarations?.includes("readonly") ? `unset: ${base}: cannot unset: readonly variable` : "indexed array: readonly binding");
            status = 1;
            continue;
          }
          if (selector === "@" || selector === "*") await this.unsetIndexed(state, base, "members");
          else {
            let index: number | undefined;
            try { index = numericIndex(literalIndex(selector, 0)); }
            catch { await this.diagnostic(context, "indexed array: unsupported subscript"); status = 2; continue; }
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
      const line = count === 0 && context.stdin === closedSource ? undefined
        : await input.line(raw, {
          ...(count === undefined ? {} : { count }), ...(delimiter === undefined ? {} : { delimiter }), byteCount: byteLocale(state.variables), exact,
        });
      try {
      if (!names.length) {
        if (state.readonlyVariables?.has("REPLY")) { await this.diagnostic(context, "REPLY: readonly variable"); return 1; }
        this.writeVariable(state, "REPLY", line?.shellValue ?? "");
      }
      else {
        const separators = exact ? "" : stateMonitor(state)?.values.get("IFS", state.variables.IFS ?? " \t\n") ?? state.variables.IFS ?? " \t\n";
        const fields = await line?.fields(separators, names.length) ?? [];
        for (let index = 0; index < names.length; index++) {
          if (state.readonlyVariables?.has(names[index]!)) {
            await this.diagnostic(context, `${names[index]}: readonly variable`);
            return index === names.length - 1 ? 1 : 2;
          }
          await this.assignVariable(state, names[index]!, fields[index]?.value ?? "");
        }
      }
      return line?.terminated ? 0 : 1;
      } finally { line?.release(); }
    }
    if (command === "exit" || command === "return") {
      if (command === "return" && state.functionDepth === 0 && !state.sourceDepth) { await writeText(stderr, "return: not in a function\n"); return 1; }
      if (args.length > 1) { await writeText(stderr, `${command}: too many arguments\n`); return 1; }
      if (args[0] !== undefined && !/^[+-]?\d+$/u.test(args[0])) {
        await writeText(stderr, `${command}: ${args[0]}: numeric argument required\n`);
        throw completedExit(2, command);
      }
      const status = args[0] === undefined ? state.status : Number((BigInt(args[0]) % 256n + 256n) % 256n);
      throw completedExit(status, command, 1, state.status);
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

  private async valueWords(words: readonly Word[], state: State, io: IO, declaration = false, indexedDeclaration = false): Promise<ShellValue[]> {
    const fields: ShellValue[] = [];
    for (const word of words) {
      const assignment = indexedDeclaration ? getArrayAssignment(word) : undefined;
      if (assignment) {
        await this.arrayAssignment(assignment, state, io, undefined, "declaration");
        fields.push(assignment.name);
      } else fields.push(...await this.valueWord(word, state, io, !(declaration && this.assignment(word))));
      if (fields.length > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
    }
    return fields;
  }

  async part(part: Exclude<WordPart, { kind: "text" }>, state: State, io: IO, hereString = false): Promise<string> {
    return shellValueText(await this.valuePart(part, state, io, hereString));
  }

  private async valuePart(part: Exclude<WordPart, { kind: "text" }>, state: State, io: IO, hereString = false, split = false, hereDocument = false): Promise<ShellValue> {
    const binding = part.kind === "variable" ? arrayStore(state)?.get(part.name) : undefined;
    const holding = binding ? requireArrays(state).owner.hold() : undefined;
    const selector = getArraySelector(part);
    const index = selector?.kind === "element" ? numericIndex(selector.index, 4294967295) : 0;
    const token = index === undefined || selector && selector.kind !== "element" ? undefined : binding?.values.get(index)?.text;
    token?.retain();
    try {
      const value = await this.partValue(part, state, io, hereString, split, hereDocument);
      if (binding) await textToken(requireArrays(state).owner, value, this.signal);
      return value;
    } finally { token?.release(); holding?.release(); }
  }

  private async partValue(part: Exclude<WordPart, { kind: "text" }>, state: State, io: IO, hereString: boolean, split: boolean, hereDocument: boolean): Promise<ShellValue> {
    if (part.kind === "failed-substitution") {
      if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
      await writeText(io.stderr, part.diagnostic);
      state.status = state.substitutionStatus = 2;
      return "";
    }
    if (part.kind === "arithmetic") {
      try {
        return String(evaluatePositionalArithmetic(part.expression, {
          positional: state.positional, arg0: state.arg0 ?? "virtual-bash", owner: arrayStore(state)?.owner,
          maximumBytes: this.budget.limits.maxExpansionBytes,
          checkpoint: () => this.signal.throwIfAborted(),
          requireParameter: (name, value) => this.requireParameter(value, name, state, io, part.line),
          limit: () => this.budget.fail("maxExpansionBytes"),
        }, (prepared) => evaluateArithmetic(prepared, this.arithmeticVariables(state, io.diagnosticLine ?? part.line))));
      }
      catch (error) { this.rethrowArithmeticControl(error); throw new ExpansionFailure(message(error), io.diagnosticLine ?? part.line); }
    }
    if (part.kind === "substitution") {
      if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
      this.signal.throwIfAborted();
      if (part.form === "dollar-parenthesis" && state.extensions?.checkpoints.length) await this.extensionCheckpoint("source-input-read", state, io);
      const capture = new Capture();
      const child = await cloneState(state, this.signal);
      child.isolated = true;
      child.extensions = forkExtensions(state.extensions, "substitution");
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
      const reprintedLines = part.sourceLine === undefined ? undefined : functionReprintedLines(part.script);
      const functionCommandLines = reprintedLines && new Map([...reprintedLines].map(([command, line]) => [command, warningLine + line - 1]));
      const references = new PipeDescriptorFrame(io[invocationScope]);
      let captured!: () => void;
      const capturedOutput = new Promise<void>(resolve => { captured = resolve; });
      const lifetime = new DescriptorLifetime(captured);
      const captureIO = isolateIO({
        ...io, substitutionDiagnosticLines,
        diagnosticOffset: (io.diagnosticLine ?? part.line) - (part.sourceLine ?? part.line),
        functionCommandLines, diagnosticCommandLines: undefined, stdout: this.budget.sink(capture, this.signal),
      }, references);
      captureIO.descriptors = new Map(captureIO.descriptors).set(1, { output: captureIO.stdout, lifetime });
      try { state.substitutionStatus = fileShortcut ? await this.runCommandIsolated(command, child, captureIO, true) : await this.run(part.script, child, captureIO); }
      finally {
        try { await references.close(); await lifetime.release(); }
        finally { stateMonitor(child)?.closeValues(); }
      }
      await capturedOutput;
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
    let specialValue: ShellValue | undefined;
    if (part.specialParameter) {
      const hook = state.extensions?.specialParameters.get(part.specialParameter.name);
      if (!hook) throw new TypeError("Missing captured shell special parameter handler");
      specialValue = hook.lookup(this.extensionContext(state, io));
    }
    const selector = getArraySelector(part);
    if (selector) {
      const store = requireArrays(state);
      const binding = store.get(part.name);
      if (selector.kind === "element") {
        const index = numericIndex(selector.index, 4294967295);
        if (index === undefined) throw new ArrayFailure("index outside 0..4294967295");
        const value = binding ? binding.getValue(index) : index === 0 && state.variables[part.name] !== undefined ? stateMonitor(state)?.values.get(part.name, state.variables[part.name]!) ?? state.variables[part.name] : undefined;
        if (part.operator === "-" || part.operator === "+") {
          const alternate = part.operator === "+" ? value !== undefined : value === undefined;
          if (alternate) return concatShellValues(await this.valueWord(part.alternate!, state, io, false, false, hereString, false, undefined, hereDocument), io[valueScope]);
          return part.operator === "+" ? "" : value ?? "";
        }
        this.requireParameter(value === undefined ? undefined : shellValueText(value), `${part.name}[${selector.index}]`, state, io, part.line);
        return part.length ? this.valueLength(value ?? "", state, io) : value ?? "";
      }
      if (part.length) return String(binding?.values.size ?? (state.variables[part.name] === undefined ? 0 : 1));
      const values = await this.arrayMembers(part.name, state, selector.kind === "keys");
      const space = selector.kind === "keys" && (hereDocument || (selector.separator === "@"
        ? !part.quoted && !split || state.variables.IFS === ""
        : !part.quoted && split && state.variables.IFS === ""));
      return this.arrayJoin(store.owner, values, space ? " " : this.ifsSeparator(state, io));
    }
    let value = part.specialParameter ? specialValue === undefined ? undefined : shellValueText(specialValue)
      : part.name === "?" ? String(state.status)
      : part.name === "-" ? `${state.errexit ? "e" : ""}${state.nounset ? "u" : ""}`
      : part.name === "#" ? String(state.positional.length)
      : part.name === "@" || part.name === "*" ? state.positional.join(hereString && (part.name === "@" || !part.quoted) ? " " : Array.from(state.variables.IFS ?? " ")[0] ?? "")
      : /^0+$/u.test(part.name) ? state.arg0 ?? "virtual-bash"
      : /^\d+$/u.test(part.name) ? state.positional[Number(part.name) - 1]
      : part.name === "LINENO" && state.extensions ? String(io.diagnosticLine ?? part.line ?? 1) : this.variable(state, part.name);
    let retained: ShellValue | undefined = part.specialParameter ? specialValue : value;
    if (value !== undefined) {
      if (/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(part.name)) retained = arrayStore(state)?.get(part.name)?.getValue(0) ?? stateMonitor(state)?.values.get(part.name, value) ?? value;
      else if (/^0+$/u.test(part.name)) retained = stateMonitor(state)?.positionals.get("$0", value) ?? value;
      else if (/^[0-9]+$/u.test(part.name)) retained = stateMonitor(state)?.positionals.get(String(Number(part.name) - 1), value) ?? value;
      else if (part.name === "@" || part.name === "*") {
        const separator = hereString && (part.name === "@" || !part.quoted) ? " " : this.ifsSeparator(state, io);
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
        let alternate: string;
        if (operator === "=" && arrayStore(state)?.get(part.name)) {
          alternate = "";
          await this.arrayZero(state, part.name, async () => {
            retained = await this.arrayJoin(requireArrays(state).owner, await this.valueWord(part.alternate!, state, io, false, false, hereString, false, undefined, hereDocument), "");
            return retained;
          });
          value = shellValueText(retained!);
          return part.length ? this.valueLength(retained!, state, io) : retained!;
        }
        retained = concatShellValues(await this.valueWord(part.alternate!, state, io, false, false, hereString, false, undefined, hereDocument), io[valueScope]);
        alternate = shellValueText(retained);
        if (operator === "?") throw new ParameterExpansionFailure(`${part.name}: ${alternate || (part.operator.startsWith(":") ? "parameter null or not set" : "parameter not set")}`, io.diagnosticLine ?? part.line);
        if (operator === "=") {
          if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(part.name)) throw new Error("Cannot assign special parameter");
          this.writeVariable(state, part.name, retained);
        }
        value = alternate;
      } else if (operator === "+") { value = ""; retained = ""; }
    } else this.requireParameter(value, part.name, state, io, part.line);
    return part.length ? this.valueLength(retained ?? "", state, io) : retained ?? "";
  }

  private valueLength(value: ShellValue, state: State, io: IO): string {
    if (byteLocale(state.variables)) return String(shellValueByteLength(value));
    let length = 0;
    if (typeof value === "string") {
      for (let offset = 0; offset < value.length; offset += value.codePointAt(offset)! > 0xffff ? 2 : 1) length++;
    } else {
      const bytes = shellValueBytes(value, io[valueScope]);
      for (let offset = 0; offset < bytes.length; offset += shellCharacterWidth(bytes, offset, false)) length++;
    }
    return String(length);
  }

  private ifsSeparator(state: State, io: IO): ShellValue {
    const text = state.variables.IFS ?? " ";
    const value = stateMonitor(state)?.values.get("IFS", text) ?? text;
    const byteCount = byteLocale(state.variables);
    if (typeof value === "string" && (!byteCount || !value || value.charCodeAt(0) < 128)) return value ? String.fromCodePoint(value.codePointAt(0)!) : "";
    const bytes = shellValueBytes(value, io[valueScope]);
    return bytes.length ? shellValueFromBytes(bytes.subarray(0, shellCharacterWidth(bytes, 0, byteCount)), io[valueScope]) : "";
  }

  async substring(part: Extract<WordPart, { kind: "variable" }>, value: string | undefined, state: State, io: IO): Promise<string> {
    const owner = arrayStore(state)?.get(part.name) ? requireArrays(state).owner : undefined;
    const expression = part.substring!;
    const line = io.diagnosticLine ?? part.line;
    if (!expression.offset.parts.length && !expression.length) throw new ExpansionFailure(`${expression.source}: bad substitution`, line);
    if (value === undefined) return "";
    const limit = this.budget.limits.maxExpansionBytes;
    if (Buffer.byteLength(value) > limit) this.budget.fail("maxExpansionBytes");
    const variables = new Proxy(this.arithmeticVariables(state, line), { get: (target, key) => {
      this.signal.throwIfAborted();
      const value: unknown = Reflect.get(target, key);
      if (typeof value === "string" && Buffer.byteLength(value) > limit) this.budget.fail("maxExpansionBytes");
      return value;
    } });
    const arithmetic = async (word: Word): Promise<{ value: bigint; source: string }> => {
      let source = "";
      let bytes = 0;
      for (const entry of word.parts) {
        this.signal.throwIfAborted();
        const text = entry.kind === "text" ? entry.value : await this.part(entry, state, io);
        bytes += Buffer.byteLength(text);
        if (bytes > limit) this.budget.fail("maxExpansionBytes");
        owner?.reserve({ metadata: 32, payload: bytes, work: text.length + 4 });
        source += text;
      }
      this.signal.throwIfAborted();
      try { return { value: evaluateArithmetic(prepareArithmetic(source), variables), source }; }
      catch (error) {
        this.rethrowArithmeticControl(error);
        throw new ExpansionFailure(`${part.name}: ${message(error)}`, line);
      }
    };
    const offsetExpression = await arithmetic(expression.offset);
    owner?.reserve({ metadata: 128 + value.length * 64, payload: Buffer.byteLength(value), allocatedSlots: value.length, work: value.length + 8 });
    const characters = byteLocale(state.variables) ? undefined : Array.from(value);
    const bytes = characters ? undefined : Buffer.from(value);
    const size = BigInt(characters?.length ?? bytes!.byteLength);
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
    owner?.reserve({ metadata: 96 + value.length * 32, payload: Buffer.byteLength(value) * 3, allocatedSlots: value.length, work: value.length + 7 });
    if (characters) return characters.slice(Number(offset), Number(end)).join("");
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes!.subarray(Number(offset), Number(end))); }
    catch { throw new ExpansionFailure("substring expansion splits a UTF-8 character in a byte locale", line); }
  }

  async parameterPattern(part: Extract<WordPart, { kind: "variable" }>, text: string, state: State, io: IO, hereString: boolean): Promise<string> {
    const owner = arrayStore(state)?.get(part.name) ? requireArrays(state).owner : undefined;
    const limit = this.budget.limits.maxExpansionBytes;
    if (Buffer.byteLength(text) > limit) this.budget.fail("maxExpansionBytes");
    const patternFields = await this.word(part.alternate!, state, io, false, true, hereString);
    const pattern = owner ? await this.arrayJoin(owner, patternFields, "") : patternFields.join("");
    owner?.reserve({ metadata: 128 + text.length * 64, payload: Buffer.byteLength(text), allocatedSlots: text.length, work: text.length + 8 });
    const characters = Array.from(text);
    const slice = (start: number, end = characters.length): string => {
      owner?.reserve({ metadata: 96 + (end - start) * 32, payload: (end - start) * 4, allocatedSlots: end - start, work: end - start + 7 });
      return characters.slice(start, end).join("");
    };
    const work = { remaining: Math.min(Number.MAX_SAFE_INTEGER, limit * 4 + 1024), signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") };
    const matches = await compilePattern(pattern, work);
    let attempts = 0;
    const match = async (start: number, end: number): Promise<boolean> => {
      work.remaining -= end - start + 1;
      if (work.remaining < 0) work.exhausted();
      if (++attempts % 256 === 0) await yieldTurn(this.signal);
      this.signal.throwIfAborted();
      if (owner) await owner.ledger.checkpoint(this.signal, end - start + 1);
      return matches(slice(start, end));
    };
    const operator = part.operator!;
    if (!operator.startsWith("/")) {
      const longest = operator.length === 2;
      for (let length = longest ? characters.length : 0; longest ? length >= 0 : length <= characters.length; length += longest ? -1 : 1) {
        const prefix = operator.startsWith("#");
        if (await match(prefix ? 0 : characters.length - length, prefix ? length : characters.length)) return prefix ? slice(length) : slice(0, characters.length - length);
      }
      return text;
    }
    const replacements: { value: string; quoted: boolean }[] = [];
    owner?.reserve({ metadata: 64, work: 3 });
    let replacementBytes = 0;
    for (const [index, entry] of (part.replacement?.parts ?? []).entries()) {
      let value = entry.kind === "text" ? entry.value : await this.part(entry, state, io, hereString);
      if (index === 0 && !entry.quoted && /^~(?:\/|$)/u.test(value)) value = (state.variables.HOME ?? "~") + value.slice(1);
      replacementBytes += Buffer.byteLength(value);
      if (replacementBytes > limit) this.budget.fail("maxExpansionBytes");
      owner?.reserve({ metadata: 64, payload: Buffer.byteLength(value), allocatedSlots: 1, work: 5 });
      replacements.push({ value, quoted: entry.quoted });
    }
    if (!pattern && operator !== "/#" && operator !== "/%") return text;
    let result = "";
    let resultBytes = 0;
    const append = (value: string): void => {
      resultBytes += Buffer.byteLength(value);
      if (resultBytes > limit) this.budget.fail("maxExpansionBytes");
      owner?.reserve({ metadata: 32, payload: resultBytes, work: value.length + 4 });
      result += value;
    };
    let position = 0;
    while (position <= characters.length) {
      let found = false;
      for (let start = position; start <= characters.length; start++) {
        if (operator === "/#" && start !== 0) break;
        for (let end = characters.length; end >= start; end--) {
          if (operator === "/%" && end !== characters.length) break;
          if (!await match(start, end)) continue;
          append(slice(position, start));
          const matched = slice(start, end);
          for (const replacement of replacements) {
            if (replacement.quoted) append(replacement.value);
            else {
              owner?.reserve({ metadata: 64 + replacement.value.length * 64, payload: Buffer.byteLength(replacement.value), allocatedSlots: replacement.value.length, work: replacement.value.length + 4 });
              const pieces = replacement.value.split("&");
              for (const [index, piece] of pieces.entries()) { if (index) append(matched); append(piece); }
            }
          }
          position = end;
          found = true;
          if (operator !== "//" || end === characters.length) { append(slice(end)); return result; }
          if (end === start) { append(characters[position]!); position++; }
          break;
        }
        if (found) break;
      }
      if (!found) { append(slice(position)); break; }
    }
    return result;
  }

  async word(word: Word, state: State, io: IO, split = true, pattern = false, hereString = false, conditionalPattern = false, regexAppend?: (text: string, literal: boolean) => void): Promise<string[]> {
    return (await this.valueWord(word, state, io, split, pattern, hereString, conditionalPattern, regexAppend)).map(shellValueText);
  }

  private async valueWord(word: Word, state: State, io: IO, split = true, pattern = false, hereString = false, conditionalPattern = false, regexAppend?: (text: string, literal: boolean) => void, hereDocument = false): Promise<ShellValue[]> {
    const arrayOwned = word.parts.some(part => part.kind === "variable" && (getArraySelector(part) !== undefined || arrayStore(state)?.get(part.name) !== undefined));
    const owner = arrayOwned ? requireArrays(state).owner : undefined;
    const holding = owner?.hold();
    try {
    if (owner) await this.prepareArrayObservers(state, owner);
    owner?.reserve({ metadata: 128 + word.parts.length * 32, allocatedSlots: word.parts.length + 1, work: word.parts.length + 5 });
    const fields: { value: string; fragments: ShellValue[]; bytes: boolean; pattern: string; present: boolean }[] = [{ value: "", fragments: [], bytes: false, pattern: "", present: false }];
    let expansionBytes = 0;
    const append = (value: ShellValue, glob: boolean, present: boolean) => {
      const text = shellValueText(value);
      const size = shellValueByteLength(value);
      if (size > this.budget.limits.maxExpansionBytes - expansionBytes) this.budget.fail("maxExpansionBytes");
      expansionBytes += size;
      regexAppend?.(text, !glob);
      const field = fields.at(-1)!;
      if (owner) owner.reserve({ payload: exactSum(Buffer.byteLength(field.value) + size, Buffer.byteLength(field.pattern) + (glob ? size : size * 2)), metadata: 64, work: text.length + 8 });
      if (typeof value !== "string" || field.bytes) {
        io[valueScope]?.reserve(32 * (field.bytes ? 1 : field.fragments.length + 1), field.bytes ? 1 : field.fragments.length + 1);
        if (typeof value !== "string") io[valueScope]?.hold(value);
        field.bytes = true;
      }
      field.fragments.push(value);
      field.value += text;
      field.pattern += glob ? text : text.replace(conditionalPattern ? /[\\*?[\]\-^()|+!@]/gu : /[\\*?[\]\-^]/gu, "\\$&");
      field.present ||= present;
    };
    const parts = word.parts.map((part) => ({ part, splitText: false }));
    for (let index = 0; index < parts.length; index++) {
      const { part, splitText } = parts[index]!;
      const quotedPresence = part.quoted && !(arrayOwned && isQuoteMarker(part));
      const selector = getArraySelector(part);
      if (part.kind === "variable" && ["-", "+", ":-", ":+"].includes(part.operator ?? "") && /^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(part.name)) {
        let value: ShellValue | undefined = this.variable(state, part.name);
        if (selector?.kind === "element") {
          const index = numericIndex(selector.index, 4294967295);
          if (index === undefined) throw new ArrayFailure("index outside 0..4294967295");
          const binding = arrayStore(state)?.get(part.name);
          value = binding ? binding.getValue(index) : index === 0 ? value : undefined;
        }
        const missing = value === undefined || (part.operator!.startsWith(":") && value === "");
        if (part.operator!.endsWith("+") ? !missing : missing) {
          const alternate = part.alternate!.parts.map((entry) => ({ part: copyArraySelector(entry, { ...entry, quoted: entry.quoted || part.quoted }), splitText: true }));
          if (!alternate.length && part.quoted) append("", false, true);
          parts.splice(index + 1, 0, ...alternate);
          continue;
        }
      }
      if (part.kind === "variable" && selector && selector.kind !== "element" && !part.length && split
        && (selector.kind === "members" ? !part.quoted || selector.separator === "@" : selector.separator === "@" && (part.quoted || state.variables.IFS === ""))) {
        const members = await this.arrayMembers(part.name, state, selector.kind === "keys");
        for (let position = 0; position < members.length; position++) {
          if (position > 0) {
            owner?.reserve({ metadata: 32, allocatedSlots: 1, work: 3 });
            fields.push({ value: "", fragments: [], bytes: false, pattern: "", present: false });
          }
          const value = members[position]!;
          if (part.quoted || state.variables.IFS === "") append(value, !part.quoted, part.quoted || shellValueByteLength(value) > 0);
          else {
            const separators = stateMonitor(state)?.values.get("IFS", state.variables.IFS ?? " \t\n") ?? state.variables.IFS ?? " \t\n";
            let boundary = false;
            for (const piece of this.splitValue(value, separators, io, byteLocale(state.variables))) {
              if (piece.separator) {
                if (!piece.whitespace) {
                  fields.at(-1)!.present = true;
                  owner?.reserve({ metadata: 32, allocatedSlots: 1, work: 3 });
                  fields.push({ value: "", fragments: [], bytes: false, pattern: "", present: false });
                } else if (fields.at(-1)!.present) boundary = true;
              } else {
                if (boundary) { owner?.reserve({ metadata: 32, allocatedSlots: 1, work: 3 }); fields.push({ value: "", fragments: [], bytes: false, pattern: "", present: false }); }
                boundary = false;
                append(piece.value, true, true);
              }
              await owner!.ledger.checkpoint(this.signal);
            }
            if (boundary) { owner?.reserve({ metadata: 32, allocatedSlots: 1, work: 3 }); fields.push({ value: "", fragments: [], bytes: false, pattern: "", present: false }); }
          }
        }
      } else if (part.kind === "text" && !splitText) {
        let value: ShellValue = invokedValues.get(part) ?? part.byteValue ?? part.value;
        if (typeof value === "string" && index === 0 && !part.quoted && /^~(?:\/|$)/u.test(value)) value = (state.variables.HOME ?? "~") + value.slice(1);
        append(value, !part.quoted, quotedPresence || shellValueByteLength(value) > 0);
      } else if (part.kind === "variable" && part.name === "@" && part.quoted && !part.operator && split) {
        for (let position = 0; position < state.positional.length; position++) {
          if (position > 0) fields.push({ value: "", fragments: [], bytes: false, pattern: "", present: false });
          append(stateMonitor(state)?.positionals.get(String(position), state.positional[position]!) ?? state.positional[position]!, false, true);
        }
        if (state.positional.length === 0 && word.parts.every((entry) => (entry.kind === "text" && entry.value === "") || entry === part)) fields[0]!.present = false;
      } else {
        const value = part.kind === "text" ? part.byteValue ?? part.value : await this.valuePart(part, state, io, hereString, split, hereDocument);
        if (part.quoted || !split || state.variables.IFS === "") append(value, !part.quoted, quotedPresence || !split || shellValueByteLength(value) > 0);
        else {
          const separators = stateMonitor(state)?.values.get("IFS", state.variables.IFS ?? " \t\n") ?? state.variables.IFS ?? " \t\n";
          let boundary = false;
          const pieces = this.splitValue(value, separators, io, byteLocale(state.variables));
          for (const piece of pieces) {
            if (piece.separator) {
              if (!piece.whitespace) {
                fields.at(-1)!.present = true;
                fields.push({ value: "", fragments: [], bytes: false, pattern: "", present: false });
              } else if (fields.at(-1)!.present) boundary = true;
            } else {
              if (boundary) fields.push({ value: "", fragments: [], bytes: false, pattern: "", present: false });
              boundary = false;
              append(piece.value, true, true);
            }
          }
          if (boundary) fields.push({ value: "", fragments: [], bytes: false, pattern: "", present: false });
        }
      }
      if (fields.length > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
      if (owner) await owner.ledger.checkpoint(this.signal);
    }
    const result: ShellValue[] = [];
    let resultBytes = 0;
    for (const field of fields) {
      if (!field.present && split) continue;
      const assembled = concatShellValues(field.fragments, io[valueScope]);
      const projection = shellValueText(assembled);
      const expanded = split ? await this.glob(projection, field.pattern, state) : [pattern ? field.pattern : projection];
      for (const text of expanded) {
        const value = !pattern && expanded.length === 1 && text === projection ? assembled : text;
        const size = shellValueByteLength(value);
        if (size > this.budget.limits.maxExpansionBytes - resultBytes) this.budget.fail("maxExpansionBytes");
        resultBytes += size;
        owner?.reserve({ metadata: 32, allocatedSlots: 1, work: 3 });
        result.push(value);
      }
      if (result.length > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
    }
    return result;
    } finally { holding?.release(); }
  }

  private *splitValue(value: ShellValue, separators: ShellValue, io: IO, byteCount: boolean): Generator<{ value: ShellValue; separator: boolean; whitespace: boolean }> {
    if (typeof value === "string" && typeof separators === "string" && !byteCount) {
      for (const character of value) yield { value: character, separator: separators.includes(character), whitespace: " \t\n".includes(character) };
      return;
    }
    const bytes = shellValueBytes(value, io[valueScope]);
    const delimiters = shellValueBytes(separators, io[valueScope]);
    const key = (input: Uint8Array, offset: number, length: number): number => {
      let result = 1;
      for (let index = offset; index < offset + length; index++) result = result * 257 + input[index]!;
      return result;
    };
    const keys = new Set<number>();
    for (let offset = 0; offset < delimiters.length;) {
      const length = shellCharacterWidth(delimiters, offset, byteCount);
      const token = key(delimiters, offset, length);
      if (!keys.has(token)) { io[valueScope]?.reserve(32, 1); keys.add(token); }
      for (let index = offset; index < offset + length; index++) {
        const byteKey = key(delimiters, index, 1);
        if (!keys.has(byteKey)) { io[valueScope]?.reserve(32, 1); keys.add(byteKey); }
      }
      offset += length;
    }
    let start = 0;
    for (let offset = 0; offset < bytes.length;) {
      const length = shellCharacterWidth(bytes, offset, byteCount);
      if (keys.has(key(bytes, offset, length))) {
        if (start < offset) yield { value: shellValueFromBytes(bytes.subarray(start, offset), io[valueScope]), separator: false, whitespace: false };
        yield { value: "", separator: true, whitespace: length === 1 && (bytes[offset] === 32 || bytes[offset] === 9 || bytes[offset] === 10) };
        start = offset + length;
      }
      offset += length;
    }
    if (start < bytes.length) yield { value: start === 0 ? value : shellValueFromBytes(bytes.subarray(start), io[valueScope]), separator: false, whitespace: false };
  }

  private positionalValues(state: State): ShellValue[] {
    return state.positional.map((text, index) => stateMonitor(state)?.positionals.get(String(index), text) ?? text);
  }

  private replacePositionals(state: State, values: readonly ShellValue[], action?: () => void, arg0?: ShellValue): void {
    const publish = action ?? (() => { state.positional = values.map(shellValueText); });
    const store = stateMonitor(state)?.positionals;
    if (store) {
      const zero = arg0 ?? store.get("$0", state.arg0 ?? "virtual-bash");
      const entries = values.map((value, index) => [String(index), value] as const);
      if (typeof zero !== "string") entries.push(["$0", zero]);
      store.replace(entries, publish);
    }
    else publish();
  }

  private admitArguments(values: readonly ShellValue[], allocation: ValueScope): CommandArguments {
    if (!values.some(value => typeof value !== "string")) return createCommandArguments(values);
    if (values.length > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
    for (const value of values) if (typeof value !== "string") allocation.hold(value);
    return createCommandArguments(values, allocation);
  }

  async arrayMembers(name: string, state: State, keys = false): Promise<ShellValue[]> {
    const store = requireArrays(state);
    const holding = store.owner.hold();
    try {
    const binding = store.get(name);
    store.owner.reserve({ metadata: 64, work: 3 });
    if (!binding) {
      const text = state.variables[name];
      const value = text === undefined ? undefined : keys ? "0" : stateMonitor(state)?.values.get(name, text) ?? text;
      if (value === undefined) return [];
      store.owner.reserve({ metadata: 32, allocatedSlots: 1, work: 3 });
      await textToken(store.owner, value, this.signal);
      return [value];
    }
    binding.retain();
    try {
      const indices = await binding.indices(store.owner, this.signal);
      const values: ShellValue[] = [];
      for (const index of indices) {
        store.owner.reserve({ metadata: 32, allocatedSlots: 1, work: 4 });
        const value = keys ? String(index) : binding.getValue(index)!;
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
