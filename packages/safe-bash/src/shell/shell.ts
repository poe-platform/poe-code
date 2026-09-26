import { writeDiagnostic } from "../escaping.js";
import { createDeviceFileSystem } from "@poe-code/safe-fs/core";
import { CommandRegistry, resolvePath, toByteSource } from "../contracts/index.js";
import type {
  ByteSink, CommandDefinition, FileSystemFactory, Middleware, PluginHost,
  RegisterCommandOptions, VirtualShellPlugin,
} from "../contracts/index.js";
import { warnIfHostProcessEnv } from "./env-warning.js";
import { parseShellUnit } from "./parser.js";
import { defaultPortableTrapExtension } from "./trap.js";
import { jobsExtension } from "./extensions/jobs/index.js";
import { captureShellExtensions, extensionState } from "./extensions.js";
import { ShellInput } from "./input.js";
import { SourceLineIndex } from "./source-line-index.js";
import { byteLocale } from "./locale.js";
import { Budget, Capture, customRegisteredCommands, customRegisteredRegistries, interruptible, registerRuntimeBackingFileSystem, resolveLimits, Runtime, RuntimeCancellationState } from "./runtime.js";
import { combineManagedSignals, isSyncResolved } from "../fs/creation-mask.js";
import type { State } from "./runtime.js";
import { captureShellSessionState, restoreShellSessionState } from "./session-state.js";
import { ShellLimitError, ShellSyntaxError } from "./types.js";
import type { ShellExecOptions, ShellOptions, ShellResult, ShellSession, ShellSessionState } from "./types.js";
import { InvocationScope, invocationScope, throwCleanupFailures } from "./cleanup.js";
import {
  createRootCancellationLink, selectRuntimeCancellationOutcome, subscribeCancellationOwner, unsubscribeCancellationOwner,
} from "./cancellation.js";
import type {
  CancellationBoundary, CancellationOrigin, CancellationOwnerSubscriber, CancellationSelection, CapturedCancellationOutcome,
} from "./cancellation.js";

const EMPTY_CAPTURED_EXTENSIONS = captureShellExtensions([]);
const sharedUtf8Decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const sharedUtf8Encoder = new TextEncoder();
const SHARED_EMPTY_DONE = Promise.resolve({ done: true as const, value: undefined });
const SHARED_EMPTY_ITERATOR: AsyncIterableIterator<Uint8Array> = {
  next() { return SHARED_EMPTY_DONE; },
  [Symbol.asyncIterator]() { return this; },
};
const SHARED_EMPTY_SOURCE = {
  [Symbol.asyncIterator]() { return SHARED_EMPTY_ITERATOR; },
};
const EMPTY_STDIN_OPTIONS = Object.freeze({
  provenance: "stream" as const,
  initialEof: true,
});
interface CachedParsedUnit {
  readonly offset: number;
  readonly unit: ReturnType<typeof parseShellUnit>;
  readonly unitsCharged: number;
  readonly locale: boolean;
  nextCached?: CachedParsedUnit | undefined;
}
interface SourceParseCache {
  first0?: CachedParsedUnit | undefined;
  first1?: CachedParsedUnit | undefined;
  byOffset0?: Map<number, CachedParsedUnit> | undefined;
  byOffset1?: Map<number, CachedParsedUnit> | undefined;
}
const parsedSourceCache = new Map<string, SourceParseCache>();
function getSourceParseCache(source: string): SourceParseCache {
  let entry = parsedSourceCache.get(source);
  if (!entry) {
    if (parsedSourceCache.size >= 64) {
      const oldest = parsedSourceCache.keys().next().value;
      if (oldest !== undefined) parsedSourceCache.delete(oldest);
    }
    entry = {};
    parsedSourceCache.set(source, entry);
  }
  return entry;
}

interface ParseUnitState {
  lineIndex: SourceLineIndex | undefined;
  lineIndexUnits: number;
  currentCachedUnit: CachedParsedUnit | undefined;
}

