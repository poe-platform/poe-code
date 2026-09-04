import { CommandRegistry, resolvePath, toByteSource, writeText } from "../contracts/index.js";
import type {
  ByteSink, CommandDefinition, FileSystemFactory, Middleware, PluginHost,
  RegisterCommandOptions, VirtualShellPlugin,
} from "../contracts/index.js";
import { warnIfHostProcessEnv } from "./env-warning.js";
import { parseShellUnit } from "./parser.js";
import { ShellInput } from "./input.js";
import { byteLocale } from "./locale.js";
import { Budget, Capture, interruptible, resolveLimits, Runtime, RuntimeCancellationState } from "./runtime.js";
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

class RootInvocationCancellationOwner {
  readonly finalized: Promise<void>;
  #resolveFinalized!: () => void;
  #admissionOpen = true;
  #boundary: CancellationBoundary | undefined;
  #observedOrigin: CancellationOrigin | undefined;
  #captureCancellation: ((origin: CancellationOrigin) => void) | undefined;
  #detach: (() => void) | undefined;
  #finished = false;

  constructor(readonly scope: InvocationScope) {
    this.finalized = new Promise<void>(resolve => { this.#resolveFinalized = resolve; });
    scope.register(() => { this.#admissionOpen = false; });
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
      this.scope.failures.push(...close.failures);
      return selectRuntimeCancellationOutcome(this.#boundary!, captured, this.#observedOrigin);
    } finally { this.#resolveFinalized(); }
  }
}

export class Shell implements PluginHost {
  readonly commands: CommandRegistry;
  readonly #middleware: Middleware[] = [];
  readonly #filesystems = new Map<string, FileSystemFactory>();
  readonly #plugins: VirtualShellPlugin[] = [];
  readonly #options: ShellOptions;
  #ready: Promise<void> = Promise.resolve();
  #disposed = false;
  #disposal: Promise<void> | undefined;
  readonly #active = new Set<{ scope: InvocationScope; budget: Budget; owner: RootInvocationCancellationOwner }>();

  constructor(options: ShellOptions) {
    if (!options?.fs) throw new TypeError("Shell requires an explicit filesystem");
    warnIfHostProcessEnv(options.env);
    resolveLimits(options.limits);
    this.#options = { ...options, cwd: resolvePath("/", options.cwd ?? "/"), env: { ...options.env }, limits: { ...options.limits } };
    this.commands = options.commands ?? new CommandRegistry();
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
      this.#ready = this.#ready.then(async () => {
        let active = true;
        const admit = () => {
          if (this.#disposed && !active) throw new Error("Shell is disposed");
        };
        const host: PluginHost = {
          commands: this.commands,
          use: (middleware) => { admit(); this.#install(middleware); },
          registerFileSystem: (scheme, factory) => { admit(); this.#registerFileSystem(scheme, factory); },
        };
        try {
          await middleware.setup(host);
          this.#plugins.push(middleware);
        } finally { active = false; }
      });
      void this.#ready.catch(() => undefined);
    }
  }

  register(command: CommandDefinition, options?: RegisterCommandOptions): this {
    if (this.#disposed) throw new Error("Shell is disposed");
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
    warnIfHostProcessEnv(options.env);
    const budget = new Budget(resolveLimits(this.#options.limits, options.limits), options.signal);
    const scope = new InvocationScope(options.signal);
    const cancellationState = new RuntimeCancellationState();
    const owner = new RootInvocationCancellationOwner(scope);
    const boundary = createRootCancellationLink({
      admission: Runtime.rootCancellationAdmission(budget),
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
    try { captured = await owner.capture(() => this.#execute(source, options, scope, budget, boundary, cancellationState, owner)); }
    finally { budget.close(); await scope.close(); }
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
  ): Promise<ShellResult> {
    if (typeof source !== "string") throw new TypeError("Shell source must be a string");
    if (Buffer.byteLength(source) > budget.limits.maxSourceBytes) throw new ShellLimitError("maxSourceBytes");
    budget.source(Buffer.byteLength(source));
    budget.signal.throwIfAborted();
    const stdout = new Capture();
    const stderr = new Capture();
    const sink = (capture: Capture, external?: ByteSink): ByteSink => budget.sink({
      ...(external?.ownedOutput ? { ownedOutput: {
        consumerClosed: external.ownedOutput.consumerClosed,
        write: async (chunk: Uint8Array) => {
          await capture.write(chunk);
          await external.ownedOutput!.write(chunk);
        },
      } } : {}),
      write: async (chunk) => {
        await capture.write(chunk);
        if (external) await external.write(chunk);
      },
    });
    let stdin: ShellInput | undefined;
    const io = {
      [invocationScope]: scope,
      stdin: toByteSource(""),
      stdinIsDefault: options.stdin === undefined,
      stdout: sink(stdout, options.stdout), stderr: sink(stderr, options.stderr),
    };
    let exitCode: number;
    let failed = false;
    try {
      try {
        let unit = parseShellUnit(source, 0, byteLocale({ ...this.#options.env, ...options.env }), budget.parsing);
        stdin = new ShellInput(typeof options.stdin === "string" || options.stdin instanceof Uint8Array ? toByteSource(options.stdin) : options.stdin ?? toByteSource(""), budget);
        io.stdin = stdin;
        await interruptible(this.#ready, budget.signal);
        const cwd = resolvePath("/", options.cwd ?? this.#options.cwd ?? "/");
        const variables = Object.assign(Object.create(null) as Record<string, string>, this.#options.env, options.env, { PWD: cwd });
        for (const [name, value] of Object.entries(variables)) {
          if (name.includes("\0") || name.includes("=") || typeof value !== "string" || value.includes("\0")) throw new TypeError("Invalid environment entry");
        }
        const exported = new Set(Object.keys(variables));
        variables.OPTIND = "1";
        variables.OPTERR = "1";
        const state: State = {
          cwd, variables, exported, functions: new Map(), positional: [], getopts: { cursor: { index: 0 }, integer: true },
          directoryStack: { entries: [], bytes: 0 },
          dotglob: false,
          status: 0, substitutionStatus: 0, depth: 0, loopDepth: 0, functionDepth: 0, locals: [], pipefail: false, profile: "bash",
        };
        const admission = Runtime.rootCancellationAdmission(budget);
        const runtime = new Runtime(
          options.fs ?? this.#options.fs,
          this.commands,
          [...this.#middleware],
          budget,
          AbortSignal.any([cancellation.deliverySignal, scope.signal]),
          undefined,
          undefined,
          cancellation.deliverySignal,
          cancellation,
          cancellationState,
          owner,
          0,
          admission.maxDepth,
        );
        exitCode = 0;
        while (true) {
          for (const warning of unit.script.warnings ?? []) await writeText(io.stderr, `shell: warning: ${warning}\n`);
          if (unit.script.lists.length) {
            const result = await interruptible(runtime.runUnit(unit.script, state, io), budget.signal);
            exitCode = result.exitCode;
            if (result.terminated) break;
          }
          if (unit.next >= source.length) break;
          budget.signal.throwIfAborted();
          unit = parseShellUnit(source, unit.next, byteLocale(state.variables), budget.parsing);
        }
      } catch (error) {
        if (!(error instanceof ShellSyntaxError)) throw error;
        const line = source.slice(0, error.offset).split("\n").length;
        if (error.unclosedQuote) {
          await writeText(io.stderr, `shell: -c: line ${error.unclosedQuote.line}: unexpected EOF while looking for matching \`${error.unclosedQuote.quote}'\n`);
        } else if (error.exitCode === 127) {
          const token = /^[;&|()<>]|^[^\s;&|()<>]+/u.exec(source.slice(error.offset))?.[0] ?? "newline";
          await writeText(io.stderr, `shell: -c: line ${line}: syntax error near unexpected token \`${token}'\nshell: -c: line ${line}: \`${source.split("\n")[line - 1] ?? ""}'\n`);
        } else if (error.offset >= source.length && !/Unterminated|nesting|Unsupported/u.test(error.reason)) {
          const context = error.incompleteCommand ? ` from \`${error.incompleteCommand.name}' command on line ${error.incompleteCommand.line}` : "";
          await writeText(io.stderr, `shell: -c: line ${source.split("\n").length + Number(!source.endsWith("\n"))}: syntax error: unexpected end of file${context}\n`);
        } else await writeText(io.stderr, `shell: ${error.message}\n`);
        exitCode = error.exitCode;
      }
    } catch (error) { failed = true; throw error; }
    finally {
      if (failed) await stdin?.close().catch(() => {});
      else await stdin?.close();
    }
    const stdoutBytes = stdout.takeBytes();
    const stderrBytes = stderr.takeBytes();
    return {
      stdout: new TextDecoder("utf-8", { ignoreBOM: true }).decode(stdoutBytes),
      stderr: new TextDecoder("utf-8", { ignoreBOM: true }).decode(stderrBytes),
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
      const drain = scope.close();
      budget.controller.abort(new Error("Shell is disposed"));
      drains.push(drain);
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
