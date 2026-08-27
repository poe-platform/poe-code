import {
  ACCESS_MODES, composeMiddleware, createBytePipe, pipeBytes, resolvePath, toByteSource, validateExitCode, writeText,
} from "../contracts/index.js";
import type {
  ByteSink, ByteSource, CommandContext, CommandRegistry, FileSystem, Middleware,
} from "../contracts/index.js";
import type { Command, HereDocument, Pipeline, Redirect, Script, Word, WordPart } from "./parser.js";
import { HereDocumentSyntaxError, hereDocumentWords, parseShellInputUnit, parseShellUnit } from "./parser.js";
import { ShellLimitError, ShellSyntaxError } from "./types.js";
import type { ShellCommandContext, ShellInvokeOptions, ShellLimits } from "./types.js";
import { ShellInput } from "./input.js";
import { evaluateArithmetic, prepareArithmetic } from "./arithmetic.js";
import { compilePattern, matchesPattern } from "./pattern.js";
import { byteLocale } from "./locale.js";
import { functionDisplay } from "./display.js";
import { invocationScope, type InvocationScope } from "./cleanup.js";

export const defaultLimits: Required<ShellLimits> = {
  maxOutputBytes: 16 * 1024 * 1024,
  maxCommands: 10_000,
  maxLoopIterations: 10_000,
  maxSubstitutionDepth: 64,
  maxSourceBytes: 1024 * 1024,
  maxExpansionFields: 10_000,
  maxExpansionBytes: 16 * 1024 * 1024,
  pipeHighWaterMark: 64 * 1024,
};

const shellBuiltinNames = new Set([
  ":", "true", "false", "pwd", "cd", "set", "shift", "export", "local", "unset", "read",
  "exit", "return", "break", "continue", "command", "type", "readonly", "echo", "printf", "test", "[", ".", "source", "eval",
]);

const implementedBuiltins = new Set([...shellBuiltinNames].filter(name => !["echo", "printf", "test", "["].includes(name)));
const specialBuiltinNames = new Set([":", ".", "break", "continue", "eval", "exit", "export", "readonly", "return", "set", "shift", "unset"]);
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
  commands = 0;
  iterations = 0;
  bytes = 0;
  sourceBytes = 0;
  readonly controller = new AbortController();
  readonly signal: AbortSignal;

  constructor(readonly limits: Required<ShellLimits>, signal?: AbortSignal) {
    this.signal = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
  }

  fail(limit: keyof ShellLimits): never {
    const error = new ShellLimitError(limit);
    this.controller.abort(error);
    throw error;
  }

  tick(): void {
    this.signal.throwIfAborted();
    if (++this.commands > this.limits.maxCommands) this.fail("maxCommands");
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

  async write(chunk: Uint8Array): Promise<void> {
    this.chunks.push(new Uint8Array(chunk));
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
}

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
  locals: Map<string, { value: string | undefined; exported: boolean; readOnly?: boolean }>[];
  pipefail: boolean;
  errexit?: boolean;
  isolated?: boolean;
  redirectAssignments?: ReadonlyMap<string, string>;
}

interface IO {
  readonly [invocationScope]: InvocationScope;
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

class Flow extends Error {
  constructor(readonly kind: "exit" | "return" | "break" | "continue", readonly status: number, public levels = 1) {
    super(kind);
  }
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

class PipelineClosed extends Error {
  readonly code = "EPIPE";
  constructor() { super("Pipeline consumer exited"); }
}

function signalSink(sink: ByteSink, signal: AbortSignal): ByteSink {
  const ownership = budgetedSinks.get(sink);
  const owned = ownership?.write === sink.write ? ownership : undefined;
  const write = owned ? owned.write.bind(sink) : (chunk: Uint8Array) => sink.write(chunk);
  const output: ByteSink = { async write(chunk) { signal.throwIfAborted(); await interruptible(write(chunk), signal); } };
  if (owned) budgetedSinks.set(output, { budget: owned.budget, write: output.write });
  return output;
}

function cloneState(state: State): State {
  return {
    ...state,
    variables: Object.assign(Object.create(null) as Record<string, string>, state.variables),
    exported: new Set(state.exported), functions: new Map(state.functions), positional: [...state.positional],
    readonlyVariables: new Set(state.readonlyVariables),
    locals: state.locals.map((scope) => new Map(scope)),
  };
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

const closedSink: ByteSink = { async write() { throw Object.assign(new Error("Bad file descriptor"), { code: "EBADF" }); } };
const closedSource: ByteSource = { async *[Symbol.asyncIterator]() { throw Object.assign(new Error("Bad file descriptor"), { code: "EBADF" }); } };

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
  ) {}

  diagnostic(io: IO, text: string): Promise<void> {
    return writeText(io.stderr, `${io.scriptName ?? "shell"}: line ${io.diagnosticLine ?? 1}: ${text}\n`);
  }

  writeVariable(state: State, name: string, value: string): void {
    if (state.readonlyVariables?.has(name)) throw new Error(`${name}: readonly variable`);
    state.variables[name] = value;
  }

  arithmeticVariables(state: State): Record<string, string> {
    if (!state.readonlyVariables?.size) return state.variables;
    return new Proxy(state.variables, { set: (_target, key, value: string) => { this.writeVariable(state, String(key), value); return true; } });
  }

  async run(script: Script, state: State, io: IO): Promise<number> {
    return (await this.runUnit(script, state, io)).exitCode;
  }

  async runUnit(script: Script, state: State, io: IO): Promise<{ exitCode: number; terminated: boolean }> {
    try { return { exitCode: await this.script(script, state, io), terminated: false }; }
    catch (error) {
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
        state.status = await this.pipeline(pipeline, state, ignored ? { ...io, execution: { ignoreErrexit: true } } : io);
      }
    }
    return script.lists.length ? state.status : 0;
  }