function getOrParseUnitFromCache(
  source: string,
  offset: number,
  unitLocale: boolean,
  sourceCache: SourceParseCache | undefined,
  parseState: ParseUnitState,
  budget: Budget,
  syntax: ReturnType<typeof captureShellExtensions>["syntax"],
): ReturnType<typeof parseShellUnit> {
  let cached: CachedParsedUnit | undefined;
  if (sourceCache !== undefined) {
    if (offset === 0) {
      cached = unitLocale ? sourceCache.first1 : sourceCache.first0;
    } else if (parseState.currentCachedUnit && parseState.currentCachedUnit.locale === unitLocale && parseState.currentCachedUnit.nextCached?.offset === offset) {
      cached = parseState.currentCachedUnit.nextCached;
    } else {
      const map = unitLocale ? sourceCache.byOffset1 : sourceCache.byOffset0;
      cached = map?.get(offset);
    }
  }
  if (cached) {
    if (parseState.currentCachedUnit && parseState.currentCachedUnit.locale === unitLocale && parseState.currentCachedUnit.unit.next === offset) {
      parseState.currentCachedUnit.nextCached = cached;
    }
    parseState.currentCachedUnit = cached;
    budget.parsing.admit(cached.unitsCharged);
    return cached.unit;
  }
  const beforeLineIdx = budget.parsing.admittedUnits;
  if (!parseState.lineIndex) {
    parseState.lineIndex = new SourceLineIndex(source, budget.parsing);
    parseState.lineIndexUnits = budget.parsing.admittedUnits - beforeLineIdx;
  }
  const beforeParse = budget.parsing.admittedUnits;
  const parsed = parseShellUnit(source, offset, unitLocale, budget.parsing, parseState.lineIndex, undefined, false, syntax);
  const parseUnits = budget.parsing.admittedUnits - beforeParse;
  const unitsCharged = (offset === 0 ? parseState.lineIndexUnits : 0) + parseUnits;
  if (sourceCache !== undefined && (!parsed.script.warnings || parsed.script.warnings.length === 0)) {
    const created: CachedParsedUnit = { offset, unit: parsed, unitsCharged, locale: unitLocale };
    if (offset === 0) {
      if (unitLocale) sourceCache.first1 = created;
      else sourceCache.first0 = created;
    } else {
      const map = unitLocale ? (sourceCache.byOffset1 ??= new Map()) : (sourceCache.byOffset0 ??= new Map());
      if (map.size < 512) map.set(offset, created);
    }
    if (parseState.currentCachedUnit && parseState.currentCachedUnit.locale === unitLocale && parseState.currentCachedUnit.unit.next === offset) {
      parseState.currentCachedUnit.nextCached = created;
    }
    parseState.currentCachedUnit = created;
  } else {
    parseState.currentCachedUnit = undefined;
  }
  return parsed;
}

class RootInvocationCancellationOwner implements CancellationOwnerSubscriber {
  declare readonly kind: "callback";
  declare active: boolean;
  declare readonly scope: InvocationScope;
  declare private _finalized: Promise<void> | undefined;
  declare private _resolveFinalized: (() => void) | undefined;
  declare private _admissionOpen: boolean;
  declare private _boundary: CancellationBoundary | undefined;
  declare private _observedOrigin: CancellationOrigin | undefined;
  declare private _resolveCapture: ((captured: CapturedCancellationOutcome<any>) => void) | undefined;
  declare private _rawPromise: Promise<any> | undefined;
  declare private _settled: boolean;
  declare private _queuedOrigin: boolean;
  declare private _finished: boolean;

  constructor(scope: InvocationScope) {
    this.scope = scope;
    scope.setOwner(this);
  }

  closeAdmission(): void {
    this._admissionOpen = false;
  }

  get finalized(): Promise<void> {
    if (this._finished) return Promise.resolve();
    return this._finalized ??= new Promise<void>(resolve => { this._resolveFinalized = resolve; });
  }

  activate(boundary: CancellationBoundary): void {
    if (!this._admissionOpen) throw new Error("Root cancellation admission is closed");
    this._boundary = boundary;
    subscribeCancellationOwner(boundary, this);
  }

