import { CommandRegistry, resolvePath, toByteSource, writeText } from "../contracts/index.js";
import type {
  ByteSink, CommandDefinition, FileSystemFactory, Middleware, PluginHost,
  RegisterCommandOptions, VirtualShellPlugin,
} from "../contracts/index.js";
import { parseShellUnit } from "./parser.js";
import { ShellInput } from "./input.js";
import { byteLocale } from "./locale.js";
import { Budget, Capture, interruptible, resolveLimits, Runtime } from "./runtime.js";
import type { State } from "./runtime.js";
import { ShellLimitError, ShellSyntaxError } from "./types.js";
import type { ShellExecOptions, ShellOptions, ShellResult } from "./types.js";
import { InvocationScope, invocationScope, throwCleanupFailures } from "./cleanup.js";

export class Shell implements PluginHost {
  readonly commands: CommandRegistry;
  readonly #middleware: Middleware[] = [];
  readonly #filesystems = new Map<string, FileSystemFactory>();
  readonly #plugins: VirtualShellPlugin[] = [];
  readonly #options: ShellOptions;
  #ready: Promise<void> = Promise.resolve();
  #disposed = false;
  #disposal: Promise<void> | undefined;
  readonly #active = new Set<{ scope: InvocationScope; budget: Budget }>();

  constructor(options: ShellOptions) {
    if (!options?.fs) throw new TypeError("Shell requires an explicit filesystem");
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
    const budget = new Budget(resolveLimits(this.#options.limits, options.limits), options.signal);
    const scope = new InvocationScope(options.signal);
    const active = { scope, budget };
    this.#active.add(active);
    let failed = false;
    let failure: unknown;
    let result: ShellResult | undefined;
    try { result = await this.#execute(source, options, scope, budget); }
    catch (error) { failed = true; failure = error; }
    finally {
      await scope.close();
      this.#active.delete(active);
    }
    options.signal?.throwIfAborted();
    if (failed) throw failure;
    throwCleanupFailures(scope.failures);
    return result!;
  }

  async #execute(source: string, options: ShellExecOptions, scope: InvocationScope, budget: Budget): Promise<ShellResult> {
    if (typeof source !== "string") throw new TypeError("Shell source must be a string");
    if (Buffer.byteLength(source) > budget.limits.maxSourceBytes) throw new ShellLimitError("maxSourceBytes");
    budget.source(Buffer.byteLength(source));
    budget.signal.throwIfAborted();
    const stdout = new Capture();
    const stderr = new Capture();
    const sink = (capture: Capture, external?: ByteSink): ByteSink => budget.sink({
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
        let unit = parseShellUnit(source, 0, byteLocale({ ...this.#options.env, ...options.env }));
        stdin = new ShellInput(typeof options.stdin === "string" || options.stdin instanceof Uint8Array ? toByteSource(options.stdin) : options.stdin ?? toByteSource(""), budget);
        io.stdin = stdin;
        await interruptible(this.#ready, budget.signal);
        const cwd = resolvePath("/", options.cwd ?? this.#options.cwd ?? "/");
        const variables = Object.assign(Object.create(null) as Record<string, string>, this.#options.env, options.env, { PWD: cwd });
        for (const [name, value] of Object.entries(variables)) {
          if (name.includes("\0") || name.includes("=") || typeof value !== "string" || value.includes("\0")) throw new TypeError("Invalid environment entry");
        }
        const state: State = {
          cwd, variables, exported: new Set(Object.keys(variables)), functions: new Map(), positional: [],
          status: 0, substitutionStatus: 0, depth: 0, loopDepth: 0, functionDepth: 0, locals: [], pipefail: false, profile: "bash",
        };
        const runtime = new Runtime(options.fs ?? this.#options.fs, this.commands, [...this.#middleware], budget, AbortSignal.any([budget.signal, scope.signal]), undefined, undefined, budget.signal);
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
          unit = parseShellUnit(source, unit.next, byteLocale(state.variables));
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
      try { await stdin?.close(); }
      catch (error) { if (!failed) throw error; }
    }
    const stdoutBytes = stdout.bytes();
    const stderrBytes = stderr.bytes();
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

  async #dispose(active: readonly { scope: InvocationScope }[], drains: readonly Promise<void>[]): Promise<void> {
    await Promise.all(drains);
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
