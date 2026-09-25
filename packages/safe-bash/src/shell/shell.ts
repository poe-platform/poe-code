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
import { captureShellExtensions, extensionState } from "./extensions.js";
import { ShellInput } from "./input.js";
import { SourceLineIndex } from "./source-line-index.js";
import { byteLocale } from "./locale.js";
import { Budget, Capture, customRegisteredCommands, customRegisteredRegistries, interruptible, registerRuntimeBackingFileSystem, resolveLimits, Runtime, RuntimeCancellationState } from "./runtime.js";
import { combineManagedSignals, isSyncResolved } from "../fs/creation-mask.js";
import type { State } from "./runtime.js";
import { ShellLimitError, ShellSyntaxError } from "./types.js";
import type { ShellExecOptions, ShellOptions, ShellResult } from "./types.js";
import { InvocationScope, invocationScope, throwCleanupFailures } from "./cleanup.js";
import {
  createRootCancellationLink, selectRuntimeCancellationOutcome, subscribeCancellation,
} from "./cancellation.js";
import type {
  CancellationBoundary, CancellationOrigin, CancellationSelection, CapturedCancellationOutcome,
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
  readonly unit: ReturnType<typeof parseShellUnit>;
  readonly unitsCharged: number;
}
const parsedUnitCache = new Map<string, CachedParsedUnit>();

class RootInvocationCancellationOwner {
  #finalized: Promise<void> | undefined;
  #resolveFinalized: (() => void) | undefined;
  #admissionOpen = true;
  #boundary: CancellationBoundary | undefined;
  #observedOrigin: CancellationOrigin | undefined;
  #captureCancellation: ((origin: CancellationOrigin) => void) | undefined;
  #detach: (() => void) | undefined;
  #finished = false;