  assertAdmissionOpen(): void {
    if (!this._admissionOpen) throw new Error("Root cancellation admission is closed");
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
      resolve?.({ kind: "throw", reason: origin.signal.reason });
      void this._rawPromise?.catch(() => undefined);
    });
  }

  private _settleReturn(value: unknown): void {
    if (this._settled) return;
    this._settled = true;
    const resolve = this._resolveCapture;
    this._resolveCapture = undefined;
    resolve?.({ kind: "return", value });
  }

  private _settleThrow(reason: unknown): void {
    if (this._settled) return;
    this._settled = true;
    const resolve = this._resolveCapture;
    this._resolveCapture = undefined;
    resolve?.({ kind: "throw", reason });
  }

  capture<Value>(raw: Promise<Value>): Promise<CapturedCancellationOutcome<Value>> {
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

  finish<Value>(captured: CapturedCancellationOutcome<Value>): CancellationSelection<Value> {
    if (this._finished) throw new Error("Root cancellation was already finalized");
    this._finished = true;
    this._admissionOpen = false;
    try {
      if (this._boundary && this.active) {
        try { unsubscribeCancellationOwner(this._boundary, this); } catch (error) { this.scope.failures.push(error); }
      }
      const close = this._boundary!.close();
      if (close.failures.length > 0) this.scope.failures.push(...close.failures);
      return selectRuntimeCancellationOutcome(this._boundary!, captured, this._observedOrigin);
    } finally { this._resolveFinalized?.(); }
  }
}
Object.assign(RootInvocationCancellationOwner.prototype, {
  kind: "callback",
  active: false,
  _finalized: undefined,
  _resolveFinalized: undefined,
  _admissionOpen: true,
  _boundary: undefined,
  _observedOrigin: undefined,
  _resolveCapture: undefined,
  _rawPromise: undefined,
  _settled: false,
  _queuedOrigin: false,
  _finished: false,
});

function createInvocationSink(budget: Budget, capture: Capture, external?: ByteSink): ByteSink {
  if (external === undefined) return budget.sink(capture);
  return budget.sink({
    ...(external.ownedOutput ? { ownedOutput: {
      get consumerClosed() { return external.ownedOutput!.consumerClosed; },
      write: async (chunk: Uint8Array) => {
        await capture.write(chunk);
        await external.ownedOutput!.write(chunk);
      },
    } } : {}),
    write: async (chunk) => {
      await capture.write(chunk);
      await external.write(chunk);
    },
  });
}

export class Shell implements PluginHost {
  readonly commands: CommandRegistry;
  readonly #middleware: Middleware[] = [];
  readonly #filesystems = new Map<string, FileSystemFactory>();
  readonly #plugins: VirtualShellPlugin[] = [];
  readonly #capabilities: Record<string, unknown> = {};
  readonly #options: ShellOptions;
  readonly #resolvedLimits: ReturnType<typeof resolveLimits>;
  #ready: Promise<void> = Object.defineProperty(Promise.resolve(), Symbol.for("safe-bash.syncResolved"), { value: true });
  #disposed = false;
  #disposal: Promise<void> | undefined;
  #defaultIoCapabilities: Readonly<Record<string, unknown>> | undefined;
  #defaultRuntimeFs: ShellOptions["fs"] | undefined;
  #hasCustomCommands = false;
  #hasInitialEnv = false;
  #initialLocale = true;
  #singleActiveScope: InvocationScope | undefined;
  #singleActiveBudget: Budget | undefined;
  #singleActiveOwner: RootInvocationCancellationOwner | undefined;
  #active: Set<{ scope: InvocationScope; budget: Budget; owner: RootInvocationCancellationOwner }> | undefined;

  constructor(options: ShellOptions) {
    if (!options?.fs) throw new TypeError("Shell requires an explicit filesystem");
    if (options.deviceView !== undefined && options.deviceView !== "default" && options.deviceView !== "provided") throw new TypeError("deviceView must be default or provided");
    const commands = options.commands ?? new CommandRegistry();
    if (!(commands instanceof CommandRegistry)) throw new TypeError("CommandRegistry requires its matching shell runtime; do not mix source and compiled runtime modules");
    if (options.commands) {
      this.#hasCustomCommands = true;
      customRegisteredRegistries.add(commands);
    }
    if (options.onInternalError !== undefined && typeof options.onInternalError !== "function") throw new TypeError("onInternalError must be callable");
    warnIfHostProcessEnv(options.env);
    if (options.env) {
      for (const [name, value] of Object.entries(options.env)) {
        if (name.includes("\0") || name.includes("=") || typeof value !== "string" || value.includes("\0")) throw new TypeError("Invalid environment entry");
        this.#hasInitialEnv = true;
      }
    }
    const resolvedLimits = resolveLimits(options.limits);
    const { commandLimits } = resolvedLimits;
    this.#resolvedLimits = resolvedLimits;
    const extensions = [...options.extensions ?? []];
    if (options.backgroundJobs && !extensions.some(ext => ext.name === "jobs")) {
      extensions.push(jobsExtension());
    }
    this.#options = { ...options, extensions, cwd: resolvePath("/", options.cwd ?? "/"), env: { ...options.env }, limits: { ...options.limits, ...(commandLimits === undefined ? {} : { commandLimits }) } };
    this.#initialLocale = byteLocale(this.#options.env ?? {});
    this.commands = commands;
  }

