import type { InternalErrorHandler } from "../contracts/command.js";
import { PublicDiagnostic, publicDiagnosticMessage } from "../diagnostics.js";
import { workerRuntimeContexts, shellDescriptorAdmissions } from "../worker/runtime-context.js";
import { captureIgnoredTrapSignals } from "./trap.js";
import { writeDiagnostic } from "../escaping.js";
import { cancelTurn, hasYieldCheckpoint, inheritYieldCheckpoint, monotonicNow, registerInternalYieldCheckpoint, runYieldCheckpoint, scheduleTurn, yieldTurn, type TurnHandle } from "../contracts/yield.js";
import {
  ACCESS_MODES, FsError, composeMiddleware, createBytePipe, pipeBytes, resolvePath, validateExitCode, writeBytes, writeText,
} from "../contracts/index.js";
import type {
  ByteSink, ByteSource, CommandContext, CommandDefinition, CommandInvoker, CommandRegistry, CommandResult, FileSystem, Middleware,
} from "../contracts/index.js";
import { createBcCommands } from "../commands/bc/index.js";
import { createSpongeCommands } from "../commands/sponge/index.js";
import { createFdCommands } from "../commands/fd/index.js";
import { createLessCommands } from "../commands/less/index.js";
import { concatShellValues, shellValueByteLength, shellValueBytes, shellValueFromBytes, shellValueText } from "../contracts/value.js";
import type { ShellValue, ValueReservation } from "../contracts/value.js";
import { createCommandArguments, getCommandArguments } from "../contracts/command.js";
import type { CommandArguments } from "../contracts/command.js";
import { ValueArena } from "./value-state.js";
import type { HeldValue, ValueScope, ValueStore } from "./value-state.js";
import type { AndOr, Command, HereDocument, Pipeline, Redirect, Script, Word, WordPart } from "./parser.js";
import { parseArithmeticExpansion, parseArraySubscript, compoundEntryWords, HereDocumentSyntaxError, functionReprintedLines, hereDocumentWords, parseCompoundArrayValue, parseShellInputUnit, parseShellUnit } from "./parser.js";
import { ShellLimitError, ShellSyntaxError } from "./types.js";
import type { ShellCommandContext, ShellInvokeOptions, ShellLimits } from "./types.js";
import { resolveCommandLimits } from "../commands/limits.js";
import { forkExtensions } from "./extensions.js";
import type { PreparedShellChild, ShellBindingReference, ShellBindingResult, ShellChildPreparation, ShellExecutionCheckpoint, ShellExtensionBindings, ShellExtensionContext, ShellExtensionEvent, ShellExtensionInput, ShellExtensionState, ShellIndexedWriter } from "./extensions.js";
import { prepareBytesInput, prepareFileInput, ShellInput } from "./input.js";
import { observeDescriptor, PipeDescriptorFrame, pipeObservation, type PipeDescriptorReference } from "./descriptors.js";
import { SourceLineIndex } from "./source-line-index.js";
import { isCleanAbsolutePath, retargetScopedFileSystem, scopeFileSystem, tryGetMemoryDirectoryEntryNamesSync, tryMkdirMemorySync, tryOpenMemoryRedirectHandleSync, tryResolveMemoryDevicePath, tryRmRfMemorySync, tryWriteMemoryFileInDirSync, tryWriteMemoryFileSync, type MemoryRedirectHandle } from "@poe-code/safe-fs/core";
import { collectPureReadOnlySmiNames, compilePureSmiProgram, evalCompiledSmi, evaluateArithmetic, evaluateArithmeticReferences, evaluateArithmeticSync, evaluateArithmeticSyncNonZero, evaluateArithmeticSyncString, fastSafeInt, intToStr, isSafeSmiProgram, prepareArithmetic, runIntArithForLoop, runIntForLoop, sharedLoopIntRegs, type ArithmeticProgram, type ArithmeticReferences, type CompiledSmiExpr } from "./arithmetic.js";
import { ParseBudget } from "./parse-budget.js";
import { BraceExpansionFailure, expandBraces, tryFastExpandBraceRange } from "./brace-expansion.js";
import { expandTildes } from "./tilde-expansion.js";
import { evaluatePositionalArithmetic } from "./arithmetic-parameters.js";
import { compilePattern, compilePatternBoundaries, matchesPattern } from "./pattern.js";
import { nextCodePointOffset, scanString, stringCheckpoint } from "./string-operations.js";
import { selectMenu } from "./select-menu.js";
import type { StringWork } from "./string-operations.js";
import { byteLocale, cCollation, utf8Locale } from "./locale.js";
import { diagnosticCommandName } from "./diagnostic-name.js";
import { isWellFormedString, trimParameter } from "./parameter-trim.js";
import { ownedShellSource, type OwnedShellSource } from "./source-value.js";
import { functionDisplay } from "./display.js";
import { ConditionalUnsupported, evaluateConditional } from "./conditional.js";
import { invocationScope, throwCleanupFailures, InvocationScope } from "./cleanup.js";
import { bindFileOutputBudget, openFileOutput } from "../contracts/filesystem-output.js";
import type { CommandFileDescriptor } from "../contracts/filesystem-descriptor.js";
import { outputFailure } from "../contracts/io.js";
import { executionCommands } from "../commands/execution.js";
import { defaultEchoExecutors, formatPrintf, printfCommand, tryFastPrintf } from "../commands/basic.js";
import { defaultMkdirExecutors, defaultRmExecutors } from "../commands/filesystem.js";
export const customRegisteredCommands = new WeakSet<object>();
export const customRegisteredRegistries = new WeakSet<CommandRegistry>();
import { defaultPredicateExecutors, tryFastPredicate } from "../commands/predicates.js";
import { builtInDirectContextExecutors, pathOf, RESOLVED_EXIT_ONE, RESOLVED_EXIT_ZERO, UsageError } from "../commands/internal.js";
import { cloneGetoptsState, createGetoptsInput, createGetoptsState, GetoptsError, getoptsInputAllocationSize, scanGetopts, withGetoptsIndex } from "./getopts.js";
import type { GetoptsState } from "./getopts.js";
import {
  activateChildCancellation, admitCancellationSubscriptionCapacity, prepareChildCancellation, selectRuntimeCancellationOutcome, subscribeCancellationOwner, unsubscribeCancellationOwner,
} from "./cancellation.js";
import type {
  CancellationAdmissionSnapshot, CancellationBoundary, CancellationControlOriginInput, CancellationOrigin,
  CancellationOwnerSubscriber, CancellationReport, CancellationSelection, CapturedCancellationOutcome, PreparedChildCancellation,
} from "./cancellation.js";
import { variablePresence } from "../commands/variable-presence.js";
import { getArrayAssignment, getArraySelector, copyArraySelector, numericIndex, literalIndex, stringIndex, isQuoteMarker, prefixNameQuoteGroups, setArraySelector } from "./arrays/syntax.js";
import type { ArrayAssignment } from "./arrays/syntax.js";
import { ArrayFailure, ArrayOwner, exactSum } from "./arrays/ledger.js";
import { controlNames, IndexedBinding, textToken, valueToken } from "./arrays/bindings.js";
import { collectMapfile, mapfileOptions, MapfileUsageError } from "./mapfile.js";
import { arrayStore, ensureStateMonitor, guestArrays, monitorSymbol, requireArrays, snapshotState, stateMonitor, trackState, trySnapshotStateSync } from "./arrays/state.js";
import { pipelineStatusTarget, publishPipelineStatus } from "./pipestatus.js";
import type { Restoration } from "./arrays/state.js";
import type { Admission } from "./arrays/ledger.js";
import type { BindingWatch, OwnedText, PreparedBinding } from "./arrays/bindings.js";
import { EreProfileLimitError, EreSyntaxError, EreUnsupportedError } from "../commands/regex-execution/ere/errors.js";
import { EreLedger } from "../commands/regex-execution/ere/limits.js";
import { compileEre } from "../commands/regex-execution/ere/syntax.js";
import { matchEre } from "../commands/regex-execution/ere/matcher.js";
import type { EreFragment } from "../commands/regex-execution/ere/types.js";
import { PathLookup, pathTargets } from "./path-lookup.js";
import { transformParameter } from "./parameter-transforms.js";
import { creationFileSystem, umaskBuiltin } from "./umask.js";
import { isIdlePortableTrapInstance } from "./trap.js";

function hasActiveExtensions(state: State): state is State & { extensions: ShellExtensionState } {
  const ext = state.extensions;
  if (!ext) return false;
  if ((ext as { isIdleTrapState?: boolean }).isIdleTrapState) return false;
  if (ext.entries.length > 1 || ext.checkpoints.length > 0) return true;
  const first = ext.entries[0];
  return first ? !isIdlePortableTrapInstance(first.instance) : false;
}

const memberPatternOperators = ["#", "##", "%", "%%", "/", "//", "/#", "/%", "^", "^^", ",", ",,"];
const defaultParameterOperators = ["-", "+", "=", "?", ":-", ":+", ":=", ":?"];

async function signedLong(argument: string, budget: Budget, signal: AbortSignal): Promise<bigint | "overflow" | undefined> {
  const checkpoint = async (): Promise<void> => {
    budget.cpuCheckpoint();
    signal.throwIfAborted();
    await yieldTurn(signal);
  };
  let start = 0, end = argument.length;
  while (start < end && " \t\n\r\v\f".includes(argument[start]!)) {
    if (start % 1024 === 0) await checkpoint();
    start++;
  }
  while (end > start && " \t\n\r\v\f".includes(argument[end - 1]!)) {
    if (end % 1024 === 0) await checkpoint();
    end--;
  }
  const negative = argument[start] === "-";
  if (negative || argument[start] === "+") start++;
  if (start === end) return undefined;
  let value = 0n;
  let overflow = false;
  for (let index = start; index < end; index++) {
    if (index % 1024 === 0) await checkpoint();
    const digit = argument.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return undefined;
    if (overflow) continue;
    value = value * 10n + BigInt(digit);
    // Keep arithmetic bounded even for arbitrarily long decimal arguments.
    overflow = value > (negative ? 9223372036854775808n : 9223372036854775807n);
  }
  if (overflow) return "overflow";
  return negative ? -value : value;
}

type ResolvedShellLimits = Required<Omit<ShellLimits, "commandLimits">> & Pick<ShellLimits, "commandLimits">;

export const defaultLimits: ResolvedShellLimits = {
  maxParseUnits: Infinity,
  maxInputBytes: Infinity,
  maxOutputBytes: Infinity,
  maxCommands: Infinity,
  maxFileSystemOperations: Infinity,
  maxPathComponents: Infinity,
  maxPathnameComponents: Infinity,
  maxRedirects: Infinity,
  maxPipelineStages: Infinity,
  maxLoopIterations: Infinity,
  maxSubstitutionDepth: Infinity,
  maxSourceBytes: Infinity,
  maxExpansionFields: Infinity,
  maxExpansionBytes: Infinity,
  maxWallClockMs: Infinity,
  maxCpuMs: Infinity,
  pipeHighWaterMark: 64 * 1024,
};

const shellBuiltinNames = new Set([
  ":", "true", "false", "pwd", "cd", "set", "shift", "export", "local", "unset", "read", "declare", "typeset", "mapfile", "readarray", "umask",
  "exit", "return", "break", "continue", "command", "builtin", "type", "readonly", "echo", "printf", "test", "[", ".", "source", "eval", "getopts", "let", "pushd", "dirs", "popd", "shopt", "hash",
]);

const implementedBuiltins = new Set([...shellBuiltinNames].filter(name => !["echo", "printf", "test", "["].includes(name)));
const extensionExitFailures = new WeakMap<ShellExtensionState, { reason: unknown }>();
const specialBuiltinNames = new Set([":", ".", "break", "continue", "eval", "exit", "export", "readonly", "return", "set", "shift", "unset"]);
const defaultCommandPath = "/bin:/usr/bin";
const zeroPositionKey = "-1";
const unsupportedSetOptionNames = new Set([
  "emacs", "errtrace", "functrace", "hashall", "histexpand", "history",
  "ignoreeof", "interactive-comments", "keyword", "monitor", "nolog",
  "notify", "onecmd", "physical", "posix", "privileged", "verbose", "vi", "xtrace",
]);
const shellKeywords = new Set(["if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac", "in", "function", "{", "}", "!", "[[", "]]", "time", "select", "coproc"]);
type Discovery = { kind: "keyword" | "function" | "builtin" | "command" | "interpreter" | "file"; name: string };
const commandSpellingSymbol = Symbol("safe-bash.commandSpelling");

function commandSpelling(command: Extract<Command, { kind: "simple" | "arithmetic" | "conditional" }>): string {
  const cached = (command as unknown as Record<symbol, string | undefined>)[commandSpellingSymbol];
  if (cached !== undefined) return cached;
  let computed: string;
  if (command.kind === "arithmetic") computed = `((${command.source}))`;
  else if (command.kind === "conditional") computed = `[[${command.source}]]`;
  else if (command.redirects.length === 0) {
    if (command.words.length === 1) {
      const w0 = command.words[0]!;
      computed = w0.spelling ?? w0.plain ?? "";
    } else {
      computed = command.words.map(word => word.spelling ?? word.plain ?? "").join(" ");
    }
  } else {
    const redirects = command.redirects.map(redirect => {
      const target = redirect.target.spelling ?? redirect.target.plain ?? "";
      if (redirect.operator === ">&" || redirect.operator === "<&") return `${redirect.descriptor}${redirect.operator}${target}`;
      const implicit = redirect.operator.startsWith("<") ? 0 : 1;
      return `${redirect.descriptor === implicit ? "" : redirect.descriptor}${redirect.operator} ${target}`;
    });
    computed = [...command.words.map(word => word.spelling ?? word.plain ?? ""), ...redirects].join(" ");
  }
  if (Object.isExtensible(command)) {
    (command as unknown as Record<symbol, string>)[commandSpellingSymbol] = computed;
  }
  return computed;
}

function publishCommandSpelling(state: State, description: string): void {
  const monitor = stateMonitor(state);
  monitor?.values.invalidate("BASH_COMMAND");
  // Source admission bounds automatic text; charge its use during expansion.
  (monitor?.raw ?? state).variables.BASH_COMMAND = description;
}

export function resolveLimits(...limits: (ShellLimits | undefined)[]): ResolvedShellLimits {
  const result = Object.assign({}, defaultLimits, ...limits) as ResolvedShellLimits;
  const commandLimits = resolveCommandLimits(...limits.map(value => value?.commandLimits));
  for (const [key, value] of Object.entries(Object.assign({}, ...limits) as ShellLimits)) {
    if (key === "commandLimits") continue;
    if (!Number.isSafeInteger(value) || value < (key === "pipeHighWaterMark" ? 1 : 0)) {
      throw new RangeError(`${key} must be a ${key === "pipeHighWaterMark" ? "positive" : "nonnegative"} safe integer`);
    }
  }
  return { ...result, ...(commandLimits === undefined ? {} : { commandLimits }) };
}

const budgetedSinkSymbol = Symbol("safe-bash.budgetedSink");
const syncSinkSymbol = Symbol("safe-bash.syncSink");
type BudgetedSinkEntry = { self: ByteSink; budget: Budget; write: ByteSink["write"]; file?: NonNullable<CommandContext["stdoutFile"]> };
type SyncSinkEntry = { self: ByteSink; fn: (chunk: Uint8Array) => void };
const fallbackBudgetedSinks = new WeakMap<ByteSink, { budget: Budget; write: ByteSink["write"]; file?: NonNullable<CommandContext["stdoutFile"]> }>();
const fallbackSyncSinks = new WeakMap<ByteSink, (chunk: Uint8Array) => void>();
const budgetedSinks = {
  get(sink: ByteSink) {
    if (
      (sink instanceof BudgetedSyncSink && sink.write === BudgetedSyncSink.prototype.write) ||
      (sink instanceof Capture && sink.budget !== undefined && sink.write === Capture.prototype.write) ||
      (sink instanceof MemoryRedirectSink && sink.write === MemoryRedirectSink.prototype.write) ||
      (sink instanceof BudgetedPipeStageSink && sink.write === BudgetedPipeStageSink.prototype.write)
    ) {
      return sink as { budget: Budget; write: ByteSink["write"]; file?: NonNullable<CommandContext["stdoutFile"]> };
    }
    const entry = (sink as unknown as Record<symbol, BudgetedSinkEntry | undefined>)[budgetedSinkSymbol];
    return entry?.self === sink ? entry : fallbackBudgetedSinks.get(sink);
  },
  set(sink: ByteSink, value: { budget: Budget; write: ByteSink["write"]; file?: NonNullable<CommandContext["stdoutFile"]> }) {
    if (Object.isExtensible(sink)) (sink as unknown as Record<symbol, BudgetedSinkEntry>)[budgetedSinkSymbol] = { ...value, self: sink };
    else fallbackBudgetedSinks.set(sink, value);
  },
};
const syncSinks = {
  get(sink: ByteSink) {
    if (sink instanceof BudgetedSyncSink && sink.write === BudgetedSyncSink.prototype.write) {
      return (chunk: Uint8Array) => sink.writeSync(chunk);
    }
    if (sink instanceof MemoryRedirectSink && sink.write === MemoryRedirectSink.prototype.write) {
      return (chunk: Uint8Array) => sink.writeSync(chunk);
    }
    if (sink instanceof Capture && sink.write === Capture.prototype.write) {
      return (chunk: Uint8Array) => sink.writeSync(chunk);
    }
    const entry = (sink as unknown as Record<symbol, SyncSinkEntry | undefined>)[syncSinkSymbol];
    return entry?.self === sink ? entry.fn : fallbackSyncSinks.get(sink);
  },
  set(sink: ByteSink, fn: (chunk: Uint8Array) => void) {
    if (Object.isExtensible(sink)) (sink as unknown as Record<symbol, SyncSinkEntry>)[syncSinkSymbol] = { self: sink, fn };
    else fallbackSyncSinks.set(sink, fn);
  },
};
const syncResolved = Symbol.for("safe-bash.syncResolved");
const resolvedVoid: Promise<void> = Object.defineProperty(Promise.resolve(), syncResolved, { value: true });

async function sortExpansionStrings(values: string[], work: StringWork, utf8 = false): Promise<void> {
  const compare = async (left: string, right: string): Promise<number> => {
    let first = 0, second = 0;
    while (first < left.length && second < right.length) {
      const pending = stringCheckpoint(work);
      if (pending) await pending;
      const a = utf8 ? left.codePointAt(first)! : left.charCodeAt(first);
      const b = utf8 ? right.codePointAt(second)! : right.charCodeAt(second);
      // UTF-8 preserves scalar order; lone surrogates encode as U+FFFD.
      const difference = (utf8 && a >= 0xd800 && a <= 0xdfff ? 0xfffd : a)
        - (utf8 && b >= 0xd800 && b <= 0xdfff ? 0xfffd : b);
      if (difference) return difference;
      first += utf8 && a > 0xffff ? 2 : 1;
      second += utf8 && b > 0xffff ? 2 : 1;
    }
    return (left.length - first) - (right.length - second);
  };
  const sift = async (root: number, end: number): Promise<void> => {
    while (root * 2 + 1 < end) {
      let child = root * 2 + 1;
      if (child + 1 < end && await compare(values[child]!, values[child + 1]!) < 0) child++;
      if (await compare(values[root]!, values[child]!) >= 0) return;
      const saved = values[root]!;
      values[root] = values[child]!;
      values[child] = saved;
      root = child;
    }
  };
  for (let index = Math.floor(values.length / 2) - 1; index >= 0; index--) await sift(index, values.length);
  for (let end = values.length - 1; end > 0; end--) {
    const saved = values[0]!;
    values[0] = values[end]!;
    values[end] = saved;
    await sift(0, end);
  }
}

class ExecutionCleanup {
  private _controller: AbortController | undefined;
  readonly failures: unknown[] = [];
  private readonly _pending: { readonly cleanup: () => void | Promise<void>; readonly allocation: ValueScope }[] = [];
  private _closed = false;
  private _drain: Promise<void> | undefined;
  private _failure: { reason: unknown } | undefined;

  constructor(private readonly budget: Budget) {}

  get controller(): AbortController {
    return (this._controller ??= new AbortController());
  }

  register(cleanup: () => void | Promise<void>): void {
    this.budget.signal.throwIfAborted();
    if (this._failure) throw this._failure.reason;
    if (this._closed) throw new TypeError("Execution cleanup enrollment is closed");
    if (typeof cleanup !== "function") throw new TypeError("Execution cleanup must be callable");
    this.budget.cpuCheckpoint();
    const allocation = this.budget.values.scope();
    try {
      allocation.reserve(96, 1);
      this._pending.push({ cleanup, allocation });
    } catch (reason) { allocation.close(); throw reason; }
  }

  abort(reason: unknown): void {
    this._failure ??= { reason };
    if (this._pending.length || this._drain) this.controller.abort(reason);
  }

  drain(): Promise<void> {
    if (!this._drain && this._pending.length === 0) {
      this._closed = true;
      this._drain = resolvedVoid;
      return resolvedVoid;
    }
    return this._drain ??= Promise.resolve().then(async () => {
      const retained: ValueScope[] = [];
      try {
        while (this._pending.length) {
          const pending = this._pending.splice(0);
          const results = await Promise.allSettled(pending.map(async entry => {
            let failed = false;
            try { await entry.cleanup(); }
            catch (reason) { failed = true; retained.push(entry.allocation); throw reason; }
            finally { if (!failed) entry.allocation.close(); }
          }));
          for (const result of results) if (result.status === "rejected") this.failures.push(result.reason);
        }
      } finally {
        this._closed = true;
        for (const allocation of retained) allocation.close();
      }
    });
  }
}

const defaultSetTimeout = setTimeout;
const defaultDateNow = Date.now;
const sharedWallClockBudgets: { primary: Budget | undefined; extra: Budget[] } = { primary: undefined, extra: [] };
let sharedWallClockTimer: ReturnType<typeof setTimeout> | undefined;
let sharedWallClockTimerDeadline = 0;

function tickSharedWallClockBudgets(): void {
  sharedWallClockTimer = undefined;
  sharedWallClockTimerDeadline = 0;
  const now = defaultDateNow();
  let minDeadline = Infinity;
  while (sharedWallClockBudgets.primary !== undefined) {
    const d = sharedWallClockBudgets.primary._checkSharedWallClock(now);
    if (d <= 0) {
      sharedWallClockBudgets.primary = sharedWallClockBudgets.extra.pop();
    } else {
      minDeadline = d;
      break;
    }
  }
  for (let i = sharedWallClockBudgets.extra.length - 1; i >= 0; i--) {
    const b = sharedWallClockBudgets.extra[i]!;
    const d = b._checkSharedWallClock(now);
    if (d <= 0) {
      sharedWallClockBudgets.extra.splice(i, 1);
    } else if (d < minDeadline) {
      minDeadline = d;
    }
  }
  if (sharedWallClockBudgets.primary === undefined && sharedWallClockBudgets.extra.length > 0) {
    sharedWallClockBudgets.primary = sharedWallClockBudgets.extra.pop();
  }
  if (minDeadline !== Infinity) {
    const delay = Math.min(Math.max(1, minDeadline - now), 2_147_483_647);
    sharedWallClockTimerDeadline = now + delay;
    sharedWallClockTimer = defaultSetTimeout(tickSharedWallClockBudgets, delay);
    (sharedWallClockTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  }
}

export class Budget {
  declare readonly limits: ResolvedShellLimits;
  declare readonly onInternalError: InternalErrorHandler | undefined;
  declare _arraySession: unknown;
  declare private _executionScope: object | undefined;
  declare private _pathLookup: PathLookup | undefined;
  declare private _pathLookupSuspensions: number;
  declare readonly parsing: ParseBudget;
  declare private _values: ValueArena | undefined;
  declare private _executionCleanup: ExecutionCleanup | undefined;
  declare commands: number;
  declare iterations: number;
  declare bytes: number;
  declare sourceBytes: number;
  declare globstarEntries: number;
  declare globstarStates: number;
  declare readonly controller: ManagedControlController;
  declare readonly signal: AbortSignal;
  declare private _yieldCheckpoint: (() => void) | undefined;
  declare private _chargeFs: (() => void) | undefined;
  declare private _cleanupChargeFs: (() => void) | undefined;
  declare private _wallClockTimer: ReturnType<typeof setTimeout> | true | undefined;
  declare private _wallClockDeadline: number;
  declare private _pipelineStages: number;
  declare private _fileSystemOperations: number;
  get fileSystemOperations(): number {
    return this._fileSystemOperations;
  }
  declare private readonly _cpuStarted: number;
  declare _aborted: boolean;
  declare readonly _hasExternalSignal: boolean;
  declare readonly hasCpuLimit: boolean;
  declare readonly maxCommandsSmi: number;
  declare readonly maxLoopIterationsSmi: number;
  declare readonly maxFileSystemOperationsSmi: number;
  declare readonly maxSubstitutionDepthSmi: number;
  declare readonly maxExpansionFieldsSmi: number;
  declare readonly maxExpansionBytesSmi: number;
  declare readonly maxOutputBytesSmi: number;

  constructor(limits: ResolvedShellLimits, signal?: AbortSignal, onInternalError?: InternalErrorHandler) {
    this.limits = limits;
    this._arraySession = undefined;
    this.commands = 0;
    this.iterations = 0;
    this.bytes = 0;
    this.sourceBytes = 0;
    this.controller = createManagedControlController();
    this._chargeFs = undefined;
    this._wallClockDeadline = Date.now() + limits.maxWallClockMs;
    this._pipelineStages = 0;
    this._fileSystemOperations = 0;
    this.hasCpuLimit = limits.maxCpuMs !== Infinity;
    if (onInternalError !== undefined) this.onInternalError = onInternalError;
    if (this.hasCpuLimit) this._cpuStarted = monotonicNow();
    if (signal !== undefined) this._hasExternalSignal = true;
    this.maxCommandsSmi = limits.maxCommands <= 0x3fffffff ? (limits.maxCommands | 0) : 0x3fffffff;
    this.maxLoopIterationsSmi = limits.maxLoopIterations <= 0x3fffffff ? (limits.maxLoopIterations | 0) : 0x3fffffff;
    this.maxFileSystemOperationsSmi = limits.maxFileSystemOperations <= 0x3fffffff ? (limits.maxFileSystemOperations | 0) : 0x3fffffff;
    this.maxSubstitutionDepthSmi = limits.maxSubstitutionDepth <= 0x3fffffff ? (limits.maxSubstitutionDepth | 0) : 0x3fffffff;
    this.maxExpansionFieldsSmi = limits.maxExpansionFields <= 0x3fffffff ? (limits.maxExpansionFields | 0) : 0x3fffffff;
    this.maxExpansionBytesSmi = limits.maxExpansionBytes <= 0x3fffffff ? (limits.maxExpansionBytes | 0) : 0x3fffffff;
    this.maxOutputBytesSmi = limits.maxOutputBytes <= 0x3fffffff ? (limits.maxOutputBytes | 0) : 0x3fffffff;
    this.signal = signal ? combineManagedSignals(signal, this.controller.signal) : this.controller.signal;
    if (signal) inheritYieldCheckpoint(signal, this.signal);
    this.parsing = new ParseBudget(limits.maxParseUnits === Infinity ? undefined : limits.maxParseUnits, this.signal, this);
    if (limits.maxWallClockMs !== Infinity) this._armWallClock();
  }

  get yieldCheckpoint(): () => void {
    return this._yieldCheckpoint ??= () => { this.cpuCheckpoint(); };
  }

  get values(): ValueArena {
    return this._values ??= new ValueArena(this.limits.maxExpansionBytes, this.limits.maxExpansionFields, this);
  }

  get hasValues(): boolean {
    return this._values !== undefined;
  }

  get chargeFs(): () => void {
    return this._chargeFs ??= () => { this.fileSystemOperation(); };
  }

  get cleanupChargeFs(): () => void {
    return this._cleanupChargeFs ??= () => { this.fileSystemCleanupOperation(); };
  }

  get executionScope(): object {
    return this._executionScope ??= Object.freeze({});
  }

  get hasExecutionCleanup(): boolean {
    return this._executionCleanup !== undefined;
  }

  get executionCleanup(): ExecutionCleanup {
    return this._executionCleanup ??= new ExecutionCleanup(this);
  }

  get pathLookup(): PathLookup {
    if (!this._pathLookup) {
      this._pathLookup = new PathLookup();
      for (let i = 0; i < this._pathLookupSuspensions; i++) this._pathLookup.beginSuspension();
    }
    return this._pathLookup;
  }

  beginPathLookupSuspension(): void {
    this._pathLookupSuspensions++;
    this._pathLookup?.beginSuspension();
  }

  endPathLookupSuspension(): void {
    this._pathLookupSuspensions--;
    this._pathLookup?.endSuspension();
  }

  abort(reason: unknown): void {
    this._aborted = true;
    abortManagedController(this.controller, reason);
  }

  private _armWallClock(): void {
    if (
      this._wallClockTimer === undefined &&
      setTimeout === defaultSetTimeout &&
      Date.now === defaultDateNow &&
      this.limits.maxWallClockMs >= 100
    ) {
      const deadline = this._wallClockDeadline;
      const now = defaultDateNow();
      if (deadline <= now) {
        this.abort(new ShellLimitError("maxWallClockMs"));
        return;
      }
      this._wallClockTimer = true;
      // The shared timer retains its single budget owner until retirement.
      if (sharedWallClockBudgets.primary === undefined) sharedWallClockBudgets.primary = this;
      else sharedWallClockBudgets.extra.push(this);
      if (sharedWallClockTimer === undefined || deadline < sharedWallClockTimerDeadline) {
        if (sharedWallClockTimer !== undefined) clearTimeout(sharedWallClockTimer);
        const delay = Math.min(deadline - now, 2_147_483_647);
        sharedWallClockTimerDeadline = now + delay;
        sharedWallClockTimer = defaultSetTimeout(tickSharedWallClockBudgets, delay);
        (sharedWallClockTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
      }
      return;
    }
    const remaining = this._wallClockDeadline - Date.now();
    if (remaining <= 0) {
      this.abort(new ShellLimitError("maxWallClockMs"));
      return;
    }
    this._wallClockTimer = setTimeout(() => this._armWallClock(), Math.min(remaining, 2_147_483_647));
    const timer = this._wallClockTimer as ReturnType<typeof setTimeout> & { unref?: () => void };
    timer.unref?.();
  }

  _checkSharedWallClock(now: number): number {
    if (this._wallClockDeadline <= now) {
      this._wallClockTimer = undefined;
      this.abort(new ShellLimitError("maxWallClockMs"));
      return 0;
    }
    return this._wallClockDeadline;
  }

  close(): void {
    if (this._wallClockTimer === true) {
      if (sharedWallClockBudgets.primary === this) {
        sharedWallClockBudgets.primary = sharedWallClockBudgets.extra.pop();
      } else {
        const idx = sharedWallClockBudgets.extra.indexOf(this);
        if (idx >= 0) sharedWallClockBudgets.extra.splice(idx, 1);
      }
    } else if (this._wallClockTimer !== undefined) {
      clearTimeout(this._wallClockTimer);
    }
    this._wallClockTimer = undefined;
  }

  fail(limit: keyof ShellLimits): never {
    const error = new ShellLimitError(limit);
    this.abort(error);
    throw error;
  }

  cpuCheckpoint(): void {
    if (this._aborted || (this._hasExternalSignal && this.signal.aborted)) this.signal.throwIfAborted();
    if (this.hasCpuLimit && monotonicNow() - this._cpuStarted > this.limits.maxCpuMs) this.fail("maxCpuMs");
  }

  tick(): void {
    this.cpuCheckpoint();
    const next = (this.commands + 1) | 0;
    this.commands = next;
    if (next > this.maxCommandsSmi && next > this.limits.maxCommands) this.fail("maxCommands");
  }

  fileSystemOperation(): void {
    this.cpuCheckpoint();
    this.fileSystemCleanupOperation();
  }

  fileSystemCleanupOperation(): void {
    if (this._fileSystemOperations >= this.maxFileSystemOperationsSmi && this._fileSystemOperations >= this.limits.maxFileSystemOperations) this.fail("maxFileSystemOperations");
    this._fileSystemOperations++;
  }

  canFileSystemOperation(): boolean {
    return this._fileSystemOperations < this.maxFileSystemOperationsSmi || this._fileSystemOperations < this.limits.maxFileSystemOperations;
  }

  reservePipelineStages(count: number): () => void {
    this.signal.throwIfAborted();
    if (count > this.limits.maxPipelineStages - this._pipelineStages) this.fail("maxPipelineStages");
    this._pipelineStages += count;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._pipelineStages -= count;
    };
  }

  enterPipelineStages(count: number): void {
    this.signal.throwIfAborted();
    if (count > this.limits.maxPipelineStages - this._pipelineStages) this.fail("maxPipelineStages");
    this._pipelineStages += count;
  }

  leavePipelineStages(count: number): void {
    this._pipelineStages -= count;
  }

  loop(): void {
    if (this._aborted || (this._hasExternalSignal && this.signal.aborted)) this.signal.throwIfAborted();
    const next = (this.iterations + 1) | 0;
    this.iterations = next;
    if (next > this.maxLoopIterationsSmi && next > this.limits.maxLoopIterations) this.fail("maxLoopIterations");
  }

  source(bytes: number): void {
    this.signal.throwIfAborted();
    if (bytes > this.limits.maxSourceBytes - this.sourceBytes) this.fail("maxSourceBytes");
    this.sourceBytes += bytes;
  }

  async writeCounted(chunk: Uint8Array, write: () => Promise<number>, signal = this.signal, preserveReceipt = false): Promise<number> {
    signal.throwIfAborted();
    if (!(chunk instanceof Uint8Array)) throw new TypeError("Shell output must be Uint8Array");
    const reserved = chunk.byteLength;
    if (reserved > this.limits.maxOutputBytes - this.bytes) this.fail("maxOutputBytes");
    this.bytes += reserved;
    try {
      const count = await write();
      if (!Number.isSafeInteger(count) || count < 0 || count > reserved) throw new FsError("EIO", { syscall: "write", message: "invalid byte count" });
      this.bytes -= reserved - count;
      if (!preserveReceipt) signal.throwIfAborted();
      return count;
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    }
  }

  sink(sink: ByteSink, signal = this.signal): ByteSink {
    if (sink instanceof Capture && sink.write === Capture.prototype.write) {
      if (sink.budget === undefined) {
        sink.budget = this;
        sink.signal = signal;
        return sink;
      }
      if (sink.budget === this && sink.signal === signal) return sink;
      return new BudgetedSyncSink(this, sink, signal);
    }
    if (sink instanceof BudgetedSyncSink && sink.budget === this && sink.write === BudgetedSyncSink.prototype.write) {
      return sink.signal === signal ? sink : new BudgetedSyncSink(this, sink.target, signal, sink.file);
    }
    const ownership = budgetedSinks.get(sink);
    if (ownership?.budget === this && ownership.write === sink.write) return signalSink(sink, signal);
    return this.createBudgetedSink(sink, signal, ownership);
  }

  private createBudgetedSink(
    sink: ByteSink,
    signal: AbortSignal,
    ownership: ReturnType<typeof budgetedSinks.get>,
  ): ByteSink {
    const syncWrite = syncSinks.get(sink);
    const countedSyncWrite = syncWrite
      ? (chunk: Uint8Array): void => {
          signal.throwIfAborted();
          if (!(chunk instanceof Uint8Array)) throw new TypeError("Shell output must be Uint8Array");
          if (chunk.byteLength > this.limits.maxOutputBytes - this.bytes) this.fail("maxOutputBytes");
          this.bytes += chunk.byteLength;
          syncWrite(chunk);
        }
      : undefined;
    const output: ByteSink = {
      ...(sink[outputFailure] ? { [outputFailure]: sink[outputFailure] } : {}),
      ...(sink.ownedOutput ? { ownedOutput: {
        get consumerClosed() { return sink.ownedOutput!.consumerClosed; },
        write: (chunk: Uint8Array): Promise<void> => {
          try {
            signal.throwIfAborted();
            if (!(chunk instanceof Uint8Array)) throw new TypeError("Shell output must be Uint8Array");
            if (chunk.byteLength > this.limits.maxOutputBytes - this.bytes) this.fail("maxOutputBytes");
            const capability = sink.ownedOutput!;
            const write = capability.write;
            signal.throwIfAborted();
            if (chunk.byteLength > this.limits.maxOutputBytes - this.bytes) this.fail("maxOutputBytes");
            this.bytes += chunk.byteLength;
            const res = Reflect.apply(write, capability, [chunk]);
            if (isSyncResolved(res)) return resolvedVoid;
            return Promise.resolve(res).then(
              () => undefined,
              (error: unknown) => { signal.throwIfAborted(); throw error; },
            );
          } catch (error) {
            return Promise.reject(signal.aborted ? signal.reason : error);
          }
        },
      } } : {}),
      write: countedSyncWrite
        ? (chunk) => {
            try {
              countedSyncWrite(chunk);
              return resolvedVoid;
            } catch (error) {
              return Promise.reject(error);
            }
          }
        : (chunk) => {
            try {
              signal.throwIfAborted();
              if (!(chunk instanceof Uint8Array)) throw new TypeError("Shell output must be Uint8Array");
              if (chunk.byteLength > this.limits.maxOutputBytes - this.bytes) this.fail("maxOutputBytes");
              this.bytes += chunk.byteLength;
              const pending = sink.write(chunk);
              if (isSyncResolved(pending)) {
                signal.throwIfAborted();
                return resolvedVoid;
              }
              return interruptible(pending, signal);
            } catch (error) {
              return Promise.reject(error);
            }
          },
    };
    budgetedSinks.set(output, { budget: this, write: output.write, ...(ownership?.write === sink.write && ownership.file ? { file: ownership.file } : {}) });
    if (countedSyncWrite) syncSinks.set(output, countedSyncWrite);
    return output;
  }
}
Object.assign(Budget.prototype, {
  onInternalError: undefined,
  _yieldCheckpoint: undefined,
  _values: undefined,
  _executionScope: undefined,
  _pathLookup: undefined,
  _pathLookupSuspensions: 0,
  _executionCleanup: undefined,
  globstarEntries: 0,
  globstarStates: 0,
  _cleanupChargeFs: undefined,
  _wallClockTimer: undefined,
  _aborted: false,
  _cpuStarted: 0,
  _hasExternalSignal: false,
});


const EMPTY_CAPTURE_BYTES = new Uint8Array(0);

export class Capture implements ByteSink {
  declare private _chunks: Uint8Array[] | undefined;
  declare private _first: Uint8Array | undefined;
  declare length: number;
  declare private _tail: Uint8Array | undefined;
  declare private _tailLength: number;
  declare budget: Budget | undefined;
  declare signal: AbortSignal | undefined;
  declare file?: NonNullable<CommandContext["stdoutFile"]>;

  constructor(budget?: Budget, signal?: AbortSignal) {
    if (budget !== undefined) this.budget = budget;
    if (signal !== undefined) this.signal = signal;
  }

  get self(): ByteSink {
    return this;
  }

  get chunks(): Uint8Array[] {
    if (!this._chunks) {
      this._chunks = this._first ? [this._first] : [];
      this._first = undefined;
    }
    return this._chunks;
  }

  writeSync(chunk: Uint8Array): boolean {
    if (this.budget !== undefined) {
      this.signal!.throwIfAborted();
      if (!(chunk instanceof Uint8Array)) throw new TypeError("Shell output must be Uint8Array");
      const budget = this.budget;
      if (chunk.byteLength > budget.limits.maxOutputBytes - budget.bytes) budget.fail("maxOutputBytes");
      budget.bytes += chunk.byteLength;
    }
    return this.writeRawSync(chunk);
  }

  writeRawSync(chunk: Uint8Array): boolean {
    if (!chunk.byteLength) return true;
    if (!this._chunks && !this._first && chunk.byteLength <= 4096) {
      this._first = new Uint8Array(chunk);
      this.length = chunk.byteLength;
      return true;
    }
    const chunks = this.chunks;
    if (!this._tail && chunks.length === 1 && chunks[0]!.byteLength < 4096) {
      const first = chunks[0]!;
      this._tail = new Uint8Array(4096);
      this._tail.set(first);
      this._tailLength = first.byteLength;
      chunks[0] = this._tail.subarray(0, this._tailLength);
    }
    let offset = 0;
    while (offset < chunk.byteLength) {
      if (!this._tail || this._tailLength === this._tail.byteLength) {
        const remaining = chunk.byteLength - offset;
        const nextCap = remaining >= 16384 ? Math.max(128 * 1024, Math.min(256 * 1024, remaining * 4)) : Math.max(4096, Math.min(64 * 1024, remaining));
        this._tail = new Uint8Array(nextCap);
        this._tailLength = 0;
        chunks.push(this._tail.subarray(0, 0));
      }
      const size = Math.min(chunk.byteLength - offset, this._tail.byteLength - this._tailLength);
      this._tail.set(chunk.subarray(offset, offset + size), this._tailLength);
      this._tailLength += size;
      offset += size;
      chunks[chunks.length - 1] = this._tail.subarray(0, this._tailLength);
    }
    this.length += chunk.byteLength;
    return true;
  }

  write(chunk: Uint8Array): Promise<void> {
    try {
      this.writeSync(chunk);
      return resolvedVoid;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  bytes(): Uint8Array {
    if (this.length === 0) return EMPTY_CAPTURE_BYTES;
    if (this._first && !this._chunks) return new Uint8Array(this._first);
    const bytes = new Uint8Array(this.length);
    let offset = 0;
    if (this._chunks) {
      for (const chunk of this._chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }
    return bytes;
  }

  takeBytes(): Uint8Array {
    if (this.length === 0) return EMPTY_CAPTURE_BYTES;
    if (this._first && !this._chunks) {
      const first = this._first;
      this._first = undefined;
      this.length = 0;
      return first;
    }
    const chunk = this.chunks.length === 1 ? this.chunks[0] : undefined;
    const bytes = chunk && (chunk.byteLength === chunk.buffer.byteLength || chunk.buffer.byteLength - chunk.byteLength <= 65536)
      ? chunk
      : this.bytes();
    this.chunks.length = 0;
    this.length = 0;
    this._tail = undefined;
    this._tailLength = 0;
    return bytes;
  }

  resetEmpty(): void {
    if (this._chunks) this._chunks.length = 0;
    this._first = undefined;
    this.length = 0;
    this._tail = undefined;
    this._tailLength = 0;
  }
}
Object.assign(Capture.prototype, {
  _chunks: undefined,
  _first: undefined,
  length: 0,
  _tail: undefined,
  _tailLength: 0,
  budget: undefined,
  signal: undefined,
  file: undefined,
});

interface GetoptsBinding {
  cursor: GetoptsState;
  integer: boolean;
}

interface SavedVariable {
  attributes?: string | undefined;
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
  variableAttributes?: Map<string, string>;
  umask?: number;
  extensions?: ShellExtensionState | undefined;
  cwd: string;
  variables: Record<string, string>;
  exported: Set<string>;
  functions: Map<string, Command>;
  exportedFunctions?: Set<string>;
  positional: string[];
  positionalSetVersion?: number;
  sourceDepth?: number;
  arg0?: string;
  profile?: "bash" | "sh";
  externalInvocation?: boolean;
  readonlyVariables?: Set<string>;
  readonlyFunctions?: Set<string>;
  pathUnset?: boolean;
  status: number;
  substitutionStatus: number;
  depth: number;
  loopDepth: number;
  functionDepth: number;
  locals: Map<string, SavedVariable>[];
  getopts?: GetoptsBinding | undefined;
  directoryStack?: { readonly entries: readonly string[]; readonly bytes: number } | undefined;
  directoryStackCwdPublication?: symbol;
  dotglob?: boolean;
  extglob?: boolean;
  globstar?: boolean;
  nullglob?: boolean;
  nocaseglob?: boolean;
  nocasematch?: boolean;
  braceexpand?: boolean;
  noglob?: boolean;
  noclobber?: boolean;
  allexport?: boolean;
  noexec?: boolean;
  pipefail: boolean;
  errexit?: boolean;
  nounset?: boolean;
  isolated?: boolean;
  _readOnlyStage?: boolean | undefined;
  redirectAssignments?: ReadonlyMap<string, ShellValue>;
  lastArgument?: string;
  functionNames?: string[];
  hashedCommands?: Map<string, string>;
}

const declarationArrays = Symbol("declarationArrays");

interface IO {
  /** Zeroth argument identity; command remains the name used for lookup. */
  readonly argv0?: string | undefined;
  readonly [declarationArrays]?: ReadonlyMap<number, ArrayAssignment> | undefined;
  readonly capabilities?: import("./types.js").ShellCapabilities | undefined;
  readonly admittedHandles?: CommandContext["admittedHandles"];
  readonly processSignals?: CommandContext["processSignals"];
  readonly nameExpansionContext?: "document" | "conditional" | undefined;
  readonly [invocationScope]: InvocationScope;
  readonly [valueScope]?: ValueScope;
  readonly parameterDepth?: number;
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
  readonly processSubstitutions?: (() => Promise<void>)[] | undefined;
  readonly substitutionDiagnosticLines?: ReadonlyMap<Command, number> | undefined;
  readonly scriptName?: string;
  readonly terminal?: {
    readonly target: Command | Pipeline;
    readonly frame: PreparedDescriptorFrame;
    io?: IO;
    publicationNegate?: boolean | undefined;
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
  private _references = 1;
  private _ownerReleased = false;
  private _closing: Promise<void> | undefined;
  private _settled: Promise<void> | undefined;
  private _resolveSettled: (() => void) | undefined;

  constructor(private readonly finalize?: () => void | Promise<void>) {}

  releaseSyncIfIdle(): boolean {
    if (this._references === 1 && !this._ownerReleased && !this.finalize) {
      this._ownerReleased = true;
      this._references = 0;
      return true;
    }
    return false;
  }

  settled(): Promise<void> | undefined {
    if (this._references === 0) return this._closing;
    return this._settled ??= new Promise<void>(resolve => {
      this._resolveSettled = resolve;
    });
  }

  acquire(): () => Promise<void> {
    if (!this._references) throw new FsError("EBADF");
    this._references++;
    let released = false;
    return () => {
      if (released) return this._closing ?? resolvedVoid;
      released = true;
      return this._release();
    };
  }

  release(): Promise<void> {
    if (this._ownerReleased) return this._closing ?? resolvedVoid;
    this._ownerReleased = true;
    return this._release();
  }

  private _release(): Promise<void> {
    if (--this._references) return resolvedVoid;
    if (!this.finalize) {
      this._resolveSettled?.();
      return resolvedVoid;
    }
    return this._closing ??= resolvedVoid.then(this.finalize).finally(() => {
      this._resolveSettled?.();
    });
  }
}

class PreparedDescriptorFrame {
  private _bindings: Map<number, { lifetime: DescriptorLifetime; release(): Promise<void> }> | undefined;
  private _work: Promise<void> = resolvedVoid;
  private _closing: Promise<void> | undefined;
  private readonly _retireCleanup: () => void;

  constructor(private readonly references: PipeDescriptorFrame, private readonly budget: Budget) {
    this._retireCleanup = references.scope.register(() => this.close());
  }

  closeSyncIfIdle(): boolean {
    if (this._closing) return false;
    if ((!this._bindings || this._bindings.size === 0) && this._work === resolvedVoid) {
      this._closing = resolvedVoid;
      this._retireCleanup();
      return true;
    }
    return false;
  }

  acquire(descriptors: ReadonlyMap<number, Descriptor>): void {
    if (this._closing) throw new FsError("EBADF");
    for (const [number, descriptor] of descriptors) {
      if (descriptor.closed || !descriptor.lifetime) continue;
      const allocation = this.budget.values.scope();
      try {
        allocation.reserve(64, 1);
        const release = descriptor.lifetime.acquire();
        (this._bindings ??= new Map()).set(number, { lifetime: descriptor.lifetime, async release() {
          try { await release(); } finally { allocation.close(); }
        } });
      } catch (reason) { allocation.close(); throw reason; }
    }
  }

  reconcile(descriptors: ReadonlyMap<number, Descriptor>): Promise<void> {
    if (this._closing) return Promise.reject(new FsError("EBADF"));
    if ((!this._bindings || this._bindings.size === 0) && this._work === resolvedVoid) {
      let allActive = true;
      for (const reference of this.references.references) {
        let found = false;
        for (const descriptor of descriptors.values()) {
          if (!descriptor.closed && descriptor.pipe === reference) {
            found = true;
            break;
          }
        }
        if (!found) {
          allActive = false;
          break;
        }
      }
      if (allActive) return resolvedVoid;
    }
    const previous = this._bindings;
    this._bindings = undefined;
    const failures: unknown[] = [];
    const inherited = new Set(previous ? [...previous.values()].map(binding => binding.lifetime) : []);
    const surviving = new Map([...descriptors].filter(([, descriptor]) => descriptor.lifetime && inherited.has(descriptor.lifetime)));
    try { this.acquire(surviving); } catch (reason) { failures.push(reason); }
    const activePipes = new Set([...descriptors.values()].filter(descriptor => !descriptor.closed).map(descriptor => descriptor.pipe));
    this._work = this._work.then(async () => {
      const retired = await Promise.allSettled([
        ...(previous ? [...previous.values()].map(binding => binding.release()) : []),
        ...[...this.references.references].filter(reference => !activePipes.has(reference)).map(reference => reference.close()),
      ]);
      failures.push(...retired.filter(result => result.status === "rejected").map(result => result.reason));
      throwCleanupFailures(failures);
    });
    return this._work;
  }

  close(): Promise<void> {
    if (this.closeSyncIfIdle()) return resolvedVoid;
    return this._closing ??= Promise.resolve().then(async () => {
      const failures: unknown[] = [];
      try { await this._work; } catch (reason) { failures.push(reason); }
      const retired = this._bindings ? await Promise.allSettled([...this._bindings.values()].map(binding => binding.release())) : [];
      this._bindings?.clear();
      failures.push(...retired.filter(result => result.status === "rejected").map(result => result.reason));
      throwCleanupFailures(failures);
      this._retireCleanup();
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
  return { ...io, nameExpansionContext: undefined, descriptors, ...(io.assignmentDiagnosticContext === undefined ? {} : { assignmentDiagnosticContext: { ...io.assignmentDiagnosticContext } }) };
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

interface OutputFailureTracker {
  list?: { descriptor: CommandFileDescriptor; reason: unknown }[];
  outputStatus?: number;
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
const SHARED_PIPELINE_CLOSED = new PipelineClosed();

class BudgetedSyncSink implements ByteSink {
  declare readonly self: ByteSink;
  declare readonly budget: Budget;
  declare readonly target: Capture;
  declare readonly signal: AbortSignal;
  declare file?: NonNullable<CommandContext["stdoutFile"]>;

  constructor(budget: Budget, target: Capture, signal: AbortSignal, file?: NonNullable<CommandContext["stdoutFile"]>) {
    this.self = this;
    this.budget = budget;
    this.target = target;
    this.signal = signal;
    if (file !== undefined) this.file = file;
  }

  writeSync(chunk: Uint8Array): boolean {
    this.signal.throwIfAborted();
    if (!(chunk instanceof Uint8Array)) throw new TypeError("Shell output must be Uint8Array");
    if (this.target.budget === this.budget) return this.target.writeSync(chunk);
    const budget = this.budget;
    if (chunk.byteLength > budget.limits.maxOutputBytes - budget.bytes) budget.fail("maxOutputBytes");
    budget.bytes += chunk.byteLength;
    this.target.writeRawSync(chunk);
    return true;
  }

  write(chunk: Uint8Array): Promise<void> {
    try {
      this.writeSync(chunk);
      return resolvedVoid;
    } catch (error) {
      return Promise.reject(error);
    }
  }
}

class MemoryRedirectSink implements ByteSink {
  declare readonly self: ByteSink;
  declare readonly budget: Budget;
  declare readonly handle: MemoryRedirectHandle;
  declare readonly path: string;
  declare readonly signal: AbortSignal;
  declare file: NonNullable<CommandContext["stdoutFile"]>;
  declare failedError: unknown;

  constructor(
    budget: Budget,
    handle: MemoryRedirectHandle,
    path: string,
    signal: AbortSignal,
    file?: NonNullable<CommandContext["stdoutFile"]>,
  ) {
    this.self = this;
    this.budget = budget;
    this.handle = handle;
    this.path = path;
    this.signal = signal;
    this.file = file ?? Object.freeze({ path });
  }

  writeSync(chunk: Uint8Array): boolean {
    this.signal.throwIfAborted();
    if (!(chunk instanceof Uint8Array)) throw new TypeError("Shell output must be Uint8Array");
    const budget = this.budget;
    if (chunk.byteLength > budget.limits.maxOutputBytes - budget.bytes) budget.fail("maxOutputBytes");
    if (chunk.byteLength > 0) {
      try {
        this.handle.writeSync(chunk, this.signal);
      } catch (error) {
        this.failedError ??= error;
        throw error;
      }
      budget.bytes += chunk.byteLength;
    }
    return true;
  }

  write(chunk: Uint8Array): Promise<void> {
    try {
      this.writeSync(chunk);
      return resolvedVoid;
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
Object.assign(MemoryRedirectSink.prototype, {
  failedError: undefined,
});

class BudgetedPipeStageOwnedSink {
  declare readonly parent: BudgetedPipeStageSink;
  constructor(parent: BudgetedPipeStageSink) {
    this.parent = parent;
  }
  get consumerClosed(): AbortSignal {
    return this.parent.writable.ownedOutput!.consumerClosed;
  }
  write(chunk: Uint8Array): Promise<void> {
    return this.parent.writeOwned(chunk);
  }
}

class BudgetedPipeStageSink implements ByteSink {
  readonly isPipeStage = true;
  declare readonly self: ByteSink;
  declare readonly budget: Budget;
  declare readonly writable: ByteSink;
  declare readonly signal: AbortSignal;
  declare readonly written: Set<number> | undefined;
  declare readonly index: number;
  declare readonly controller: { readonly signal: AbortSignal; abort(reason?: unknown): void };
  declare private _ownedOutput: NonNullable<ByteSink["ownedOutput"]> | undefined;
  declare file?: NonNullable<CommandContext["stdoutFile"]>;

  constructor(
    budget: Budget,
    writable: ByteSink,
    signal: AbortSignal,
    written: Set<number> | undefined,
    index: number,
    controller: { readonly signal: AbortSignal; abort(reason?: unknown): void },
  ) {
    this.self = this;
    this.budget = budget;
    this.writable = writable;
    this.signal = signal;
    this.written = written;
    this.index = index;
    this.controller = controller;
    this._ownedOutput = undefined;
  }

  get ownedOutput(): NonNullable<ByteSink["ownedOutput"]> {
    return (this.writable.ownedOutput ? (this._ownedOutput ??= new BudgetedPipeStageOwnedSink(this)) : undefined) as NonNullable<ByteSink["ownedOutput"]>;
  }

  [outputFailure](reason: unknown): Promise<void> {
    const fn = this.writable[outputFailure];
    return fn ? fn.call(this.writable, reason) : resolvedVoid;
  }

  writeOwned(chunk: Uint8Array): Promise<void> {
    try {
      const signal = this.signal;
      signal.throwIfAborted();
      if (!(chunk instanceof Uint8Array)) throw new TypeError("Shell output must be Uint8Array");
      const budget = this.budget;
      if (chunk.byteLength > budget.limits.maxOutputBytes - budget.bytes) budget.fail("maxOutputBytes");
      const capability = this.writable.ownedOutput!;
      const write = capability.write;
      signal.throwIfAborted();
      if (chunk.byteLength > budget.limits.maxOutputBytes - budget.bytes) budget.fail("maxOutputBytes");
      budget.bytes += chunk.byteLength;
      const res = Reflect.apply(write, capability, [chunk]);
      if (isSyncResolved(res)) return resolvedVoid;
      return Promise.resolve(res).then(
        () => undefined,
        (error: unknown) => { signal.throwIfAborted(); throw error; },
      );
    } catch (error) {
      return Promise.reject(this.signal.aborted ? this.signal.reason : error);
    }
  }

  write(chunk: Uint8Array): Promise<void> {
    try {
      const signal = this.signal;
      signal.throwIfAborted();
      if (!(chunk instanceof Uint8Array)) throw new TypeError("Shell output must be Uint8Array");
      const budget = this.budget;
      if (chunk.byteLength > budget.limits.maxOutputBytes - budget.bytes) budget.fail("maxOutputBytes");
      budget.bytes += chunk.byteLength;
      let res: Promise<void>;
      try {
        res = this.writable.write(chunk);
      } catch (error) {
        if (errorCode(error) === "EPIPE") {
          const closed = SHARED_PIPELINE_CLOSED;
          abortManagedController(this.controller, closed);
          return Promise.reject(closed);
        }
        return Promise.reject(error);
      }
      if (isSyncResolved(res)) {
        if (chunk.byteLength && this.written) this.written.add(this.index);
        signal.throwIfAborted();
        return resolvedVoid;
      }
      const handled = res.then(
        () => { if (chunk.byteLength && this.written) this.written.add(this.index); },
        (error) => {
          if (errorCode(error) === "EPIPE") {
            const closed = SHARED_PIPELINE_CLOSED;
            abortManagedController(this.controller, closed);
            throw closed;
          }
          throw error;
        },
      );
      return interruptible(handled, signal);
    } catch (error) {
      return Promise.reject(error);
    }
  }
}

function pollIncomingPipe(this: { incoming: { _readiness?: () => "ready" | "eof" | "blocked" | "unknown"; readiness(): "ready" | "eof" | "blocked" | "unknown" } }): "ready" | "eof" | "blocked" | "unknown" {
  return this.incoming._readiness ? this.incoming._readiness() : this.incoming.readiness();
}

function signalSink(sink: ByteSink, signal: AbortSignal): ByteSink {
  if (sink instanceof BudgetedSyncSink && sink.write === BudgetedSyncSink.prototype.write) {
    return sink.signal === signal ? sink : new BudgetedSyncSink(sink.budget, sink.target, signal, sink.file);
  }
  if (sink instanceof Capture && sink.budget !== undefined && sink.write === Capture.prototype.write) {
    return sink.signal === signal ? sink : new BudgetedSyncSink(sink.budget, sink, signal);
  }
  if (sink instanceof MemoryRedirectSink && sink.write === MemoryRedirectSink.prototype.write) {
    return sink.signal === signal ? sink : new MemoryRedirectSink(sink.budget, sink.handle, sink.path, signal, sink.file);
  }
  const ownership = budgetedSinks.get(sink);
  const owned = ownership?.write === sink.write ? ownership : undefined;
  const write = owned ? owned.write.bind(sink) : (chunk: Uint8Array) => sink.write(chunk);
  const syncWrite = syncSinks.get(sink);
  const signaledSyncWrite = syncWrite
    ? (chunk: Uint8Array): void => {
        signal.throwIfAborted();
        syncWrite(chunk);
      }
    : undefined;
  const output: ByteSink = {
    ...(sink[outputFailure] ? { [outputFailure]: sink[outputFailure] } : {}),
    ...(sink.ownedOutput ? { ownedOutput: {
      get consumerClosed() { return sink.ownedOutput!.consumerClosed; },
      write(chunk: Uint8Array): Promise<void> {
        try {
          signal.throwIfAborted();
          const capability = sink.ownedOutput!;
          const write = capability.write;
          signal.throwIfAborted();
          const res = Reflect.apply(write, capability, [chunk]);
          if (isSyncResolved(res)) return resolvedVoid;
          return Promise.resolve(res).then(
            () => undefined,
            (error: unknown) => { signal.throwIfAborted(); throw error; },
          );
        } catch (error) {
          return Promise.reject(signal.aborted ? signal.reason : error);
        }
      },
    } } : {}),
    write: signaledSyncWrite
      ? (chunk) => {
          try {
            signaledSyncWrite(chunk);
            return resolvedVoid;
          } catch (error) {
            return Promise.reject(error);
          }
        }
      : (chunk) => {
          try {
            signal.throwIfAborted();
            const pending = write(chunk);
            if (isSyncResolved(pending)) {
              signal.throwIfAborted();
              return resolvedVoid;
            }
            return interruptible(pending, signal);
          } catch (error) {
            return Promise.reject(error);
          }
        },
  };
  if (owned) budgetedSinks.set(output, { ...owned, write: output.write });
  if (signaledSyncWrite) syncSinks.set(output, signaledSyncWrite);
  return output;
}

const admissionGetterSymbol = Symbol("safe-bash.descriptorAdmissionGetter");
const descriptorByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!;

function bindCommandIO(context: CommandContext, io?: IO): void {
  const existingHandlesDesc = Object.getOwnPropertyDescriptor(context, "admittedHandles");
  if (io?.descriptors && (!existingHandlesDesc || (existingHandlesDesc.get ? Boolean((existingHandlesDesc.get as unknown as Record<symbol, unknown>)[admissionGetterSymbol]) : (!existingHandlesDesc.value || shellDescriptorAdmissions.has(existingHandlesDesc.value))))) {
    let handleManager: CommandContext["admittedHandles"];
    let closed = false;
    let finalizerRegistered = false;
    const getAdmittedHandles = (): CommandContext["admittedHandles"] => {
      if (!finalizerRegistered) {
        finalizerRegistered = true;
        io[invocationScope].registerFinalizer(() => {
          closed = true;
        });
      }
      if (!handleManager) {
        let leases: Set<() => Promise<void>> | undefined;
        let closing: Promise<void> | undefined;
        let cleanupRegistered = false;
        handleManager = {
          async acquire(fd: number, requestedRights: readonly import("../contracts/command.js").DescriptorRight[], signal: AbortSignal) {
            signal.throwIfAborted(); context.signal.throwIfAborted();
            if (closed || !Number.isSafeInteger(fd) || fd < 0) throw new FsError("EBADF");
            io[invocationScope].assertOpen();
            if ((leases?.size ?? 0) >= 64) throw new FsError("EMFILE");
            if (!Array.isArray(requestedRights) || !requestedRights.length || requestedRights.length > 4) throw new FsError("EINVAL");
            const rights = Array.from({ length: requestedRights.length }, (_, index) => requestedRights[index]!);
            if (new Set(rights).size !== rights.length || rights.some(right => !["read", "write", "seek", "stat"].includes(right))) throw new FsError("EINVAL");
            // Accessors may retire the frame or acquire more leases while read.
            signal.throwIfAborted(); context.signal.throwIfAborted();
            if (closed) throw new FsError("EBADF");
            io[invocationScope].assertOpen();
            if ((leases?.size ?? 0) >= 64) throw new FsError("EMFILE");
            const descriptor = io.descriptors!.get(fd);
            if (!descriptor || descriptor.closed) throw new FsError("EBADF");
            const input = descriptor.input instanceof ShellInput ? descriptor.input : undefined;
            const file = descriptor.file ?? input?.descriptor;
            if (rights.includes("read") && !input || rights.includes("write") && !descriptor.output) throw new FsError("EBADF");
            if (rights.includes("seek") && !input?.seek) throw new FsError(input && input.stat?.type !== "file" ? "ESPIPE" : "ENOTSUP");
            if (rights.includes("stat") && !file) throw new FsError("ENOTSUP");
            const lifetime = new AbortController();
            let ended = false;
            let completion: Promise<void> | undefined;
            const pending = new Set<Promise<unknown>>();
            leases ??= new Set();
            if (!cleanupRegistered) {
              cleanupRegistered = true;
              context.registerCleanup?.(() => {
                closed = true;
                closing ??= Promise.allSettled([...leases!].map(close => close())).then(results => {
                  const failures = results.filter(result => result.status === "rejected");
                  if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Descriptor lease cleanup failed");
                });
                return closing;
              });
            }
            const close = () => {
              ended = true;
              lifetime.abort(new FsError("EBADF"));
              completion ??= Promise.allSettled([...pending]).then(() => { leases!.delete(close); });
              return completion;
            };
            leases.add(close);
            async function work<T>(callerSignal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
              callerSignal.throwIfAborted(); context.signal.throwIfAborted();
              if (closed || ended) throw new FsError("EBADF");
              if (pending.size >= 16) throw new FsError("EAGAIN");
              const combined = combineManagedSignals(callerSignal, context.signal, lifetime.signal);
              const task = Promise.resolve().then(() => operation(combined));
              pending.add(task);
              void task.finally(() => pending.delete(task)).catch(() => {});
              return task;
            }
            const lease = {
              identity: input?.identity ?? file ?? descriptor.output!,
              ...(rights.includes("write") && descriptor.output?.ownedOutput ? { consumerClosed: descriptor.output.ownedOutput.consumerClosed } : {}),
              ...(rights.includes("read") ? { read: (count: number, caller: AbortSignal) => work(caller, async combined => {
                if (!Number.isSafeInteger(count) || count < 0 || count > 65536) throw new FsError("EINVAL");
                return input!.readAvailable(count, combined);
              }) } : {}),
              ...(rights.includes("write") ? { write: async (bytes: Uint8Array, caller: AbortSignal) => {
                if (!(bytes instanceof Uint8Array) || descriptorByteLength.call(bytes) > 65536) throw new FsError("EINVAL");
                const owned = new Uint8Array(bytes);
                return work(caller, async combined => {
                  const output = descriptor.output!;
                  if (output.ownedOutput) {
                    combined.throwIfAborted();
                    output.ownedOutput.consumerClosed.throwIfAborted();
                    await output.ownedOutput.write(owned);
                  } else await writeBytes(output, owned, combined);
                  return owned.byteLength;
                });
              } } : {}),
              ...(rights.includes("seek") ? { seek: (position: number, caller: AbortSignal) => work(caller, combined => input!.seek!(position, combined)) } : {}),
              ...(rights.includes("stat") ? { stat: (caller: AbortSignal) => work(caller, combined => file!.stat({ signal: combined })) } : {}),
              close,
            };
            if (input) Object.defineProperty(lease, "position", { enumerable: true, get: () => input.position });
            return lease;
          },
        };
      }
      shellDescriptorAdmissions.set(handleManager, [...io.descriptors!.entries()].every(([fd, descriptor]) => (fd >= 0 && fd <= 2) || descriptor.closed === true));
      return handleManager;
    };
    (getAdmittedHandles as unknown as Record<symbol, boolean>)[admissionGetterSymbol] = true;
    Object.defineProperty(context, "admittedHandles", {
      configurable: true,
      enumerable: true,
      get: getAdmittedHandles,
      set(v: CommandContext["admittedHandles"]) { handleManager = v; },
    });
  }
  Object.defineProperties(context, {
    stdinInput: { enumerable: true, get: () => context.stdin instanceof ShellInput ? context.stdin : undefined },
    stdoutFile: { enumerable: true, get: () => {
      const ownership = budgetedSinks.get(context.stdout);
      return ownership?.write === context.stdout.write ? ownership.file : undefined;
    } },
  });
}

class FastShellCommandContext {
  declare stdin: ByteSource;
  declare stdinIsDefault?: boolean | undefined;
  declare stdout: ByteSink;
  declare private _stderr: ByteSink | undefined;
  declare descriptors: ReadonlyMap<number, Descriptor> | undefined;
  declare command: string;
  declare args: readonly string[];
  declare private _env: Record<string, string> | undefined;
  declare cwd: string;
  declare signal: AbortSignal;
  declare onInternalError: CommandContext["onInternalError"];
  declare argv0?: string | undefined;
  declare capabilities?: import("./types.js").ShellCapabilities | undefined;
  declare processSignals?: CommandContext["processSignals"] | undefined;
  declare diagnosticLine?: number | undefined;
  declare scriptName?: string | undefined;
  declare [invocationScope]?: InvocationScope;
  declare [valueScope]?: ValueScope;
  declare readonly _self: FastShellCommandContext | undefined;
  declare private _runtime: Runtime;
  declare private _state: State;
  declare private _io: IO;
  declare private _scope: InvocationScope;
  declare private _scopedSignal: AbortSignal | undefined;
  declare private _contextFs: FileSystem | undefined;
  declare private _cachedPredicates: NonNullable<CommandContext["shellPredicates"]> | undefined;
  declare private _cachedInputBudget: NonNullable<CommandContext["inputBudget"]> | undefined;
  declare private _argumentValues: CommandArguments | undefined;
  declare private _registerCleanup: NonNullable<CommandContext["registerCleanup"]> | undefined;
  declare private _invoke: ShellCommandContext["invoke"] | undefined;

  constructor(
    runtime: Runtime,
    state: State,
    io: IO,
    scope: InvocationScope,
    name: string,
    args: readonly string[],
    argumentValues: CommandArguments | undefined,
    env: Record<string, string> | undefined,
    signalIsScoped: boolean,
  ) {
    const directContext = FAST_DIRECT_CONTEXT_COMMANDS.has(name) || (name === "find" && !args.includes("-exec") && !args.includes("-ok"));
    if (!directContext) {
      const { [invocationScope]: _scope, [valueScope]: _allocation, [declarationArrays]: _arrays, argumentValues: _arguments, ...publicIO } = io as IO & { argumentValues?: unknown };
      Object.defineProperties(this, Object.getOwnPropertyDescriptors(publicIO));
    }
    this._self = this;
    this._runtime = runtime;
    this._state = state;
    this._io = io;
    this._scope = scope;
    this._scopedSignal = signalIsScoped ? runtime.signal : undefined;
    this.stdin = io.stdin;
    this.stdinIsDefault = io.stdinIsDefault;
    this.stdout = io.stdout;
    this._stderr = signalIsScoped ? undefined : io.stderr;
    this.descriptors = io.descriptors;
    this.command = name;
    this.args = args;
    this._argumentValues = argumentValues;
    this._env = env;
    this.cwd = state.cwd;
    this.signal = runtime.commandSignal;
    this.onInternalError = runtime.budget.onInternalError;
    this.argv0 = io.argv0;
    this.capabilities = io.capabilities;
    this.processSignals = io.processSignals;
    this.diagnosticLine = io.diagnosticLine;
    this.scriptName = io.scriptName;
    if (directContext) {
      return;
    }
    workerRuntimeContexts.set(this as unknown as CommandContext, {
      budget: runtime.budget, umask: state.umask ?? 0o022,
      ignoredSignals: captureIgnoredTrapSignals(state.extensions),
      get fs() { return runtime.getContextFsForFast(0, combineManagedSignals(runtime.signal, scope.signal)); },
    });
    for (const [key, descriptor] of fastShellCommandAccessors) {
      Object.defineProperty(this, key, {
        ...descriptor,
        enumerable: true,
        get: descriptor.get!.bind(this),
        ...(descriptor.set ? { set: descriptor.set.bind(this) } : {}),
      });
    }
    bindCommandIO(this as unknown as CommandContext, { ...io, [invocationScope]: scope });
    void this.registerCleanup;
  }

  resetDirectStage(
    runtime: Runtime,
    state: State,
    io: IO,
    scope: InvocationScope,
    name: string,
    args: readonly string[],
    stdin: ByteSource,
    stdinIsDefault: boolean,
    stdout: ByteSink,
    signal: AbortSignal,
  ): void {
    this._runtime = runtime;
    this._state = state;
    this._io = io;
    this._scope = scope;
    this._scopedSignal = signal;
    this._contextFs = undefined;
    this._cachedPredicates = undefined;
    this._cachedInputBudget = undefined;
    this._argumentValues = undefined;
    this._env = undefined;
    this._registerCleanup = undefined;
    this._invoke = undefined;
    this.stdin = stdin;
    this.stdinIsDefault = stdinIsDefault;
    this.stdout = stdout;
    this._stderr = undefined;
    this.descriptors = io.descriptors;
    this.command = name;
    this.args = args;
    this.cwd = state.cwd;
    this.signal = signal;
    this.onInternalError = runtime.budget.onInternalError;
    this.argv0 = io.argv0;
    this.capabilities = io.capabilities;
    this.processSignals = io.processSignals;
    this.diagnosticLine = io.diagnosticLine;
    this.scriptName = io.scriptName;
  }

  static {
    Object.assign(FastShellCommandContext.prototype, {
      _self: undefined,
      _env: undefined,
      _scopedSignal: undefined,
      _contextFs: undefined,
      _cachedPredicates: undefined,
      _cachedInputBudget: undefined,
      _argumentValues: undefined,
      _registerCleanup: undefined,
      _invoke: undefined,
      descriptors: undefined,
      onInternalError: undefined,
      argv0: undefined,
      processSignals: undefined,
      diagnosticLine: undefined,
      scriptName: undefined,
    });
  }

  registerScopeCleanup(cleanup: Parameters<NonNullable<CommandContext["registerCleanup"]>>[0]): () => void {
    return (this._self ?? this)._scope.register(cleanup);
  }

  registerScopeCleanupDirect(cleanup: Parameters<NonNullable<CommandContext["registerCleanup"]>>[0]): void {
    (this._self ?? this)._scope.registerDirect(cleanup);
  }

  unregisterScopeCleanupDirect(cleanup: Parameters<NonNullable<CommandContext["registerCleanup"]>>[0]): void {
    (this._self ?? this)._scope.unregisterDirect(cleanup);
  }

  get _fastMemoryBackingFs(): FileSystem | undefined {
    const self = this._self ?? this;
    return !self._contextFs && self._runtime._isMemoryBackingFs
      ? (self._runtime as unknown as { backingFs: FileSystem }).backingFs
      : undefined;
  }

  _chargeFastFsOp(): void {
    const self = this._self ?? this;
    self._getScopedSignal().throwIfAborted();
    self._runtime.budget.fileSystemOperation();
  }

  get _hasInfiniteFsOpsLimit(): boolean {
    return (this._self ?? this)._runtime.budget.limits.maxFileSystemOperations === Infinity;
  }

  get argumentValues(): CommandArguments | undefined {
    return (this._self ?? this)._argumentValues;
  }

  set argumentValues(replacement: CommandArguments | undefined) {
    (this._self ?? this)._argumentValues = replacement;
  }

  get registerCleanup(): NonNullable<CommandContext["registerCleanup"]> {
    const self = this._self ?? this;
    if (!self._registerCleanup) {
      const scope = self._scope;
      const runtime = self._runtime;
      self._registerCleanup = cleanup => scope.register(cleanup);
      bindFileOutputBudget(
        self as unknown as Pick<CommandContext, "registerCleanup">,
        sink => runtime.budget.sink(sink, self._getScopedSignal()),
        (chunk, write) => runtime.budget.writeCounted(chunk, write, self._getScopedSignal()),
      );
    }
    return self._registerCleanup;
  }

  set registerCleanup(replacement: NonNullable<CommandContext["registerCleanup"]>) {
    (this._self ?? this)._registerCleanup = replacement;
  }

  get invoke(): ShellCommandContext["invoke"] {
    const self = this._self ?? this;
    return self._invoke ??= (cmdName, cmdArgs, options) =>
      self._runtime.invokeFromFastContext(cmdName, cmdArgs, options, self as unknown as ShellCommandContext, self._state, self._scope);
  }

  set invoke(replacement: ShellCommandContext["invoke"]) {
    (this._self ?? this)._invoke = replacement;
  }

  private _getScopedSignal(): AbortSignal {
    return this._scopedSignal ??= combineManagedSignals(this._runtime.signal, this._scope.signal);
  }

  get executionScope(): CommandContext["executionScope"] {
    return (this._self ?? this)._runtime.budget.executionScope;
  }

  get stderr(): ByteSink {
    const self = this._self ?? this;
    return self._stderr ??= (self._scopedSignal ? signalSink(self._io.stderr, self._scopedSignal) : self._io.stderr);
  }

  set stderr(value: ByteSink) {
    (this._self ?? this)._stderr = value;
  }

  get env(): Record<string, string> {
    const self = this._self ?? this;
    if (!self._env) {
      const state = self._state;
      const raw = (stateMonitor(state)?.raw ?? state) as State & { _exported?: Set<string> };
      const built = Object.create(null) as Record<string, string>;
      if (raw._exported === undefined && "_exported" in raw) {
        const pwd = raw.variables.PWD;
        if (pwd !== undefined) built.PWD = pwd;
      } else {
        for (const key of raw.exported) {
          const value = raw.variables[key];
          if (value !== undefined) built[key] = value;
        }
      }
      if (raw.exportedFunctions) {
        for (const key of raw.exportedFunctions) {
          const body = raw.functions.get(key);
          if (body) built[`BASH_FUNC_${key}%%`] = functionDisplay(key, body).slice(key.length + 1).trimEnd();
        }
      }
      self._env = built;
    }
    return self._env;
  }

  set env(value: Record<string, string>) {
    (this._self ?? this)._env = value;
  }

  get fs(): FileSystem {
    const self = this._self ?? this;
    if (!self._contextFs && self._runtime._isMemoryBackingFs) {
      return self._runtime.getContextFsForFast(self._state.umask ?? 0o022, self._getScopedSignal());
    }
    if (!self._contextFs) {
      self._contextFs = self._runtime.getContextFsForFast(self._state.umask ?? 0o022, self._getScopedSignal());
    }
    return self._contextFs;
  }

  set fs(replacement: FileSystem) {
    (this._self ?? this)._contextFs = replacement;
  }

  get shellPredicates(): NonNullable<CommandContext["shellPredicates"]> {
    const self = this._self ?? this;
    if (!self._cachedPredicates) {
      self._cachedPredicates = self._runtime.createShellPredicatesForFast(self._state, self._io);
    }
    return self._cachedPredicates;
  }

  set shellPredicates(replacement: NonNullable<CommandContext["shellPredicates"]>) {
    (this._self ?? this)._cachedPredicates = replacement;
  }

  get inputBudget(): NonNullable<CommandContext["inputBudget"]> {
    const self = this._self ?? this;
    return self._cachedInputBudget ??= self._runtime.createInputBudgetForFast();
  }

  set inputBudget(replacement: NonNullable<CommandContext["inputBudget"]>) {
    (this._self ?? this)._cachedInputBudget = replacement;
  }

  get stdinInput(): ShellInput | undefined {
    return this.stdin instanceof ShellInput ? this.stdin : undefined;
  }

  get stdoutFile(): CommandContext["stdoutFile"] {
    const ownership = budgetedSinks.get(this.stdout);
    return ownership?.write === this.stdout.write ? ownership.file : undefined;
  }

}
Object.assign(FastShellCommandContext.prototype, {
  _self: undefined,
  _stderr: undefined,
  stdinIsDefault: undefined,
  descriptors: undefined,
  onInternalError: undefined,
  argv0: undefined,
  capabilities: undefined,
  processSignals: undefined,
  diagnosticLine: undefined,
  scriptName: undefined,
  _scopedSignal: undefined,
  _contextFs: undefined,
  _cachedPredicates: undefined,
  _cachedInputBudget: undefined,
  _argumentValues: undefined,
  _registerCleanup: undefined,
  _invoke: undefined,
});

const FAST_DIRECT_CONTEXT_COMMANDS = new Set([
  "rm", "mkdir", "rg", "sed", "awk", "jq", "sort", "head", "tr", "grep", "cut", "wc", "uniq",
]);
function isFastDirectCommand(name: string, words: readonly Word[]): boolean {
  if (FAST_DIRECT_CONTEXT_COMMANDS.has(name)) return true;
  if (name !== "find") return false;
  for (let i = 1; i < words.length; i++) {
    const p = words[i]!.plain;
    if (p === "-exec" || p === "-ok") return false;
  }
  return true;
}

const fastShellCommandAccessors = ["env", "fs", "shellPredicates", "inputBudget", "executionScope", "registerCleanup", "invoke", "argumentValues", "stdinInput", "stdoutFile"].map(
  key => [key, Object.getOwnPropertyDescriptor(FastShellCommandContext.prototype, key)!] as const,
);

function cloneRawState(raw: State, hasLocals: boolean): State {
  const variables = Object.assign(Object.create(null) as Record<string, string>, raw.variables);
  const exported = raw.exported.size ? new Set(raw.exported) : new Set<string>();
  const hasFunctions = raw instanceof RootShellState ? Boolean(raw._functions?.size) : raw.functions.size > 0;
  const cloned: State = Object.assign(
    new RootShellState(raw.cwd, variables, exported, raw.extensions),
    raw,
  );
  // Root accessors must resolve against the clone while installing its collections.
  (cloned as unknown as Record<symbol, unknown>)[monitorSymbol] = undefined;
  Object.assign(
    cloned,
    {
      variables,
      exported,
      _functions: hasFunctions ? new Map(raw.functions) : undefined,
      positional: [...raw.positional],
      directoryStack: raw.directoryStack
        ? {
            entries: raw.directoryStack.entries.length ? [...raw.directoryStack.entries] : [],
            bytes: raw.directoryStack.bytes,
          }
        : undefined,
      locals: hasLocals
        ? raw.locals.map((scope) => new Map([...scope].map(([name, saved]) => [name, { ...saved, ...(saved.getopts ? { getopts: { integer: saved.getopts.integer, cursor: cloneGetoptsState(saved.getopts.cursor) } } : {}) }])))
        : [],
    },
  );
  if (raw.exportedFunctions) cloned.exportedFunctions = new Set(raw.exportedFunctions);
  if (raw.readonlyVariables) cloned.readonlyVariables = new Set(raw.readonlyVariables);
  if (raw.readonlyFunctions) cloned.readonlyFunctions = new Set(raw.readonlyFunctions);
  if (raw.variableAttributes) cloned.variableAttributes = new Map(raw.variableAttributes);
  if (raw.getopts) cloned.getopts = cloneGetoptsBinding(raw);
  if (raw.functionNames) cloned.functionNames = [...raw.functionNames];
  return cloned;
}

function tryCloneStateSync(state: State, scope?: InvocationScope, inheritLocals = true): State | undefined {
  const raw = stateMonitor(state)?.raw ?? state;
  if (scope || inheritLocals && raw.locals.length > 0) return undefined;
  return trySnapshotStateSync(state, () => cloneRawState(raw, false));
}

async function cloneState(state: State, signal: AbortSignal, scope?: InvocationScope, inheritLocals = true): Promise<State> {
  const syncClone = tryCloneStateSync(state, scope, inheritLocals);
  if (syncClone) return syncClone;
  const raw = stateMonitor(state)?.raw ?? state;
  const hasLocals = inheritLocals && raw.locals.length > 0;
  const destination = await snapshotState(state, () => cloneRawState(raw, hasLocals), signal, hasLocals ? async (destination, owner) => {
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
  } : undefined, scope);
  try {
    for (const frame of destination.locals) for (const saved of frame.values()) {
      if (saved.heldValue) saved.heldValue = stateMonitor(destination)!.values.scope.hold(saved.heldValue.value);
    }
    return destination;
  } catch (error) { stateMonitor(destination)?.closeValues(); throw error; }
}

function cloneGetoptsBinding(state: State): GetoptsBinding {
  return { cursor: state.getopts ? cloneGetoptsState(state.getopts.cursor) : createGetoptsState(), integer: state.getopts?.integer ?? true };
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
  return { attributes: state.variableAttributes?.get(name), value: state.variables[name], ...(heldValue ? { heldValue } : {}), exported: state.exported.has(name), readOnly: state.readonlyVariables?.has(name) ?? false, ...(name === "OPTIND" ? { getopts: cloneGetoptsBinding(state) } : {}) };
}

function publishVariable(state: State, name: string, value: ShellValue): void {
  const monitor = stateMonitor(state);
  if (monitor) {
    if (typeof value === "string") {
      monitor.publishStringVariable(name, value);
      return;
    }
    const text = shellValueText(value);
    monitor.values.publish(name, value, () => { state.variables[name] = text; return true; });
    return;
  }
  state.variables[name] = shellValueText(value);
}

async function restoreVariable(state: State, name: string, saved: SavedVariable): Promise<void> {
  try {
  if (saved.attributes !== undefined) { state.variableAttributes ??= new Map(); state.variableAttributes.set(name, saved.attributes); }
  else state.variableAttributes?.delete(name);
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

function isShellIdentifier(name: string): boolean {
  if (!name) return false;
  for (let index = 0; index < name.length; index++) {
    const code = name.charCodeAt(index);
    if (code === 95 || code >= 65 && code <= 90 || code >= 97 && code <= 122 || index > 0 && code >= 48 && code <= 57) continue;
    return false;
  }
  return true;
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

function message(error: unknown, onInternalError?: InternalErrorHandler): string {
  if (error instanceof ExpansionFailure || error instanceof CommandFailure || error instanceof ArrayFailure || error instanceof BraceExpansionFailure) return error.message;
  return publicDiagnosticMessage(error, onInternalError);
}

function filesystemDiagnostic(error: unknown, target: string, onInternalError?: InternalErrorHandler): string | undefined {
  const descriptions: Readonly<Record<string, string>> = { ENOENT: "No such file or directory", EACCES: "Permission denied", EPERM: "Operation not permitted", ENOTDIR: "Not a directory", EISDIR: "Is a directory", ELOOP: "Too many levels of symbolic links", ENOSPC: "No space left on device", EROFS: "Read-only file system" };
  const description = descriptions[errorCode(error) ?? ""];
  if (!description) return undefined;
  publicDiagnosticMessage(error, onInternalError);
  return `${target}: ${description}`;
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

  async charge(amount: number): Promise<void> {
    this.signal.throwIfAborted();
    if (amount > 8_388_608 - this.spent) throw new PublicDiagnostic("cd: helper work limit exceeded");
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
      if (bytes + width > 65_536) throw new PublicDiagnostic(search ? "cd: CDPATH exceeds 65536 UTF-8 bytes" : "cd: path exceeds 65536 UTF-8 bytes");
      if (search && codePoint === 58 && ++slots > 4096) throw new PublicDiagnostic("cd: CDPATH exceeds 4096 components");
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

  async find(fs: FileSystem, cwd: string, target: string, cdpath: string | undefined, physical: boolean): Promise<{ path: string; print?: string }> {
    const targetBytes = (await this.scan(target)).bytes;
    const absolute = target.startsWith("/");
    const cwdBytes = absolute ? 0 : (await this.scan(cwd)).bytes;
    const eligible = !absolute && target !== "." && target !== ".." && !target.startsWith("./") && !target.startsWith("../");
    const search = eligible && cdpath ? await this.scan(cdpath, true) : undefined;
    const probe = async (component: string, componentBytes: number): Promise<{ path: string; print?: string }> => {
      const rawBytes = absolute ? targetBytes : component.startsWith("/") ? componentBytes + 1 + targetBytes
        : cwdBytes + 1 + (component ? componentBytes + 1 : 0) + targetBytes;
      if (rawBytes > 65_536) throw new PublicDiagnostic("cd: path exceeds 65536 UTF-8 bytes");
      await this.charge(2 * rawBytes);
      const raw = absolute ? target : pathOf({ cwd }, component ? `${component}/${target}` : target);
      let path = resolvePath(cwd, raw);
      const operand = physical ? raw : path;
      if (!physical) {
        const components: string[] = [];
        for (const component of raw.split("/")) {
          await this.charge(1);
          if (component === "..") {
            // A logical parent removes the preceding component only after
            // checking that it names a directory, including links.
            await this.charge(rawBytes);
            const parent = `/${components.join("/")}`;
            const stat = await fs.stat(parent, { signal: this.signal });
            this.signal.throwIfAborted();
            if (stat.type !== "directory") throw new FsError("ENOTDIR", { path: parent });
            components.pop();
          } else if (component && component !== ".") components.push(component);
        }
      }
      await this.scan(path);
      this.signal.throwIfAborted();
      if (++this.probes > 4097) throw new PublicDiagnostic("cd: probe limit exceeded");
      await this.charge(1);
      this.signal.throwIfAborted();
      const stat = await fs.stat(operand, { signal: this.signal });
      this.signal.throwIfAborted();
      if (stat.type !== "directory") throw new FsError("ENOTDIR", { path });
      await this.charge(1);
      this.signal.throwIfAborted();
      await fs.access(operand, ACCESS_MODES.X_OK, { signal: this.signal });
      this.signal.throwIfAborted();
      if (physical) {
        await this.charge(1);
        path = await fs.realpath(operand, { signal: this.signal });
        this.signal.throwIfAborted();
        await this.scan(path);
      }
      return {
        path,
        ...(component ? { print: physical ? `${component}${component.endsWith("/") ? "" : "/"}${target}` : path } : {}),
      };
    };
    for (const component of search?.components ?? []) {
      try {
        return await probe(cdpath!.slice(component.start, component.end), component.bytes);
      } catch (error) {
        this.signal.throwIfAborted();
        if (!(error instanceof FsError) || !["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) throw error;
      }
    }
    return probe("", 0);
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

const closedSink: ByteSink = { async write() { throw Object.assign(new PublicDiagnostic("Bad file descriptor"), { code: "EBADF" }); } };
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
        throw Object.assign(new PublicDiagnostic("Bad file descriptor"), { code: "EBADF" });
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
  private _records: Set<InvokeOutcomeRecord> | undefined;
  private _diagnostics: WeakMap<object, NounsetDiagnosticFailure> | undefined;
  private _closed = false;

  recordDiagnostic(promise: Promise<CommandResult>, failure: NounsetDiagnosticFailure): void {
    if (!this._closed) (this._diagnostics ??= new WeakMap()).set(promise, failure);
  }

  consumeDiagnostic(rawReturn: unknown): NounsetDiagnosticFailure | undefined {
    if (!this._diagnostics) return undefined;
    if (rawReturn === null || typeof rawReturn !== "object" && typeof rawReturn !== "function") return undefined;
    const failure = this._diagnostics.get(rawReturn);
    this._diagnostics.delete(rawReturn);
    return failure;
  }

  bind(promise: Promise<CommandResult>, boundary: CancellationBoundary): InvokeOutcomeRecord {
    if (this._closed) throw new Error("Cancellation outcome admission is closed");
    const record: InvokeOutcomeRecord = { promise, boundary, finalized: false, consumed: false };
    (this._records ??= new Set()).add(record);
    return record;
  }

  finalize(record: InvokeOutcomeRecord, selection: CancellationSelection<CommandResult>): void {
    if (record.consumed || !this._records?.has(record)) return;
    record.selection = selection;
    record.finalized = true;
  }

  consume(rawReturn: unknown, capturedReason: unknown): CancellationReport | undefined {
    if (!this._records) return undefined;
    for (const record of this._records) {
      if (record.promise !== rawReturn) continue;
      record.consumed = true;
      this._records.delete(record);
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
    this._records?.delete(record);
  }

  close(): void {
    this._closed = true;
    if (this._records) {
      for (const record of this._records) record.consumed = true;
      this._records.clear();
    }
    this._diagnostics = undefined;
  }
}

interface CancellationAdmissionOwner {
  assertAdmissionOpen(): void;
}

class InvocationCancellationOwner implements CancellationAdmissionOwner, CancellationOwnerSubscriber {
  declare readonly kind: "callback";
  declare active: boolean;
  declare private readonly _parent: InvocationScope;
  declare readonly prepared: PreparedChildCancellation;
  declare private readonly _outcomes: RuntimeCancellationState;
  declare private readonly _publicPromise: Promise<CommandResult> | undefined;
  declare private _finalizedPromise: Promise<void> | undefined;
  declare private _resolveFinalized: (() => void) | undefined;
  declare private _completed: boolean;
  declare private _admissionOpen: boolean;
  declare private _boundary: CancellationBoundary | undefined;
  declare private _boundaryClosed: boolean;
  declare private _record: InvokeOutcomeRecord | undefined;
  declare private _observedOrigin: CancellationOrigin | undefined;
  declare private _resolveCapture: ((captured: CapturedCancellationOutcome<CommandResult>) => void) | undefined;
  declare private _rawPromise: Promise<CommandResult> | undefined;
  declare private _outcomeFrame: RuntimeOutcomeFrame | undefined;
  declare private _settled: boolean;
  declare private _queuedOrigin: boolean;
  declare private _finish: Promise<CancellationSelection<CommandResult>> | undefined;

  constructor(
    parent: InvocationScope,
    prepared: PreparedChildCancellation,
    outcomes: RuntimeCancellationState,
    publicPromise?: Promise<CommandResult>,
  ) {
    this._parent = parent;
    this.prepared = prepared;
    this._outcomes = outcomes;
    this._publicPromise = publicPromise;
    parent.addChildOwner(this);
  }

  _onScopeClose(): Promise<void> | undefined {
    this.requestClose();
    if (!this._completed) {
      return (this._finalizedPromise ??= new Promise<void>(resolve => { this._resolveFinalized = resolve; }));
    }
    return undefined;
  }

  assertAdmissionOpen(): void {
    if (!this._admissionOpen) throw new Error("Cancellation invocation admission is closed");
  }

  requestClose(): void { this._admissionOpen = false; }

  activate(subscribe = true): CancellationBoundary {
    this.assertAdmissionOpen();
    const boundary = activateChildCancellation(this.prepared);
    this._boundary = boundary;
    try {
      if (subscribe) {
        subscribeCancellationOwner(boundary, this);
      } else {
        admitCancellationSubscriptionCapacity(boundary);
      }
      if (this._publicPromise) this._record = this._outcomes.bind(this._publicPromise, boundary);
      return boundary;
    } catch (error) {
      this._closeBoundary();
      throw error;
    }
  }

  callback(origin: CancellationOrigin): void {
    if (!this._resolveCapture || this._settled || this._queuedOrigin) return;
    this._queuedOrigin = true;
    queueMicrotask(() => {
      if (this._settled) return;
      this._settled = true;
      this._observedOrigin = origin;
      const resolve = this._resolveCapture;
      this._resolveCapture = undefined;
      this._outcomeFrame = undefined;
      resolve?.({ kind: "throw", reason: origin.signal.reason });
      void this._rawPromise?.catch(() => undefined);
    });
  }

  private _settleReturn(value: CommandResult): void {
    if (this._settled) return;
    this._settled = true;
    const resolve = this._resolveCapture;
    this._resolveCapture = undefined;
    this._outcomeFrame = undefined;
    resolve?.({ kind: "return", value });
  }

  private _settleThrow(reason: unknown): void {
    if (this._settled) return;
    this._settled = true;
    const resolve = this._resolveCapture;
    const frame = this._outcomeFrame;
    this._resolveCapture = undefined;
    this._outcomeFrame = undefined;
    resolve?.(frame?.report && Object.is(frame.report.origin.signal.reason, reason)
      ? { kind: "throw", reason, report: frame.report }
      : { kind: "throw", reason });
  }

  capture(
    execute: () => Promise<CommandResult>,
    frame: RuntimeOutcomeFrame,
  ): Promise<CapturedCancellationOutcome<CommandResult>> {
    this._outcomeFrame = frame;
    let raw: Promise<CommandResult>;
    try { raw = Promise.resolve(execute()); }
    catch (reason) {
      this._settled = true;
      this._outcomeFrame = undefined;
      return Promise.resolve({ kind: "throw", reason });
    }
    this._rawPromise = raw;
    return new Promise(resolve => {
      this._resolveCapture = resolve;
      void raw.then(
        value => { this._settleReturn(value); },
        reason => { this._settleThrow(reason); },
      );
      if (this._settled) void raw.catch(() => undefined);
    });
  }

  finish(barrier: Promise<void>, captured: CapturedCancellationOutcome<CommandResult>): Promise<CancellationSelection<CommandResult>> {
    this._finish ??= this._finishOnce(barrier, captured);
    return this._finish;
  }

  finishSync(captured: CapturedCancellationOutcome<CommandResult>): CancellationSelection<CommandResult> {
    this.requestClose();
    try {
      this._closeBoundary();
      const selection = selectRuntimeCancellationOutcome(this._boundary!, captured, this._observedOrigin);
      if (this._record) this._outcomes.finalize(this._record, selection);
      return selection;
    } finally {
      this._completed = true;
      this._resolveFinalized?.();
      this._parent.removeChildOwner(this);
    }
  }

  async abandon(barrier: Promise<void>): Promise<void> {
    this.requestClose();
    try { await barrier; }
    finally {
      this._outcomes.discard(this._record);
      this._closeBoundary();
      this._completed = true;
      this._resolveFinalized?.();
      this._parent.removeChildOwner(this);
    }
  }

  private async _finishOnce(barrier: Promise<void>, captured: CapturedCancellationOutcome<CommandResult>): Promise<CancellationSelection<CommandResult>> {
    this.requestClose();
    try {
      await barrier;
      this._closeBoundary();
      const selection = selectRuntimeCancellationOutcome(this._boundary!, captured, this._observedOrigin);
      if (this._record) this._outcomes.finalize(this._record, selection);
      return selection;
    } finally {
      this._completed = true;
      this._resolveFinalized?.();
      this._parent.removeChildOwner(this);
    }
  }

  private _closeBoundary(): void {
    if (!this._boundary || this._boundaryClosed) return;
    this._boundaryClosed = true;
    if (this.active) {
      try { unsubscribeCancellationOwner(this._boundary, this); } catch (error) { this._parent.failures.push(error); }
    }
    const result = this._boundary.close();
    if (result.failures.length > 0) this._parent.failures.push(...result.failures);
  }
}
Object.assign(InvocationCancellationOwner.prototype, {
  kind: "callback",
  active: false,
  _finalizedPromise: undefined,
  _resolveFinalized: undefined,
  _completed: false,
  _admissionOpen: true,
  _boundary: undefined,
  _boundaryClosed: false,
  _record: undefined,
  _observedOrigin: undefined,
  _resolveCapture: undefined,
  _rawPromise: undefined,
  _outcomeFrame: undefined,
  _settled: false,
  _queuedOrigin: false,
  _finish: undefined,
});

const mapfileCallbackStates = new WeakSet<State>();
const runtimeFileSystems = new WeakMap<FileSystem, FileSystem>();
const reusableDefaultContextFsBySourceFs = new WeakMap<FileSystem, { scoped: FileSystem; inUseBy: Runtime | undefined }>();
const noopFsCharge = (): void => {};
const NEVER_ABORTED_SIGNAL = Object.freeze({
  aborted: false,
  reason: undefined,
  onabort: null,
  throwIfAborted(): void {},
  addEventListener(): void {},
  removeEventListener(): void {},
  dispatchEvent(): boolean { return true; },
}) as unknown as AbortSignal;

export function warmDefaultRuntimeContextFs(sourceFs: FileSystem, backingFs: FileSystem): void {
  if (reusableDefaultContextFsBySourceFs.has(sourceFs)) return;
  const created = scopeFileSystem(
    creationFileSystem(sourceFs, 0o022),
    noopFsCharge,
    NEVER_ABORTED_SIGNAL,
    noopFsCharge,
    { maxPathComponents: 256 },
  );
  runtimeFileSystems.set(created, sourceFs);
  registerRuntimeBackingFileSystem(created, backingFs);
  void created.capabilities;
  void created.readFile;
  void created.stat;
  void created.lstat;
  void created.readdir;
  void created.realpath;
  void created.readStream;
  void created.openReadFile;
  void created.writeFile;
  void created.appendFile;
  void created.mkdir;
  void created.rm;
  reusableDefaultContextFsBySourceFs.set(sourceFs, { scoped: created, inUseBy: undefined });
}
import { abortManagedController, addAbortSignalWaiter, combineManagedSignals, createManagedControlController, getRuntimeBackingFileSystem, interruptible, isSyncResolved, registerManagedAbortSignal, registerRuntimeBackingFileSystem, removeAbortSignalWaiter, type ManagedControlController } from "../fs/creation-mask.js";
export { getRuntimeBackingFileSystem, interruptible, registerRuntimeBackingFileSystem };
const emptyWords: readonly Word[] = [];
const emptyShellValues: readonly ShellValue[] = [];
const emptyStrings: readonly string[] = [];
const emptySavedVariables = new Map<string, SavedVariable>();
const emptyInputs = new Set<{ close(): void | Promise<void> }>();
const emptyOutputs = new Set<OutputFinalizer>();
const singleStatusZero: readonly number[] = [0];
const singleStatusOne: readonly number[] = [1];
const syncRestorationCharge = { epoch: true, metadata: 64, work: 8 } as const;
const syncRestorationTickets = { generation: 0, version: 0, epoch: 0 };
const syncPipeStatusCharge = { generation: true, version: true, epoch: true, work: 8 } as const;
const syncPipeStatusTickets = { generation: 0, version: 0, epoch: 0 };
const predicateScratchWords: string[] = [];
const fastSharedTextEncoder = new TextEncoder();
let _lastFastContextAnchor: unknown;
let _lastPipelineAnchor: unknown;
let _sharedEmptyMemoryFs: FileSystem | undefined;
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const assignmentCacheSymbol = Symbol("safe-bash.assignmentCache");
let fallbackAssignmentCache: WeakMap<Word, { name: string; value: Word; append: boolean } | null> | undefined;
const assignmentCache = {
  get(word: Word): { name: string; value: Word; append: boolean } | null | undefined {
    const val = (word as unknown as Record<symbol, { name: string; value: Word; append: boolean } | null | undefined>)[assignmentCacheSymbol];
    return val !== undefined ? val : fallbackAssignmentCache?.get(word);
  },
  set(word: Word, value: { name: string; value: Word; append: boolean } | null): void {
    if (Object.isExtensible(word)) {
      (word as unknown as Record<symbol, { name: string; value: Word; append: boolean } | null>)[assignmentCacheSymbol] = value;
    } else {
      (fallbackAssignmentCache ??= new WeakMap()).set(word, value);
    }
  },
};

function hasGlobOrEscape(text: string, extglob = false): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 42 || code === 63 || code === 91 || code === 92) return true;
    if (extglob && code === 40 && i > 0) {
      const prev = text.charCodeAt(i - 1);
      if (prev === 63 || prev === 42 || prev === 43 || prev === 64 || prev === 33) return true;
    }
  }
  return false;
}

let nextProcessSubstitutionId = 0;
let defaultRuntimeMuscleMemoryMap: ReadonlyMap<string, CommandDefinition> | undefined;

function getRuntimeMuscleMemoryCommand(name: string): CommandDefinition | undefined {
  defaultRuntimeMuscleMemoryMap ??= new Map([...createBcCommands(), ...createSpongeCommands(), ...createFdCommands(), ...createLessCommands()].map(cmd => [cmd.name, cmd]));
  return defaultRuntimeMuscleMemoryMap.get(name);
}
const fastSubScratchArgs: string[] = [];
const fastRedirectScratchBytes = new Uint8Array(8192);
const fastRedirectScratchViews: Uint8Array[] = Array.from({ length: 129 }, (_, len) => fastRedirectScratchBytes.subarray(0, len));

function encodeRedirectTextToScratch(formatted: string): Uint8Array {
  const len = formatted.length;
  if (len <= 128) {
    let ascii = true;
    for (let i = 0; i < len; i++) {
      const code = formatted.charCodeAt(i);
      if (code >= 128) {
        ascii = false;
        break;
      }
      fastRedirectScratchBytes[i] = code;
    }
    if (ascii) return fastRedirectScratchViews[len]!;
  }
  return len * 3 <= fastRedirectScratchBytes.byteLength
    ? fastRedirectScratchBytes.subarray(0, fastSharedTextEncoder.encodeInto(formatted, fastRedirectScratchBytes).written)
    : Buffer.from(formatted, "utf8");
}

function encodeRedirectTextWithNewlineToScratch(arg0: string): Uint8Array | undefined {
  const len = arg0.length;
  if (len < 128) {
    for (let i = 0; i < len; i++) {
      const code = arg0.charCodeAt(i);
      if (code >= 128) return undefined;
      fastRedirectScratchBytes[i] = code;
    }
    fastRedirectScratchBytes[len] = 10;
    return fastRedirectScratchViews[len + 1]!;
  }
  return undefined;
}

interface IntLoopStep {
  readonly name: string;
  readonly program: ArithmeticProgram;
  readonly compiled: CompiledSmiExpr;
  readonly varRegMap: number[];
  targetReg: number;
  readonly isSub: boolean;
  readonly extraNewlineByte: number;
}

function intDecimalLength(n: number): number {
  let v = n;
  let len = 0;
  if (v < 0) {
    len = 1;
    v = -v;
  }
  if (v < 10) return len + 1;
  if (v < 100) return len + 2;
  if (v < 1000) return len + 3;
  if (v < 10000) return len + 4;
  if (v < 100000) return len + 5;
  if (v < 1000000) return len + 6;
  if (v < 10000000) return len + 7;
  if (v < 100000000) return len + 8;
  return len + 9;
}

function sameRedirectTargetWord(a: Word, b: Word): boolean {
  if (a === b) return true;
  if (a.parts.length !== b.parts.length) return false;
  for (let i = 0; i < a.parts.length; i++) {
    const pa = a.parts[i]!;
    const pb = b.parts[i]!;
    if (pa.kind !== pb.kind || pa.quoted !== pb.quoted) return false;
    if (pa.kind === "text" && pb.kind === "text") {
      if (pa.value !== pb.value) return false;
    } else if (pa.kind === "variable" && pb.kind === "variable") {
      if (pa.name !== pb.name) return false;
    } else {
      return false;
    }
  }
  return true;
}

type SyncLoopStep = {
  readonly cmd: Extract<Command, { kind: "simple" }>;
  readonly name: string | undefined;
  readonly value: Word | undefined;
  readonly targetWord: Word | undefined;
  readonly targetDirPrefix?: string | undefined;
  readonly targetNamePrefix?: string | undefined;
  readonly append: boolean;
  readonly line: number;
  coalesceNext?: boolean;
};

const intLoopStepCache = new WeakMap<Command, IntLoopStep | null>();
const sharedSyncLoopTouched = new Set<string>();
const sharedSyncLoopArithNames = new Set<string>();
const sharedSyncLoopRegNames: string[] = [];
const sharedSyncLoopIntSteps: (IntLoopStep | undefined)[] = [];
let cachedRedirectNamePrefix = "";
let cachedRedirectNameSuffix = "";
let cachedRedirectNameTable: (string | undefined)[] = new Array(256);

const SYNC_UNIT_ZERO: { readonly exitCode: number; readonly terminated: boolean } = Object.freeze({ exitCode: 0, terminated: false });
const SYNC_UNIT_ONE: { readonly exitCode: number; readonly terminated: boolean } = Object.freeze({ exitCode: 1, terminated: false });

const EMPTY_BYTES = new Uint8Array(0);
const SYNC_PIPE_DONE_RESULT: IteratorResult<Uint8Array> = Object.freeze({ done: true, value: undefined });
const sharedSyncPipeBuf0 = new Uint8Array(65536);
const sharedSyncPipeBuf1 = new Uint8Array(65536);
let syncPurePipelineSlotInUse = false;
let pooledSyncPipeContext: FastShellCommandContext | undefined;

class PooledSyncPipeReader implements ByteSource, AsyncIterator<Uint8Array> {
  private buf: Uint8Array = EMPTY_BYTES;
  private yielded = false;
  abortSignal: AbortSignal | undefined = undefined;
  private readonly stepBox: { done: false; value: Uint8Array } = { done: false, value: EMPTY_BYTES };

  reset(buf: Uint8Array, len: number, signal?: AbortSignal): void {
    this.buf = len === 0 ? EMPTY_BYTES : buf.subarray(0, len);
    this.yielded = len === 0;
    this.abortSignal = signal;
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  tryReadAllSync(): Uint8Array {
    this.abortSignal?.throwIfAborted();
    this.yielded = true;
    return this.buf;
  }

  tryNextSync(): IteratorResult<Uint8Array> {
    this.abortSignal?.throwIfAborted();
    if (this.yielded) return SYNC_PIPE_DONE_RESULT;
    this.yielded = true;
    const box = this.stepBox;
    box.value = this.buf;
    return box;
  }

  syncReturn(): void {
    this.yielded = true;
  }

  next(): Promise<IteratorResult<Uint8Array>> {
    return Promise.resolve(this.tryNextSync());
  }

  return(): Promise<IteratorResult<Uint8Array>> {
    this.yielded = true;
    return Promise.resolve(SYNC_PIPE_DONE_RESULT);
  }
}

class PooledSyncPipeWriter implements ByteSink {
  readonly isPipeStage = false;
  budget!: Budget;
  signal!: AbortSignal;
  target: Uint8Array = EMPTY_BYTES;
  used = 0;
  overflowed = false;

  reset(budget: Budget, signal: AbortSignal, target: Uint8Array): void {
    this.budget = budget;
    this.signal = signal;
    this.target = target;
    this.used = 0;
    this.overflowed = false;
  }

  writeSync(chunk: Uint8Array): boolean {
    this.signal.throwIfAborted();
    const len = chunk.byteLength;
    if (len === 0) return true;
    const budget = this.budget;
    if (len > budget.limits.maxOutputBytes - budget.bytes) budget.fail("maxOutputBytes");
    if (this.used + len > this.target.byteLength) {
      this.overflowed = true;
      return false;
    }
    this.target.set(chunk, this.used);
    this.used += len;
    budget.bytes += len;
    return true;
  }

  write(chunk: Uint8Array): Promise<void> {
    try {
      if (this.writeSync(chunk)) return resolvedVoid;
      return Promise.reject(new Error("Sync pipe stage buffer overflow"));
    } catch (err) {
      return Promise.reject(err);
    }
  }
}

const sharedSyncPipeReader = new PooledSyncPipeReader();
const sharedSyncPipeWriter = new PooledSyncPipeWriter();

export class Runtime {
  declare readonly commands: CommandRegistry;
  declare readonly middleware: readonly Middleware[];
  declare readonly budget: Budget;
  declare readonly signal: AbortSignal;
  declare readonly commandSignal: AbortSignal;
  declare readonly cancellation: CancellationBoundary;
  declare readonly cancellationState: RuntimeCancellationState;
  declare readonly cancellationOwner: CancellationAdmissionOwner | undefined;
  declare readonly cancellationDepth: number;
  declare readonly cancellationMaxDepth: number;
  declare readonly outcomeFrame: RuntimeOutcomeFrame | undefined;
  declare private readonly inputProfile: Pick<FileSystem, "readStream" | "capabilities">;
  declare private readonly sourceFs: FileSystem;
  declare private readonly backingFs: FileSystem;
  declare private readonly _rawFs: FileSystem;
  declare private _fs: FileSystem | undefined;
  declare private _contextFsMask: number;
  declare private _contextFsSignal: AbortSignal | undefined;
  declare private _contextFs: FileSystem | undefined;
  declare private _redirectFsMask: number;
  declare private _redirectFs: FileSystem | undefined;
  declare readonly _isMemoryBackingFs: boolean;
  declare private _fileWrites: Map<string, Promise<void>> | undefined;
  declare private _outputFiles: Map<string, OutputFile> | undefined;
  declare private _syncArithState: State | undefined;
  declare private _canFastMemoryRedirect: boolean | undefined;
  declare private _syncArithRawVars: Record<string, string | undefined> | undefined;
  declare private _syncArithLine: number | undefined;
  declare private _syncArithRawWriteOnly: boolean;
  declare private _syncArithTouched: Set<string> | undefined;
  declare private _syncArithRefs: ArithmeticReferences | undefined;
  constructor(
    fs: FileSystem,
    commands: CommandRegistry,
    middleware: readonly Middleware[],
    budget: Budget,
    signal: AbortSignal = budget.signal,
    fileWrites: Map<string, Promise<void>> | undefined = undefined,
    outputFiles: Map<string, OutputFile> | undefined = undefined,
    commandSignal: AbortSignal = signal,
    cancellation: CancellationBoundary,
    cancellationState: RuntimeCancellationState,
    cancellationOwner: CancellationAdmissionOwner | undefined,
    cancellationDepth: number,
    cancellationMaxDepth: number,
    outcomeFrame: RuntimeOutcomeFrame | undefined = undefined,
    inputProfile: Pick<FileSystem, "readStream" | "capabilities"> = fs,
  ) {
    this.commands = commands;
    this.middleware = middleware;
    this.budget = budget;
    this.signal = signal;
    this.commandSignal = commandSignal;
    this.cancellation = cancellation;
    this.cancellationState = cancellationState;
    this.cancellationOwner = cancellationOwner;
    this.cancellationDepth = cancellationDepth;
    this.cancellationMaxDepth = cancellationMaxDepth;
    if (outcomeFrame !== undefined) this.outcomeFrame = outcomeFrame;
    this.inputProfile = inputProfile;
    this._rawFs = fs;
    if (fileWrites !== undefined) this._fileWrites = fileWrites;
    if (outputFiles !== undefined) this._outputFiles = outputFiles;
    this.sourceFs = runtimeFileSystems.get(fs) ?? fs;
    this.backingFs = getRuntimeBackingFileSystem(this.sourceFs) ?? this.sourceFs;
    this._isMemoryBackingFs = this.backingFs.constructor?.name === "MemoryFileSystem";
    if (this._isMemoryBackingFs) (this.backingFs as { _activeRuntimeBudget?: Budget })._activeRuntimeBudget = budget;
    registerInternalYieldCheckpoint(signal, budget.yieldCheckpoint);
    if (commandSignal !== signal) {
      inheritYieldCheckpoint(signal, commandSignal);
      registerInternalYieldCheckpoint(commandSignal, budget.yieldCheckpoint);
    }
  }

  get fileWrites(): Map<string, Promise<void>> {
    return this._fileWrites ??= new Map();
  }

  get outputFiles(): Map<string, OutputFile> {
    return this._outputFiles ??= new Map();
  }

  releaseAnchorResources(): void {
    const reusableEntry = reusableDefaultContextFsBySourceFs.get(this.sourceFs);
    if (reusableEntry && reusableEntry.inUseBy === this) {
      retargetScopedFileSystem(reusableEntry.scoped, noopFsCharge, NEVER_ABORTED_SIGNAL, noopFsCharge, 256);
      reusableEntry.inUseBy = undefined;
    }
    if (Array.isArray(_lastFastContextAnchor) && _lastFastContextAnchor[0]) {
      (_lastFastContextAnchor[0] as { _contextFs?: FileSystem | undefined })._contextFs = undefined;
    }
    if (Array.isArray(_lastPipelineAnchor) && _lastPipelineAnchor[0]) {
      (_lastPipelineAnchor[0] as { _contextFs?: FileSystem | undefined })._contextFs = undefined;
    }
    if (this._isMemoryBackingFs && this.backingFs) {
      const emptyFs = (_sharedEmptyMemoryFs ??= new (this.backingFs.constructor as new () => FileSystem)());
      (this as unknown as { backingFs: FileSystem }).backingFs = emptyFs;
      (this as unknown as { sourceFs: FileSystem }).sourceFs = emptyFs;
      (this as unknown as { _rawFs: FileSystem })._rawFs = emptyFs;
      (this as unknown as { inputProfile: FileSystem }).inputProfile = emptyFs;
      this._fs = undefined;
      this._contextFs = undefined;
      this._redirectFs = undefined;
    }
  }

  get fs(): FileSystem {
    if (!this._fs) {
      this._fs = scopeFileSystem(this._rawFs, this.budget.chargeFs, this.signal, this.budget.cleanupChargeFs, { maxPathComponents: this.budget.limits.maxPathnameComponents });
      runtimeFileSystems.set(this._fs, this.sourceFs);
      registerRuntimeBackingFileSystem(this._fs, this.backingFs);
    }
    return this._fs;
  }

  private getContextFsFor(umask: number, sig: AbortSignal): FileSystem {
    if (this._contextFs && this._contextFsMask === umask && this._contextFsSignal === sig) {
      return this._contextFs;
    }
    if (umask === 0o022 && !this._contextFs) {
      const entry = reusableDefaultContextFsBySourceFs.get(this.sourceFs);
      if (entry && (entry.inUseBy === undefined || entry.inUseBy === this)) {
        if (retargetScopedFileSystem(entry.scoped, this.budget.chargeFs, sig, this.budget.cleanupChargeFs, this.budget.limits.maxPathnameComponents)) {
          entry.inUseBy = this;
          this._contextFsMask = umask;
          this._contextFsSignal = sig;
          this._contextFs = entry.scoped;
          return entry.scoped;
        }
      }
    }
    const created = scopeFileSystem(
      creationFileSystem(this.sourceFs, umask),
      this.budget.chargeFs,
      sig,
      this.budget.cleanupChargeFs,
      { maxPathComponents: this.budget.limits.maxPathnameComponents },
    );
    runtimeFileSystems.set(created, this.sourceFs);
    registerRuntimeBackingFileSystem(created, this.backingFs);
    this._contextFsMask = umask;
    this._contextFsSignal = sig;
    this._contextFs = created;
    return created;
  }

  private getRedirectFs(umask: number): FileSystem {
    if (this._redirectFs && this._redirectFsMask === umask) return this._redirectFs;
    this._redirectFsMask = umask;
    return (this._redirectFs = scopeFileSystem(
      creationFileSystem(this.sourceFs, umask),
      this.budget.chargeFs,
      this.commandSignal,
      this.budget.cleanupChargeFs,
      { preserveDescriptorWriteReceipt: true, maxPathComponents: this.budget.limits.maxPathnameComponents },
    ));
  }

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
      if (![collation, characters].every(locale => cCollation(locale) || utf8Locale(locale))) {
        await this.ereDiagnostic(io, "[[ unsupported ERE profile: locale must be C, POSIX or UTF-8");
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
        const program = await compileEre(fragments, ledger, this.signal, !!state.nocasematch, {
          ranges: cCollation(collation), classes: !utf8Locale(characters),
        });
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
        combineManagedSignals(boundary.deliverySignal, scope.signal),
        this.fileWrites,
        this.outputFiles,
        boundary.deliverySignal,
        boundary,
        this.cancellationState,
        owner ?? this.cancellationOwner,
        prepared.owned ? childDepth : this.cancellationDepth,
        this.cancellationMaxDepth,
        frame,
        this.inputProfile,
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
    if (typeof text === "string") return writeDiagnostic(io.stderr, `${prefix}${text}\n`, this.signal);
    const allocation = this.budget.values.scope();
    try {
      const value = concatShellValues([prefix, text, "\n"], allocation);
      await io.stderr.write(shellValueBytes(value, allocation));
    } finally { allocation.close(); }
  }

  async writeVariable(state: State, name: string, value: ShellValue, io: IO, origin: "assignment" | "arithmetic" | "getopts" = "assignment", dereference = true): Promise<void> {
    if (dereference) name = this.referenceName(state, name);
    const target = name.includes("[") ? this.variableTarget(name) : undefined;
    if (target?.subscript !== undefined) {
      await this.arrayAssignment({ kind: "element", name: target.name, append: false,
        index: stringIndex(target.subscript, this.budget.parsing, parseArraySubscript(target.subscript, this.budget.parsing, byteLocale(state.variables), state.depth)),
        value: { offset: 0, parts: [{ kind: "text", value: shellValueText(value), quoted: true, ...(typeof value === "string" ? {} : { byteValue: value }) }] } }, state, io);
      return;
    }
    if (arrayStore(state)?.get(name)) throw new ArrayFailure(origin === "arithmetic" ? "indexed arithmetic is unsupported" : "indexed write requires prepared publication");
    if (state.readonlyVariables?.has(name)) throw new PublicDiagnostic(`${name}: readonly variable`);
    const maxBytes = this.budget.limits.maxExpansionBytes;
    if ((typeof value !== "string" || value.length * 3 > maxBytes) && shellValueByteLength(value) > maxBytes) this.budget.fail("maxExpansionBytes");
    if (state.variableAttributes?.size) value = await this.attributeValue(state, name, value, io, origin);
    if (name === "OPTIND" && (state.getopts === undefined || state.getopts.integer) && origin !== "arithmetic") {
      try { value = String(evaluateArithmetic(prepareArithmetic(shellValueText(value) || "0", this.budget.parsing), this.arithmeticVariables(state), this.budget.parsing)); }
      catch (error) { this.rethrowArithmeticControl(error); throw new ExpansionFailure(message(error, this.budget.onInternalError)); }
    }
    publishVariable(state, name, value);
    if (state.allexport) state.exported.add(name);
    if (name === "OPTIND" && origin !== "getopts") this.syncGetopts(state);
  }

  private declareAttributes(state: State, name: string, enabled: Set<string>, disabled: Set<string>): void {
    let attributes = state.variableAttributes?.get(name) ?? "";
    for (const flag of disabled) attributes = attributes.split(flag).join("");
    for (const flag of enabled) if ("ilun".includes(flag) && !attributes.includes(flag)) attributes += flag;
    if (enabled.has("l")) attributes = attributes.split("u").join("");
    if (enabled.has("u")) attributes = attributes.split("l").join("");
    state.variableAttributes ??= new Map();
    state.variableAttributes.set(name, attributes);
  }

  private async attributeValue(state: State, name: string, value: ShellValue, io: IO, origin = "assignment", previous?: ShellValue): Promise<ShellValue> {
    const attributes = state.variableAttributes?.get(name) ?? "";
    if (attributes.includes("i") && origin !== "arithmetic") {
      const evaluate = (input: ShellValue): Promise<bigint> => this.shellArithmetic(prepareArithmetic(shellValueText(input) || "0", this.budget.parsing), state, io);
      value = String(await evaluate(value) + (previous === undefined ? 0n : await evaluate(previous)));
    }
    return this.caseAttributeValue(state, name, value);
  }

  private caseAttributeValue(state: State, name: string, value: ShellValue): ShellValue {
    const attributes = state.variableAttributes?.get(name) ?? "";
    if (attributes.includes("l") || attributes.includes("u")) {
      const bytes = Uint8Array.from(shellValueBytes(value));
      for (let index = 0; index < bytes.length; index++) {
        const byte = bytes[index]!;
        if (attributes.includes("l") && byte >= 65 && byte <= 90) bytes[index] = byte + 32;
        if (attributes.includes("u") && byte >= 97 && byte <= 122) bytes[index] = byte - 32;
      }
      value = shellValueFromBytes(bytes);
    }
    if (shellValueByteLength(value) > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
    return value;
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

  private unsetVariable(state: State, name: string, internal = false, dereference = true): void {
    if (dereference) name = this.referenceName(state, name);
    if (state.readonlyVariables?.has(name)) throw new PublicDiagnostic(`${name}: readonly variable`);
    delete state.variables[name];
    state.exported.delete(name);
    state.variableAttributes?.delete(name);
    if (name === "OPTIND" && !internal) this.syncGetopts(state);
  }

  private rethrowArithmeticControl(error: unknown): void {
    this.signal.throwIfAborted();
    if (error instanceof NounsetFailure || error instanceof Flow || error instanceof ShellLimitError || error instanceof ShellSyntaxError) throw error;
  }

  private arithmeticValue(program: ArithmeticProgram, state: State, io: IO): Promise<bigint> {
    if (!program.source.includes("$")) return this.shellArithmetic(program, state, io);
    return evaluatePositionalArithmetic(program, {
      parseBudget: this.budget.parsing,
      positional: state.positional, arg0: state.arg0 ?? "virtual-bash", owner: arrayStore(state)?.owner,
      maximumBytes: this.budget.limits.maxExpansionBytes,
      checkpoint: () => this.signal.throwIfAborted(),
      requireParameter: (name, value) => this.requireParameter(value, name, state, io),
      limit: () => this.budget.fail("maxExpansionBytes"),
    }, prepared => this.shellArithmetic(prepared, state, io));
  }

  private get canFastMemoryRedirect(): boolean {
    return this._canFastMemoryRedirect ??= (
      this.budget.limits.maxPathnameComponents === Infinity &&
      !this.backingFs.capabilitiesFor &&
      this.sourceFs.capabilities.open === true &&
      this.sourceFs.capabilities.preferStreamingRedirection !== true &&
      this.sourceFs.capabilities.readOnly !== true &&
      this.sourceFs.capabilities.write !== false &&
      this.sourceFs.capabilities.append !== false
    );
  }
  private get syncArithRefs(): ArithmeticReferences {
    return this._syncArithRefs ??= this.createSyncArithRefs();
  }

  private createSyncArithRefs(): ArithmeticReferences {
    return {
      isSync: true,
      resolve: variable => {
        this.signal.throwIfAborted();
        return variable;
      },
      read: reference => {
        this.signal.throwIfAborted();
        if (arrayStore(this._syncArithState!)?.get(reference)) throw new ArrayFailure("indexed arithmetic is unsupported");
        const value = this._syncArithRawVars![reference]
          ?? (reference === "LINENO" ? String(this._syncArithLine ?? 1)
            : reference === "_" ? this._syncArithState!.lastArgument ?? ""
            : reference === "FUNCNAME" ? this._syncArithState!.functionNames?.[0]
            : undefined);
        if (this._syncArithState!.nounset && value === undefined) {
          throw new NounsetFailure(`${reference}: unbound variable`, this._syncArithLine);
        }
        return value;
      },
      write: (reference, value) => {
        const st = this._syncArithState!;
        if (this._syncArithRawWriteOnly) {
          st.variables[reference] = value;
          this._syncArithTouched?.add(reference);
          return;
        }
        if (arrayStore(st)?.get(reference)) throw new ArrayFailure("indexed arithmetic is unsupported");
        const raw = stateMonitor(st)?.raw ?? st;
        if (raw.readonlyVariables?.has(reference)) throw new PublicDiagnostic(`${reference}: readonly variable`);
        publishVariable(st, reference, value);
        if (raw.allexport) st.exported.add(reference);
        if (reference === "OPTIND") this.syncGetopts(st);
      },
    };
  }

  private syncShellArithmetic(program: ArithmeticProgram, state: State, line: number | undefined): bigint {
    const raw = stateMonitor(state)?.raw ?? state;
    const prevState = this._syncArithState;
    const prevVars = this._syncArithRawVars;
    const prevLine = this._syncArithLine;
    this._syncArithState = raw;
    this._syncArithRawVars = raw.variables;
    this._syncArithLine = line;
    try {
      return evaluateArithmeticSync(program, this.syncArithRefs, this.budget.parsing);
    } finally {
      this._syncArithState = prevState;
      this._syncArithRawVars = prevVars;
      this._syncArithLine = prevLine;
    }
  }

  private syncShellArithmeticNonZero(program: ArithmeticProgram, state: State, line: number | undefined): boolean {
    const raw = stateMonitor(state)?.raw ?? state;
    const prevState = this._syncArithState;
    const prevVars = this._syncArithRawVars;
    const prevLine = this._syncArithLine;
    this._syncArithState = raw;
    this._syncArithRawVars = raw.variables;
    this._syncArithLine = line;
    try {
      return evaluateArithmeticSyncNonZero(program, this.syncArithRefs, this.budget.parsing);
    } finally {
      this._syncArithState = prevState;
      this._syncArithRawVars = prevVars;
      this._syncArithLine = prevLine;
    }
  }

  private syncShellArithmeticString(program: ArithmeticProgram, state: State, line: number | undefined): string {
    const raw = stateMonitor(state)?.raw ?? state;
    const prevState = this._syncArithState;
    const prevVars = this._syncArithRawVars;
    const prevLine = this._syncArithLine;
    this._syncArithState = raw;
    this._syncArithRawVars = raw.variables;
    this._syncArithLine = line;
    try {
      return evaluateArithmeticSyncString(program, this.syncArithRefs, this.budget.parsing);
    } finally {
      this._syncArithState = prevState;
      this._syncArithRawVars = prevVars;
      this._syncArithLine = prevLine;
    }
  }

  private async shellArithmetic(program: ArithmeticProgram, state: State, io: IO, variables?: Record<string, string>): Promise<bigint> {
    if (!program.hasSubscript && !guestArrays(state) && !state.variableAttributes?.size && variables === undefined) {
      return this.syncShellArithmetic(program, state, io.diagnosticLine);
    }
    const resolvedVariables = variables ?? this.arithmeticVariables(state, io.diagnosticLine);
    let depth = 0;
    const references: ArithmeticReferences = {
      isSync: !program.hasSubscript && !guestArrays(state),
      resolve: (variable, subscript) => {
        this.signal.throwIfAborted();
        const target = this.variableTarget(this.referenceName(state, variable))!;
        const name = target.name;
        subscript ??= target.subscript;
        const binding = arrayStore(state)?.get(name);
        if (subscript === undefined && !binding) return name;
        return (async () => {
          let index: number | undefined;
          let key: string | undefined;
          if (binding?.associative) {
            const word = parseArraySubscript(subscript ?? "0", this.budget.parsing, byteLocale(state.variables), state.depth);
            const fields = await this.valueWord(word, state, io, false);
            const value = concatShellValues(fields, io[valueScope]);
            key = shellValueText(value);
            const identity = await binding.keyIdentity(value, binding.owner, this.signal);
            index = binding.keys.get(identity)?.index;
          } else {
            if (++depth > 64) throw new PublicDiagnostic("Arithmetic subscript nesting exceeds 64");
            let number: bigint;
            try {
              let operand = prepareArithmetic(subscript ?? "0", this.budget.parsing);
              if (operand.error) {
                const word = parseArraySubscript(subscript ?? "0", this.budget.parsing, byteLocale(state.variables), state.depth);
                const fields = await this.valueWord(word, state, io, false);
                operand = prepareArithmetic(shellValueText(concatShellValues(fields, io[valueScope])), this.budget.parsing);
              }
              number = await evaluateArithmeticReferences(operand, references, this.budget.parsing);
            } finally { depth--; }
            if (number < 0n) number += BigInt((binding?.maximum ?? (state.variables[name] === undefined ? -1 : 0)) + 1);
            if (number < 0n || number > 2147483647n) throw new ArrayFailure("index outside 0..2147483647");
            index = Number(number);
          }
          return JSON.stringify([name, index ?? null, key]);
        })();
      },
      read: reference => {
        this.signal.throwIfAborted();
        if (!reference.startsWith("[")) return resolvedVariables[reference];
        const [name, index, key] = JSON.parse(reference) as [string, number | null, string?];
        const binding = arrayStore(state)?.get(name);
        const value = binding ? binding.get(index ?? -1) : index === 0 ? state.variables[name] : undefined;
        if (state.nounset && value === undefined) throw new NounsetFailure(`${name}[${key ?? index}]: unbound variable`, io.diagnosticLine);
        if (value !== undefined && Buffer.byteLength(value) > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
        return value;
      },
      write: (reference, value) => {
        if (!reference.startsWith("[")) { resolvedVariables[reference] = value; return; }
        const [name, index, key] = JSON.parse(reference) as [string, number | null, string?];
        return this.arrayAssignment({
          kind: "element", name, append: false,
          index: { decimal: String(index ?? 0), ...(key == null ? {} : { word: { offset: 0, parts: [{ kind: "text", value: key, quoted: true }] } }) },
          value: { offset: 0, parts: [{ kind: "text", value, quoted: true }] },
        }, state, io);
      },
    };
    return evaluateArithmeticReferences(program, references, this.budget.parsing);
  }

  private async expandedArithmeticValue(program: ArithmeticProgram, state: State, io: IO): Promise<bigint> {
    if (!program.error && !program.hasSubscript && !guestArrays(state) && !state.variableAttributes?.size) {
      return this.syncShellArithmetic(program, state, io.diagnosticLine);
    }
    const allocation = this.budget.values.scope();
    try {
      if (program.error) {
        const word = parseArithmeticExpansion(program.source, this.budget.parsing, byteLocale(state.variables),
          state.depth + (io.parameterDepth ?? 0), io.diagnosticLine ?? 1, state.extensions?.syntax);
        const operandIO = this.parameterOperandIO(word, state, { ...io, [valueScope]: allocation });
        const fields = await this.valueWord(word, state, operandIO, false, false, true);
        const source = shellValueText(concatShellValues(fields, allocation));
        this.signal.throwIfAborted();
        program = prepareArithmetic(source, this.budget.parsing);
      }
      return await this.shellArithmetic(program, state, { ...io, [valueScope]: allocation });
    } finally { allocation.close(); }
  }

  arithmeticVariables(state: State, line?: number): Record<string, string> {
    return new Proxy(state.variables, {
      get: (target, key) => {
        this.signal.throwIfAborted();
        const name = typeof key === "string" ? this.referenceName(state, key) : key;
        if (arrayStore(state)?.get(String(name))) throw new ArrayFailure("indexed arithmetic is unsupported");
        const value = Reflect.get(target, name)
          ?? (name === "LINENO" ? String(line ?? 1)
            : name === "_" ? state.lastArgument ?? ""
            : name === "FUNCNAME" ? state.functionNames?.[0]
            : undefined);
        if (state.nounset && typeof key === "string" && value === undefined) throw new NounsetFailure(`${key}: unbound variable`, line);
        return value;
      },
      set: (_target, key, value: string) => {
        const name = this.referenceName(state, String(key));
        if (arrayStore(state)?.get(name)) throw new ArrayFailure("indexed arithmetic is unsupported");
        if (state.readonlyVariables?.has(name)) throw new PublicDiagnostic(`${name}: readonly variable`);
        publishVariable(state, name, this.caseAttributeValue(state, name, value));
        if (state.allexport) state.exported.add(name);
        if (name === "OPTIND") this.syncGetopts(state);
        return true;
      },
    });
  }

  private referenceName(state: State, name: string): string {
    if (!state.variableAttributes?.size) return name;
    const seen = new Set<string>();
    let target = this.variableTarget(name);
    while (target && state.variableAttributes?.get(target.name)?.includes("n") && state.variables[target.name]) {
      this.signal.throwIfAborted();
      if (seen.has(target.name)) throw new ExpansionFailure(`${target.name}: circular name reference`);
      seen.add(target.name);
      name = state.variables[target.name]! + (target.subscript === undefined ? "" : `[${target.subscript}]`);
      target = this.variableTarget(name);
      if (!target) throw new ExpansionFailure(`${name}: invalid name reference`);
    }
    return name;
  }

  private variableTarget(name: string): { name: string; subscript?: string } | undefined {
    const bracket = name.indexOf("[");
    const base = bracket < 0 ? name : name.slice(0, bracket);
    if (!isShellIdentifier(base) || bracket >= 0 && (!name.endsWith("]") || bracket === name.length - 2)) return undefined;
    return bracket < 0 ? { name: base } : { name: base, subscript: name.slice(bracket + 1, -1) };
  }

  variable(state: State, name: string): string | undefined {
    name = this.referenceName(state, name);
    const binding = arrayStore(state)?.get(name);
    if (binding) return binding.get(binding.associative ? binding.keys.get("30")?.index ?? -1 : 0);
    if (name === "FUNCNAME" && state.variables.FUNCNAME === undefined) return state.functionNames?.[0];
    if (name === "_" && state.variables._ === undefined) return state.lastArgument ?? "";
    return state.variables[name];
  }

  private async variablePresent(state: State, name: string, io: IO): Promise<boolean> {
    name = this.referenceName(state, name);
    const bracket = name.indexOf("[");
    const base = bracket < 0 ? name : name.slice(0, bracket);
    const validName = base.length > 0 && [...base].every((character, index) =>
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_".includes(character)
      || index > 0 && "0123456789".includes(character));
    if (!validName || bracket >= 0 && !name.endsWith("]")) return false;
    const resolved = this.referenceName(state, base);
    const binding = arrayStore(state)?.get(resolved);
    if (bracket < 0) return this.variable(state, base) !== undefined;
    const selector = name.slice(bracket + 1, -1);
    if (!binding?.associative && (selector === "@" || selector === "*")) {
      return binding ? binding.values.size > 0 : this.variable(state, base) !== undefined;
    }
    const store = arrayStore(state);
    if (!store) return selector === "0" && this.variable(state, base) !== undefined;
    const index = await this.arrayIndex(binding, { decimal: selector, source: selector }, state, io, store.owner);
    return index !== undefined && (binding ? binding.getValue(index) !== undefined
      : index === 0 && this.variable(state, base) !== undefined);
  }

  private requireParameter(value: string | undefined, name: string, state: State, io: IO, line?: number): void {
    if (value === undefined && state.nounset) throw new NounsetFailure(`${name}: unbound variable`, io.diagnosticLine ?? line);
  }

  async assignVariable(state: State, name: string, value: ShellValue, io: IO, origin: "assignment" | "getopts" = "assignment"): Promise<void> {
    name = this.referenceName(state, name);
    if (!arrayStore(state)?.get(name)) { await this.writeVariable(state, name, value, io, origin); return; }
    await this.arrayZero(state, name, io, async () => value);
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
        staged.assigned = current.assigned;
        let maximum = -1;
        for (const key of staged.values.keys()) {
          operation.reserve({ work: 2 }).release();
          if (key !== index && key > maximum) maximum = key;
          await operation.ledger.checkpoint(this.signal, 2);
        }
        if (typeof index === "number") staged.remove(index);
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

  async arrayZero(state: State, name: string, io: IO, expand: () => Promise<ShellValue>, append = false, freeze = false): Promise<void> {
    const store = requireArrays(state);
    const operation = ArrayOwner.create(store.owner.ledger, store.owner);
    const holding = store.owner.hold();
    const valueAllocation = this.budget.values.scope();
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
      const index = staged.associative ? (await staged.keyIndex("0", operation, this.signal, true))! : 0;
      const previous = current.getValue(index) ?? "";
      const integer = state.variableAttributes?.get(name)?.includes("i");
      let value = !append || integer ? expanded : typeof previous === "string" && typeof expanded === "string"
        ? await this.arrayJoin(operation, [previous, expanded], "") : concatShellValues([previous, expanded], valueAllocation);
      value = await this.attributeValue(state, name, value, io, "assignment", append ? previous : undefined);
      const token = await textToken(staged.owner, value, this.signal);
      try { staged.insert(index, token); } catch (error) { token.release(); throw error; }
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
    } finally { try { await staged?.release(); await operation.close(); } finally { valueAllocation.close(); holding.release(); } }
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

  private async arrayIndex(binding: IndexedBinding | undefined, index: { decimal: string; source?: string; word?: Word }, state: State, io: IO, owner: ArrayOwner, create = false, relativeMaximum = binding?.maximum ?? -1): Promise<number | undefined> {
    if (!binding?.associative) {
      if (index.source === "") throw new ArrayFailure("bad array subscript");
      const word = index.word ?? parseArraySubscript(index.source ?? index.decimal, this.budget.parsing, byteLocale(state.variables), state.depth);
      const fields = await this.valueWord(word, state, io, false);
      const source = shellValueText(concatShellValues(fields, io[valueScope]));
      owner.reserve({ work: source.length + 1 }).release();
      let number = await this.arithmeticValue(prepareArithmetic(source || "0", this.budget.parsing), state, io);
      if (number < 0n) number += BigInt(relativeMaximum + 1);
      const maximum = create ? 2147483647 : 4294967295;
      if (number < 0n || number > BigInt(maximum)) throw new ArrayFailure(`index outside 0..${maximum}`);
      return Number(number);
    }
    const word = index.word ?? parseArraySubscript(index.source ?? index.decimal, this.budget.parsing, byteLocale(state.variables), state.depth);
    const fields = await this.valueWord(word, state, io, false);
    const value = fields.length === 1 ? fields[0]! : concatShellValues(fields, io[valueScope]);
    if (shellValueByteLength(value) === 0) {
      await this.diagnostic(io, "associative array: bad array subscript");
      if (create) throw completedExit(1);
      return undefined;
    }
    return binding.keyIndex(value, owner, this.signal, create);
  }

  async arrayAssignment(assignment: ArrayAssignment, state: State, io: IO, declaration?: "readonly", origin: "assignment" | "declaration" = "assignment", associative?: boolean): Promise<void> {
    const name = assignment.name;
    this.signal.throwIfAborted();
    if (state.readonlyVariables?.has(name) && arrayStore(state)?.get(name)?.associative) { await this.diagnostic(io, `${name}: readonly variable`); throw completedExit(1); }
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
      if (associative !== undefined && current && current.associative !== associative) throw new ArrayFailure("cannot convert array kind");
      const isAssociative = associative ?? current?.associative;
      const initialMaximum = current?.maximum ?? (state.variables[name] === undefined ? -1 : 0);
      let selectedIndex: number | undefined;
      let planned: number | null = assignment.append && assignment.kind === "compound" ? initialMaximum + 1 : 0;
      if (assignment.kind === "element") {
        operation.reserve({ work: assignment.index.decimal.length + 1 }).release();
        if (!current?.associative) selectedIndex = await this.arrayIndex(current, assignment.index, state, io, operation, true, initialMaximum);
      } else for (const entry of assignment.entries) {
        if (isAssociative && !entry.index) throw new ArrayFailure("associative compound entry requires a subscript");
        operation.reserve({ work: entry.value.parts.length + (entry.index?.decimal.length ?? 0) + 2 }).release();
        if (entry.index) {
          const index = numericIndex(entry.index);
          planned = !isAssociative && index !== undefined ? index + 1 : null;
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
      staged = preserve && current ? await current.copy(this.signal) : IndexedBinding.create(store.owner, isAssociative);
      if (preserve && !current && state.variables[name] !== undefined) {
        const token = await textToken(staged.owner, stateMonitor(state)?.values.get(name, state.variables[name]!) ?? state.variables[name]!, this.signal);
        try { staged.insert(0, token); } catch (error) { token.release(); throw error; }
      }
      let writes = 0;
      let cursor = assignment.append && assignment.kind === "compound" ? initialMaximum + 1 : 0;
      const insert = async (index: number, value: ShellValue, append = false) => {
        if (index > 2147483647) throw new ArrayFailure("index outside 0..2147483647");
        const previous = append ? staged!.getValue(index) ?? "" : undefined;
        if (append && !state.variableAttributes?.get(name)?.includes("i")) value = await join([previous!, value]);
        value = await this.attributeValue(state, name, value, io, "assignment", previous);
        const token = await valueToken(staged!.owner, value, this.signal);
        try { staged!.insert(index, token); } catch (error) { token.release(); throw error; }
        writes++;
      };
      const join = async (values: readonly ShellValue[]): Promise<ShellValue> => values.every(value => typeof value === "string")
        ? this.arrayJoin(operation, values as readonly string[], "") : concatShellValues(values, io[valueScope]);
      if (assignment.kind === "element") {
        const index = selectedIndex ?? (await this.arrayIndex(staged, assignment.index, state, io, operation, true))!;
        const fields = await this.valueWord(assignment.value, state, io, false, false, false, false, undefined, false, false, 0);
        const value = await join(fields);
        await insert(index, value, assignment.append);
      } else for (const entry of assignment.entries) {
        const original = compoundEntryWords.get(entry);
        if (entry.index && original && state.braceexpand !== false && original.parts.some(part => part.kind === "text" && !part.quoted && part.value.includes("{"))) {
          let expandedEntry = false;
          for await (const expanded of expandBraces(original, this.budget, this.signal)) {
            if (expanded === original) break;
            expandedEntry = true;
            const values = await this.valueWord(expanded, state, io, true, false, false, false, undefined, false, false);
            for (const value of values) { await insert(cursor, value); cursor++; }
          }
          if (expandedEntry) continue;
        }
        const index = entry.index ? (await this.arrayIndex(staged, entry.index, state, io, operation, true))! : undefined;
        const fields = await this.valueWord(entry.value, state, io, entry.index === undefined);
        if (index !== undefined) {
          const value = await join(fields);
          await insert(index, value, entry.append);
          cursor = index + 1;
        } else for (const value of fields) { await insert(cursor, value); cursor++; }
      }
      this.signal.throwIfAborted();
      this.assertArrayWritable(state, name, origin);
      if (!watch.valid()) throw new ArrayFailure("stale binding");
      staged.assigned = true;
      if (declaration || !(assignment.kind === "compound" && assignment.append && writes === 0 && current?.assigned)) {
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
        await scope.run(() => this.assignVariable(state, name, value, io));
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
              if (subscript === undefined) await this.assignVariable(state, name, String(value), io);
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
          assertOpen();
          if (closed) throw new Error("Input borrow is closed");
          if (typeof raw !== "boolean" || count !== undefined && (!Number.isSafeInteger(count) || count < 0) || delimiter !== undefined && (!Number.isInteger(delimiter) || delimiter < 0 || delimiter > 255) || exact !== undefined && typeof exact !== "boolean" || timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new TypeError("Invalid input read options");
          return scope.run(() => input.line(raw, { ...(count === undefined ? {} : { count }), ...(delimiter === undefined ? {} : { delimiter }), ...(exact === undefined ? {} : { exact }), ...(timeoutMs === undefined ? {} : { timeoutMs }), byteCount: byteLocale(state.variables) }));
        },
        record: async (options: { readonly delimiter?: number } = {}) => {
          assertOpen();
          if (closed) throw new Error("Input borrow is closed");
          const { delimiter } = options;
          assertOpen();
          if (closed) throw new Error("Input borrow is closed");
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
    if ((frame as { isIdleTrapState?: boolean }).isIdleTrapState) return;
    for (const [name, builtin] of frame.builtins) if (shellBuiltinNames.has(name) && builtin.replace !== true) throw new TypeError(`Extension builtin conflicts with existing builtin: ${name}`);
    for (const entry of frame.entries) if (entry.instance.start) await entry.instance.start(this.extensionContext(state, io));
  }

  private tryStartExtensionsSync(state: State): boolean {
    const frame = state.extensions;
    if (!frame || frame.started) return true;
    if ((frame as { isIdleTrapState?: boolean }).isIdleTrapState) {
      frame.started = true;
      return true;
    }
    return false;
  }

  private async extensionEvent(event: ShellExtensionEvent, state: State, io: IO, status: number, command = ""): Promise<boolean> {
    if (!hasActiveExtensions(state)) return false;
    this.signal.throwIfAborted();
    if (!this.tryStartExtensionsSync(state)) await this.startExtensions(state, io);
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
    if (!hasActiveExtensions(state)) {
      frame.exitStatus = status;
      return status;
    }
    state = trackState(state, this.budget, io[invocationScope]);
    frame.exiting = true;
    frame.exitStatus = status;
    try {
      try { await this.extensionEvent("exit", state, io, status); }
      catch (error) { if (error instanceof Flow && error.kind === "exit" && !(error instanceof ExtensionCheckpointFailure)) { if (!error.expansionFailure) status = error.status; } else throw error; }
      this.signal.throwIfAborted();
    } catch (reason) { extensionExitFailures.set(frame, { reason }); }
    finally { frame.exiting = false; }
    frame.exitStatus = status;
    return status;
  }

  tryFinishShellSync(state: State): boolean {
    const frame = state.extensions;
    if (!frame || frame.exiting) return true;
    if (!hasActiveExtensions(state) && frame.cleanup.length === 0) {
      frame.exiting = true;
      this.signal.throwIfAborted();
      return true;
    }
    return false;
  }

  private releaseExtensionsSyncIfEmpty(state: State): boolean {
    if (!state.extensions?.cleanup.length) {
      this.signal.throwIfAborted();
      return true;
    }
    return false;
  }

  async finishShell(state: State, io: IO, status: number): Promise<number> {
    if (this.tryFinishShellSync(state)) return status;
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
    if (!state.extensions?.cleanup.length) {
      this.signal.throwIfAborted();
      return;
    }
    const cleanup = await Promise.allSettled(state.extensions.cleanup.map(close => close()));
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

  runUnit(script: Script, state: State, io: IO): { exitCode: number; terminated: boolean } | Promise<{ exitCode: number; terminated: boolean }> {
    if (state.noexec) return SYNC_UNIT_ZERO;
    const monitor = ensureStateMonitor(state, this.budget, io[invocationScope]);
    if (this.tryStartExtensionsSync(state)) {
      if (state.extensions?.syntax.indexedDeclarations?.includes("readonly")) io.assignmentDiagnosticContext ??= { name: undefined };
      try {
        const syncResult = this.trySyncScript(script, state, io, Boolean(io.execution?.ignoreErrexit));
        if (typeof syncResult === "number") {
          return syncResult === 0 ? SYNC_UNIT_ZERO : syncResult === 1 ? SYNC_UNIT_ONE : { exitCode: syncResult, terminated: false };
        }
        if (
          syncResult.listIndex === 0 &&
          syncResult.pipelineIndex === 0 &&
          script.lists.length === 1 &&
          script.lists[0]!.pipelines.length === 1 &&
          !script.lists[0]!.terminator
        ) {
          const fastUnit = this.tryFastSinglePipelineUnit(
            script.lists[0]!.pipelines[0]!,
            state,
            io,
            Boolean(io.execution?.ignoreErrexit),
          );
          if (fastUnit !== undefined) return fastUnit;
        }
        return this.runUnitFrom(script, monitor.proxy, io, syncResult.listIndex, syncResult.pipelineIndex, false);
      } catch (error) {
        if (error instanceof Flow && error.kind === "discard") {
          this.signal.throwIfAborted();
          throwCleanupFailures(io[invocationScope].failures);
          state.status = error.status;
          return { exitCode: error.status, terminated: false };
        }
        if (error instanceof NounsetDiagnosticFailure) {
          if (state.isolated) throw error;
          throw error.reason;
        }
        if (error instanceof Flow && error.kind === "exit") {
          if (this.tryFinishShellSync(state)) return { exitCode: error.status, terminated: true };
          return this.finishShell(monitor.proxy, io, error.status).then(exitCode => ({ exitCode, terminated: true }));
        }
        throw error;
      }
    }
    return this.runUnitFrom(script, monitor.proxy, io, 0, 0, true);
  }

  private async runUnitFrom(script: Script, state: State, io: IO, startListIndex: number, startPipelineIndex: number, needStartExtensions: boolean): Promise<{ exitCode: number; terminated: boolean }> {
    try {
      if (needStartExtensions) await this.startExtensions(state, io);
      return { exitCode: await this.inputUnit(script, state, io, startListIndex, startPipelineIndex, !needStartExtensions), terminated: false };
    } catch (error) {
      if (error instanceof NounsetDiagnosticFailure) {
        if (state.isolated) throw error;
        throw error.reason;
      }
      if (error instanceof Flow && error.kind === "exit") return { exitCode: await this.finishShell(state, io, error.status), terminated: true };
      throw error;
    }
  }

  private tryFastSinglePipelineUnit(
    pipeline: Pipeline,
    state: State,
    io: IO,
    ignored: boolean,
  ): { exitCode: number; terminated: boolean } | Promise<{ exitCode: number; terminated: boolean }> | undefined {
    if (
      this.middleware.length > 0 ||
      io.terminal !== undefined ||
      io.asyncDefaultInput !== undefined ||
      (io.descriptors &&
        (io.descriptors.size > 3 ||
          io.descriptors.get(0)?.closed ||
          io.descriptors.get(1)?.closed ||
          io.descriptors.get(2)?.closed))
    ) {
      return undefined;
    }
    const monitor = stateMonitor(state);
    if (!monitor) return undefined;
    const rawState = monitor.raw;
    if (
      hasActiveExtensions(rawState) ||
      rawState.externalInvocation ||
      rawState.variableAttributes?.size ||
      guestArrays(state) ||
      rawState.readonlyVariables?.has("PIPESTATUS")
    ) {
      return undefined;
    }
    const store = monitor.store;
    const existing = store?.get("PIPESTATUS");
    const psTarget = existing ? "indexed" : pipelineStatusTarget(rawState);
    if (psTarget !== "indexed" && psTarget !== "absent") return undefined;
    if (store?.watches.has("PIPESTATUS") || monitor.hasOverlay("PIPESTATUS")) return undefined;
    if (existing && (existing.associative || existing.values.size !== 1 || existing.maximum !== 0)) return undefined;
    const elem0 = existing?.values.get(0);
    if (existing && (!elem0 || elem0.text.bytes !== 1)) return undefined;
    const canMutatePipeStatus = !existing || (existing.references === 1 && elem0!.text.references === 1);
    if (!canMutatePipeStatus) return undefined;
    if (pipeline.commands.length === 1) {
      const command = pipeline.commands[0]!;
      if (command.kind !== "simple" || command.words.length === 0 || command.redirects.length > 1) return undefined;
      const w0Plain = command.words[0]!.plain;
      if (
        !w0Plain ||
        !isFastDirectCommand(w0Plain, command.words) ||
        implementedBuiltins.has(w0Plain) ||
        hasShellFunction(rawState, w0Plain) ||
        rawState.extensions?.builtins.has(w0Plain)
      ) {
        return undefined;
      }
      const externalDef = this.getExternalCommand(w0Plain);
      if (
        !externalDef ||
        !builtInDirectContextExecutors.has(externalDef.execute) ||
        customRegisteredCommands.has(externalDef.execute) ||
        command.words.length > this.budget.limits.maxExpansionFields ||
        this.budget.commands + 1 > this.budget.limits.maxCommands
      ) {
        return undefined;
      }
      for (let i = 0; i < command.words.length; i++) {
        if (!this.isPureArgWord(command.words[i]!, rawState)) return undefined;
      }
      if (command.redirects.length === 1) {
        const r0 = command.redirects[0]!;
        if (
          this.budget.limits.maxRedirects < 1 ||
          this.budget.limits.maxFileSystemOperations !== Infinity ||
          io.admittedHandles !== undefined ||
          this.fileWrites.size > 0 ||
          this.outputFiles.size > 0 ||
          !this.canFastMemoryRedirect ||
          r0.descriptor !== 1 ||
          r0.move ||
          r0.document ||
          !(r0.operator === ">" || r0.operator === ">>" || (r0.operator === ">|" && rawState.noclobber)) ||
          (r0.operator === ">" && rawState.noclobber) ||
          !this.isPureArgWord(r0.target, rawState)
        ) {
          return undefined;
        }
      }
      const diagnosticLine = io.diagnosticCommandLines?.get(command) ?? (command.line ?? 1) + (io.diagnosticOffset ?? 0);
      const args = new Array<string>(command.words.length - 1);
      let lastArg = w0Plain;
      try {
        for (let i = 1; i < command.words.length; i++) {
          const v = this.fastValueWord(command.words[i]!, rawState, io, true, false, false, true, undefined, diagnosticLine);
          if (typeof v !== "string") return undefined;
          args[i - 1] = v;
          lastArg = v;
        }
      } catch {
        return undefined;
      }
      let redirectSink: MemoryRedirectSink | undefined;
      if (command.redirects.length === 1) {
        const r0 = command.redirects[0]!;
        let targetVal: ShellValue | undefined;
        try {
          targetVal = this.fastValueWord(r0.target, rawState, io, true, false, false, true, undefined, diagnosticLine);
        } catch {
          return undefined;
        }
        if (typeof targetVal !== "string" || !targetVal || targetVal.includes("\0")) return undefined;
        const resolved = resolvePath(rawState.cwd, targetVal);
        if (resolved === "/dev" || resolved.startsWith("/dev/")) return undefined;
        let handle: MemoryRedirectHandle | undefined;
        try {
          handle = tryOpenMemoryRedirectHandleSync(
            this.backingFs,
            resolved,
            r0.operator === ">>",
            0o666 & ~(rawState.umask ?? 0o022),
            this.signal,
          );
        } catch {
          return undefined;
        }
        if (!handle) return undefined;
        this.budget.fileSystemOperation();
        redirectSink = new MemoryRedirectSink(this.budget, handle, resolved, this.commandSignal);
      }
      if (rawState.extensions && !rawState.extensions.eventDepth) {
        publishCommandSpelling(rawState, commandSpelling(command));
      }
      this.budget.tick();
      rawState.substitutionStatus = 0;
      if (rawState.variables._ !== undefined) delete rawState.variables._;
      rawState.lastArgument = lastArg;
      if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = undefined;
      const scope = io[invocationScope];
      const context = new FastShellCommandContext(this, rawState, io, scope, w0Plain, args, undefined, undefined, this._isMemoryBackingFs);
      if (redirectSink) {
        context.stdout = redirectSink;
        if (io.descriptors) {
          const descriptors = new Map(io.descriptors);
          descriptors.set(1, { output: redirectSink });
          context.descriptors = descriptors;
        }
      }
      _lastFastContextAnchor = [context, redirectSink];
      return this.finishFastSingleExternalUnit(
        externalDef,
        context,
        redirectSink,
        diagnosticLine,
        pipeline.negate,
        ignored || pipeline.negate,
        monitor,
        rawState,
        existing,
        elem0,
        store,
        state,
        io,
      );
    }
    if (pipeline.commands.length >= 2 && !existing) {
      const n = pipeline.commands.length;
      if (this.budget.commands + n > this.budget.limits.maxCommands) return undefined;
      for (let i = 0; i < n; i++) {
        const cmd = pipeline.commands[i]!;
        if (cmd.kind !== "simple" || !this.isPureExternalStageCommand(cmd, rawState) || cmd.words.length > this.budget.limits.maxExpansionFields) {
          return undefined;
        }
      }
      return this.executeFastPurePipelineUnit(pipeline, state, rawState, monitor, io, ignored || pipeline.negate);
    }
    return undefined;
  }

  private finishFastSingleExternalUnit(
    definition: NonNullable<ReturnType<CommandRegistry["get"]>>,
    context: FastShellCommandContext,
    redirectSink: MemoryRedirectSink | undefined,
    diagnosticLine: number,
    negate: boolean,
    ignored: boolean,
    monitor: NonNullable<ReturnType<typeof stateMonitor>>,
    rawState: State,
    existing: ReturnType<NonNullable<typeof monitor.store>["get"]>,
    elem0: IndexedBinding["values"] extends Map<number, infer E> ? E | undefined : never,
    store: typeof monitor.store,
    state: State,
    io: IO,
  ): { exitCode: number; terminated: boolean } | Promise<{ exitCode: number; terminated: boolean }> {
    const scope = io[invocationScope];
    const restEpoch = monitor.chargeInternal(syncRestorationCharge, syncRestorationTickets).epoch;
    scope.enterWork();
    this.budget.beginPathLookupSuspension();
    let raw: CommandResult | Promise<CommandResult> | undefined;
    try {
      scope.assertOpen();
      raw = definition.execute(context as unknown as ShellCommandContext);
      if (!this.budget._hasExternalSignal && (raw === RESOLVED_EXIT_ZERO || raw === RESOLVED_EXIT_ONE)) {
        this.signal.throwIfAborted();
        if (redirectSink?.failedError !== undefined) throw redirectSink.failedError;
        const rawStatus = raw === RESOLVED_EXIT_ZERO ? 0 : 1;
        this.budget.endPathLookupSuspension();
        scope.leaveWork();
        redirectSink?.handle.close();
        if (!existing) {
          monitor.lazyPipeStatus = rawStatus === 0 ? singleStatusZero : singleStatusOne;
          monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets);
        } else {
          elem0!.text.shellValue = String(rawStatus);
          store!.changed(monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets), "PIPESTATUS");
        }
        const finalStatus = negate ? Number(rawStatus === 0) : rawStatus;
        rawState.status = finalStatus;
        monitor.epoch = restEpoch;
        if (store) store.epoch = restEpoch;
        if (finalStatus !== 0 && !ignored && rawState.errexit) {
          if (this.tryFinishShellSync(state)) return { exitCode: finalStatus, terminated: true };
          return this.finishShell(state, io, finalStatus).then(exitCode => ({ exitCode, terminated: true }));
        }
        return finalStatus === 0 ? SYNC_UNIT_ZERO : SYNC_UNIT_ONE;
      }
    } catch (error) {
      return this.finishFastSingleExternalUnitAsync(
        undefined, error, true, redirectSink, diagnosticLine, negate, ignored, monitor, rawState, existing, elem0, store, state, io, scope, restEpoch,
      );
    }
    return this.finishFastSingleExternalUnitAsync(
      raw, undefined, false, redirectSink, diagnosticLine, negate, ignored, monitor, rawState, existing, elem0, store, state, io, scope, restEpoch,
    );
  }

  private async finishFastSingleExternalUnitAsync(
    raw: CommandResult | Promise<CommandResult> | undefined,
    initialError: unknown,
    hasInitialError: boolean,
    redirectSink: MemoryRedirectSink | undefined,
    diagnosticLine: number,
    negate: boolean,
    ignored: boolean,
    monitor: NonNullable<ReturnType<typeof stateMonitor>>,
    rawState: State,
    existing: ReturnType<NonNullable<typeof monitor.store>["get"]>,
    elem0: IndexedBinding["values"] extends Map<number, infer E> ? E | undefined : never,
    store: typeof monitor.store,
    state: State,
    io: IO,
    scope: InvocationScope,
    restEpoch: number,
  ): Promise<{ exitCode: number; terminated: boolean }> {
    let rawStatus = 0;
    try {
      if (hasInitialError) throw initialError;
      const res = this.budget._hasExternalSignal
        ? await interruptible(Promise.resolve(raw!), this.signal)
        : await raw!;
      this.signal.throwIfAborted();
      if (redirectSink?.failedError !== undefined) throw redirectSink.failedError;
      rawStatus = validateExitCode(res.exitCode);
    } catch (error) {
      this.signal.throwIfAborted();
      if (error instanceof Flow || error instanceof ShellLimitError || error instanceof ShellSyntaxError) throw error;
      this.clearOutcomeReport();
      if (errorCode(error) === "EPIPE") {
        rawStatus = 141;
      } else {
        try {
          await writeDiagnostic(io.stderr, `${io.scriptName ?? "shell"}: line ${diagnosticLine}: ${message(error, this.budget.onInternalError)}\n`);
        } catch (failure) {
          this.signal.throwIfAborted();
          publicDiagnosticMessage(failure, this.budget.onInternalError);
        }
        rawStatus = error instanceof CommandFailure ? error.status : 1;
      }
    } finally {
      this.budget.endPathLookupSuspension();
      scope.leaveWork();
      redirectSink?.handle.close();
    }
    if (!existing) {
      monitor.lazyPipeStatus = rawStatus === 0 ? singleStatusZero : rawStatus === 1 ? singleStatusOne : [rawStatus];
      monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets);
    } else if (rawStatus < 10) {
      elem0!.text.shellValue = String(rawStatus);
      store!.changed(monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets), "PIPESTATUS");
    } else {
      await publishPipelineStatus(state, [rawStatus], this.signal, scope);
    }
    const finalStatus = negate ? Number(rawStatus === 0) : rawStatus;
    rawState.status = finalStatus;
    monitor.epoch = restEpoch;
    if (store) store.epoch = restEpoch;
    if (finalStatus !== 0 && !ignored && rawState.errexit) {
      if (this.tryFinishShellSync(state)) return { exitCode: finalStatus, terminated: true };
      return { exitCode: await this.finishShell(state, io, finalStatus), terminated: true };
    }
    return finalStatus === 0 ? SYNC_UNIT_ZERO : finalStatus === 1 ? SYNC_UNIT_ONE : { exitCode: finalStatus, terminated: false };
  }

  private executeFastPurePipelineUnit(
    pipeline: Pipeline,
    state: State,
    rawState: State,
    monitor: NonNullable<ReturnType<typeof stateMonitor>>,
    io: IO,
    ignored: boolean,
  ): { exitCode: number; terminated: boolean } | Promise<{ exitCode: number; terminated: boolean }> {
    const syncRes = this.tryExecuteSyncPurePipelineUnit(pipeline, state, rawState, monitor, io, ignored);
    if (syncRes !== undefined) return syncRes;
    const n = pipeline.commands.length;
    this.budget.enterPipelineStages(n);
    this.budget.commands += n;
    const pipeOptions = { highWaterMark: this.budget.limits.pipeHighWaterMark, signal: this.signal };
    const pipes = new Array<ReturnType<typeof createBytePipe>>(n - 1);
    for (let i = 0; i < n - 1; i++) {
      pipes[i] = createBytePipe(pipeOptions);
    }
    const controllers = new Array<ManagedControlController>(n);
    for (let i = 0; i < n; i++) {
      controllers[i] = createManagedControlController();
    }
    const onParentAbort = (reason: unknown) => {
      for (let i = 0; i < n; i++) abortManagedController(controllers[i]!, reason);
    };
    addAbortSignalWaiter(this.signal, onParentAbort);
    const scope = io[invocationScope];
    const onScopeSeal = () => {
      const closedReason = new Error("Invocation is closed");
      for (let i = 0; i < n; i++) abortManagedController(controllers[i]!, closedReason);
      for (let i = 0; i < n - 1; i++) void pipes[i]!.abort(closedReason);
    };
    scope.addSealCallback(onScopeSeal);
    const statuses = new Array<number>(n);
    let asyncTasks: Promise<number>[] | undefined;
    try {
      for (let index = 0; index < n; index++) {
        const cmd = pipeline.commands[index]! as Extract<Command, { kind: "simple" }>;
        const firstName = cmd.words[0]!.plain!;
        const extDef = this.getExternalCommand(firstName)!;
        let stageArgs = (cmd as { _cachedPlainArgs?: string[] })._cachedPlainArgs;
        if (!stageArgs) {
          stageArgs = new Array<string>(cmd.words.length - 1);
          for (let w = 1; w < cmd.words.length; w++) {
            const word = cmd.words[w]!;
            stageArgs[w - 1] = word.plain ?? word.parts.map(p => (p as { value: string }).value).join("");
          }
          (cmd as { _cachedPlainArgs?: string[] })._cachedPlainArgs = stageArgs;
        }
        const incoming = index > 0 ? pipes[index - 1] : undefined;
        const outgoing = index < n - 1 ? pipes[index] : undefined;
        const reading = incoming?.endpoints?.read;
        const writing = outgoing?.endpoints?.write;
        const stageSignal = controllers[index]!.signal;
        let input: ByteSource;
        if (incoming) {
          (reading as unknown as { abortSignal?: AbortSignal }).abortSignal = stageSignal;
          input = reading! as unknown as ByteSource;
        } else if (io.stdinIsDefault) {
          input = io.stdin;
        } else {
          input = new ShellInput(io.stdin, this.budget, stageSignal, undefined, true);
        }
        const writable = writing?.writable ?? outgoing?.writable;
        const stageStdout = outgoing
          ? new BudgetedPipeStageSink(this.budget, writable!, stageSignal, undefined, index, controllers[index]!)
          : signalSink(io.stdout, stageSignal);
        const context = new FastShellCommandContext(this, rawState, io, scope, firstName, stageArgs, undefined, undefined, true);
        context.stdin = input;
        if (incoming) context.stdinIsDefault = false;
        context.stdout = stageStdout;
        context.signal = stageSignal;
        (context as unknown as { _scopedSignal: AbortSignal })._scopedSignal = stageSignal;
        if (index === 0) _lastPipelineAnchor = [context, stageStdout, input, outgoing];
        if (asyncTasks === undefined) {
          scope.enterWork();
          this.budget.beginPathLookupSuspension();
          let syncExitCode = -1;
          let pendingRes: Promise<CommandResult> | undefined;
          let syncErr: unknown;
          let hasSyncErr = false;
          try {
            const resPromise = extDef.execute(context as unknown as ShellCommandContext);
            if (resPromise === RESOLVED_EXIT_ZERO) {
              stageSignal.throwIfAborted();
              syncExitCode = 0;
            } else if (resPromise === RESOLVED_EXIT_ONE) {
              stageSignal.throwIfAborted();
              syncExitCode = 1;
            } else {
              pendingRes = Promise.resolve(resPromise);
            }
          } catch (error) {
            hasSyncErr = true;
            syncErr = error;
          }
          if (syncExitCode >= 0) {
            this.budget.endPathLookupSuspension();
            scope.leaveWork();
            let asyncCleanup: Promise<unknown> | undefined;
            if (!incoming && input !== io.stdin) {
              const closedInput = (input as ShellInput).close();
              if (!isSyncResolved(closedInput)) asyncCleanup = closedInput;
            }
            if (!asyncCleanup && reading) {
              const closedRead = reading.close();
              if (!isSyncResolved(closedRead)) asyncCleanup = closedRead;
            }
            if (!asyncCleanup && writing) {
              const closedWrite = writing.close();
              if (!isSyncResolved(closedWrite)) asyncCleanup = closedWrite;
            }
            if (!asyncCleanup && outgoing && !writing) {
              const closedOut = outgoing.close();
              if (!isSyncResolved(closedOut)) asyncCleanup = closedOut;
            }
            if (!asyncCleanup) {
              statuses[index] = syncExitCode;
              continue;
            }
            asyncTasks = new Array<Promise<number>>(n);
            for (let prev = 0; prev < index; prev++) asyncTasks[prev] = Promise.resolve(statuses[prev]!);
            asyncTasks[index] = asyncCleanup.then(() => syncExitCode);
            continue;
          }
          asyncTasks = new Array<Promise<number>>(n);
          for (let prev = 0; prev < index; prev++) asyncTasks[prev] = Promise.resolve(statuses[prev]!);
          asyncTasks[index] = this.finishFastPurePipelineStageAsync(
            cmd, context, incoming, outgoing, reading, writing, input, stageSignal, scope, io, pendingRes, hasSyncErr, syncErr,
          );
          continue;
        }
        scope.enterWork();
        this.budget.beginPathLookupSuspension();
        asyncTasks[index] = this.finishFastPurePipelineStageAsync(
          cmd, context, incoming, outgoing, reading, writing, input, stageSignal, scope, io, undefined, false, undefined, extDef,
        );
      }
      if (asyncTasks !== undefined) {
        return this.finishFastPurePipelineUnitAsync(
          asyncTasks, n, pipes, controllers, onParentAbort, onScopeSeal, scope, monitor, rawState, pipeline, state, io, ignored,
        );
      }
    } catch (syncFatal) {
      scope.removeSealCallback(onScopeSeal);
      removeAbortSignalWaiter(this.signal, onParentAbort);
      for (let i = 0; i < n; i++) abortManagedController(controllers[i]!, SHARED_PIPELINE_CLOSED);
      for (let i = 0; i < n - 1; i++) void pipes[i]!.abort();
      this.budget.leavePipelineStages(n);
      throw syncFatal;
    }
    scope.removeSealCallback(onScopeSeal);
    removeAbortSignalWaiter(this.signal, onParentAbort);
    for (let i = 0; i < n; i++) {
      abortManagedController(controllers[i]!, SHARED_PIPELINE_CLOSED);
    }
    for (let i = 0; i < n - 1; i++) {
      void pipes[i]!.abort();
    }
    this.budget.leavePipelineStages(n);
    const restEpoch = monitor.chargeInternal(syncRestorationCharge, syncRestorationTickets).epoch;
    monitor.lazyPipeStatus = statuses;
    monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets);
    const rawStatus = rawState.pipefail ? statuses.findLast(s => s !== 0) ?? 0 : statuses[n - 1]!;
    const finalStatus = pipeline.negate ? Number(rawStatus === 0) : rawStatus;
    rawState.status = finalStatus;
    monitor.epoch = restEpoch;
    if (rawStatus !== 0 && !pipeline.negate && !ignored && rawState.errexit) {
      if (this.tryFinishShellSync(state)) return { exitCode: finalStatus, terminated: true };
      return this.finishShell(state, io, finalStatus).then(exitCode => ({ exitCode, terminated: true }));
    }
    return finalStatus === 0 ? SYNC_UNIT_ZERO : finalStatus === 1 ? SYNC_UNIT_ONE : { exitCode: finalStatus, terminated: false };
  }

  private tryExecuteSyncPurePipelineUnit(
    pipeline: Pipeline,
    state: State,
    rawState: State,
    monitor: NonNullable<ReturnType<typeof stateMonitor>>,
    io: IO,
    ignored: boolean,
  ): { exitCode: number; terminated: boolean } | Promise<{ exitCode: number; terminated: boolean }> | undefined {
    if (
      syncPurePipelineSlotInUse ||
      !io.stdinIsDefault ||
      this.signal.aborted ||
      hasYieldCheckpoint(this.signal) ||
      this.budget.limits.pipeHighWaterMark < 65536 ||
      !(io.stdout instanceof Capture && io.stdout.length === 0 && io.stdout.write === Capture.prototype.write) ||
      !(io.stderr instanceof Capture && io.stderr.length === 0 && io.stderr.write === Capture.prototype.write)
    ) {
      return undefined;
    }
    const n = pipeline.commands.length;
    for (let i = 0; i < n; i++) {
      const cmd = pipeline.commands[i]! as Extract<Command, { kind: "simple" }>;
      const name = cmd.words[0]!.plain!;
      if (name !== "grep" && name !== "cut" && name !== "tr" && name !== "sort" && name !== "head" && name !== "find" && name !== "wc") {
        return undefined;
      }
      if (!this.getExternalCommand(name)) return undefined;
    }
    syncPurePipelineSlotInUse = true;
    const savedCommands = this.budget.commands;
    const savedBytes = this.budget.bytes;
    const savedFsOps = (this.budget as unknown as { _fileSystemOperations: number })._fileSystemOperations;
    this.budget.enterPipelineStages(n);
    this.budget.commands += n;
    const scope = io[invocationScope];
    const statuses = new Array<number>(n);
    const stdoutCap = io.stdout as Capture;
    const stderrCap = io.stderr as Capture;
    let context = pooledSyncPipeContext;
    try {
      let prevBuf = sharedSyncPipeBuf0;
      let prevLen = 0;
      for (let index = 0; index < n; index++) {
        const cmd = pipeline.commands[index]! as Extract<Command, { kind: "simple" }>;
        const firstName = cmd.words[0]!.plain!;
        const extDef = this.getExternalCommand(firstName)!;
        let stageArgs = (cmd as { _cachedPlainArgs?: string[] })._cachedPlainArgs;
        if (!stageArgs) {
          stageArgs = new Array<string>(cmd.words.length - 1);
          for (let w = 1; w < cmd.words.length; w++) {
            const word = cmd.words[w]!;
            stageArgs[w - 1] = word.plain ?? word.parts.map(p => (p as { value: string }).value).join("");
          }
          (cmd as { _cachedPlainArgs?: string[] })._cachedPlainArgs = stageArgs;
        }
        const isFirst = index === 0;
        const isLast = index === n - 1;
        let inputSource: ByteSource;
        if (isFirst) {
          inputSource = io.stdin;
        } else {
          sharedSyncPipeReader.reset(prevBuf, prevLen, this.signal);
          inputSource = sharedSyncPipeReader;
        }
        const nextBuf = (index & 1) === 0 ? sharedSyncPipeBuf0 : sharedSyncPipeBuf1;
        let stageStdout: ByteSink;
        if (isLast) {
          stageStdout = signalSink(io.stdout, this.signal);
        } else {
          sharedSyncPipeWriter.reset(this.budget, this.signal, nextBuf);
          stageStdout = sharedSyncPipeWriter;
        }
        if (!context) {
          context = new FastShellCommandContext(this, rawState, io, scope, firstName, stageArgs, undefined, undefined, true);
          pooledSyncPipeContext = context;
        }
        context.resetDirectStage(this, rawState, io, scope, firstName, stageArgs, inputSource, isFirst, stageStdout, this.signal);
        scope.enterWork();
        this.budget.beginPathLookupSuspension();
        let resPromise: CommandResult | Promise<CommandResult>;
        try {
          resPromise = extDef.execute(context as unknown as ShellCommandContext);
        } finally {
          this.budget.endPathLookupSuspension();
          scope.leaveWork();
        }
        if (
          (resPromise !== RESOLVED_EXIT_ZERO && resPromise !== RESOLVED_EXIT_ONE) ||
          (!isLast && sharedSyncPipeWriter.overflowed) ||
          stderrCap.length > 0
        ) {
          this.budget.commands = savedCommands;
          this.budget.bytes = savedBytes;
          (this.budget as unknown as { _fileSystemOperations: number })._fileSystemOperations = savedFsOps;
          this.budget.leavePipelineStages(n);
          stdoutCap.resetEmpty();
          stderrCap.resetEmpty();
          return undefined;
        }
        this.signal.throwIfAborted();
        statuses[index] = resPromise === RESOLVED_EXIT_ZERO ? 0 : 1;
        prevBuf = nextBuf;
        prevLen = sharedSyncPipeWriter.used;
      }
    } catch (err) {
      if (err instanceof ShellLimitError) {
        this.budget.leavePipelineStages(n);
        throw err;
      }
      this.budget.commands = savedCommands;
      this.budget.bytes = savedBytes;
      (this.budget as unknown as { _fileSystemOperations: number })._fileSystemOperations = savedFsOps;
      this.budget.leavePipelineStages(n);
      stdoutCap.resetEmpty();
      stderrCap.resetEmpty();
      return undefined;
    } finally {
      if (context) {
        (context as unknown as { _runtime: unknown; _state: unknown; _io: unknown; _scope: unknown; _contextFs: unknown; stdin: unknown; stdout: unknown })._runtime = undefined;
        (context as unknown as { _state: unknown })._state = undefined;
        (context as unknown as { _io: unknown })._io = undefined;
        (context as unknown as { _scope: unknown })._scope = undefined;
        (context as unknown as { _contextFs: unknown })._contextFs = undefined;
        (context as unknown as { stdin: unknown }).stdin = undefined;
        (context as unknown as { stdout: unknown }).stdout = undefined;
      }
      sharedSyncPipeWriter.budget = undefined!;
      sharedSyncPipeWriter.signal = undefined!;
      sharedSyncPipeWriter.target = EMPTY_BYTES;
      sharedSyncPipeReader.reset(EMPTY_BYTES, 0);
      syncPurePipelineSlotInUse = false;
    }
    this.budget.leavePipelineStages(n);
    const restEpoch = monitor.chargeInternal(syncRestorationCharge, syncRestorationTickets).epoch;
    monitor.lazyPipeStatus = statuses;
    monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets);
    const rawStatus = rawState.pipefail ? statuses.findLast(s => s !== 0) ?? 0 : statuses[n - 1]!;
    const finalStatus = pipeline.negate ? Number(rawStatus === 0) : rawStatus;
    rawState.status = finalStatus;
    monitor.epoch = restEpoch;
    if (rawStatus !== 0 && !pipeline.negate && !ignored && rawState.errexit) {
      if (this.tryFinishShellSync(state)) return { exitCode: finalStatus, terminated: true };
      return this.finishShell(state, io, finalStatus).then(exitCode => ({ exitCode, terminated: true }));
    }
    return finalStatus === 0 ? SYNC_UNIT_ZERO : finalStatus === 1 ? SYNC_UNIT_ONE : { exitCode: finalStatus, terminated: false };
  }

  private async finishFastPurePipelineStageAsync(
    cmd: Extract<Command, { kind: "simple" }>,
    context: FastShellCommandContext,
    incoming: ReturnType<typeof createBytePipe> | undefined,
    outgoing: ReturnType<typeof createBytePipe> | undefined,
    reading: NonNullable<ReturnType<typeof createBytePipe>["endpoints"]>["read"] | undefined,
    writing: NonNullable<ReturnType<typeof createBytePipe>["endpoints"]>["write"] | undefined,
    input: ByteSource,
    stageSignal: AbortSignal,
    scope: InvocationScope,
    io: IO,
    pendingRes: Promise<CommandResult> | undefined,
    hasSyncErr: boolean,
    syncErr: unknown,
    extDef?: CommandDefinition,
  ): Promise<number> {
    let exitCode = 0;
    try {
      if (hasSyncErr) throw syncErr;
      const res = await (pendingRes ?? extDef!.execute(context as unknown as ShellCommandContext));
      stageSignal.throwIfAborted();
      exitCode = validateExitCode(res.exitCode);
    } catch (error) {
      if (error instanceof PipelineClosed || (stageSignal.aborted && Object.is(stageSignal.reason, SHARED_PIPELINE_CLOSED))) {
        exitCode = 141;
      } else if (errorCode(error) === "EPIPE" && !this.signal.aborted) {
        exitCode = 141;
      } else {
        this.signal.throwIfAborted();
        if (error instanceof Flow || error instanceof ShellLimitError || error instanceof ShellSyntaxError) throw error;
        const line = io.diagnosticCommandLines?.get(cmd) ?? (cmd.line ?? 1) + (io.diagnosticOffset ?? 0);
        try {
          await writeDiagnostic(context.stderr, `${io.scriptName ?? "shell"}: line ${line}: ${message(error, this.budget.onInternalError)}\n`);
        } catch (failure) {
          this.signal.throwIfAborted();
          publicDiagnosticMessage(failure, this.budget.onInternalError);
        }
        exitCode = error instanceof CommandFailure ? error.status : 1;
      }
    } finally {
      this.budget.endPathLookupSuspension();
      scope.leaveWork();
      if (!incoming && input !== io.stdin) {
        const closedInput = (input as ShellInput).close();
        if (!isSyncResolved(closedInput)) {
          await closedInput.catch((error: unknown) => { if (!(error instanceof PipelineClosed)) throw error; });
        }
      }
      if (reading) {
        const closedRead = reading.close();
        if (!isSyncResolved(closedRead)) await closedRead;
      }
      if (writing) {
        const closedWrite = writing.close();
        if (!isSyncResolved(closedWrite)) await closedWrite;
      }
      if (outgoing && !writing) {
        const closedOut = outgoing.close();
        if (!isSyncResolved(closedOut)) await closedOut.catch(() => undefined);
      }
    }
    return exitCode;
  }

  private async finishFastPurePipelineUnitAsync(
    tasks: Promise<number>[],
    n: number,
    pipes: ReturnType<typeof createBytePipe>[],
    controllers: ManagedControlController[],
    onParentAbort: (reason: unknown) => void,
    onScopeSeal: () => void,
    scope: InvocationScope,
    monitor: NonNullable<ReturnType<typeof stateMonitor>>,
    rawState: State,
    pipeline: Pipeline,
    state: State,
    io: IO,
    ignored: boolean,
  ): Promise<{ exitCode: number; terminated: boolean }> {
    let statuses: number[];
    try {
      statuses = this.budget._hasExternalSignal
        ? await interruptible(Promise.all(tasks), this.signal)
        : await Promise.all(tasks);
    } finally {
      scope.removeSealCallback(onScopeSeal);
      removeAbortSignalWaiter(this.signal, onParentAbort);
      for (let i = 0; i < n; i++) {
        abortManagedController(controllers[i]!, SHARED_PIPELINE_CLOSED);
      }
      for (let i = 0; i < n - 1; i++) {
        const ab = pipes[i]!.abort();
        if (!isSyncResolved(ab)) await ab;
      }
      this.budget.leavePipelineStages(n);
    }
    const restEpoch = monitor.chargeInternal(syncRestorationCharge, syncRestorationTickets).epoch;
    monitor.lazyPipeStatus = statuses;
    monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets);
    const rawStatus = rawState.pipefail ? statuses.findLast(s => s !== 0) ?? 0 : statuses[n - 1]!;
    const finalStatus = pipeline.negate ? Number(rawStatus === 0) : rawStatus;
    rawState.status = finalStatus;
    monitor.epoch = restEpoch;
    if (rawStatus !== 0 && !pipeline.negate && !ignored && rawState.errexit) {
      if (this.tryFinishShellSync(state)) return { exitCode: finalStatus, terminated: true };
      return { exitCode: await this.finishShell(state, io, finalStatus), terminated: true };
    }
    return finalStatus === 0 ? SYNC_UNIT_ZERO : finalStatus === 1 ? SYNC_UNIT_ONE : { exitCode: finalStatus, terminated: false };
  }

  private async inputUnit(script: Script, state: State, io: IO, startListIndex = 0, startPipelineIndex = 0, skipFirstSync = false): Promise<number> {
    try { return await this.script(script, state, io, startListIndex, startPipelineIndex, skipFirstSync); }
    catch (error) {
      if (!(error instanceof Flow) || error.kind !== "discard") throw error;
      this.signal.throwIfAborted();
      throwCleanupFailures(io[invocationScope].failures);
      state.status = error.status;
      return error.status;
    }
  }

  private trySyncPipeline(pipeline: Pipeline, state: State, io: IO, ignored: boolean): number | undefined {
    if (this.middleware.length > 0) return undefined;
    if (pipeline.commands.length !== 1) return undefined;
    const command = pipeline.commands[0]!;
    if (
      (command.kind !== "simple" && command.kind !== "arithmetic" && command.kind !== "arithmetic-for" && command.kind !== "for") ||
      command.redirects.length > 1
    ) {
      return undefined;
    }
    if (command.kind === "simple") {
      const wordsLen = command.words.length;
      if (wordsLen === 0) return undefined;
      const w0 = command.words[0]!;
      const w0Plain = w0.plain;
      if (command.redirects.length === 1) {
        if (w0Plain !== "echo" && w0Plain !== "printf") return undefined;
      } else if (wordsLen >= 2) {
        if (
          w0Plain !== "echo" &&
          w0Plain !== "printf" &&
          w0Plain !== "[" &&
          w0Plain !== "test" &&
          w0Plain !== "mkdir" &&
          w0Plain !== "rm"
        ) {
          return undefined;
        }
      } else if (
        w0Plain !== "echo" &&
        w0Plain !== "printf" &&
        w0Plain !== ":" &&
        w0Plain !== "true" &&
        w0Plain !== "false" &&
        !(w0.parts[0]?.kind === "text" && w0.parts[0].value.includes("="))
      ) {
        return undefined;
      }
    }
    const scope = io[invocationScope];
    if (scope.hasFailures) return undefined;
    const monitor = stateMonitor(state) ?? stateMonitor(trackState(state, this.budget, scope));
    if (!monitor) return undefined;
    const rawState = monitor.raw;
    if (io.terminal || io.asyncDefaultInput || hasActiveExtensions(rawState) || rawState.variableAttributes?.size || guestArrays(rawState)) return undefined;
    if (((this.budget.commands + 1) & 127) === 0) {
      if (hasYieldCheckpoint(this.signal) || ((this.budget.commands + 1) & 2047) === 0) return undefined;
      runYieldCheckpoint(this.signal);
    }
    this.signal.throwIfAborted();
    scope.assertOpen();
    if (io.descriptors && (io.descriptors.get(0)?.closed || io.descriptors.get(1)?.closed || io.descriptors.get(2)?.closed)) return undefined;
    if (rawState.readonlyVariables?.has("PIPESTATUS")) return undefined;
    const store = monitor.store;
    const existing = store?.get("PIPESTATUS");
    const psTarget = existing ? "indexed" : pipelineStatusTarget(rawState);
    if (psTarget !== "indexed" && psTarget !== "absent") return undefined;
    if (store?.watches.has("PIPESTATUS") || monitor.hasOverlay("PIPESTATUS")) return undefined;
    if (
      existing &&
      (existing.associative || existing.values.size !== 1 || existing.maximum !== 0)
    ) {
      return undefined;
    }
    const elem0 = existing?.values.get(0);
    if (existing && (!elem0 || elem0.text.bytes !== 1)) return undefined;
    const canMutatePipeStatus = !existing || (existing.references === 1 && elem0!.text.references === 1);
    const diagnosticLine = io.diagnosticCommandLines?.get(command) ?? (command.line ?? 1) + (io.diagnosticOffset ?? 0);
    if (command.kind === "arithmetic") {
      if (
        command.redirects.length !== 0 ||
        command.expression.error ||
        command.expression.hasSubscript ||
        !canMutatePipeStatus ||
        (!ignored && rawState.errexit) ||
        rawState.nounset ||
        rawState.readonlyVariables?.size
      ) {
        return undefined;
      }
      let nonZero: boolean;
      try {
        nonZero = this.syncShellArithmeticNonZero(command.expression, rawState, diagnosticLine);
      } catch {
        this.signal.throwIfAborted();
        return undefined;
      }
      if (rawState.extensions && !rawState.extensions.eventDepth) {
        publishCommandSpelling(rawState, commandSpelling(command));
      }
      const restEpoch = monitor.chargeInternal(syncRestorationCharge, syncRestorationTickets).epoch;
      this.budget.tick();
      if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = "((";
      const rawStatus = nonZero ? 0 : 1;
      const finalStatus = pipeline.negate ? Number(rawStatus === 0) : rawStatus;
      if (!existing) {
        monitor.lazyPipeStatus = finalStatus === 0 ? singleStatusZero : singleStatusOne;
        monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets);
      } else {
        elem0!.text.shellValue = finalStatus === 0 ? "0" : "1";
        store!.changed(monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets), "PIPESTATUS");
      }
      rawState.status = finalStatus;
      monitor.epoch = restEpoch;
      if (store) store.epoch = restEpoch;
      return finalStatus;
    }
    if (command.kind === "arithmetic-for" || command.kind === "for") {
      return this.trySyncLoop(command, pipeline, rawState, monitor, store, existing, elem0, canMutatePipeStatus, io, diagnosticLine);
    }
    if (command.redirects.length === 1) {
      if (!canMutatePipeStatus && elem0!.text.shellValue !== "0") return undefined;
      if (pipeline.negate && !ignored && rawState.errexit) return undefined;
      if (
        command.words.length === 0 ||
        this.budget.limits.maxRedirects < 1 ||
        this.fileWrites.size !== 0 ||
        this.outputFiles.size !== 0 ||
        !this.canFastMemoryRedirect
      ) {
        return undefined;
      }
      const r0 = command.redirects[0]!;
      const w0Plain = command.words[0]!.plain;
      if (
        r0.descriptor !== 1 ||
        r0.move ||
        r0.document ||
        (r0.operator !== ">" && r0.operator !== ">>" && !(r0.operator === ">|" && rawState.noclobber)) ||
        (r0.operator === ">" && rawState.noclobber) ||
        (w0Plain !== "echo" && w0Plain !== "printf") ||
        hasShellFunction(rawState, w0Plain) ||
        rawState.extensions?.builtins.has(w0Plain)
      ) {
        return undefined;
      }
      const def = this.commands.get(w0Plain);
      if (
        !def ||
        (w0Plain === "printf" ? def.execute !== printfCommand.execute : !defaultEchoExecutors.has(def.execute)) ||
        command.words.length > this.budget.limits.maxExpansionFields ||
        !this.isPureArgWord(r0.target, rawState) ||
        !this.arePureArgWords(command.words, rawState)
      ) {
        return undefined;
      }
      if (rawState.extensions && !rawState.extensions.eventDepth) {
        publishCommandSpelling(rawState, commandSpelling(command));
      }
      type CachedConstEchoRedirect = {
        arg0: string;
        targetPath: string;
        dirPrefix: string | undefined;
        fileName: string | undefined;
        encoded: Uint8Array;
        append: boolean;
      };
      let cachedConst = (command as { _cachedConstEchoRedirect?: CachedConstEchoRedirect | null })._cachedConstEchoRedirect;
      if (cachedConst === undefined && w0Plain === "echo" && command.words.length === 2) {
        const w1 = command.words[1]!;
        const p1 = w1.parts.length === 1 ? w1.parts[0]! : undefined;
        const pt = r0.target.parts.length === 1 ? r0.target.parts[0]! : undefined;
        if (
          p1?.kind === "text" && !p1.byteValue && !p1.value.startsWith("-") && !p1.value.includes("\0") &&
          (!p1.value.includes("{") && !p1.value.startsWith("~") && !hasGlobOrEscape(p1.value, true)) &&
          pt?.kind === "text" && !pt.byteValue && pt.value.startsWith("/") && !pt.value.includes("\0") &&
          (!pt.value.includes("{") && !hasGlobOrEscape(pt.value, true)) &&
          isCleanAbsolutePath(pt.value) && pt.value !== "/dev" && !pt.value.startsWith("/dev/")
        ) {
          const lastSlash = pt.value.lastIndexOf("/");
          let dirPrefix: string | undefined;
          let fileName: string | undefined;
          if (lastSlash >= 1) {
            dirPrefix = pt.value.slice(0, lastSlash + 1);
            fileName = pt.value.slice(lastSlash + 1);
          }
          cachedConst = {
            arg0: p1.value,
            targetPath: pt.value,
            dirPrefix,
            fileName,
            encoded: fastSharedTextEncoder.encode(`${p1.value}\n`),
            append: r0.operator === ">>",
          };
          (command as { _cachedConstEchoRedirect?: CachedConstEchoRedirect | null })._cachedConstEchoRedirect = cachedConst;
        } else {
          cachedConst = null;
          (command as { _cachedConstEchoRedirect?: CachedConstEchoRedirect | null })._cachedConstEchoRedirect = null;
        }
      }
      if (cachedConst) {
        const byteLength = cachedConst.encoded.byteLength;
        if (byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) return undefined;
        if (!this.budget.canFileSystemOperation()) return undefined;
        const mode = 0o666 & ~(rawState.umask ?? 0o022);
        try {
          const wrote = cachedConst.dirPrefix !== undefined && cachedConst.fileName !== undefined
            ? (tryWriteMemoryFileInDirSync(this.backingFs, cachedConst.dirPrefix, cachedConst.fileName, cachedConst.encoded, cachedConst.append, mode, this.commandSignal) ||
               tryWriteMemoryFileSync(this.backingFs, cachedConst.targetPath, cachedConst.encoded, cachedConst.append, mode, this.commandSignal))
            : tryWriteMemoryFileSync(this.backingFs, cachedConst.targetPath, cachedConst.encoded, cachedConst.append, mode, this.commandSignal);
          if (!wrote) return undefined;
        } catch {
          this.signal.throwIfAborted();
          return undefined;
        }
        const restEpoch = monitor.chargeInternal(syncRestorationCharge, syncRestorationTickets).epoch;
        this.budget.tick();
        this.budget.fileSystemOperation();
        this.budget.bytes += byteLength;
        rawState.substitutionStatus = 0;
        if (rawState.variables._ !== undefined) delete rawState.variables._;
        rawState.lastArgument = cachedConst.arg0;
        if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = undefined;
        if (!existing) {
          monitor.lazyPipeStatus = singleStatusZero;
          monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets);
        } else {
          elem0!.text.shellValue = "0";
          store!.changed(monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets), "PIPESTATUS");
        }
        const finalStatus = pipeline.negate ? 1 : 0;
        rawState.status = finalStatus;
        monitor.epoch = restEpoch;
        if (store) store.epoch = restEpoch;
        return finalStatus;
      }
      let targetVal: ShellValue | undefined;
      let formatted: string | undefined;
      let preEncoded: Uint8Array | undefined;
      let lastArg = w0Plain;
      try {
        if (w0Plain === "echo" && command.words.length === 1) {
          targetVal = this.fastValueWord(r0.target, rawState, io, true, false, false, true, undefined, diagnosticLine);
          formatted = "\n";
        } else if (w0Plain === "echo" && command.words.length === 2) {
          const arg0 = this.fastValueWord(command.words[1]!, rawState, io, true, false, false, true, undefined, diagnosticLine);
          if (typeof arg0 === "string" && !arg0.startsWith("-") && !arg0.includes("\0")) {
            targetVal = this.fastValueWord(r0.target, rawState, io, true, false, false, true, undefined, diagnosticLine);
            preEncoded = encodeRedirectTextWithNewlineToScratch(arg0);
            if (preEncoded === undefined) formatted = `${arg0}\n`;
            lastArg = arg0;
          }
        } else {
          fastSubScratchArgs.length = 0;
          let allStrings = true;
          for (let i = 1; i < command.words.length; i++) {
            const v = this.fastValueWord(command.words[i]!, rawState, io, true, false, false, true, undefined, diagnosticLine);
            if (typeof v !== "string") {
              allStrings = false;
              break;
            }
            fastSubScratchArgs.push(v);
          }
          if (allStrings) {
            if (fastSubScratchArgs.length > 0) lastArg = fastSubScratchArgs[fastSubScratchArgs.length - 1]!;
            if (w0Plain === "printf") {
              formatted = tryFastPrintf(fastSubScratchArgs);
            } else if (!fastSubScratchArgs[0]?.startsWith("-")) {
              const joined = `${fastSubScratchArgs.join(" ")}\n`;
              if (!joined.includes("\0")) formatted = joined;
            }
            fastSubScratchArgs.length = 0;
            if (formatted !== undefined) {
              targetVal = this.fastValueWord(r0.target, rawState, io, true, false, false, true, undefined, diagnosticLine);
            }
          } else {
            fastSubScratchArgs.length = 0;
          }
        }
      } catch {
        fastSubScratchArgs.length = 0;
        return undefined;
      }
      if ((preEncoded === undefined && formatted === undefined) || typeof targetVal !== "string" || targetVal.length === 0 || targetVal.includes("\0")) {
        return undefined;
      }
      const path = isCleanAbsolutePath(targetVal) ? targetVal : pathOf(rawState, targetVal);
      if (path.startsWith("/dev/") || path === "/dev") return undefined;
      const encoded = preEncoded ?? encodeRedirectTextToScratch(formatted!);
      const byteLength = encoded.byteLength;
      if (byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) return undefined;
      if (!this.budget.canFileSystemOperation()) return undefined;
      const mode = 0o666 & ~(rawState.umask ?? 0o022);
      try {
        if (!tryWriteMemoryFileSync(this.backingFs, path, encoded, r0.operator === ">>", mode, this.commandSignal)) {
          return undefined;
        }
      } catch {
        this.signal.throwIfAborted();
        return undefined;
      }
      const restEpoch = monitor.chargeInternal(syncRestorationCharge, syncRestorationTickets).epoch;
      this.budget.tick();
      this.budget.fileSystemOperation();
      this.budget.bytes += byteLength;
      rawState.substitutionStatus = 0;
      delete rawState.variables._;
      rawState.lastArgument = lastArg;
      if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = undefined;
      if (!existing) {
        monitor.lazyPipeStatus = singleStatusZero;
        monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets);
      } else {
        elem0!.text.shellValue = "0";
        store!.changed(monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets), "PIPESTATUS");
      }
      const finalStatus = pipeline.negate ? 1 : 0;
      rawState.status = finalStatus;
      monitor.epoch = restEpoch;
      if (store) store.epoch = restEpoch;
      return finalStatus;
    }
    if (command.words.length === 1) {
      const w0 = command.words[0]!;
      const w0Plain = w0.plain;
      if (
        (w0Plain === ":" || w0Plain === "true" || w0Plain === "false") &&
        !hasShellFunction(rawState, w0Plain) &&
        !rawState.extensions?.builtins.has(w0Plain)
      ) {
        const rawStatus = w0Plain === "false" ? 1 : 0;
        const statusChar = rawStatus === 0 ? "0" : "1";
        if (!canMutatePipeStatus && elem0!.text.shellValue !== statusChar) return undefined;
        const finalStatus = pipeline.negate ? Number(rawStatus === 0) : rawStatus;
        if (finalStatus !== 0 && !ignored && rawState.errexit) return undefined;
        if (rawState.extensions && !rawState.extensions.eventDepth) {
          publishCommandSpelling(rawState, commandSpelling(command));
        }
        const restEpoch = monitor.chargeInternal(syncRestorationCharge, syncRestorationTickets).epoch;
        this.budget.tick();
        rawState.substitutionStatus = 0;
        delete rawState.variables._;
        rawState.lastArgument = w0Plain;
        if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = undefined;
        if (!existing) {
          monitor.lazyPipeStatus = rawStatus === 0 ? singleStatusZero : singleStatusOne;
          monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets);
        } else {
          elem0!.text.shellValue = statusChar;
          store!.changed(monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets), "PIPESTATUS");
        }
        rawState.status = finalStatus;
        monitor.epoch = restEpoch;
        if (store) store.epoch = restEpoch;
        return finalStatus;
      }
      if (!canMutatePipeStatus && elem0!.text.shellValue !== "0") return undefined;
      if (pipeline.negate && !ignored && rawState.errexit) return undefined;
      const assignment = !getArrayAssignment(w0) ? this.assignment(w0) : undefined;
      if (
        !assignment ||
        assignment.append ||
        assignment.name === "OPTIND" ||
        assignment.name === "PIPESTATUS" ||
        assignment.name.includes("[") ||
        rawState.readonlyVariables?.has(assignment.name) ||
        store?.get(assignment.name)
      ) {
        return undefined;
      }
      if (rawState.extensions && !rawState.extensions.eventDepth) {
        publishCommandSpelling(rawState, commandSpelling(command));
      }
      let fastAssigned: ShellValue | undefined;
      try {
        fastAssigned = this.fastValueWord(assignment.value, rawState, io, false, false, false, false, 0, diagnosticLine);
      } catch {
        return undefined;
      }
      if (fastAssigned === undefined) return undefined;
      const restEpoch = monitor.chargeInternal(syncRestorationCharge, syncRestorationTickets).epoch;
      this.budget.tick();
      rawState.substitutionStatus = 0;
      if (assignment.name !== "_") delete rawState.variables._;
      rawState.lastArgument = "";
      monitor.publishStringVariable(assignment.name, fastAssigned as string);
      if (rawState.allexport) monitor.proxy.exported.add(assignment.name);
      if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = undefined;
      if (!existing) {
        monitor.lazyPipeStatus = singleStatusZero;
        monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets);
      } else {
        elem0!.text.shellValue = "0";
        store!.changed(monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets), "PIPESTATUS");
      }
      const finalStatus = pipeline.negate ? 1 : 0;
      rawState.status = finalStatus;
      monitor.epoch = restEpoch;
      if (store) store.epoch = restEpoch;
      return finalStatus;
    }
    if (command.words.length >= 1) {
      const w0Plain = command.words[0]!.plain;
      if (
        (w0Plain === "echo" || w0Plain === "printf") &&
        !hasShellFunction(rawState, w0Plain) &&
        !rawState.extensions?.builtins.has(w0Plain) &&
        (!io.descriptors || io.descriptors.get(1)?.output === io.stdout)
      ) {
        const fastSyncSink =
          (io.stdout instanceof BudgetedSyncSink && io.stdout.write === BudgetedSyncSink.prototype.write) ||
          (io.stdout instanceof Capture && io.stdout.write === Capture.prototype.write)
            ? io.stdout
            : undefined;
        const syncOut = fastSyncSink ? undefined : syncSinks.get(io.stdout);
        const def = (fastSyncSink || syncOut) ? this.commands.get(w0Plain) : undefined;
        if (
          (fastSyncSink || syncOut) &&
          def &&
          (w0Plain === "printf" ? def.execute === printfCommand.execute : defaultEchoExecutors.has(def.execute)) &&
          command.words.length <= this.budget.limits.maxExpansionFields &&
          this.arePureArgWords(command.words, rawState) &&
          (canMutatePipeStatus || elem0!.text.shellValue === "0") &&
          (!pipeline.negate || ignored || !rawState.errexit)
        ) {
          if (rawState.extensions && !rawState.extensions.eventDepth) {
            publishCommandSpelling(rawState, commandSpelling(command));
          }
          let formatted: string | undefined;
          let lastArg = w0Plain;
          try {
            if (w0Plain === "echo" && command.words.length === 1) {
              formatted = "\n";
            } else if (w0Plain === "echo" && command.words.length === 2) {
              const arg0 = this.fastValueWord(command.words[1]!, rawState, io, true, false, false, true, undefined, diagnosticLine);
              if (typeof arg0 === "string" && !arg0.startsWith("-") && !arg0.includes("\0")) {
                formatted = `${arg0}\n`;
                lastArg = arg0;
              }
            } else {
              fastSubScratchArgs.length = 0;
              let allStrings = true;
              for (let i = 1; i < command.words.length; i++) {
                const v = this.fastValueWord(command.words[i]!, rawState, io, true, false, false, true, undefined, diagnosticLine);
                if (typeof v !== "string") {
                  allStrings = false;
                  break;
                }
                fastSubScratchArgs.push(v);
              }
              if (allStrings) {
                if (fastSubScratchArgs.length > 0) lastArg = fastSubScratchArgs[fastSubScratchArgs.length - 1]!;
                if (w0Plain === "printf") {
                  formatted = tryFastPrintf(fastSubScratchArgs);
                } else if (!fastSubScratchArgs[0]?.startsWith("-")) {
                  const joined = `${fastSubScratchArgs.join(" ")}\n`;
                  if (!joined.includes("\0")) formatted = joined;
                }
              }
              fastSubScratchArgs.length = 0;
            }
          } catch {
            fastSubScratchArgs.length = 0;
            return undefined;
          }
          if (formatted !== undefined) {
            const encoded = encodeRedirectTextToScratch(formatted);
            const byteLength = encoded.byteLength;
            if (byteLength <= this.budget.limits.maxOutputBytes - this.budget.bytes) {
              const restEpoch = monitor.chargeInternal(syncRestorationCharge, syncRestorationTickets).epoch;
              this.budget.tick();
              if (fastSyncSink) {
                if (fastSyncSink.budget !== this.budget) {
                  this.budget.bytes += byteLength;
                  if (fastSyncSink instanceof Capture) fastSyncSink.writeRawSync(encoded);
                  else fastSyncSink.target.writeRawSync(encoded);
                } else {
                  fastSyncSink.writeSync(encoded);
                }
              } else {
                if (budgetedSinks.get(io.stdout)?.budget !== this.budget) {
                  this.budget.bytes += byteLength;
                }
                syncOut!(encoded);
              }
              rawState.substitutionStatus = 0;
              if (rawState.variables._ !== undefined) delete rawState.variables._;
              rawState.lastArgument = lastArg;
              if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = undefined;
              if (!existing) {
                monitor.lazyPipeStatus = singleStatusZero;
                monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets);
              } else {
                elem0!.text.shellValue = "0";
                store!.changed(monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets), "PIPESTATUS");
              }
              const finalStatus = pipeline.negate ? 1 : 0;
              rawState.status = finalStatus;
              monitor.epoch = restEpoch;
              if (store) store.epoch = restEpoch;
              return finalStatus;
            }
          }
        }
      }
    }
    if (command.words.length >= 2) {
      const w0Plain = command.words[0]!.plain;
      if (
        (w0Plain === "[" || w0Plain === "test") &&
        !hasShellFunction(rawState, w0Plain) &&
        !rawState.extensions?.builtins.has(w0Plain)
      ) {
        const cmd = this.commands.get(w0Plain);
        if (cmd && defaultPredicateExecutors.has(cmd.execute)) {
          if (command.words.length > this.budget.limits.maxExpansionFields) return undefined;
          if (rawState.extensions && !rawState.extensions.eventDepth) {
            publishCommandSpelling(rawState, commandSpelling(command));
          }
          predicateScratchWords.length = 0;
          try {
            for (let i = 0; i < command.words.length; i++) {
              const fast = this.fastValueWord(command.words[i]!, rawState, io, true, false, false, true, undefined, diagnosticLine);
              if (typeof fast !== "string") {
                predicateScratchWords.length = 0;
                return undefined;
              }
              predicateScratchWords.push(fast);
            }
          } catch {
            predicateScratchWords.length = 0;
            return undefined;
          }
          const lastPredArg = predicateScratchWords[predicateScratchWords.length - 1] ?? w0Plain;
          const fastPred = tryFastPredicate(w0Plain, predicateScratchWords, 1);
          predicateScratchWords.length = 0;
          if (fastPred === undefined) return undefined;
          const statusChar = fastPred === 0 ? "0" : "1";
          if (!canMutatePipeStatus && elem0!.text.shellValue !== statusChar) return undefined;
          if (fastPred !== 0 && !ignored && rawState.errexit) return undefined;
          const restEpoch = monitor.chargeInternal(syncRestorationCharge, syncRestorationTickets).epoch;
          this.budget.tick();
          rawState.substitutionStatus = 0;
          delete rawState.variables._;
          rawState.lastArgument = lastPredArg;
          if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = undefined;
          if (!existing) {
            monitor.lazyPipeStatus = fastPred === 0 ? singleStatusZero : fastPred === 1 ? singleStatusOne : [fastPred];
            monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets);
          } else {
            elem0!.text.shellValue = statusChar;
            store!.changed(monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets), "PIPESTATUS");
          }
          const finalStatus = pipeline.negate ? Number(fastPred === 0) : fastPred;
          rawState.status = finalStatus;
          monitor.epoch = restEpoch;
          if (store) store.epoch = restEpoch;
          return finalStatus;
        }
      }
      if (
        (w0Plain === "mkdir" || w0Plain === "rm") &&
        command.words.length >= 3 &&
        this.fileWrites.size === 0 &&
        this.outputFiles.size === 0 &&
        this.canFastMemoryRedirect &&
        // A later operand can retry the whole command; scoped admission owns finite budgets.
        this.budget.limits.maxFileSystemOperations === Infinity &&
        !hasShellFunction(rawState, w0Plain) &&
        !rawState.extensions?.builtins.has(w0Plain) &&
        (canMutatePipeStatus || elem0!.text.shellValue === "0") &&
        (!pipeline.negate || ignored || !rawState.errexit) &&
        command.words.length <= this.budget.limits.maxExpansionFields &&
        this.arePureArgWords(command.words, rawState)
      ) {
        const w1Plain = command.words[1]!.plain;
        const isMkdir = w0Plain === "mkdir" && w1Plain === "-p";
        const isRmRf = w0Plain === "rm" && (w1Plain === "-rf" || w1Plain === "-fr");
        const umask = rawState.umask ?? 0o022;
        const def = (isMkdir || isRmRf) ? this.commands.get(w0Plain) : undefined;
        if (
          def &&
          (isMkdir ? defaultMkdirExecutors.has(def.execute) && (umask & 0o300) === 0 : defaultRmExecutors.has(def.execute)) &&
          this.budget.fileSystemOperations + (command.words.length - 2) <= this.budget.limits.maxFileSystemOperations
        ) {
          fastSubScratchArgs.length = 0;
          let lastArg = w1Plain!;
          let valid = true;
          try {
            for (let i = 2; i < command.words.length; i++) {
              const v = this.fastValueWord(command.words[i]!, rawState, io, true, false, false, true, undefined, diagnosticLine);
              if (
                typeof v !== "string" ||
                v.length === 0 ||
                v.startsWith("-") ||
                v.includes("\0") ||
                (isRmRf && (v.endsWith(".") || v.endsWith("/")))
              ) {
                valid = false;
                break;
              }
              lastArg = v;
              const path = pathOf(rawState, v);
              if (
                path === "/" ||
                path === "/dev" ||
                path.startsWith("/dev/") ||
                !isCleanAbsolutePath(path) ||
                tryResolveMemoryDevicePath(this.backingFs, path) === undefined
              ) {
                valid = false;
                break;
              }
              fastSubScratchArgs.push(path);
            }
          } catch {
            valid = false;
          }
          if (valid && fastSubScratchArgs.length > 0) {
            const mode = 0o777 & ~umask;
            try {
              for (let i = 0; i < fastSubScratchArgs.length; i++) {
                const targetPath = fastSubScratchArgs[i]!;
                const ok = isMkdir
                  ? tryMkdirMemorySync(this.backingFs, targetPath, true, mode, this.commandSignal)
                  : tryRmRfMemorySync(this.backingFs, targetPath, this.commandSignal);
                if (!ok) {
                  valid = false;
                  break;
                }
                this.budget.fileSystemOperation();
              }
            } catch {
              fastSubScratchArgs.length = 0;
              this.signal.throwIfAborted();
              return undefined;
            }
          }
          fastSubScratchArgs.length = 0;
          if (valid) {
            if (rawState.extensions && !rawState.extensions.eventDepth) {
              publishCommandSpelling(rawState, commandSpelling(command));
            }
            const restEpoch = monitor.chargeInternal(syncRestorationCharge, syncRestorationTickets).epoch;
            this.budget.tick();
            rawState.substitutionStatus = 0;
            delete rawState.variables._;
            rawState.lastArgument = lastArg;
            if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = undefined;
            if (!existing) {
              monitor.lazyPipeStatus = singleStatusZero;
              monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets);
            } else {
              elem0!.text.shellValue = "0";
              store!.changed(monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets), "PIPESTATUS");
            }
            const finalStatus = pipeline.negate ? 1 : 0;
            rawState.status = finalStatus;
            monitor.epoch = restEpoch;
            if (store) store.epoch = restEpoch;
            return finalStatus;
          }
        }
      }
    }
    return undefined;
  }

  private trySyncScript(script: Script, state: State, io: IO, ignoreErrexit: boolean): number | { listIndex: number; pipelineIndex: number } {
    if (state.noexec) return { listIndex: 0, pipelineIndex: 0 };
    for (let listIndex = 0; listIndex < script.lists.length; listIndex++) {
      const list = script.lists[listIndex]!;
      if (list.terminator) return { listIndex, pipelineIndex: 0 };
      for (let index = 0; index < list.pipelines.length; index++) {
        const operator = list.operators[index - 1];
        if ((operator === "&&" && state.status !== 0) || (operator === "||" && state.status === 0)) continue;
        const pipeline = list.pipelines[index]!;
        const ignored = ignoreErrexit || index < list.pipelines.length - 1 || pipeline.negate;
        const syncStatus = this.trySyncPipeline(pipeline, state, io, ignored);
        if (syncStatus === undefined) return { listIndex, pipelineIndex: index };
      }
    }
    return script.lists.length ? state.status : 0;
  }

  private isPureSyncValueWord(word: Word, rawState: State): boolean {
    if (word.parts.length === 0) return false;
    for (let i = 0; i < word.parts.length; i++) {
      const part = word.parts[i]!;
      if (part.kind === "text") {
        if (part.byteValue || invokedValues.has(part)) return false;
        continue;
      }
      if (part.kind === "variable") {
        if (
          part.indirect ||
          part.prefixNames ||
          part.specialParameter ||
          part.length ||
          part.substring ||
          part.transform ||
          part.operator !== undefined ||
          part.name === "@" ||
          part.name === "*" ||
          part.name === "PIPESTATUS" ||
          part.name === "LINENO" ||
          part.name === "_" ||
          part.name === "FUNCNAME" ||
          getArraySelector(part) !== undefined ||
          !isShellIdentifier(part.name)
        ) {
          return false;
        }
        continue;
      }
      if (part.kind === "arithmetic") {
        if (part.expression.error || part.expression.hasSubscript || !isSafeSmiProgram(part.expression)) return false;
        continue;
      }
      if (part.kind === "substitution") {
        if (part.script.lists.length !== 1) return false;
        const list = part.script.lists[0]!;
        if (list.terminator || list.pipelines.length !== 1) return false;
        const p = list.pipelines[0]!;
        if (p.negate || p.commands.length !== 1) return false;
        const cmd = p.commands[0]!;
        if (cmd.kind !== "simple" || cmd.redirects.length > 0 || cmd.words.length === 0) return false;
        const w0Plain = cmd.words[0]!.plain;
        if (!w0Plain || (w0Plain !== "printf" && w0Plain !== "echo") || rawState.functions.has(w0Plain) || rawState.extensions?.builtins.has(w0Plain)) return false;
        const def = this.commands.get(w0Plain);
        if (!def || (w0Plain === "printf" ? def.execute !== printfCommand.execute : !defaultEchoExecutors.has(def.execute))) return false;
        if (!cmd.words.every(w => this.isPureSyncValueWord(w, rawState))) return false;
        continue;
      }
      return false;
    }
    return true;
  }

  private canSyncLoopBody(script: Script, rawState: State): boolean {
    if (script.lists.length === 0) return false;
    const store = stateMonitor(rawState)?.store;
    for (let l = 0; l < script.lists.length; l++) {
      const list = script.lists[l]!;
      if (list.terminator) return false;
      for (let p = 0; p < list.pipelines.length; p++) {
        const pipeline = list.pipelines[p]!;
        if (pipeline.negate || pipeline.commands.length !== 1) return false;
        const cmd = pipeline.commands[0]!;
        if (cmd.kind !== "simple") return false;
        if (cmd.redirects.length === 1) {
          if (
            cmd.words.length !== 2 ||
            this.budget.limits.maxRedirects < 1 ||
            this.fileWrites.size !== 0 ||
            this.outputFiles.size !== 0 ||
            !this.canFastMemoryRedirect
          ) {
            return false;
          }
          const r0 = cmd.redirects[0]!;
          const w0Plain = cmd.words[0]!.plain;
          const argPart0 = cmd.words[1]!.parts[0];
          const targetPart0 = r0.target.parts[0];
          const def = w0Plain === "echo" ? this.commands.get("echo") : undefined;
          if (
            r0.descriptor !== 1 ||
            r0.move ||
            r0.document ||
            (r0.operator !== ">" && r0.operator !== ">>") ||
            rawState.noclobber ||
            w0Plain !== "echo" ||
            hasShellFunction(rawState, "echo") ||
            rawState.extensions?.builtins.has("echo") ||
            !def ||
            !defaultEchoExecutors.has(def.execute) ||
            !argPart0 ||
            argPart0.kind !== "text" ||
            argPart0.value.length === 0 ||
            argPart0.value.startsWith("-") ||
            !targetPart0 ||
            targetPart0.kind !== "text" ||
            !targetPart0.value.startsWith("/") ||
            targetPart0.value === "/dev" ||
            targetPart0.value.startsWith("/dev/") ||
            !this.isPureSyncValueWord(cmd.words[1]!, rawState) ||
            !this.isPureSyncValueWord(r0.target, rawState)
          ) {
            return false;
          }
          for (const word of [cmd.words[1]!, r0.target]) {
            for (let i = 0; i < word.parts.length; i++) {
              const part = word.parts[i]!;
              if (part.kind !== "text" && (part.kind !== "variable" || !part.quoted)) return false;
              if (part.kind === "text" && !part.quoted && (
                rawState.braceexpand !== false && part.value.includes("{") ||
                i === 0 && part.value.startsWith("~") ||
                !rawState.noglob && hasGlobOrEscape(part.value, !!rawState.extglob)
              )) return false;
            }
          }
          const lastSlash = targetPart0.value.lastIndexOf("/");
          const parentDir = lastSlash <= 0 ? "/" : targetPart0.value.slice(0, lastSlash);
          if (!tryGetMemoryDirectoryEntryNamesSync(this.backingFs, parentDir)) {
            return false;
          }
          continue;
        }
        if (cmd.redirects.length !== 0 || cmd.words.length !== 1) return false;
        const w0 = cmd.words[0]!;
        const w0Plain = w0.plain;
        if ((w0Plain === ":" || w0Plain === "true") && !rawState.functions.has(w0Plain) && !rawState.extensions?.builtins.has(w0Plain)) {
          continue;
        }
        const assignment = !getArrayAssignment(w0) ? this.assignment(w0) : undefined;
        if (
          !assignment ||
          assignment.append ||
          assignment.name === "OPTIND" ||
          assignment.name === "PIPESTATUS" ||
          assignment.name.includes("[") ||
          rawState.readonlyVariables?.has(assignment.name) ||
          store?.get(assignment.name) ||
          !this.isPureSyncValueWord(assignment.value, rawState)
        ) {
          return false;
        }
      }
    }
    return true;
  }

  private extractIntLoopStep(
    step: {
      readonly cmd: Extract<Command, { kind: "simple" }>;
      readonly name: string | undefined;
      readonly value: Word | undefined;
      readonly targetWord: Word | undefined;
    },
    rawState: State,
  ): IntLoopStep | undefined {
    if (step.targetWord !== undefined || step.name === undefined || step.value === undefined) {
      return undefined;
    }
    const cached = intLoopStepCache.get(step.cmd);
    if (cached !== undefined) {
      if (cached === null) return undefined;
      if (cached.isSub && (this.middleware.length > 0 || rawState.depth >= this.budget.maxSubstitutionDepthSmi)) return undefined;
      return cached;
    }
    const parts = step.value.parts;
    const p0 =
      parts.length === 1
        ? parts[0]!
        : parts.length === 2 && parts[0]!.kind === "text" && parts[0]!.value === ""
          ? parts[1]!
          : undefined;
    if (!p0) {
      intLoopStepCache.set(step.cmd, null);
      return undefined;
    }
    if (p0.kind === "arithmetic") {
      const compiled = compilePureSmiProgram(p0.expression, sharedSyncLoopArithNames);
      if (!compiled) {
        intLoopStepCache.set(step.cmd, null);
        return undefined;
      }
      const res: IntLoopStep = { name: step.name, program: p0.expression, compiled, varRegMap: new Array(compiled.varNames.length).fill(0), targetReg: 0, isSub: false, extraNewlineByte: 0 };
      intLoopStepCache.set(step.cmd, res);
      return res;
    }
    if (p0.kind === "substitution") {
      const cmd = p0.script.lists[0]?.pipelines[0]?.commands[0];
      if (!cmd || cmd.kind !== "simple" || cmd.redirects.length > 0) {
        intLoopStepCache.set(step.cmd, null);
        return undefined;
      }
      const w0Plain = cmd.words[0]?.plain;
      if (w0Plain === "echo" && cmd.words.length === 2 && cmd.words[1]!.parts.length === 1 && cmd.words[1]!.parts[0]!.kind === "arithmetic") {
        const expr = cmd.words[1]!.parts[0]!.expression;
        const compiled = compilePureSmiProgram(expr, sharedSyncLoopArithNames);
        if (!compiled) {
          intLoopStepCache.set(step.cmd, null);
          return undefined;
        }
        const res: IntLoopStep = { name: step.name, program: expr, compiled, varRegMap: new Array(compiled.varNames.length).fill(0), targetReg: 0, isSub: true, extraNewlineByte: 1 };
        intLoopStepCache.set(step.cmd, res);
        if (this.middleware.length > 0 || rawState.depth >= this.budget.maxSubstitutionDepthSmi) return undefined;
        return res;
      }
      if (
        w0Plain === "printf" &&
        cmd.words.length === 3 &&
        cmd.words[1]!.parts.length === 1 &&
        cmd.words[1]!.parts[0]!.kind === "text" &&
        cmd.words[1]!.parts[0]!.value === "%d" &&
        cmd.words[2]!.parts.length === 1 &&
        cmd.words[2]!.parts[0]!.kind === "arithmetic"
      ) {
        const expr = cmd.words[2]!.parts[0]!.expression;
        const compiled = compilePureSmiProgram(expr, sharedSyncLoopArithNames);
        if (!compiled) {
          intLoopStepCache.set(step.cmd, null);
          return undefined;
        }
        const res: IntLoopStep = { name: step.name, program: expr, compiled, varRegMap: new Array(compiled.varNames.length).fill(0), targetReg: 0, isSub: true, extraNewlineByte: 0 };
        intLoopStepCache.set(step.cmd, res);
        if (this.middleware.length > 0 || rawState.depth >= this.budget.maxSubstitutionDepthSmi) return undefined;
        return res;
      }
    }
    intLoopStepCache.set(step.cmd, null);
    return undefined;
  }

  private buildSyncLoopBody(
    command: Extract<Command, { kind: "arithmetic-for" | "for" }>,
    io: IO,
  ): { steps: SyncLoopStep[]; redirectCount: number } {
    const canCache = !io.diagnosticCommandLines && !io.diagnosticOffset;
    if (canCache) {
      const cached = (command as { _cachedSyncLoopBody?: { steps: SyncLoopStep[]; redirectCount: number } })._cachedSyncLoopBody;
      if (cached) return cached;
    }
    const bodyAssignments: SyncLoopStep[] = [];
    let redirectCount = 0;
    for (let l = 0; l < command.body.lists.length; l++) {
      const list = command.body.lists[l]!;
      for (let p = 0; p < list.pipelines.length; p++) {
        const cmd = list.pipelines[p]!.commands[0] as Extract<Command, { kind: "simple" }>;
        const w0 = cmd.words[0]!;
        const line = io.diagnosticCommandLines?.get(cmd) ?? (cmd.line ?? 1) + (io.diagnosticOffset ?? 0);
        if (cmd.redirects.length === 1) {
          redirectCount++;
          const r0 = cmd.redirects[0]!;
          let targetDirPrefix: string | undefined;
          let targetNamePrefix: string | undefined;
          const firstTargetPart = r0.target.parts[0];
          if (firstTargetPart?.kind === "text" && firstTargetPart.value.charCodeAt(0) === 47) {
            const lastSlash = firstTargetPart.value.lastIndexOf("/");
            if (lastSlash >= 1) {
              const dirNoSlash = firstTargetPart.value.slice(0, lastSlash);
              if (isCleanAbsolutePath(dirNoSlash) && dirNoSlash !== "/dev" && !dirNoSlash.startsWith("/dev/")) {
                targetDirPrefix = firstTargetPart.value.slice(0, lastSlash + 1);
                targetNamePrefix = firstTargetPart.value.slice(lastSlash + 1);
              }
            }
          }
          bodyAssignments.push({
            cmd,
            name: undefined,
            value: cmd.words[1]!,
            targetWord: r0.target,
            targetDirPrefix,
            targetNamePrefix,
            append: r0.operator === ">>",
            line,
          });
        } else {
          const assignment = !getArrayAssignment(w0) ? this.assignment(w0) : undefined;
          bodyAssignments.push({ cmd, name: assignment?.name, value: assignment?.value, targetWord: undefined, append: false, line });
        }
      }
    }
    for (let b = 0; b + 1 < bodyAssignments.length; b++) {
      const curr = bodyAssignments[b]!;
      const next = bodyAssignments[b + 1]!;
      if (
        curr.targetWord !== undefined &&
        curr.value !== undefined &&
        !curr.append &&
        next.targetWord !== undefined &&
        next.value !== undefined &&
        next.append &&
        sameRedirectTargetWord(curr.targetWord, next.targetWord)
      ) {
        curr.coalesceNext = true;
        b++;
      }
    }
    const res = { steps: bodyAssignments, redirectCount };
    if (canCache) {
      (command as { _cachedSyncLoopBody?: { steps: SyncLoopStep[]; redirectCount: number } })._cachedSyncLoopBody = res;
    }
    return res;
  }

  private trySyncLoop(
    command: Extract<Command, { kind: "arithmetic-for" | "for" }>,
    pipeline: Pipeline,
    rawState: State,
    monitor: NonNullable<ReturnType<typeof stateMonitor>>,
    store: ReturnType<typeof arrayStore>,
    existing: ReturnType<NonNullable<ReturnType<typeof arrayStore>>["get"]>,
    elem0: { text: { shellValue: ShellValue } } | undefined,
    canMutatePipeStatus: boolean,
    io: IO,
    diagnosticLine: number,
  ): number | undefined {
    if (
      command.redirects.length !== 0 ||
      pipeline.negate ||
      !canMutatePipeStatus ||
      rawState.errexit ||
      rawState.nounset ||
      rawState.readonlyVariables?.size ||
      rawState.extensions?.checkpoints.length ||
      hasYieldCheckpoint(this.signal) ||
      !this.canSyncLoopBody(command.body, rawState)
    ) {
      return undefined;
    }
    const { steps: bodyAssignments, redirectCount } = this.buildSyncLoopBody(command, io);
    if (bodyAssignments.length > 30) return undefined;
    const touched = sharedSyncLoopTouched;
    touched.clear();
    let lastCmd: Extract<Command, { kind: "simple" }> | undefined;
    let lastArg = "";
    const mode = 0o666 & ~(rawState.umask ?? 0o022);
    if (command.kind === "arithmetic-for") {
      type CachedArithPlan = {
        e0: ArithmeticProgram;
        e1: ArithmeticProgram;
        e2: ArithmeticProgram;
        iterations: number;
        inductionName: string;
        startVal: number;
        limitVal: number;
        isLe: boolean;
        arithNamesList: string[];
        intSteps: (IntLoopStep | undefined)[];
        allIntStepsReady: boolean;
        hasSubIntStep: boolean;
        hasDeferredSteps: boolean;
        deferredMask: number;
        touchedIntNamesList: string[];
      };
      let plan = (command as { _cachedArithPlan?: CachedArithPlan | null })._cachedArithPlan;
      if (plan === null) return undefined;
      if (plan === undefined) {
      const e0 = command.expressions[0];
      const e1 = command.expressions[1];
      const e2 = command.expressions[2];
      if (
        !e0 || !e1 || !e2 ||
        e0.error || e0.hasSubscript || !isSafeSmiProgram(e0) ||
        e1.error || e1.hasSubscript || !isSafeSmiProgram(e1) ||
        e2.error || e2.hasSubscript || !isSafeSmiProgram(e2) ||
        e0.tree?.kind !== "binary" || e0.tree.operator !== "=" ||
        e0.tree.left.kind !== "name" ||
        e0.tree.right.kind !== "literal" ||
        e0.tree.right.value < 0n || e0.tree.right.value > 1500n ||
        e1.tree?.kind !== "binary" ||
        (e1.tree.operator !== "<" && e1.tree.operator !== "<=") ||
        e1.tree.left.kind !== "name" || e1.tree.left.name !== e0.tree.left.name ||
        e1.tree.right.kind !== "literal" ||
        e1.tree.right.value < 0n ||
        e1.tree.right.value > 1500n ||
        e2.tree?.kind !== "unary" || e2.tree.operator !== "++" ||
        e2.tree.operand.kind !== "name" || e2.tree.operand.name !== e0.tree.left.name
      ) {
        (command as { _cachedArithPlan?: CachedArithPlan | null })._cachedArithPlan = null;
        return undefined;
      }
      const iterations = Math.max(0, Number(e1.tree.right.value - e0.tree.right.value) + (e1.tree.operator === "<=" ? 1 : 0));
      if (iterations * bodyAssignments.length > 1600) {
        (command as { _cachedArithPlan?: CachedArithPlan | null })._cachedArithPlan = null;
        return undefined;
      }
      const inductionName = e0.tree.left.name;
      const arithNames = sharedSyncLoopArithNames;
      arithNames.clear();
      const intSteps = new Array<IntLoopStep | undefined>(bodyAssignments.length);
      let hasSubIntStep = false;
      for (let b = 0; b < bodyAssignments.length; b++) {
        intSteps[b] = undefined;
        const step = bodyAssignments[b]!;
        if (step.name === inductionName) {
          (command as { _cachedArithPlan?: CachedArithPlan | null })._cachedArithPlan = null;
          return undefined;
        }
        if (step.targetWord?.parts.some(part => part.kind !== "text" && part.kind !== "variable")) {
          (command as { _cachedArithPlan?: CachedArithPlan | null })._cachedArithPlan = null;
          return undefined;
        }
        const intStep = this.extractIntLoopStep(step, rawState);
        if (intStep) {
          if (intStep.isSub) hasSubIntStep = true;
          for (let v = 0; v < intStep.compiled.varNames.length; v++) arithNames.add(intStep.compiled.varNames[v]!);
          intSteps[b] = intStep;
          continue;
        }
        if (step.value) {
          for (let i = 0; i < step.value.parts.length; i++) {
            const part = step.value.parts[i]!;
            if (part.kind === "text" || part.kind === "variable") continue;
            if (part.kind === "arithmetic") {
              if (!collectPureReadOnlySmiNames(part.expression, arithNames)) {
                (command as { _cachedArithPlan?: CachedArithPlan | null })._cachedArithPlan = null;
                return undefined;
              }
              continue;
            }
            (command as { _cachedArithPlan?: CachedArithPlan | null })._cachedArithPlan = null;
            return undefined;
          }
        }
      }
      const arithNamesList = [...arithNames];
      let hasDeferredSteps = false;
      let deferredMask = 0;
      for (let b = 0; b < bodyAssignments.length; b++) {
        const step = bodyAssignments[b]!;
        if (
          step.targetWord === undefined &&
          step.name !== undefined &&
          step.value !== undefined &&
          step.name !== inductionName &&
          !arithNames.has(step.name) &&
          step.value.parts.every(p => p.kind === "text" || p.kind === "variable")
        ) {
          let readAnywhere = false;
          for (let b2 = 0; b2 < bodyAssignments.length; b2++) {
            const other = bodyAssignments[b2]!;
            if (other.value?.parts.some(p => p.kind === "variable" && p.name === step.name) ||
                other.targetWord?.parts.some(p => p.kind === "variable" && p.name === step.name)) {
              readAnywhere = true;
              break;
            }
          }
          if (readAnywhere) continue;
          let overwrittenLater = false;
          for (let b2 = b + 1; b2 < bodyAssignments.length; b2++) {
            const nextName = bodyAssignments[b2]!.name;
            if (nextName === step.name || (nextName !== undefined && step.value.parts.some(p => p.kind === "variable" && p.name === nextName))) {
              overwrittenLater = true;
              break;
            }
          }
          if (!overwrittenLater) {
            deferredMask |= (1 << b);
            hasDeferredSteps = true;
          }
        }
      }
      let allIntStepsReady = true;
      const touchedSet = new Set<string>([inductionName]);
      for (let b = 0; b < bodyAssignments.length; b++) {
        if (deferredMask & (1 << b)) continue;
        if (!intSteps[b]) {
          allIntStepsReady = false;
        } else {
          touchedSet.add(intSteps[b]!.name);
        }
      }
      plan = {
        e0,
        e1,
        e2,
        iterations,
        inductionName,
        startVal: Number(e0.tree.right.value) | 0,
        limitVal: Number(e1.tree.right.value) | 0,
        isLe: e1.tree.operator === "<=",
        arithNamesList,
        intSteps,
        allIntStepsReady,
        hasSubIntStep,
        hasDeferredSteps,
        deferredMask,
        touchedIntNamesList: [...touchedSet],
      };
      (command as { _cachedArithPlan?: CachedArithPlan | null })._cachedArithPlan = plan;
      }
      if (
        (this.budget.commands + 1600) >= this.budget.limits.maxCommands ||
        (this.budget.iterations + 1600) >= this.budget.limits.maxLoopIterations ||
        (redirectCount > 0 && (this.budget.fileSystemOperations + 1600 * redirectCount) >= this.budget.limits.maxFileSystemOperations)
      ) {
        return undefined;
      }
      const {
        e0, e1, e2, iterations, inductionName, startVal, limitVal, isLe,
        arithNamesList, intSteps, allIntStepsReady, hasSubIntStep, hasDeferredSteps, deferredMask, touchedIntNamesList,
      } = plan;
      if (arithNamesList.length > 0) {
        for (let a = 0; a < arithNamesList.length; a++) {
          const refName = arithNamesList[a]!;
          if (refName === inductionName) continue;
          const initial = rawState.variables[refName];
          if (initial !== undefined && initial !== "" && !/^-?[0-9]+$/.test(initial)) return undefined;
          for (let b = 0; b < bodyAssignments.length; b++) {
            const step = bodyAssignments[b]!;
            if (
              step.name === refName &&
              !intSteps[b] &&
              (!step.value || !step.value.parts.some(p => p.kind === "arithmetic") || step.value.parts.some(p => p.kind !== "arithmetic" && (p.kind !== "text" || p.value !== "")))
            ) {
              return undefined;
            }
          }
        }
      }
      monitor.chargeInternal(syncRestorationCharge, syncRestorationTickets);
      this.budget.tick();
      rawState.loopDepth++;
      const prevRawWrite = this._syncArithRawWriteOnly;
      const prevTouched = this._syncArithTouched;
      this._syncArithRawWriteOnly = true;
      this._syncArithTouched = touched;
      let usedFastIntPath = false;
      try {
        let lastInductionVal: string | undefined;
        const intBudgetSnapshot = this.budget.parsing.snapshot();
        let canUseIntRegisters =
          allIntStepsReady &&
          (!hasSubIntStep || (this.middleware.length === 0 && rawState.depth < this.budget.maxSubstitutionDepthSmi)) &&
          !this.budget.hasCpuLimit &&
          this.budget.maxExpansionFieldsSmi >= 1 &&
          this.budget.maxExpansionBytesSmi >= 32 &&
          !store?.get(inductionName) &&
          inductionName !== "LINENO" &&
          inductionName !== "_" &&
          inductionName !== "FUNCNAME";
        if (canUseIntRegisters && arithNamesList.length > 0) {
          for (let a = 0; a < arithNamesList.length; a++) {
            const refName = arithNamesList[a]!;
            if (
              store?.get(refName) ||
              refName === "LINENO" ||
              refName === "_" ||
              refName === "FUNCNAME" ||
              (rawState.nounset && refName !== inductionName && rawState.variables[refName] === undefined)
            ) {
              canUseIntRegisters = false;
              break;
            }
          }
        }
        const regNames = sharedSyncLoopRegNames;
        regNames.length = 0;
        if (canUseIntRegisters) {
          regNames.push(inductionName);
          for (let a = 0; a < arithNamesList.length; a++) {
            const refName = arithNamesList[a]!;
            if (refName === inductionName) continue;
            const parsed = fastSafeInt(rawState.variables[refName], this.budget.parsing);
            if (parsed === undefined) {
              canUseIntRegisters = false;
              break;
            }
            if (regNames.length >= 32) {
              canUseIntRegisters = false;
              break;
            }
            sharedLoopIntRegs[regNames.length] = parsed | 0;
            regNames.push(refName);
          }
          if (canUseIntRegisters) {
            for (let b = 0; b < bodyAssignments.length; b++) {
              if (deferredMask & (1 << b)) continue;
              const st = intSteps[b]!;
              let tIdx = regNames.indexOf(st.name);
              if (tIdx === -1) {
                if (regNames.length >= 32) { canUseIntRegisters = false; break; }
                tIdx = regNames.length;
                sharedLoopIntRegs[tIdx] = 0;
                regNames.push(st.name);
              }
              st.targetReg = tIdx;
              const vNames = st.compiled.varNames;
              for (let v = 0; v < vNames.length; v++) {
                st.varRegMap[v] = regNames.indexOf(vNames[v]!);
              }
            }
          }
        }
        if (canUseIntRegisters) {
          lastCmd = bodyAssignments[bodyAssignments.length - 1]?.cmd;
          const { ok, lastInductionInt, subBytes, subCount } = runIntArithForLoop(
            startVal,
            limitVal,
            isLe,
            bodyAssignments.length,
            deferredMask,
            intSteps,
            this.budget.parsing,
          );
          if (!ok) {
            canUseIntRegisters = false;
          } else {
            usedFastIntPath = true;
            this.budget.parsing.admit(limitVal < 0 ? 4 : 2);
            this.budget.iterations += iterations + 1;
            this.budget.commands += iterations * bodyAssignments.length + subCount;
            if (subCount > 0) {
              const nextBytes = this.budget.bytes + subBytes;
              if (nextBytes > this.budget.maxOutputBytesSmi && subBytes > this.budget.limits.maxOutputBytes - this.budget.bytes) {
                this.budget.fail("maxOutputBytes");
              }
              this.budget.bytes = nextBytes;
              rawState.substitutionStatus = 0;
              rawState.status = 0;
            }
            runYieldCheckpoint(this.signal);
            for (let r = 0; r < regNames.length; r++) {
              rawState.variables[regNames[r]!] = intToStr(sharedLoopIntRegs[r]!);
            }
            regNames.length = 0;
            if (hasDeferredSteps && lastInductionInt !== undefined) {
              lastInductionVal = intToStr(lastInductionInt);
            }
          }
        }
        if (!canUseIntRegisters) {
          this.budget.parsing.restore(intBudgetSnapshot);
          regNames.length = 0;
          const fb = this.runSyncArithForFallback(
            e0, e1, e2, inductionName, hasDeferredSteps, deferredMask,
            bodyAssignments, rawState, io, monitor, touched, mode, diagnosticLine,
          );
          lastCmd = fb.lastCmd;
          lastArg = fb.lastArg;
          lastInductionVal = fb.lastInductionVal;
        }
        if (hasDeferredSteps && lastInductionVal !== undefined) {
          const finalInductionVal = rawState.variables[inductionName];
          rawState.variables[inductionName] = lastInductionVal;
          try {
            for (let b = 0; b < bodyAssignments.length; b++) {
              if (!(deferredMask & (1 << b))) continue;
              const step = bodyAssignments[b]!;
              const val = this.fastValueWord(step.value!, rawState, io, false, false, false, false, 0, step.line) as string;
              rawState.variables[step.name!] = val;
              touched.add(step.name!);
            }
          } finally {
            if (finalInductionVal !== undefined) rawState.variables[inductionName] = finalInductionVal;
            else delete rawState.variables[inductionName];
          }
        }
      } finally {
        this._syncArithRawWriteOnly = prevRawWrite;
        this._syncArithTouched = prevTouched;
        rawState.loopDepth--;
        if (usedFastIntPath) {
          for (let t = 0; t < touchedIntNamesList.length; t++) {
            const varName = touchedIntNamesList[t]!;
            const finalVal = rawState.variables[varName];
            if (finalVal !== undefined) {
              monitor.publishStringVariable(varName, finalVal);
              if (rawState.allexport) monitor.proxy.exported.add(varName);
            }
          }
          if (touched.size > 0) {
            for (const varName of touched) {
              const finalVal = rawState.variables[varName];
              if (finalVal !== undefined) {
                monitor.publishStringVariable(varName, finalVal);
                if (rawState.allexport) monitor.proxy.exported.add(varName);
              }
            }
          }
        } else {
          for (const varName of touched) {
            const finalVal = rawState.variables[varName];
            if (finalVal !== undefined) {
              monitor.publishStringVariable(varName, finalVal);
              if (rawState.allexport) monitor.proxy.exported.add(varName);
            }
          }
        }
        if (lastCmd) {
          if (rawState.extensions && !rawState.extensions.eventDepth) {
            publishCommandSpelling(rawState, commandSpelling(lastCmd));
          }
          rawState.substitutionStatus = 0;
          if (rawState.variables._ !== undefined && !touched.has("_") && !(usedFastIntPath && touchedIntNamesList.includes("_"))) delete rawState.variables._;
          rawState.lastArgument = lastArg;
          if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = undefined;
          if (!existing) {
            monitor.lazyPipeStatus = singleStatusZero;
            monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets);
          } else {
            elem0!.text.shellValue = "0";
            store!.changed(monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets), "PIPESTATUS");
          }
        }
      }
      rawState.status = 0;
      const restEpoch = monitor.chargeInternal(syncRestorationCharge, syncRestorationTickets).epoch;
      monitor.epoch = restEpoch;
      if (store) store.epoch = restEpoch;
      return 0;
    }
    if (
      !isShellIdentifier(command.name) ||
      command.name === "OPTIND" ||
      command.name.includes("[") ||
      store?.get(command.name) ||
      command.words?.length !== 1 ||
      rawState.braceexpand === false
    ) {
      return undefined;
    }
    let braceReservation: ValueReservation | undefined;
    const fastLoopWords = tryFastExpandBraceRange(
      command.words[0]!,
      this.budget,
      io[valueScope] ? (b, o) => { braceReservation = io[valueScope]!.reserve(b, o); } : undefined,
    );
    if (
      !fastLoopWords ||
      fastLoopWords.length > 1500 ||
      fastLoopWords.length * bodyAssignments.length > 1600 ||
      (this.budget.commands + fastLoopWords.length * 4) >= this.budget.limits.maxCommands ||
      (this.budget.iterations + fastLoopWords.length) >= this.budget.limits.maxLoopIterations ||
      (redirectCount > 0 && (this.budget.fileSystemOperations + fastLoopWords.length * redirectCount) >= this.budget.limits.maxFileSystemOperations)
    ) {
      braceReservation?.release();
      return undefined;
    }
    monitor.chargeInternal(syncRestorationCharge, syncRestorationTickets);
    this.budget.tick();
    rawState.loopDepth++;
    const prevRawWrite = this._syncArithRawWriteOnly;
    const prevTouched = this._syncArithTouched;
    this._syncArithRawWriteOnly = true;
    this._syncArithTouched = touched;
    type CachedForPlan = {
      intSteps: (IntLoopStep | undefined)[];
      allIntStepsReady: boolean;
      hasSubIntStep: boolean;
      arithNamesList: string[];
      touchedIntNamesList: string[];
    };
    let forPlan = (command as { _cachedForPlan?: CachedForPlan })._cachedForPlan;
    if (!forPlan) {
      const arithNames = sharedSyncLoopArithNames;
      arithNames.clear();
      const intSteps = new Array<IntLoopStep | undefined>(bodyAssignments.length);
      let allIntStepsReady = true;
      let hasSubIntStep = false;
      const touchedSet = new Set<string>([command.name]);
      for (let b = 0; b < bodyAssignments.length; b++) {
        const intStep = this.extractIntLoopStep(bodyAssignments[b]!, rawState);
        if (!intStep) {
          allIntStepsReady = false;
          break;
        }
        if (intStep.isSub) hasSubIntStep = true;
        for (let v = 0; v < intStep.compiled.varNames.length; v++) arithNames.add(intStep.compiled.varNames[v]!);
        intSteps[b] = intStep;
        touchedSet.add(intStep.name);
      }
      forPlan = {
        intSteps,
        allIntStepsReady,
        hasSubIntStep,
        arithNamesList: [...arithNames],
        touchedIntNamesList: [...touchedSet],
      };
      (command as { _cachedForPlan?: CachedForPlan })._cachedForPlan = forPlan;
    }
    let usedFastIntFor = false;
    try {
      const intBudgetSnapshot = this.budget.parsing.snapshot();
      let canUseIntRegisters =
        forPlan.allIntStepsReady &&
        (!forPlan.hasSubIntStep || (this.middleware.length === 0 && rawState.depth < this.budget.maxSubstitutionDepthSmi)) &&
        !this.budget.hasCpuLimit &&
        this.budget.maxExpansionFieldsSmi >= 1 &&
        this.budget.maxExpansionBytesSmi >= 32 &&
        command.name !== "LINENO" &&
        command.name !== "_" &&
        command.name !== "FUNCNAME";
      const intSteps = canUseIntRegisters ? forPlan.intSteps : undefined;
      const regNames = sharedSyncLoopRegNames;
      regNames.length = 0;
      if (canUseIntRegisters) {
        regNames.push(command.name);
        const arithNamesList = forPlan.arithNamesList;
        for (let a = 0; a < arithNamesList.length; a++) {
          const refName = arithNamesList[a]!;
          if (refName === command.name) continue;
          if (
            store?.get(refName) ||
            refName === "LINENO" ||
            refName === "_" ||
            refName === "FUNCNAME" ||
            (rawState.nounset && rawState.variables[refName] === undefined)
          ) {
            canUseIntRegisters = false;
            break;
          }
          const parsed = fastSafeInt(rawState.variables[refName], this.budget.parsing);
          if (parsed === undefined) {
            canUseIntRegisters = false;
            break;
          }
          if (regNames.length >= 32) { canUseIntRegisters = false; break; }
          sharedLoopIntRegs[regNames.length] = parsed | 0;
          regNames.push(refName);
        }
        if (canUseIntRegisters && intSteps) {
          for (let b = 0; b < bodyAssignments.length; b++) {
            const st = intSteps[b]!;
            let tIdx = regNames.indexOf(st.name);
            if (tIdx === -1) {
              if (regNames.length >= 32) { canUseIntRegisters = false; break; }
              tIdx = regNames.length;
              sharedLoopIntRegs[tIdx] = 0;
              regNames.push(st.name);
            }
            st.targetReg = tIdx;
            const vNames = st.compiled.varNames;
            for (let v = 0; v < vNames.length; v++) {
              st.varRegMap[v] = regNames.indexOf(vNames[v]!);
            }
          }
        }
      }
      if (canUseIntRegisters && intSteps) {
        const { ok, subBytes, subCount } = runIntForLoop(fastLoopWords, bodyAssignments.length, intSteps, this.budget.parsing);
        if (!ok) {
          canUseIntRegisters = false;
        } else {
          usedFastIntFor = true;
          lastCmd = bodyAssignments[bodyAssignments.length - 1]?.cmd;
          this.budget.iterations += fastLoopWords.length;
          this.budget.commands += fastLoopWords.length * bodyAssignments.length + subCount;
          if (subCount > 0) {
            const nextBytes = this.budget.bytes + subBytes;
            if (nextBytes > this.budget.maxOutputBytesSmi && subBytes > this.budget.limits.maxOutputBytes - this.budget.bytes) {
              this.budget.fail("maxOutputBytes");
            }
            this.budget.bytes = nextBytes;
            rawState.substitutionStatus = 0;
            rawState.status = 0;
          }
          runYieldCheckpoint(this.signal);
          for (let r = 0; r < regNames.length; r++) {
            rawState.variables[regNames[r]!] = intToStr(sharedLoopIntRegs[r]!);
          }
          regNames.length = 0;
        }
      }
      if (!canUseIntRegisters) {
        touched.add(command.name);
        this.budget.parsing.restore(intBudgetSnapshot);
        regNames.length = 0;
        const fb = this.runSyncForFallback(
          command.name, fastLoopWords, bodyAssignments, rawState, io, monitor, touched, mode,
        );
        lastCmd = fb.lastCmd;
        lastArg = fb.lastArg;
      }
    } finally {
      this._syncArithRawWriteOnly = prevRawWrite;
      this._syncArithTouched = prevTouched;
      rawState.loopDepth--;
      if (usedFastIntFor) {
        const touchedList = forPlan.touchedIntNamesList;
        for (let t = 0; t < touchedList.length; t++) {
          const varName = touchedList[t]!;
          const finalVal = rawState.variables[varName];
          if (finalVal !== undefined) {
            monitor.publishStringVariable(varName, finalVal);
            if (rawState.allexport) monitor.proxy.exported.add(varName);
          }
        }
      } else if (touched.size === 1) {
        const finalVal = rawState.variables[command.name];
        if (finalVal !== undefined) {
          monitor.publishStringVariable(command.name, finalVal);
          if (rawState.allexport) monitor.proxy.exported.add(command.name);
        }
      } else {
        for (const varName of touched) {
          const finalVal = rawState.variables[varName];
          if (finalVal !== undefined) {
            monitor.publishStringVariable(varName, finalVal);
            if (rawState.allexport) monitor.proxy.exported.add(varName);
          }
        }
      }
      if (lastCmd) {
        if (rawState.extensions && !rawState.extensions.eventDepth) {
          publishCommandSpelling(rawState, commandSpelling(lastCmd));
        }
        rawState.substitutionStatus = 0;
        if (rawState.variables._ !== undefined && !touched.has("_") && !(usedFastIntFor && forPlan.touchedIntNamesList.includes("_"))) delete rawState.variables._;
        rawState.lastArgument = lastArg;
        if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = undefined;
        if (!existing) {
          monitor.lazyPipeStatus = singleStatusZero;
          monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets);
        } else {
          elem0!.text.shellValue = "0";
          store!.changed(monitor.chargeInternal(syncPipeStatusCharge, syncPipeStatusTickets), "PIPESTATUS");
        }
      }
    }
    rawState.status = 0;
    const restEpoch = monitor.chargeInternal(syncRestorationCharge, syncRestorationTickets).epoch;
    monitor.epoch = restEpoch;
    if (store) store.epoch = restEpoch;
    return 0;
  }

  private evalSyncRedirectWord(
    word: Word,
    rawState: State,
    monitor: NonNullable<ReturnType<typeof stateMonitor>>,
    touched: Set<string>,
  ): string {
    this.signal.throwIfAborted();
    const rawVars = rawState.variables;
    const parts = word.parts;
    let out = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (part.kind === "text") {
        out += part.value;
      } else {
        const name = (part as Extract<WordPart, { kind: "variable" }>).name;
        const raw = rawVars[name];
        if (raw !== undefined) {
          out += touched.has(name) ? raw : ((monitor.values.get(name, raw) as string | undefined) ?? raw);
        }
      }
    }
    if (this.budget.maxExpansionFieldsSmi < 1 && 1 > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
    if (out.length * 3 > this.budget.maxExpansionBytesSmi && shellValueByteLength(out) > this.budget.limits.maxExpansionBytes) {
      this.budget.fail("maxExpansionBytes");
    }
    return out;
  }

  private evalSyncRedirectSuffix(
    word: Word,
    dirPrefix: string,
    namePrefix: string,
    rawState: State,
    monitor: NonNullable<ReturnType<typeof stateMonitor>>,
    touched: Set<string>,
  ): string {
    this.signal.throwIfAborted();
    const rawVars = rawState.variables;
    const parts = word.parts;
    let out = namePrefix;
    if (parts.length === 3 && parts[1]!.kind === "variable" && parts[2]!.kind === "text") {
      const name = parts[1]!.name;
      const raw = rawVars[name];
      const val = raw !== undefined ? (touched.has(name) ? raw : ((monitor.values.get(name, raw) as string | undefined) ?? raw)) : "";
      const suffix = parts[2]!.value;
      let n = -1;
      if (val.length === 1) {
        const d0 = val.charCodeAt(0) - 48;
        if (d0 >= 0 && d0 <= 9) n = d0;
      } else if (val.length === 2) {
        const d0 = val.charCodeAt(0) - 48;
        const d1 = val.charCodeAt(1) - 48;
        if (d0 >= 1 && d0 <= 9 && d1 >= 0 && d1 <= 9) n = d0 * 10 + d1;
      } else if (val.length === 3) {
        const d0 = val.charCodeAt(0) - 48;
        const d1 = val.charCodeAt(1) - 48;
        const d2 = val.charCodeAt(2) - 48;
        if (d0 >= 1 && d0 <= 2 && d1 >= 0 && d1 <= 9 && d2 >= 0 && d2 <= 9) n = d0 * 100 + d1 * 10 + d2;
      }
      if (n >= 0 && n < 256 && namePrefix.length + suffix.length <= 64) {
        if (namePrefix !== cachedRedirectNamePrefix || suffix !== cachedRedirectNameSuffix) {
          cachedRedirectNamePrefix = namePrefix;
          cachedRedirectNameSuffix = suffix;
          cachedRedirectNameTable = new Array(256);
        }
        out = cachedRedirectNameTable[n] ??= namePrefix + val + suffix;
      } else {
        out = namePrefix + val + suffix;
      }
    } else {
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i]!;
        if (part.kind === "text") {
          out += part.value;
        } else {
          const name = (part as Extract<WordPart, { kind: "variable" }>).name;
          const raw = rawVars[name];
          if (raw !== undefined) {
            out += touched.has(name) ? raw : ((monitor.values.get(name, raw) as string | undefined) ?? raw);
          }
        }
      }
    }
    if (this.budget.maxExpansionFieldsSmi < 1 && 1 > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
    const totalChars = dirPrefix.length + out.length;
    if (totalChars * 3 > this.budget.maxExpansionBytesSmi && (shellValueByteLength(dirPrefix) + shellValueByteLength(out)) > this.budget.limits.maxExpansionBytes) {
      this.budget.fail("maxExpansionBytes");
    }
    return out;
  }

  private encodeSyncRedirectWordsToScratch(
    word0: Word,
    word1: Word | undefined,
    rawState: State,
    monitor: NonNullable<ReturnType<typeof stateMonitor>>,
    touched: Set<string>,
  ): Uint8Array {
    this.signal.throwIfAborted();
    const rawVars = rawState.variables;
    let pos = 0;
    const wordCount = word1 !== undefined ? 2 : 1;
    for (let w = 0; w < wordCount; w++) {
      if (w === 1) this.signal.throwIfAborted();
      const word = w === 0 ? word0 : word1!;
      const parts = word.parts;
      const wordStart = pos;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        let str: string | undefined;
        if (part.kind === "text") {
          str = part.value;
        } else {
          const name = (part as Extract<WordPart, { kind: "variable" }>).name;
          const raw = rawVars[name];
          if (raw !== undefined) {
            str = touched.has(name) ? raw : ((monitor.values.get(name, raw) as string | undefined) ?? raw);
          }
        }
        if (str !== undefined && str.length > 0) {
          const sLen = str.length;
          if (pos + sLen + 2 > fastRedirectScratchBytes.byteLength) {
            const s0 = this.evalSyncRedirectWord(word0, rawState, monitor, touched);
            if (word1 !== undefined) {
              const s1 = this.evalSyncRedirectWord(word1, rawState, monitor, touched);
              return encodeRedirectTextToScratch(`${s0}\n${s1}\n`);
            }
            return encodeRedirectTextToScratch(`${s0}\n`);
          }
          for (let j = 0; j < sLen; j++) {
            const code = str.charCodeAt(j);
            if (code >= 0x80) {
              const s0 = this.evalSyncRedirectWord(word0, rawState, monitor, touched);
              if (word1 !== undefined) {
                const s1 = this.evalSyncRedirectWord(word1, rawState, monitor, touched);
                return encodeRedirectTextToScratch(`${s0}\n${s1}\n`);
              }
              return encodeRedirectTextToScratch(`${s0}\n`);
            }
            fastRedirectScratchBytes[pos++] = code;
          }
        }
      }
      const wordBytes = pos - wordStart;
      if (this.budget.maxExpansionFieldsSmi < 1 && 1 > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
      if (wordBytes > this.budget.maxExpansionBytesSmi && wordBytes > this.budget.limits.maxExpansionBytes) {
        this.budget.fail("maxExpansionBytes");
      }
      fastRedirectScratchBytes[pos++] = 10;
    }
    return pos <= 128 ? fastRedirectScratchViews[pos]! : fastRedirectScratchBytes.subarray(0, pos);
  }

  private writeSyncRedirectStep(
    step: SyncLoopStep,
    encoded: Uint8Array,
    append: boolean,
    mode: number,
    rawState: State,
    monitor: NonNullable<ReturnType<typeof stateMonitor>>,
    touched: Set<string>,
  ): void {
    if (step.targetDirPrefix !== undefined && step.targetNamePrefix !== undefined) {
      const fileName = this.evalSyncRedirectSuffix(step.targetWord!, step.targetDirPrefix, step.targetNamePrefix, rawState, monitor, touched);
      if (tryWriteMemoryFileInDirSync(this.backingFs, step.targetDirPrefix, fileName, encoded, append, mode, this.commandSignal)) {
        return;
      }
      tryWriteMemoryFileSync(this.backingFs, step.targetDirPrefix + fileName, encoded, append, mode, this.commandSignal);
      return;
    }
    const targetVal = this.evalSyncRedirectWord(step.targetWord!, rawState, monitor, touched);
    tryWriteMemoryFileSync(this.backingFs, targetVal, encoded, append, mode, this.commandSignal);
  }

  private runSyncArithForFallback(
    e0: ArithmeticProgram,
    e1: ArithmeticProgram,
    e2: ArithmeticProgram,
    inductionName: string,
    hasDeferredSteps: boolean,
    deferredMask: number,
    bodyAssignments: readonly SyncLoopStep[],
    rawState: State,
    io: IO,
    monitor: NonNullable<ReturnType<typeof stateMonitor>>,
    touched: Set<string>,
    mode: number,
    diagnosticLine: number,
  ): { lastCmd: Extract<Command, { kind: "simple" }> | undefined; lastArg: string; lastInductionVal: string | undefined } {
    let lastCmd: Extract<Command, { kind: "simple" }> | undefined;
    let lastArg = "";
    let lastValueWord: Word | undefined;
    let lastInductionVal: string | undefined;
    let lastArgInductionVal: string | undefined;
    this.syncShellArithmeticNonZero(e0, rawState, diagnosticLine);
    let loopTurn = 0;
    while (true) {
      this.budget.loop();
      if ((++loopTurn & 127) === 0) runYieldCheckpoint(this.signal);
      if (!this.syncShellArithmeticNonZero(e1, rawState, diagnosticLine)) break;
      if (hasDeferredSteps) lastInductionVal = rawState.variables[inductionName];
      for (let b = 0; b < bodyAssignments.length; b++) {
        const step = bodyAssignments[b]!;
        lastCmd = step.cmd;
        this.budget.tick();
        if (deferredMask & (1 << b)) {
          lastArg = "";
          lastValueWord = undefined;
          continue;
        }
        if (step.coalesceNext) {
          const nextStep = bodyAssignments[++b]!;
          this.budget.tick();
          const encoded = this.encodeSyncRedirectWordsToScratch(step.value!, nextStep.value!, rawState, monitor, touched);
          this.writeSyncRedirectStep(step, encoded, false, mode, rawState, monitor, touched);
          this.budget.fileSystemOperation();
          this.budget.fileSystemOperation();
          this.budget.bytes += encoded.byteLength;
          lastCmd = nextStep.cmd;
          lastValueWord = nextStep.value;
        } else if (step.targetWord !== undefined && step.value !== undefined) {
          const encoded = this.encodeSyncRedirectWordsToScratch(step.value, undefined, rawState, monitor, touched);
          this.writeSyncRedirectStep(step, encoded, step.append, mode, rawState, monitor, touched);
          this.budget.fileSystemOperation();
          this.budget.bytes += encoded.byteLength;
          lastValueWord = step.value;
        } else if (step.name !== undefined && step.value !== undefined) {
          const val = this.fastValueWord(step.value, rawState, io, false, false, false, false, 0, step.line) as string;
          rawState.variables[step.name] = val;
          touched.add(step.name);
          lastArg = "";
          lastValueWord = undefined;
        } else {
          lastArg = step.cmd.words[0]!.plain!;
          lastValueWord = undefined;
        }
      }
      if (lastValueWord !== undefined) lastArgInductionVal = rawState.variables[inductionName];
      this.syncShellArithmeticNonZero(e2, rawState, diagnosticLine);
    }
    if (lastValueWord !== undefined) {
      const postInd = rawState.variables[inductionName];
      if (lastArgInductionVal === undefined) delete rawState.variables[inductionName];
      else rawState.variables[inductionName] = lastArgInductionVal;
      lastArg = this.evalSyncRedirectWord(lastValueWord, rawState, monitor, touched);
      if (postInd === undefined) delete rawState.variables[inductionName];
      else rawState.variables[inductionName] = postInd;
    }
    return { lastCmd, lastArg, lastInductionVal };
  }

  private runSyncForFallback(
    varName: string,
    fastLoopWords: readonly string[],
    bodyAssignments: readonly SyncLoopStep[],
    rawState: State,
    io: IO,
    monitor: NonNullable<ReturnType<typeof stateMonitor>>,
    touched: Set<string>,
    mode: number,
  ): { lastCmd: Extract<Command, { kind: "simple" }> | undefined; lastArg: string } {
    let lastCmd: Extract<Command, { kind: "simple" }> | undefined;
    let lastArg = "";
    let lastValueWord: Word | undefined;
    let loopTurn = 0;
    for (let idx = 0; idx < fastLoopWords.length; idx++) {
      this.budget.loop();
      if ((++loopTurn & 127) === 0) runYieldCheckpoint(this.signal);
      rawState.variables[varName] = fastLoopWords[idx]!;
      for (let b = 0; b < bodyAssignments.length; b++) {
        const step = bodyAssignments[b]!;
        lastCmd = step.cmd;
        this.budget.tick();
        if (step.coalesceNext) {
          const nextStep = bodyAssignments[++b]!;
          this.budget.tick();
          const encoded = this.encodeSyncRedirectWordsToScratch(step.value!, nextStep.value!, rawState, monitor, touched);
          this.writeSyncRedirectStep(step, encoded, false, mode, rawState, monitor, touched);
          this.budget.fileSystemOperation();
          this.budget.fileSystemOperation();
          this.budget.bytes += encoded.byteLength;
          lastCmd = nextStep.cmd;
          lastValueWord = nextStep.value;
        } else if (step.targetWord !== undefined && step.value !== undefined) {
          const encoded = this.encodeSyncRedirectWordsToScratch(step.value, undefined, rawState, monitor, touched);
          this.writeSyncRedirectStep(step, encoded, step.append, mode, rawState, monitor, touched);
          this.budget.fileSystemOperation();
          this.budget.bytes += encoded.byteLength;
          lastValueWord = step.value;
        } else if (step.name !== undefined && step.value !== undefined) {
          const val = this.fastValueWord(step.value, rawState, io, false, false, false, false, 0, step.line) as string;
          rawState.variables[step.name] = val;
          touched.add(step.name);
          lastArg = "";
          lastValueWord = undefined;
        } else {
          lastArg = step.cmd.words[0]!.plain!;
          lastValueWord = undefined;
        }
      }
    }
    if (lastValueWord !== undefined) {
      lastArg = this.evalSyncRedirectWord(lastValueWord, rawState, monitor, touched);
    }
    return { lastCmd, lastArg };
  }

  async script(script: Script, state: State, io: IO, startListIndex = 0, startPipelineIndex = 0, skipFirstSync = false): Promise<number> {
    if (state.extensions?.syntax.indexedDeclarations?.includes("readonly")) io.assignmentDiagnosticContext ??= { name: undefined };
    for (let listIndex = startListIndex; listIndex < script.lists.length; listIndex++) {
      const list = script.lists[listIndex]!;
      if (state.noexec) throw new Flow("discard", 0);
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
      const firstIndex = listIndex === startListIndex ? startPipelineIndex : 0;
      for (let index = firstIndex; index < list.pipelines.length; index++) {
        if (state.noexec) throw new Flow("discard", 0);
        const operator = list.operators[index - 1];
        if ((operator === "&&" && state.status !== 0) || (operator === "||" && state.status === 0)) continue;
        const pipeline = list.pipelines[index]!;
        const ignored = io.execution?.ignoreErrexit || index < list.pipelines.length - 1 || pipeline.negate;
        const syncStatus = (skipFirstSync && listIndex === startListIndex && index === startPipelineIndex)
          ? undefined
          : this.trySyncPipeline(pipeline, state, io, Boolean(ignored));
        if (syncStatus !== undefined) continue;
        const fastUnit = this.tryFastSinglePipelineUnit(pipeline, state, io, Boolean(ignored));
        if (fastUnit !== undefined) {
          const fastRes = fastUnit instanceof Promise ? await fastUnit : fastUnit;
          if (fastRes.terminated) return fastRes.exitCode;
          continue;
        }
        const completion = stateMonitor(state)?.restoration();
        try {
          const status = await this.pipeline(pipeline, state, ignored ? { ...io, execution: { ignoreErrexit: true } } : io);
          if (completion) completion.completeStatus(status);
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
      child = tryCloneStateSync(state) ?? await cloneState(state, signal);
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
        const input = new ShellInput((async function* () {})(), this.budget, signal);
        scope.register(async () => {
          try { await input.close(); }
          catch (reason) { if (!signal.aborted || !Object.is(reason, signal.reason)) throw reason; }
        });
        Object.assign(childIO, { asyncDefaultInput: input });
      }
      runtime = new Runtime(this.sourceFs, this.commands, this.middleware, this.budget, signal, this.fileWrites, this.outputFiles,
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
            if (reason instanceof Flow && reason.kind === "return") return runtime!.finishShell(child!, childIO, reason.status);
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
      const controllers: ManagedControlController[] = [];
      const written = new Set<number>();
      const completed = new Set<number>();
      const closing = new Set<TurnHandle>();
      let statuses: number[];
      let unsealScope: (() => void) | undefined;
      try {
        if (hasActiveExtensions(state) && !state.extensions!.eventDepth) {
          for (const command of pipeline.commands) {
            if (command.kind === "simple" || command.kind === "arithmetic" || command.kind === "conditional") {
              publishCommandSpelling(state, commandSpelling(command));
            }
          }
        }
        for (let index = 1; index < pipeline.commands.length; index++) pipes.push(createBytePipe({
          highWaterMark: this.budget.limits.pipeHighWaterMark, signal: this.signal,
        }));
        for (let index = 0; index < pipeline.commands.length; index++) {
          controllers.push(createManagedControlController());
        }
        unsealScope = io[invocationScope].onSeal(() => {
          const closedReason = new Error("Invocation is closed");
          for (const controller of controllers) abortManagedController(controller, closedReason);
        });
        let transferred: (() => void) | undefined;
        let pendingTransfers = pipeline.commands.length;
        const retireBaseline = terminal
          ? new Promise<void>(resolve => { transferred = resolve; }).then(() => terminal.frame.reconcile(new Map()))
          : undefined;
        if (retireBaseline) {
          retain(retireBaseline);
          void retireBaseline.catch(() => undefined);
        }
        let preparedStages = 0;
        let acceptPreparation: (() => void) | undefined;
        let rejectPreparation: ((reason: unknown) => void) | undefined;
        const installation = state.extensions?.checkpoints.length ? new Promise<void>((resolve, reject) => {
          acceptPreparation = () => { if (++preparedStages === pipeline.commands.length) resolve(); };
          rejectPreparation = reject;
        }).then(async () => {
          if (retireBaseline) await retireBaseline;
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
            if (--pendingTransfers === 0) transferred?.();
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
          try { boundary = owner.activate(false); }
          catch (error) { await owner.abandon(Promise.resolve()); throw error; }
          const signal = boundary.deliverySignal;
          const frame: RuntimeOutcomeFrame = {};
          const runtime = new Runtime(
            this.sourceFs, this.commands, this.middleware, this.budget, signal, this.fileWrites, this.outputFiles,
            boundary.deliverySignal, boundary, this.cancellationState, owner,
            childDepth, this.cancellationMaxDepth, frame, this.inputProfile,
          );
          let captured: CapturedCancellationOutcome<CommandResult>;
          let cleanupRefs: PipeDescriptorFrame | undefined;
          let cleanupDescFrame: PreparedDescriptorFrame | undefined;
          let cleanupInput: ShellInput | undefined;
          let stageOwnsCleanup = false;
          try {
          const rawStateForChild = stateMonitor(state)?.raw ?? state;
          const isPureStage =
            !terminal &&
            !(io.descriptors && (io.descriptors.size > 3 || io.descriptors.get(0)?.closed || io.descriptors.get(1)?.closed || io.descriptors.get(2)?.closed)) &&
            runtime.isPureExternalStageCommand(command, rawStateForChild);
          const references = isPureStage ? undefined : (cleanupRefs = new PipeDescriptorFrame(io[invocationScope]));
          const descriptorFrame = isPureStage ? undefined : (cleanupDescFrame = new PreparedDescriptorFrame(references!, this.budget));
          const reading = incoming?.endpoints?.read;
          const writing = outgoing?.endpoints?.write;
          const readReference = reading && references ? references.open(reading, this.budget) : undefined;
          const writeReference = writing && references ? references.open(writing, this.budget) : undefined;
          const input = (cleanupInput = incoming
            ? new ShellInput(reading?.readable ?? incoming.readable, this.budget, signal, { provenance: "stream", poll: pollIncomingPipe, incoming } as unknown as ConstructorParameters<typeof ShellInput>[3], true)
            : new ShellInput(io.stdin, this.budget, signal, undefined, true));
          const writable = writing?.writable ?? outgoing?.writable;
          stageOwnsCleanup = true;
          let stageResult: CommandResult;
          {
            let preparedChild: State | undefined;
            let preparationFailed = false;
            let started = false;
            let checkpointFailure: ExtensionCheckpointFailure | undefined;
            let outcome: CapturedCancellationOutcome<CommandResult>;
            try {
              let exitCode: number;
              try {
                const isFastPure = isPureStage || runtime.isPureExternalStageCommand(command, rawStateForChild);
                const forkedExt = isFastPure ? forkExtensions(state.extensions, "pipeline") : undefined;
                const child: State = isFastPure
                  ? Object.assign(
                      new RootShellState(rawStateForChild.cwd, rawStateForChild.variables, rawStateForChild.exported, forkedExt),
                      rawStateForChild,
                      {
                        extensions: forkedExt,
                        isolated: true,
                        _readOnlyStage: true,
                      },
                    )
                  : (tryCloneStateSync(state) ?? await cloneState(state, this.signal));
                preparedChild = child;
                if (!child._readOnlyStage) {
                  child.extensions = undefined;
                  child.extensions = forkExtensions(state.extensions, "pipeline");
                  child.isolated = true;
                }
                let childIO: IO;
                if (isPureStage) {
                  childIO = {
                    ...io,
                    nameExpansionContext: undefined,
                    descriptors: undefined,
                    terminal: undefined,
                    stdin: input,
                    ...(incoming ? { asyncDefaultInput: undefined, stdinIsDefault: false } : {}),
                    stdout: outgoing ? new BudgetedPipeStageSink(this.budget, writable!, signal, written, index, controllers[index]!) : signalSink(io.stdout, signal),
                    stderr: signalSink(io.stderr, signal),
                  } as unknown as IO;
                } else {
                  const inherited = isolateIO(io, references!);
                  childIO = {
                    ...inherited,
                    stdin: input,
                    ...(incoming ? { asyncDefaultInput: undefined } : {}),
                    ...(incoming ? { stdinIsDefault: false } : {}),
                    stdout: outgoing ? new BudgetedPipeStageSink(this.budget, writable!, signal, written, index, controllers[index]!) : signalSink(io.stdout, signal),
                    stderr: signalSink(io.stderr, signal),
                    terminal: { target: command, frame: descriptorFrame! },
                  };
                  const descriptors = inherited.descriptors as Map<number, Descriptor>;
                  descriptors.set(0, incoming ? { input, stdinIsDefault: false, ...(readReference ? { pipe: readReference } : {}) } : { ...descriptors.get(0), input });
                  descriptors.set(1, outgoing ? { output: childIO.stdout, ...(writeReference ? { pipe: writeReference } : {}) } : { ...descriptors.get(1), output: childIO.stdout });
                  descriptors.set(2, { ...descriptors.get(2), output: childIO.stderr });
                  childIO.descriptors = descriptors;
                  descriptorFrame!.acquire(descriptors);
                }
                admit();
                acceptPreparation?.();
                if (retireBaseline) await retireBaseline;
                if (installation) {
                  await installation;
                  signal.throwIfAborted();
                }
                const work = runtime.runPipelineStageWork(command, child, childIO, io, reason => { checkpointFailure = reason; });
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
                  if (written.has(upstream) && !completed.has(upstream)) abortManagedController(controllers[upstream]!, SHARED_PIPELINE_CLOSED);
                });
                closing.add(close);
                try { await incoming.abort(); }
                catch (reason) { cleanupFailures.push(reason); }
              }
              const closedInput = input.close();
              if (!isSyncResolved(closedInput)) {
                try { await closedInput.catch((error: unknown) => { if (!(error instanceof PipelineClosed)) throw error; }); }
                catch (reason) { cleanupFailures.push(reason); }
              }
              if (isPureStage) {
                if (reading) {
                  const closedRead = reading.close();
                  if (!isSyncResolved(closedRead)) {
                    try { await closedRead; }
                    catch (reason) { cleanupFailures.push(reason); }
                  }
                }
                if (writing) {
                  const closedWrite = writing.close();
                  if (!isSyncResolved(closedWrite)) {
                    try { await closedWrite; }
                    catch (reason) { cleanupFailures.push(reason); }
                  }
                }
              } else {
                if (!descriptorFrame!.closeSyncIfIdle()) {
                  try { await descriptorFrame!.close(); }
                  catch (reason) { cleanupFailures.push(reason); }
                }
                const closedRefs = references!.close();
                if (!isSyncResolved(closedRefs)) {
                  try { await closedRefs; }
                  catch (reason) { cleanupFailures.push(reason); }
                }
              }
              if (outgoing && !writing) {
                const closedOut = outgoing.close();
                if (!isSyncResolved(closedOut)) await closedOut.catch(() => undefined);
              }
              if (checkpointFailure || installation && preparationFailed) io[invocationScope].failures.push(...cleanupFailures);
              else if (cleanupFailures.length) {
                io[invocationScope].failures.push(...cleanupFailures.slice(1));
                outcome = { kind: "throw", reason: cleanupFailures[0] };
              }
            }
            if (outcome.kind === "throw") throw outcome.reason;
            stageResult = outcome.value;
          }
          captured = { kind: "return", value: stageResult };
          } catch (reason) {
            rejectPreparation?.(reason);
            if (!stageOwnsCleanup) {
              if (cleanupRefs) await io[invocationScope].cleanup(() => cleanupRefs!.close());
              if (cleanupDescFrame) await io[invocationScope].cleanup(() => cleanupDescFrame!.close());
              if (cleanupInput) await io[invocationScope].cleanup(() => cleanupInput!.close());
            }
            captured = frame.report && Object.is(frame.report.origin.signal.reason, reason)
              ? { kind: "throw", reason, report: frame.report }
              : { kind: "throw", reason };
          }
          const selection = owner.finishSync(captured);
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
        unsealScope?.();
        try {
          for (const close of closing) cancelTurn(close);
          for (const [index, controller] of controllers.entries()) if (!completed.has(index) || written.has(index)) abortManagedController(controller, SHARED_PIPELINE_CLOSED);
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
      if (!this.tryStartExtensionsSync(state)) await this.startExtensions(state, io);
      return await this.command(command, state, io, fileShortcut);
    }
    catch (error) {
      if (error instanceof NounsetDiagnosticFailure) throw error;
      if (error instanceof Flow && (error.kind === "exit" || error.kind === "discard")) return this.finishShell(state, io, error.status);
      if (error instanceof Flow && error.kind === "return") return error.status;
      throw error;
    }
  }

  async runPipelineStageWork(
    command: Command,
    child: State,
    childIO: IO,
    io: IO,
    onCheckpointFailure: (reason: ExtensionCheckpointFailure) => void,
  ): Promise<number> {
    let stageOutcome: CapturedCancellationOutcome<number>;
    let hadCheckpointFailure = false;
    try {
      let stageStatus = await this.runCommandIsolated(command, child, childIO);
      if (!this.tryFinishShellSync(child)) {
        stageStatus = await this.finishShell(child, childIO, stageStatus);
      }
      stageOutcome = { kind: "return", value: stageStatus };
    } catch (reason) {
      if (reason instanceof ExtensionCheckpointFailure) {
        hadCheckpointFailure = true;
        onCheckpointFailure(reason);
      }
      stageOutcome = { kind: "throw", reason };
    }
    try {
      if (!this.releaseExtensionsSyncIfEmpty(child)) {
        await this.releaseExtensions(child);
      }
    } catch (cleanup) {
      if (hadCheckpointFailure) io[invocationScope].failures.push(cleanup);
      else stageOutcome = { kind: "throw", reason: cleanup };
    } finally {
      stateMonitor(child)?.closeValues();
    }
    if (stageOutcome.kind === "throw") throw stageOutcome.reason;
    return stageOutcome.value;
  }


  async errexit(status: number, state: State, io: IO): Promise<void> {
    this.signal.throwIfAborted();
    if (status !== 0 && !io.execution?.ignoreErrexit) {
      await this.extensionEvent("error", state, io, status);
      if (state.errexit) throw new Flow("exit", status);
    }
  }

  isPureExternalStageCommand(command: Command, rawState: State): boolean {
    if (
      command.kind !== "simple" ||
      command.redirects.length > 0 ||
      command.words.length === 0 ||
      rawState.externalInvocation ||
      this.middleware.length > 0 ||
      hasActiveExtensions(rawState)
    ) {
      return false;
    }
    const firstName = command.words[0]!.plain;
    if (
      firstName === undefined ||
      !isFastDirectCommand(firstName, command.words) ||
      hasShellFunction(rawState, firstName) ||
      rawState.extensions?.builtins.has(firstName)
    ) {
      return false;
    }
    for (let i = 0; i < command.words.length; i++) {
      const word = command.words[i]!;
      if (word.parts.length === 0) return false;
      for (let j = 0; j < word.parts.length; j++) {
        const part = word.parts[j]!;
        if (part.kind !== "text" || part.byteValue) return false;
        if (!part.quoted && (part.value.includes("{") || (j === 0 && part.value.startsWith("~")) || hasGlobOrEscape(part.value, !!rawState.extglob))) {
          return false;
        }
      }
    }
    const extDef = this.getExternalCommand(firstName);
    return extDef !== undefined && !customRegisteredCommands.has(extDef.execute) && !customRegisteredRegistries.has(this.commands);
  }

  private publishStatus(state: State, statuses: readonly number[], io: IO, terminal?: IO["terminal"]): Promise<void> | void {
    this.signal.throwIfAborted();
    try { throwCleanupFailures(io[invocationScope].failures); }
    catch (error) { throw new NounsetDiagnosticFailure(error); }
    if (state._readOnlyStage || (state.isolated === true && terminal && !hasActiveExtensions(state))) {
      return;
    }
    return publishPipelineStatus(trackState(state, this.budget, io[invocationScope]), statuses, this.signal, io[invocationScope]);
  }

  private runTerminalBeforeExit(
    command: Command,
    state: State,
    terminal: NonNullable<IO["terminal"]>,
    status: number,
    completionIO: IO,
  ): Promise<void> | void {
    const publishes = command.kind === "simple" || command.kind === "subshell" || command.kind === "arithmetic" || command.kind === "conditional";
    if (!publishes) return;
    const reported = terminal.publicationNegate && (command.kind === "conditional" || command.kind === "arithmetic") ? Number(status === 0) : status;
    const statuses = reported === 0 ? singleStatusZero : reported === 1 ? singleStatusOne : [reported];
    const publishing = this.publishStatus(state, statuses, completionIO, terminal);
    if (!publishing && (status === 0 || (!state.errexit && !hasActiveExtensions(state)) || completionIO.execution?.ignoreErrexit)) {
      this.signal.throwIfAborted();
      terminal.published = status;
      return;
    }
    return (async () => {
      if (publishing) await publishing;
      terminal.published = status;
      await this.errexit(status, state, completionIO);
    })();
  }

  async command(command: Command, state: State, io: IO, fileShortcut = false, publicationNegate = false): Promise<number> {
    io.descriptors ??= new Map<number, Descriptor>([
      [0, { input: io.stdin, ...(io.stdinIsDefault === undefined ? {} : { stdinIsDefault: io.stdinIsDefault }) }],
      [1, { output: io.stdout }], [2, { output: io.stderr }],
    ]);
    io[invocationScope].assertOpen();
    if (state.extensions && (command.kind === "simple" || command.kind === "arithmetic" || command.kind === "conditional")) {
      const description = commandSpelling(command);
      if (!state.extensions.eventDepth) publishCommandSpelling(state, description);
      if (hasActiveExtensions(state)) {
        io = { ...io, diagnosticLine: io.diagnosticCommandLines?.get(command) ?? (command.line ?? 1) + (io.diagnosticOffset ?? 0) };
        if (await this.extensionEvent("command", state, io, state.status, description)) return state.status;
      }
    }
    const publishes = command.kind === "simple" || command.kind === "subshell" || command.kind === "arithmetic" || command.kind === "conditional";
    const terminal = io.terminal?.target === command ? io.terminal : undefined;
    if (terminal && publicationNegate) terminal.publicationNegate = true;
    const scope = io[invocationScope];
    let status: number;
    scope.enterWork();
    try { status = await this.executeCommand(command, state, io, fileShortcut); }
    catch (error) {
      if (publishes && error instanceof Flow && completedFlows.has(error)) {
        completedFlows.delete(error);
        this.signal.throwIfAborted();
        if (!io[invocationScope].failures.length) await this.publishStatus(state, [error.status], io);
      }
      throw error;
    }
    finally { scope.leaveWork(); }
    if (terminal && state.extensions?.exitStatus !== undefined && !state.extensions.exiting) state.extensions.exitStatus = status;
    if (publishes) {
      const reported = publicationNegate && (command.kind === "conditional" || command.kind === "arithmetic") ? Number(status === 0) : status;
      if (terminal?.published !== status) {
        const statuses = reported === 0 ? singleStatusZero : reported === 1 ? singleStatusOne : [reported];
        const publishing = this.publishStatus(state, statuses, io, terminal);
        if (publishing) await publishing;
      }
      if (!terminal?.completed && status !== 0) await this.errexit(status, state, io);
    }
    return status;
  }

  async executeCommand(command: Command, state: State, originalIO: IO, fileShortcut = false): Promise<number> {
    const terminal = originalIO.terminal?.target === command ? originalIO.terminal : undefined;
    if (!state._readOnlyStage) state = trackState(state, this.budget, originalIO[invocationScope]);
    if (originalIO.asyncDefaultInput) {
      if (!originalIO.descriptors?.get(0)?.closed && !command.redirects.some(redirect => redirect.descriptor === 0)) {
        const descriptors = new Map(originalIO.descriptors);
        descriptors.set(0, { input: originalIO.asyncDefaultInput, stdinIsDefault: true });
        originalIO = { ...originalIO, terminal: undefined, descriptors, stdin: originalIO.asyncDefaultInput, stdinIsDefault: true, asyncDefaultInput: undefined };
      } else originalIO = { ...originalIO, terminal: undefined, asyncDefaultInput: undefined };
    }
    originalIO = activeIO(originalIO);
    const diagnosticLine = originalIO.diagnosticCommandLines?.get(command) ?? (command.line ?? 1) + (originalIO.diagnosticOffset ?? 0);
    const references = command.kind === "subshell" ? new PipeDescriptorFrame(originalIO[invocationScope]) : undefined;
    if (command.kind === "subshell") originalIO = isolateIO(originalIO, references!);
    this.budget.tick();
    if (this.budget.commands % 128 === 0) await yieldTurn(this.signal);
    this.signal.throwIfAborted();
    if (
      this.middleware.length === 0 &&
      command.kind === "simple" &&
      command.redirects.length === 0 &&
      !fileShortcut &&
      !terminal &&
      !state.variableAttributes?.size &&
      !guestArrays(state)
    ) {
      if (command.words.length === 1) {
        const w0 = command.words[0]!;
        const assignment = !getArrayAssignment(w0) ? this.assignment(w0) : undefined;
        if (
          assignment &&
          !assignment.append &&
          assignment.name !== "OPTIND" &&
          !assignment.name.includes("[") &&
          !state.readonlyVariables?.has(assignment.name) &&
          !arrayStore(state)?.get(assignment.name)
        ) {
          let fastAssigned: ShellValue | undefined;
          let fastFailed = false;
          try {
            fastAssigned = this.fastValueWord(assignment.value, state, originalIO, false, false, false, false, 0, diagnosticLine);
          } catch {
            fastFailed = true;
          }
          if (!fastFailed && fastAssigned !== undefined) {
            state.substitutionStatus = 0;
            const rawState = stateMonitor(state)?.raw ?? state;
            if (assignment.name !== "_") delete rawState.variables._;
            rawState.lastArgument = "";
            publishVariable(state, assignment.name, fastAssigned);
            if (state.allexport) state.exported.add(assignment.name);
            if (originalIO.assignmentDiagnosticContext) originalIO.assignmentDiagnosticContext.name = undefined;
            return 0;
          }
        }
      } else if (command.words.length >= 2) {
        const w0Plain = command.words[0]!.plain;
        if (
          (w0Plain === "[" || w0Plain === "test") &&
          !hasShellFunction(state, w0Plain) &&
          !state.extensions?.builtins.has(w0Plain)
        ) {
          const cmd = this.commands.get(w0Plain);
          if (cmd && defaultPredicateExecutors.has(cmd.execute)) {
            let wordValues: ShellValue[] | undefined;
            let fastFailed = false;
            try {
              wordValues = this.fastValueWords(command.words, state, originalIO, false, false, diagnosticLine);
            } catch {
              fastFailed = true;
            }
            if (!fastFailed && wordValues !== undefined && wordValues.every(v => typeof v === "string")) {
              const fastPred = tryFastPredicate(w0Plain, wordValues as readonly string[], 1);
              if (fastPred !== undefined) {
                state.substitutionStatus = 0;
                const rawState = stateMonitor(state)?.raw ?? state;
                delete rawState.variables._;
                rawState.lastArgument = (wordValues as readonly string[])[wordValues.length - 1] ?? w0Plain;
                if (originalIO.assignmentDiagnosticContext) originalIO.assignmentDiagnosticContext.name = undefined;
                return fastPred;
              }
            }
          }
        }
      }
    }
    if (
      this.middleware.length === 0 &&
      command.kind === "simple" &&
      command.redirects.length === 1 &&
      command.words.length >= 1 &&
      this.budget.limits.maxRedirects >= 1 &&
      !fileShortcut &&
      !terminal &&
      !state.variableAttributes?.size &&
      !guestArrays(state) &&
      this.fileWrites.size === 0 &&
      this.outputFiles.size === 0 &&
      this.canFastMemoryRedirect
    ) {
      const r0 = command.redirects[0]!;
      const w0Plain = command.words[0]!.plain;
      if (
        r0.descriptor === 1 &&
        !r0.move &&
        !r0.document &&
        (r0.operator === ">" || r0.operator === ">>" || (r0.operator === ">|" && state.noclobber)) &&
        !(r0.operator === ">" && state.noclobber) &&
        (w0Plain === "echo" || w0Plain === "printf") &&
        !hasShellFunction(state, w0Plain) &&
        !state.extensions?.builtins.has(w0Plain)
      ) {
        const def = this.commands.get(w0Plain);
        const rawState = stateMonitor(state)?.raw ?? state;
        if (
          def &&
          (w0Plain === "printf" ? def.execute === printfCommand.execute : defaultEchoExecutors.has(def.execute)) &&
          this.isPureArgWord(r0.target, rawState) &&
          command.words.every(w => this.isPureArgWord(w, rawState))
        ) {
          let targetVal: ShellValue | undefined;
          let formatted: string | undefined;
          let lastArg = w0Plain;
          let fastFailed = false;
          try {
            if (command.words.length <= this.budget.limits.maxExpansionFields) {
              if (w0Plain === "echo" && command.words.length === 1) {
                targetVal = this.fastValueWord(r0.target, state, originalIO, true, false, false, true, undefined, diagnosticLine);
                formatted = "\n";
              } else if (w0Plain === "echo" && command.words.length === 2) {
                const arg0 = this.fastValueWord(command.words[1]!, state, originalIO, true, false, false, true, undefined, diagnosticLine);
                if (typeof arg0 === "string" && !arg0.startsWith("-") && !arg0.includes("\0")) {
                  targetVal = this.fastValueWord(r0.target, state, originalIO, true, false, false, true, undefined, diagnosticLine);
                  formatted = `${arg0}\n`;
                  lastArg = arg0;
                }
              } else {
                fastSubScratchArgs.length = 0;
                let allStrings = true;
                for (let i = 1; i < command.words.length; i++) {
                  const v = this.fastValueWord(command.words[i]!, state, originalIO, true, false, false, true, undefined, diagnosticLine);
                  if (typeof v !== "string") {
                    allStrings = false;
                    break;
                  }
                  fastSubScratchArgs.push(v);
                }
                if (allStrings) {
                  if (fastSubScratchArgs.length > 0) lastArg = fastSubScratchArgs[fastSubScratchArgs.length - 1]!;
                  if (w0Plain === "printf") {
                    formatted = tryFastPrintf(fastSubScratchArgs);
                  } else if (!fastSubScratchArgs[0]?.startsWith("-")) {
                    const joined = `${fastSubScratchArgs.join(" ")}\n`;
                    if (!joined.includes("\0")) formatted = joined;
                  }
                  fastSubScratchArgs.length = 0;
                  if (formatted !== undefined) {
                    targetVal = this.fastValueWord(r0.target, state, originalIO, true, false, false, true, undefined, diagnosticLine);
                  }
                } else {
                  fastSubScratchArgs.length = 0;
                }
              }
            }
          } catch {
            fastSubScratchArgs.length = 0;
            fastFailed = true;
          }
          if (!fastFailed && formatted !== undefined && typeof targetVal === "string" && targetVal.length > 0 && !targetVal.includes("\0")) {
            const path = pathOf(state, targetVal);
            if (!path.startsWith("/dev/") && path !== "/dev") {
              const encoded =
                formatted.length * 3 <= fastRedirectScratchBytes.byteLength
                  ? fastRedirectScratchBytes.subarray(0, fastSharedTextEncoder.encodeInto(formatted, fastRedirectScratchBytes).written)
                  : Buffer.from(formatted, "utf8");
              const byteLength = encoded.byteLength;
              if (byteLength <= this.budget.limits.maxOutputBytes - this.budget.bytes && this.budget.canFileSystemOperation()) {
                let writeSucceeded = false;
                const mode = 0o666 & ~(state.umask ?? 0o022);
                try {
                  writeSucceeded = tryWriteMemoryFileSync(
                    this.backingFs,
                    path,
                    encoded,
                    r0.operator === ">>",
                    mode,
                    this.commandSignal,
                  );
                  if (writeSucceeded) {
                    this.budget.fileSystemOperation();
                    this.budget.bytes += byteLength;
                  }
                } catch {
                  this.signal.throwIfAborted();
                }
                if (writeSucceeded) {
                  state.substitutionStatus = 0;
                  delete rawState.variables._;
                  rawState.lastArgument = lastArg;
                  if (originalIO.assignmentDiagnosticContext) originalIO.assignmentDiagnosticContext.name = undefined;
                  return 0;
                }
              }
            }
          }
        }
      }
    }
    const hasRedirects = command.redirects.length > 0 || fileShortcut || command.kind === "subshell";
    const inputs = hasRedirects ? new Set<{ close(): void | Promise<void> }>() : emptyInputs;
    const outputs = hasRedirects ? new Set<OutputFinalizer>() : emptyOutputs;
    const processSubstitutions: (() => Promise<void>)[] = [];
    const allocation = this.budget.values.scope();
    originalIO = {
      ...originalIO,
      terminal: undefined,
      diagnosticLine,
      substitutionDiagnosticLine: originalIO.substitutionDiagnosticLines?.get(command) ?? diagnosticLine,
      [valueScope]: allocation,
      processSubstitutions,
    };
    let io = originalIO;
    let diagnosticFailure: NounsetDiagnosticFailure | undefined;
    let outputTracker: OutputFailureTracker | undefined;
    const snapshotHolder: { scope?: InvocationScope; finish?: () => void } = {};
    try {
      let status = 0;
      if (command.kind === "simple") {
        status = await this.simple(command, state, originalIO, inputs, outputs, snapshotHolder, fileShortcut, terminal);
        if (originalIO.assignmentDiagnosticContext) originalIO.assignmentDiagnosticContext.name = undefined;
      } else {
        const compoundResult = await this.executeCompoundCommand(command, state, io, inputs, outputs, allocation, terminal);
        status = compoundResult.status;
        io = compoundResult.io;
        if (compoundResult.diagnosticFailure) diagnosticFailure = compoundResult.diagnosticFailure;
      }
      if (terminal) {
        const before = this.runTerminalBeforeExit(command, state, terminal, status, terminal.io ?? io);
        if (before) await before;
        if (!this.tryFinishShellSync(state)) {
          status = await this.finishShell(state, terminal.io ?? io, status);
        }
        terminal.completed = true;
      }
      if (outputs.size > 0 || inputs.size > 0 || processSubstitutions.length > 0) {
        await this.finishCommandResources(status, outputs, inputs, processSubstitutions, outputTracker = {});
      }
      return status;
    } catch (caught) {
      const errResult = await this.handleExecuteCommandError(
        caught,
        command,
        state,
        io,
        terminal,
        outputs,
        inputs,
        processSubstitutions,
        outputTracker,
      );
      if (errResult.diagnosticFailure) diagnosticFailure = errResult.diagnosticFailure;
      return errResult.status;
    } finally {
      try {
        if (!references && outputs.size === 0 && inputs.size === 0 && processSubstitutions.length === 0) {
          allocation.close();
        } else {
          await this.cleanupCommandResources(references, outputs, inputs, processSubstitutions, allocation, diagnosticFailure, io);
        }
      } finally {
        snapshotHolder.finish?.();
        if (snapshotHolder.scope) await snapshotHolder.scope.close();
      }
    }
  }

  private async finishCommandResources(
    status: number,
    outputs: Set<OutputFinalizer>,
    inputs: Set<{ close(): void | Promise<void> }>,
    processSubstitutions: (() => Promise<void>)[],
    outputFailuresOut?: OutputFailureTracker,
  ): Promise<void> {
    if (outputs.size > 0) {
      const pending = [...outputs];
      outputs.clear();
      const settled = await Promise.allSettled(pending.map(close => close({ status })));
      for (const [index, result] of settled.entries()) {
        const descriptor = pending[index]?.descriptor;
        if (result.status === "rejected" && descriptor && outputFailuresOut) {
          (outputFailuresOut.list ??= []).push({ descriptor, reason: result.reason });
        }
      }
      if (status !== 0 && outputFailuresOut) outputFailuresOut.outputStatus = status;
      throwCleanupFailures(settled.filter(result => result.status === "rejected").map(result => result.reason));
    }
    if (inputs.size > 0) {
      const pendingInputs = [...inputs];
      inputs.clear();
      await Promise.allSettled(pendingInputs.map(input => input.close()));
    }
    if (processSubstitutions.length > 0) {
      const pending = processSubstitutions.splice(0);
      for (const callback of pending) await callback();
    }
  }

  private async cleanupCommandResources(
    references: PipeDescriptorFrame | undefined,
    outputs: Set<OutputFinalizer>,
    inputs: Set<{ close(): void | Promise<void> }>,
    processSubstitutions: (() => Promise<void>)[],
    allocation: ReturnType<Runtime["budget"]["values"]["scope"]>,
    diagnosticFailure: NounsetDiagnosticFailure | undefined,
    io: IO,
  ): Promise<void> {
    await Promise.allSettled([
      ...(references ? [references.close()] : []),
      ...[...outputs].map(async close => close({ reason: new FsError("ECANCELED", { syscall: "redirect" }) })),
      ...[...inputs].map(async input => input.close()),
    ]).then(async results => {
      if (processSubstitutions.length > 0) await Promise.allSettled(processSubstitutions.splice(0).map(callback => callback()));
      const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
      if (diagnosticFailure) io[invocationScope].failures.push(...failures);
      else throwCleanupFailures(failures);
    }).finally(() => allocation.close());
  }

  private async executeCompoundCommand(
    command: Exclude<Command, { kind: "simple" }>,
    state: State,
    io: IO,
    inputs: Set<{ close(): void | Promise<void> }>,
    outputs: Set<OutputFinalizer>,
    allocation: ReturnType<Runtime["budget"]["values"]["scope"]>,
    terminal: IO["terminal"],
  ): Promise<{ status: number; io: IO; diagnosticFailure: NounsetDiagnosticFailure | undefined }> {
    let status = 0;
    let diagnosticFailure: NounsetDiagnosticFailure | undefined;
    if (command.kind === "function") {
      if (state.readonlyFunctions?.has(command.name)) {
        await this.diagnostic(io, `${command.name}: readonly function`);
        status = 1;
      } else if (state.profile === "sh" && (specialBuiltinNames.has(command.name) || state.extensions?.builtins.get(command.name)?.special)) {
        await this.diagnostic(io, `\`${command.name}': is a special builtin`);
        throw new Flow("exit", 2);
      } else {
        const body = { ...command.body, sourceName: io.scriptName ?? "shell" };
        const offset = io.diagnosticOffset ?? 0;
        const bodyLine = io.functionCommandLines?.get(command.body);
        if (bodyLine !== undefined) body.line = bodyLine - offset;
        functionDiagnostics.set(body, { offset, ...(bodyLine === undefined ? {} : { lines: io.functionCommandLines! }) });
        state.functions.set(command.name, body);
        status = 0;
      }
      return { status, io, diagnosticFailure };
    }
    {
      io = await this.redirect(command.redirects, state, io, inputs, outputs, command.kind === "subshell", command.kind !== "subshell");
      if (terminal) {
        terminal.io = io;
        await terminal.frame.reconcile(io.descriptors!);
      }
      if (command.kind === "conditional") {
        if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = "[[";
        try {
          status = await evaluateConditional(command.expression, {
            fs: this.fs, cwd: state.cwd, signal: this.signal,
            predicateIdentity: io.capabilities?.predicateIdentity,
            reference: name => state.variableAttributes?.get(name)?.includes("n") ?? false,
            locale: state.variables.LC_ALL || state.variables.LC_COLLATE || state.variables.LANG || "C",
            characterLocale: state.variables.LC_ALL || state.variables.LC_CTYPE || state.variables.LANG || "C",
            ignoreCase: !!state.nocasematch,
            extglob: true,
            work: { remaining: this.budget.limits.maxExpansionBytes, signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes"), allocation },
            expand: async (word, pattern = false) => (await this.word(word, state, { ...io, nameExpansionContext: "conditional" }, false, pattern, false, pattern)).join(""),
            arithmetic: value => this.arithmeticValue(prepareArithmetic(value || "0", this.budget.parsing), state, io),
            regex: (subject, pattern) => this.ere(subject, pattern, state, { ...io, nameExpansionContext: "conditional" }),
            option: name => name === "allexport" ? !!state.allexport : name === "braceexpand" ? state.braceexpand !== false : name === "noexec" ? !!state.noexec : name === "noglob" ? !!state.noglob : name === "noclobber" ? !!state.noclobber : name === "errexit" ? !!state.errexit : name === "nounset" ? !!state.nounset : name === "pipefail" ? state.pipefail : state.extensions?.options.get(name)?.enabled ?? false,
            present: name => this.variablePresent(state, name, io),
          });
        } catch (error) {
          this.signal.throwIfAborted();
          if (error instanceof NounsetDiagnosticFailure) { diagnosticFailure = error; throw error; }
          if (error instanceof EreProfileLimitError) {
            try { await this.diagnostic(io, `[[ ${error.message}`); }
            catch (reason) { this.signal.throwIfAborted(); if (reason instanceof ShellLimitError) throw reason; diagnosticFailure = new NounsetDiagnosticFailure(reason); throw diagnosticFailure; }
            status = 3;
          } else if (error instanceof ConditionalUnsupported) {
            try { await this.diagnostic(io, error.message); }
            catch (reason) { this.signal.throwIfAborted(); if (reason instanceof ShellLimitError) throw reason; diagnosticFailure = new NounsetDiagnosticFailure(reason); throw diagnosticFailure; }
            status = 2;
          } else if (error instanceof PublicDiagnostic) {
            await this.diagnostic(io, `[[: ${error.message}`);
            status = 1;
          } else {
            if (error instanceof ExpansionFailure || error instanceof Flow || error instanceof ShellLimitError || error instanceof ShellSyntaxError || error instanceof ArrayFailure) throw error;
            diagnosticFailure = new NounsetDiagnosticFailure(error);
            throw diagnosticFailure;
          }
        }
      } else if (command.kind === "arithmetic") {
        if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = "((";
        try {
          status = Number(await this.expandedArithmeticValue(command.expression, state, io) === 0n);
        }
        catch (error) { this.rethrowArithmeticControl(error); throw new PublicDiagnostic(`((: ${message(error, this.budget.onInternalError)}`); }
      } else if (command.kind === "subshell") {
        const child = tryCloneStateSync(state) ?? await cloneState(state, this.signal);
        child.extensions = undefined;
        let started = false;
        try {
          child.extensions = forkExtensions(state.extensions, "subshell");
          child.isolated = true;
          child.loopDepth = 0;
          if (state.extensions?.checkpoints.length) await this.extensionCheckpoint("child-job-install", state, io);
          started = true;
          status = await this.run(command.body, child, io);
        } finally {
          try {
            if (!started && child.extensions?.cleanup.length) await io[invocationScope].cleanup(() => this.releaseExtensions(child));
          } finally { stateMonitor(child)?.closeValues(); }
        }
      } else if (command.kind === "group") {
        status = await this.script(command.body, state, io);
      } else if (command.kind === "if") {
        let matchedBranch = false;
        for (const branch of command.branches) {
          if (await this.script(branch.condition, state, { ...io, execution: { ignoreErrexit: true } }) === 0) {
            status = await this.script(branch.body, state, io);
            matchedBranch = true;
            break;
          }
        }
        if (!matchedBranch) status = command.otherwise ? await this.script(command.otherwise, state, io) : 0;
      } else if (command.kind === "case") {
        if (hasActiveExtensions(state)) {
          const description = `case ${command.subject.spelling ?? command.subject.plain ?? ""} in `;
          if (!state.extensions.eventDepth) publishCommandSpelling(state, description);
          if (await this.extensionEvent("command", state, io, state.status, description)) status = state.status;
          else {
            const subject = (await this.word(command.subject, state, io, false)).join("");
            const work = { remaining: this.budget.limits.maxExpansionBytes, signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes"), allocation };
            let fallthrough = false;
            let patterns = 0;
            for (const clause of command.clauses) {
              let matched = fallthrough;
              if (!matched) for (const word of clause.patterns) {
                if (++patterns % 128 === 0) await yieldTurn(this.signal);
                const pattern = (await this.word(word, state, io, false, true)).join("");
                if (await matchesPattern(pattern, subject, work, !!state.nocasematch, !!state.extglob)) { matched = true; break; }
              }
              if (!matched) continue;
              if (clause.body.lists.length) status = await this.script(clause.body, state, io);
              if (clause.terminator === ";;" || clause.terminator === "esac") break;
              fallthrough = clause.terminator === ";&";
            }
          }
        } else {
          const subject = (await this.word(command.subject, state, io, false)).join("");
          const work = { remaining: this.budget.limits.maxExpansionBytes, signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes"), allocation };
          let fallthrough = false;
          let patterns = 0;
          for (const clause of command.clauses) {
            let matched = fallthrough;
            if (!matched) for (const word of clause.patterns) {
              if (++patterns % 128 === 0) await yieldTurn(this.signal);
              const pattern = (await this.word(word, state, io, false, true)).join("");
              if (await matchesPattern(pattern, subject, work, !!state.nocasematch, !!state.extglob)) { matched = true; break; }
            }
            if (!matched) continue;
            if (clause.body.lists.length) status = await this.script(clause.body, state, io);
            if (clause.terminator === ";;" || clause.terminator === "esac") break;
            fallthrough = clause.terminator === ";&";
          }
        }
      } else {
      const loopRestoration = stateMonitor(state)?.restoration();
      state.loopDepth++;
      try {
        if (command.kind === "for") {
          const rawLoopState = stateMonitor(state)?.raw ?? state;
          const fastLoopWords = command.words?.length === 1 && rawLoopState.braceexpand !== false && !rawLoopState.variableAttributes?.size && !guestArrays(rawLoopState)
            ? tryFastExpandBraceRange(command.words[0]!, this.budget, io[valueScope] ? (b, o) => io[valueScope]!.reserve(b, o) : undefined)
            : undefined;
          const values = fastLoopWords ?? (command.words ? await this.valueWords(command.words, state, io) : this.positionalValues(state));
          const bodyIgnoreErrexit = Boolean(io.execution?.ignoreErrexit);
          const canFastAssignLoopVar =
            isShellIdentifier(command.name) &&
            command.name !== "OPTIND" &&
            !command.name.includes("[") &&
            !rawLoopState.readonlyVariables?.has(command.name) &&
            !rawLoopState.variableAttributes?.size &&
            !guestArrays(rawLoopState) &&
            !arrayStore(rawLoopState)?.get(command.name);
          let loopTurn = 0;
          for (const value of values) {
            this.budget.loop();
            if ((++loopTurn & 127) === 0) {
              if (hasYieldCheckpoint(this.signal) || (loopTurn & 2047) === 0) await yieldTurn(this.signal);
              else runYieldCheckpoint(this.signal);
            }
            if (io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = undefined;
            if (state.variableAttributes?.get(command.name)?.includes("n")) {
              const target = shellValueText(value);
              if (!this.variableTarget(target) || target === command.name) throw new ExpansionFailure(`${target}: invalid name reference`);
              await this.writeVariable(state, command.name, value, io, "assignment", false);
            } else if (canFastAssignLoopVar && !rawLoopState.readonlyVariables?.has(command.name) && !arrayStore(rawLoopState)?.get(command.name)) {
              publishVariable(rawLoopState, command.name, value);
              if (rawLoopState.allexport) state.exported.add(command.name);
            } else {
              await this.assignVariable(state, command.name, value, io);
            }
            if (hasActiveExtensions(rawLoopState)) {
              const description = `for ${command.name} in ${command.words?.map(word => word.spelling ?? word.plain ?? "").join(" ") ?? '"$@"'}`;
              if (!rawLoopState.extensions?.eventDepth) publishCommandSpelling(state, description);
              if (await this.extensionEvent("command", state, io, state.status, description)) continue;
            }
            if (!rawLoopState.extensions?.checkpoints.length) {
              const syncBody = this.trySyncScript(command.body, rawLoopState, io, bodyIgnoreErrexit);
              if (typeof syncBody === "number") {
                status = syncBody;
                continue;
              }
              const result = await this.loopBody(command.body, state, io, syncBody.listIndex, syncBody.pipelineIndex);
              status = result.status;
              if (result.stop) break;
              continue;
            }
            const result = await this.loopBody(command.body, state, io);
            status = result.status;
            if (result.stop) break;
          }
        } else if (command.kind === "arithmetic-for") {
          const rawArithState = stateMonitor(state)?.raw ?? state;
          const evaluate = async (program: ArithmeticProgram | undefined): Promise<bigint | undefined> => {
            if (!program) return 1n;
            try { return await this.expandedArithmeticValue(program, state, io); }
            catch (error) {
              this.rethrowArithmeticControl(error);
              await this.diagnostic(io, `((: ${message(error, this.budget.onInternalError)}`);
              return undefined;
            }
          };
          const evaluateSyncNonZero = (program: ArithmeticProgram | undefined): boolean | Promise<bigint | undefined> => {
            if (!program) return true;
            if (!program.error && !program.hasSubscript && !guestArrays(rawArithState) && !rawArithState.variableAttributes?.size) {
              try { return this.syncShellArithmeticNonZero(program, rawArithState, io.diagnosticLine); }
              catch (error) {
                this.rethrowArithmeticControl(error);
                return this.diagnostic(io, `((: ${message(error, this.budget.onInternalError)}`).then(() => undefined);
              }
            }
            return evaluate(program);
          };
          const initOrPromise = evaluateSyncNonZero(command.expressions[0]);
          if ((typeof initOrPromise === "boolean" ? initOrPromise : await initOrPromise) === undefined) return { status: 1, io, diagnosticFailure };
          const bodyIgnoreErrexit = Boolean(io.execution?.ignoreErrexit);
          let loopTurn = 0;
          while (true) {
            this.budget.loop();
            if ((++loopTurn & 127) === 0) {
              if (hasYieldCheckpoint(this.signal) || (loopTurn & 2047) === 0) await yieldTurn(this.signal);
              else runYieldCheckpoint(this.signal);
            }
            const condOrPromise = evaluateSyncNonZero(command.expressions[1]);
            if (typeof condOrPromise === "boolean") {
              if (!condOrPromise) break;
            } else {
              const condition = await condOrPromise;
              if (condition === undefined) return { status: 1, io, diagnosticFailure };
              if (condition === 0n) break;
            }
            if (!rawArithState.extensions?.checkpoints.length) {
              const syncBody = this.trySyncScript(command.body, rawArithState, io, bodyIgnoreErrexit);
              if (typeof syncBody === "number") {
                status = syncBody;
              } else {
                const result = await this.loopBody(command.body, state, io, syncBody.listIndex, syncBody.pipelineIndex);
                status = result.status;
                if (result.stop) break;
              }
            } else {
              const result = await this.loopBody(command.body, state, io);
              status = result.status;
              if (result.stop) break;
            }
            const stepOrPromise = evaluateSyncNonZero(command.expressions[2]);
            if ((typeof stepOrPromise === "boolean" ? stepOrPromise : await stepOrPromise) === undefined) { status = 1; break; }
          }
        } else if (command.kind === "select") {
          const values = command.words ? await this.valueWords(command.words, state, io) : this.positionalValues(state);
          if (values.length) {
          const input = io.stdin instanceof ShellInput ? io.stdin : new ShellInput(io.stdin, this.budget, this.signal);
          const work = { remaining: this.budget.limits.maxExpansionBytes * 8, signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") };
          let showMenu = true;
          while (true) {
            this.budget.loop();
            if (showMenu) await selectMenu(values, state.variables.COLUMNS, byteLocale(state.variables), io.stderr, work, allocation);
            const prompt = stateMonitor(state)?.values.get("PS3", state.variables.PS3 ?? "#? ") ?? state.variables.PS3 ?? "#? ";
            await io.stderr.write(shellValueBytes(prompt, allocation));
            const line = await input.selectLine(allocation);
            if (state.readonlyVariables?.has("REPLY")) {
              await this.diagnostic(io, "REPLY: readonly variable");
              await writeText(io.stdout, "\n");
              status = 1;
              break;
            }
            await this.writeVariable(state, "REPLY", line.value, io);
            if (!line.terminated) { await writeText(io.stdout, "\n"); status = 1; break; }
            const bytes = shellValueBytes(line.value, allocation);
            if (!bytes.length) { showMenu = true; continue; }
            let choice = 0;
            let phase: "start" | "digits" | "tail" = "start";
            let valid = true;
            let negative = false;
            let digits = false;
            for (const byte of bytes) {
              const pending = stringCheckpoint(work);
              if (pending) await pending;
              if (byte === 32 || byte >= 9 && byte <= 13) { if (phase === "digits") phase = "tail"; continue; }
              if (phase === "start" && (byte === 43 || byte === 45)) { negative = byte === 45; phase = "digits"; continue; }
              if (phase === "tail" || byte < 48 || byte > 57) { valid = false; continue; }
              phase = "digits";
              digits = true;
              choice = Math.min(values.length + 1, choice * 10 + byte - 48);
            }
            await this.assignVariable(state, command.name, valid && digits && !negative && choice >= 1 && choice <= values.length ? values[choice - 1]! : "", io);
            const result = await this.loopBody(command.body, state, io);
            status = result.status;
            if (result.stop) break;
            showMenu = shellValueByteLength(stateMonitor(state)?.values.get("REPLY", state.variables.REPLY ?? "") ?? state.variables.REPLY ?? "") === 0;
          }
          }
        } else {
          const conditionIO = io.execution?.ignoreErrexit ? io : { ...io, execution: { ignoreErrexit: true } };
          const bodyIgnoreErrexit = Boolean(io.execution?.ignoreErrexit);
          let loopTurn = 0;
          while (true) {
            this.budget.loop();
            if ((++loopTurn & 127) === 0) {
              if (hasYieldCheckpoint(this.signal) || (loopTurn & 2047) === 0) await yieldTurn(this.signal);
              else runYieldCheckpoint(this.signal);
            }
            const syncCond = this.trySyncScript(command.condition, state, conditionIO, true);
            const condition = typeof syncCond === "number"
              ? syncCond
              : await this.script(command.condition, state, conditionIO, syncCond.listIndex, syncCond.pipelineIndex);
            if ((condition === 0) !== (command.kind === "while")) break;
            if (!state.extensions?.checkpoints.length) {
              const syncBody = this.trySyncScript(command.body, state, io, bodyIgnoreErrexit);
              if (typeof syncBody === "number") {
                status = syncBody;
                continue;
              }
              const result = await this.loopBody(command.body, state, io, syncBody.listIndex, syncBody.pipelineIndex);
              status = result.status;
              if (result.stop) break;
              continue;
            }
            const result = await this.loopBody(command.body, state, io);
            status = result.status;
            if (result.stop) break;
          }
        }
      } finally {
        if (loopRestoration) loopRestoration.decrementLoopDepth();
        else state.loopDepth--;
      }
      }
      }
      return { status, io, diagnosticFailure };
  }

  private async handleExecuteCommandError(
    caught: unknown,
    command: Command,
    state: State,
    io: IO,
    terminal: IO["terminal"],
    outputs: Set<OutputFinalizer>,
    inputs: Set<{ close(): void | Promise<void> }>,
    processSubstitutions: (() => Promise<void>)[],
    outputTracker: OutputFailureTracker = {},
  ): Promise<{ status: number; diagnosticFailure: NounsetDiagnosticFailure | undefined }> {
      let diagnosticFailure: NounsetDiagnosticFailure | undefined;
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
        try {
          await this.finishCommandResources(error.status, outputs, inputs, processSubstitutions, outputTracker);
        }
        catch (reason) {
          this.signal.throwIfAborted();
          if (!outputTracker.list?.length) throw reason;
          await writeText(io.stderr, `${io.scriptName ?? "shell"}: line ${io.diagnosticLine ?? 1}: ${message(reason, this.budget.onInternalError)}\n`);
          for (const failure of outputTracker.list) failure.descriptor.acknowledgeCloseFailure(failure.reason);
        }
      }
      if (error instanceof Flow || error instanceof ShellLimitError || error instanceof ShellSyntaxError) throw error;
      this.clearOutcomeReport();
      if (error instanceof HereDocumentSyntaxError) {
        await writeDiagnostic(io.stderr, error.diagnostic);
        if (command.kind !== "simple" && command.kind !== "subshell" && command.kind !== "arithmetic" && command.kind !== "conditional") await this.errexit(1, state, io);
        return { status: 1, diagnosticFailure };
      }
      if (errorCode(error) === "EPIPE") {
        if (outputTracker.list) for (const failure of outputTracker.list) failure.descriptor.acknowledgeCloseFailure(failure.reason);
        if (command.kind !== "simple" && command.kind !== "subshell" && command.kind !== "arithmetic" && command.kind !== "conditional") await this.errexit(141, state, io);
        return { status: 141, diagnosticFailure };
      }
      const publicMessage = message(error, this.budget.onInternalError);
      const line = error instanceof ExpansionFailure ? error.line ?? io.diagnosticLine ?? 1 : io.diagnosticLine ?? 1;
      if (error instanceof NounsetFailure || error instanceof ParameterExpansionFailure) {
        const detail = error instanceof ParameterExpansionFailure ? diagnostic ?? publicMessage : publicMessage;
        try { await writeDiagnostic(io.stderr, `${io.scriptName ?? "shell"}: line ${line}: ${detail}\n`); }
        catch (reason) {
          this.signal.throwIfAborted();
          if (reason instanceof ShellLimitError) throw reason;
          diagnosticFailure = new NounsetDiagnosticFailure(reason);
          throw diagnosticFailure;
        }
        throw completedExit(error instanceof ParameterExpansionFailure && !state.isolated ? 127 : 1, "exit", 1, undefined, true);
      }
      if (error instanceof ArrayFailure) await writeDiagnostic(io.stderr, `${io.scriptName ?? "shell"}: line ${line}: ${diagnostic ?? publicMessage}\n`);
      else {
        try {
          const origin = io.assignmentDiagnosticContext;
          const namedDeclaration = error instanceof DiscardCommandFailure && error.origin === "declaration" && origin?.name !== undefined;
          const detail = diagnostic ?? `${namedDeclaration ? `${origin.name}: ` : ""}${publicMessage}`;
          await writeDiagnostic(io.stderr, `${io.scriptName ?? "shell"}: line ${line}: ${detail}\n`);
          if (outputTracker.list) for (const failure of outputTracker.list) failure.descriptor.acknowledgeCloseFailure(failure.reason);
        }
        catch (failure) { this.signal.throwIfAborted(); publicDiagnosticMessage(failure, this.budget.onInternalError); }
      }
      if (error instanceof ExpansionFailure || error instanceof BraceExpansionFailure) throw completedExit(error instanceof ParameterExpansionFailure && !state.isolated ? 127 : 1);
      if (error instanceof FatalCommandFailure) throw completedExit(error.status);
      if (error instanceof DiscardCommandFailure) throw completedExit(error.status, "discard");
      const status = outputTracker.outputStatus ?? (error instanceof CommandFailure ? error.status : 1);
      if (command.kind !== "simple" && command.kind !== "subshell" && command.kind !== "arithmetic" && command.kind !== "conditional") await this.errexit(status, state, io);
      return { status, diagnosticFailure };
  }

  async loopBody(body: Script, state: State, io: IO, startListIndex = 0, startPipelineIndex = 0): Promise<{ status: number; stop: boolean }> {
    let status = 0;
    let control: Flow | undefined;
    try { status = await this.script(body, state, io, startListIndex, startPipelineIndex); }
    catch (error) {
      if (!(error instanceof Flow) || (error.kind !== "break" && error.kind !== "continue")) throw error;
      control = error;
      status = error.status;
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
      for (const word of hereDocumentWords(document, line, byteLocale(state.variables), warnings, this.budget.parsing, state.extensions?.syntax)) {
        this.signal.throwIfAborted();
        for (const warning of warnings.splice(0)) await writeDiagnostic(io.stderr, `shell: warning: ${warning}\n`);
        if (++words % 128 === 0) await yieldTurn(this.signal);
        for (const part of await this.valueWord(word, state, { ...io, nameExpansionContext: "document" }, false, false, false, false, undefined, true, false)) {
          size += shellValueByteLength(part);
          if (size > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
          if (!fragments && typeof part === "string") value += part;
          else {
            if (!fragments) {
              allocation.reserve(64 + value.length * 2, 2);
              fragments = [value];
              value = "";
            }
            allocation.reserve(32 + (typeof part === "string" ? part.length * 2 : 0), 1);
            fragments.push(part);
          }
        }
      }
      return fragments ? concatShellValues(fragments, io[valueScope] ?? allocation) : value;
    } finally {
      try {
        for (const warning of warnings.splice(0)) await writeDiagnostic(io.stderr, `shell: warning: ${warning}\n`);
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
    if (redirects.length === 0 && !fileShortcut) {
      const d0 = io.descriptors.get(0);
      const d1 = io.descriptors.get(1);
      const d2 = io.descriptors.get(2);
      if (
        (io.stdin === closedSource ? (!d0 || d0.closed) : (d0 && !d0.closed && d0.input === io.stdin && d0.stdinIsDefault === io.stdinIsDefault)) &&
        io.stdout !== closedSink &&
        io.stderr !== closedSink &&
        d1 && !d1.closed && d1.output === io.stdout &&
        d2 && !d2.closed && d2.output === io.stderr
      ) {
        return io;
      }
    }
    const resourceFs = this.getRedirectFs(state.umask ?? 0o022);
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
        capabilities: io.capabilities,
        ...(io.argv0 === undefined ? {} : { argv0: io.argv0 }),
        [invocationScope]: io[invocationScope],
        ...(io.admittedHandles === undefined ? {} : { admittedHandles: io.admittedHandles }),
        ...(io.processSignals === undefined ? {} : { processSignals: io.processSignals }),
        ...(io[valueScope] === undefined ? {} : { [valueScope]: io[valueScope] }),
        ...(io.execution === undefined ? {} : { execution: io.execution }),
        ...(io.diagnosticLine === undefined ? {} : { diagnosticLine: io.diagnosticLine }),
        ...(io.diagnosticOffset === undefined ? {} : { diagnosticOffset: io.diagnosticOffset }),
        ...(io.assignmentDiagnosticContext === undefined ? {} : { assignmentDiagnosticContext: io.assignmentDiagnosticContext }),
        ...(io.functionCommandLines === undefined ? {} : { functionCommandLines: io.functionCommandLines }),
        ...(io.diagnosticCommandLines === undefined ? {} : { diagnosticCommandLines: io.diagnosticCommandLines }),
        ...(io.scriptName === undefined ? {} : { scriptName: io.scriptName }),
        ...(io.substitutionDiagnosticLine === undefined ? {} : { substitutionDiagnosticLine: io.substitutionDiagnosticLine }),
        ...(io.substitutionDiagnosticLines === undefined ? {} : { substitutionDiagnosticLines: io.substitutionDiagnosticLines }),
        ...(io.processSubstitutions === undefined ? {} : { processSubstitutions: io.processSubstitutions }),
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
          if (error instanceof ExpansionFailure) throw new PublicDiagnostic(error.message);
          throw error;
        }
        if (hereString) {
          if (shellValueByteLength(value) >= this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
          value = concatShellValues([value, "\n"], io[valueScope]);
        }
        const prepared = prepareBytesInput(typeof value === "string" ? value : shellValueBytes(value, io[valueScope]), this.budget);
        const input = new ShellInput(prepared.source, this.budget, this.commandSignal, prepared.options);
        const lifetime = new DescriptorLifetime(async () => { try { await input.close(); } finally { await prepared.close(); } });
        inputs.add({ close: () => lifetime.release() });
        io[invocationScope].register(() => lifetime.release());
        await replaceDescriptor(redirect.descriptor, { input, stdinIsDefault: false, lifetime });
        continue;
      }
      const targets = await this.word(redirect.target, state, currentIO());
      if (targets.length !== 1) throw new PublicDiagnostic("Ambiguous redirect");
      const target = targets[0]!;
      errorTarget = target;
      const bothOutput = redirect.operator === "&>" || redirect.operator === "&>>"
        || redirect.operator === ">&" && !redirect.explicitDescriptor && target !== "-" && !/^\d+-?$/u.test(target);
      if (redirect.operator.endsWith("&") && !bothOutput) {
        if (target === "-") await replaceDescriptor(redirect.descriptor);
        else {
          if (!/^\d+-?$/u.test(target)) throw new PublicDiagnostic(`${target}: Bad file descriptor`);
          const move = target.endsWith("-");
          if (move && !redirect.move) throw new PublicDiagnostic(`${target}: ambiguous redirect`);
          const sourceDescriptor = Number(move ? target.slice(0, -1) : target);
          const descriptor = descriptors.get(sourceDescriptor);
          if (!descriptor || descriptor.closed || (!move && (redirect.operator === "<&" ? !descriptor.input : !descriptor.output))) throw new PublicDiagnostic(`${move ? sourceDescriptor : target}: Bad file descriptor`);
          const pipe = descriptor.pipe && references.acquire(descriptor.pipe);
          await replaceDescriptor(redirect.descriptor, { ...descriptor, ...(pipe ? { pipe } : {}) });
          if (move && sourceDescriptor !== redirect.descriptor) {
            descriptors.delete(sourceDescriptor);
            if (descriptor.pipe && (references.references.has(descriptor.pipe) || persistMoves && !replaced.has(sourceDescriptor))) await descriptor.pipe.close();
            if (persistMoves && !replaced.has(sourceDescriptor)) descriptor.closed = true;
          }
        }
      } else {
        const path = pathOf(state, target);
        const options = { signal: this.commandSignal };
        if (redirect.operator === "<" || redirect.operator === "<>") {
          const readwrite = redirect.operator === "<>";
          if (!readwrite) await interruptible(this.fs.access(path, 4, options), this.signal);
          const stat = readwrite ? undefined : await interruptible(this.fs.stat(path, options), this.signal);
          if (stat?.type === "directory" && !fileShortcut) throw new PublicDiagnostic(`${target}: Is a directory`);
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
          const prepared = stat?.type === "directory" ? prepareBytesInput("", this.budget)
            : await prepareFileInput({ fs: resourceFs, signal: this.commandSignal, readwrite, cleanupFailurePrioritySignal: this.budget.signal, registerCleanup: close => {
              cleanups.push(close);
            } }, path, this.budget, this.inputProfile, stat);
          if (!cleanups.includes(prepared.close)) cleanups.push(prepared.close);
          io[invocationScope].assertOpen();
          const input = new ShellInput(prepared.source, this.budget, this.commandSignal, prepared.options);
          inputOwner.input = input;
          const file = prepared.options.descriptor;
          const output = readwrite && file ? this.budget.sink({ async write(chunk) {
            let offset = 0;
            while (offset < chunk.length) {
              const written = await file.write(chunk.subarray(offset), null, options);
              if (written === 0) throw new FsError("EIO", { path, syscall: "write" });
              offset += written;
            }
          } }, this.commandSignal) : undefined;
          await replaceDescriptor(redirect.descriptor, { input, stdinIsDefault: false, lifetime, ...(file ? { file } : {}), ...(output ? { output } : {}) });
        } else {
          const append = redirect.operator === ">>" || redirect.operator === "&>>";
          const flag = append ? "a" : state.noclobber && redirect.operator !== ">|" ? "wx" : "w";
          const capabilities = await this.fs.capabilitiesFor?.(path, { ...options, ...(flag === "wx" ? { creation: "exclusive" as const } : {}) }) ?? this.fs.capabilities;
          const streaming = capabilities.preferStreamingRedirection === true && typeof this.fs.writeStream === "function"
            && (append ? capabilities.streamingAppend ?? capabilities.streamingWrite : capabilities.streamingWrite) === true;
          const canonical = capabilities.open === true && !streaming;
          const random = capabilities.randomAccessWrite === true && !streaming;
          const key = resolvePath(state.cwd, path);
          let file!: OutputFile;
          if (!canonical) await this.fileOperation(key, async () => {
            file = this.outputFiles.get(key) ?? { data: undefined, references: 0 };
            if (!random && capabilities.independentWriteStreams !== true && file.references) throw new FsError("ENOTSUP", { path, message: "Conflicting sequential output descriptors" });
            file.references++;
            this.outputFiles.set(key, file);
          });
          let closed = false;
          let offset = 0;
          const incremental = async (): Promise<ByteSink> => {
            await this.fileOperation(key, async () => {
              if (append) await resourceFs.appendFile(path, new Uint8Array(), options);
              else await resourceFs.writeFile(path, new Uint8Array(), { ...options, flag: "w" });
              if (!append) file.data = new Uint8Array();
            });
            return { write: (chunk) => {
              const copy = new Uint8Array(chunk);
              return this.fileOperation(key, async () => {
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
                  await resourceFs.appendFile(path, copy, options);
                  file.data = bytes;
                } else {
                  const bytes = new Uint8Array(Math.max(current?.length ?? 0, offset + copy.length));
                  if (current) bytes.set(current);
                  bytes.set(copy, offset);
                  await resourceFs.writeFile(path, bytes, options);
                  file.data = bytes;
                }
                if (!append) offset += copy.length;
              });
            } };
          };
          this.budget.beginPathLookupSuspension();
          const release = (): void => {
            if (closed) return;
            closed = true;
            this.budget.endPathLookupSuspension();
            if (canonical) return;
            if (--file.references === 0 && this.outputFiles.get(key) === file) this.outputFiles.delete(key);
          };
          let target;
          let outputScope: InvocationScope | undefined;
          const retireOutputCleanups: (() => void)[] = [];
          let outputOwner = io[invocationScope];
          while (outputOwner.parent) outputOwner = outputOwner.parent;
          try {
            if (!canonical) outputScope = new InvocationScope(this.commandSignal, io[invocationScope].failures);
            const context = { fs: resourceFs, signal: this.commandSignal, cleanupFailurePrioritySignal: this.budget.signal, registerCleanup: (cleanup: () => void | Promise<void>) => {
              const retire = (canonical ? outputOwner : outputScope!).register(cleanup);
              if (canonical) retireOutputCleanups.push(retire);
            } };
            if (canonical) bindFileOutputBudget(context, sink => this.budget.sink(sink, this.commandSignal), (chunk, write, preserveReceipt) => this.budget.writeCounted(chunk, write, this.commandSignal, preserveReceipt));
            target = await openFileOutput(context, path, { flag, ...(canonical ? { descriptor: true } : {}) }, !canonical && random && flag !== "wx" ? incremental : undefined);
          } catch (error) {
            try { await outputScope?.close(); }
            finally { release(); }
            if (flag === "wx" && error instanceof FsError && error.code === "EEXIST") throw new PublicDiagnostic(`${errorTarget}: cannot overwrite existing file`);
            throw error;
          }
          const finalize: OutputFinalizer = async completion => {
            try {
              if (this.commandSignal.aborted) await target.abort(this.commandSignal.reason);
              else if ("reason" in completion) await target.abort(completion.reason);
              else {
                try {
                  await target.finish();
                  for (const retire of retireOutputCleanups) retire();
                }
                catch (error) {
                  this.signal.throwIfAborted();
                  if (completion.status === 0 || target.descriptor && !target.signal.aborted) throw error;
                }
              }
            } finally {
              try { await outputScope?.close(); }
              finally { release(); }
            }
          };
          let completion: Parameters<OutputFinalizer>[0] | undefined;
          const lifetime = new DescriptorLifetime(() => finalize(completion ?? { status: 0 }));
          const ownerFinalize: OutputFinalizer = value => { completion ??= value; return lifetime.release(); };
          outputs.add(Object.assign(ownerFinalize, target.descriptor ? { descriptor: target.descriptor } : {}));
          const output = canonical ? target.sink : this.budget.sink(target.sink, this.commandSignal);
          if (canonical) budgetedSinks.set(output, { budget: this.budget, write: output.write });
          budgetedSinks.get(output)!.file = Object.freeze({ path });
          const binding: Descriptor = { output, lifetime, ...(target.descriptor ? { file: target.descriptor } : {}) };
          await replaceDescriptor(redirect.descriptor, binding);
          if (bothOutput) {
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
    const cached = assignmentCache.get(word);
    if (cached !== undefined) return cached ?? undefined;
    const first = word.parts[0];
    if (first?.kind !== "text" || first.quoted) {
      assignmentCache.set(word, null);
      return undefined;
    }
    const match = /^([a-zA-Z_][a-zA-Z_0-9]*)(\+?)=/u.exec(first.value);
    if (!match) {
      assignmentCache.set(word, null);
      return undefined;
    }
    const result = { name: match[1]!, append: match[2] === "+", value: { offset: word.offset, parts: [{ ...first, value: first.value.slice(match[0].length) }, ...word.parts.slice(1)] } };
    assignmentCache.set(word, result);
    return result;
  }

  async simple(
    command: Extract<Command, { kind: "simple" }>,
    state: State,
    originalIO: IO,
    inputs: Set<{ close(): void | Promise<void> }>,
    outputs: Set<OutputFinalizer>,
    snapshotHolder: { scope?: InvocationScope; finish?: () => void },
    fileShortcut = false,
    terminal?: IO["terminal"],
  ): Promise<number> {
    state.substitutionStatus = 0;
    const firstAssignment = command.words.length > 0 ? (getArrayAssignment(command.words[0]!) ?? this.assignment(command.words[0]!)) : undefined;
    if (!firstAssignment && command.redirects.length === 0 && !fileShortcut) {
      const commandWords = command.words;
      let declarationIndex = 0;
      if (commandWords.length > 0) {
        while ((commandWords[declarationIndex]?.plain === "command" || commandWords[declarationIndex]?.plain === "builtin") && !state.extensions?.builtins.has(commandWords[declarationIndex]!.plain!)) {
          declarationIndex++;
          if (commandWords[declarationIndex]?.plain === "--") declarationIndex++;
        }
      }
      const declarationName = commandWords[declarationIndex]?.plain ?? "";
      const declarationBuiltin = declarationName ? state.extensions?.builtins.get(declarationName) : undefined;
      const declaration = declarationBuiltin ? declarationBuiltin.expansion === "declaration" : ["export", "declare", "typeset", "local", "readonly"].includes(declarationName);
      if (!declaration) {
        try {
          const wordValues = commandWords.length > 0
            ? (this.fastValueWords(commandWords, state, originalIO, false, false) ?? await this.valueWords(commandWords, state, originalIO, false, false, undefined, declarationIndex + 1))
            : emptyShellValues;
          let allStrings = true;
          for (let i = 0; i < wordValues.length; i++) {
            if (typeof wordValues[i] !== "string") {
              allStrings = false;
              break;
            }
          }
          const words = wordValues.length > 0 ? (allStrings ? (wordValues as readonly string[]) : wordValues.map(shellValueText)) : emptyStrings;
          const special = state.profile === "sh" && (specialBuiltinNames.has(words[0] ?? "") || !!state.extensions?.builtins.get(words[0] ?? "")?.special);
          if (terminal) {
            terminal.io = originalIO;
            await terminal.frame.reconcile(originalIO.descriptors!);
          }
          const rawState = stateMonitor(state)?.raw ?? state;
          if (!state._readOnlyStage && rawState.variables._ !== undefined) delete rawState.variables._;
          rawState.lastArgument = words.length > 0 ? words[words.length - 1]! : "";
          state.lastArgument = rawState.lastArgument;
          if (!words.length) return state.substitutionStatus;
          const args = words.slice(1);
          const argValues = allStrings ? args : wordValues.slice(1);
          try {
            return await this.dispatch(wordValues[0]!, args, state, originalIO, emptySavedVariables, false, argValues, emptySavedVariables);
          } catch (error) {
            if (error instanceof Flow) {
              if ((error.kind === "break" || error.kind === "continue" || error.kind === "return") && originalIO.assignmentDiagnosticContext) originalIO.assignmentDiagnosticContext.name = undefined;
              throw error;
            }
            this.signal.throwIfAborted();
            const original = error instanceof ExecutionFailure ? error.original : error;
            if (special && !(original instanceof ShellLimitError) && !(original instanceof ExpansionFailure) && !(original instanceof Flow) && !(original instanceof ShellSyntaxError)) {
              throw new ExecutionFailure(new FatalCommandFailure(message(original, this.budget.onInternalError), 1), error instanceof ExecutionFailure ? error.io : originalIO, error instanceof ExecutionFailure ? error.diagnostic : undefined);
            }
            if (error instanceof ExecutionFailure) throw error;
            throw new ExecutionFailure(error, originalIO);
          }
        } catch (error) {
          if (error instanceof Flow) {
            if ((error.kind === "break" || error.kind === "continue" || error.kind === "return") && originalIO.assignmentDiagnosticContext) originalIO.assignmentDiagnosticContext.name = undefined;
            throw error;
          }
          this.signal.throwIfAborted();
          if (error instanceof ExecutionFailure) throw error;
          throw new ExecutionFailure(error, originalIO);
        }
      }
    }
    return this.simpleWithSetup(command, state, originalIO, inputs, outputs, snapshotHolder, fileShortcut, terminal);
  }

  private async simpleWithSetup(
    command: Extract<Command, { kind: "simple" }>,
    state: State,
    originalIO: IO,
    inputs: Set<{ close(): void | Promise<void> }>,
    outputs: Set<OutputFinalizer>,
    snapshotHolder: { scope?: InvocationScope; finish?: () => void },
    fileShortcut = false,
    terminal?: IO["terminal"],
  ): Promise<number> {
    const assignments: ({ name: string; value: Word; append: boolean; kind?: undefined } | ArrayAssignment)[] = [];
    let wordIndex = 0;
    for (; wordIndex < command.words.length; wordIndex++) {
      const assignment = getArrayAssignment(command.words[wordIndex]!) ?? this.assignment(command.words[wordIndex]!);
      if (!assignment) break;
      assignments.push(assignment);
    }
    const commandWords = wordIndex === 0 ? command.words : wordIndex === command.words.length ? emptyWords : command.words.slice(wordIndex);
    let declarationIndex = 0;
    if (commandWords.length > 0) {
      while ((commandWords[declarationIndex]?.plain === "command" || commandWords[declarationIndex]?.plain === "builtin") && !state.extensions?.builtins.has(commandWords[declarationIndex]!.plain!)) {
        declarationIndex++;
        if (commandWords[declarationIndex]?.plain === "--") declarationIndex++;
      }
    }
    const declarationName = commandWords[declarationIndex]?.plain ?? "";
    const declarationBuiltin = declarationName ? state.extensions?.builtins.get(declarationName) : undefined;
    const declaration = declarationBuiltin ? declarationBuiltin.expansion === "declaration" : ["export", "declare", "typeset", "local", "readonly"].includes(declarationName);
    const indexedDeclaration = declaration && ["declare", "typeset", "local", "readonly"].includes(declarationName);
    const compounds = indexedDeclaration && declarationName !== "readonly" ? new Map<number, ArrayAssignment>() : undefined;
    const wordValues = commandWords.length > 0
      ? (this.fastValueWords(commandWords, state, originalIO, declaration, indexedDeclaration) ?? await this.valueWords(commandWords, state, originalIO, declaration, indexedDeclaration, compounds, declarationIndex + 1))
      : emptyShellValues;
    const allStrings = wordValues.length === 0 || wordValues.every(value => typeof value === "string");
    const words = wordValues.length > 0 ? (allStrings ? (wordValues as readonly string[]) : wordValues.map(shellValueText)) : emptyStrings;
    const special = state.profile === "sh" && (specialBuiltinNames.has(words[0] ?? "") || !!state.extensions?.builtins.get(words[0] ?? "")?.special);
    const inlineInput = command.redirects.some((redirect) => redirect.document || redirect.operator === "<<<");
    const functionCommand = words.length > 0 && state.functions.has(words[0]!);
    const isolatedInlineInput = inlineInput && words.length > 0 && !shellBuiltinNames.has(words[0]!) && !state.extensions?.builtins.has(words[0]!) && !functionCommand;
    const snapshotScope = isolatedInlineInput ? (() => {
      const s = originalIO[invocationScope].child();
      snapshotHolder.scope = s;
      void s.run(() => new Promise<void>(resolve => { snapshotHolder.finish = resolve; }));
      return s;
    })() : undefined;
    let io = snapshotScope ? { ...originalIO, [invocationScope]: snapshotScope } : originalIO;
    const previous = words.length > 0 ? (assignments.length > 0 || declaration ? new Map<string, SavedVariable>() : emptySavedVariables) : undefined;
    const assign = async () => {
      for (const original of assignments) {
        const refName = this.referenceName(state, original.name);
        const assignment = refName === original.name ? original : { ...original, name: refName };
        const target = !assignment.kind && !assignment.name.includes("[") ? { name: assignment.name } : this.variableTarget(assignment.name)!;
        if (!assignment.kind && target.subscript !== undefined) {
          await this.arrayAssignment({ kind: "element", name: target.name, append: assignment.append,
            index: stringIndex(target.subscript, this.budget.parsing, parseArraySubscript(target.subscript, this.budget.parsing, byteLocale(state.variables), state.depth)),
            value: assignment.value }, state, io);
          continue;
        }
        if (assignment.kind) { await this.arrayAssignment(assignment, state, io); continue; }
        if (!words.length && arrayStore(state)?.get(assignment.name)) {
          await this.arrayZero(state, assignment.name, io, async () => {
            const fields = await this.valueWord(assignment.value, state, io, false, false, false, false, undefined, false, false, 0);
            return this.arrayJoin(requireArrays(state).owner, fields, "");
          }, assignment.append);
          continue;
        }
        const fastAssigned = this.fastValueWord(assignment.value, state, io, false, false, false, false, 0);
        let value = fastAssigned !== undefined
          ? fastAssigned
          : concatShellValues(await this.valueWord(assignment.value, state, io, false, false, false, false, undefined, false, false, 0), io[valueScope]);
        if (assignment.append) {
          value = state.variableAttributes?.get(assignment.name)?.includes("i")
            ? concatShellValues([`(${state.variables[assignment.name] || "0"})+(`, value, ")"], io[valueScope])
            : concatShellValues([stateMonitor(state)?.values.get(assignment.name, state.variables[assignment.name] ?? "") ?? state.variables[assignment.name] ?? "", value], io[valueScope]);
        }
        if (state.readonlyVariables?.has(assignment.name)) {
          await this.diagnostic(io, `${assignment.name}: readonly variable`);
          if (state.profile === "sh" || !words.length) throw new Flow("exit", state.profile === "sh" && (special || !words.length) ? 127 : 1);
          continue;
        }
        if (previous && !previous.has(assignment.name)) {
          const saved = saveVariable(state, assignment.name);
          previous.set(assignment.name, saved);
          if (words.length && (guestArrays(state) || (assignment.name === "PIPESTATUS" && arrayStore(state)?.get(assignment.name)))) {
            const store = requireArrays(state);
            await this.prepareVariable(state, assignment.name, saved, !store.get(assignment.name));
            if (store.get(assignment.name)) {
              const publication = store.tickets(assignment.name);
              await store.remove(assignment.name, publication);
              publication.release();
            }
          }
        }
        await this.writeVariable(state, assignment.name, value, io);
        if (words.length) state.exported.add(assignment.name);
      }
    };
    let overlayOpen = false;
    try {
      if (snapshotScope) state = await cloneState(state, this.signal, snapshotScope);
      if (words.length && assignments.length > 0) {
        stateMonitor(state)?.openOverlay(previous!);
        overlayOpen = true;
      }
      if (inlineInput || (state.profile === "sh" || !words.length) && assignments.some(assignment => state.readonlyVariables?.has(assignment.name))) await assign();
      if (inlineInput && functionCommand && previous?.size) {
        if (stateMonitor(state)?.lazyPipeStatus !== undefined) stateMonitor(state)!.activate(true);
        const redirectState = tryCloneStateSync(state) ?? await cloneState(state, this.signal);
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
      if (!inlineInput && assignments.length > 0) await assign();
      if (fileShortcut) {
        const input = io.descriptors?.get(command.redirects[0]!.descriptor)?.input;
        if (!input) throw new PublicDiagnostic("Bad file descriptor");
        await pipeBytes(input, io.stdout, this.signal);
        return 0;
      }
      if (!snapshotScope) {
        const rawState = stateMonitor(state)?.raw ?? state;
        if (!assignments.some(assignment => assignment.name === "_")) delete rawState.variables._;
        rawState.lastArgument = words.length > 0 ? words[words.length - 1]! : "";
        state.lastArgument = rawState.lastArgument;
      }
      if (!words.length) return state.substitutionStatus;
      const args = words.slice(1);
      const argValues = allStrings ? args : wordValues.slice(1);
      const dispatchIO = compounds ? { ...io, [declarationArrays]: compounds } : io;
      return await this.dispatch(wordValues[0]!, args, state, dispatchIO, previous!, false, argValues, previous!);
    } catch (error) {
      if (error instanceof Flow) {
        if ((error.kind === "break" || error.kind === "continue" || error.kind === "return") && io.assignmentDiagnosticContext) io.assignmentDiagnosticContext.name = undefined;
        throw error;
      }
      this.signal.throwIfAborted();
      const original = error instanceof ExecutionFailure ? error.original : error;
      if (special && !(original instanceof ShellLimitError) && !(original instanceof ExpansionFailure) && !(original instanceof Flow) && !(original instanceof ShellSyntaxError)) {
        throw new ExecutionFailure(new FatalCommandFailure(message(original, this.budget.onInternalError), 1), error instanceof ExecutionFailure ? error.io : io, error instanceof ExecutionFailure ? error.diagnostic : undefined);
      }
      if (error instanceof ExecutionFailure) throw error;
      throw new ExecutionFailure(error, io);
    } finally {
      if (overlayOpen) {
        for (const [key, saved] of previous!) await originalIO[invocationScope].cleanup(async () => {
          if (saved.superseded) await this.discardVariable(saved);
          else await restoreVariable(state, key, saved);
        });
        await originalIO[invocationScope].cleanup(() => stateMonitor(state)?.closeOverlay(previous!));
      } else if (previous) {
        for (const saved of previous.values()) saved.heldValue?.release();
      }
    }
  }

  getContextFsForFast(umask: number, signal: AbortSignal): FileSystem {
    return this.getContextFsFor(umask, signal);
  }

  createShellPredicatesForFast(state: State, io: IO): NonNullable<CommandContext["shellPredicates"]> {
    const predicates: NonNullable<CommandContext["shellPredicates"]> = {
      variable: name => this.variable(state, name) !== undefined,
      reference: name => state.variableAttributes?.get(name)?.includes("n") ?? false,
      option: name => {
        const extension = state.extensions?.options.get(name);
        if (extension) return extension.enabled;
        if (name === "braceexpand") return state.braceexpand !== false;
        if (name === "allexport") return !!state.allexport;
        if (["errexit", "noclobber", "noglob", "noexec", "nounset", "pipefail"].includes(name)) return !!state[name as "nounset"];
        return false;
      },
      terminal: () => false,
    };
    variablePresence.set(predicates, name => this.variablePresent(state, name, io));
    return predicates;
  }

  createInputBudgetForFast(): NonNullable<CommandContext["inputBudget"]> {
    return {
      maxBytes: this.budget.limits.maxInputBytes,
      check: totalBytes => {
        this.commandSignal.throwIfAborted();
        if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) throw new RangeError("Input byte total must be a nonnegative safe integer");
        if (totalBytes > this.budget.limits.maxInputBytes) this.budget.fail("maxInputBytes");
      },
    };
  }

  invokeFromFastContext(
    name: string,
    args: readonly string[],
    options: Parameters<ShellCommandContext["invoke"]>[2],
    context: ShellCommandContext,
    state: State,
    scope: InvocationScope,
  ): Promise<CommandResult> {
    const invRuntime = new Runtime(
      this.sourceFs, this.commands, this.middleware, this.budget,
      this.signal, this.fileWrites, this.outputFiles, this.commandSignal,
      this.cancellation, this.cancellationState, this.cancellationOwner,
      this.cancellationDepth, this.cancellationMaxDepth, this.outcomeFrame, this.inputProfile,
    );
    const invocation = invRuntime.invoke(name, args, options, context, state, scope);
    void invocation.catch(() => undefined);
    return invocation;
  }

  private async dispatchFastCommand(
    name: string,
    definition: NonNullable<ReturnType<CommandRegistry["get"]>>,
    values: readonly ShellValue[],
    state: State,
    io: IO,
    scope: InvocationScope,
  ): Promise<number> {
    this.budget.values.assertOpen();
    const env = Object.create(null) as Record<string, string>;
    for (const key of state.exported) {
      const value = state.variables[key];
      if (value !== undefined) env[key] = value;
    }
    if (state.exportedFunctions) {
      for (const key of state.exportedFunctions) {
        const body = state.functions.get(key);
        if (body) env[`BASH_FUNC_${key}%%`] = functionDisplay(key, body).slice(key.length + 1).trimEnd();
      }
    }
    const context = new FastShellCommandContext(this, state, io, scope, name, values as readonly string[], undefined, env, this._isMemoryBackingFs);
    const runtimeFrame: RuntimeOutcomeFrame = {};
    scope.enterWork();
    this.budget.beginPathLookupSuspension();
    try {
      scope.assertOpen();
      const raw = definition.execute(context as unknown as ShellCommandContext);
      const observed = this.observeRuntimeReturn(raw, runtimeFrame);
      const res = await interruptible(observed, this.signal);
      return validateExitCode(res.exitCode);
    } catch (error) {
      if (runtimeFrame.report && Object.is(runtimeFrame.report.origin.signal.reason, error) && this.outcomeFrame) {
        this.outcomeFrame.report = runtimeFrame.report;
      }
      throw error;
    } finally {
      this.budget.endPathLookupSuspension();
      scope.leaveWork();
    }
  }

  async dispatch(name: ShellValue, args: readonly string[], state: State, io: IO, assignments: Map<string, SavedVariable>, bypassFunctions = false, values: readonly ShellValue[] = args, temporaryEnvironment?: ReadonlyMap<string, SavedVariable>, defaultPath = false): Promise<number> {
    if (
      !state.externalInvocation &&
      this.middleware.length === 0 &&
      typeof name === "string" &&
      !state.extensions?.builtins.has(name) &&
      !(!bypassFunctions && state.functions.has(name)) &&
      (values === args || !values.some(value => typeof value !== "string"))
    ) {
      if (name === "[" || name === "test") {
        const def = this.commands.get(name);
        if (def && defaultPredicateExecutors.has(def.execute)) {
          const fastStatus = tryFastPredicate(name, args);
          if (fastStatus !== undefined) return fastStatus;
        }
      } else if (name === ":") {
        if (state.profile === "sh" && !bypassFunctions) assignments.clear();
        return 0;
      } else if (name === "true") {
        return 0;
      } else if (name === "false") {
        return 1;
      } else if (name === "echo" && (args.length === 0 || !args[0]!.startsWith("-"))) {
        const def = this.commands.get("echo");
        if (def && defaultEchoExecutors.has(def.execute)) {
          const text = args.length === 0 ? "\n" : args.length === 1 ? `${args[0]!}\n` : `${args.join(" ")}\n`;
          const targetSink = io.descriptors?.get(1)?.output ?? io.stdout;
          await writeBytes(targetSink, fastSharedTextEncoder.encode(text), this.commandSignal);
          return 0;
        }
      }
    }
    const scope = io[invocationScope].child();
    const externalDef = typeof name === "string" ? this.getExternalCommand(name) : undefined;
    const fastInline =
      !state.externalInvocation &&
      this.middleware.length === 0 &&
      typeof name === "string" &&
      (!externalDef || (!customRegisteredCommands.has(externalDef.execute) && !customRegisteredRegistries.has(this.commands))) &&
      !(!bypassFunctions && state.functions.has(name)) &&
      !state.extensions?.builtins.has(name) &&
      name !== "." && name !== "source" && name !== "eval" && name !== "command" && name !== "builtin" && name !== "type" && name !== "read" && name !== "mapfile" && name !== "readarray";
    if (
      fastInline &&
      externalDef !== undefined &&
      values.every(value => typeof value === "string") &&
      !implementedBuiltins.has(name) &&
      !(name === "printf" && externalDef.execute === printfCommand.execute && args[0]?.startsWith("-v"))
    ) {
      try {
        return await this.dispatchFastCommand(name, externalDef, values, state, io, scope);
      } finally {
        await scope.close();
      }
    }
    const runtime = fastInline
      ? this
      : new Runtime(
          this.sourceFs, this.commands, this.middleware, this.budget,
          combineManagedSignals(this.signal, scope.signal), this.fileWrites, this.outputFiles, this.commandSignal,
          this.cancellation, this.cancellationState, this.cancellationOwner,
          this.cancellationDepth, this.cancellationMaxDepth, this.outcomeFrame, this.inputProfile,
        );
    try { return await runtime.dispatchScoped(name, values, state, { ...io, [invocationScope]: scope }, assignments, bypassFunctions, temporaryEnvironment, defaultPath, !fastInline || this._isMemoryBackingFs); }
    finally { await scope.close(); }
  }

  private async dispatchScoped(nameValue: ShellValue, values: readonly ShellValue[], state: State, io: IO, assignments: Map<string, SavedVariable>, bypassFunctions: boolean, temporaryEnvironment?: ReadonlyMap<string, SavedVariable>, defaultPath = false, signalIsScoped = false): Promise<number> {
    const { [invocationScope]: scope, [valueScope]: _vs, [declarationArrays]: _da, argumentValues: _av, ...publicIO } = io as IO & { argumentValues?: unknown };
    const allocation = this.budget.values.scope();
    try {
    if (typeof nameValue !== "string") allocation.hold(nameValue);
    const name = shellValueText(nameValue);
    let currentName = nameValue;
    const readName = (): string => shellValueText(currentName);
    const argumentValues = this.admitArguments(values, allocation);
    let allStrings = true;
    for (let i = 0; i < argumentValues.values.length; i++) {
      if (typeof argumentValues.values[i] !== "string") { allStrings = false; break; }
    }
    let builtinFailure: { error: unknown; diagnostic: string } | undefined;
    const hasMiddleware = this.middleware.length > 0;
    const env = Object.create(null) as Record<string, string>;
    for (const key of state.exported) {
      const value = state.variables[key];
      if (value !== undefined) env[key] = value;
    }
    if (state.exportedFunctions) {
      for (const key of state.exportedFunctions) {
        const body = state.functions.get(key);
        if (body) env[`BASH_FUNC_${key}%%`] = functionDisplay(key, body).slice(key.length + 1).trimEnd();
      }
    }
    const initialEnv = hasMiddleware ? { ...env } : env;
    const runtimeFrame: RuntimeOutcomeFrame = {};
    let scopedSignal: AbortSignal | undefined = signalIsScoped ? this.signal : undefined;
    const getScopedSignal = (): AbortSignal => (scopedSignal ??= combineManagedSignals(this.signal, scope.signal));
    let contextFs: FileSystem | undefined;
    const getContextFs = (): FileSystem => {
      if (!contextFs) {
        contextFs = this.getContextFsFor(state.umask ?? 0o022, getScopedSignal());
      }
      return contextFs;
    };
    let cachedPredicates: NonNullable<CommandContext["shellPredicates"]> | undefined;
    let cachedInputBudget: NonNullable<CommandContext["inputBudget"]> | undefined;
    const getShellPredicates = (): NonNullable<CommandContext["shellPredicates"]> => {
      if (!cachedPredicates) {
        cachedPredicates = {
          variable: name => this.variable(state, name) !== undefined,
          reference: name => state.variableAttributes?.get(name)?.includes("n") ?? false,
          option: name => {
            const extension = state.extensions?.options.get(name);
            if (extension) return extension.enabled;
            if (name === "braceexpand") return state.braceexpand !== false;
            if (name === "allexport") return !!state.allexport;
            if (["errexit", "noclobber", "noglob", "noexec", "nounset", "pipefail"].includes(name)) return !!state[name as "nounset"];
            return false;
          },
          // Shell byte streams and virtual descriptors have no terminal capability.
          terminal: () => false,
        };
        variablePresence.set(cachedPredicates, name => this.variablePresent(state, name, io));
      }
      return cachedPredicates;
    };
    const getInputBudget = (): NonNullable<CommandContext["inputBudget"]> => (cachedInputBudget ??= {
      maxBytes: this.budget.limits.maxInputBytes,
      check: totalBytes => {
        this.commandSignal.throwIfAborted();
        if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) throw new RangeError("Input byte total must be a nonnegative safe integer");
        if (totalBytes > this.budget.limits.maxInputBytes) this.budget.fail("maxInputBytes");
      },
    });
    const context: ShellCommandContext = {
      ...publicIO, command: name, args: argumentValues.args, ...(allStrings ? {} : { argumentValues }), env, cwd: state.cwd,
      get shellPredicates(): NonNullable<CommandContext["shellPredicates"]> { return getShellPredicates(); },
      set shellPredicates(replacement: NonNullable<CommandContext["shellPredicates"]>) { cachedPredicates = replacement; },
      get fs() { return getContextFs(); },
      set fs(replacement: FileSystem) { contextFs = replacement; },
      signal: this.commandSignal,
      executionScope: this.budget.executionScope,
      onInternalError: this.budget.onInternalError,
      get inputBudget(): NonNullable<CommandContext["inputBudget"]> { return getInputBudget(); },
      set inputBudget(replacement: NonNullable<CommandContext["inputBudget"]>) { cachedInputBudget = replacement; },
      registerCleanup: (cleanup) => { scope.register(cleanup); },
      invoke: (name, args, options) => {
        const invRuntime = new Runtime(
          this.sourceFs, this.commands, this.middleware, this.budget,
          this.signal, this.fileWrites, this.outputFiles, this.commandSignal,
          this.cancellation, this.cancellationState, this.cancellationOwner,
          this.cancellationDepth, this.cancellationMaxDepth, this.outcomeFrame, this.inputProfile,
        );
        const invocation = invRuntime.invoke(name, args, options, context, state, scope);
        void invocation.catch(() => undefined);
        return invocation;
      },
    };
    // The lazy snapshot getter has its own receiver; retain the invocation runtime.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const workerRuntime = this;
    workerRuntimeContexts.set(context, {
      budget: this.budget, umask: state.umask ?? 0o022,
      ignoredSignals: captureIgnoredTrapSignals(state.extensions),
      get fs() { return workerRuntime.getContextFsForFast(0, getScopedSignal()); },
    });
    if (typeof nameValue !== "string") Object.defineProperty(context, "command", {
      configurable: true, enumerable: true, get: readName,
      set(replacement: string) { currentName = replacement; },
    });
    bindCommandIO(context, io);
    bindFileOutputBudget(context, sink => this.budget.sink(sink, getScopedSignal()), (chunk, write) => this.budget.writeCounted(chunk, write, getScopedSignal()));
    const middleware = hasMiddleware ? this.middleware.map<Middleware>((handler) => (context, next) => {
      scope.assertOpen();
      this.budget.pathLookup.suspendUntilClosed(scope);
      let downstream: Promise<CommandResult> | undefined;
      const raw = handler(context, () => {
        downstream = next();
        return downstream;
      });
      return this.observeRuntimeReturn(raw, runtimeFrame, () => downstream);
    }) : [];
    const terminalHandler = (forwarded: CommandContext): Promise<CommandResult> => scope.run(async () => {
      scope.assertOpen();
      const commandName = !hasMiddleware && typeof nameValue === "string" ? name : (Object.getOwnPropertyDescriptor(forwarded, "command")?.get === readName ? currentName : forwarded.command);
      const forwardedValues = hasMiddleware ? getCommandArguments(forwarded) : argumentValues;
      const admitted = forwardedValues === argumentValues ? argumentValues : this.admitArguments(forwardedValues.values, allocation);
      const context = (hasMiddleware
        ? Object.create(Object.getPrototypeOf(forwarded), {
          ...Object.getOwnPropertyDescriptors(forwarded),
          ...Object.getOwnPropertyDescriptors({
            args: admitted.args,
            argumentValues: admitted,
            [invocationScope]: scope,
            ...(io[valueScope] === undefined ? {} : { [valueScope]: io[valueScope] }),
          }),
        })
        : forwarded) as ShellCommandContext & {
        args: readonly string[];
        argumentValues: CommandArguments;
        [invocationScope]: InvocationScope;
        [valueScope]?: ValueScope;
      };
      const ensureRuntimeContext = (): void => {
        if (!hasMiddleware && context[invocationScope] === undefined) {
          context.args = admitted.args;
          context.argumentValues = admitted;
          context[invocationScope] = scope;
          if (io[valueScope] !== undefined) context[valueScope] = io[valueScope];
        }
      };
      const previous = hasMiddleware ? new Map<string, SavedVariable & { overlay: string | undefined }>() : undefined;
      const cwd = state.cwd;
      const directoryStackCwdPublication = state.directoryStackCwdPublication;
      let cwdRestoration: Restoration | undefined;
      if (hasMiddleware) {
      const prevMap = previous!;
      const environmentKeys = new Set([...Object.keys(initialEnv), ...Object.keys(context.env)]);
      const typedEnvironment = [...environmentKeys].some(key => arrayStore(state)?.get(key) && initialEnv[key] !== context.env[key]);
      cwdRestoration = stateMonitor(state)?.restoration(true);
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
            prevMap.set(key, saved);
            publications.set(key, store.tickets(key));
          }
          const cwdPublication = store.tickets();
          for (const [key, saved] of prevMap) {
            if (state.readonlyVariables?.has(key)) throw new ArrayFailure("readonly environment collision");
            if (!typedSavedVariables.get(saved)!.watch.valid()) throw new ArrayFailure("stale binding");
          }
          this.signal.throwIfAborted();
          stateMonitor(state)!.publish(cwdPublication, undefined, () => { state.cwd = resolvePath("/", context.cwd); });
          cwdPublication.release();
          for (const [key, saved] of prevMap) {
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
          for (const saved of prevMap.values()) await this.discardVariable(saved);
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
        prevMap.set(key, { ...saveVariable(state, key), overlay: value });
        if (value === undefined) { delete state.variables[key]; state.exported.delete(key); }
        else { publishVariable(state, key, value); state.exported.add(key); }
        if (key === "OPTIND") this.reconcileGetopts(state, prevMap.get(key)!.value);
      }
      }
      stateMonitor(state)?.openOverlay(prevMap);
      }
      try {
        const selectedKind = this.firstInternalDiscovery(context.command, state, bypassFunctions);
        const body = selectedKind === "function" ? state.functions.get(context.command) : undefined;
        if (body) {
          ensureRuntimeContext();
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
              const rawState = stateMonitor(state)?.raw ?? state;
              (rawState.functionNames ??= []).unshift(context.command);
              if (rawState !== state) state.functionNames = rawState.functionNames;
            };
            if (frameOwner) {
              const tickets = frameOwner.reserve({ epoch: true, work: 8 });
              monitor!.publish(tickets, undefined, entry);
              tickets.release();
            } else entry();
          } catch (error) { savedPositionals.close(); getoptsRestoration?.close(); functionRestoration?.close(); throw error; }
          const callerLoopDepth = state.loopDepth;
          if (mapfileCallbackStates.has(state)) state.loopDepth = 0;
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
              state.loopDepth = callerLoopDepth;
              state.depth--;
              state.locals.pop();
              const rawState = stateMonitor(state)?.raw ?? state;
              rawState.functionNames?.shift();
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
        if (selectedKind === "builtin" && !(state.externalInvocation && this.commands.has(context.command))) {
          ensureRuntimeContext();
          const extensionBuiltin = state.extensions?.builtins.get(context.command);
          const special = state.profile === "sh" && !bypassFunctions && (specialBuiltinNames.has(context.command) || !!extensionBuiltin?.special);
          if (special) assignments.clear();
          if (extensionBuiltin) {
            const status = validateExitCode(await interruptible(Promise.resolve(extensionBuiltin.execute(this.extensionContext(state, { ...io, ...context }, context.command, context.args, context.argumentValues.values))), this.signal));
            if (special && status !== 0) throw new Flow("exit", status);
            return { exitCode: status };
          }
          if (context.command === "command" || context.command === "builtin" || context.command === "type") return { exitCode: await this.discoveryBuiltin(context, state, io, assignments, defaultPath) };
          if (context.command === "." || context.command === "source") return { exitCode: await this.sourceBuiltin(context, state, { ...io, ...context }, special) };
          if (context.command === "eval") return { exitCode: await this.evalBuiltin(context, state, { ...io, ...context }, special) };
          const builtinWork = this.builtin({ ...context, [declarationArrays]: io[declarationArrays] }, state, assignments, (error, diagnostic) => { builtinFailure = { error, diagnostic }; }, bypassFunctions);
          const builtin = await interruptible(builtinWork, this.signal);
          if (builtin !== undefined) {
            if (special && builtin !== 0 && context.command !== "shift") throw new Flow("exit", builtin);
            return { exitCode: builtin };
          }
        }
        const definition = this.getExternalCommand(context.command);
        if (context.command === "printf" && definition?.execute === printfCommand.execute && context.args[0]?.startsWith("-v")) {
          ensureRuntimeContext();
          return { exitCode: await this.printfVariable(context, state, assignments) };
        }
        if (!definition) {
          ensureRuntimeContext();
          if (context.command === "bash" || context.command === "sh") return { exitCode: await this.interpreter(context, state, io) };
          if (context.command.includes("/") || !defaultPath && state.variables.PATH === undefined && state.pathUnset) return { exitCode: await this.scriptFile(context, state, io, context.command, context.args, true) };
          const [target] = await this.searchPaths(context.command, state, false, false, defaultPath);
          if (target !== undefined) return { exitCode: await this.scriptFile(context, state, io, target, context.args, true) };
          const localeValue = (key: string) => temporaryEnvironment?.has(key) && !previous?.has(key)
            ? temporaryEnvironment.get(key)!.value ?? "" : state.variables[key] ?? "";
          const displayed = diagnosticCommandName(commandName, byteLocale({
            LC_ALL: localeValue("LC_ALL"), LC_CTYPE: localeValue("LC_CTYPE"), LANG: localeValue("LANG"),
          }), allocation);
          await this.diagnostic({ ...io, ...context }, concatShellValues([displayed, ": command not found"], allocation));
          return { exitCode: 127 };
        }
        this.budget.beginPathLookupSuspension();
        const executionContext = state.externalInvocation
          ? Object.create(Object.getPrototypeOf(forwarded), {
            ...Object.getOwnPropertyDescriptors(forwarded),
            externalInvocation: { value: true, configurable: true },
          }) as ShellCommandContext
          : forwarded;
        try {
          const raw = definition.execute(executionContext);
          const observed = this.observeRuntimeReturn(raw, runtimeFrame);
          return await interruptible(observed, this.signal);
        } finally {
          this.budget.endPathLookupSuspension();
        }
      } finally {
        if (hasMiddleware) {
        const prevMap = previous!;
        const restoreCwd = () => {
          if (context.command !== "cd" && state.cwd === context.cwd && state.directoryStackCwdPublication === directoryStackCwdPublication) state.cwd = cwd;
        };
        await scope.cleanup(() => {
          if (cwdRestoration) cwdRestoration.apply(restoreCwd, false);
          else restoreCwd();
        });
        for (const [key, saved] of prevMap) await scope.cleanup(async () => {
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
        await scope.cleanup(() => stateMonitor(state)?.closeOverlay(prevMap));
        await scope.cleanup(() => cwdRestoration?.close());
        }
      }
    });
    const execute = hasMiddleware ? composeMiddleware(middleware, terminalHandler) : terminalHandler;
    try { return validateExitCode((await interruptible(execute(context), this.signal)).exitCode); }
    catch (error) {
      if (builtinFailure && error === builtinFailure.error) throw new ExecutionFailure(error, io, builtinFailure.diagnostic);
      if (runtimeFrame.report && Object.is(runtimeFrame.report.origin.signal.reason, error) && this.outcomeFrame) {
        this.outcomeFrame.report = runtimeFrame.report;
      }
      throw error;
    }
    } finally {
      allocation.close();
    }
  }

  internalDiscovery(name: string, state: State, bypassFunctions = false): Discovery[] {
    const matches: Discovery[] = [];
    if (!bypassFunctions && state.functions.has(name)) matches.push({ kind: "function", name });
    if (implementedBuiltins.has(name) || state.extensions?.builtins.has(name)) matches.push({ kind: "builtin", name });
    else if (this.hasExternalCommand(name)) matches.push({ kind: "command", name });
    else if (name === "bash" || name === "sh") matches.push({ kind: "interpreter", name });
    if (state.profile === "sh" && (specialBuiltinNames.has(name) || state.extensions?.builtins.get(name)?.special)) matches.sort((left, right) => Number(right.kind === "builtin") - Number(left.kind === "builtin"));
    return matches;
  }

  firstInternalDiscovery(name: string, state: State, bypassFunctions = false): Discovery["kind"] | undefined {
    const isBuiltin = implementedBuiltins.has(name) || Boolean(state.extensions?.builtins.has(name));
    if (isBuiltin && state.profile === "sh" && (specialBuiltinNames.has(name) || state.extensions?.builtins.get(name)?.special)) {
      return "builtin";
    }
    if (!bypassFunctions && state.functions.has(name)) return "function";
    if (isBuiltin) return "builtin";
    if (this.hasExternalCommand(name)) return "command";
    if (name === "bash" || name === "sh") return "interpreter";
    return undefined;
  }

  private getExternalCommand(name: string): CommandDefinition | undefined {
    const direct = this.commands.get(name);
    if (direct) return direct;
    if (this.commands.has("rg") || this.commands.has("grep")) {
      return getRuntimeMuscleMemoryCommand(name);
    }
    return undefined;
  }

  private hasExternalCommand(name: string): boolean {
    return this.getExternalCommand(name) !== undefined;
  }
  async discoveryBuiltin(context: CommandContext, state: State, io: IO, assignments: Map<string, SavedVariable>, inheritedDefaultPath = false): Promise<number> {
    const args = [...context.args];
    const command = context.command === "command";
    const builtin = context.command === "builtin";
    let mode: "describe" | "name" | "kind" | "path" = "describe";
    let discover = !command && !builtin;
    let all = false;
    let skipFunctions = false;
    let forcePath = false;
    let defaultPath = false;
    while (args[0]?.startsWith("-") && args[0] !== "-") {
      const option = args.shift()!;
      if (option === "--") break;
      if (builtin) { await this.diagnostic({ ...io, ...context }, `builtin: ${option}: invalid option`); return 2; }
      for (const flag of option.slice(1)) {
        if (command && (flag === "v" || flag === "V")) { discover = true; mode = flag === "v" ? "name" : "describe"; }
        else if (command && flag === "p") defaultPath = true;
        else if (!command && flag === "a") all = true;
        else if (!command && flag === "f") skipFunctions = true;
        else if (!command && flag === "t") mode = "kind";
        else if (!command && (flag === "p" || flag === "P")) { mode = "path"; if (flag === "P") forcePath = true; }
        else {
          if (command) {
            await this.diagnostic({ ...io, ...context }, `command: -${flag}: invalid option`);
            await writeDiagnostic(context.stderr, "command: usage: command [-pVv] command [arg ...]\n");
          } else await writeDiagnostic(context.stderr, `${context.command}: ${option}: unsupported option\n`);
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
      // Nested command execution retains -p; discovery and other builtins use their own options.
      try { return await this.dispatch(targetValue, args, state, { ...io, ...context }, assignments, true, getCommandArguments(context).values.slice(context.args.length - args.length), undefined, command && (defaultPath || inheritedDefaultPath)); }
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
      if (!forcePath && !(all && mode === "path") && shellKeywords.has(name)) matches.unshift({ kind: "keyword", name });
      if (!all) matches = matches.slice(0, 1);
      if (all || !matches.length) {
        const paths = await this.searchPaths(name, state, all, true, defaultPath);
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
        if (mode === "describe") await writeDiagnostic(context.stderr, `${io.scriptName ?? "shell"}: line ${io.diagnosticLine ?? 1}: ${context.command}: ${name}: not found\n`);
        continue;
      }
      found++;
      for (const match of matches) {
        if (mode === "path" && match.kind !== "file") continue;
        let text: string;
        if (mode === "kind") {
          // Dispatch distinguishes registry commands and virtual interpreters;
          // Bash discovery exposes only shell builtin or file for these entries.
          const kind = match.kind === "command" ? (shellBuiltinNames.has(name) ? "builtin" : "file")
            : match.kind === "interpreter" ? "file" : match.kind;
          text = `${kind}\n`;
        }
        else if (mode === "name" || mode === "path") text = `${match.name}\n`;
        else if (match.kind === "function") text = `${name} is a function\n${functionDisplay(name, state.functions.get(name)!)}`;
        else text = `${name} is ${match.kind === "keyword" ? "a shell keyword" : match.kind === "builtin" ? "a shell builtin" : match.kind === "command" ? "a registered command" : match.kind === "interpreter" ? "a virtual shell interpreter" : match.name}\n`;
        await writeText(context.stdout, text);
      }
    }
    return (command ? found > 0 || args.length === 0 : found === args.length) ? 0 : 1;
  }

  async searchPaths(name: string, state: State, all = false, discovery = false, defaultPath = false): Promise<string[]> {
    if (!name) return [];
    let denied: CommandFailure | undefined;
    const matches: string[] = [];
    for (const target of pathTargets(name, defaultPath ? defaultCommandPath : state.variables.PATH, this.budget.limits, this.signal, limit => this.budget.fail(limit))) {
      const resolved = pathOf(state, target);
      try {
        const options = { signal: this.signal };
        if (!await interruptible(this.budget.pathLookup.isFile(this.fs, resolved, this.signal), this.signal)) continue;
        const capabilities = this.fs.capabilitiesFor
          ? await interruptible(this.fs.capabilitiesFor(resolved, options), this.signal) : this.fs.capabilities;
        if (capabilities.permissions !== true) throw new CommandFailure(`${target}: execution permissions are not supported by this filesystem`, 126);
        await interruptible(this.fs.access(resolved, ACCESS_MODES.X_OK, options), this.signal);
        matches.push(target);
        if (!all) return matches;
      } catch (error) {
        this.signal.throwIfAborted();
        if (error instanceof ShellLimitError) throw error;
        if (error instanceof CommandFailure) { if (discovery) continue; throw error; }
        const code = errorCode(error);
        if (code === "ENOENT" || code === "ENOTDIR") continue;
        if (code !== "EACCES" && code !== "EPERM") throw new CommandFailure(filesystemDiagnostic(error, target, this.budget.onInternalError) ?? `${target}: ${message(error, this.budget.onInternalError)}`, 126);
        denied ??= new CommandFailure(filesystemDiagnostic(error, target, this.budget.onInternalError) ?? `${target}: ${message(error, this.budget.onInternalError)}`, 126);
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
    const child = trackState({
      umask: state.umask ?? 0o022,
      extensions: forkExtensions(state.extensions, "process"),
      cwd: state.cwd, variables, exported, functions: new Map(), getopts: { cursor: createGetoptsState(), integer: true },
      directoryStack: { entries: [], bytes: 0 },
      dotglob: false,
      globstar: false,
      positional: [], arg0: shellValueText(arg0), profile: context.command === "sh" ? "sh" : "bash", status: 0, substitutionStatus: 0, depth: state.depth + 1,
      loopDepth: 0, functionDepth: 0, locals: [], pipefail: false, isolated: true,
      errexit: false,
    }, this.budget, io[invocationScope]);
    // Carry owned syntax only when the function's environment entry survives
    // middleware and env replacement. Never evaluate environment text as code.
    for (const name of state.exportedFunctions ?? []) {
      const body = state.functions.get(name);
      const key = `BASH_FUNC_${name}%%`;
      if (body && context.env[key] === functionDisplay(name, body).slice(name.length + 1).trimEnd()) {
        child.functions.set(name, body);
        (child.exportedFunctions ??= new Set()).add(name);
        delete child.variables[key];
        child.exported.delete(key);
      }
    }
    this.replacePositionals(child, getCommandArguments(context).values.slice(context.args.length - args.length), undefined, arg0);
    return child;
  }

  async interpreter(context: CommandContext, state: State, io: IO, loadedSource?: { path: string; source: string }): Promise<number> {
    const args = [...context.args];
    let commandString = false;
    let standardInput = false;
    const options = { allexport: false, braceexpand: true, errexit: false, noclobber: false, noexec: false, noglob: false, nounset: false, pipefail: false };
    const flagsByName = { a: "allexport", B: "braceexpand", e: "errexit", C: "noclobber", n: "noexec", f: "noglob", u: "nounset" } as const;
    while (args.length && (args[0]!.startsWith("-") || args[0]!.startsWith("+"))) {
      const option = args.shift()!;
      if (option === "--" || option === "-") break;
      const enabled = option[0] === "-";
      if ((option === "-o" || option === "+o") && Object.hasOwn(options, args[0] ?? "")) {
        options[args.shift()! as keyof typeof options] = enabled;
        continue;
      }
      const flags = option.slice(1);
      if (!flags.length || [...flags].some(flag => !Object.hasOwn(flagsByName, flag) && !(enabled && (flag === "c" || flag === "s")))) {
        await writeDiagnostic(context.stderr, `${context.command}: ${option}: unsupported option; supported flags are -c, -s, +/-a, +/-e, +/-u, +/-n, +/-B, +/-f, +/-C and +/-o ${Object.keys(options).join(", ")}\n`);
        return 2;
      }
      for (const flag of flags) {
        if (flag === "c") commandString = true;
        else if (flag === "s") standardInput = true;
        else options[flagsByName[flag as keyof typeof flagsByName]] = enabled;
      }
    }
    if (!commandString && !standardInput && args.length) return this.scriptFile(context, state, io, args[0]!, args.slice(1), false, options.errexit, loadedSource, options.braceexpand, options.noexec, options.nounset, options);
    const source = commandString ? args.shift() : undefined;
    if (commandString && source === undefined) {
      await writeDiagnostic(context.stderr, `${context.command}: -c: option requires an argument\n`);
      return 2;
    }
    const arg0 = commandString && args.length ? getCommandArguments(context).values[context.args.length - args.length]! : (context.argv0 ?? context.command);
    if (commandString) args.shift();
    const child = this.processState(context, state, io, arg0, args);
    Object.assign(child, options);
    const references = new PipeDescriptorFrame(io[invocationScope]);
    const childIO = isolateIO({ ...io, ...context, argv0: undefined, execution: { ignoreErrexit: false }, diagnosticLine: 1, diagnosticOffset: 0, assignmentDiagnosticContext: undefined, scriptName: shellValueText(arg0) }, references);
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
    if (error.unclosedQuote) await writeDiagnostic(io.stderr, `${prefix} line ${offset + error.unclosedQuote.line}: unexpected EOF while looking for matching \`${error.unclosedQuote.quote}'\n`);
    else if (error.offset >= source.length && !/Unterminated|nesting|Unsupported/u.test(error.reason)) {
      const context = includeContext && error.incompleteCommand ? ` from \`${error.incompleteCommand.name}' command on line ${offset + error.incompleteCommand.line}` : "";
      await writeDiagnostic(io.stderr, `${prefix} line ${offset + source.split("\n").length + Number(!source.endsWith("\n"))}: syntax error: unexpected end of file${context}\n`);
    } else {
      const token = /^[;&|()<>]|^[^\s;&|()<>]+/u.exec(source.slice(error.offset))?.[0] ?? "newline";
      await writeDiagnostic(io.stderr, `${prefix} line ${offset + line}: syntax error near unexpected token \`${token}'\n${prefix} line ${offset + line}: \`${source.split("\n")[line - 1] ?? ""}'\n`);
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
        const unit = parseShellUnit(source, position, byteLocale(state.variables), this.budget.parsing, lineIndex, undefined, false, state.extensions?.syntax);
        for (const warning of unit.script.warnings ?? []) await writeDiagnostic(io.stderr, `${io.scriptName}: warning: ${warning}\n`);
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
        const unit = eof ? parseShellUnit(source, 0, byteLocale(state.variables), this.budget.parsing, lineIndex, undefined, false, state.extensions?.syntax) : parseShellInputUnit(source, byteLocale(state.variables), this.budget.parsing, lineIndex, state.extensions?.syntax);
        if (unit) {
          for (const warning of unit.script.warnings ?? []) await writeDiagnostic(io.stderr, `${io.scriptName}: warning: ${warning}\n`);
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
    for (const key of child.exportedFunctions ?? []) {
      const body = child.functions.get(key);
      if (!body || context.env[`BASH_FUNC_${key}%%`] !== functionDisplay(key, body).slice(key.length + 1).trimEnd()) child.exportedFunctions?.delete(key);
    }
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
      combineManagedSignals(this.signal, scope.signal), this.fileWrites, this.outputFiles, this.commandSignal,
      this.cancellation, this.cancellationState, this.cancellationOwner,
      this.cancellationDepth, this.cancellationMaxDepth, this.outcomeFrame, this.inputProfile,
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
        executionScope: this.budget.executionScope,
        onInternalError: this.budget.onInternalError,
        env: Object.assign(Object.create(null) as Record<string, string>, incoming.env),
        stdin: input ?? incoming.stdin,
        stdout: this.budget.sink(incoming.stdout, runtime.signal), stderr: this.budget.sink(incoming.stderr, runtime.signal),
        signal: this.commandSignal, registerCleanup: cleanup => { scope.register(cleanup); },
        invoke: (name, args, options) => {
          const invocation = invocationOverride.current ? invocationOverride.current(name, args, options) : runtime.invoke(name, args, options, context, child, scope);
          void invocation.catch(() => undefined);
          return invocation;
        },
      };
      Reflect.deleteProperty(context, invocationScope);
      Reflect.deleteProperty(context, valueScope);
      bindCommandIO(context, { ...io, [invocationScope]: scope });
      bindFileOutputBudget(context, sink => this.budget.sink(sink, runtime.signal), (chunk, write) => this.budget.writeCounted(chunk, write, runtime.signal));
      if (argumentValues.values.every(value => typeof value === "string")) Reflect.deleteProperty(context, "argumentValues");
      const child = await runtime.shebangState(context, state);
      workerRuntimeContexts.set(context, {
        budget: this.budget, umask: child.umask ?? 0o022,
        ignoredSignals: captureIgnoredTrapSignals(child.extensions),
        get fs() { return runtime.getContextFsForFast(0, runtime.signal); },
      });
      const childIO = { ...io, ...context, [invocationScope]: scope };
      invocationOverride.current = prepare?.(runtime, context, child, childIO);
      const runtimeFrame: RuntimeOutcomeFrame = {};
      const middleware = this.middleware.map<Middleware>(handler => (context, next) => {
        scope.assertOpen();
        this.budget.pathLookup.suspendUntilClosed(scope);
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
      ...(options.admittedHandles === undefined ? {} : { admittedHandles: options.admittedHandles }),
      ...(options.processSignals === undefined ? {} : { processSignals: options.processSignals }),
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
      if (definition) {
        runtime.budget.pathLookup.suspendUntilClosed(childIO[invocationScope]);
        return definition.execute(forwarded);
      }
      await writeDiagnostic(forwarded.stderr, `env: ${command}: command not found\n`);
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
      runtime.budget.pathLookup.suspendUntilClosed(io[invocationScope]);
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

  async scriptFile(context: CommandContext, state: State, io: IO, target: string, args: readonly string[], direct: boolean, errexit = false, loadedSource?: { path: string; source: string }, braceexpand = true, noexec = false, nounset = false, options?: Pick<State, "allexport" | "noclobber" | "noglob" | "pipefail">): Promise<number> {
    if (target === "") throw new CommandFailure(`${context.command}: : No such file or directory`, 127);
    if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
    const path = pathOf(state, target);
    let source: string;
    let environmentInterpreter: RegExpExecArray | null = null;
    let interpreterCommand: { name: string; argument?: string } | undefined;
    let sourceBytes: Uint8Array | undefined;
    let interpreterProfile: "bash" | "sh" | undefined;
    try {
      if (loadedSource?.path === path) source = loadedSource.source;
      else {
        const options = { signal: this.signal };
        const stat = await interruptible(this.fs.stat(path, options), this.signal);
        if (stat.type !== "file") throw new CommandFailure(`${target}: ${stat.type === "directory" ? "Is a directory" : "not a regular file"}`, 126);
        if (direct) {
          const capabilities = this.fs.capabilitiesFor
            ? await interruptible(this.fs.capabilitiesFor(path, options), this.signal) : this.fs.capabilities;
          if (capabilities.permissions !== true) throw new CommandFailure(`${target}: execution permissions are not supported by this filesystem`, 126);
        }
        await interruptible(this.fs.access(path, ACCESS_MODES.R_OK | (direct ? ACCESS_MODES.X_OK : 0), options), this.signal);
        const maxBytes = this.budget.limits.maxSourceBytes - this.budget.sourceBytes;
        if (stat.size > maxBytes) this.budget.fail("maxSourceBytes");
        const bytes = await interruptible(this.fs.readFile(path, { ...options, ...(maxBytes === Infinity ? {} : { maxBytes }) }), this.signal);
        this.budget.source(bytes.byteLength);
        sourceBytes = bytes;
        const newline = bytes.indexOf(10);
        source = direct && bytes[0] === 35 && bytes[1] === 33
          ? this.sourceText(bytes.subarray(0, newline < 0 ? bytes.length : newline), target)
          : this.sourceText(bytes, target);
      }
      if (direct && source.startsWith("#!")) {
        const interpreter = source.split("\n", 1)[0]!.slice(2).replace(/^[ \t]+|[ \t]+$/gu, "");
        environmentInterpreter = /^\/usr\/bin\/env(?:[ \t]+([^\n]*))?$/u.exec(interpreter);
        if (!environmentInterpreter) {
          const shell = /^\/(?:usr\/)?bin\/(bash|sh)(?:[ \t]+([-+]e+))?$/u.exec(interpreter);
          if (!shell) {
            const split = Array.from(interpreter).findIndex(character => character === " " || character === "\t");
            const executable = split < 0 ? interpreter : interpreter.slice(0, split);
            const name = executable.slice(executable.lastIndexOf("/") + 1);
            const directory = executable.slice(0, executable.lastIndexOf("/"));
            if ((directory !== "/bin" && directory !== "/usr/bin") || name === "sh" || name === "bash" || !this.commands.has(name)) {
              throw new CommandFailure(`${target}: unsupported interpreter: ${interpreter}`, 126);
            }
            const argument = split < 0 ? undefined : interpreter.slice(split).trimStart();
            interpreterCommand = { name, ...(argument ? { argument } : {}) };
          } else {
            interpreterProfile = shell[1] === "sh" ? "sh" : "bash";
            if (shell[2]) errexit = shell[2].startsWith("-");
          }
        }
      }
    } catch (error) {
      this.signal.throwIfAborted();
      if (error instanceof ShellLimitError || error instanceof CommandFailure) throw error;
      if (errorCode(error) === "EFBIG") this.budget.fail("maxSourceBytes");
      throw new CommandFailure(filesystemDiagnostic(error, target, this.budget.onInternalError) ?? `${target}: ${message(error, this.budget.onInternalError)}`, errorCode(error) === "ENOENT" ? 127 : 126);
    }
    const decodeSource = () => sourceBytes ? this.sourceText(sourceBytes, target) : source;
    const scriptSource = { path, get source() { return decodeSource(); } };
    if (direct && environmentInterpreter) return this.envShebang(context, state, io, environmentInterpreter[1], target, args, scriptSource);
    if (direct && interpreterCommand) {
      const incoming = getCommandArguments({ args, ...(context.argumentValues ? { argumentValues: context.argumentValues } : {}) });
      const allocation = this.budget.values.scope();
      io[invocationScope].register(() => allocation.close());
      const argumentValues = this.admitArguments([...(interpreterCommand.argument ? [interpreterCommand.argument] : []), target, ...incoming.values], allocation);
      return (await this.shebangTarget(context, state, io, interpreterCommand.name, argumentValues.args, { argumentValues }, target, scriptSource)).exitCode;
    }
    source = scriptSource.source;
    const lineIndex = new SourceLineIndex(source, this.budget.parsing);
    const child = this.processState(context, state, io, target, args);
    child.errexit = errexit;
    child.braceexpand = braceexpand;
    child.noexec = noexec;
    child.nounset = nounset;
    if (options) Object.assign(child, options);
    if (direct) child.profile = interpreterProfile ?? state.profile ?? "bash";
    const references = new PipeDescriptorFrame(io[invocationScope]);
    const childIO = isolateIO({ ...io, ...context, execution: { ignoreErrexit: false }, diagnosticLine: 1, diagnosticOffset: 0, assignmentDiagnosticContext: undefined, scriptName: target }, references);
    try {
    let status = 0;
    let position = 0;
    do {
      this.signal.throwIfAborted();
      let unit;
      try {
        unit = parseShellUnit(source, position, byteLocale(child.variables), this.budget.parsing, lineIndex, undefined, false, child.extensions?.syntax);
      } catch (error) {
        if (!(error instanceof ShellSyntaxError)) throw error;
        await writeDiagnostic(context.stderr, `${target}: line ${lineIndex.lineAt(error.offset)}: syntax error: ${error.reason}\n`);
        status = error.exitCode;
        break;
      }
      for (const warning of unit.script.warnings ?? []) await writeDiagnostic(context.stderr, `${target}: warning: ${warning}\n`);
      if (unit.script.lists.length) {
        const result = await this.runUnit(unit.script, child, childIO);
        status = result.exitCode;
        if (result.terminated) break;
      }
      position = unit.next;
    } while (position < source.length);
    return await this.finishShell(child, childIO, status);
    } finally { await references.close(); }
  }

  async runCurrentText(source: string, state: State, io: IO, fatalSyntax: boolean, syntaxName?: string, byteSource = false, includeSyntaxContext = true, sourceValues?: OwnedShellSource["values"]): Promise<number> {
    const lineIndex = new SourceLineIndex(source, this.budget.parsing);
    let position = 0;
    let status = 0;
    let executed = false;
    try {
      do {
        this.signal.throwIfAborted();
        const unit = parseShellUnit(source, position, byteLocale(state.variables), this.budget.parsing, lineIndex, sourceValues, byteSource, state.extensions?.syntax);
        for (const warning of unit.script.warnings ?? []) await writeDiagnostic(io.stderr, `${io.scriptName ?? "shell"}: warning: ${warning}\n`);
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
      await writeDiagnostic(io.stderr, "eval: usage: eval [arg ...]\n");
      if (special) throw new Flow("exit", 2);
      return 2;
    }
    if (!args.length) return 0;
    if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
    const values = getCommandArguments(context).values.slice(context.args.length - args.length);
    let length = values.length - 1;
    for (const value of values) { this.signal.throwIfAborted(); length += shellValueByteLength(value); }
    this.budget.source(length);
    const allocation = this.budget.values.scope();
    try {
    allocation.reserve(64 + values.length * 32, 0);
    const value = concatShellValues(values.flatMap((entry, index) => index ? [" ", entry] : [entry]), allocation);
    const source = typeof value === "string" ? { text: this.sourceText(Buffer.from(value), "eval"), values: undefined } : ownedShellSource(value, this.budget.parsing, allocation);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(source.text)) throw new CommandFailure("eval: cannot execute binary script", 126);
    const restoration = stateMonitor(state)?.restoration(true);
    try { state.depth++; }
    catch (error) { restoration?.close(); throw error; }
    try {
      return await this.runCurrentText(source.text, state, { ...io, diagnosticOffset: (io.diagnosticLine ?? 1) - 1, assignmentDiagnosticContext: { name: context.command } }, special, `${io.scriptName ?? "shell"}: eval`, false, true, source.values);
    } finally {
      const restore = () => { state.depth--; };
      if (restoration) restoration.apply(restore);
      else restore();
    }
    } finally { allocation.close(); }
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
      await writeDiagnostic(io.stderr, `${context.command}: usage: ${context.command} [-p path] filename [arguments]\n`);
      if (special) throw new Flow("exit", 2);
      return 2;
    }
    if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
    let target = filename;
    let source: string;
    try {
      const options = { signal: this.signal };
      if (filename && !filename.includes("/") && state.variables.PATH) {
        let found = false;
        for (const candidate of pathTargets(filename, state.variables.PATH, this.budget.limits, this.signal, limit => this.budget.fail(limit))) {
          const path = pathOf(state, candidate);
          try {
            if (!await interruptible(this.budget.pathLookup.isFile(this.fs, path, this.signal), this.signal)) continue;
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
      const path = pathOf(state, target);
      const stat = await interruptible(this.fs.stat(path, options), this.signal);
      if (stat.type === "directory") throw new CommandFailure(`${context.command}: ${target}: is a directory`, 1);
      if (stat.type !== "file") throw new CommandFailure(`${target}: not a regular file`, 1);
      await interruptible(this.fs.access(path, ACCESS_MODES.R_OK, options), this.signal);
      const maxBytes = this.budget.limits.maxSourceBytes - this.budget.sourceBytes;
      if (stat.size > maxBytes) this.budget.fail("maxSourceBytes");
      const bytes = await interruptible(this.fs.readFile(path, { ...options, ...(maxBytes === Infinity ? {} : { maxBytes }) }), this.signal);
      this.budget.source(bytes.byteLength);
      source = this.sourceText(bytes, target);
    } catch (error) {
      this.signal.throwIfAborted();
      if (error instanceof ShellLimitError) throw error;
      if (errorCode(error) === "EFBIG") this.budget.fail("maxSourceBytes");
      const diagnostic = error instanceof CommandFailure ? error.message : filesystemDiagnostic(error, target, this.budget.onInternalError) ?? `${target}: ${message(error, this.budget.onInternalError)}`;
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
      if (options.argv0 !== undefined && (typeof options.argv0 !== "string" || options.argv0.includes("\0"))) throw new TypeError("invoke argv0 must be a string without NUL");
      if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
    }, (runtime, scope) => runtime.invokeScoped(name, args, options, context, state, scope));
  }

  private async invokeScoped(name: string, args: readonly string[], options: ShellInvokeOptions, context: ShellCommandContext, state: State, scope: InvocationScope): Promise<{ exitCode: number }> {
    this.signal.throwIfAborted();
    const allocation = this.budget.values.scope();
    scope.register(() => allocation.close());
    const carrier = this.admitArguments(getCommandArguments({ args, ...(options.argumentValues ? { argumentValues: options.argumentValues } : {}) }).values, allocation);
    const child = await cloneState(state, this.signal, scope, false);
    child.extensions = forkExtensions(state.extensions, "invocation");
    child.cwd = resolvePath(context.cwd, options.cwd ?? ".");
    const env: Record<string, string> = options.replaceEnv ? { ...options.env } : { ...context.env, ...options.env, PWD: child.cwd };
    if (guestArrays(child) || Object.keys(env).some(key => arrayStore(child)?.get(key))) await this.indexedEnvironment(child, env);
    else {
    for (const key of child.exported) delete child.variables[key];
    for (const [key, value] of Object.entries(env)) {
      if (key.includes("\0") || key.includes("=") || typeof value !== "string" || value.includes("\0")) throw new TypeError("Invalid invoke environment entry");
      publishVariable(child, key, value);
    }
    child.exported = new Set(Object.keys(env));
    }
    for (const key of child.exportedFunctions ?? []) {
      const body = child.functions.get(key);
      if (!body || env[`BASH_FUNC_${key}%%`] !== functionDisplay(key, body).slice(key.length + 1).trimEnd()) child.exportedFunctions?.delete(key);
    }
    child.externalInvocation = options.externalInvocation === true;
    if (child.externalInvocation) {
      for (const key of child.functions.keys()) if (!child.exportedFunctions?.has(key)) child.functions.delete(key);
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
      argv0: options.argv0,
      ...(options.admittedHandles === undefined ? {} : { admittedHandles: options.admittedHandles }),
      ...(options.processSignals === undefined ? {} : { processSignals: options.processSignals }),
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
        else if (flag === "a") state.allexport = enabled;
        else if (flag === "u") state.nounset = enabled;
        else if (flag === "f") state.noglob = enabled;
        else if (flag === "C") state.noclobber = enabled;
        else if (flag === "n") state.noexec = enabled;
        else if ([...state.extensions?.options.values() ?? []].some(option => option.flag === flag)) {
          for (const option of state.extensions!.options.values()) if (option.flag === flag) option.enabled = enabled;
        }
        else if (flag === "B") state.braceexpand = enabled;
        else if (flag === "o" && position === option.length - 1) {
          const name = args[index + 1];
          if (name === undefined) {
            const options = [["allexport", !!state.allexport], ["braceexpand", state.braceexpand !== false], ["errexit", !!state.errexit], ["noclobber", !!state.noclobber], ["noexec", !!state.noexec], ["noglob", !!state.noglob], ["nounset", !!state.nounset], ["pipefail", state.pipefail], ...[...state.extensions?.options.values() ?? []].map(option => [option.name, option.enabled] as const)] as const;
            for (const [name, active] of options) await writeText(stdout, enabled ? `${name}\t${active ? "on" : "off"}\n` : `set ${active ? "-" : "+"}o ${name}\n`);
          } else {
            if (name === "errexit") state.errexit = enabled;
            else if (name === "allexport") state.allexport = enabled;
            else if (name === "nounset") state.nounset = enabled;
            else if (name === "pipefail") state.pipefail = enabled;
            else if (name === "braceexpand") state.braceexpand = enabled;
            else if (name === "noglob") state.noglob = enabled;
            else if (name === "noclobber") state.noclobber = enabled;
            else if (name === "noexec") state.noexec = enabled;
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
        await writeDiagnostic(stderr, "set: unsupported shell option; supported forms are +/- a/e/u/f/n/B/C clusters, -- arguments and terminal o with allexport, braceexpand, noclobber, noexec, noglob, pipefail, errexit or nounset\n");
        return 1;
      }
      index++;
    }
    if (positionals) { this.replacePositionals(state, getCommandArguments(context).values.slice(index)); state.positionalSetVersion = (state.positionalSetVersion ?? 0) + 1; }
    if (state.noexec) throw new Flow("discard", 0);
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
      try {
        let program = prepareArithmetic(args[index]!, this.budget.parsing);
        if (program.error) {
          const word = parseArithmeticExpansion(args[index]!, this.budget.parsing, byteLocale(state.variables),
            state.depth + (context.parameterDepth ?? 0), context.diagnosticLine ?? 1, state.extensions?.syntax);
          const operandIO = this.parameterOperandIO(word, state, context);
          const fields = await this.valueWord(word, state, operandIO, false, false, true);
          const source = shellValueText(concatShellValues(fields, context[valueScope]));
          this.signal.throwIfAborted();
          program = prepareArithmetic(source, this.budget.parsing);
        }
        value = await this.shellArithmetic(program, state, context, variables);
      }
      catch (error) {
        this.rethrowArithmeticControl(error);
        throw new PublicDiagnostic(`let: ${message(error, this.budget.onInternalError)}`);
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
      await writeDiagnostic(context.stderr, "getopts: usage: getopts optstring name [arg ...]\n");
      return 2;
    }
    if (context.args.length - offset < 2) {
      await writeDiagnostic(context.stderr, "getopts: usage: getopts optstring name [arg ...]\n");
      return 2;
    }
    const optstring = context.args[offset]!;
    const name = context.args[offset + 1]!;
    const explicit = context.args.length > offset + 2;
    const monitor = explicit ? undefined : stateMonitor(state);
    const revision = monitor?.positionalRevision;
    const supplied = explicit ? context.args.slice(offset + 2) : state.positional;
    if (supplied.length > fields) this.budget.fail("maxExpansionFields");
    const maxBytes = saturatedProduct(bytes, saturatedSum(supplied.length, 1));
    const maxSteps = saturatedSum(saturatedProduct(maxBytes, 2), saturatedSum(supplied.length, 2));
    const work = { maxArguments: supplied.length, maxBytes, maxSteps, yieldEvery: 128, signal: this.signal, checkpoint };
    let input = monitor?.getoptsInput;
    let allocation: ValueScope | undefined;
    let result;
    try {
      if (!input && monitor) {
        const size = getoptsInputAllocationSize(supplied.length);
        const arena = this.budget.values;
        const usage = arena.usage;
        if (size.bytes + 64 <= arena.maximumBytes - usage.bytes && size.slots + 1 <= arena.maximumSlots - usage.slots) {
          allocation = arena.scope();
          input = await createGetoptsInput(supplied, allocation, work);
        }
      }
      const args = input?.args ?? supplied;
      if (!input || allocation) for (let index = 0; index < args.length; index++) {
        this.signal.throwIfAborted();
        admit(args[index]);
        if ((index + 1) % 128 === 0) await checkpoint();
      }
      state.getopts ??= cloneGetoptsBinding(state);
      try {
        result = await scanGetopts(state.getopts.cursor, optstring, input ?? args, {
          reportErrors: state.variables.OPTERR === undefined || state.variables.OPTERR === "" || decimalIndex(state.variables.OPTERR) !== 0,
          work,
        });
      } catch (error) {
        this.signal.throwIfAborted();
        if (error instanceof GetoptsError && (error.code === "NON_ASCII_OPTION" || error.code === "INVALID_INPUT")) throw new CommandFailure(`getopts: ${error.message}`, 2);
        throw error;
      }
      this.signal.throwIfAborted();
      if (monitor && monitor.positionalRevision !== revision) throw new CommandFailure("getopts: positional arguments changed during validation", 2);
      if (allocation && monitor!.retainGetoptsInput(revision!, input!, allocation)) allocation = undefined;
    } finally { allocation?.close(); }
    this.signal.throwIfAborted();
    state.getopts.cursor = result.state;
    if (result.diagnostic) {
      const explanation = result.diagnostic.kind === "unknown-option" ? "illegal option" : "option requires an argument";
      await writeDiagnostic(context.stderr, `${state.arg0 ?? context.scriptName ?? "shell"}: ${explanation} -- ${result.diagnostic.option}\n`);
    }
    this.signal.throwIfAborted();
    await this.writeVariable(state, "OPTIND", String(result.optind), context, "getopts");
    if (result.argument.kind === "set") await this.writeVariable(state, "OPTARG", result.argument.value, context, "getopts");
    else this.unsetVariable(state, "OPTARG", true);
    if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name)) throw new PublicDiagnostic(`getopts: \`${name}': not a valid identifier`);
    await this.assignVariable(state, name, result.option, context, "getopts");
    return result.status;
  }

  private async changeDirectory(context: CommandContext & IO, state: State, args: readonly string[], diagnose?: (error: unknown, diagnostic: string) => void, stackHooks?: { name: string; onCwdPublished(): void; emit(text: string): Promise<void> }): Promise<number> {
    const name = stackHooks?.name ?? "cd";
    this.signal.throwIfAborted();
    const lookup = new CdLookup(this.signal);
    let offset = 0;
    let physical = false;
    // Directory-stack callers have already parsed their options and pass a path.
    if (!stackHooks) for (; offset < args.length; offset++) {
      await lookup.charge(1);
      const option = args[offset]!;
      if (option === "--") { offset++; break; }
      if (!option.startsWith("-") || option === "-") break;
      for (let index = 1; index < option.length; index++) {
        await lookup.charge(1);
        const flag = option[index]!;
        if (flag === "L" || flag === "P") physical = flag === "P";
        else { await writeDiagnostic(context.stderr, `cd: -${flag}: invalid option\n`); return 2; }
      }
    }
    if (args.length - offset > 1) { await writeDiagnostic(context.stderr, `${name}: too many arguments\n`); return 1; }
    const operand = args[offset];
    const target = operand === "-" ? state.variables.OLDPWD : (operand ?? state.variables.HOME);
    if (target === undefined) { await writeDiagnostic(context.stderr, `${name}: ${operand === "-" ? "OLDPWD" : "HOME"} not set\n`); return 1; }
    let selected: { path: string; print?: string };
    try {
      selected = await lookup.find(this.fs, state.cwd, target || ".", state.variables.CDPATH, physical);
    } catch (error) {
      this.signal.throwIfAborted();
      const description = filesystemDiagnostic(error, "", this.budget.onInternalError);
      const text = description ? "" : message(error, this.budget.onInternalError);
      diagnose?.(error, cdDiagnostic(description ? [name, ": ", target, description]
        : stackHooks && text.startsWith("cd: ") ? [name, text.slice(2)] : [text]));
      throw error;
    }
    this.signal.throwIfAborted();
    const { path } = selected;
    await this.writeVariable(state, "OLDPWD", state.cwd, context);
    state.cwd = path;
    stackHooks?.onCwdPublished();
    await this.writeVariable(state, "PWD", path, context);
    state.exported.add("PWD");
    state.exported.add("OLDPWD");
    const printedPath = selected.print ?? (operand === "-" ? target : undefined);
    if (printedPath !== undefined) {
      if (stackHooks) await stackHooks.emit(`${printedPath}\n`);
      else await writeText(context.stdout, `${printedPath}\n`);
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
    let setNamespace = false;
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
        else if (flag === "o") setNamespace = true;
        else {
          await this.diagnostic(context, `shopt: ${option.startsWith("--") ? option : `-${flag}`}: unsupported option`);
          await writeDiagnostic(context.stderr, "shopt: usage: shopt [-opqsu] [--] [option ...]\n");
          return 2;
        }
      }
    }
    if (set && unset) {
      await this.diagnostic(context, "shopt: cannot set and unset shell options simultaneously");
      return 1;
    }
    const options = new Map<string, { enabled: boolean }>();
    for (const name of setNamespace ? ["allexport", "braceexpand", "errexit", "noclobber", "noexec", "noglob", "nounset", "pipefail"] as const : ["dotglob", "extglob", "globstar", "nocaseglob", "nocasematch", "nullglob"] as const) {
      options.set(name, {
        get enabled() { return name === "braceexpand" ? state.braceexpand !== false : !!state[name]; },
        set enabled(value) { state[name] = value; },
      });
    }
    for (const [name, option] of (setNamespace ? state.extensions?.options : state.extensions?.shoptOptions) ?? []) options.set(name, option);
    const emit = async (name: string, enabled: boolean): Promise<void> => {
      if (!quiet) await writeText(context.stdout, print ? setNamespace ? `set ${enabled ? "-" : "+"}o ${name}\n` : `shopt -${enabled ? "s" : "u"} ${name}\n` : `${name.padEnd(20)}\t${enabled ? "on" : "off"}\n`);
    };
    if (index === context.args.length) {
      for (const [name, option] of options) if ((!set || option.enabled) && (!unset || !option.enabled)) await emit(name, option.enabled);
      return 0;
    }
    let status = 0;
    for (; index < context.args.length; index++) {
      this.signal.throwIfAborted();
      const name = context.args[index]!;
      const option = options.get(name);
      if (!option) {
        await this.diagnostic(context, `shopt: ${name}: unsupported shell option name (supported: ${[...options.keys()].join(", ")})`);
        status = 1;
      } else if (set || unset) option.enabled = set;
      else {
        await emit(name, option.enabled);
        if (!option.enabled) status = 1;
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

  private async printfVariable(context: CommandContext & IO, state: State, assignments: Map<string, SavedVariable>): Promise<number> {
    const incoming = getCommandArguments(context);
    let offset = 0;
    let name = "";
    let index: ReturnType<typeof literalIndex> | undefined;
    while (incoming.args[offset]?.startsWith("-v")) {
      const option = incoming.args[offset++]!;
      const target = option.slice(2) || incoming.args[offset++];
      if (target === undefined) {
        await writeDiagnostic(context.stderr, "printf: -v: option requires an argument\n");
        return 2;
      }
      const bracket = target.indexOf("[");
      name = bracket < 0 ? target : target.slice(0, bracket);
      if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name) || bracket >= 0 && !target.endsWith("]")) {
        await writeDiagnostic(context.stderr, `printf: '${target}': not a valid identifier\n`);
        return 2;
      }
      index = undefined;
      if (bracket >= 0) {
        const source = target.slice(bracket + 1, -1);
        try { index = stringIndex(source, this.budget.parsing, parseArraySubscript(source, this.budget.parsing, byteLocale(state.variables), state.depth)); }
        catch (error) {
          this.signal.throwIfAborted();
          if (!(error instanceof ShellSyntaxError)) throw error;
          await writeDiagnostic(context.stderr, `printf: '${target}': unsupported indexed-array subscript\n`);
          return 2;
        }
      }
    }
    const arguments_ = incoming.slice(offset);
    const format = arguments_.args[0] === "--" ? arguments_.args[1] : arguments_.args[0];
    if (format === undefined || arguments_.args[0] !== "--" && format.startsWith("-")) {
      await writeDiagnostic(context.stderr, "printf: usage: printf [-v var] format [arguments]\n");
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
        await writeDiagnostic(context.stderr, `printf: ${error.message}\n`);
        status = 1;
      }
      const value = concatShellValues(chunks, allocation);
      this.signal.throwIfAborted();
      name = this.referenceName(state, name);
      if (state.readonlyVariables?.has(name)) {
        await writeDiagnostic(context.stderr, `printf: ${name}: readonly variable\n`);
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
          await writeDiagnostic(context.stderr, "printf: indexed variables do not support non-UTF-8 bytes\n");
          return 1;
        }
        if (index) await this.arrayAssignment({ kind: "element", name, index, append: false, value: { offset: 0, parts: [{ kind: "text", value: text, quoted: true }] } }, state, context);
        else await this.assignVariable(state, name, text, context);
      } else await this.writeVariable(state, name, value, context);
      const previous = assignments.get(name);
      if (previous) {
        if (!previous.exported) state.exported.delete(name);
        await this.discardVariable(previous);
        assignments.delete(name);
      }
      return status;
    } finally { allocation.close(); }
  }

  private async mapfileBuiltin(context: CommandContext & IO, state: State): Promise<number> {
    const allocation = this.budget.values.scope();
    const work = { remaining: this.budget.limits.maxExpansionBytes * 8, signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") };
    let pinned: IndexedBinding | undefined;
    let releaseHolding: (() => void) | undefined;
    try {
      const options = await mapfileOptions(context, work, allocation);
      options.name = this.referenceName(state, options.name);
      if (arrayStore(state)?.get(options.name)?.associative) throw new MapfileUsageError(`${options.name}: not an indexed array`, 1);
      if (state.readonlyVariables?.has(options.name)) throw new MapfileUsageError(`${options.name}: readonly variable`, 1);
      if (controlNames.has(options.name) || state.exported.has(options.name)) throw new ArrayFailure("control or exported binding cannot be indexed");
      const store = requireArrays(state);
      const holding = store.owner.hold();
      releaseHolding = () => holding.release();
      if (!options.preserve || !store.get(options.name)) await this.arrayAssignment({ kind: "compound", name: options.name, append: options.preserve, entries: [] }, state, context);
      const entry = store.bindings.get(options.name)!;
      allocation.reserve(128 + Buffer.byteLength(options.name) * 2, 0);
      pinned = entry.binding.retain();
      const input = context.stdin instanceof ShellInput ? context.stdin : new ShellInput(context.stdin, this.budget, this.signal);
      let pendingFlow: Flow | undefined;
      await collectMapfile(options, input, {
        allocation: () => this.budget.values.scope(),
        loop: () => this.budget.loop(),
        write: async (index, value) => {
          if (pinned !== entry.binding) { const previous = pinned!; pinned = entry.binding.retain(); await previous.release(); }
          const operation = ArrayOwner.create(store.owner.ledger, store.owner);
          let staged: IndexedBinding | undefined;
          try {
            const current = pinned!;
            const attached = store.bindings.get(options.name) === entry;
            const watch = attached ? await store.watch(options.name, operation, this.signal) : undefined;
            const supersede = attached ? await stateMonitor(state)!.prepareTypedPublication(options.name, operation, this.signal) : undefined;
            if (attached) await this.prepareArrayObservers(state, operation);
            const tickets = operation.reserve({ generation: true, version: true, epoch: true, work: 8 });
            // Exclude the mapfile pin and the live name's reference from COW.
            staged = current.references > (attached ? 2 : 1) ? await current.copy(this.signal) : current.retain();
            const token = await valueToken(staged.owner, value, this.signal);
            try {
              this.signal.throwIfAborted();
              if (watch && !watch.valid()) throw new ArrayFailure("stale binding");
              staged.insert(index, token);
            } catch (error) { token.release(); throw error; }
            if (attached) {
              let released: Promise<void> | undefined;
              stateMonitor(state)!.publish(tickets, options.name, () => {
                supersede!();
                released = store.publish(options.name, staged!, tickets);
              });
              staged = undefined;
              await released;
            } else {
              const previous = pinned!;
              pinned = staged;
              entry.binding = staged;
              staged = undefined;
              await previous.release();
            }
          } finally { try { await staged?.release(); } finally { await operation.close(); } }
        },
        callback: async (source, index, value) => {
          if (pendingFlow) return;
          const callbackAllocation = this.budget.values.scope();
          const nested = mapfileCallbackStates.has(state);
          try {
            const quoted = shellValueText(await transformParameter(value, "Q", { maximumBytes: this.budget.limits.maxExpansionBytes, byteLocale: byteLocale(state.variables), work, allocation: callbackAllocation }));
            if (Buffer.byteLength(source) + Buffer.byteLength(quoted) + String(index).length + 2 > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
            const argumentValues = createCommandArguments([source, String(index), quoted], callbackAllocation);
            mapfileCallbackStates.add(state);
            await this.evalBuiltin({ ...context, args: argumentValues.args, argumentValues }, state, context, false);
          } catch (error) {
            if (error instanceof Flow && (error.kind === "break" || error.kind === "continue")) pendingFlow = error;
            else throw error;
          } finally {
            if (!nested) mapfileCallbackStates.delete(state);
            callbackAllocation.close();
          }
        },
      });
      if (pendingFlow) throw pendingFlow;
      return 0;
    } catch (error) {
      this.signal.throwIfAborted();
      if (!(error instanceof MapfileUsageError)) throw error;
      await this.diagnostic(context, `${context.command}: ${error.message}`);
      return error.status;
    } finally { try { await pinned?.release(); } finally { try { releaseHolding?.(); } finally { allocation.close(); } } }
  }
  async builtin(context: CommandContext & IO, state: State, assignments: Map<string, SavedVariable>, diagnose?: (error: unknown, diagnostic: string) => void, suppressSpecial = false): Promise<number | undefined> {
    const { args, stdout, stderr } = context;
    const command = context.command === "typeset" ? "declare" : context.command;
    if (command === ":" || command === "true") return 0;
    if (command === "false") return 1;
    if (command === "umask") return umaskBuiltin(context, state);
    if (command === "hash") {
      const hashArgs = [...args];
      let reset = false;
      let listMode = false;
      let deleteMode = false;
      let printTarget = false;
      let customPath: string | undefined;
      while (hashArgs[0]?.startsWith("-") && hashArgs[0] !== "-") {
        const option = hashArgs.shift()!;
        if (option === "--") break;
        for (let i = 1; i < option.length; i++) {
          const flag = option[i]!;
          if (flag === "r") reset = true;
          else if (flag === "l") listMode = true;
          else if (flag === "d") deleteMode = true;
          else if (flag === "t") printTarget = true;
          else if (flag === "p") {
            const inline = option.slice(i + 1);
            customPath = inline.length > 0 ? inline : hashArgs.shift();
            if (customPath === undefined) {
              await this.diagnostic(context, "hash: -p: option requires an argument");
              return 2;
            }
            break;
          } else {
            await this.diagnostic(context, `hash: -${flag}: invalid option`);
            await writeDiagnostic(stderr, "hash: usage: hash [-lr] [-p pathname] [-dt] [name ...]\n");
            return 2;
          }
        }
      }
      if (reset) state.hashedCommands?.clear();
      if (printTarget && hashArgs.length === 0) {
        await this.diagnostic(context, "hash: -t: option requires arguments");
        return 1;
      }
      if (hashArgs.length === 0) {
        if (!reset && state.hashedCommands?.size) {
          for (const [name, target] of state.hashedCommands) {
            await writeText(stdout, listMode ? `builtin hash -p ${target} ${name}\n` : `0\t${target}\n`);
          }
        }
        return 0;
      }
      let status = 0;
      const table = (state.hashedCommands ??= new Map<string, string>());
      for (const name of hashArgs) {
        if (deleteMode) {
          if (!table.delete(name)) {
            await this.diagnostic(context, `hash: ${name}: not found`);
            status = 1;
          }
          continue;
        }
        if (customPath !== undefined) {
          table.set(name, customPath);
          continue;
        }
        if (printTarget) {
          const existing = table.get(name) ?? (await this.searchPaths(name, state, false, true, false))[0];
          if (existing === undefined) {
            await this.diagnostic(context, `hash: ${name}: not found`);
            status = 1;
          } else {
            await writeText(stdout, hashArgs.length > 1 ? `${name}\t${existing}\n` : `${existing}\n`);
          }
          continue;
        }
        const [resolved] = await this.searchPaths(name, state, false, true, false);
        if (resolved !== undefined) {
          table.set(name, resolved);
        } else if (!shellBuiltinNames.has(name) && !this.commands.has(name) && name !== "bash" && name !== "sh") {
          await this.diagnostic(context, `hash: ${name}: not found`);
          status = 1;
        }
      }
      return status;
    }

    if (command === "shopt") return this.shoptBuiltin(context, state);
    if (command === "let") return this.letBuiltin(context, state);
    if (command === "mapfile" || command === "readarray") return this.mapfileBuiltin(context, state);
    if (command === "getopts") return this.getoptsBuiltin(context, state);
    if (command === "pushd" || command === "dirs" || command === "popd") return this.directoryStackBuiltin(context, state, diagnose);
    if (command === "pwd") {
      let physical = false;
      for (const arg of args) {
        if (arg === "--" || !arg.startsWith("-") || arg === "-") break;
        if (arg === "--logical") { physical = false; continue; }
        if (arg === "--physical") { physical = true; continue; }
        for (const flag of arg.slice(1)) {
          if (flag !== "L" && flag !== "P") { await writeDiagnostic(stderr, "pwd: invalid option\n"); return 2; }
          physical = flag === "P";
        }
      }
      const path = physical ? await this.fs.realpath(state.cwd, { signal: this.signal }) : state.cwd;
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
          await writeDiagnostic(stderr, "set: unsupported shell option; supported forms are +/- e/u clusters, -- arguments and terminal o with pipefail, errexit or nounset\n");
          if (state.profile === "sh" && suppressSpecial) return 2;
          throw new Flow("exit", 2);
        }
        positionals = true;
        break;
      }
      if (positionals) { this.replacePositionals(state, getCommandArguments(context).values.slice(index)); state.positionalSetVersion = (state.positionalSetVersion ?? 0) + 1; }
      if (args.length) return 0;
      const store = arrayStore(state);
      const varNames = [...new Set([...Object.keys(state.variables), ...store?.bindings.keys() ?? []])].sort();
      for (const name of varNames) {
        this.signal.throwIfAborted();
        const binding = store?.get(name);
        if (binding) {
          binding.retain();
          try {
            await writeText(stdout, `${name}=(`);
            let first = true;
            for (const idx of [...binding.values.keys()].sort((left, right) => left - right)) {
              await writeText(stdout, first ? "[" : " [");
              if (binding.associative) await this.printDeclarationValue(binding.keys.get(binding.keyByIndex.get(idx)!)!.text.shellValue, state, context);
              else await writeText(stdout, String(idx));
              await writeText(stdout, "]=");
              await this.printDeclarationValue(binding.getValue(idx)!, state, context);
              first = false;
            }
            await writeText(stdout, ")\n");
          } finally { await binding.release(); }
        } else if (Object.hasOwn(state.variables, name)) {
          const val = stateMonitor(state)?.values.get(name, state.variables[name]!) ?? state.variables[name]!;
          if (typeof val === "string" && /^[a-zA-Z0-9_./:@%+=,-]*$/u.test(val)) {
            await writeText(stdout, `${name}=${val}\n`);
          } else {
            await writeText(stdout, `${name}=`);
            await this.printDeclarationValue(val, state, context);
            await writeText(stdout, "\n");
          }
        }
      }
      for (const name of [...state.functions.keys()].sort()) {
        this.signal.throwIfAborted();
        const body = state.functions.get(name);
        if (body) await writeText(stdout, functionDisplay(name, body));
      }
      return 0;
    }
    if (command === "shift") {
      const offset = args[0] === "--" ? 1 : 0;
      const operand = args[offset];
      const value = operand === undefined ? 1n : await signedLong(operand, this.budget, this.signal);
      if (value === undefined || value === "overflow") {
        await writeDiagnostic(stderr, `shift: ${operand}: numeric argument required\n`);
        return 2;
      }
      const count = Number(value);
      if (args.length - offset > 1 || count < 0 || count > state.positional.length) return 1;
      this.replacePositionals(state, this.positionalValues(state).slice(count));
      return 0;
    }
    if (command === "export" || command === "local" || command === "readonly" || command === "declare") {
      let associativeDeclaration = false;
      const enabled = new Set<string>();
      const disabled = new Set<string>();
      const declarationArgs = [...args];
      let indexedLocal = false;
      let namerefDeclaration = false;
      const readonlySyntax = state.extensions?.syntax.indexedDeclarations?.includes("readonly") === true
        || command === "readonly" && args.some(arg => arg.startsWith("-") && arg.includes("a"));
      let indexedReadonly = false;
      let functionReadonly = false;
      if (command === "export") {
        while (declarationArgs[0]?.startsWith("-") && declarationArgs[0] !== "-") {
          const option = declarationArgs.shift()!;
          if (option === "--") break;
          for (const flag of option.slice(1)) {
            if (!"fnp".includes(flag)) {
              await this.diagnostic(context, `export: -${flag}: invalid option`);
              await writeText(stderr, "export: usage: export [-fn] [name[=value] ...] or export -p\n");
              return 2;
            }
            enabled.add(flag);
          }
        }
        if (enabled.has("f")) {
          let status = 0;
          if (!declarationArgs.length) {
            for (const name of [...state.exportedFunctions ?? []].sort()) {
              const body = state.functions.get(name);
              if (!body) continue;
              await writeText(stdout, functionDisplay(name, body));
              await writeText(stdout, `declare -fx ${name}\n`);
            }
          }
          for (const name of declarationArgs) {
            if (!state.functions.has(name)) {
              await this.diagnostic(context, `export: ${name}: not a function`);
              status = 1;
            } else if (enabled.has("n")) state.exportedFunctions?.delete(name);
            else (state.exportedFunctions ??= new Set()).add(name);
          }
          return status;
        }
      }
      if (command === "declare" || command === "local") {
        while (declarationArgs[0]?.startsWith("-") || declarationArgs[0]?.startsWith("+")) {
          const option = declarationArgs.shift()!;
          if (option === "--") break;
          for (const flag of option.slice(1)) {
            if (!(command === "local" ? "AailunxrIp" : "AailunxrgIfFtp").includes(flag)) { await this.diagnostic(context, `${context.command}: ${option}: invalid option`); return 2; }
            (option[0] === "-" ? enabled : disabled).add(flag);
          }
        }
        associativeDeclaration = enabled.has("A");
        indexedLocal = associativeDeclaration || enabled.has("a");
        namerefDeclaration = enabled.has("n");
        if (enabled.has("f") || enabled.has("F")) {
          let status = 0;
          const names = declarationArgs.length ? declarationArgs : [...state.functions.keys()].sort();
          for (const name of names) {
            const body = state.functions.get(name);
            if (!body) { status = 1; continue; }
            if (enabled.has("t")) continue;
            await writeText(stdout, enabled.has("F") ? `${name}\n` : functionDisplay(name, body));
          }
          return status;
        }
      }
      if (command === "local") {
        if (enabled.has("n") && (enabled.has("i") || indexedLocal)) {
          await this.diagnostic(context, "local: combined nameref attributes are unsupported");
          return 2;
        }
        if (indexedLocal && declarationArgs.length === 0 && !enabled.has("p")) {
          await writeDiagnostic(stderr, "local: -a requires a variable name\n");
          return 2;
        }
      }
      if (command === "readonly") {
        while (declarationArgs[0]?.startsWith("-")) {
          const option = declarationArgs.shift()!;
          if (option === "--") break;
          if (!readonlySyntax && [...option.slice(1)].some(flag => flag !== "f" && flag !== "p")) {
            await writeDiagnostic(stderr, `readonly: ${option}: unsupported option\n`);
            return 2;
          }
          if (option === "-") { declarationArgs.unshift(option); break; }
          for (const flag of option.slice(1)) {
            if (flag === "f") functionReadonly = true;
            else if (flag === "p") continue;
            else if (flag === "a" && readonlySyntax) indexedReadonly = true;
            else {
              await this.diagnostic(context, `readonly: -${flag}: invalid option`);
              await writeText(stderr, "readonly: usage: readonly [-aAf] [name[=value] ...] or readonly -p\n");
              return 2;
            }
          }
        }
        if (functionReadonly) {
          let status = 0;
          const names = declarationArgs.length ? declarationArgs : [...state.readonlyFunctions ?? []].sort();
          for (const name of names) {
            this.signal.throwIfAborted();
            const body = state.functions.get(name);
            if (!body) {
              await this.diagnostic(context, `readonly: ${name}: not a function`);
              status = 1;
              continue;
            }
            if (!declarationArgs.length) {
              await writeText(stdout, functionDisplay(name, body));
              await writeText(stdout, `declare -fr ${name}\n`);
            } else {
              state.readonlyFunctions ??= new Set();
              state.readonlyFunctions.add(name);
            }
          }
          return status;
        }
      }
      const locals = command === "declare" && enabled.has("g") ? undefined : state.locals.at(-1);
      const localDeclaration = command === "local" || command === "declare" && locals !== undefined;
      if (command === "local" && !locals) { await writeDiagnostic(stderr, "local: not in a function\n"); return 1; }
      if ((command === "declare" || command === "local") && enabled.has("p")) {
        let status = 0;
        const names = declarationArgs.length ? declarationArgs : command === "local" ? [...locals!.keys()] : [...new Set([...Object.keys(state.variables), ...state.variableAttributes?.keys() ?? [], ...state.exported, ...state.readonlyVariables ?? [], ...arrayStore(state)?.bindings.keys() ?? []])];
        for (const name of declarationArgs.length ? names : names.sort()) {
          this.signal.throwIfAborted();
          const binding = arrayStore(state)?.get(name);
          if (!binding && !Object.hasOwn(state.variables, name) && !locals?.has(name) && !state.variableAttributes?.has(name) && !state.exported.has(name) && !state.readonlyVariables?.has(name)) {
            await this.diagnostic(context, `${context.command}: ${name}: not found`);
            status = 1;
            continue;
          }
          const attributes = state.variableAttributes?.get(name) ?? "";
          const flags = [..."aAilnrux"].filter(flag => flag === "a" ? binding && !binding.associative : flag === "A" ? binding?.associative : flag === "r" ? state.readonlyVariables?.has(name) : flag === "x" ? state.exported.has(name) : attributes.includes(flag)).join("");
          await writeText(stdout, `declare ${flags ? `-${flags}` : "--"} ${name}`);
          if (binding) {
            binding.retain();
            try {
              await writeText(stdout, "=(");
              let first = true;
              for (const index of [...binding.values.keys()].sort((left, right) => left - right)) {
                await writeText(stdout, first ? "[" : " [");
                if (binding.associative) await this.printDeclarationValue(binding.keys.get(binding.keyByIndex.get(index)!)!.text.shellValue, state, context);
                else await writeText(stdout, String(index));
                await writeText(stdout, "]=");
                await this.printDeclarationValue(binding.getValue(index)!, state, context);
                first = false;
              }
              await writeText(stdout, ")");
            } finally { await binding.release(); }
          } else if (Object.hasOwn(state.variables, name)) {
            await writeText(stdout, "=");
            await this.printDeclarationValue(stateMonitor(state)?.values.get(name, state.variables[name]!) ?? state.variables[name]!, state, context);
          }
          await writeText(stdout, "\n");
        }
        return status;
      }
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
        for (const name of [...names].sort()) {
          await writeText(stdout, `${prefix} ${name}`);
          if (command !== "export" || Object.hasOwn(state.variables, name)) {
            await writeText(stdout, "=");
            if (command === "export") await this.printDeclarationValue(stateMonitor(state)?.values.get(name, state.variables[name]!) ?? state.variables[name]!, state, context);
            else await writeText(stdout, JSON.stringify(state.variables[name] ?? ""));
          }
          await writeText(stdout, "\n");
        }
      }
      const declarationValues = getCommandArguments(context).values;
      const declarationOffset = args.length - declarationArgs.length;
      for (let declarationIndex = 0; declarationIndex < declarationArgs.length; declarationIndex++) {
        const arg = declarationArgs[declarationIndex]!;
        const match = /^([a-zA-Z_][a-zA-Z_0-9]*)(?:\+?=(.*))?$/su.exec(arg);
        if (!match) { await this.diagnostic(context, `${command}: \`${arg}': not a valid identifier`); status = 1; continue; }
        const name = match[1]!;
        const syntax = context[declarationArrays]?.get(declarationOffset + declarationIndex);
        const compound = syntax?.name === name ? syntax : undefined;
        const reference = match[2] ?? state.variables[name];
        if (namerefDeclaration && reference !== undefined && (reference === name || !this.variableTarget(reference))) {
          await this.diagnostic(context, `${command}: ${reference}: invalid name reference`); status = 1; continue;
        }
        const append = arg[name.length] === "+";
        const assignedValue = (): ShellValue => {
          const original = declarationValues[declarationOffset + declarationIndex]!;
          return typeof original === "string" ? match[2]! : shellValueFromBytes(shellValueBytes(original, context[valueScope]).subarray(name.length + (append ? 2 : 1)), context[valueScope]);
        };
        if (state.readonlyVariables?.has(name) && (match[2] !== undefined || localDeclaration)) {
          const provenance = readonlySyntax && (command === "readonly" || command === "local" && indexedLocal) ? `${command}: ` : "";
          await this.diagnostic(context, `${provenance}${name}: readonly variable`); status = 1; continue;
        }
        if (arrayStore(state)?.get(name) && (command === "export" || enabled.has("x"))) {
          await this.diagnostic(context, "indexed array: indexed binding cannot be exported"); status = 1; continue;
        }
        if (command === "readonly" && readonlySyntax && (indexedReadonly || match[2]?.startsWith("("))) {
          const assigned = match[2] !== undefined ? assignedValue() : undefined;
          if (match[2]?.startsWith("(")) {
            this.budget.source(shellValueByteLength(assigned!));
            const source = typeof assigned === "string" ? assigned : Buffer.from(shellValueBytes(assigned!, context[valueScope])).toString("latin1");
            const entries = parseCompoundArrayValue(source, byteLocale(state.variables), typeof assigned !== "string", state.extensions?.syntax, this.budget.parsing);
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
        if ((localDeclaration || command === "declare") && (indexedLocal || compound)) {
          if (controlNames.has(name)) throw new ArrayFailure("control binding cannot be indexed");
          if (state.exported.has(name)) throw new ArrayFailure("exported binding cannot be indexed");
          const existingLocal = locals?.get(name);
          const saved = !locals || existingLocal ? undefined : assignments.get(name) ?? saveVariable(state, name);
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
            if (saved && !enabled.has("I")) state.variableAttributes?.delete(name);
            this.declareAttributes(state, name, enabled, disabled);
            if (compound) {
              // Retain the visible outer binding while expanding the initializer.
              // The saved local participates in the shared publication observers.
              if (saved) locals!.set(name, saved);
              await this.arrayAssignment(compound, state, context, enabled.has("r") ? "readonly" : undefined, "declaration", indexedLocal ? associativeDeclaration : undefined);
              published = true;
              assignments.delete(name);
            } else {
              const store = requireArrays(state);
              operation = ArrayOwner.create(store.owner.ledger, store.owner);
              holding = store.owner.hold();
              const watch = await store.watch(name, operation, this.signal);
              const tickets = operation.reserve({ generation: true, version: true, epoch: true, work: 8 });
              const prepared = await store.prepareName(name, operation, this.signal);
              const current = store.get(name);
              if (!saved && current && current.associative !== associativeDeclaration) throw new ArrayFailure("cannot convert array kind");
              shadow = !saved && current ? await current.copy(this.signal) : IndexedBinding.create(store.owner, associativeDeclaration);
              let value = match[2] !== undefined ? assignedValue() : !saved && !current && Object.hasOwn(state.variables, name) ? stateMonitor(state)?.values.get(name, state.variables[name]!) ?? state.variables[name] : undefined;
              if (value !== undefined) {
                const index = associativeDeclaration ? (await shadow.keyIndex("0", operation, this.signal, true))! : 0;
                if (append) {
                  const previous = shadow.getValue(index) ?? "";
                  value = state.variableAttributes?.get(name)?.includes("i")
                    ? concatShellValues([`(${shellValueText(previous) || "0"})+(`, value, ")"], context[valueScope])
                    : concatShellValues([previous, value], context[valueScope]);
                }
                const token = await textToken(shadow.owner, await this.attributeValue(state, name, value, context), this.signal);
                try { shadow.insert(index, token); } catch (error) { token.release(); throw error; }
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
            }
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
          if (enabled.has("r")) { state.readonlyVariables ??= new Set(); state.readonlyVariables.add(name); }
          continue;
        }
        if (localDeclaration && !locals!.has(name)) {
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
          if (!enabled.has("I")) state.variableAttributes?.delete(name);
          if (!assignments.has(name) && match[2] === undefined && !enabled.has("I")) {
            if (name === "PIPESTATUS") state.variables[name] = "";
            else delete state.variables[name];
          }
          if (name === "OPTIND") {
            state.getopts ??= cloneGetoptsBinding(state);
            state.getopts.integer = false;
          }
        }
        const attributeName = enabled.has("n") || disabled.has("n") ? name : this.variableTarget(this.referenceName(state, name))!.name;
        if (command === "declare" || command === "local") this.declareAttributes(state, attributeName, enabled, disabled);
        if (match[2] !== undefined && arrayStore(state)?.get(name)) {
          await this.arrayZero(state, name, context, async () => assignedValue(), append, command === "readonly");
          assignments.delete(name);
          continue;
        }
        if (match[2] !== undefined) {
          if ((command === "declare" || command === "local") && enabled.has("n")) publishVariable(state, name, assignedValue());
          else {
            let value = assignedValue();
            const target = this.referenceName(state, name);
            const element = this.variableTarget(target)!;
            if (element.subscript !== undefined && append) {
              await this.arrayAssignment({ kind: "element", name: element.name, append: true,
                index: stringIndex(element.subscript, this.budget.parsing, parseArraySubscript(element.subscript, this.budget.parsing, byteLocale(state.variables), state.depth)),
                value: { offset: 0, parts: [{ kind: "text", value: shellValueText(value), quoted: true, ...(typeof value === "string" ? {} : { byteValue: value }) }] } }, state, context);
            } else {
              if (append) value = state.variableAttributes?.get(target)?.includes("i")
                ? concatShellValues([`(${state.variables[target] || "0"})+(`, value, ")"], context[valueScope])
                : concatShellValues([stateMonitor(state)?.values.get(target, state.variables[target] ?? "") ?? state.variables[target] ?? "", value], context[valueScope]);
              await this.assignVariable(state, name, value, context);
            }
          }
        }
        else if (command === "local" && name === "OPTIND") this.syncGetopts(state);
        if (command === "export" && !enabled.has("n") || enabled.has("x")) state.exported.add(attributeName);
        if (command === "export" && enabled.has("n")) state.exported.delete(attributeName);
        if (disabled.has("x")) state.exported.delete(attributeName);
        if (command === "readonly" || enabled.has("r")) { state.readonlyVariables ??= new Set(); state.readonlyVariables.add(attributeName); }
        const previous = assignments.get(name);
        if (previous && locals?.get(name) !== previous) previous.heldValue?.release();
        assignments.delete(name);
      }
      return status;
    }
    if (command === "unset") {
      let variables = false;
      let functions = false;
      let dereference = true;
      let offset = 0;
      let scanned = 0;
      while (args[offset]?.startsWith("-") && args[offset] !== "-") {
        const option = args[offset++]!;
        if (option === "--") break;
        for (let index = 1; index < option.length; index++) {
          if (++scanned % 1024 === 0) { this.budget.cpuCheckpoint(); await yieldTurn(this.signal); }
          const flag = option[index]!;
          if (flag === "v") variables = true;
          else if (flag === "f") functions = true;
          else if (flag === "n") dereference = false;
          else { await writeDiagnostic(stderr, `unset: -${flag}: invalid option\n`); return 2; }
        }
      }
      if (variables && functions) {
        await writeDiagnostic(stderr, "unset: cannot simultaneously unset a function and a variable\n");
        return 1;
      }
      let status = 0;
      for (let argument = offset; argument < args.length; argument++) {
        if ((argument - offset) % 128 === 0) { this.budget.cpuCheckpoint(); await yieldTurn(this.signal); }
        let name = args[argument]!;
        if (functions) {
          if (state.readonlyFunctions?.has(name)) {
            await this.diagnostic(context, `unset: ${name}: cannot unset: readonly function`);
            status = 1;
          } else {
            state.functions.delete(name);
            state.exportedFunctions?.delete(name);
          }
          continue;
        }
        if (dereference) name = this.referenceName(state, name);
        const selected = /^([a-zA-Z_][a-zA-Z_0-9]*)\[(.*)\]$/su.exec(name);
        if (selected) {
          if (!dereference) continue;
          const base = this.referenceName(state, selected[1]!);
          const selector = selected[2]!;
          if (state.readonlyVariables?.has(base)) {
            await this.diagnostic(context, state.extensions?.syntax.indexedDeclarations?.includes("readonly") ? `unset: ${base}: cannot unset: readonly variable` : "indexed array: readonly binding");
            status = 1;
            continue;
          }
          const binding = arrayStore(state)?.get(base);
          if (binding?.associative) {
            const original = getCommandArguments(context).values[argument]!;
            const index = typeof original === "string"
              ? await this.arrayIndex(binding, { decimal: selector, source: selector }, state, context, binding.owner)
              : await binding.keyIndex(shellValueFromBytes(shellValueBytes(original, context[valueScope]).subarray(args[argument]!.indexOf("[") + 1, shellValueByteLength(original) - 1), context[valueScope]), binding.owner, this.signal);
            if (index !== undefined) await this.unsetIndexed(state, base, index);
          } else if (selector === "@" || selector === "*") await this.unsetIndexed(state, base, "members");
          else {
            let index: number | undefined;
            try { index = await this.arrayIndex(binding, { decimal: selector, source: selector }, state, context, requireArrays(state).owner, false, binding?.maximum ?? (state.variables[base] === undefined ? -1 : 0)); }
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
        if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name)) { await writeDiagnostic(stderr, `unset: ${name}: not a valid identifier\n`); status = 1; continue; }
        const resolved = dereference ? this.referenceName(state, name) : name;
        if (!dereference && !state.variableAttributes?.get(name)?.includes("n")) continue;
        if (state.readonlyVariables?.has(resolved)) { await this.diagnostic(context, `unset: ${resolved}: cannot unset: readonly variable`); status = 1; continue; }
        if (resolved === "PATH") state.pathUnset = true;
        if (arrayStore(state)?.get(resolved)) await this.unsetIndexed(state, resolved);
        else this.unsetVariable(state, resolved, false, dereference);
        if (state.profile === "sh") assignments.delete(resolved);
      }
      return status;
    }
    if (command === "read") {
      const names = [...args];
      let raw = false;
      let count: number | undefined;
      let exact = false;
      let delimiter: number | undefined;
      let array: string | undefined;
      let invalid = false;
      while (names[0]?.startsWith("-") && names[0] !== "--" && names[0] !== "-") {
        const option = names.shift()!;
        for (let index = 1; index < option.length; index++) {
          const flag = option[index];
          if (flag === "r") { raw = true; continue; }
          // Input is nonterminal: silent has no effect and prompts are not emitted.
          if (flag === "s") continue;
          if (flag !== "n" && flag !== "N" && flag !== "d" && flag !== "a" && flag !== "p" && flag !== "u") { invalid = true; break; }
          if (flag === "N") exact = true;
          const value = option.slice(index + 1) || names.shift();
          if (value === undefined) invalid = true;
          else if (flag === "p") { /* Consume the prompt without terminal output. */ }
          else if (flag === "u") {
            // The default builtin only selects the supplied standard input.
            const descriptor = value.trim();
            const digits = descriptor.startsWith("+") || descriptor.startsWith("-") ? descriptor.slice(1) : descriptor;
            if (!digits.length || [...digits].some(character => character !== "0")) invalid = true;
          }
          else if (flag === "a") array = value;
          else if (flag === "d") delimiter = new TextEncoder().encode(value)[0] ?? 0;
          else {
            // Bash 5.3 permits an optional sign and surrounding ASCII whitespace.
            let start = 0;
            let end = value.length;
            while (start < end && " \t\n\r\v\f".includes(value[start]!)) start++;
            while (end > start && " \t\n\r\v\f".includes(value[end - 1]!)) end--;
            if (value[start] === "+" || value[start] === "-") start++;
            let decimal = start < end;
            for (let digit = start; digit < end; digit++) {
              if (value[digit]! < "0" || value[digit]! > "9") { decimal = false; break; }
            }
            const parsed = Number(value);
            if (!decimal || !Number.isSafeInteger(parsed) || parsed < 0 || parsed > 2147483647) {
              if (exact || decimal && parsed > 2147483647) {
                const diagnosticIO: IO = context;
                await writeDiagnostic(stderr, `${diagnosticIO.scriptName ?? "shell"}: line ${diagnosticIO.diagnosticLine ?? 1}: read: ${value}: invalid ${/^[+-]?0[xX]/u.test(value) ? "hex " : ""}number\n`);
                return 1;
              }
              invalid = true;
            } else count = parsed;
          }
          break;
        }
        if (invalid) break;
      }
      if (names[0] === "--") names.shift();
      if (array !== undefined) names.splice(0, names.length, array);
      const invalidName = names.find(name => !this.variableTarget(name));
      if (exact && !invalid && invalidName !== undefined) {
        const diagnosticIO: IO = context;
        await writeDiagnostic(stderr, `${diagnosticIO.scriptName ?? "shell"}: line ${diagnosticIO.diagnosticLine ?? 1}: read: \`${invalidName}': not a valid identifier\n`);
        return 1;
      }
      if (invalid || invalidName !== undefined) {
        await writeDiagnostic(stderr, "read: invalid variable name or unsupported option\n");
        return 2;
      }
      const input = context.stdin instanceof ShellInput ? context.stdin : new ShellInput(context.stdin, this.budget, this.signal);
      const line = count === 0 && context.stdin === closedSource ? undefined
        : await input.line(raw, {
          ...(count === undefined ? {} : { count }), ...(delimiter === undefined ? {} : { delimiter }), byteCount: byteLocale(state.variables), exact,
        });
      try {
      if (array !== undefined) {
        array = this.referenceName(state, array);
        if (state.readonlyVariables?.has(array)) { await this.diagnostic(context, `${array}: readonly variable`); return 1; }
        const writer = await this.incrementalIndexed(state, context, array, true);
        try {
          const separators = exact ? "" : stateMonitor(state)?.values.get("IFS", state.variables.IFS ?? " \t\n") ?? state.variables.IFS ?? " \t\n";
          const fields = await line?.fields(separators) ?? [];
          for (let index = 0; index < fields.length; index++) await writer.set(index, fields[index]!.value);
        } finally { await writer.close(); }
      }
      else if (!names.length) {
        if (state.readonlyVariables?.has("REPLY")) { await this.diagnostic(context, "REPLY: readonly variable"); return 1; }
        await this.writeVariable(state, "REPLY", line?.shellValue ?? "", context);
      }
      else {
        const separators = exact ? "" : stateMonitor(state)?.values.get("IFS", state.variables.IFS ?? " \t\n") ?? state.variables.IFS ?? " \t\n";
        const fields = await line?.fields(separators, names.length) ?? [];
        for (let index = 0; index < names.length; index++) {
          if (state.readonlyVariables?.has(names[index]!)) {
            await this.diagnostic(context, `${names[index]}: readonly variable`);
            return index === names.length - 1 ? 1 : 2;
          }
          await this.assignVariable(state, names[index]!, fields[index]?.value ?? "", context);
        }
      }
      return line?.terminated ? 0 : 1;
      } finally { line?.release(); }
    }
    if (command === "exit" || command === "return") {
      if (command === "return" && state.functionDepth === 0 && !state.sourceDepth) { await writeDiagnostic(stderr, "return: can only `return' from a function or sourced script\n"); return 2; }
      const offset = args[0] === "--" ? 1 : 0;
      const operand = args[offset];
      if (args.length - offset > 1) { await writeDiagnostic(stderr, `${command}: too many arguments\n`); return 1; }
      const value = operand === undefined ? BigInt(state.status) : await signedLong(operand, this.budget, this.signal);
      if (value === undefined || value === "overflow") {
        await writeDiagnostic(stderr, `${command}: ${operand}: numeric argument required\n`);
        if (command === "exit") return 2;
        throw completedExit(2, command);
      }
      const status = operand === undefined ? (command === "exit" && state.extensions?.exiting ? state.extensions.exitStatus ?? state.status : state.status) : Number((value % 256n + 256n) % 256n);
      throw completedExit(status, command, 1, state.status);
    }
    if (command === "break" || command === "continue") {
      if (!state.loopDepth) { await writeDiagnostic(stderr, `${command}: only meaningful in a loop\n`); return 0; }
      const offset = args[0] === "--" ? 1 : 0;
      const operand = args[offset];
      const count = operand === undefined ? 1n : await signedLong(operand, this.budget, this.signal);
      if (count === undefined || count === "overflow") {
        await writeDiagnostic(stderr, `${command}: ${operand}: numeric argument required\n`);
        throw completedExit(2, "exit");
      }
      const levels = Number(count);
      if (args.length - offset > 1) { await writeDiagnostic(stderr, `${command}: invalid loop count\n`); return 1; }
      if (levels < 1) {
        await writeDiagnostic(stderr, `${command}: invalid loop count\n`);
        throw completedExit(1, "break", state.loopDepth);
      }
      throw completedExit(0, command, Math.min(levels, state.loopDepth));
    }
    return undefined;
  }

  async words(words: readonly Word[], state: State, io: IO, declaration = false): Promise<string[]> {
    return (await this.valueWords(words, state, io, declaration)).map(shellValueText);
  }

  private fastValueWords(words: readonly Word[], state: State, io: IO, declaration = false, indexedDeclaration = false, overrideDiagnosticLine?: number): ShellValue[] | undefined {
    if (indexedDeclaration) return undefined;
    const fields: ShellValue[] = [];
    for (let index = 0; index < words.length; index++) {
      const word = words[index]!;
      const scalarAssignment = declaration ? this.assignment(word) : undefined;
      const split = !scalarAssignment;
      const assignmentStart = scalarAssignment ? scalarAssignment.name.length + (scalarAssignment.append ? 2 : 1) : undefined;
      const fast = this.fastValueWord(word, state, io, split, false, false, true, assignmentStart, overrideDiagnosticLine);
      if (fast === undefined) return undefined;
      if (1 > this.budget.limits.maxExpansionFields - fields.length) this.budget.fail("maxExpansionFields");
      fields.push(fast);
    }
    return fields;
  }

  private async valueWords(words: readonly Word[], state: State, io: IO, declaration = false, indexedDeclaration = false, compounds?: Map<number, ArrayAssignment>, argumentOffset = 1): Promise<ShellValue[]> {
    const fields: ShellValue[] = [];
    for (const word of words) {
      const assignment = indexedDeclaration ? getArrayAssignment(word) : undefined;
      if (assignment) {
        if (compounds) compounds.set(fields.length - argumentOffset, assignment);
        else await this.arrayAssignment(assignment, state, io, undefined, "declaration");
        fields.push(assignment.name);
      } else {
        const scalarAssignment = declaration ? this.assignment(word) : undefined;
        const split = !scalarAssignment;
        const assignmentStart = scalarAssignment ? scalarAssignment.name.length + (scalarAssignment.append ? 2 : 1) : undefined;
        const fast = this.fastValueWord(word, state, io, split, false, false, true, assignmentStart);
        if (fast !== undefined) {
          if (1 > this.budget.limits.maxExpansionFields - fields.length) this.budget.fail("maxExpansionFields");
          fields.push(fast);
          continue;
        }
        if (!scalarAssignment && state.braceexpand !== false && !state.variableAttributes?.size && !guestArrays(state)) {
          const valScope = io[valueScope];
          const fastBrace = tryFastExpandBraceRange(word, this.budget, valScope ? (b, o) => valScope.reserve(b, o) : undefined);
          if (fastBrace !== undefined) {
            if (fastBrace.length > this.budget.limits.maxExpansionFields - fields.length) this.budget.fail("maxExpansionFields");
            if (fields.length === 0 && words.length === 1) return fastBrace;
            for (let i = 0; i < fastBrace.length; i++) fields.push(fastBrace[i]!);
            continue;
          }
        }
        const values = await this.valueWord(word, state, io, split, false, false, false, undefined, false, true, assignmentStart);
        if (values.length > this.budget.limits.maxExpansionFields - fields.length) this.budget.fail("maxExpansionFields");
        for (const value of values) fields.push(value);
      }
      if (fields.length > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
    }
    return fields;
  }

  async part(part: Exclude<WordPart, { kind: "text" }>, state: State, io: IO, hereString = false): Promise<string> {
    return shellValueText(await this.valuePart(part, state, io, hereString));
  }

  private async *prefixNames(prefix: string, state: State): AsyncGenerator<string> {
    const allocation = this.budget.values.scope();
    const store = arrayStore(state);
    const holding = store?.owner.hold();
    const work: StringWork = { remaining: Math.min(Number.MAX_SAFE_INTEGER, this.budget.limits.maxExpansionBytes * 4 + 1024), signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") };
    try {
      allocation.reserveBytes(128);
      const names: string[] = [];
      const seen = new Set<string>();
      let bytes = 0;
      const consider = async (name: string, assigned: boolean): Promise<void> => {
        const scanned = await scanString(name, work);
        const pending = stringCheckpoint(work, name.length + 1);
        if (pending) await pending;
        if (!assigned || !name.startsWith(prefix) || seen.has(name)) return;
        for (let index = 0; index < name.length; index++) {
          const pending = stringCheckpoint(work);
          if (pending) await pending;
          const code = name.charCodeAt(index);
          if (!(code === 95 || code >= 65 && code <= 90 || code >= 97 && code <= 122 || index > 0 && code >= 48 && code <= 57)) return;
        }
        if (names.length >= this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
        if (scanned.bytes > this.budget.limits.maxExpansionBytes - bytes) this.budget.fail("maxExpansionBytes");
        bytes += scanned.bytes;
        allocation.reserveBytes(name.length * 2 + 64);
        seen.add(name);
        names.push(name);
      };
      for (const name in state.variables) if (Object.hasOwn(state.variables, name)) await consider(name, state.variables[name] !== undefined);
      if (store) for (const [name, entry] of store.bindings) await consider(name, entry.binding.assigned);
      // Bash lists initialized names from dynamically enclosing local scopes,
      // even when the current local value shadows them with an unset value.
      for (const frame of state.locals) for (const [name, saved] of frame) {
        await consider(name, saved.value !== undefined || typedSavedVariables.get(saved)?.binding?.assigned === true);
      }
      await sortExpansionStrings(names, work);
      for (const name of names) {
        const pending = stringCheckpoint(work);
        if (pending) await pending;
        yield name;
      }
    } finally { allocation.close(); holding?.release(); }
  }

  private async resolveParameter<T extends WordPart>(part: T, state: State, io: IO): Promise<T> {
    // Indirection of a nameref exposes its target name, not the target's value.
    if (part.kind === "variable" && part.indirect && state.variableAttributes?.get(part.name)?.includes("n")) return part;
    if (part.kind === "variable" && part.indirect) {
      const referencePart: Extract<WordPart, { kind: "variable" }> = { kind: "variable", name: part.name, quoted: true, ...(part.line === undefined ? {} : { line: part.line }) };
      copyArraySelector(part, referencePart);
      const reference = await this.valuePart(referencePart, state, io);
      if (shellValueByteLength(reference) > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
      const name = shellValueText(reference);
      const target = this.variableTarget(name);
      if (target && target.subscript !== undefined && target.subscript.length > 0) {
        const resolved = { ...part, name: target.name, indirect: false };
        if (target.subscript === "@" || target.subscript === "*") {
          setArraySelector(resolved, { kind: "members", separator: target.subscript });
        } else {
          setArraySelector(resolved, { kind: "element", index: stringIndex(target.subscript, this.budget.parsing, parseArraySubscript(target.subscript, this.budget.parsing, byteLocale(state.variables), state.depth)) });
        }
        part = resolved;
      } else if (/^(?:[a-zA-Z_][a-zA-Z_0-9]*|[0-9]+|[?@*#$!_-])$/u.test(name)) {
        part = { ...part, name, indirect: false };
      } else {
        throw new ExpansionFailure(`${name || part.name}: invalid variable name`, io.diagnosticLine ?? part.line);
      }
    }
    if (part.kind === "variable" && !part.indirect && !part.prefixNames && !part.specialParameter && state.variableAttributes?.get(part.name)?.includes("n")) {
      const target = this.variableTarget(this.referenceName(state, part.name))!;
      const resolved = { ...part, name: target.name };
      copyArraySelector(part, resolved);
      if (target.subscript !== undefined) setArraySelector(resolved, { kind: "element", index: stringIndex(target.subscript, this.budget.parsing, parseArraySubscript(target.subscript, this.budget.parsing, byteLocale(state.variables), state.depth)) });
      part = resolved;
    }
    if (part.kind === "variable" && part.name === "DIRSTACK") {
      const entries = [state.cwd, ...state.directoryStack?.entries ?? []];
      const binding = arrayStore(state)?.get(part.name);
      if (!binding || binding.values.size !== entries.length || entries.some((entry, index) => binding.get(index) !== entry)) {
        await this.arrayAssignment({ kind: "compound", name: part.name, append: false, entries: entries.map(value => ({ value: { offset: 0, parts: [{ kind: "text", value, quoted: true }] } })) }, state, io);
      }
    }
    const selector = getArraySelector(part);
    if (part.kind !== "variable" || selector?.kind !== "element" || selector.index.source === undefined) return part;
    const store = requireArrays(state);
    const binding = store.get(part.name);
    if (binding?.associative) {
      const word = selector.index.word ?? parseArraySubscript(selector.index.source, this.budget.parsing, byteLocale(state.variables), state.depth);
      const fields = await this.valueWord(word, state, io, false);
      const value = concatShellValues(fields, io[valueScope]);
      const resolved = { ...part };
      copyArraySelector(part, resolved);
      setArraySelector(resolved, { kind: "element", index: { decimal: shellValueText(value), word: { offset: word.offset, parts: [{ kind: "text", value: shellValueText(value), quoted: true, ...(typeof value === "string" ? {} : { byteValue: value }) }] } } });
      return resolved;
    }
    const maximum = binding?.maximum ?? (state.variables[part.name] === undefined ? -1 : 0);
    const index = await this.arrayIndex(binding, selector.index, state, io, store.owner, false, maximum);
    const resolved = { ...part };
    copyArraySelector(part, resolved);
    setArraySelector(resolved, { kind: "element", index: { decimal: String(index) } });
    return resolved;
  }

  private async valuePart(part: Exclude<WordPart, { kind: "text" }>, state: State, io: IO, hereString = false, split = false, hereDocument = false): Promise<ShellValue> {
    part = await this.resolveParameter(part, state, io);
    if (part.kind === "variable" && part.length && (part.name === "@" || part.name === "*")) return String(state.positional.length);
    const memberSelector = getArraySelector(part);
    if (part.kind === "variable" && memberSelector?.kind === "members" && part.operator && defaultParameterOperators.includes(part.operator)) {
      const members = await this.arrayMembers(part.name, state, io);
      const missing = members.length === 0;
      const operator = part.operator.at(-1)!;
      if (operator === "+" ? !missing : missing) {
        if (operator === "=") throw new ArrayFailure(`${part.name}[${memberSelector.separator}]: bad array subscript`);
        const alternate = concatShellValues(await this.valueWord(part.alternate!, state, this.parameterOperandIO(part.alternate!, state, io), false, false, hereString, false, undefined, hereDocument), io[valueScope]);
        if (operator === "?") throw new ParameterExpansionFailure(`${part.name}: ${shellValueText(alternate) || "parameter not set"}`, io.diagnosticLine ?? part.line);
        return alternate;
      }
      if (operator === "+") return "";
    }
    const element = getArraySelector(part);
    if (part.kind === "variable" && element?.kind === "element") {
      const store = requireArrays(state);
      const binding = store.get(part.name);
      const index = binding?.associative
        ? await this.arrayIndex(binding, element.index, state, io, store.owner)
        : numericIndex(element.index, 4294967295);
      const value = binding ? index === undefined ? undefined : binding.getValue(index)
        : part.name === "FUNCNAME" && state.variables.FUNCNAME === undefined ? (index === undefined ? undefined : state.functionNames?.[index])
        : index === 0 ? this.variable(state, part.name) : undefined;
      if (part.operator && defaultParameterOperators.includes(part.operator)) {
        const missing = value === undefined || part.operator.startsWith(":") && shellValueByteLength(value) === 0;
        const operator = part.operator.at(-1)!;
        if (operator === "+" ? !missing : missing) {
          const operandIO = this.parameterOperandIO(part.alternate!, state, io);
          if (operator === "=") {
            await this.arrayAssignment({ kind: "element", name: part.name, index: element.index, append: false, value: part.alternate! }, state, operandIO);
            const assigned = store.get(part.name)!;
            const assignedIndex = assigned.associative ? await this.arrayIndex(assigned, element.index, state, io, store.owner) : index;
            return assignedIndex === undefined ? "" : assigned.getValue(assignedIndex) ?? "";
          }
          const alternate = concatShellValues(await this.valueWord(part.alternate!, state, operandIO, false, false, hereString, false, undefined, hereDocument), io[valueScope]);
          if (operator === "?") throw new ParameterExpansionFailure(`${part.name}: ${shellValueText(alternate) || (part.operator.startsWith(":") ? "parameter null or not set" : "parameter not set")}`, io.diagnosticLine ?? part.line);
          return alternate;
        }
        return operator === "+" ? "" : value ?? "";
      }
      this.requireParameter(value === undefined ? undefined : shellValueText(value), part.name, state, io, part.line);
      if (part.length) return this.valueLength(value ?? "", state, io);
      if (part.substring) return this.substring(part, value === undefined ? undefined : shellValueText(value), state, io);
      if (part.transform) return part.transform === "a" || part.transform === "A" || part.transform === "K" || part.transform === "k" ? this.variableMetaTransform(part, state, io) : value === undefined ? "" : this.transformValue(value, part.transform, state, io);
      if (part.operator) return this.parameterPattern(part, value ?? "", state, io, hereString);
      return value ?? "";
    }
    if (part.kind === "variable" && (part.transform === "a" || part.transform === "A" || part.transform === "K" || part.transform === "k")) {
      return this.variableMetaTransform(part, state, io);
    }
    if (part.kind === "variable" && (part.transform || memberPatternOperators.includes(part.operator ?? ""))) {
      const selector = getArraySelector(part);
      if (selector?.kind === "members" || part.name === "@" || part.name === "*") {
        const members = selector ? await this.arrayMembers(part.name, state, io, part.keys) : this.positionalValues(state);
        const ifs = state.variables.IFS ?? " ";
        const separator = ifs.length ? String.fromCodePoint(ifs.codePointAt(0)!) : "";
        const fragments: ShellValue[] = [];
        let bytes = 0;
        for (const member of members) {
          const value = part.transform ? await this.transformValue(member, part.transform, state, io) : await this.parameterPattern(part, member, state, io, hereString);
          bytes += shellValueByteLength(value) + (fragments.length ? Buffer.byteLength(separator) : 0);
          if (bytes > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
          io[valueScope]?.reserve(32, 0);
          if (fragments.length) fragments.push(separator);
          fragments.push(value);
        }
        return concatShellValues(fragments, io[valueScope]);
      }
      const binding = arrayStore(state)?.get(part.name);
      if (selector?.kind === "element" && binding?.associative) {
        const holding = binding.owner.hold();
        try {
          const index = await this.arrayIndex(binding, selector.index, state, io, binding.owner);
          const value = index === undefined ? undefined : binding.getValue(index);
          this.requireParameter(index === undefined ? undefined : binding.get(index), part.name, state, io);
          if (value === undefined) return "";
          const owned = shellValueFromBytes(shellValueBytes(value, io[valueScope]), io[valueScope]);
          return part.transform ? this.transformValue(owned, part.transform, state, io) : this.parameterPattern(part, owned, state, io, hereString);
        } finally { holding.release(); }
      }
      const base: Extract<WordPart, { kind: "variable" }> = { ...part };
      delete base.transform;
      if (!part.transform) { delete base.operator; delete base.alternate; }
      copyArraySelector(part, base);
      const existing = part.indirect && state.variableAttributes?.get(part.name)?.includes("n") ? state.variables[part.name]
        : selector?.kind === "element" ? arrayStore(state)?.get(part.name)?.get(numericIndex(selector.index) ?? -1) ?? (numericIndex(selector.index) === 0 ? this.variable(state, part.name) : undefined)
        : /^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(part.name) ? this.variable(state, part.name)
        : /^[1-9][0-9]*$/u.test(part.name) ? state.positional[Number(part.name) - 1] : "";
      const value = await this.valuePart(base, state, io, hereString, split, hereDocument);
      return existing === undefined ? "" : part.transform ? this.transformValue(value, part.transform, state, io) : this.parameterPattern(part, value, state, io, hereString);
    }
    if (part.kind === "variable" && part.prefixNames) {
      const ifs = state.variables.IFS ?? " ";
      const separator = io.nameExpansionContext === "document" || io.nameExpansionContext === "conditional" && part.prefixNames === "@"
        ? " " : ifs.length ? String.fromCodePoint(ifs.codePointAt(0)!) : "";
      const fragments: string[] = [];
      let bytes = 0;
      for await (const name of this.prefixNames(part.name, state)) {
        const join = fragments.length ? separator : "";
        bytes += Buffer.byteLength(name) + Buffer.byteLength(join);
        if (bytes > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
        io[valueScope]?.reserve((name.length + join.length) * 2 + 32, 0);
        fragments.push(join, name);
      }
      io[valueScope]?.reserve(bytes * 2, 0);
      return fragments.join("");
    }
    const binding = part.kind === "variable" ? arrayStore(state)?.get(part.name) : undefined;
    const holding = binding ? requireArrays(state).owner.hold() : undefined;
    const selector = getArraySelector(part);
    if (selector?.kind === "element" && binding?.associative) {
      try {
        const index = await this.arrayIndex(binding, selector.index, state, io, binding.owner);
        const token = index === undefined ? undefined : binding.values.get(index)?.text;
        this.requireParameter(token?.value, part.kind === "variable" ? part.name : "", state, io);
        if (part.kind === "variable" && part.length) return this.valueLength(token?.shellValue ?? "", state, io);
        return token?.shellValue ? shellValueFromBytes(shellValueBytes(token.shellValue, io[valueScope]), io[valueScope]) : token?.value ?? "";
      } finally { holding?.release(); }
    }
    const index = selector?.kind === "element" ? numericIndex(selector.index, 4294967295) : binding?.associative ? binding.keys.get("30")?.index : 0;
    const token = index === undefined || selector && selector.kind !== "element" ? undefined : binding?.values.get(index)?.text;
    token?.retain();
    try {
      if (token && part.kind === "variable" && part.operator && ["#", "##", "%", "%%"].includes(part.operator)) return this.parameterPattern(part, token.shellValue, state, io, hereString);
      if (token?.shellValue && part.kind === "variable" && !part.length && !part.operator && !part.substring) return shellValueFromBytes(shellValueBytes(token.shellValue, io[valueScope]), io[valueScope]);
      const value = await this.partValue(part, state, io, hereString, split, hereDocument);
      if (binding) await textToken(requireArrays(state).owner, value, this.signal);
      return value;
    } finally { token?.release(); holding?.release(); }
  }

  private parameterOperandIO(word: Word, state: State, io: IO): IO {
    this.signal.throwIfAborted();
    const parameterDepth = (io.parameterDepth ?? 0) + 1;
    if (state.depth + parameterDepth > 64) throw new ShellSyntaxError("Syntax nesting exceeds 64", word.offset);
    return { ...io, parameterDepth };
  }

  private async variableMetaTransform(part: Extract<WordPart, { kind: "variable" }>, state: State, io: IO): Promise<ShellValue> {
    const name = this.referenceName(state, part.name);
    const binding = arrayStore(state)?.get(name);
    const attributes = state.variableAttributes?.get(name) ?? "";
    const flags = [..."aAilnrux"].filter(flag =>
      flag === "a" ? Boolean(binding && !binding.associative)
      : flag === "A" ? Boolean(binding?.associative)
      : flag === "r" ? Boolean(state.readonlyVariables?.has(name))
      : flag === "x" ? Boolean(state.exported.has(name))
      : attributes.includes(flag)
    ).join("");
    const hasBindingOrVar = Boolean(binding) || Object.hasOwn(state.variables, name) || state.variableAttributes?.has(name) || state.exported.has(name) || state.readonlyVariables?.has(name);
    if (part.transform === "a") {
      return hasBindingOrVar ? flags : "";
    }
    if (part.transform === "A") {
      if (!hasBindingOrVar) return "";
      if (binding) {
        const pairs: string[] = [];
        for (const idx of [...binding.values.keys()].sort((l, r) => l - r)) {
          const k = binding.associative ? binding.keys.get(binding.keyByIndex.get(idx)!)!.text.value : String(idx);
          const v = shellValueText(binding.getValue(idx) ?? "");
          pairs.push(`[${binding.associative ? JSON.stringify(k) : k}]=${JSON.stringify(v)}`);
        }
        return `declare -${flags || "a"} ${name}=(${pairs.join(" ")})`;
      }
      const rawVal = state.variables[name];
      if (flags) return rawVal === undefined ? `declare -${flags} ${name}` : `declare -${flags} ${name}=${JSON.stringify(rawVal)}`;
      if (rawVal === undefined) return "";
      const quoted = shellValueText(await this.transformValue(rawVal, "Q", state, io));
      return `${name}=${quoted}`;
    }
    const selector = getArraySelector(part);
    if (binding) {
      const pairs: string[] = [];
      for (const idx of [...binding.values.keys()].sort((l, r) => l - r)) {
        const k = binding.associative ? binding.keys.get(binding.keyByIndex.get(idx)!)!.text.value : String(idx);
        const v = shellValueText(binding.getValue(idx) ?? "");
        if (part.transform === "K") {
          const qk = binding.associative ? shellValueText(await this.transformValue(k, "Q", state, io)) : k;
          pairs.push(`${qk} ${JSON.stringify(v)}`);
        } else {
          pairs.push(k, v);
        }
      }
      return pairs.join(" ");
    }
    const rawVal = this.variable(state, name);
    if (rawVal === undefined) return "";
    if (selector?.kind === "members") {
      return part.transform === "K" ? `0 ${JSON.stringify(rawVal)}` : `0 ${rawVal}`;
    }
    return part.transform === "K" ? this.transformValue(rawVal, "Q", state, io) : rawVal;
  }

  private async transformValue(value: ShellValue, operator: NonNullable<Extract<WordPart, { kind: "variable" }>["transform"]>, state: State, io: IO): Promise<ShellValue> {
    if (operator === "u" || operator === "U" || operator === "L") {
      const text = shellValueText(value);
      if (operator === "U") return text.toUpperCase();
      if (operator === "L") return text.toLowerCase();
      if (!text.length) return "";
      const first = [...text][0]!;
      return first.toUpperCase() + text.slice(first.length);
    }
    if (operator === "P") {
      const text = shellValueText(value)
        .replace(/\\n/gu, "\n")
        .replace(/\\r/gu, "\r")
        .replace(/\\t/gu, "\t")
        .replace(/\\[eE]/gu, "\x1b")
        .replace(/\\a/gu, "\x07")
        .replace(/\\\$/gu, "$")
        .replace(/\\\\/gu, "\\");
      const word = parseArithmeticExpansion(text, this.budget.parsing, byteLocale(state.variables), state.depth + (io.parameterDepth ?? 0), io.diagnosticLine ?? 1, state.extensions?.syntax);
      const fields = await this.valueWord(word, state, this.parameterOperandIO(word, state, io), false, false, true);
      return concatShellValues(fields, io[valueScope]);
    }
    const allocation = io[valueScope] ?? this.budget.values.scope();
    try {
      return await transformParameter(value, operator === "E" ? "E" : "Q", {
        maximumBytes: this.budget.limits.maxExpansionBytes, byteLocale: byteLocale(state.variables), allocation,
        work: { remaining: Math.min(Number.MAX_SAFE_INTEGER, this.budget.limits.maxExpansionBytes * 8 + 1024), signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") },
      });
    } finally { if (!io[valueScope]) allocation.close(); }
  }

  private async partValue(part: Exclude<WordPart, { kind: "text" }>, state: State, io: IO, hereString: boolean, split: boolean, hereDocument: boolean): Promise<ShellValue> {
    this.signal.throwIfAborted();
    if (part.kind === "compound-substitution-eof") {
      await writeDiagnostic(io.stderr, `${io.scriptName ?? "shell"}: command substitution: line ${io.diagnosticLine ?? part.line}: syntax error: unexpected end of file\n`);
      throw completedExit(2);
    }
    if (part.kind === "failed-parameter") throw new ExpansionFailure(`${part.source}: bad substitution`, io.diagnosticLine ?? part.line);
    if (part.kind === "failed-substitution") {
      if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
      await writeDiagnostic(io.stderr, part.diagnostic);
      state.status = state.substitutionStatus = 2;
      return "";
    }
    if (part.kind === "arithmetic") {
      try { return String(await this.expandedArithmeticValue(part.expression, state, { ...io, diagnosticLine: io.diagnosticLine ?? part.line })); }
      catch (error) { this.rethrowArithmeticControl(error); throw new ExpansionFailure(message(error, this.budget.onInternalError), io.diagnosticLine ?? part.line); }
    }
    if (part.kind === "process-substitution") {
      if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
      this.signal.throwIfAborted();
      const tempPath = `/.procsub-${++nextProcessSubstitutionId}`;
      io[invocationScope].register(async () => {
        try { await this.sourceFs.rm(tempPath, { force: true }); } catch {}
      });
      if (part.direction === "<") {
        const capture = new Capture();
        const child = await cloneState(state, this.signal);
        child.isolated = true;
        child.extensions = forkExtensions(state.extensions, "substitution");
        if (state.profile !== "sh") child.errexit = false;
        delete child.redirectAssignments;
        child.depth++;
        child.loopDepth = 0;
        const references = new PipeDescriptorFrame(io[invocationScope]);
        const lifetime = new DescriptorLifetime();
        const captureIO = isolateIO({
          ...io,
          stdout: this.budget.sink(capture, this.signal),
          processSubstitutions: undefined,
        }, references);
        (captureIO.descriptors as Map<number, Descriptor>).set(1, { output: captureIO.stdout, lifetime });
        try {
          await this.run(part.script, child, captureIO);
        } finally {
          try {
            if (!references.closeSyncIfEmpty()) await references.close();
            if (!lifetime.releaseSyncIfIdle()) await lifetime.release();
          } finally {
            stateMonitor(child)?.closeValues();
          }
        }
        const pendingCapture = lifetime.settled();
        if (pendingCapture) await pendingCapture;
        await this.sourceFs.writeFile(tempPath, capture.takeBytes());
        io.processSubstitutions?.push(async () => {
          try { await this.sourceFs.rm(tempPath, { force: true }); } catch {}
        });
        return tempPath;
      }
      await this.sourceFs.writeFile(tempPath, new Uint8Array(0));
      io.processSubstitutions?.push(async () => {
        let bytes: Uint8Array = new Uint8Array(0);
        try {
          bytes = await this.sourceFs.readFile(tempPath);
        } catch {}
        finally {
          try { await this.sourceFs.rm(tempPath, { force: true }); } catch {}
        }
        const child = await cloneState(state, this.signal);
        child.isolated = true;
        child.extensions = forkExtensions(state.extensions, "substitution");
        if (state.profile !== "sh") child.errexit = false;
        delete child.redirectAssignments;
        child.depth++;
        child.loopDepth = 0;
        const prepared = prepareBytesInput(bytes, this.budget);
        const input = new ShellInput(prepared.source, this.budget, this.commandSignal, prepared.options);
        const lifetime = new DescriptorLifetime(async () => {
          try { await input.close(); }
          finally { await prepared.close(); }
        });
        const references = new PipeDescriptorFrame(io[invocationScope]);
        const childIO = isolateIO({
          ...io,
          stdin: input,
          stdinIsDefault: false,
          processSubstitutions: undefined,
        }, references);
        (childIO.descriptors as Map<number, Descriptor>).set(0, { input, stdinIsDefault: false, lifetime });
        try {
          await this.run(part.script, child, childIO);
        } finally {
          try {
            if (!references.closeSyncIfEmpty()) await references.close();
            if (!lifetime.releaseSyncIfIdle()) await lifetime.release();
          } finally {
            stateMonitor(child)?.closeValues();
          }
        }
      });
      return tempPath;
    }
    if (part.kind === "substitution") {
      if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
      this.signal.throwIfAborted();
      if (part.form === "dollar-parenthesis" && state.extensions?.checkpoints.length) await this.extensionCheckpoint("source-input-read", state, io);
      const parameterDepth = io.parameterDepth ?? 0;
      if (parameterDepth > 0 && state.depth + parameterDepth + 1 > 64) throw new ShellSyntaxError("Syntax nesting exceeds 64", 0);
      const capture = new Capture();
      const child = await cloneState(state, this.signal);
      child.isolated = true;
      child.extensions = forkExtensions(state.extensions, "substitution");
      if (state.profile !== "sh") child.errexit = false;
      for (const [name, value] of state.redirectAssignments ?? []) {
        await this.writeVariable(child, name, value, io);
        child.exported.add(name);
      }
      delete child.redirectAssignments;
      child.depth++;
      child.loopDepth = 0;
      const pipeline = part.script.lists.length === 1 && part.script.lists[0]!.pipelines.length === 1 ? part.script.lists[0]!.pipelines[0] : undefined;
      const command = pipeline && !pipeline.negate && pipeline.commands.length === 1 ? pipeline.commands[0] : undefined;
      const fileShortcut = command?.kind === "simple" && command.words.length === 0 && command.redirects.length === 1 && command.redirects[0]!.operator === "<";
      const warningLine = io.substitutionDiagnosticLine ?? io.diagnosticLine ?? part.line;
      let substitutionDiagnosticLines: Map<Command, number> | undefined;
      if (part.script.printedLines?.size) {
        substitutionDiagnosticLines = new Map<Command, number>();
        for (const [command, line] of part.script.printedLines) {
          substitutionDiagnosticLines.set(
            command,
            part.sourceLine === undefined ? warningLine + (command.line ?? part.line) - part.line : warningLine + line - 1,
          );
        }
      }
      const reprintedLines = part.sourceLine === undefined ? undefined : functionReprintedLines(part.script);
      const functionCommandLines = reprintedLines && new Map([...reprintedLines].map(([command, line]) => [command, warningLine + line - 1]));
      const references = new PipeDescriptorFrame(io[invocationScope]);
      const lifetime = new DescriptorLifetime();
      const captureIO = isolateIO({
        ...io,
        ...(substitutionDiagnosticLines === undefined ? { substitutionDiagnosticLines: undefined } : { substitutionDiagnosticLines }),
        diagnosticOffset: (io.diagnosticLine ?? part.line) - (part.sourceLine ?? part.line),
        functionCommandLines, diagnosticCommandLines: undefined, stdout: this.budget.sink(capture, this.signal),
      }, references);
      (captureIO.descriptors as Map<number, Descriptor>).set(1, { output: captureIO.stdout, lifetime });
      try { state.substitutionStatus = fileShortcut ? await this.runCommandIsolated(command, child, captureIO, true) : await this.run(part.script, child, captureIO); }
      finally {
        try {
          if (!references.closeSyncIfEmpty()) await references.close();
          if (!lifetime.releaseSyncIfIdle()) await lifetime.release();
        }
        finally { stateMonitor(child)?.closeValues(); }
      }
      const pendingCapture = lifetime.settled();
      if (pendingCapture) await pendingCapture;
      state.status = state.substitutionStatus;
      const bytes = capture.takeBytes();
      let length = bytes.length;
      if (bytes.includes(0)) {
        await writeDiagnostic(io.stderr, `${io.scriptName ?? "shell"}: line ${warningLine}: warning: command substitution: ignored null byte in input\n`);
        length = 0;
        for (const byte of bytes) if (byte !== 0) bytes[length++] = byte;
      }
      while (length && bytes[length - 1] === 10) length--;
      const sanitized = bytes.subarray(0, length);
      if (length === 0) return "";
      try { return fatalUtf8Decoder.decode(sanitized); }
      catch (error) {
        this.signal.throwIfAborted();
        if (!(error instanceof TypeError) || ("code" in error && error.code !== "ERR_ENCODING_INVALID_ENCODED_DATA")) throw error;
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
        const value = binding ? binding.getValue(index)
          : part.name === "FUNCNAME" && state.variables.FUNCNAME === undefined ? state.functionNames?.[index]
          : index === 0 && state.variables[part.name] !== undefined ? stateMonitor(state)?.values.get(part.name, state.variables[part.name]!) ?? state.variables[part.name] : undefined;
        if (["-", "+", ":-", ":+"].includes(part.operator ?? "")) {
          const missing = value === undefined || part.operator!.startsWith(":") && shellValueByteLength(value) === 0;
          const alternate = part.operator!.endsWith("+") ? !missing : missing;
          if (alternate) return concatShellValues(await this.valueWord(part.alternate!, state, io, false, false, hereString, false, undefined, hereDocument), io[valueScope]);
          return part.operator!.endsWith("+") ? "" : value ?? "";
        }
        this.requireParameter(value === undefined ? undefined : shellValueText(value), `${part.name}[${selector.index}]`, state, io, part.line);
        return part.length ? this.valueLength(value ?? "", state, io) : value ?? "";
      }
      if (part.length) return String(binding?.values.size ?? (part.name === "FUNCNAME" && state.variables.FUNCNAME === undefined ? state.functionNames?.length ?? 0 : state.variables[part.name] === undefined ? 0 : 1));
      const values = await this.arrayMembers(part.name, state, io, selector.kind === "keys" || part.keys === true, part.substring);
      const space = selector.kind === "keys" && (hereDocument || (selector.separator === "@"
        ? !part.quoted && !split || state.variables.IFS === ""
        : !part.quoted && split && state.variables.IFS === ""));
      return this.arrayJoin(store.owner, values, space ? " " : this.ifsSeparator(state, io));
    }
    if (part.substring && (part.name === "@" || part.name === "*")) {
      const values = await this.positionalSlice(part, state, io);
      const separator = part.name === "@" && !split || hereString && (part.name === "@" || !part.quoted) ? " " : this.ifsSeparator(state, io);
      return concatShellValues(values.flatMap((entry, index) => index ? [separator, entry] : [entry]), io[valueScope]);
    }
    const namerefName = part.indirect && state.variableAttributes?.get(part.name)?.includes("n");
    let value = namerefName ? state.variables[part.name] === undefined ? undefined : this.referenceName(state, part.name)
      : part.specialParameter ? specialValue === undefined ? undefined : shellValueText(specialValue)
      : part.name === "?" ? String(state.status)
      : part.name === "-" ? `${state.allexport ? "a" : ""}${state.errexit ? "e" : ""}${state.noglob ? "f" : ""}${state.noexec ? "n" : ""}${state.nounset ? "u" : ""}${state.braceexpand !== false ? "B" : ""}${state.noclobber ? "C" : ""}`
      : part.name === "#" ? String(state.positional.length)
      : part.name === "@" || part.name === "*" ? state.positional.join(hereString && (part.name === "@" || !part.quoted) ? " " : Array.from(state.variables.IFS ?? " ")[0] ?? "")
      : /^0+$/u.test(part.name) ? state.arg0 ?? "virtual-bash"
      : /^\d+$/u.test(part.name) ? state.positional[Number(part.name) - 1]
      : part.name === "LINENO" ? (state.extensions ? String(io.diagnosticLine ?? part.line ?? 1) : state.variables.LINENO ?? String(io.diagnosticLine ?? part.line ?? 1)) : this.variable(state, part.name);
    let retained: ShellValue | undefined = part.specialParameter ? specialValue : value;
    if (value !== undefined && !namerefName) {
      if (/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(part.name)) {
        const name = this.referenceName(state, part.name);
        const binding = arrayStore(state)?.get(name);
        const index = binding?.associative ? binding.keys.get("30")?.index ?? -1 : 0;
        retained = binding?.getValue(index) ?? stateMonitor(state)?.values.get(name, value) ?? value;
      }
      else if (/^0+$/u.test(part.name)) retained = stateMonitor(state)?.positionals.get(zeroPositionKey, value) ?? value;
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
      if (["#", "##", "%", "%%", "^", "^^", ",", ",,"].includes(part.operator) || part.operator.startsWith("/")) {
        this.requireParameter(value, part.name, state, io, part.line);
        return this.parameterPattern(part, retained ?? "", state, io, hereString);
      }
      const missing = value === undefined || (part.operator.startsWith(":") && value === "");
      const operator = part.operator.at(-1)!;
      if ((operator === "+" && !missing) || (operator !== "+" && missing)) {
        const operandIO = this.parameterOperandIO(part.alternate!, state, io);
        let alternate: string;
        if (operator === "=" && arrayStore(state)?.get(part.name)) {
          alternate = "";
          await this.arrayZero(state, part.name, io, async () => {
            retained = await this.arrayJoin(requireArrays(state).owner, await this.valueWord(part.alternate!, state, operandIO, false, false, hereString, false, undefined, hereDocument), "");
            return retained;
          });
          value = shellValueText(retained!);
          return part.length ? this.valueLength(retained!, state, io) : retained!;
        }
        retained = concatShellValues(await this.valueWord(part.alternate!, state, operandIO, false, false, hereString, false, undefined, hereDocument), io[valueScope]);
        alternate = shellValueText(retained);
        if (operator === "?") throw new ParameterExpansionFailure(`${part.name}: ${alternate || (part.operator.startsWith(":") ? "parameter null or not set" : "parameter not set")}`, io.diagnosticLine ?? part.line);
        if (operator === "=") {
          if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(part.name)) throw new PublicDiagnostic("Cannot assign special parameter");
          await this.writeVariable(state, part.name, retained, io);
        }
        value = alternate;
      } else if (operator === "+") { value = ""; retained = ""; }
    } else this.requireParameter(value, part.name, state, io, part.line);
    return part.length ? this.valueLength(retained ?? "", state, io) : retained ?? "";
  }

  private async valueLength(value: ShellValue, state: State, io: IO): Promise<string> {
    const limit = this.budget.limits.maxExpansionBytes;
    const work = { remaining: Math.min(Number.MAX_SAFE_INTEGER, limit * 4 + 1024), signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") };
    if (typeof value === "string") {
      const scanned = await scanString(value, work);
      if (scanned.bytes > limit) this.budget.fail("maxExpansionBytes");
      return String(byteLocale(state.variables) ? scanned.bytes : scanned.count);
    }
    if (shellValueByteLength(value) > limit) this.budget.fail("maxExpansionBytes");
    const bytes = shellValueBytes(value, io[valueScope]);
    if (byteLocale(state.variables)) return String(bytes.length);
    let length = 0;
    for (let offset = 0; offset < bytes.length; offset += shellCharacterWidth(bytes, offset, false)) {
      length++;
      const pending = stringCheckpoint(work);
      if (pending) await pending;
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
      try { return { value: await this.shellArithmetic(prepareArithmetic(source, this.budget.parsing), state, io, variables), source }; }
      catch (error) {
        this.rethrowArithmeticControl(error);
        throw new ExpansionFailure(`${part.name}: ${message(error, this.budget.onInternalError)}`, line);
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

  async parameterPattern(part: Extract<WordPart, { kind: "variable" }>, value: ShellValue, state: State, io: IO, hereString: boolean): Promise<ShellValue> {
    const limit = this.budget.limits.maxExpansionBytes;
    if (shellValueByteLength(value) > limit) this.budget.fail("maxExpansionBytes");
    const scratch = this.budget.values.scope();
    const work = { remaining: Math.min(Number.MAX_SAFE_INTEGER, limit * 4 + 1024), signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes"), allocation: scratch };
    try {
    if (!part.operator!.startsWith("/")) {
      const parts: { value: ShellValue; literal: boolean }[] = [];
      await this.valueWord(part.alternate!, state, this.parameterOperandIO(part.alternate!, state, io), false, true, hereString, false, (_text, literal, original) => {
        scratch.reserveBytes(64);
        parts.push({ value: original, literal });
      });
      return await trimParameter(value, parts, part.operator!, byteLocale(state.variables), work, io[valueScope], limit, !!state.extglob);
    }
    const text = shellValueText(value);
    const patternFields = await this.word(part.alternate!, state, this.parameterOperandIO(part.alternate!, state, io), false, true, hereString);
    let patternUnits = 0;
    for (const field of patternFields) {
      const pending = stringCheckpoint(work, field.length + 1);
      if (pending) await pending;
      patternUnits += field.length;
    }
    scratch.reserve(patternUnits * 2, 0);
    const pattern = patternFields.join("");
    await scanString(text, work);
    const boundaries = await compilePatternBoundaries(pattern, work, !!state.nocasematch, !!state.extglob);
    const operator = part.operator!;
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
    const ends = await boundaries(text, false, operator === "/%");
    let position = 0;
    while (position <= text.length) {
      let found = false;
      for (let start = position; start <= text.length; start = nextCodePointOffset(text, start)) {
        if (operator === "/#" && start !== 0) break;
        const pending = stringCheckpoint(work);
        if (pending) await pending;
        const end = ends[start]!;
        if (end < 0) {
          if (start === text.length) break;
          continue;
        }
        await append(text, position, start);
        for (const replacement of replacements) {
          if (replacement.quoted) await append(replacement.value);
          else {
            let fragment = 0;
            for (let cursor = 0; cursor < replacement.value.length; cursor++) {
              const pending = stringCheckpoint(work);
              if (pending) await pending;
              if (replacement.value[cursor] === "\\" && ["&", "\\"].includes(replacement.value[cursor + 1] ?? "")) {
                await append(replacement.value, fragment, cursor);
                await append(replacement.value, cursor + 1, cursor + 2);
                cursor++;
                fragment = cursor + 1;
                continue;
              }
              if (replacement.value[cursor] !== "&") continue;
              await append(replacement.value, fragment, cursor);
              await append(text, start, end);
              fragment = cursor + 1;
            }
            await append(replacement.value, fragment);
          }
        }
        position = end;
        found = true;
        if (operator !== "//" || end === text.length) { await append(text, end); return result; }
        if (end === start) {
          position = nextCodePointOffset(text, end);
          await append(text, end, position);
        }
        break;
      }
      if (!found) {
        if (position === 0) return text;
        await append(text, position);
        break;
      }
    }
    return result;
    } finally { scratch.close(); }
  }

  async word(word: Word, state: State, io: IO, split = true, pattern = false, hereString = false, conditionalPattern = false, regexAppend?: (text: string, literal: boolean, value: ShellValue) => void): Promise<string[]> {
    return (await this.valueWord(word, state, io, split, pattern, hereString, conditionalPattern, regexAppend)).map(shellValueText);
  }

  private fastValueWord(word: Word, state: State, io: IO, split: boolean, pattern: boolean, hereDocument: boolean, braces: boolean, assignmentStart?: number, overrideDiagnosticLine?: number): ShellValue | undefined {
    const monitor = stateMonitor(state);
    const rawState = monitor ? monitor.raw : state;
    if (pattern || word.parts.length === 0 || rawState.variableAttributes?.size || guestArrays(state)) return undefined;
    const rawVars = rawState.variables;
    this.signal.throwIfAborted();
    let out = "";
    for (let i = 0; i < word.parts.length; i++) {
      const part = word.parts[i]!;
      if (part.kind === "text") {
        if (part.byteValue || invokedValues.has(part)) return undefined;
        if (!part.quoted) {
          if (braces && rawState.braceexpand !== false && part.value.includes("{")) return undefined;
          if (!hereDocument && (i === 0 && part.value.startsWith("~") || assignmentStart !== undefined && part.value.includes("~"))) return undefined;
          if (split && !rawState.noglob && hasGlobOrEscape(part.value, !!rawState.extglob)) return undefined;
        }
        out += part.value;
      } else if (part.kind === "variable") {
        if (split && !part.quoted && ((rawVars.IFS !== undefined && rawVars.IFS !== " \t\n") || this.budget.limits.maxExpansionBytes !== Infinity)) return undefined;
        if (part.indirect || part.prefixNames || part.specialParameter || part.length || part.substring || part.transform) return undefined;
        if (part.name === "@" || part.name === "*" || part.name === "PIPESTATUS" || part.name === "LINENO" || part.name === "_" || part.name === "FUNCNAME") return undefined;
        if (getArraySelector(part) !== undefined || !isShellIdentifier(part.name)) return undefined;
        if (part.operator !== undefined) {
          if (
            (part.operator === "#" || part.operator === "##" || part.operator === "%" || part.operator === "%%") &&
            part.alternate?.parts.length === 1 &&
            part.alternate.parts[0]!.kind === "text" &&
            !part.alternate.parts[0]!.byteValue
          ) {
            const patPart = part.alternate.parts[0]!;
            const pat = patPart.value;
            if (!patPart.quoted && hasGlobOrEscape(pat, !!rawState.extglob)) return undefined;
            const raw = rawVars[part.name];
            this.requireParameter(raw, part.name, state, io, part.line ?? overrideDiagnosticLine);
            if (raw === undefined) {
              if (split && !part.quoted) return undefined;
              continue;
            }
            const val = this._syncArithRawWriteOnly && this._syncArithTouched?.has(part.name) ? raw : (monitor?.values.get(part.name, raw) ?? raw);
            if (typeof val !== "string") return undefined;
            const byteMode = byteLocale(rawVars);
            if (!isWellFormedString(val, byteMode) || !isWellFormedString(pat, byteMode)) return undefined;
            const sliced = part.operator === "#" || part.operator === "##"
              ? (val.startsWith(pat) ? val.slice(pat.length) : val)
              : (val.endsWith(pat) ? val.slice(0, val.length - pat.length) : val);
            if (split && !part.quoted) {
              if (sliced.length === 0 || sliced.includes(" ") || sliced.includes("\t") || sliced.includes("\n") || (!rawState.noglob && hasGlobOrEscape(sliced, !!rawState.extglob))) {
                return undefined;
              }
            }
            out += sliced;
            continue;
          }
          return undefined;
        }
        const raw = rawVars[part.name];
        this.requireParameter(raw, part.name, state, io, part.line ?? overrideDiagnosticLine);
        const val = raw === undefined ? "" : (this._syncArithRawWriteOnly && this._syncArithTouched?.has(part.name) ? raw : (monitor?.values.get(part.name, raw) ?? raw));
        if (typeof val !== "string") return undefined;
        if (split && !part.quoted) {
          if (val.length === 0 || val.includes(" ") || val.includes("\t") || val.includes("\n") || (!rawState.noglob && hasGlobOrEscape(val, !!rawState.extglob))) {
            return undefined;
          }
        }
        out += val;
      } else if (part.kind === "arithmetic") {
        if (split && !part.quoted && rawVars.IFS !== undefined && rawVars.IFS !== " \t\n") return undefined;
        if (part.expression.error || part.expression.hasSubscript) return undefined;
        const line = overrideDiagnosticLine ?? io.diagnosticLine ?? part.line;
        try {
          out += this.syncShellArithmeticString(part.expression, state, line);
        } catch (error) {
          this.rethrowArithmeticControl(error);
          throw new ExpansionFailure(message(error, this.budget.onInternalError), line);
        }
      } else if (part.kind === "substitution") {
        if (split && !part.quoted) return undefined;
        const substVal = this.tryFastPureSubstitution(part, state, rawState, io);
        if (substVal === undefined) return undefined;
        out += substVal;
      } else {
        return undefined;
      }
    }
    if (this.budget.maxExpansionFieldsSmi < 1 && 1 > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
    const maxBytesSmi = this.budget.maxExpansionBytesSmi;
    if (out.length * 3 > maxBytesSmi && shellValueByteLength(out) > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
    return out;
  }

  private arePureArgWords(words: readonly Word[], rawState: State): boolean {
    for (let i = 0; i < words.length; i++) {
      if (!this.isPureArgWord(words[i]!, rawState)) return false;
    }
    return true;
  }

  private isPureArgWord(word: Word, rawState: State): boolean {
    if (word.parts.length === 0) return false;
    for (let i = 0; i < word.parts.length; i++) {
      const p = word.parts[i]!;
      if (p.kind === "text") continue;
      if (p.kind === "variable") {
        if (
          p.indirect ||
          p.prefixNames ||
          p.specialParameter ||
          p.length ||
          p.substring ||
          p.transform ||
          p.operator !== undefined ||
          p.name === "@" ||
          p.name === "*" ||
          getArraySelector(p) !== undefined ||
          !isShellIdentifier(p.name)
        ) {
          return false;
        }
        if (rawState.nounset && rawState.variables[p.name] === undefined) return false;
        continue;
      }
      if (p.kind === "arithmetic") {
        if (p.expression.error || p.expression.hasSubscript || p.expression.hasMutation || rawState.nounset) return false;
        continue;
      }
      return false;
    }
    return true;
  }

  private tryFastPureSubstitution(part: Extract<WordPart, { kind: "substitution" }>, state: State, rawState: State, io: IO): string | undefined {
    if (this.middleware.length > 0) return undefined;
    if (rawState.depth >= this.budget.maxSubstitutionDepthSmi && rawState.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
    this.signal.throwIfAborted();
    const parameterDepth = io.parameterDepth ?? 0;
    if (parameterDepth > 0 && rawState.depth + parameterDepth + 1 > 64) throw new ShellSyntaxError("Syntax nesting exceeds 64", 0);
    if (
      rawState.noexec ||
      hasActiveExtensions(rawState) ||
      rawState.extensions?.checkpoints.length ||
      rawState.variableAttributes?.size ||
      guestArrays(state) ||
      rawState.redirectAssignments?.size
    ) {
      return undefined;
    }
    if (((this.budget.commands + 1) & 127) === 0) {
      if (hasYieldCheckpoint(this.signal) || ((this.budget.commands + 1) & 2047) === 0) return undefined;
      runYieldCheckpoint(this.signal);
    }
    if (part.script.lists.length !== 1) return undefined;
    const list = part.script.lists[0]!;
    if (list.terminator || list.pipelines.length !== 1) return undefined;
    const pipeline = list.pipelines[0]!;
    if (pipeline.negate || pipeline.commands.length !== 1) return undefined;
    const cmd = pipeline.commands[0]!;
    if (cmd.kind !== "simple" || cmd.redirects.length > 0 || cmd.words.length === 0) return undefined;
    const w0Plain = cmd.words[0]!.plain;
    if (!w0Plain || rawState.functions.has(w0Plain) || rawState.extensions?.builtins.has(w0Plain)) return undefined;
    if (w0Plain !== "printf" && w0Plain !== "echo") return undefined;
    const def = this.commands.get(w0Plain);
    if (!def) return undefined;
    if (w0Plain === "printf" && def.execute !== printfCommand.execute) return undefined;
    if (w0Plain === "echo" && !defaultEchoExecutors.has(def.execute)) return undefined;
    if (cmd.words.length > this.budget.maxExpansionFieldsSmi && cmd.words.length > this.budget.limits.maxExpansionFields) return undefined;
    for (let i = 0; i < cmd.words.length; i++) {
      if (!this.isPureArgWord(cmd.words[i]!, rawState)) return undefined;
    }
    if (w0Plain === "echo" && cmd.words.length <= 2) {
      let val = "";
      if (cmd.words.length === 2) {
        const wVal = this.fastValueWord(cmd.words[1]!, state, io, true, false, false, true, undefined, part.line);
        if (typeof wVal !== "string" || wVal.startsWith("-") || wVal.includes("\0")) return undefined;
        val = wVal;
      }
      const byteLength = (val.length * 3 > 127 ? Buffer.byteLength(val) : val.length) + 1;
      const nextBytes = this.budget.bytes + byteLength;
      if (nextBytes > this.budget.maxOutputBytesSmi && byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) {
        this.budget.fail("maxOutputBytes");
      }
      this.budget.bytes = nextBytes;
      this.budget.tick();
      rawState.substitutionStatus = 0;
      rawState.status = 0;
      let end = val.length;
      while (end > 0 && val.charCodeAt(end - 1) === 10) end--;
      return end === val.length ? val : val.slice(0, end);
    }
    if (
      w0Plain === "printf" &&
      cmd.words.length === 3 &&
      cmd.words[1]!.parts.length === 1 &&
      cmd.words[1]!.parts[0]!.kind === "text" &&
      cmd.words[1]!.parts[0]!.value === "%d" &&
      cmd.words[2]!.parts.length === 1 &&
      cmd.words[2]!.parts[0]!.kind === "arithmetic"
    ) {
      const val = this.fastValueWord(cmd.words[2]!, state, io, true, false, false, true, undefined, part.line);
      if (typeof val !== "string") return undefined;
      const nextBytes = this.budget.bytes + val.length;
      if (nextBytes > this.budget.maxOutputBytesSmi && val.length > this.budget.limits.maxOutputBytes - this.budget.bytes) {
        this.budget.fail("maxOutputBytes");
      }
      this.budget.bytes = nextBytes;
      this.budget.tick();
      rawState.substitutionStatus = 0;
      rawState.status = 0;
      return val;
    }
    fastSubScratchArgs.length = 0;
    for (let i = 1; i < cmd.words.length; i++) {
      const val = this.fastValueWord(cmd.words[i]!, state, io, true, false, false, true, undefined, part.line);
      if (typeof val !== "string") {
        fastSubScratchArgs.length = 0;
        return undefined;
      }
      fastSubScratchArgs.push(val);
    }
    let formatted: string | undefined;
    if (w0Plain === "printf") {
      formatted = tryFastPrintf(fastSubScratchArgs);
    } else {
      if (fastSubScratchArgs[0]?.startsWith("-")) {
        fastSubScratchArgs.length = 0;
        return undefined;
      }
      formatted = `${fastSubScratchArgs.join(" ")}\n`;
      if (formatted.includes("\0")) return undefined;
    }
    fastSubScratchArgs.length = 0;
    if (formatted === undefined) return undefined;
    const byteLength = formatted.length * 3 > 127 ? Buffer.byteLength(formatted) : formatted.length;
    const nextBytes = this.budget.bytes + byteLength;
    if (nextBytes > this.budget.maxOutputBytesSmi && byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) {
      this.budget.fail("maxOutputBytes");
    }
    this.budget.bytes = nextBytes;
    this.budget.tick();
    rawState.substitutionStatus = 0;
    rawState.status = 0;
    let end = formatted.length;
    while (end > 0 && formatted.charCodeAt(end - 1) === 10) end--;
    return end === formatted.length ? formatted : formatted.slice(0, end);
  }

  private async valueWord(word: Word, state: State, io: IO, split = true, pattern = false, hereString = false, conditionalPattern = false, regexAppend?: (text: string, literal: boolean, value: ShellValue) => void, hereDocument = false, braces = split && !pattern && !hereString && !hereDocument, assignmentStart?: number): Promise<ShellValue[]> {
    if (!conditionalPattern && !regexAppend) {
      const fast = this.fastValueWord(word, state, io, split, pattern, hereDocument, braces, assignmentStart);
      if (fast !== undefined) return [fast];
      if (!split && !pattern && word.parts.length === 1 && !state.variableAttributes?.size && !guestArrays(state)) {
        const part = word.parts[0]!;
        if (part.kind === "arithmetic" || (part.kind === "variable" && !part.indirect && !part.prefixNames && !part.specialParameter && part.name !== "@" && part.name !== "*" && getArraySelector(part) === undefined && !["-", "+", ":-", ":+"].includes(part.operator ?? "") && isShellIdentifier(part.name))) {
          const val = await this.valuePart(part, state, io, hereString, false, hereDocument);
          if (1 > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
          const maxBytes = this.budget.limits.maxExpansionBytes;
          if ((typeof val !== "string" || val.length * 3 > maxBytes) && shellValueByteLength(val) > maxBytes) this.budget.fail("maxExpansionBytes");
          if (typeof val !== "string") io[valueScope]?.hold(val);
          return [val];
        }
      }
    }
    if (braces && state.braceexpand !== false && word.parts.some(part => part.kind === "text" && !part.quoted && part.value.includes("{"))) {
      const fields: ShellValue[] = [];
      let bytes = 0;
      for await (const expanded of expandBraces(word, this.budget, this.signal)) {
        const values = await this.valueWord(expanded, state, io, split, pattern, hereString, conditionalPattern, regexAppend, hereDocument, false, assignmentStart);
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
    const arrayOwned = word.parts.some(part => part.kind === "variable" && !part.prefixNames && (getArraySelector(part) !== undefined || arrayStore(state)?.get(part.name) !== undefined));
    const prefixOwned = word.parts.some(part => part.kind === "variable" && (part.prefixNames === "@" || (part.transform || memberPatternOperators.includes(part.operator ?? "")) && part.name === "@"));
    const positionalOwned = split && word.parts.some(part => part.kind === "variable" && part.name === "@" && part.quoted && !part.length && (!part.operator || defaultParameterOperators.includes(part.operator)) && !part.transform);
    const owner = arrayOwned ? requireArrays(state).owner : undefined;
    const holding = owner?.hold();
    const scratch = !owner && split && state.variables.IFS !== "" && word.parts.some(part => !part.quoted && part.kind !== "text")
      ? this.budget.values.scope() : undefined;
    try {
    if (owner) await this.prepareArrayObservers(state, owner);
    owner?.reserve({ metadata: 128 + word.parts.length * 32, allocatedSlots: word.parts.length + 1, work: word.parts.length + 5 });
    scratch?.reserve(word.parts.length * 32, 0);
    const fields: { fragments: ShellValue[]; bytes: boolean; patterns: string[] | undefined; present: boolean; independentPresence: boolean; quoteGroups?: object[] }[] = [];
    let emptyNameGroups: Set<object> | undefined;
    let quoteGroup: object | undefined;
    let splitBoundary = false;
    const addField = (): void => {
      splitBoundary = false;
      if (fields.length >= this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
      scratch?.reserve(32, 0);
      owner?.reserve({ metadata: 32, allocatedSlots: 1, work: 3 });
      fields.push({ fragments: [], bytes: false, patterns: undefined, present: false, independentPresence: false });
    };
    addField();
    let expansionBytes = 0;
    const append = (value: ShellValue, glob: boolean, present: boolean) => {
      if (splitBoundary && present) addField();
      const text = shellValueText(value);
      const size = shellValueByteLength(value);
      if (size > this.budget.limits.maxExpansionBytes - expansionBytes) this.budget.fail("maxExpansionBytes");
      expansionBytes += size;
      const field = fields.at(-1)!;
      let escapes = 0;
      if (!glob) {
        const special = (conditionalPattern || state.extglob) ? "\\*?[]-^()|+!@:" : "\\*?[]-^!:";
        for (const character of text) if (special.includes(character)) escapes++;
      }
      scratch?.reserve(32, 0);
      if (owner) owner.reserve({ payload: size + (escapes ? size + escapes : 0), metadata: 64, work: text.length + 8 });
      if (escapes) {
        scratch?.reserve((field.patterns ? 32 : 32 * (field.fragments.length + 1)) + (text.length + escapes) * 2, 0);
        field.patterns ??= field.fragments.map(shellValueText);
        field.patterns.push(text.replace((conditionalPattern || state.extglob) ? /[\\*?[\]\-^()|+!@:]/gu : /[\\*?[\]\-^!:]/gu, "\\$&"));
      } else if (field.patterns) {
        scratch?.reserve(32, 0);
        field.patterns.push(text);
      }
      if (typeof value !== "string" || field.bytes) {
        if (!scratch) io[valueScope]?.reserve(32 * (field.bytes ? 1 : field.fragments.length + 1), field.bytes ? 1 : field.fragments.length + 1);
        if (typeof value !== "string") io[valueScope]?.hold(value);
        field.bytes = true;
      }
      regexAppend?.(text, !glob, value);
      field.fragments.push(value);
      field.present ||= present;
      if (present) {
        if (size > 0 || !quoteGroup) field.independentPresence = true;
        else {
          io[valueScope]?.reserve(32, 0);
          field.quoteGroups ??= [];
          field.quoteGroups.push(quoteGroup);
        }
      }
    };
    const appendSplit = async (value: ShellValue): Promise<void> => {
      this.budget.cpuCheckpoint();
      if (shellValueByteLength(value) === 0) return;
      const separators = state.variables.IFS ?? " \t\n";
      const retainedSeparators = stateMonitor(state)?.values.get("IFS", separators) ?? separators;
      let byteSeparators = false;
      if (byteLocale(state.variables) && typeof retainedSeparators === "string") {
        const work = this.splitWork ??= { scanned: 0 };
        for (let index = 0; index < retainedSeparators.length; index++) {
          if (retainedSeparators.charCodeAt(index) > 127) { byteSeparators = true; break; }
          if (++work.scanned >= 4096) { work.scanned = 0; await yieldTurn(this.signal); }
        }
      }
      if (typeof value !== "string" || typeof retainedSeparators !== "string" || byteSeparators) {
        for await (const piece of this.splitRawValue(value, retainedSeparators, io, byteLocale(state.variables))) {
          if (piece.separator) {
            if (!piece.whitespace) { splitBoundary = false; fields.at(-1)!.present = true; addField(); }
            else if (fields.at(-1)!.present) splitBoundary = true;
          } else {
            if (splitBoundary) addField();
            splitBoundary = false;
            append(piece.value, true, true);
          }
        }
        return;
      }
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
      for await (const piece of this.splitValue(value, points, asciiSeparators, io, scratch)) {
        const point = typeof piece === "string" ? piece.codePointAt(0) : undefined;
        if (typeof piece === "string" && point !== undefined && piece.length === (point > 0xffff ? 2 : 1) && points.has(point)) {
          if (!" \t\n".includes(piece)) {
            splitBoundary = false;
            fields.at(-1)!.present = true;
            addField();
          } else if (fields.at(-1)!.present) splitBoundary = true;
        } else {
          if (splitBoundary) addField();
          splitBoundary = false;
          append(piece, true, true);
        }
      }
      } finally { separatorScope.close(); }
    };
    const parts = (hereDocument ? word.parts : expandTildes(word.parts, state.variables, this.budget, assignmentStart)).map((part) => ({ part, splitText: false, io }));
    for (let index = 0; index < parts.length; index++) {
      let { part } = parts[index]!;
      const { splitText, io: partIO } = parts[index]!;
      part = await this.resolveParameter(part, state, partIO);
      quoteGroup = prefixNameQuoteGroups.get(part);
      const quotedPresence = part.quoted && !((arrayOwned || prefixOwned || positionalOwned) && isQuoteMarker(part));
      const selector = getArraySelector(part);
      const defaultMembers = part.kind === "variable" && defaultParameterOperators.includes(part.operator ?? "")
        ? selector?.kind === "members" ? await this.arrayMembers(part.name, state, partIO) : part.name === "@" ? this.positionalValues(state) : undefined : undefined;
      const expandMembers = !defaultMembers || defaultMembers.length > 0 && !(part.kind === "variable" && part.operator!.endsWith("+"));
      if (part.kind === "variable" && ["-", "+", ":-", ":+"].includes(part.operator ?? "") && (part.name === "@" || /^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(part.name))) {
        let value: ShellValue | undefined = part.indirect && state.variableAttributes?.get(part.name)?.includes("n")
          ? state.variables[part.name] === undefined ? undefined : this.referenceName(state, part.name)
          : this.variable(state, part.name);
        if (defaultMembers) {
          value = defaultMembers.length ? part.name === "@" && defaultMembers.length === 1 ? defaultMembers[0] : "set" : undefined;
        } else if (selector?.kind === "element") {
          const binding = arrayStore(state)?.get(part.name);
          const index = binding?.associative
            ? await this.arrayIndex(binding, selector.index, state, partIO, requireArrays(state).owner)
            : numericIndex(selector.index, 4294967295);
          if (index === undefined && !binding?.associative) throw new ArrayFailure("index outside 0..4294967295");
          value = binding ? index === undefined ? undefined : binding.getValue(index) : index === 0 ? value : undefined;
        }
        const missing = value === undefined || (part.operator!.startsWith(":") && shellValueByteLength(value) === 0);
        if (part.operator!.endsWith("+") ? !missing : missing) {
          const operandIO = this.parameterOperandIO(part.alternate!, state, partIO);
          scratch?.reserve(part.alternate!.parts.length * 32, 0);
          const alternate = (part.quoted ? part.alternate!.parts : expandTildes(part.alternate!.parts, state.variables, this.budget)).map((entry) => ({ part: copyArraySelector(entry, { ...entry, quoted: entry.quoted || part.quoted }), splitText: true, io: operandIO }));
          if (!alternate.length && part.quoted) append("", false, true);
          parts.splice(index + 1, 0, ...alternate);
          continue;
        }
      }
      if (part.kind === "variable" && part.prefixNames === "@" && split && (part.quoted || state.variables.IFS === "")) {
        let position = 0;
        for await (const name of this.prefixNames(part.name, state)) {
          if (position++) addField();
          append(name, !part.quoted, true);
        }
        if (position === 0 && quoteGroup) {
          io[valueScope]?.reserve(32, 0);
          emptyNameGroups ??= new Set<object>();
          emptyNameGroups.add(quoteGroup);
        }
      } else if (part.kind === "variable" && (part.transform === "a" || part.transform === "A" || part.transform === "K" || part.transform === "k")) {
        if (part.transform === "k" && selector?.kind === "members" && split && (part.quoted && selector.separator === "@" || !part.quoted)) {
          const name = this.referenceName(state, part.name);
          const binding = arrayStore(state)?.get(name);
          const tokens: string[] = [];
          if (binding) {
            for (const idx of [...binding.values.keys()].sort((l, r) => l - r)) {
              const k = binding.associative ? binding.keys.get(binding.keyByIndex.get(idx)!)!.text.value : String(idx);
              const v = shellValueText(binding.getValue(idx) ?? "");
              tokens.push(k, v);
            }
          } else if (state.variables[name] !== undefined) {
            tokens.push("0", state.variables[name]!);
          }
          for (let pos = 0; pos < tokens.length; pos++) {
            if (pos > 0) addField();
            append(tokens[pos]!, !part.quoted, true);
          }
        } else {
          const value = await this.variableMetaTransform(part, state, partIO);
          if (part.quoted || !split || state.variables.IFS === "") append(value, !part.quoted, quotedPresence || !split || shellValueByteLength(value) > 0);
          else await appendSplit(value);
        }
      } else if (part.kind === "variable" && split && expandMembers && (selector && selector.kind !== "element" && !part.length && (selector.kind === "members" ? !part.quoted || selector.separator === "@" : selector.separator === "@" && (part.quoted || state.variables.IFS === "")) || (part.transform || memberPatternOperators.includes(part.operator ?? "")) && part.name === "@" || (part.substring || !part.operator && !part.transform && !part.length) && !part.quoted && state.variables.IFS === "" && (part.name === "@" || part.name === "*"))) {
        const members = selector && selector.kind !== "element" ? await this.arrayMembers(part.name, state, io, selector.kind === "keys" || part.keys === true, part.substring) : part.substring ? await this.positionalSlice(part, state, partIO) : this.positionalValues(state);
        if (selector?.kind === "members" && !part.quoted && state.variables.IFS !== "" && !part.transform && !part.operator) {
          // Split the joined expansion so non-whitespace IFS retains empty member fields.
          await appendSplit(await this.arrayJoin(requireArrays(state).owner, members, this.ifsSeparator(state, partIO)));
          continue;
        }
        for (let position = 0; position < members.length; position++) {
          if (position > 0) addField();
          const original = members[position]!;
          const value = part.transform ? await this.transformValue(original, part.transform, state, partIO) : memberPatternOperators.includes(part.operator ?? "") ? await this.parameterPattern(part, original, state, partIO, hereString) : original;
          if (part.quoted || state.variables.IFS === "") append(value, !part.quoted, part.quoted || shellValueByteLength(value) > 0);
          else await appendSplit(value);
        }
        if ((part.transform || memberPatternOperators.includes(part.operator ?? "")) && members.length === 0 && quoteGroup) {
          io[valueScope]?.reserve(32, 0);
          emptyNameGroups ??= new Set<object>();
          emptyNameGroups.add(quoteGroup);
        }
      } else if (part.kind === "text" && !splitText) {
        const value: ShellValue = invokedValues.get(part) ?? part.byteValue ?? part.value;
        append(value, !part.quoted, quotedPresence || shellValueByteLength(value) > 0);
      } else if (part.kind === "variable" && part.name === "@" && part.quoted && !part.length && (!part.operator || defaultMembers && expandMembers) && !part.transform && split) {
        const members = part.substring ? await this.positionalSlice(part, state, partIO) : this.positionalValues(state);
        for (let position = 0; position < members.length; position++) {
          if (position > 0) addField();
          append(members[position]!, false, true);
        }
      } else {
        const value = part.kind === "text" ? part.byteValue ?? part.value : await this.valuePart(part, state, partIO, hereString, split, hereDocument);
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
      if (split && !field.independentPresence && field.quoteGroups) {
        const work: StringWork = { remaining: this.budget.limits.maxExpansionBytes, signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") };
        let empty = true;
        for (const group of field.quoteGroups) {
          const pending = stringCheckpoint(work);
          if (pending) await pending;
          if (!emptyNameGroups?.has(group)) { empty = false; break; }
        }
        if (empty) continue;
      }
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

  private async *splitRawValue(value: ShellValue, separators: ShellValue, io: IO, byteCount: boolean): AsyncGenerator<{ value: ShellValue; separator: boolean; whitespace: boolean }> {
    if (typeof value === "string" && typeof separators === "string" && !byteCount) {
      for (const character of value) yield { value: character, separator: separators.includes(character), whitespace: " \t\n".includes(character) };
      return;
    }
    const work = this.splitWork ??= { scanned: 0 };
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
      work.scanned += length;
      if (work.scanned >= 4096) { work.scanned = 0; await yieldTurn(this.signal); }
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
      work.scanned += length;
      if (work.scanned >= 4096) { work.scanned = 0; await yieldTurn(this.signal); }
    }
    if (start < bytes.length) yield { value: start === 0 ? value : shellValueFromBytes(bytes.subarray(start), io[valueScope]), separator: false, whitespace: false };
  }

  private positionalValues(state: State): ShellValue[] {
    return state.positional.map((text, index) => stateMonitor(state)?.positionals.get(String(index), text) ?? text);
  }

  private replacePositionals(state: State, values: readonly ShellValue[], action?: () => void, initialArg0?: ShellValue): void {
    const publish = action ?? (() => { state.positional = values.map(shellValueText); });
    const store = stateMonitor(state)?.positionals;
    if (store) {
      const zero = initialArg0 ?? store.get(zeroPositionKey, state.arg0 ?? "virtual-bash");
      const entries: (readonly [string, ShellValue])[] = values.map((value, index) => [String(index), value] as const);
      if (typeof zero !== "string") entries.push([zeroPositionKey, zero]);
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

  private async positionalSlice(part: Extract<WordPart, { kind: "variable" }>, state: State, io: IO): Promise<ShellValue[]> {
    const evaluate = async (word: Word): Promise<bigint> => {
      const fields = await this.valueWord(word, state, this.parameterOperandIO(word, state, io), false);
      const source = shellValueText(concatShellValues(fields, io[valueScope]));
      return this.arithmeticValue(prepareArithmetic(source || "0", this.budget.parsing), state, io);
    };
    let offset = await evaluate(part.substring!.offset);
    if (offset < 0n) offset += BigInt(state.positional.length + 1);
    if (offset < 0n || offset > BigInt(state.positional.length)) return [];
    const count = part.substring!.length ? await evaluate(part.substring!.length) : undefined;
    if (count !== undefined && count < 0n) throw new ExpansionFailure("substring expression < 0", io.diagnosticLine ?? part.line);
    if (count === 0n) return [];
    const end = count === undefined ? state.positional.length + 1 : Number(offset + count > BigInt(state.positional.length + 1) ? BigInt(state.positional.length + 1) : offset + count);
    const values: ShellValue[] = [];
    for (let index = Number(offset); index < end; index++) {
      if (values.length >= this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
      io[valueScope]?.reserve(32, 0);
      const text = index === 0 ? state.arg0 ?? "virtual-bash" : state.positional[index - 1]!;
      values.push(stateMonitor(state)?.positionals.get(index === 0 ? zeroPositionKey : String(index - 1), text) ?? text);
      if (index % 4096 === 0) await yieldTurn(this.signal);
    }
    return values;
  }

  async arrayMembers(name: string, state: State, io: IO, keys = false, substring?: Extract<WordPart, { kind: "variable" }>["substring"]): Promise<ShellValue[]> {
    const store = requireArrays(state);
    const holding = store.owner.hold();
    try {
    const binding = store.get(name);
    let offset = 0n;
    let count: bigint | undefined;
    if (substring) {
      const evaluate = async (word: Word): Promise<bigint> => {
        const fields = await this.valueWord(word, state, this.parameterOperandIO(word, state, io), false);
        const source = shellValueText(concatShellValues(fields, io[valueScope]));
        return this.arithmeticValue(prepareArithmetic(source || "0", this.budget.parsing), state, io);
      };
      offset = await evaluate(substring.offset);
      if (offset < 0n) offset += BigInt((binding?.maximum ?? (state.variables[name] === undefined ? -1 : 0)) + 1);
      if (substring.length) {
        count = await evaluate(substring.length);
        if (count < 0n) throw new ExpansionFailure("substring expression < 0", io.diagnosticLine);
      }
    }
    store.owner.reserve({ metadata: 64, work: 3 });
    if (offset < 0n || count === 0n) return [];
    if (!binding) {
      if (name === "FUNCNAME" && state.variables.FUNCNAME === undefined) {
        const stack = state.functionNames ?? [];
        const start = offset < 0n ? Math.max(0, stack.length + Number(offset)) : Number(offset);
        const end = count === undefined ? stack.length : start + Number(count);
        const sliced = stack.slice(start, end);
        return keys ? sliced.map((_v, idx) => String(start + idx)) : sliced;
      }
      const text = state.variables[name];
      const value = text === undefined ? undefined : keys ? "0" : stateMonitor(state)?.values.get(name, text) ?? text;
      if (value === undefined || offset > 0n) return [];
      store.owner.reserve({ metadata: 32, allocatedSlots: 1, work: 3 });
      await textToken(store.owner, value, this.signal);
      return [keys ? "0" : value];
    }
    binding.retain();
    try {
      const indices = await binding.indices(store.owner, this.signal);
      const values: ShellValue[] = [];
      for (const index of indices) {
        if (BigInt(index) < offset) continue;
        if (count !== undefined && BigInt(values.length) >= count) break;
        store.owner.reserve({ metadata: 32, allocatedSlots: 1, work: 4 });
        const value = keys ? binding.associative ? binding.keys.get(binding.keyByIndex.get(index)!)!.text.shellValue : String(index) : binding.getValue(index)!;
        await textToken(store.owner, value, this.signal);
        values.push(value);
        await store.owner.ledger.checkpoint(this.signal);
      }
      return values;
    } finally { await binding.release(); }
    } finally { holding.release(); }
  }

  private async recursiveGlob(value: string, pattern: string, state: State): Promise<string[]> {
    // Entry/state limits are invocation-wide, including hidden and nonmatching
    // entries. They are separate from the number of emitted expansion fields.
    const failWalk = (message: string): never => {
      const error = new FsError("EFBIG", { syscall: "glob", message });
      this.budget.abort(error);
      throw error;
    };
    const work: StringWork = { remaining: Math.min(Number.MAX_SAFE_INTEGER, this.budget.limits.maxExpansionBytes * 4 + 1024), signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") };
    const scratch = this.budget.values.scope();
    work.allocation = scratch;
    type Candidate = { path: string; bytes: number; descend: boolean; depth: number };
    try {
      const segments: string[] = [];
      let start = 0;
      for (let end = 0; end <= pattern.length; end++) {
        const pending = stringCheckpoint(work);
        if (pending) await pending;
        if (end !== pattern.length && pattern[end] !== "/") continue;
        if (end > start) {
          const bytes = (await scanString(pattern, work, start, end)).bytes;
          if (++this.budget.globstarStates > 100_000) failWalk("globstar traversal state limit exceeded");
          scratch.reserveBytes(bytes * 2 + 64);
          segments.push(pattern.slice(start, end));
        }
        start = end + 1;
      }
      const make = (parent: Candidate, suffix: string, bytes: number, descend: boolean, depth: number): Candidate => {
        const separator = parent.path && parent.path !== "/" ? "/" : "";
        const size = parent.bytes + separator.length + bytes;
        if (size > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
        if (++this.budget.globstarStates > 100_000) failWalk("globstar traversal state limit exceeded");
        if (depth > 128) failWalk("globstar directory depth limit exceeded");
        // Includes the candidate, queue/map/set slots and later segment-array
        // references. Reservations remain cumulative until this glob settles.
        scratch.reserveBytes(size * 2 + 128);
        return { path: parent.path + separator + suffix, bytes: size, descend, depth };
      };
      const empty: Candidate = { path: "", bytes: 0, descend: true, depth: 0 };
      let candidates = [make(empty, pattern.startsWith("/") ? "/" : "", pattern.startsWith("/") ? 1 : 0, true, 0)];
      const ignored = (error: unknown): boolean => {
        this.signal.throwIfAborted();
        return ["ENOENT", "ENOTDIR", "EACCES", "EINVAL"].includes(errorCode(error) ?? "");
      };
      const read = async (candidate: Candidate) => {
        const maxEntries = 100_000 - this.budget.globstarEntries;
        let entries;
        try { entries = await interruptible(this.fs.readdir(pathOf(state, candidate.path || "."), { signal: this.signal, maxEntries }), this.signal); }
        catch (error) {
          this.signal.throwIfAborted();
          if (errorCode(error) === "EFBIG") this.budget.abort(error);
          throw error;
        }
        this.signal.throwIfAborted();
        if (entries.length > maxEntries) failWalk("globstar directory entry limit exceeded");
        this.budget.globstarEntries += entries.length;
        return entries;
      };
      let wildcardPrefix = false;
      for (let index = 0; index < segments.length; index++) {
        const segment = segments[index]!;
        const terminal = index === segments.length - 1;
        const next = new Map<string, Candidate>();
        const add = (candidate: Candidate): void => {
          const prior = next.get(candidate.path);
          if (!prior || candidate.descend && !prior.descend) next.set(candidate.path, candidate);
        };
        if (segment === "**") {
          const visited = new Set<string>();
          for (const root of candidates) {
            this.signal.throwIfAborted();
            try {
              if ((await interruptible(this.fs.stat(pathOf(state, root.path || "."), { signal: this.signal }), this.signal)).type !== "directory") continue;
            } catch (error) { if (ignored(error)) continue; throw error; }
            if (!terminal || root.path) {
              // A literal prefix retains its separator in the zero-depth
              // terminal match; expanded prefixes do not (GNU Bash 5.2).
              add(terminal && !wildcardPrefix && root.path !== "/" ? make(root, "", 0, root.descend, root.depth) : root);
            }
            const queue = root.descend ? [root] : [];
            while (queue.length) {
              const directory = queue.pop()!;
              if (visited.has(directory.path)) continue;
              visited.add(directory.path);
              let entries;
              try { entries = await read(directory); }
              catch (error) { if (ignored(error)) continue; throw error; }
              for (const entry of entries) {
                const pending = stringCheckpoint(work);
                if (pending) await pending;
                if (entry.name === "." || entry.name === ".." || !state.dotglob && entry.name.startsWith(".")) continue;
                const bytes = (await scanString(entry.name, work)).bytes;
                const child = make(directory, entry.name, bytes, entry.type === "directory", directory.depth + (entry.type === "directory" ? 1 : 0));
                if (terminal || entry.type === "directory" || entry.type === "symlink" && root.path !== "") add(child);
                if (entry.type === "directory") queue.push(child);
              }
            }
          }
          wildcardPrefix = true;
        } else if (segment === "." || segment === ".." || !state.nocaseglob && !(state.extglob ? /(?:^|[^\\])(?:\\\\)*(?:[*?[]|[?*+@!]\()/u.test(segment) : /(?:^|[^\\])(?:\\\\)*[*?[]/u.test(segment))) {
          const literal = segment.replace(/\\(.)/gu, "$1");
          const bytes = (await scanString(literal, work)).bytes;
          for (const candidate of candidates) add(make(candidate, literal, bytes, true, candidate.depth));
        } else {
          const matches = await compilePattern(segment, work, !!state.nocaseglob, !!state.extglob);
          for (const candidate of candidates) {
            let entries;
            try { entries = await read(candidate); }
            catch (error) { if (ignored(error)) continue; throw error; }
            for (const entry of entries) {
              const pending = stringCheckpoint(work);
              if (pending) await pending;
              if (entry.name !== "." && entry.name !== ".." && (state.dotglob || !entry.name.startsWith(".") || segment.startsWith(".")) && await matches(entry.name)) {
                add(make(candidate, entry.name, (await scanString(entry.name, work)).bytes, true, candidate.depth));
              }
            }
          }
          wildcardPrefix = true;
        }
        candidates = [...next.values()];
      }
      const found: string[] = [];
      let outputBytes = 0;
      for (const candidate of candidates) {
        this.signal.throwIfAborted();
        try {
          const path = pathOf(state, candidate.path);
          const stat = await interruptible(value.endsWith("/") ? this.fs.stat(path, { signal: this.signal }) : this.fs.lstat(path, { signal: this.signal }), this.signal);
          if (value.endsWith("/") && stat.type !== "directory") continue;
          const slash = value.endsWith("/") && !candidate.path.endsWith("/") ? "/" : "";
          if (found.length >= this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
          outputBytes += candidate.bytes + slash.length;
          if (outputBytes > this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
          scratch.reserveBytes(candidate.bytes * 2 + slash.length + 8);
          found.push(candidate.path + slash);
        } catch (error) { if (!ignored(error)) throw error; }
      }
      // In-place heap sort uses C UTF-8 pathname order while
      // charging comparisons, including long common prefixes, and yielding.
      await sortExpansionStrings(found, work, true);
      return found.length ? found : state.nullglob ? [] : [value];
    } finally { scratch.close(); }
  }

  async glob(value: string, pattern: string, state: State): Promise<string[]> {
    if (state.noglob) return [value];
    if (!(state.extglob ? /(?:^|[^\\])(?:\\\\)*(?:[*?[]|[?*+@!]\()/u.test(pattern) : /(?:^|[^\\])(?:\\\\)*[*?[]/u.test(pattern))) return [value];
    if (state.globstar) {
      const work: StringWork = { remaining: Math.min(Number.MAX_SAFE_INTEGER, this.budget.limits.maxExpansionBytes * 4 + 1024), signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") };
      let start = 0;
      for (let end = 0; end <= pattern.length; end++) {
        const pending = stringCheckpoint(work);
        if (pending) await pending;
        if (end !== pattern.length && pattern[end] !== "/") continue;
        if (end - start === 2 && pattern[start] === "*" && pattern[start + 1] === "*") return this.recursiveGlob(value, pattern, state);
        start = end + 1;
      }
    }
    const absolute = pattern.startsWith("/");
    const work: StringWork = { remaining: Math.min(Number.MAX_SAFE_INTEGER, this.budget.limits.maxExpansionBytes * 4 + 1024), signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") };
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
      if (segment === "." || segment === ".." || !state.nocaseglob && !(state.extglob ? /(?:^|[^\\])(?:\\\\)*(?:[*?[]|[?*+@!]\()/u.test(segment) : /(?:^|[^\\])(?:\\\\)*[*?[]/u.test(segment))) {
        const literal = segment.replace(/\\(.)/gu, "$1");
        for (const candidate of candidates) addCandidate(`${candidate}${candidate && candidate !== "/" ? "/" : ""}${literal}`);
      } else {
        const scratch = this.budget.values.scope();
        work.allocation = scratch;
        try {
          const matches = await compilePattern(segment, work, !!state.nocaseglob, !!state.extglob);
          for (const candidate of candidates) {
            let entries;
            try {
              const pending = this.fs.readdir(pathOf(state, candidate || "."), { signal: this.signal });
              entries = stateMonitor(state)?.store ? await interruptible(pending, this.signal) : await pending;
            }
            catch (error) {
              this.signal.throwIfAborted();
              if (["ENOENT", "ENOTDIR", "EACCES", "EINVAL"].includes(errorCode(error) ?? "")) continue;
              throw error;
            }
            for (const entry of entries) {
              if (entry.name !== "." && entry.name !== ".." && (state.dotglob || !entry.name.startsWith(".") || segment.startsWith(".")) && await matches(entry.name)) {
                addCandidate(`${candidate}${candidate && candidate !== "/" ? "/" : ""}${entry.name}`);
              }
            }
          }
        } finally { scratch.close(); }
      }
      candidates = next;
    }
    const found: string[] = [];
    for (const candidate of candidates) {
      try {
        const path = pathOf(state, candidate);
        const pending = value.endsWith("/") ? this.fs.stat(path, { signal: this.signal }) : this.fs.lstat(path, { signal: this.signal });
        const stat = stateMonitor(state)?.store ? await interruptible(pending, this.signal) : await pending;
        if (!value.endsWith("/") || stat.type === "directory") found.push(candidate + (value.endsWith("/") ? "/" : ""));
      } catch (error) {
        this.signal.throwIfAborted();
        if (!["ENOENT", "ENOTDIR", "EACCES", "EINVAL"].includes(errorCode(error) ?? "")) throw error;
      }
    }
    // Heap sort inspects at most O(output bytes * log(fields)) characters.
    // Keep sorting work separate from the pattern-matching allowance.
    const sortingWork: StringWork = {
      remaining: Math.min(Number.MAX_SAFE_INTEGER, this.budget.limits.maxExpansionBytes * 4 * (Math.ceil(Math.log2(found.length + 1)) + 1) + 1024),
      signal: this.signal,
      exhausted: (): never => this.budget.fail("maxExpansionBytes"),
    };
    await sortExpansionStrings(found, sortingWork, true);
    return found.length ? found : state.nullglob ? [] : [value];
  }
}
Object.assign(Runtime.prototype, {
  outcomeFrame: undefined,
  _fs: undefined,
  _contextFsMask: -1,
  _contextFsSignal: undefined,
  _contextFs: undefined,
  _redirectFsMask: -1,
  _redirectFs: undefined,
  _fileWrites: undefined,
  _outputFiles: undefined,
  _syncArithState: undefined,
  _canFastMemoryRedirect: undefined,
  _syncArithRawVars: undefined,
  _syncArithLine: undefined,
  _syncArithRawWriteOnly: false,
  _syncArithTouched: undefined,
  _syncArithRefs: undefined,
});
export class RootShellState implements State {
  declare umask: number;
  declare extensions: ShellExtensionState | undefined;
  declare cwd: string;
  declare variables: Record<string, string>;
  declare _functions: Map<string, Command> | undefined;
  declare getopts: GetoptsBinding | undefined;
  declare directoryStack: { entries: string[]; bytes: number } | undefined;
  declare dotglob: boolean;
  declare globstar: boolean;
  declare status: number;
  declare substitutionStatus: number;
  declare depth: number;
  declare loopDepth: number;
  declare functionDepth: number;
  declare _exported: Set<string> | undefined;
  declare _positional: string[] | undefined;
  declare _locals: Map<string, SavedVariable>[] | undefined;
  declare pipefail: boolean;
  declare profile: "bash";

  constructor(
    cwd: string,
    variables: Record<string, string>,
    exported: Set<string> | undefined,
    extensions: ShellExtensionState | undefined,
  ) {
    this.cwd = cwd;
    this.variables = variables;
    if (exported !== undefined) this._exported = exported;
    this.extensions = extensions;
  }

  get exported(): Set<string> {
    const raw = stateMonitor(this)?.raw as RootShellState | undefined;
    const target = raw ?? this;
    if (target._exported === undefined) {
      const set = new Set<string>();
      set.add("PWD");
      target._exported = set;
    }
    return target._exported;
  }
  set exported(value: Set<string>) {
    const raw = stateMonitor(this)?.raw as RootShellState | undefined;
    (raw ?? this)._exported = value;
  }

  get positional(): string[] {
    const raw = stateMonitor(this)?.raw as RootShellState | undefined;
    return (raw ?? this)._positional ??= [];
  }
  set positional(value: string[]) {
    const raw = stateMonitor(this)?.raw as RootShellState | undefined;
    (raw ?? this)._positional = value;
  }

  get locals(): Map<string, SavedVariable>[] {
    const raw = stateMonitor(this)?.raw as RootShellState | undefined;
    return (raw ?? this)._locals ??= [];
  }
  set locals(value: Map<string, SavedVariable>[]) {
    const raw = stateMonitor(this)?.raw as RootShellState | undefined;
    (raw ?? this)._locals = value;
  }

  get functions(): Map<string, Command> {
    // Materializing an empty map is a read; guest mutations still use the state proxy.
    const raw = stateMonitor(this)?.raw as RootShellState | undefined;
    return (raw ?? this)._functions ??= new Map();
  }
  set functions(value: Map<string, Command>) {
    this._functions = value;
  }
}
Object.assign(RootShellState.prototype, {
  [monitorSymbol]: undefined,
  umask: 0o022,
  extensions: undefined,
  cwd: "/",
  variables: undefined,
  _exported: undefined,
  _positional: undefined,
  _locals: undefined,
  _functions: undefined,
  getopts: undefined,
  directoryStack: undefined,
  dotglob: false,
  globstar: false,
  status: 0,
  substitutionStatus: 0,
  depth: 0,
  loopDepth: 0,
  functionDepth: 0,
  pipefail: false,
  profile: "bash",
});

function hasShellFunction(state: State, name: string): boolean {
  if (state instanceof RootShellState) {
    return state._functions !== undefined && state._functions.has(name);
  }
  return state.functions.has(name);
}