  async pipeline(pipeline: Pipeline, state: State, io: IO): Promise<number> {
    this.signal.throwIfAborted();
    let status: number;
    if (pipeline.commands.length === 1) status = await this.command(pipeline.commands[0]!, state, io);
    else {
      const pipes = pipeline.commands.slice(1).map(() => createBytePipe({
        highWaterMark: this.budget.limits.pipeHighWaterMark, signal: this.signal,
      }));
      const controllers = pipeline.commands.map(() => new AbortController());
      const written = new Set<number>();
      const completed = new Set<number>();
      const closing = new Set<ReturnType<typeof setImmediate>>();
      const tasks = pipeline.commands.map(async (command, index) => {
        const incoming = pipes[index - 1];
        const outgoing = pipes[index];
        const signal = AbortSignal.any([this.signal, controllers[index]!.signal]);
        const commandSignal = AbortSignal.any([this.commandSignal, controllers[index]!.signal]);
        const runtime = new Runtime(this.fs, this.commands, this.middleware, this.budget, signal, this.fileWrites, this.outputFiles, commandSignal);
        const input = new ShellInput(incoming?.readable ?? io.stdin, this.budget, signal);
        const pipeOutput: ByteSink | undefined = outgoing && { write: async (chunk) => {
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
        try {
          return await interruptible(runtime.runCommandIsolated(command, { ...cloneState(state), isolated: true }, {
            ...isolateIO(io),
            stdin: input,
            ...(incoming ? { stdinIsDefault: false } : {}),
            stdout: pipeOutput ? this.budget.sink(pipeOutput, signal) : signalSink(io.stdout, signal),
            stderr: signalSink(io.stderr, signal),
          }), signal);
        } catch (error) {
          if (error instanceof PipelineClosed) return 141;
          throw error;
        } finally {
          completed.add(index);
          if (incoming) {
            const upstream = index - 1;
            const close = setImmediate(() => {
              closing.delete(close);
              if (written.has(upstream) && !completed.has(upstream)) controllers[upstream]!.abort(new PipelineClosed());
            });
            closing.add(close);
            await incoming.abort();
          }
          await input.close().catch((error: unknown) => { if (!(error instanceof PipelineClosed)) throw error; });
          if (outgoing) await outgoing.close().catch(() => undefined);
        }
      });
      try {
        const statuses = await interruptible(Promise.all(tasks), this.signal);
        status = state.pipefail ? statuses.findLast((status) => status !== 0) ?? 0 : statuses.at(-1)!;
      } finally {
        for (const close of closing) clearImmediate(close);
        for (const controller of controllers) controller.abort(new PipelineClosed());
        await Promise.all(pipes.map((pipe) => pipe.abort()));
      }
    }
    if (pipeline.commands.length > 1) this.errexit(status, state, io);
    return pipeline.negate ? Number(status === 0) : status;
  }

  async runCommandIsolated(command: Command, state: State, io: IO, fileShortcut = false): Promise<number> {
    try { return await this.command(command, state, io, fileShortcut); }
    catch (error) {
      if (error instanceof Flow && (error.kind === "exit" || error.kind === "return")) return error.status;
      throw error;
    }
  }

  errexit(status: number, state: State, io: IO): void {
    this.signal.throwIfAborted();
    if (status !== 0 && state.errexit && !io.execution?.ignoreErrexit) throw new Flow("exit", status);
  }

  async command(command: Command, state: State, io: IO, fileShortcut = false): Promise<number> {
    io[invocationScope].assertOpen();
    const status = await this.executeCommand(command, state, io, fileShortcut);
    if (command.kind === "simple" || command.kind === "subshell" || command.kind === "arithmetic") this.errexit(status, state, io);
    return status;
  }

  async executeCommand(command: Command, state: State, originalIO: IO, fileShortcut = false): Promise<number> {
    originalIO = activeIO(originalIO);
    originalIO.descriptors ??= new Map<number, Descriptor>([
      [0, { input: originalIO.stdin, ...(originalIO.stdinIsDefault === undefined ? {} : { stdinIsDefault: originalIO.stdinIsDefault }) }],
      [1, { output: originalIO.stdout }], [2, { output: originalIO.stderr }],
    ]);
    const diagnosticLine = (command.line ?? 1) + (originalIO.diagnosticOffset ?? 0);
    originalIO = { ...originalIO, diagnosticLine, substitutionDiagnosticLine: originalIO.substitutionDiagnosticLines?.get(command) ?? diagnosticLine };
    if (command.kind === "subshell") originalIO = isolateIO(originalIO);
    this.budget.tick();
    if (this.budget.commands % 128 === 0) await interruptible(new Promise<void>((resolve) => setImmediate(resolve)), this.signal);
    this.signal.throwIfAborted();
    const inputs = new Set<ShellInput>();
    const outputs = new Set<() => void>();
    let io = originalIO;
    try {
      if (command.kind === "function") {
        if (state.profile === "sh" && specialBuiltinNames.has(command.name)) {
          await this.diagnostic(io, `\`${command.name}': is a special builtin`);
          throw new Flow("exit", 2);
        }
        state.functions.set(command.name, { ...command.body, sourceName: io.scriptName ?? "shell" });
        return 0;
      }
      if (command.kind === "simple") return await this.simple(command, state, originalIO, inputs, outputs, fileShortcut);
      io = await this.redirect(command.redirects, state, io, inputs, outputs, command.kind === "subshell", command.kind !== "subshell");
      if (command.kind === "arithmetic") {
        try { return Number(evaluateArithmetic(command.expression, this.arithmeticVariables(state)) === 0n); }
        catch (error) { throw new Error(`((: ${message(error)}`); }
      }
      if (command.kind === "subshell") {
        const child = cloneState(state);
        child.isolated = true;
        child.loopDepth = 0;
        return await this.run(command.body, child, io);
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
            if (++patterns % 128 === 0) await interruptible(new Promise<void>((resolve) => setImmediate(resolve)), this.signal);
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
      state.loopDepth++;
      try {
        if (command.kind === "for") {
          const values = command.words ? await this.words(command.words, state, io) : state.positional;
          for (const value of values) {
            this.budget.loop();
            this.writeVariable(state, command.name, value);
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
      } finally { state.loopDepth--; }
      return status;
    } catch (error) {
      const diagnostic = error instanceof ExecutionFailure ? error.diagnostic : undefined;
      if (error instanceof ExecutionFailure) { io = error.io; error = error.original; }
      this.signal.throwIfAborted();
      if (error instanceof Flow || error instanceof ShellLimitError || error instanceof ShellSyntaxError) throw error;
      if (error instanceof HereDocumentSyntaxError) {
        await writeText(io.stderr, error.diagnostic);
        this.errexit(1, state, io);
        return 1;
      }
      if (errorCode(error) === "EPIPE") { this.errexit(141, state, io); return 141; }
      const line = error instanceof ExpansionFailure ? error.line ?? io.diagnosticLine ?? 1 : io.diagnosticLine ?? 1;
      try { await writeText(io.stderr, `${io.scriptName ?? "shell"}: line ${line}: ${diagnostic ?? message(error)}\n`); }
      catch { this.signal.throwIfAborted(); }
      if (error instanceof ExpansionFailure) throw new Flow("exit", error instanceof ParameterExpansionFailure && !state.isolated ? 127 : 1);
      if (error instanceof FatalCommandFailure) throw new Flow("exit", error.status);
      const status = error instanceof CommandFailure ? error.status : 1;
      this.errexit(status, state, io);
      return status;
    } finally {
      for (const close of outputs) close();
      await Promise.all([...inputs].map((input) => input.close()));
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
      for (const word of hereDocumentWords(document, line, byteLocale(state.variables), warnings)) {
        this.signal.throwIfAborted();
        for (const warning of warnings.splice(0)) await writeText(io.stderr, `shell: warning: ${warning}\n`);
        if (++words % 128 === 0) await interruptible(new Promise<void>((resolve) => setImmediate(resolve)), this.signal);
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

  async redirect(redirects: readonly Redirect[], state: State, io: IO, inputs: Set<ShellInput>, outputs: Set<() => void>, isolatedInlineInput = false, persistMoves = false, fileShortcut = false, line?: number): Promise<IO> {
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
          const source = stat.type === "directory" ? toByteSource("") : this.fs.readStream
            ? this.fs.readStream(path, options)
            : toByteSource(await interruptible(this.fs.readFile(path, { ...options, maxBytes: this.budget.limits.maxOutputBytes }), this.signal));
          const input = new ShellInput(source, this.budget, this.signal);
          inputs.add(input);
          descriptors.set(redirect.descriptor, { input, stdinIsDefault: false });
        } else {
          const append = redirect.operator === ">>";
          let file!: OutputFile;
          await this.fileOperation(path, async () => {
            await this.fs.writeFile(path, new Uint8Array(), { ...options, flag: append ? "a" : "w" });
            file = this.outputFiles.get(path) ?? { data: undefined, references: 0 };
            if (!append) file.data = new Uint8Array();
            file.references++;
            this.outputFiles.set(path, file);
          });
          let closed = false;
          outputs.add(() => {
            closed = true;
            if (--file.references === 0 && this.outputFiles.get(path) === file) this.outputFiles.delete(path);
          });
          let offset = 0;
          const output = this.budget.sink({ write: (chunk) => {
            const copy = new Uint8Array(chunk);
            return this.fileOperation(path, async () => {
              if (closed) throw new Error("Output descriptor is closed");
              const current = file.data;
              if (append) {
                await this.fs.appendFile(path, copy, options);
                if (current) {
                  const bytes = new Uint8Array(current.length + copy.length);
                  bytes.set(current);
                  bytes.set(copy, current.length);
                  file.data = bytes;
                }
              } else {
                const bytes = new Uint8Array(Math.max(current?.length ?? 0, offset + copy.length));
                if (current) bytes.set(current);
                bytes.set(copy, offset);
                await this.fs.writeFile(path, bytes, options);
                file.data = bytes;
                offset += copy.length;
              }
            });
          } }, this.signal);
          descriptors.set(redirect.descriptor, { output });
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

  assignment(word: Word): { name: string; value: Word } | undefined {
    const first = word.parts[0];
    if (first?.kind !== "text" || first.quoted) return undefined;
    const match = /^([a-zA-Z_][a-zA-Z_0-9]*)=/u.exec(first.value);
    if (!match) return undefined;
    return { name: match[1]!, value: { offset: word.offset, parts: [{ ...first, value: first.value.slice(match[0].length) }, ...word.parts.slice(1)] } };
  }

  async simple(command: Extract<Command, { kind: "simple" }>, state: State, originalIO: IO, inputs: Set<ShellInput>, outputs: Set<() => void>, fileShortcut = false): Promise<number> {
    state.substitutionStatus = 0;
    const assignments: { name: string; value: Word }[] = [];
    let wordIndex = 0;
    for (; wordIndex < command.words.length; wordIndex++) {
      const assignment = this.assignment(command.words[wordIndex]!);
      if (!assignment) break;
      assignments.push(assignment);
    }
    const commandWords = command.words.slice(wordIndex);
    let declarationIndex = 0;
    while (commandWords[declarationIndex]?.plain === "command") {
      declarationIndex++;
      if (commandWords[declarationIndex]?.plain === "--") declarationIndex++;
    }
    const words = await this.words(commandWords, state, originalIO, ["export", "local", "readonly"].includes(commandWords[declarationIndex]?.plain ?? ""));
    const special = state.profile === "sh" && specialBuiltinNames.has(words[0] ?? "");
    const inlineInput = command.redirects.some((redirect) => redirect.document || redirect.operator === "<<<");
    const functionCommand = words.length > 0 && state.functions.has(words[0]!);
    const isolatedInlineInput = inlineInput && words.length > 0 && !shellBuiltinNames.has(words[0]!) && !functionCommand;
    if (isolatedInlineInput) state = cloneState(state);
    let io = originalIO;
    const previous = new Map<string, { value: string | undefined; exported: boolean }>();
    const assign = async () => {
      for (const assignment of assignments) {
        const value = (await this.word(assignment.value, state, io, false)).join("");
        if (state.readonlyVariables?.has(assignment.name)) {
          await this.diagnostic(io, `${assignment.name}: readonly variable`);
          if (state.profile === "sh" || !words.length) throw new Flow("exit", state.profile === "sh" && (special || !words.length) ? 127 : 1);
          continue;
        }
        if (!previous.has(assignment.name)) previous.set(assignment.name, { value: state.variables[assignment.name], exported: state.exported.has(assignment.name) });
        state.variables[assignment.name] = value;
        if (words.length) state.exported.add(assignment.name);
      }
    };
    try {
      if (inlineInput || (state.profile === "sh" || !words.length) && assignments.some(assignment => state.readonlyVariables?.has(assignment.name))) await assign();
      if (inlineInput && functionCommand && previous.size) {
        const variables = Object.assign(Object.create(null) as Record<string, string>, state.variables);
        const redirectAssignments = new Map<string, string>();
        for (const [name, saved] of previous) {
          redirectAssignments.set(name, state.variables[name]!);
          if (saved.value === undefined) delete variables[name];
          else variables[name] = saved.value;
        }
        const redirectState = { ...state, variables, redirectAssignments };
        try { io = await this.redirect(command.redirects, redirectState, io, inputs, outputs, false, true, false, command.line ?? 1); }
        finally {
          state.substitutionStatus = redirectState.substitutionStatus;
          for (const [name, value] of Object.entries(variables)) {
            if (!previous.has(name)) state.variables[name] = value;
          }
          for (const [name, saved] of previous) saved.value = variables[name];
        }
      } else io = await this.redirect(command.redirects, state, io, inputs, outputs, isolatedInlineInput, !words.length || shellBuiltinNames.has(words[0]!) || functionCommand, fileShortcut, command.line ?? 1);
      if (!inlineInput) await assign();
      if (fileShortcut) {
        const input = io.descriptors?.get(command.redirects[0]!.descriptor)?.input;
        if (!input) throw new Error("Bad file descriptor");
        await pipeBytes(input, io.stdout, this.signal);
        return 0;
      }
      return words.length ? await this.dispatch(words[0]!, words.slice(1), state, io, previous) : state.substitutionStatus;
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
      if (words.length) for (const [key, saved] of previous) {
        if (saved.value === undefined) delete state.variables[key];
        else state.variables[key] = saved.value;
        if (saved.exported) state.exported.add(key);
        else state.exported.delete(key);
      }
    }
  }

  async dispatch(name: string, args: readonly string[], state: State, io: IO, assignments: Map<string, { value: string | undefined; exported: boolean }>, bypassFunctions = false): Promise<number> {
    const scope = io[invocationScope].child();
    const runtime = new Runtime(this.fs, this.commands, this.middleware, this.budget, AbortSignal.any([this.signal, scope.signal]), this.fileWrites, this.outputFiles, this.commandSignal);
    try { return await runtime.dispatchScoped(name, args, state, { ...io, [invocationScope]: scope }, assignments, bypassFunctions); }
    finally { await scope.close(); }
  }

  private async dispatchScoped(name: string, args: readonly string[], state: State, io: IO, assignments: Map<string, { value: string | undefined; exported: boolean }>, bypassFunctions: boolean): Promise<number> {
    const { [invocationScope]: scope, ...publicIO } = io;
    let builtinFailure: { error: unknown; diagnostic: string } | undefined;
    const env = Object.create(null) as Record<string, string>;
    for (const key of state.exported) {
      const value = state.variables[key];
      if (value !== undefined) env[key] = value;
    }
    const initialEnv = { ...env };
    const context: ShellCommandContext = {
      ...publicIO, command: name, args, env, cwd: state.cwd, fs: this.fs, signal: this.commandSignal,
      registerCleanup: (cleanup) => scope.register(cleanup),
      invoke: (name, args, options) => {
        const invocation = this.invoke(name, args, options, context, state, scope);
        void invocation.catch(() => undefined);
        return invocation;
      },
    };
    const middleware = this.middleware.map<Middleware>((handler) => (context, next) => {
      scope.assertOpen();
      return handler(context, next);
    });
    const execute = composeMiddleware(middleware, async (forwarded) => {
      const context = { ...forwarded, [invocationScope]: scope };
      scope.assertOpen();
      const previous = new Map<string, { value: string | undefined; exported: boolean; overlay: string | undefined }>();
      const cwd = state.cwd;
      state.cwd = resolvePath("/", context.cwd);
      for (const key of new Set([...Object.keys(initialEnv), ...Object.keys(context.env)])) {
        if (initialEnv[key] === context.env[key]) continue;
        const value = context.env[key];
        if (key.includes("\0") || key.includes("=") || (value !== undefined && (typeof value !== "string" || value.includes("\0")))) throw new TypeError("Invalid middleware environment value");
        previous.set(key, { value: state.variables[key], exported: state.exported.has(key), overlay: value });
        if (value === undefined) { delete state.variables[key]; state.exported.delete(key); }
        else { state.variables[key] = value; state.exported.add(key); }
      }
      try {
        const selected = this.internalDiscovery(context.command, state, bypassFunctions)[0];
        const body = selected?.kind === "function" ? state.functions.get(context.command) : undefined;
        if (body) {
          if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
          const positional = state.positional;
          const positionalSetVersion = state.positionalSetVersion ?? 0;
          state.positional = [...context.args];
          state.functionDepth++;
          state.depth++;
          const locals = new Map<string, { value: string | undefined; exported: boolean; readOnly?: boolean }>();
          state.locals.push(locals);
          try { return { exitCode: await this.command(body, state, { ...io, ...context, scriptName: body.sourceName ?? io.scriptName ?? "shell" }) }; }
          catch (error) {
            if (error instanceof Flow && error.kind === "return") return { exitCode: error.status };
            throw error;
          } finally {
            state.positional = positional;
            state.positionalSetVersion = positionalSetVersion;
            state.functionDepth--;
            state.depth--;
            state.locals.pop();
            for (const [name, previous] of locals) {
              if (previous.value === undefined) delete state.variables[name];
              else state.variables[name] = previous.value;
              if (previous.exported) state.exported.add(name);
              else state.exported.delete(name);
              if (!previous.readOnly) state.readonlyVariables?.delete(name);
            }
          }
        }
        if (selected?.kind === "builtin") {
          if (context.command === "command" || context.command === "type") return { exitCode: await this.discoveryBuiltin(context, state, io, assignments) };
          const special = state.profile === "sh" && !bypassFunctions && specialBuiltinNames.has(context.command);
          if (special) assignments.clear();
          if (context.command === "." || context.command === "source") return { exitCode: await this.sourceBuiltin(context, state, { ...io, ...context }, special) };
          if (context.command === "eval") return { exitCode: await this.evalBuiltin(context, state, { ...io, ...context }, special) };
          const builtin = await this.builtin(context, state, assignments, (error, diagnostic) => { builtinFailure = { error, diagnostic }; }, bypassFunctions);
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
          await this.diagnostic({ ...io, ...context }, `${context.command}: command not found`);
          return { exitCode: 127 };
        }
        return await definition.execute(forwarded);
      } finally {
        if (context.command !== "cd" && state.cwd === context.cwd) state.cwd = cwd;
        for (const [key, saved] of previous) {
          if (state.variables[key] !== saved.overlay) continue;
          if (saved.value === undefined) delete state.variables[key];
          else state.variables[key] = saved.value;
          if (saved.exported) state.exported.add(key);
          else state.exported.delete(key);
        }
      }
    });
    try { return validateExitCode((await interruptible(execute(context), this.signal)).exitCode); }
    catch (error) {
      if (builtinFailure && error === builtinFailure.error) throw new ExecutionFailure(error, io, builtinFailure.diagnostic);
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

  async discoveryBuiltin(context: CommandContext, state: State, io: IO, assignments: Map<string, { value: string | undefined; exported: boolean }>): Promise<number> {
    const args = [...context.args];
    const command = context.command === "command";
    let mode: "describe" | "name" | "kind" | "path" = "describe";
    let discover = !command;
    let all = false;
    let skipFunctions = false;
    let forcePath = false;
    while (args[0]?.startsWith("-") && args[0] !== "-") {
      const option = args.shift()!;
      if (option === "--") break;
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
      this.budget.tick();
      if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
      state.depth++;
      try { return await this.dispatch(target, args, state, { ...io, ...context }, assignments, true); }
      finally { state.depth--; }
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
    return {
      cwd: state.cwd, variables, exported: new Set(Object.keys(variables)), functions: new Map(),
      positional: [...args], arg0, profile: context.command === "sh" ? "sh" : "bash", status: 0, substitutionStatus: 0, depth: state.depth + 1,
      loopDepth: 0, functionDepth: 0, locals: [], pipefail: false, isolated: true,
      errexit: false,
    };
  }

  async interpreter(context: CommandContext, state: State, io: IO): Promise<number> {
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
    if (!commandString && !standardInput && args.length) return this.scriptFile(context, state, io, args[0]!, args.slice(1), false, errexit);
    const source = commandString ? args.shift() : undefined;
    if (commandString && source === undefined) {
      await writeText(context.stderr, `${context.command}: -c: option requires an argument\n`);
      return 2;
    }
    const arg0 = commandString ? args.shift() ?? context.command : context.command;
    const child = this.processState(context, state, arg0, args);
    child.errexit = errexit;
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
    let position = 0;
    let status = 0;
    try {
      do {
        this.signal.throwIfAborted();
        const unit = parseShellUnit(source, position, byteLocale(state.variables));
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
      if (++lines % 32 === 0) await interruptible(new Promise<void>(resolve => setImmediate(resolve)), this.signal);
      this.signal.throwIfAborted();
      const bytes = await input.sourceLine();
      const eof = bytes === undefined;
      if (bytes) source += this.sourceText(bytes, io.scriptName ?? "shell");
      const unitIO = { ...io, diagnosticOffset: offset };
      try {
        const unit = eof ? parseShellUnit(source, 0, byteLocale(state.variables)) : parseShellInputUnit(source, byteLocale(state.variables));
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

  async scriptFile(context: CommandContext, state: State, io: IO, target: string, args: readonly string[], direct: boolean, errexit = false): Promise<number> {
    if (target === "") throw new CommandFailure(`${context.command}: : No such file or directory`, 127);
    if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
    const path = resolvePath(state.cwd, target);
    let source: string;
    let interpreterProfile: "bash" | "sh" | undefined;
    try {
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
      if (source.startsWith("#!")) {
        const interpreter = source.split("\n", 1)[0]!.slice(2).replace(/^[ \t]+|[ \t]+$/gu, "");
        const environmentInterpreter = /^\/usr\/bin\/env[ \t]+(bash|sh)$/u.exec(interpreter)?.[1];
        if (environmentInterpreter) {
          if (this.commands.get(environmentInterpreter)) throw new CommandFailure(`${target}: unsupported interpreter override: ${environmentInterpreter}`, 126);
          interpreterProfile = environmentInterpreter === "sh" ? "sh" : "bash";
        } else {
          const bash = /^(\/bin\/bash|\/usr\/bin\/bash)(?:[ \t]+([-+]e+))?$/u.exec(interpreter);
          if (!bash) throw new CommandFailure(`${target}: unsupported interpreter: ${interpreter}`, 126);
          if (direct && bash[2]) errexit = bash[2].startsWith("-");
        }
      }
    } catch (error) {
      this.signal.throwIfAborted();
      if (error instanceof ShellLimitError || error instanceof CommandFailure) throw error;
      if (errorCode(error) === "EFBIG") this.budget.fail("maxSourceBytes");
      throw new CommandFailure(filesystemDiagnostic(error, target) ?? `${target}: ${message(error)}`, errorCode(error) === "ENOENT" ? 127 : 126);
    }
    const units: Script[] = [];
    try {
      let position = 0;
      do {
        this.signal.throwIfAborted();
        const unit = parseShellUnit(source, position, byteLocale(context.env));
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
    if (direct && !source.startsWith("#!")) child.profile = state.profile ?? "bash";
    if (direct && interpreterProfile) child.profile = interpreterProfile;
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
    let position = 0;
    let status = 0;
    let executed = false;
    try {
      do {
        this.signal.throwIfAborted();
        const unit = parseShellUnit(source, position, byteLocale(state.variables));
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
    state.depth++;
    try {
      return await this.runCurrentText(source, state, { ...io, diagnosticOffset: (io.diagnosticLine ?? 1) - 1 }, special, `${io.scriptName ?? "shell"}: eval`);
    } finally { state.depth--; }
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
    if (args.length) state.positional = args;
    state.sourceDepth = (state.sourceDepth ?? 0) + 1;
    state.depth++;
    try {
      return await this.runCurrentText(source, state, { ...io, scriptName: target, diagnosticOffset: 0, diagnosticLine: 1 }, special);
    } catch (error) {
      if (error instanceof Flow && error.kind === "return") return error.status;
      throw error;
    } finally {
      state.depth--;
      state.sourceDepth--;
      if (args.length && (state.functionDepth > 0 || (state.positionalSetVersion ?? 0) === version)) {
        state.positional = positional;
        state.positionalSetVersion = version;
      }
    }
  }

  async invoke(name: string, args: readonly string[], options: ShellInvokeOptions = {}, context: ShellCommandContext, state: State, parent: InvocationScope): Promise<{ exitCode: number }> {
    const scope = parent.child();
    const runtime = new Runtime(this.fs, this.commands, this.middleware, this.budget, AbortSignal.any([this.signal, scope.signal]), this.fileWrites, this.outputFiles, this.commandSignal);
    try { return await runtime.invokeScoped(name, args, options, context, state, scope); }
    finally { await scope.close(); }
  }

  private async invokeScoped(name: string, args: readonly string[], options: ShellInvokeOptions, context: ShellCommandContext, state: State, scope: InvocationScope): Promise<{ exitCode: number }> {
    this.signal.throwIfAborted();
    if (typeof name !== "string" || name.includes("\0") || !Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) throw new TypeError("invoke requires a command and literal string arguments without NUL");
    if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
    const child = cloneState(state);
    child.cwd = resolvePath(context.cwd, options.cwd ?? ".");
    for (const key of child.exported) delete child.variables[key];
    const env = options.replaceEnv ? { ...options.env } : { ...context.env, ...options.env, PWD: child.cwd };
    for (const [key, value] of Object.entries(env)) {
      if (key.includes("\0") || key.includes("=") || typeof value !== "string" || value.includes("\0")) throw new TypeError("Invalid invoke environment entry");
      child.variables[key] = value;
    }
    child.exported = new Set(Object.keys(env));
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
      words: [name, ...args].map((value) => ({ offset: 0, parts: [{ kind: "text", value, quoted: true }] })),
    };
    try { return { exitCode: await this.runCommandIsolated(command, child, io) }; }
    finally { await input?.close(); }
  }

  async builtin(context: CommandContext & IO, state: State, assignments: Map<string, { value: string | undefined; exported: boolean }>, diagnose?: (error: unknown, diagnostic: string) => void, suppressSpecial = false): Promise<number | undefined> {
    const { command, args, stdout, stderr } = context;
    if (command === ":" || command === "true") return 0;
    if (command === "false") return 1;
    if (command === "pwd") {
      if (args.some((arg) => arg !== "-L" && arg !== "-P")) { await writeText(stderr, "pwd: invalid option\n"); return 2; }
      const path = args.at(-1) === "-P" ? await this.fs.realpath(state.cwd, { signal: this.signal }) : state.cwd;
      await writeText(stdout, `${path}\n`);
      return 0;
    }
    if (command === "cd") {
      if (args.length > 1) { await writeText(stderr, "cd: too many arguments\n"); return 1; }
      const target = args[0] === "-" ? state.variables.OLDPWD : (args[0] ?? state.variables.HOME);
      if (target === undefined) { await writeText(stderr, `cd: ${args[0] === "-" ? "OLDPWD" : "HOME"} not set\n`); return 1; }
      const path = resolvePath(state.cwd, target || ".");
      try {
        if ((await this.fs.stat(path, { signal: this.signal })).type !== "directory") throw new Error(`cd: ${target}: Not a directory`);
      } catch (error) {
        const diagnostic = filesystemDiagnostic(error, `cd: ${target}`);
        if (diagnostic) diagnose?.(error, diagnostic);
        throw error;
      }
      this.writeVariable(state, "OLDPWD", state.cwd);
      state.cwd = path;
      this.writeVariable(state, "PWD", path);
      state.exported.add("PWD");
      state.exported.add("OLDPWD");
      if (args[0] === "-") await writeText(stdout, `${path}\n`);
      return 0;
    }
    if (command === "set") {
      let index = 0;
      let positionals = false;
      while (index < args.length) {
        const option = args[index]!;
        if (option === "--") { index++; positionals = true; break; }
        if (option === "-") { index++; positionals = index < args.length; break; }
        if (/^[-+]e+$/u.test(option)) { state.errexit = option.startsWith("-"); index++; continue; }
        if ((option === "-o" || option === "+o") && (args[index + 1] === "pipefail" || args[index + 1] === "errexit")) {
          if (args[index + 1] === "pipefail") state.pipefail = option === "-o";
          else state.errexit = option === "-o";
          index += 2;
          continue;
        }
        if (/^[+-]/u.test(option)) {
          await writeText(stderr, "set: unsupported shell option; supported forms are -e, +e, -- arguments and -o/+o pipefail or errexit\n");
          if (state.profile === "sh" && suppressSpecial) return 2;
          throw new Flow("exit", 2);
        }
        positionals = true;
        break;
      }
      if (positionals) { state.positional = args.slice(index); state.positionalSetVersion = (state.positionalSetVersion ?? 0) + 1; }
      if (args.length) return 0;
      await writeText(stderr, "set: supported forms are -e, +e, -- arguments and -o/+o pipefail or errexit\n");
      return 2;
    }
    if (command === "shift") {
      const count = args[0] === undefined ? 1 : Number(args[0]);
      if (args.length > 1 || !Number.isSafeInteger(count) || count < 0 || count > state.positional.length) return 1;
      state.positional = state.positional.slice(count);
      return 0;
    }
    if (command === "export" || command === "local" || command === "readonly") {
      const declarationArgs = [...args];
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
        const prefix = state.profile === "sh" ? command : command === "readonly" ? "declare -r" : "declare -x";
        for (const name of [...names].sort()) await writeText(stdout, `${prefix} ${name}=${JSON.stringify(state.variables[name] ?? "")}\n`);
      }
      for (const arg of declarationArgs) {
        const match = /^([a-zA-Z_][a-zA-Z_0-9]*)(?:=(.*))?$/su.exec(arg);
        if (!match) { await this.diagnostic(context, `${command}: \`${arg}': not a valid identifier`); status = 1; continue; }
        const name = match[1]!;
        if (state.readonlyVariables?.has(name) && (match[2] !== undefined || command === "local")) {
          await this.diagnostic(context, `${name}: readonly variable`); status = 1; continue;
        }
        if (command === "local" && !locals!.has(name)) {
          locals!.set(name, assignments.get(name) ?? { value: state.variables[name], exported: state.exported.has(name) });
          if (!assignments.has(name) && match[2] === undefined) delete state.variables[name];
        }
        if (match[2] !== undefined) state.variables[name] = match[2];
        if (command === "export") state.exported.add(name);
        if (command === "readonly") { state.readonlyVariables ??= new Set(); state.readonlyVariables.add(name); }
        assignments.delete(name);
      }
      return status;
    }
    if (command === "unset") {
      let status = 0;
      for (const name of args) {
        if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name)) { await writeText(stderr, `unset: ${name}: not a valid identifier\n`); status = 1; continue; }
        if (state.readonlyVariables?.has(name)) { await this.diagnostic(context, `unset: ${name}: cannot unset: readonly variable`); status = 1; continue; }
        if (name === "PATH") state.pathUnset = true;
        delete state.variables[name];
        state.exported.delete(name);
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
        state.variables.REPLY = line.value;
      }
      else {
        const separators = exact ? "" : state.variables.IFS ?? " \t\n";
        const characters = Array.from(line.value);
        const separator = (index: number): boolean => index < characters.length && !line.escaped.has(index) && separators.includes(characters[index]!);
        const whitespace = (index: number): boolean => separator(index) && /[ \t\n]/u.test(characters[index]!);
        let end = characters.length;
        while (end > 0 && whitespace(end - 1)) end--;
        let position = 0;
        while (position < end && whitespace(position)) position++;
        const fields: { start: number; end: number }[] = [];
        while (position < end) {
          const start = position;
          while (position < end && !separator(position)) position++;
          fields.push({ start, end: position });
          while (position < end && whitespace(position)) position++;
          if (position < end && separator(position)) position++;
          while (position < end && whitespace(position)) position++;
        }
        for (let index = 0; index < names.length; index++) {
          if (state.readonlyVariables?.has(names[index]!)) {
            await this.diagnostic(context, `${names[index]}: readonly variable`);
            return index === names.length - 1 ? 1 : 2;
          }
          const field = fields[index];
          state.variables[names[index]!] = field ? characters.slice(field.start, index === names.length - 1 && fields.length > names.length ? end : field.end).join("") : "";
        }
      }
      return line.terminated ? 0 : 1;
    }
    if (command === "exit" || command === "return") {
      if (command === "return" && state.functionDepth === 0 && !state.sourceDepth) { await writeText(stderr, "return: not in a function\n"); return 1; }
      if (args.length > 1) { await writeText(stderr, `${command}: too many arguments\n`); return 1; }
      if (args[0] !== undefined && !/^[+-]?\d+$/u.test(args[0])) {
        await writeText(stderr, `${command}: ${args[0]}: numeric argument required\n`);
        throw new Flow(command, 2);
      }
      const status = args[0] === undefined ? state.status : Number((BigInt(args[0]) % 256n + 256n) % 256n);
      throw new Flow(command, status);
    }
    if (command === "break" || command === "continue") {
      const levels = args[0] === undefined ? 1 : Number(args[0]);
      if (args.length > 1 || !Number.isSafeInteger(levels) || levels < 1) { await writeText(stderr, `${command}: invalid loop count\n`); return 1; }
      if (!state.loopDepth) { await writeText(stderr, `${command}: only meaningful in a loop\n`); return 0; }
      throw new Flow(command, 0, Math.min(levels, state.loopDepth));
    }
    return undefined;
  }

  async words(words: readonly Word[], state: State, io: IO, declaration = false): Promise<string[]> {
    const fields: string[] = [];
    for (const word of words) {
      fields.push(...await this.word(word, state, io, !(declaration && this.assignment(word))));
      if (fields.length > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
    }
    return fields;
  }

  async part(part: Exclude<WordPart, { kind: "text" }>, state: State, io: IO, hereString = false): Promise<string> {
    if (part.kind === "failed-substitution") {
      if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
      await writeText(io.stderr, part.diagnostic);
      state.status = state.substitutionStatus = 2;
      return "";
    }
    if (part.kind === "arithmetic") {
      try { return String(evaluateArithmetic(part.expression, this.arithmeticVariables(state))); }
      catch (error) { throw new ExpansionFailure(message(error), io.diagnosticLine ?? part.line); }
    }
    if (part.kind === "substitution") {
      if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
      const capture = new Capture();
      const child = cloneState(state);
      child.isolated = true;
      if (state.profile !== "sh") child.errexit = false;
      for (const [name, value] of state.redirectAssignments ?? []) {
        child.variables[name] = value;
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
      state.substitutionStatus = fileShortcut ? await this.runCommandIsolated(command, child, captureIO, true) : await this.run(part.script, child, captureIO);
      state.status = state.substitutionStatus;
      const bytes = capture.bytes();
      if (bytes.includes(0)) await writeText(io.stderr, `${io.scriptName ?? "shell"}: line ${warningLine}: warning: command substitution: ignored null byte in input\n`);
      return new TextDecoder().decode(bytes.includes(0) ? bytes.filter((byte) => byte !== 0) : bytes).replace(/\n+$/u, "");
    }
    let value = part.name === "?" ? String(state.status)
      : part.name === "-" ? state.errexit ? "e" : ""
      : part.name === "#" ? String(state.positional.length)
      : part.name === "@" || part.name === "*" ? state.positional.join(hereString && (part.name === "@" || !part.quoted) ? " " : Array.from(state.variables.IFS ?? " ")[0] ?? "")
      : /^0+$/u.test(part.name) ? state.arg0 ?? "virtual-bash"
      : /^\d+$/u.test(part.name) ? state.positional[Number(part.name) - 1]
      : state.variables[part.name];
    if (part.substring) return this.substring(part, value, state, io);
    if (part.operator) {
      if (["#", "##", "%", "%%"].includes(part.operator) || part.operator.startsWith("/")) return this.parameterPattern(part, value ?? "", state, io, hereString);
      const missing = value === undefined || (part.operator.startsWith(":") && value === "");
      const operator = part.operator.at(-1)!;
      if ((operator === "+" && !missing) || (operator !== "+" && missing)) {
        const alternate = (await this.word(part.alternate!, state, io, false, false, hereString)).join("");
        if (operator === "?") throw new ParameterExpansionFailure(`${part.name}: ${alternate || (part.operator.startsWith(":") ? "parameter null or not set" : "parameter not set")}`, io.diagnosticLine ?? part.line);
        if (operator === "=") {
          if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(part.name)) throw new Error("Cannot assign special parameter");
          this.writeVariable(state, part.name, alternate);
        }
        value = alternate;
      } else if (operator === "+") value = "";
    }
    return part.length ? String(Array.from(value ?? "").length) : value ?? "";
  }

  async substring(part: Extract<WordPart, { kind: "variable" }>, value: string | undefined, state: State, io: IO): Promise<string> {
    const expression = part.substring!;
    const line = io.diagnosticLine ?? part.line;
    if (!expression.offset.parts.length && !expression.length) throw new ExpansionFailure(`${expression.source}: bad substitution`, line);
    if (value === undefined) return "";
    const limit = this.budget.limits.maxExpansionBytes;
    if (Buffer.byteLength(value) > limit) this.budget.fail("maxExpansionBytes");
    const variables = new Proxy(this.arithmeticVariables(state), { get: (target, key) => {
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
        source += text;
      }
      this.signal.throwIfAborted();
      try { return { value: evaluateArithmetic(prepareArithmetic(source), variables), source }; }
      catch (error) {
        this.signal.throwIfAborted();
        if (error instanceof ShellLimitError) throw error;
        throw new ExpansionFailure(`${part.name}: ${message(error)}`, line);
      }
    };
    const offsetExpression = await arithmetic(expression.offset);
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
    if (characters) return characters.slice(Number(offset), Number(end)).join("");
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes!.subarray(Number(offset), Number(end))); }
    catch { throw new ExpansionFailure("substring expansion splits a UTF-8 character in a byte locale", line); }
  }

  async parameterPattern(part: Extract<WordPart, { kind: "variable" }>, text: string, state: State, io: IO, hereString: boolean): Promise<string> {
    const limit = this.budget.limits.maxExpansionBytes;
    if (Buffer.byteLength(text) > limit) this.budget.fail("maxExpansionBytes");
    const pattern = (await this.word(part.alternate!, state, io, false, true, hereString)).join("");
    const characters = Array.from(text);
    const work = { remaining: Math.min(Number.MAX_SAFE_INTEGER, limit * 4 + 1024), signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") };
    const matches = await compilePattern(pattern, work);
    let attempts = 0;
    const match = async (start: number, end: number): Promise<boolean> => {
      work.remaining -= end - start + 1;
      if (work.remaining < 0) work.exhausted();
      if (++attempts % 256 === 0) await new Promise<void>(resolve => setImmediate(resolve));
      this.signal.throwIfAborted();
      return matches(characters.slice(start, end).join(""));
    };
    const operator = part.operator!;
    if (!operator.startsWith("/")) {
      const longest = operator.length === 2;
      for (let length = longest ? characters.length : 0; longest ? length >= 0 : length <= characters.length; length += longest ? -1 : 1) {
        const prefix = operator.startsWith("#");
        if (await match(prefix ? 0 : characters.length - length, prefix ? length : characters.length)) return (prefix ? characters.slice(length) : characters.slice(0, characters.length - length)).join("");
      }
      return text;
    }
    const replacements: { value: string; quoted: boolean }[] = [];
    let replacementBytes = 0;
    for (const [index, entry] of (part.replacement?.parts ?? []).entries()) {
      let value = entry.kind === "text" ? entry.value : await this.part(entry, state, io, hereString);
      if (index === 0 && !entry.quoted && /^~(?:\/|$)/u.test(value)) value = (state.variables.HOME ?? "~") + value.slice(1);
      replacementBytes += Buffer.byteLength(value);
      if (replacementBytes > limit) this.budget.fail("maxExpansionBytes");
      replacements.push({ value, quoted: entry.quoted });
    }
    if (!pattern && operator !== "/#" && operator !== "/%") return text;
    let result = "";
    let resultBytes = 0;
    const append = (value: string): void => {
      resultBytes += Buffer.byteLength(value);
      if (resultBytes > limit) this.budget.fail("maxExpansionBytes");
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
          append(characters.slice(position, start).join(""));
          const matched = characters.slice(start, end).join("");
          for (const replacement of replacements) {
            if (replacement.quoted) append(replacement.value);
            else {
              const pieces = replacement.value.split("&");
              for (const [index, piece] of pieces.entries()) { if (index) append(matched); append(piece); }
            }
          }
          position = end;
          found = true;
          if (operator !== "//" || end === characters.length) { append(characters.slice(end).join("")); return result; }
          if (end === start) { append(characters[position]!); position++; }
          break;
        }
        if (found) break;
      }
      if (!found) { append(characters.slice(position).join("")); break; }
    }
    return result;
  }

  async word(word: Word, state: State, io: IO, split = true, pattern = false, hereString = false): Promise<string[]> {
    const fields: { value: string; pattern: string; present: boolean }[] = [{ value: "", pattern: "", present: false }];
    let expansionBytes = 0;
    const append = (value: string, glob: boolean, present: boolean) => {
      const size = Buffer.byteLength(value);
      if (size > this.budget.limits.maxExpansionBytes - expansionBytes) this.budget.fail("maxExpansionBytes");
      expansionBytes += size;
      const field = fields.at(-1)!;
      field.value += value;
      field.pattern += glob ? value : value.replace(/[\\*?[\]\-^]/gu, "\\$&");
      field.present ||= present;
    };
    const parts = word.parts.map((part) => ({ part, splitText: false }));
    for (let index = 0; index < parts.length; index++) {
      const { part, splitText } = parts[index]!;
      if (part.kind === "variable" && ["-", "+", ":-", ":+"].includes(part.operator ?? "") && /^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(part.name)) {
        const value = state.variables[part.name];
        const missing = value === undefined || (part.operator!.startsWith(":") && value === "");
        if (part.operator!.endsWith("+") ? !missing : missing) {
          const alternate = part.alternate!.parts.map((entry) => ({ part: { ...entry, quoted: entry.quoted || part.quoted }, splitText: true }));
          if (!alternate.length && part.quoted) append("", false, true);
          parts.splice(index + 1, 0, ...alternate);
          continue;
        }
      }
      if (part.kind === "text" && !splitText) {
        let value = part.value;
        if (index === 0 && !part.quoted && /^~(?:\/|$)/u.test(value)) value = (state.variables.HOME ?? "~") + value.slice(1);
        append(value, !part.quoted, part.quoted || value.length > 0);
      } else if (part.kind === "variable" && part.name === "@" && part.quoted && !part.operator && split) {
        for (let position = 0; position < state.positional.length; position++) {
          if (position > 0) fields.push({ value: "", pattern: "", present: false });
          append(state.positional[position]!, false, true);
        }
        if (state.positional.length === 0 && word.parts.every((entry) => (entry.kind === "text" && entry.value === "") || entry === part)) fields[0]!.present = false;
      } else {
        const value = part.kind === "text" ? part.value : await this.part(part, state, io, hereString);
        if (part.quoted || !split || state.variables.IFS === "") append(value, !part.quoted, part.quoted || !split || value.length > 0);
        else {
          const separators = state.variables.IFS ?? " \t\n";
          let boundary = false;
          for (const character of value) {
            if (separators.includes(character)) {
              if (!/[ \t\n]/u.test(character)) {
                fields.at(-1)!.present = true;
                fields.push({ value: "", pattern: "", present: false });
              } else if (fields.at(-1)!.present) boundary = true;
            } else {
              if (boundary) fields.push({ value: "", pattern: "", present: false });
              boundary = false;
              append(character, true, true);
            }
          }
          if (boundary) fields.push({ value: "", pattern: "", present: false });
        }
      }
      if (fields.length > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
    }
    const result: string[] = [];
    let resultBytes = 0;
    for (const field of fields) {
      if (!field.present && split) continue;
      for (const value of split ? await this.glob(field.value, field.pattern, state) : [pattern ? field.pattern : field.value]) {
        const size = Buffer.byteLength(value);
        if (size > this.budget.limits.maxExpansionBytes - resultBytes) this.budget.fail("maxExpansionBytes");
        resultBytes += size;
        result.push(value);
      }
      if (result.length > this.budget.limits.maxExpansionFields) this.budget.fail("maxExpansionFields");
    }
    return result;
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
          try { entries = await this.fs.readdir(resolvePath(state.cwd, candidate || "."), { signal: this.signal }); }
          catch (error) { if (["ENOENT", "ENOTDIR", "EACCES"].includes(errorCode(error) ?? "")) continue; throw error; }
          for (const entry of entries) {
            if ((!entry.name.startsWith(".") || segment.startsWith(".")) && await matches(entry.name)) {
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
        const stat = await this.fs.stat(resolvePath(state.cwd, candidate), { signal: this.signal });
        if (!value.endsWith("/") || stat.type === "directory") found.push(candidate + (value.endsWith("/") ? "/" : ""));
      } catch (error) { if (!["ENOENT", "ENOTDIR", "EACCES"].includes(errorCode(error) ?? "")) throw error; }
    }
    return found.length ? found.sort() : [value];
  }
}