  use(middleware: Middleware | VirtualShellPlugin): this {
    if (this.#disposed) throw new Error("Shell is disposed");
    this.#install(middleware);
    return this;
  }

  #install(middleware: Middleware | VirtualShellPlugin): void {
    if (typeof middleware === "function") this.#middleware.push(middleware);
    else {
      if (!middleware || typeof middleware.setup !== "function") throw new TypeError("Expected middleware or shell plugin");
      const nextReady = this.#ready.then(async () => {
        let active = true;
        const admit = () => {
          if (this.#disposed && !active) throw new Error("Shell is disposed");
        };
        const host: PluginHost = {
          provideCapabilities: capabilities => { admit(); Object.assign(this.#capabilities, capabilities); this.#defaultIoCapabilities = undefined; },
          commands: this.commands,
          use: (middleware) => { admit(); this.#install(middleware); },
          registerFileSystem: (scheme, factory) => { admit(); this.#registerFileSystem(scheme, factory); },
        };
        try {
          await middleware.setup(host);
          this.#plugins.push(middleware);
        } finally { active = false; }
      });
      this.#ready = nextReady;
      void nextReady.then(() => { Object.defineProperty(nextReady, Symbol.for("safe-bash.syncResolved"), { value: true }); }, () => undefined);
    }
  }

  register(command: CommandDefinition, options?: RegisterCommandOptions): this {
    if (this.#disposed) throw new Error("Shell is disposed");
    this.#hasCustomCommands = true;
    if (command && typeof command.execute === "function") customRegisteredCommands.add(command.execute);
    this.commands.register(command, options);
    return this;
  }

  registerFileSystem(scheme: string, factory: FileSystemFactory): void {
    if (this.#disposed) throw new Error("Shell is disposed");
    this.#registerFileSystem(scheme, factory);
  }

  #registerFileSystem(scheme: string, factory: FileSystemFactory): void {
    if (!/^[a-z][a-z0-9+.-]*$/u.test(scheme)) throw new TypeError("Invalid filesystem scheme");
    if (this.#filesystems.has(scheme)) throw new Error(`Filesystem already registered: ${scheme}`);
    this.#filesystems.set(scheme, factory);
  }

  async createFileSystem(scheme: string, options: Readonly<Record<string, unknown>> = {}): Promise<Awaited<ReturnType<FileSystemFactory>>> {
    if (this.#disposed) throw new Error("Shell is disposed");
    await this.#ready;
    const factory = this.#filesystems.get(scheme);
    if (!factory) throw new Error(`Unknown filesystem scheme: ${scheme}`);
    return factory(options);
  }

  createSession(initialState?: ShellSessionState): ShellSession {
    let currentState = initialState;
    return {
      get state() {
        return currentState;
      },
      set state(value: ShellSessionState | undefined) {
        currentState = value;
      },
      exec: async (source: string, options: ShellExecOptions = {}): Promise<ShellResult> => {
        const effectiveState = options.state ?? currentState;
        return this.exec(source, {
          ...options,
          ...(effectiveState === undefined ? {} : { state: effectiveState }),
          onState: async (nextState, result) => {
            currentState = nextState;
            await options.onState?.(nextState, result);
          },
        });
      },
    };
  }

  async exec(source: string, options: ShellExecOptions = {}): Promise<ShellResult> {
    if (this.#disposed) throw new Error("Shell is disposed");
    if (options.onInternalError !== undefined && typeof options.onInternalError !== "function") throw new TypeError("onInternalError must be callable");
    warnIfHostProcessEnv(options.env);
    const limits = options.limits === undefined ? this.#resolvedLimits : resolveLimits(this.#options.limits, options.limits);
    const budget = new Budget(limits, options.signal, options.onInternalError ?? this.#options.onInternalError);
    const scope = new InvocationScope(options.signal);
    const cancellationState = new RuntimeCancellationState();
    const owner = new RootInvocationCancellationOwner(scope);
    const admission = Runtime.rootCancellationAdmission(budget);
    const boundary = createRootCancellationLink({
      admission,
      callerSignal: options.signal,
      budgetControlSignal: budget.controller.signal,
      nativeDeliverySignal: this.#hasCustomCommands || this.#middleware.length > 0 || options.signal !== undefined,
    });
    try { owner.activate(boundary); }
    catch (error) {
      scope.failures.push(...boundary.close().failures);
      await scope.close();
      cancellationState.close();
      throw error;
    }
    let activeEntry: { scope: InvocationScope; budget: Budget; owner: RootInvocationCancellationOwner } | undefined;
    if (!this.#singleActiveScope && !this.#active) {
      this.#singleActiveScope = scope;
      this.#singleActiveBudget = budget;
      this.#singleActiveOwner = owner;
    } else {
      if (!this.#active) {
        this.#active = new Set();
        if (this.#singleActiveScope) {
          this.#active.add({ scope: this.#singleActiveScope, budget: this.#singleActiveBudget!, owner: this.#singleActiveOwner! });
          this.#singleActiveScope = undefined;
          this.#singleActiveBudget = undefined;
          this.#singleActiveOwner = undefined;
        }
      }
      activeEntry = { scope, budget, owner };
      this.#active.add(activeEntry);
    }
    let captured: CapturedCancellationOutcome<ShellResult>;
    try {
      captured = await owner.capture(this.#execute(source, options, scope, budget, boundary, cancellationState, owner, admission));
      if (captured.kind === "throw" && budget.hasExecutionCleanup) budget.executionCleanup.abort(captured.reason);
    } finally {
      if (budget.hasExecutionCleanup) {
        const cleanupDrain = budget.executionCleanup.drain();
        if (!isSyncResolved(cleanupDrain)) await cleanupDrain;
        if (budget.executionCleanup.failures.length > 0) scope.failures.push(...budget.executionCleanup.failures);
      }
      budget.close();
      const scopeClose = scope.close();
      if (!isSyncResolved(scopeClose)) await scopeClose;
    }
    const selection = owner.finish(captured);
    cancellationState.close();
    if (activeEntry) {
      this.#active!.delete(activeEntry);
    } else if (this.#singleActiveScope === scope) {
      this.#singleActiveScope = undefined;
      this.#singleActiveBudget = undefined;
      this.#singleActiveOwner = undefined;
    }
    if (selection.outcome.kind === "throw") throw selection.outcome.reason;
    if (scope.hasFailures) throwCleanupFailures(scope.failures);
    return selection.outcome.value;
  }

  async #execute(
    source: string,
    options: ShellExecOptions,
    scope: InvocationScope,
    budget: Budget,
    cancellation: CancellationBoundary,
    cancellationState: RuntimeCancellationState,
    owner: RootInvocationCancellationOwner,
    admission: ReturnType<typeof Runtime.rootCancellationAdmission>,
  ): Promise<ShellResult> {
    if (typeof source !== "string") throw new TypeError("Shell source must be a string");
    if (Buffer.byteLength(source) > budget.limits.maxSourceBytes) throw new ShellLimitError("maxSourceBytes");
    budget.source(Buffer.byteLength(source));
    budget.signal.throwIfAborted();
    scope.setActiveBudget(budget);
    const stdout = new Capture();
    const stderr = new Capture();
    let stdin: ShellInput | undefined;
    let unregisterStdin: (() => void) | undefined;
    if (options.stdin !== undefined && typeof options.stdin !== "string" && !(options.stdin instanceof Uint8Array)) {
      unregisterStdin = scope.register(async () => {
        try { await stdin?.close(); }
        catch (error) { if (!budget.signal.aborted || !Object.is(error, budget.signal.reason)) throw error; }
      });
    }
    const io = {
      capabilities: options.capabilities === undefined && options.limits === undefined
        ? (this.#defaultIoCapabilities ?? Object.freeze({ ...this.#options.capabilities, ...(budget.limits.commandLimits === undefined ? {} : { commandLimits: budget.limits.commandLimits }) }))
        : Object.freeze({ ...this.#options.capabilities, ...options.capabilities, ...(budget.limits.commandLimits === undefined ? {} : { commandLimits: budget.limits.commandLimits }) }),
      [invocationScope]: scope,
      ...(options.admittedHandles === undefined ? {} : { admittedHandles: options.admittedHandles }),
      ...(options.processSignals === undefined ? {} : { processSignals: options.processSignals }),
      stdin: SHARED_EMPTY_SOURCE,
      stdinIsDefault: options.stdin === undefined,
      stdout: createInvocationSink(budget, stdout, options.stdout),
      stderr: createInvocationSink(budget, stderr, options.stderr),
    };
    let exitCode: number;
    let runtime: Runtime | undefined;
    let state: State | undefined;
    let failed = false;
    try {
      try {
        const rawExtensions = this.#options.extensions;
        const extensions = !rawExtensions || rawExtensions.length === 0
          ? EMPTY_CAPTURED_EXTENSIONS
          : captureShellExtensions(rawExtensions);
        const locale = options.env === undefined
          ? this.#initialLocale
          : (!this.#hasInitialEnv ? byteLocale(options.env) : byteLocale({ ...this.#options.env, ...options.env }));
        const canCacheParse = extensions === EMPTY_CAPTURED_EXTENSIONS && source.length <= 16384;
        const sourceCache = canCacheParse ? getSourceParseCache(source) : undefined;
        let parseState: ParseUnitState | undefined;
        let currentCachedUnit: CachedParsedUnit | undefined = sourceCache !== undefined
          ? (locale ? sourceCache.first1 : sourceCache.first0)
          : undefined;
        let unit: ReturnType<typeof parseShellUnit>;
        if (currentCachedUnit) {
          budget.parsing.admit(currentCachedUnit.unitsCharged);
          unit = currentCachedUnit.unit;
        } else {
          parseState = { lineIndex: undefined, lineIndexUnits: 0, currentCachedUnit: undefined };
          unit = getOrParseUnitFromCache(source, 0, locale, sourceCache, parseState, budget, extensions.syntax);
          currentCachedUnit = parseState.currentCachedUnit;
        }
        if (options.stdin === undefined || typeof options.stdin === "string" || options.stdin instanceof Uint8Array) {
          const value = options.stdin ?? "";
          const needsCopy = extensions !== EMPTY_CAPTURED_EXTENSIONS || this.#hasCustomCommands || this.#middleware.length > 0;
          const inlineBytes = typeof value === "string"
            ? (value.length > 0 ? sharedUtf8Encoder.encode(value) : undefined)
            : (value.byteLength > 0 ? (needsCopy ? new Uint8Array(value) : value) : undefined);
          stdin = inlineBytes
            ? new ShellInput(SHARED_EMPTY_SOURCE, budget, budget.signal, {
                provenance: "stream",
                initialChunk: inlineBytes,
                initialChunkOwned: true,
              })
            : new ShellInput(SHARED_EMPTY_SOURCE, budget, budget.signal, EMPTY_STDIN_OPTIONS);
          if (options.stdin !== undefined) scope.setActiveStdin(stdin);
        } else stdin = new ShellInput(options.stdin, budget);
        io.stdin = stdin;
        if (!isSyncResolved(this.#ready)) {
          await interruptible(this.#ready, budget.signal);
        } else {
          budget.signal.throwIfAborted();
        }
        io.capabilities = options.capabilities === undefined && options.limits === undefined
          ? (this.#defaultIoCapabilities ??= Object.freeze({ ...this.#capabilities, ...this.#options.capabilities, ...(budget.limits.commandLimits === undefined ? {} : { commandLimits: budget.limits.commandLimits }) }))
          : Object.freeze({ ...this.#capabilities, ...this.#options.capabilities, ...options.capabilities, ...(budget.limits.commandLimits === undefined ? {} : { commandLimits: budget.limits.commandLimits }) });
        const cwd = options.cwd !== undefined ? resolvePath("/", options.cwd) : (this.#options.cwd ?? "/");
        const variables = Object.create(null) as Record<string, string>;
        let exported: Set<string>;
        if (!this.#hasInitialEnv && options.env === undefined) {
          variables.PWD = cwd;
          exported = new Set(["PWD"]);
        } else {
          Object.assign(variables, this.#options.env, options.env, { PWD: cwd });
          if (options.env !== undefined) {
            for (const [name, value] of Object.entries(options.env)) {
              if (name.includes("\0") || name.includes("=") || typeof value !== "string" || value.includes("\0")) throw new TypeError("Invalid environment entry");
            }
          }
          exported = new Set(Object.keys(variables));
        }
        variables.OPTIND = "1";
        variables.OPTERR = "1";
        state = {
          umask: 0o022,
          extensions: extensionState(extensions.definitions, undefined, undefined, defaultPortableTrapExtension),
          cwd, variables, exported, functions: new Map(), positional: [], getopts: { cursor: { index: 0 }, integer: true },
          directoryStack: { entries: [], bytes: 0 },
          dotglob: false,
          globstar: false,
          status: 0, substitutionStatus: 0, depth: 0, loopDepth: 0, functionDepth: 0, locals: [], pipefail: false, profile: "bash",
        };
        const beforeExecHook = options.hooks?.beforeExec ?? this.#options.hooks?.beforeExec;
        const restoredSnapshot = options.state ?? (beforeExecHook ? await beforeExecHook({ source, options }) : undefined);
        if (restoredSnapshot) {
          state = await restoreShellSessionState(
            state,
            restoredSnapshot,
            { cwd: options.cwd, env: options.env },
            budget,
            scope,
            extensions.syntax,
          );
        }
        const filesystem = options.fs ?? this.#options.fs;
        let runtimeFs: typeof filesystem;
        if (options.fs === undefined) {
          if (!this.#defaultRuntimeFs) {
            this.#defaultRuntimeFs = this.#options.deviceView === "provided" ? filesystem : createDeviceFileSystem(filesystem);
            registerRuntimeBackingFileSystem(this.#defaultRuntimeFs, filesystem);
          }
          runtimeFs = this.#defaultRuntimeFs;
        } else {
          runtimeFs = this.#options.deviceView === "provided" ? filesystem : createDeviceFileSystem(filesystem);
          registerRuntimeBackingFileSystem(runtimeFs, filesystem);
        }
        runtime = new Runtime(
          runtimeFs,
          this.commands,
          this.#middleware,
          budget,
          this.#hasCustomCommands || this.#middleware.length > 0
            ? combineManagedSignals(cancellation.deliverySignal, scope.signal)
            : cancellation.deliverySignal,
          undefined,
          undefined,
          cancellation.deliverySignal,
          cancellation,
          cancellationState,
          owner,
          0,
          admission.maxDepth,
          undefined,
          filesystem,
        );
        exitCode = 0;
        while (true) {
          for (const warning of unit.script.warnings ?? []) await writeDiagnostic(io.stderr, `shell: warning: ${warning}\n`);
          if (unit.script.lists.length) {
            const unitResult = runtime.runUnit(unit.script, state, io);
            const result = unitResult instanceof Promise
              ? await interruptible(unitResult, budget.signal)
              : unitResult;
            budget.signal.throwIfAborted();
            exitCode = result.exitCode;
            if (result.terminated) break;
          }
          if (unit.next >= source.length) break;
          budget.signal.throwIfAborted();
          const vars = state.variables;
          const nextLocale = (vars.LC_ALL || vars.LC_CTYPE || vars.LANG) ? byteLocale(vars) : true;
          if (currentCachedUnit && currentCachedUnit.locale === nextLocale && currentCachedUnit.nextCached !== undefined) {
            currentCachedUnit = currentCachedUnit.nextCached;
            budget.parsing.admit(currentCachedUnit.unitsCharged);
            unit = currentCachedUnit.unit;
          } else {
            parseState ??= { lineIndex: undefined, lineIndexUnits: 0, currentCachedUnit };
            parseState.currentCachedUnit = currentCachedUnit;
            unit = getOrParseUnitFromCache(source, unit.next, nextLocale, sourceCache, parseState, budget, extensions.syntax);
            currentCachedUnit = parseState.currentCachedUnit;
          }
        }
      } catch (error) {
        if (!(error instanceof ShellSyntaxError)) throw error;
        const line = source.slice(0, error.offset).split("\n").length;
        if (error.unclosedQuote) {
          await writeDiagnostic(io.stderr, `shell: -c: line ${error.unclosedQuote.line}: unexpected EOF while looking for matching \`${error.unclosedQuote.quote}'\n`);
        } else if (error.exitCode === 127) {
          const token = /^[;&|()<>]|^[^\s;&|()<>]+/u.exec(source.slice(error.offset))?.[0] ?? "newline";
          await writeDiagnostic(io.stderr, `shell: -c: line ${line}: syntax error near unexpected token \`${token}'\nshell: -c: line ${line}: \`${source.split("\n")[line - 1] ?? ""}'\n`);
        } else if (error.offset >= source.length && !/Unterminated|nesting|Unsupported/u.test(error.reason)) {
          const context = error.incompleteCommand ? ` from \`${error.incompleteCommand.name}' command on line ${error.incompleteCommand.line}` : "";
          await writeDiagnostic(io.stderr, `shell: -c: line ${source.split("\n").length + Number(!source.endsWith("\n"))}: syntax error: unexpected end of file${context}\n`);
        } else await writeDiagnostic(io.stderr, `shell: ${error.message}\n`);
        exitCode = error.exitCode;
      }
      if (runtime && state && !runtime.tryFinishShellSync(state)) {
        exitCode = await runtime.finishShell(state, io, exitCode);
      }
    } catch (error) {
      failed = true;
      if (budget.hasExecutionCleanup) budget.executionCleanup.abort(error);
      throw error;
    }
    finally {
      scope.clearActiveBudget();
      scope.clearActiveStdin();
      unregisterStdin?.();
      if (budget.hasExecutionCleanup) {
        const cleanupDrain = budget.executionCleanup.drain();
        if (!isSyncResolved(cleanupDrain)) await cleanupDrain;
      }
      const activeStdin = stdin;
      stdin = undefined;
      if (activeStdin) {
        const closedStdin = activeStdin.close();
        if (!isSyncResolved(closedStdin)) {
          if (failed) await closedStdin.catch(() => {});
          else await closedStdin;
        }
      }
    }
    if (budget.hasExecutionCleanup) throwCleanupFailures(budget.executionCleanup.failures);
    const stdoutBytes = stdout.takeBytes();
    const stderrBytes = stderr.takeBytes();
    const afterExecHook = options.hooks?.afterExec ?? this.#options.hooks?.afterExec;
    const shouldCaptureState = Boolean(
      state && (options.state !== undefined || options.onState !== undefined || options.hooks !== undefined || this.#options.hooks !== undefined),
    );
    const capturedState = shouldCaptureState && state ? captureShellSessionState(state, exitCode) : undefined;
    const result: ShellResult = {
      stdout: sharedUtf8Decoder.decode(stdoutBytes),
      stderr: sharedUtf8Decoder.decode(stderrBytes),
      stdoutBytes,
      stderrBytes,
      exitCode,
      ...(capturedState === undefined ? {} : { state: capturedState }),
    };
    if (capturedState) {
      await options.onState?.(capturedState, result);
      await afterExecHook?.(capturedState, result);
    }
    return result;
  }

  dispose(): Promise<void> {
    if (this.#disposal) return this.#disposal;
    this.#disposed = true;
    const active = this.#active
      ? [...this.#active]
      : (this.#singleActiveScope ? [{ scope: this.#singleActiveScope, budget: this.#singleActiveBudget!, owner: this.#singleActiveOwner! }] : []);
    const drains: Promise<void>[] = [];
    this.#disposal = Promise.resolve().then(() => this.#dispose(active, drains));
    for (const { scope, budget } of active) {
      budget.abort(new Error("Shell is disposed"));
      drains.push(budget.executionCleanup.drain().then(() => scope.close()));
    }
    return this.#disposal;
  }

  async #dispose(active: readonly { scope: InvocationScope; owner: RootInvocationCancellationOwner }[], drains: readonly Promise<void>[]): Promise<void> {
    await Promise.all(drains);
    await Promise.all(active.map(({ owner }) => owner.finalized));
    let ready: Promise<void>;
    do {
      ready = this.#ready;
      await ready.catch(() => undefined);
    } while (ready !== this.#ready);
    const failures: unknown[] = [];
    for (const plugin of [...this.#plugins].reverse()) {
      try { await plugin.dispose?.(); } catch (error) { failures.push(error); }
    }
    const cleanupFailures = active.flatMap(({ scope }) => scope.failures);
    if (failures.length) throw new AggregateError([...cleanupFailures, ...failures], "Plugin disposal failed");
    throwCleanupFailures(cleanupFailures);
  }
}