  constructor(readonly scope: InvocationScope) {
    scope.registerFinalizer(() => { this.#admissionOpen = false; });
  }

  get finalized(): Promise<void> {
    if (this.#finished) return Promise.resolve();
    return this.#finalized ??= new Promise<void>(resolve => { this.#resolveFinalized = resolve; });
  }

  activate(boundary: CancellationBoundary): void {
    if (!this.#admissionOpen) throw new Error("Root cancellation admission is closed");
    this.#boundary = boundary;
    this.#detach = subscribeCancellation(boundary, origin => { this.#captureCancellation?.(origin); });
  }

  assertAdmissionOpen(): void {
    if (!this.#admissionOpen) throw new Error("Root cancellation admission is closed");
  }

  capture<Value>(execute: () => Promise<Value>): Promise<CapturedCancellationOutcome<Value>> {
    return new Promise(resolve => {
      let settled = false;
      let raw: Promise<Value> | undefined;
      let queuedOrigin = false;
      const settle = (captured: CapturedCancellationOutcome<Value>): void => {
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
        reason => settle({ kind: "throw", reason }),
      );
      if (settled) void raw.catch(() => undefined);
    });
  }

  finish<Value>(captured: CapturedCancellationOutcome<Value>): CancellationSelection<Value> {
    if (this.#finished) throw new Error("Root cancellation was already finalized");
    this.#finished = true;
    this.#admissionOpen = false;
    try {
      try { this.#detach?.(); } catch (error) { this.scope.failures.push(error); }
      this.#detach = undefined;
      const close = this.#boundary!.close();
      if (close.failures.length > 0) this.scope.failures.push(...close.failures);
      return selectRuntimeCancellationOutcome(this.#boundary!, captured, this.#observedOrigin);
    } finally { this.#resolveFinalized?.(); }
  }
}

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
  readonly #active = new Set<{ scope: InvocationScope; budget: Budget; owner: RootInvocationCancellationOwner }>();

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
      }
    }
    const resolvedLimits = resolveLimits(options.limits);
    const { commandLimits } = resolvedLimits;
    this.#resolvedLimits = resolvedLimits;
    this.#options = { ...options, extensions: [...options.extensions ?? []], cwd: resolvePath("/", options.cwd ?? "/"), env: { ...options.env }, limits: { ...options.limits, ...(commandLimits === undefined ? {} : { commandLimits }) } };
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
      controls: [{ role: "budget-control", signal: budget.controller.signal }],
    });
    try { owner.activate(boundary); }
    catch (error) {
      scope.failures.push(...boundary.close().failures);
      await scope.close();
      cancellationState.close();
      throw error;
    }
    const active = { scope, budget, owner };
    this.#active.add(active);
    let captured: CapturedCancellationOutcome<ShellResult>;
    try {
      captured = await owner.capture(() => this.#execute(source, options, scope, budget, boundary, cancellationState, owner, admission));
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
    this.#active.delete(active);
    if (selection.outcome.kind === "throw") throw selection.outcome.reason;
    throwCleanupFailures(scope.failures);
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
    const unseal = scope.onSeal(() => budget.abort(new Error("Invocation is closed")));
    const stdout = new Capture();
    const stderr = new Capture();
    let stdin: ShellInput | undefined;
    let unregisterStdin: (() => void) | undefined;
    if (options.stdin !== undefined && typeof options.stdin !== "string" && !(options.stdin instanceof Uint8Array)) {
      unregisterStdin = scope.register(async () => {
        try { await stdin?.close(); }
        catch (error) { if (!budget.signal.aborted || !Object.is(error, budget.signal.reason)) throw error; }
      });
    } else if (options.stdin !== undefined) {
      scope.registerFinalizer(() => { void stdin?.close(); });
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
          ? byteLocale(this.#options.env ?? {})
          : (this.#options.env === undefined ? byteLocale(options.env) : byteLocale({ ...this.#options.env, ...options.env }));
        const canCacheParse = extensions === EMPTY_CAPTURED_EXTENSIONS && source.length <= 16384;
        let lineIndex: SourceLineIndex | undefined;
        let lineIndexUnits = 0;
        const getOrParseUnit = (offset: number, unitLocale: boolean): ReturnType<typeof parseShellUnit> => {
          const cacheKey = canCacheParse ? `${unitLocale ? 1 : 0}:${offset}:${source}` : undefined;
          const cached = cacheKey !== undefined ? parsedUnitCache.get(cacheKey) : undefined;
          if (cached) {
            budget.parsing.admit(cached.unitsCharged);
            return cached.unit;
          }
          const beforeLineIdx = budget.parsing.admittedUnits;
          if (!lineIndex) {
            lineIndex = new SourceLineIndex(source, budget.parsing);
            lineIndexUnits = budget.parsing.admittedUnits - beforeLineIdx;
          }
          const beforeParse = budget.parsing.admittedUnits;
          const parsed = parseShellUnit(source, offset, unitLocale, budget.parsing, lineIndex, undefined, false, extensions.syntax);
          const parseUnits = budget.parsing.admittedUnits - beforeParse;
          const unitsCharged = (offset === 0 ? lineIndexUnits : 0) + parseUnits;
          if (cacheKey !== undefined && (!parsed.script.warnings || parsed.script.warnings.length === 0)) {
            if (parsedUnitCache.size >= 128) {
              const oldest = parsedUnitCache.keys().next().value;
              if (oldest !== undefined) parsedUnitCache.delete(oldest);
            }
            parsedUnitCache.set(cacheKey, { unit: parsed, unitsCharged });
          }
          return parsed;
        };
        let unit = getOrParseUnit(0, locale);
        if (options.stdin === undefined || typeof options.stdin === "string" || options.stdin instanceof Uint8Array) {
          const value = options.stdin ?? "";
          const inlineBytes = typeof value === "string"
            ? (value.length > 0 ? sharedUtf8Encoder.encode(value) : undefined)
            : (value.byteLength > 0 ? new Uint8Array(value) : undefined);
          stdin = inlineBytes
            ? new ShellInput(SHARED_EMPTY_SOURCE, budget, budget.signal, {
                provenance: "stream",
                initialChunk: inlineBytes,
                initialChunkOwned: true,
              })
            : new ShellInput(SHARED_EMPTY_SOURCE, budget, budget.signal, EMPTY_STDIN_OPTIONS);
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
        const variables = Object.assign(Object.create(null) as Record<string, string>, this.#options.env, options.env, { PWD: cwd });
        if (options.env !== undefined) {
          for (const [name, value] of Object.entries(options.env)) {
            if (name.includes("\0") || name.includes("=") || typeof value !== "string" || value.includes("\0")) throw new TypeError("Invalid environment entry");
          }
        }
        const exported = new Set(Object.keys(variables));
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
          unit = getOrParseUnit(unit.next, byteLocale(state.variables));
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
      unseal();
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
    return {
      stdout: sharedUtf8Decoder.decode(stdoutBytes),
      stderr: sharedUtf8Decoder.decode(stderrBytes),
      stdoutBytes, stderrBytes, exitCode,
    };
  }

  dispose(): Promise<void> {
    if (this.#disposal) return this.#disposal;
    this.#disposed = true;
    const active = [...this.#active];
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
