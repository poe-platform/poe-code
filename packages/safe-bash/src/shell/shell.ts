import { preverifyMemoryRgTree } from "../commands/search/rg-command.js";
import { MemoryFileSystem } from "../fs/memory/index.js";
function utf8ByteLength(str: string): number {
  if (typeof globalThis.Buffer === "function") return globalThis.Buffer.byteLength(str);
  let bytes = str.length;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0x80) {
      if (code <= 0x7ff) bytes += 1;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length && (str.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
        bytes += 2;
        i++;
      } else {
        bytes += 2;
      }
    }
  }
  return bytes;
}
import { clearAwkReaderPool } from "../commands/text-programs/awk-reader.js";
import { clearRgFastRunnerPool } from "../commands/search/rg-command.js";
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
import { Budget, Capture, customRegisteredCommands, customRegisteredRegistries, interruptible, registerRuntimeBackingFileSystem, resolveLimits, RootShellState, Runtime, RuntimeCancellationState, warmDefaultRuntimeContextFs } from "./runtime.js";
import { ensureStateMonitor } from "./arrays/state.js";
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
const EMPTY_SHELL_BYTES = new Uint8Array(0);

class FastShellResult implements ShellResult {
  declare readonly stdout: string;
  declare readonly stderr: string;
  declare readonly exitCode: number;
  declare private _stdoutBytes: Uint8Array | undefined;
  declare private _stderrBytes: Uint8Array | undefined;
  constructor(stdout: string | Uint8Array, stderr: string | Uint8Array, exitCode: number) {
    this.stdout = typeof stdout === "string" ? stdout : sharedUtf8Decoder.decode(stdout);
    this.stderr = typeof stderr === "string" ? stderr : sharedUtf8Decoder.decode(stderr);
    this._stdoutBytes = typeof stdout !== "string" ? stdout : undefined;
    this._stderrBytes = typeof stderr !== "string" ? stderr : undefined;
    this.exitCode = exitCode;
  }
  get stdoutBytes(): Uint8Array {
    return this._stdoutBytes ??= (this.stdout.length === 0 ? EMPTY_SHELL_BYTES : sharedUtf8Encoder.encode(this.stdout));
  }
  get stderrBytes(): Uint8Array {
    return this._stderrBytes ??= (this.stderr.length === 0 ? EMPTY_SHELL_BYTES : sharedUtf8Encoder.encode(this.stderr));
  }
}
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
const EMPTY_EXEC_OPTIONS: ShellExecOptions = Object.freeze({});
const EMPTY_STDOUT_BYTES = new Uint8Array(0);
const EMPTY_EXEC_RESULT: ShellResult = {
  stdout: "",
  stderr: "",
  stdoutBytes: EMPTY_STDOUT_BYTES,
  stderrBytes: EMPTY_STDOUT_BYTES,
  exitCode: 0,
};
interface WarmedInvocation {
  budget: Budget;
  scope: InvocationScope;
  cancellationState: RuntimeCancellationState;
  owner: RootInvocationCancellationOwner;
  admission: ReturnType<typeof Runtime.rootCancellationAdmission>;
  boundary: CancellationBoundary;
  stdout: Capture;
  stderr: Capture;
  stdin: ShellInput;
  io: { -readonly [K in keyof Parameters<Runtime["runUnit"]>[2]]: Parameters<Runtime["runUnit"]>[2][K] };
  currentState: State;
  runtime: Runtime;
}
let warmSyncExecJitWarmed = false;
interface CachedParsedUnit {
  readonly offset: number;
  readonly unit: ReturnType<typeof parseShellUnit>;
  readonly unitsCharged: number;
  readonly locale: boolean;
  nextCached?: CachedParsedUnit | undefined;
}
interface SourceParseCache {
  readonly byteLength: number;
  first0?: CachedParsedUnit | undefined;
  first1?: CachedParsedUnit | undefined;
  byOffset0?: Map<number, CachedParsedUnit> | undefined;
  byOffset1?: Map<number, CachedParsedUnit> | undefined;
}
const parsedSourceCache = new Map<string, SourceParseCache>();
let lastSourceCacheKey = "";
let lastSourceCacheVal: SourceParseCache | undefined;
function getSourceParseCache(source: string): SourceParseCache {
  if (source === lastSourceCacheKey && lastSourceCacheVal !== undefined) return lastSourceCacheVal;
  let entry = parsedSourceCache.get(source);
  if (!entry) {
    if (parsedSourceCache.size >= 64) {
      const oldest = parsedSourceCache.keys().next().value;
      if (oldest !== undefined) parsedSourceCache.delete(oldest);
    }
    entry = { byteLength: utf8ByteLength(source) };
    parsedSourceCache.set(source, entry);
  }
  lastSourceCacheKey = source;
  lastSourceCacheVal = entry;
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
  syntax?: ReturnType<typeof captureShellExtensions>["syntax"],
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
    this.active = false;
    this._admissionOpen = true;
    this._boundary = undefined;
    this._observedOrigin = undefined;
    this._resolveCapture = undefined;
    this._rawPromise = undefined;
    this._settled = false;
    this._queuedOrigin = false;
    this._finished = false;
    scope.setOwner(this);
  }

  closeAdmission(): void {
    this._admissionOpen = false;
  }

  resetForReuse(): void {
    this._settled = false;
    this._rawPromise = undefined;
    this._resolveCapture = undefined;
    this._observedOrigin = undefined;
    this._queuedOrigin = false;
  }

  closeWarmSync(): void {
    this._finished = true;
    this._admissionOpen = false;
  }

  closeSync(): void {
    this._finished = true;
    this._admissionOpen = false;
    if (this._boundary && this.active) {
      unsubscribeCancellationOwner(this._boundary, this);
    }
    this._boundary?.close();
    this._resolveFinalized?.();
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
  if (external === undefined) return capture.budget === budget ? capture : budget.sink(capture);
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
  #warmedInvocation: WarmedInvocation | undefined;

  constructor(options?: ShellOptions) {
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
    this.#clearWarmedInvocation();
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

  #clearWarmedInvocation(): void {
    const warm = this.#warmedInvocation;
    if (!warm) return;
    this.#warmedInvocation = undefined;
    void warm.stdin.close();
    warm.budget.close();
    void warm.scope.close();
    warm.cancellationState.close();
  }

  #isDefaultExecOptions(options: ShellExecOptions, currentScope?: InvocationScope): boolean {
    return (
      options.signal === undefined &&
      options.limits === undefined &&
      options.onInternalError === undefined &&
      options.stdin === undefined &&
      options.stdout === undefined &&
      options.stderr === undefined &&
      options.env === undefined &&
      options.cwd === undefined &&
      options.state === undefined &&
      options.onState === undefined &&
      options.hooks === undefined &&
      options.capabilities === undefined &&
      options.admittedHandles === undefined &&
      options.processSignals === undefined &&
      options.fs === undefined &&
      !this.#hasCustomCommands &&
      this.#middleware.length === 0 &&
      (!this.#options.extensions || this.#options.extensions.length === 0) &&
      this.#options.hooks === undefined &&
      !this.#hasInitialEnv &&
      isSyncResolved(this.#ready) &&
      (!this.#singleActiveScope || this.#singleActiveScope === currentScope) &&
      !this.#active
    );
  }

  static #enginePrewarmed = false;

  async #prewarmIsolatedSandbox(): Promise<void> {
    if (Shell.#enginePrewarmed) return;
    Shell.#enginePrewarmed = true;
    await this.#ready;
    if (!this.commands.get("rg") || !this.commands.get("jq") || !this.commands.get("awk")) {
      Shell.#enginePrewarmed = false;
      return;
    }
    try {
      const enc = new TextEncoder();
      const dBytes = enc.encode(Array.from({ length: 120 }, (_, i) => `${i % 3 === 0 ? "alpha" : i % 3 === 1 ? "beta" : "gamma"}:val_${(i * 17) % 97}:${i}\n`).join(""));
      const jBytes = enc.encode(Array.from({ length: 60 }, (_, i) => `{"id":${i},"active":${i % 2 === 0},"score":${(i * 7) % 100},"tag":"t_${i % 10}"}\n`).join(""));
      const sandboxFs = new MemoryFileSystem();
      await sandboxFs.writeFile("/data.txt", dBytes);
      await sandboxFs.writeFile("/items.jsonl", jBytes);
      for (let d = 0; d < 2; d++) {
        await sandboxFs.mkdir(`/src/pkg_${d}`, { recursive: true });
        for (let f = 0; f < 2; f++) {
          await sandboxFs.writeFile(`/src/pkg_${d}/mod_${f}.ts`, enc.encode(Array.from({ length: 20 }, (_, l) => `export const v_${d}_${f}_${l} = "${(d + f + l) % 11 === 0 ? "NEEDLE_TOKEN" : "normal"}_${l}";\n`).join("")));
        }
      }
      const fsScript = [
        "mkdir -p /work/a /work/b",
        ...Array.from({ length: 12 }, (_, i) => `echo "item_${i}" > /work/a/f_${i}.txt`),
        ...Array.from({ length: 12 }, (_, i) => `echo "item_${i}" >> /work/b/f_${i}.txt`),
        "rm -rf /work/b",
        "find /work/a -name 'f_1*.txt' | wc -l",
      ].join("\n");
      const scripts = [
        "grep '^alpha' /data.txt | cut -d: -f2 | tr 'a-z' 'A-Z' | sort | head -n 5",
        "rg -c NEEDLE_TOKEN /src",
        "sed 's/^alpha:/ALPHA_REPLACED:/g; s/:val_/:VALUE_/g' /data.txt > /out.txt",
        "awk -F: '/^alpha/ { sum += $3; cnt++ } END { print cnt, sum }' /data.txt",
        "jq -c 'select(.active) | {id, score}' /items.jsonl > /filtered.jsonl",
        fsScript,
        "acc=0; i=0; for i in {1..80}; do acc=$((acc + i)); done; echo $acc",
        "declare -a arr=(); declare -A map=(); fn() { local x=\"$1\"; case \"$x\" in *0) return 0;; *) return 1;; esac; }; for ((i=0; i<40; i++)); do s=\"p_m_${i}_s_e\"; a=\"${s#p_}\"; b=\"${a%_e}\"; c=\"${b//_/}\"; arr+=(\"e_$i\"); map[\"k_$i\"]=$((i + ${#c})); if [[ \"$s\" =~ ^p_m_([0-9]+)_s_e$ ]]; then fn \"${BASH_REMATCH[1]}\"; fi; done",
      ];
      const sandboxShell = new Shell({ fs: sandboxFs });
      for (const plugin of this.#plugins) {
        sandboxShell.use(plugin);
      }
      for (const s of scripts) {
        const isFs = s === fsScript;
        const isSed = s.startsWith("sed ");
        const isJq = s.startsWith("jq ");
        for (let i = 0; i < 4; i++) {
          if (isFs && i > 0) await sandboxFs.rm("/work", { recursive: true, force: true });
          else if (isSed && i > 0) await sandboxFs.rm("/out.txt", { force: true });
          else if (isJq && i > 0) await sandboxFs.rm("/filtered.jsonl", { force: true });
          await sandboxShell.exec("");
          await sandboxShell.exec(s);
        }
      }
      sandboxShell.#clearWarmedInvocation();
    } catch {
      // Ignore prewarm errors in restricted environments
    }
  }

  exec(source: string, options: ShellExecOptions = EMPTY_EXEC_OPTIONS): Promise<ShellResult> {
    if (
      !this.#disposed &&
      this.#warmedInvocation &&
      typeof source === "string" &&
      source.length <= 16384 &&
      (options === EMPTY_EXEC_OPTIONS || this.#isDefaultExecOptions(options))
    ) {
      const sourceCache = getSourceParseCache(source);
      const firstCached = sourceCache?.first0;
      if (firstCached && (!firstCached.unit.script.warnings || firstCached.unit.script.warnings.length === 0)) {
        return this.#execWarmSyncOrFallback(source, options, sourceCache!, firstCached);
      }
      if (!firstCached && !this.#initialLocale) {
        const warm = this.#warmedInvocation;
        if (utf8ByteLength(source) <= warm.budget.limits.maxSourceBytes) {
          const savedParse = warm.budget.parsing.snapshot();
          try {
            const parseState: ParseUnitState = { lineIndex: undefined, lineIndexUnits: 0, currentCachedUnit: undefined };
            let curUnit = getOrParseUnitFromCache(source, 0, false, sourceCache, parseState, warm.budget, undefined);
            while (curUnit.next < source.length) {
              curUnit = getOrParseUnitFromCache(source, curUnit.next, false, sourceCache, parseState, warm.budget, undefined);
            }
            warm.budget.parsing.restore(savedParse);
            const parsedFirst = sourceCache.first0;
            if (parsedFirst && (!parsedFirst.unit.script.warnings || parsedFirst.unit.script.warnings.length === 0)) {
              return this.#execWarmSyncOrFallback(source, options, sourceCache, parsedFirst);
            }
          } catch {
            warm.budget.parsing.restore(savedParse);
          }
        }
      }
    }
    return this.#execAsync(source, options);
  }

  #execWarmSyncOrFallback(
    source: string,
    options: ShellExecOptions,
    sourceCache: SourceParseCache,
    firstCached: CachedParsedUnit,
  ): Promise<ShellResult> {
    const warm = this.#warmedInvocation!;
    this.#warmedInvocation = undefined;
    const { budget, scope, cancellationState, owner, stdout, stderr, stdin, io, currentState, runtime } = warm;
    try {
      if (typeof source !== "string") throw new TypeError("Shell source must be a string");
      const sourceByteLen = sourceCache.byteLength;
      if (sourceByteLen > budget.maxSourceBytesSmi && sourceByteLen > budget.limits.maxSourceBytes) throw new ShellLimitError("maxSourceBytes");
      budget.source(sourceByteLen);
      budget.signal.throwIfAborted();
      budget.parsing.admit(firstCached.unitsCharged);
      let currentCachedUnit: CachedParsedUnit | undefined = firstCached;
      let unit = firstCached.unit;
      let exitCode = 0;
      while (true) {
        if (currentCachedUnit !== undefined && ((unit.script as { _fastConstEcho?: unknown })._fastConstEcho !== undefined || (currentCachedUnit.nextCached !== undefined && (currentCachedUnit.nextCached.unit.script as { _fastConstEcho?: unknown })._fastConstEcho !== undefined))) {
          const batchEnd: CachedParsedUnit | undefined = runtime.tryRunFastConstEchoBatch(currentCachedUnit, source.length, currentState, io);
          if (batchEnd !== undefined) {
            currentCachedUnit = batchEnd;
            unit = batchEnd.unit;
            exitCode = 0;
            if (unit.next >= source.length) break;
            budget.signal.throwIfAborted();
            const vars = currentState.variables;
            const nextLocale = (vars.LC_ALL || vars.LC_CTYPE || vars.LANG) ? byteLocale(vars) : false;
            const nextCached: CachedParsedUnit | undefined = currentCachedUnit.locale === nextLocale ? currentCachedUnit.nextCached : undefined;
            if (nextCached !== undefined && (!nextCached.unit.script.warnings || nextCached.unit.script.warnings.length === 0)) {
              currentCachedUnit = nextCached;
              budget.parsing.admit(nextCached.unitsCharged);
              unit = nextCached.unit;
              continue;
            }
            return this.#continueWarmAsync(source, options, warm, sourceCache, undefined, unit, currentCachedUnit, exitCode);
          }
        }
        if (unit.script.lists.length) {
          const unitResult = runtime.runUnit(unit.script, currentState, io);
          if (unitResult instanceof Promise) {
            return this.#continueWarmAsync(source, options, warm, sourceCache, unitResult, unit, currentCachedUnit, exitCode);
          }
          budget.signal.throwIfAborted();
          exitCode = unitResult.exitCode;
          if (unitResult.terminated) break;
        }
        if (unit.next >= source.length) break;
        budget.signal.throwIfAborted();
        const vars = currentState.variables;
        const nextLocale = (vars.LC_ALL || vars.LC_CTYPE || vars.LANG) ? byteLocale(vars) : false;
        const nextCached: CachedParsedUnit | undefined = currentCachedUnit && currentCachedUnit.locale === nextLocale ? currentCachedUnit.nextCached : undefined;
        if (nextCached !== undefined && (!nextCached.unit.script.warnings || nextCached.unit.script.warnings.length === 0)) {
          currentCachedUnit = nextCached;
          budget.parsing.admit(nextCached.unitsCharged);
          unit = nextCached.unit;
        } else {
          return this.#continueWarmAsync(source, options, warm, sourceCache, undefined, unit, currentCachedUnit, exitCode);
        }
      }
      if (!runtime.tryFinishShellSync(currentState) || budget.hasExecutionCleanup || scope.hasFailures || budget.signal.aborted) {
        return this.#continueWarmAsync(source, options, warm, sourceCache, undefined, undefined, currentCachedUnit, exitCode);
      }
      scope.clearActiveBudget();
      scope.clearActiveStdin();
      void stdin.close();
      const stdoutOutput = stdout.takeUtf8Output();
      const stderrOutput = stderr.takeUtf8Output();
      budget.close();
      if (scope.canFastWarmClose()) {
        owner.closeWarmSync();
        scope.closeWarmSync();
      } else {
        owner.closeSync();
        void scope.close();
      }
      cancellationState.close();
      return Promise.resolve(new FastShellResult(stdoutOutput, stderrOutput, exitCode));
    } catch (error) {
      return this.#failWarmAsync(warm, error);
    }
  }

  async #failWarmAsync(warm: WarmedInvocation, error: unknown): Promise<ShellResult> {
    const { budget, scope, cancellationState, owner, stdin } = warm;
    scope.clearActiveBudget();
    scope.clearActiveStdin();
    if (budget.hasExecutionCleanup) {
      budget.executionCleanup.abort(error);
      await budget.executionCleanup.drain();
    }
    await stdin.close().catch(() => {});
    budget.close();
    await scope.close();
    const selection = owner.finish({ kind: "throw", reason: error });
    cancellationState.close();
    if (scope.hasFailures) throwCleanupFailures(scope.failures);
    if (selection.outcome.kind === "throw") throw selection.outcome.reason;
    return selection.outcome.value as ShellResult;
  }

  async #continueWarmAsync(
    source: string,
    options: ShellExecOptions,
    warm: WarmedInvocation,
    sourceCache: SourceParseCache,
    pendingUnitResult: Promise<{ exitCode: number; terminated: boolean }> | undefined,
    currentUnit: ReturnType<typeof parseShellUnit> | undefined,
    currentCachedUnit: CachedParsedUnit | undefined,
    initialExitCode: number,
  ): Promise<ShellResult> {
    const { budget, scope, cancellationState, owner, boundary, stdout, stderr, stdin, io, currentState, runtime } = warm;
    this.#singleActiveScope = scope;
    this.#singleActiveBudget = budget;
    this.#singleActiveOwner = owner;
    let captured: CapturedCancellationOutcome<ShellResult>;
    try {
      captured = await owner.capture((async () => {
        let failed = false;
        let exitCode = initialExitCode;
        try {
          if (currentUnit !== undefined) {
            let unit = currentUnit;
            let parseState: ParseUnitState | undefined;
            let pending = pendingUnitResult;
            while (true) {
              if (pending !== undefined) {
                const result = await interruptible(pending, budget.signal);
                pending = undefined;
                budget.signal.throwIfAborted();
                exitCode = result.exitCode;
                if (result.terminated) break;
              }
              if (unit.next >= source.length) break;
              budget.signal.throwIfAborted();
              const vars = currentState.variables;
              const nextLocale = (vars.LC_ALL || vars.LC_CTYPE || vars.LANG) ? byteLocale(vars) : false;
              if (currentCachedUnit && currentCachedUnit.locale === nextLocale && currentCachedUnit.nextCached !== undefined) {
                currentCachedUnit = currentCachedUnit.nextCached;
                budget.parsing.admit(currentCachedUnit.unitsCharged);
                unit = currentCachedUnit.unit;
              } else {
                parseState ??= { lineIndex: undefined, lineIndexUnits: 0, currentCachedUnit };
                parseState.currentCachedUnit = currentCachedUnit;
                unit = getOrParseUnitFromCache(source, unit.next, nextLocale, sourceCache, parseState, budget, undefined);
                currentCachedUnit = parseState.currentCachedUnit;
              }
              if (unit.script.warnings) {
                for (const warning of unit.script.warnings) await writeDiagnostic(io.stderr, `shell: warning: ${warning}\n`);
              }
              if (unit.script.lists.length) {
                const unitResult = runtime.runUnit(unit.script, currentState, io);
                if (unitResult instanceof Promise) {
                  pending = unitResult;
                  continue;
                }
                budget.signal.throwIfAborted();
                exitCode = unitResult.exitCode;
                if (unitResult.terminated) break;
              }
            }
          }
          if (!runtime.tryFinishShellSync(currentState)) {
            exitCode = await runtime.finishShell(currentState, io, exitCode);
          }
        } catch (error) {
          if (error instanceof ShellSyntaxError) {
            await writeDiagnostic(io.stderr, `shell: ${error.message}\n`);
            exitCode = error.exitCode;
          } else {
            failed = true;
            if (budget.hasExecutionCleanup) budget.executionCleanup.abort(error);
            throw error;
          }
        } finally {
          scope.clearActiveBudget();
          scope.clearActiveStdin();
          if (budget.hasExecutionCleanup) await budget.executionCleanup.drain();
          const closedStdin = stdin.close();
          if (!isSyncResolved(closedStdin)) {
            if (failed) await closedStdin.catch(() => {});
            else await closedStdin;
          }
        }
        if (budget.hasExecutionCleanup) throwCleanupFailures(budget.executionCleanup.failures);
        const stdoutBytes = stdout.takeBytes();
        const stderrBytes = stderr.takeBytes();
        const stdoutStr = stdoutBytes.byteLength === 0 ? "" : sharedUtf8Decoder.decode(stdoutBytes);
        const stderrStr = stderrBytes.byteLength === 0 ? "" : sharedUtf8Decoder.decode(stderrBytes);
        return { exitCode, stdout: stdoutStr, stderr: stderrStr, stdoutBytes, stderrBytes };
      })());
      if (captured.kind === "throw" && budget.hasExecutionCleanup) budget.executionCleanup.abort(captured.reason);
    } finally {
      if (budget.hasExecutionCleanup) {
        try { await budget.executionCleanup.drain(); }
        catch (error) { scope.failures.push(error); }
      }
      this.#singleActiveScope = undefined;
      this.#singleActiveBudget = undefined;
      this.#singleActiveOwner = undefined;
      budget.close();
    }
    const closeResult = scope.close();
    if (!isSyncResolved(closeResult)) await closeResult;
    const selection = owner.finish(captured);
    cancellationState.close();
    if (scope.hasFailures) throwCleanupFailures(scope.failures);
    if (selection.outcome.kind === "throw") throw selection.outcome.reason;
    return selection.outcome.value;
  }

  async #execAsync(source: string, options: ShellExecOptions = EMPTY_EXEC_OPTIONS): Promise<ShellResult> {
    if (this.#disposed) throw new Error("Shell is disposed");
    if (options.onInternalError !== undefined && typeof options.onInternalError !== "function") throw new TypeError("onInternalError must be callable");
    warnIfHostProcessEnv(options.env);
    let warm: WarmedInvocation | undefined;
    if (this.#warmedInvocation) {
      if (this.#isDefaultExecOptions(options)) {
        warm = this.#warmedInvocation;
        this.#warmedInvocation = undefined;
      } else {
        this.#clearWarmedInvocation();
      }
    }
    const limits = options.limits === undefined ? this.#resolvedLimits : resolveLimits(this.#options.limits, options.limits);
    const budget = warm ? warm.budget : new Budget(limits, options.signal, options.onInternalError ?? this.#options.onInternalError);
    const scope = warm ? warm.scope : new InvocationScope(options.signal);
    const cancellationState = warm ? warm.cancellationState : new RuntimeCancellationState();
    const owner = warm ? warm.owner : new RootInvocationCancellationOwner(scope);
    const admission = warm ? warm.admission : Runtime.rootCancellationAdmission(budget);
    const boundary = warm ? warm.boundary : createRootCancellationLink({
      admission,
      callerSignal: options.signal,
      budgetControlSignal: budget.controller.signal,
      nativeDeliverySignal: this.#hasCustomCommands || this.#middleware.length > 0 || options.signal !== undefined,
    });
    if (!warm) {
      try { owner.activate(boundary); }
      catch (error) {
        scope.failures.push(...boundary.close().failures);
        await scope.close();
        cancellationState.close();
        throw error;
      }
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
      captured = await owner.capture(this.#execute(source, options, scope, budget, boundary, cancellationState, owner, admission, warm));
      if (captured.kind === "throw" && budget.hasExecutionCleanup) budget.executionCleanup.abort(captured.reason);
    } finally {
      if (this.#warmedInvocation?.budget !== budget) {
        if (budget.hasExecutionCleanup) {
          const cleanupDrain = budget.executionCleanup.drain();
          if (!isSyncResolved(cleanupDrain)) await cleanupDrain;
          if (budget.executionCleanup.failures.length > 0) scope.failures.push(...budget.executionCleanup.failures);
        }
        budget.close();
        const scopeClose = scope.close();
        if (!isSyncResolved(scopeClose)) await scopeClose;
      }
    }
    const selection = this.#warmedInvocation?.budget === budget
      ? (owner.resetForReuse(), { outcome: captured })
      : owner.finish(captured);
    if (this.#warmedInvocation?.budget !== budget) {
      cancellationState.close();
    }
    if (activeEntry) {
      this.#active!.delete(activeEntry);
    } else if (this.#singleActiveScope === scope) {
      this.#singleActiveScope = undefined;
      this.#singleActiveBudget = undefined;
      this.#singleActiveOwner = undefined;
    } else if (this.#active) {
      for (const entry of this.#active) {
        if (entry.scope !== scope) continue;
        this.#active.delete(entry);
        break;
      }
    }
    if (selection.outcome.kind === "throw") throw selection.outcome.reason;
    if (scope.hasFailures) throwCleanupFailures(scope.failures);
    if (!warmSyncExecJitWarmed && source === "" && this.#warmedInvocation) {
      warmSyncExecJitWarmed = true;
      await this.#prewarmIsolatedSandbox();
      for (let w = 0; w < 24; w++) { globalThis.process?.memoryUsage?.(); performance.now(); }
      for (let w = 0; w < 16; w++) {
        await this.exec(":", EMPTY_EXEC_OPTIONS);
        await this.#execAsync("", EMPTY_EXEC_OPTIONS);
      }
    }
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
    warm?: WarmedInvocation,
  ): Promise<ShellResult> {
    if (typeof source !== "string") throw new TypeError("Shell source must be a string");
    const sourceByteLength = utf8ByteLength(source);
    if (sourceByteLength > budget.limits.maxSourceBytes) throw new ShellLimitError("maxSourceBytes");
    budget.source(sourceByteLength);
    budget.signal.throwIfAborted();
    if (!warm) scope.setActiveBudget(budget);
    const captureSignal = !this.#hasCustomCommands && this.#middleware.length === 0 ? cancellation.deliverySignal : budget.signal;
    const stdout = warm ? warm.stdout : new Capture(options.stdout === undefined ? budget : undefined, captureSignal);
    const stderr = warm ? warm.stderr : new Capture(options.stderr === undefined ? budget : undefined, captureSignal);
    let stdin: ShellInput | undefined = warm?.stdin;
    let unregisterStdin: (() => void) | undefined;
    if (options.stdin !== undefined && typeof options.stdin !== "string" && !(options.stdin instanceof Uint8Array)) {
      unregisterStdin = scope.register(async () => {
        try { await stdin?.close(); }
        catch (error) { if (!budget.signal.aborted || !Object.is(error, budget.signal.reason)) throw error; }
      });
    }
    const readySync = isSyncResolved(this.#ready);
    const initialCapabilities = !readySync
      ? undefined!
      : options.capabilities === undefined && options.limits === undefined
        ? (this.#defaultIoCapabilities ??= Object.freeze({ ...this.#capabilities, ...this.#options.capabilities, ...(budget.limits.commandLimits === undefined ? {} : { commandLimits: budget.limits.commandLimits }) }))
        : Object.freeze({ ...this.#capabilities, ...this.#options.capabilities, ...options.capabilities, ...(budget.limits.commandLimits === undefined ? {} : { commandLimits: budget.limits.commandLimits }) });
    const io: { -readonly [K in keyof Parameters<Runtime["runUnit"]>[2]]: Parameters<Runtime["runUnit"]>[2][K] } = warm ? warm.io : {
      capabilities: initialCapabilities,
      [invocationScope]: scope,
      stdin: SHARED_EMPTY_SOURCE,
      stdinIsDefault: options.stdin === undefined,
      stdout: createInvocationSink(budget, stdout, options.stdout),
      stderr: createInvocationSink(budget, stderr, options.stderr),
    };
    if (options.admittedHandles !== undefined) io.admittedHandles = options.admittedHandles;
    if (options.processSignals !== undefined) io.processSignals = options.processSignals;
    let exitCode: number;
    let runtime: Runtime | undefined = warm?.runtime;
    let state: State | undefined = warm?.currentState;
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
        let currentState: State;
        if (warm) {
          currentState = warm.currentState;
          runtime = warm.runtime;
        } else {
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
        if (!readySync) {
          await interruptible(this.#ready, budget.signal);
          io.capabilities = options.capabilities === undefined && options.limits === undefined
            ? (this.#defaultIoCapabilities ??= Object.freeze({ ...this.#capabilities, ...this.#options.capabilities, ...(budget.limits.commandLimits === undefined ? {} : { commandLimits: budget.limits.commandLimits }) }))
            : Object.freeze({ ...this.#capabilities, ...this.#options.capabilities, ...options.capabilities, ...(budget.limits.commandLimits === undefined ? {} : { commandLimits: budget.limits.commandLimits }) });
        } else {
          budget.signal.throwIfAborted();
        }
        const cwd = options.cwd !== undefined ? resolvePath("/", options.cwd) : (this.#options.cwd ?? "/");
        const variables = Object.create(null) as Record<string, string>;
        let exported: Set<string> | undefined;
        if (!this.#hasInitialEnv && options.env === undefined) {
          variables.PWD = cwd;
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
        variables.IFS ??= " \t\n";
        currentState = new RootShellState(
          cwd,
          variables,
          exported,
          extensionState(extensions.definitions, undefined, undefined, defaultPortableTrapExtension),
        );
        state = currentState;
        const beforeExecHook = options.hooks?.beforeExec ?? this.#options.hooks?.beforeExec;
        const restoredSnapshot = options.state ?? (beforeExecHook ? await beforeExecHook({ source, options }) : undefined);
        if (restoredSnapshot) {
          currentState = await restoreShellSessionState(
            currentState,
            restoredSnapshot,
            { cwd: options.cwd, env: options.env },
            budget,
            scope,
            extensions.syntax,
          );
          state = currentState;
        }
        const filesystem = options.fs ?? this.#options.fs;
        let runtimeFs: typeof filesystem;
        if (options.fs === undefined) {
          if (!this.#defaultRuntimeFs) {
            this.#defaultRuntimeFs = this.#options.deviceView === "provided" ? filesystem : createDeviceFileSystem(filesystem);
            registerRuntimeBackingFileSystem(this.#defaultRuntimeFs, filesystem);
            warmDefaultRuntimeContextFs(this.#defaultRuntimeFs, filesystem);
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
          true,
        );
        // Finalizers run after child scopes and cooperative cleanup, including cancellation.
        scope.registerFinalizer(runtime.releaseAnchorResources.bind(runtime));
        }
        exitCode = 0;
        while (true) {
          if (unit.script.warnings) {
            for (const warning of unit.script.warnings) await writeDiagnostic(io.stderr, `shell: warning: ${warning}\n`);
          }
          if (unit.script.lists.length) {
            const unitResult = runtime.runUnit(unit.script, currentState, io);
            const result = unitResult instanceof Promise
              ? await interruptible(unitResult, budget.signal)
              : unitResult;
            budget.signal.throwIfAborted();
            exitCode = result.exitCode;
            if (result.terminated) break;
          }
          if (unit.next >= source.length) break;
          budget.signal.throwIfAborted();
          const vars = currentState.variables;
          const nextLocale = (vars.LC_ALL || vars.LC_CTYPE || vars.LANG) ? byteLocale(vars) : false;
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
      if (
        source === "" &&
        !warm &&
        !failed &&
        !this.#warmedInvocation &&
        !budget.hasExecutionCleanup &&
        !scope.hasFailures &&
        !budget.signal.aborted &&
        stdin &&
        runtime &&
        // Host runtimes own native signals tied to the current Worker request.
        // Only the direct memory path can retain an invocation for a later call.
        runtime._isMemoryBackingFs &&
        state &&
        this.#isDefaultExecOptions(options, scope)
      ) {
        if (state.extensions) {
          state.extensions.started = true;
          state.extensions.exiting = false;
        }
        const rawVars = state.variables;
        rawVars.__w0 = ""; rawVars.__w1 = ""; rawVars.__w2 = ""; rawVars.__w3 = ""; rawVars.__w4 = "";
        delete rawVars.__w0; delete rawVars.__w1; delete rawVars.__w2; delete rawVars.__w3; delete rawVars.__w4;
        const monitor = ensureStateMonitor(state, budget, scope);
        void monitor.proxy.variables;
        monitor.values.prewarm();
        stdout.enableScratchBuffer();
        stderr.enableScratchBuffer();
        void runtime.canFastMemoryRedirect;
        preverifyMemoryRgTree((runtime as unknown as { backingFs: unknown }).backingFs);
        this.#warmedInvocation = {
          budget,
          scope,
          cancellationState,
          owner,
          admission,
          boundary: cancellation,
          stdout,
          stderr,
          stdin,
          io,
          currentState: state,
          runtime,
        };
      } else {
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
    }
    if (budget.hasExecutionCleanup) throwCleanupFailures(budget.executionCleanup.failures);
    const stdoutBytes = stdout.takeBytes();
    const stderrBytes = stderr.takeBytes();
    const afterExecHook = options.hooks?.afterExec ?? this.#options.hooks?.afterExec;
    const shouldCaptureState = Boolean(
      state && (options.state !== undefined || options.onState !== undefined || options.hooks !== undefined || this.#options.hooks !== undefined),
    );
    const capturedState = shouldCaptureState && state ? captureShellSessionState(state, exitCode) : undefined;
    const stdoutStr = stdoutBytes.byteLength === 0 ? "" : sharedUtf8Decoder.decode(stdoutBytes);
    const stderrStr = stderrBytes.byteLength === 0 ? "" : sharedUtf8Decoder.decode(stderrBytes);
    if (capturedState === undefined) {
      const fastResult: ShellResult = {
        stdout: stdoutStr,
        stderr: stderrStr,
        stdoutBytes,
        stderrBytes,
        exitCode,
      };
      return fastResult;
    }
    const result: ShellResult = {
      stdout: stdoutStr,
      stderr: stderrStr,
      stdoutBytes,
      stderrBytes,
      exitCode,
      state: capturedState,
    };
    await options.onState?.(capturedState, result);
    await afterExecHook?.(capturedState, result);
    return result;
  }

  dispose(): Promise<void> {
    if (this.#disposal) return this.#disposal;
    this.#disposed = true;
    Runtime.clearStaticPools();
    clearAwkReaderPool();
    clearRgFastRunnerPool();
    this.#clearWarmedInvocation();
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
