import {
  composeMiddleware, createBytePipe, resolvePath, toByteSource, validateExitCode, writeText,
} from "../contracts/index.js";
import type {
  ByteSink, ByteSource, CommandContext, CommandRegistry, FileSystem, Middleware,
} from "../contracts/index.js";
import type { Command, Pipeline, Redirect, Script, Word, WordPart } from "./parser.js";
import { ShellLimitError } from "./types.js";
import type { ShellCommandContext, ShellInvokeOptions, ShellLimits } from "./types.js";
import { ShellInput } from "./input.js";
import { evaluateArithmetic } from "./arithmetic.js";
import { matchesPattern } from "./pattern.js";

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
  "exit", "return", "break", "continue", "echo", "printf", "test", "[",
]);

export function resolveLimits(...limits: (ShellLimits | undefined)[]): Required<ShellLimits> {
  const result = Object.assign({}, defaultLimits, ...limits) as Required<ShellLimits>;
  for (const [key, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value < (key === "pipeHighWaterMark" ? 1 : 0)) {
      throw new RangeError(`${key} must be a ${key === "pipeHighWaterMark" ? "positive" : "nonnegative"} safe integer`);
    }
  }
  return result;
}

export class Budget {
  commands = 0;
  iterations = 0;
  bytes = 0;
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

  sink(sink: ByteSink, signal = this.signal): ByteSink {
    return {
      write: async (chunk) => {
        signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array)) throw new TypeError("Shell output must be Uint8Array");
        if (chunk.byteLength > this.limits.maxOutputBytes - this.bytes) this.fail("maxOutputBytes");
        this.bytes += chunk.byteLength;
        await interruptible(sink.write(chunk), signal);
      },
    };
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
  status: number;
  substitutionStatus: number;
  depth: number;
  loopDepth: number;
  functionDepth: number;
  locals: Map<string, { value: string | undefined; exported: boolean }>[];
  pipefail: boolean;
  redirectAssignments?: ReadonlyMap<string, string>;
}

interface IO {
  readonly stdin: ByteSource;
  readonly stdout: ByteSink;
  readonly stderr: ByteSink;
  readonly descriptors?: ReadonlyMap<number, Descriptor>;
}

interface Descriptor {
  readonly input?: ByteSource;
  readonly output?: ByteSink;
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
  constructor(readonly original: unknown, readonly io: IO) { super(message(original)); }
}

class ExpansionFailure extends Error {}

class ParameterExpansionFailure extends ExpansionFailure {}

class PipelineClosed extends Error {
  readonly code = "EPIPE";
  constructor() { super("Pipeline consumer exited"); }
}

function signalSink(sink: ByteSink, signal: AbortSignal): ByteSink {
  return { async write(chunk) { signal.throwIfAborted(); await interruptible(sink.write(chunk), signal); } };
}

function cloneState(state: State): State {
  return {
    ...state,
    variables: Object.assign(Object.create(null) as Record<string, string>, state.variables),
    exported: new Set(state.exported), functions: new Map(state.functions), positional: [...state.positional],
    locals: state.locals.map((scope) => new Map(scope)),
  };
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

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
  ) {}

  async run(script: Script, state: State, io: IO): Promise<number> {
    try { return await this.script(script, state, io); }
    catch (error) {
      if (error instanceof Flow && error.kind === "exit") return error.status;
      throw error;
    }
  }

  async script(script: Script, state: State, io: IO): Promise<number> {
    for (const list of script.lists) {
      for (let index = 0; index < list.pipelines.length; index++) {
        const operator = list.operators[index - 1];
        if ((operator === "&&" && state.status !== 0) || (operator === "||" && state.status === 0)) continue;
        state.status = await this.pipeline(list.pipelines[index]!, state, io);
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
      const tasks = pipeline.commands.map(async (command, index) => {
        const incoming = pipes[index - 1];
        const outgoing = pipes[index];
        const signal = AbortSignal.any([this.signal, controllers[index]!.signal]);
        const runtime = new Runtime(this.fs, this.commands, this.middleware, this.budget, signal, this.fileWrites, this.outputFiles);
        const input = new ShellInput(incoming?.readable ?? io.stdin, this.budget, signal);
        const pipeOutput: ByteSink | undefined = outgoing && { write: async (chunk) => {
          try { await outgoing.writable.write(chunk); }
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
          return await interruptible(runtime.runCommandIsolated(command, cloneState(state), {
            ...io,
            stdin: input,
            stdout: pipeOutput ? this.budget.sink(pipeOutput, signal) : signalSink(io.stdout, signal),
            stderr: signalSink(io.stderr, signal),
          }), signal);
        } catch (error) {
          if (error instanceof PipelineClosed) return 141;
          throw error;
        } finally {
          if (incoming) await incoming.abort();
          await input.close().catch((error: unknown) => { if (!(error instanceof PipelineClosed)) throw error; });
          if (outgoing) await outgoing.close().catch(() => undefined);
        }
      });
      try {
        const statuses = await interruptible(Promise.all(tasks), this.signal);
        status = state.pipefail ? statuses.findLast((status) => status !== 0) ?? 0 : statuses.at(-1)!;
      } finally {
        for (const controller of controllers) controller.abort(new PipelineClosed());
        await Promise.all(pipes.map((pipe) => pipe.abort()));
      }
    }
    return pipeline.negate ? Number(status === 0) : status;
  }

  async runCommandIsolated(command: Command, state: State, io: IO): Promise<number> {
    try { return await this.command(command, state, io); }
    catch (error) {
      if (error instanceof Flow && (error.kind === "exit" || error.kind === "return")) return error.status;
      throw error;
    }
  }

  async command(command: Command, state: State, originalIO: IO): Promise<number> {
    this.budget.tick();
    if (this.budget.commands % 128 === 0) await interruptible(new Promise<void>((resolve) => setImmediate(resolve)), this.signal);
    this.signal.throwIfAborted();
    const inputs = new Set<ShellInput>();
    const outputs = new Set<() => void>();
    let io = originalIO;
    try {
      if (command.kind === "function") {
        state.functions.set(command.name, command.body);
        return 0;
      }
      if (command.kind === "simple") return await this.simple(command, state, originalIO, inputs, outputs);
      io = await this.redirect(command.redirects, state, io, inputs, outputs, command.kind === "subshell");
      if (command.kind === "arithmetic") return Number(evaluateArithmetic(command.expression, state.variables) === 0n);
      if (command.kind === "subshell") {
        const child = cloneState(state);
        child.loopDepth = 0;
        return await this.run(command.body, child, io);
      }
      if (command.kind === "group") return await this.script(command.body, state, io);
      if (command.kind === "if") {
        for (const branch of command.branches) {
          if (await this.script(branch.condition, state, io) === 0) return await this.script(branch.body, state, io);
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
            state.variables[command.name] = value;
            const result = await this.loopBody(command.body, state, io);
            status = result.status;
            if (result.stop) break;
          }
        } else {
          while (true) {
            this.budget.loop();
            const condition = await this.script(command.condition, state, io);
            if ((condition === 0) !== (command.kind === "while")) break;
            const result = await this.loopBody(command.body, state, io);
            status = result.status;
            if (result.stop) break;
          }
        }
      } finally { state.loopDepth--; }
      return status;
    } catch (error) {
      if (error instanceof ExecutionFailure) { io = error.io; error = error.original; }
      this.signal.throwIfAborted();
      if (error instanceof Flow || error instanceof ShellLimitError) throw error;
      if (errorCode(error) === "EPIPE") return 141;
      try { await writeText(io.stderr, `shell: ${message(error)}\n`); }
      catch { this.signal.throwIfAborted(); }
      if (error instanceof ExpansionFailure) throw new Flow("exit", 1);
      return 1;
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

  async redirect(redirects: readonly Redirect[], state: State, io: IO, inputs: Set<ShellInput>, outputs: Set<() => void>, isolatedInlineInput = false): Promise<IO> {
    const descriptors = new Map<number, Descriptor>([
      ...io.descriptors ?? [],
      [0, { input: io.stdin }], [1, { output: io.stdout }], [2, { output: io.stderr }],
    ]);
    if (io.stdin === closedSource) descriptors.delete(0);
    if (io.stdout === closedSink) descriptors.delete(1);
    if (io.stderr === closedSink) descriptors.delete(2);
    const currentIO = (): IO => ({
      stdin: descriptors.get(0)?.input ?? closedSource,
      stdout: descriptors.get(1)?.output ?? closedSink,
      stderr: descriptors.get(2)?.output ?? closedSink,
      descriptors,
    });
    try { for (const redirect of redirects) {
      if (redirect.document || redirect.operator === "<<<") {
        const hereString = redirect.operator === "<<<";
        let value: string;
        try { value = (await this.word(redirect.document?.body ?? redirect.target, state, currentIO(), false, false, hereString)).join(""); }
        catch (error) {
          if (error instanceof ParameterExpansionFailure && !isolatedInlineInput) throw error;
          if (error instanceof ExpansionFailure) throw new Error(error.message);
          throw error;
        }
        if (hereString) {
          if (Buffer.byteLength(value) >= this.budget.limits.maxExpansionBytes) this.budget.fail("maxExpansionBytes");
          value += "\n";
        }
        const input = new ShellInput(toByteSource(value), this.budget, this.signal);
        inputs.add(input);
        descriptors.set(redirect.descriptor, { input });
        continue;
      }
      const targets = await this.word(redirect.target, state, currentIO());
      if (targets.length !== 1) throw new Error("Ambiguous redirect");
      const target = targets[0]!;
      if (redirect.operator.endsWith("&")) {
        if (target === "-") descriptors.delete(redirect.descriptor);
        else {
          if (!/^\d+$/u.test(target)) throw new Error(`${target}: Bad file descriptor`);
          const descriptor = descriptors.get(Number(target));
          if (!descriptor || (redirect.operator === "<&" ? !descriptor.input : !descriptor.output)) throw new Error(`${target}: Bad file descriptor`);
          descriptors.set(redirect.descriptor, descriptor);
        }
      } else {
        const path = resolvePath(state.cwd, target);
        const options = { signal: this.signal };
        if (redirect.operator === "<") {
          await interruptible(this.fs.access(path, 4, options), this.signal);
          const stat = await interruptible(this.fs.stat(path, options), this.signal);
          if (stat.type === "directory") throw new Error(`${target}: Is a directory`);
          const source = this.fs.readStream
            ? this.fs.readStream(path, options)
            : toByteSource(await interruptible(this.fs.readFile(path, { ...options, maxBytes: this.budget.limits.maxOutputBytes }), this.signal));
          const input = new ShellInput(source, this.budget, this.signal);
          inputs.add(input);
          descriptors.set(redirect.descriptor, { input });
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
    } } catch (error) { throw new ExecutionFailure(error, currentIO()); }
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

  async simple(command: Extract<Command, { kind: "simple" }>, state: State, originalIO: IO, inputs: Set<ShellInput>, outputs: Set<() => void>): Promise<number> {
    state.substitutionStatus = 0;
    const assignments: { name: string; value: Word }[] = [];
    let wordIndex = 0;
    for (; wordIndex < command.words.length; wordIndex++) {
      const assignment = this.assignment(command.words[wordIndex]!);
      if (!assignment) break;
      assignments.push(assignment);
    }
    const commandWords = command.words.slice(wordIndex);
    const words = await this.words(commandWords, state, originalIO, ["export", "local"].includes(commandWords[0]?.plain ?? ""));
    const inlineInput = command.redirects.some((redirect) => redirect.document || redirect.operator === "<<<");
    const functionCommand = words.length > 0 && state.functions.has(words[0]!);
    const isolatedInlineInput = inlineInput && words.length > 0 && !shellBuiltinNames.has(words[0]!) && !functionCommand;
    if (isolatedInlineInput) state = cloneState(state);
    let io = originalIO;
    const previous = new Map<string, { value: string | undefined; exported: boolean }>();
    const assign = async () => {
      for (const assignment of assignments) {
        if (!previous.has(assignment.name)) previous.set(assignment.name, { value: state.variables[assignment.name], exported: state.exported.has(assignment.name) });
        state.variables[assignment.name] = (await this.word(assignment.value, state, io, false)).join("");
        if (words.length) state.exported.add(assignment.name);
      }
    };
    try {
      if (inlineInput) await assign();
      if (inlineInput && functionCommand && previous.size) {
        const variables = Object.assign(Object.create(null) as Record<string, string>, state.variables);
        const redirectAssignments = new Map<string, string>();
        for (const [name, saved] of previous) {
          redirectAssignments.set(name, state.variables[name]!);
          if (saved.value === undefined) delete variables[name];
          else variables[name] = saved.value;
        }
        const redirectState = { ...state, variables, redirectAssignments };
        try { io = await this.redirect(command.redirects, redirectState, io, inputs, outputs); }
        finally {
          state.substitutionStatus = redirectState.substitutionStatus;
          for (const [name, value] of Object.entries(variables)) {
            if (!previous.has(name)) state.variables[name] = value;
          }
          for (const [name, saved] of previous) saved.value = variables[name];
        }
      } else io = await this.redirect(command.redirects, state, io, inputs, outputs, isolatedInlineInput);
      if (!inlineInput) await assign();
      return words.length ? await this.dispatch(words[0]!, words.slice(1), state, io, previous) : state.substitutionStatus;
    } catch (error) {
      if (error instanceof ExecutionFailure || error instanceof Flow) throw error;
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

  async dispatch(name: string, args: readonly string[], state: State, io: IO, assignments: Map<string, { value: string | undefined; exported: boolean }>): Promise<number> {
    const env = Object.create(null) as Record<string, string>;
    for (const key of state.exported) {
      const value = state.variables[key];
      if (value !== undefined) env[key] = value;
    }
    const initialEnv = { ...env };
    const context: ShellCommandContext = {
      command: name, args, ...io, env, cwd: state.cwd, fs: this.fs, signal: this.signal,
      invoke: (name, args, options) => this.invoke(name, args, options, context, state),
    };
    const execute = composeMiddleware(this.middleware, async (context) => {
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
        const builtin = await this.builtin(context, state, assignments);
        if (builtin !== undefined) return { exitCode: builtin };
        const body = state.functions.get(context.command);
        if (body) {
          if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
          const positional = state.positional;
          state.positional = [...context.args];
          state.functionDepth++;
          state.depth++;
          const locals = new Map<string, { value: string | undefined; exported: boolean }>();
          state.locals.push(locals);
          try { return { exitCode: await this.command(body, state, context) }; }
          catch (error) {
            if (error instanceof Flow && error.kind === "return") return { exitCode: error.status };
            throw error;
          } finally {
            state.positional = positional;
            state.functionDepth--;
            state.depth--;
            state.locals.pop();
            for (const [name, previous] of locals) {
              if (previous.value === undefined) delete state.variables[name];
              else state.variables[name] = previous.value;
              if (previous.exported) state.exported.add(name);
              else state.exported.delete(name);
            }
          }
        }
        const definition = this.commands.get(context.command);
        if (!definition) {
          await writeText(context.stderr, `${context.command}: command not found\n`);
          return { exitCode: 127 };
        }
        return await definition.execute(context);
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
    return validateExitCode((await interruptible(execute(context), this.signal)).exitCode);
  }

  async invoke(name: string, args: readonly string[], options: ShellInvokeOptions = {}, context: ShellCommandContext, state: State): Promise<{ exitCode: number }> {
    this.signal.throwIfAborted();
    if (typeof name !== "string" || name.includes("\0") || !Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) throw new TypeError("invoke requires a command and literal string arguments without NUL");
    if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
    const child = cloneState(state);
    child.cwd = resolvePath(context.cwd, options.cwd ?? ".");
    for (const key of child.exported) delete child.variables[key];
    const env = { ...context.env, ...options.env, PWD: child.cwd };
    for (const [key, value] of Object.entries(env)) {
      if (key.includes("\0") || key.includes("=") || typeof value !== "string" || value.includes("\0")) throw new TypeError("Invalid invoke environment entry");
      child.variables[key] = value;
    }
    child.exported = new Set(Object.keys(env));
    child.depth++;
    child.loopDepth = 0;
    child.functionDepth = 0;
    child.locals = [];
    const input = options.stdin ? new ShellInput(options.stdin, this.budget, this.signal) : undefined;
    const io = {
      ...context,
      stdin: input ?? context.stdin,
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

  async builtin(context: CommandContext, state: State, assignments: Map<string, { value: string | undefined; exported: boolean }>): Promise<number | undefined> {
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
      if ((await this.fs.stat(path, { signal: this.signal })).type !== "directory") throw new Error(`cd: ${target}: Not a directory`);
      state.variables.OLDPWD = state.cwd;
      state.cwd = path;
      state.variables.PWD = path;
      state.exported.add("PWD");
      state.exported.add("OLDPWD");
      if (args[0] === "-") await writeText(stdout, `${path}\n`);
      return 0;
    }
    if (command === "set") {
      if (args[0] === "--") { state.positional = args.slice(1); return 0; }
      if (args.length === 2 && (args[0] === "-o" || args[0] === "+o") && args[1] === "pipefail") {
        state.pipefail = args[0] === "-o";
        return 0;
      }
      if (args.some((arg) => /^[+-]/u.test(arg))) {
        await writeText(stderr, "set: unsupported shell option; supported forms are -- arguments, -o pipefail, +o pipefail\n");
        throw new Flow("exit", 2);
      }
      await writeText(stderr, "set: supported forms are -- arguments, -o pipefail, +o pipefail\n");
      return 2;
    }
    if (command === "shift") {
      const count = args[0] === undefined ? 1 : Number(args[0]);
      if (args.length > 1 || !Number.isSafeInteger(count) || count < 0 || count > state.positional.length) return 1;
      state.positional = state.positional.slice(count);
      return 0;
    }
    if (command === "export" || command === "local") {
      const locals = state.locals.at(-1);
      if (command === "local" && !locals) { await writeText(stderr, "local: not in a function\n"); return 1; }
      let status = 0;
      if (!args.length) {
        for (const name of [...state.exported].sort()) await writeText(stdout, `declare -x ${name}=${JSON.stringify(state.variables[name] ?? "")}\n`);
      }
      for (const arg of args) {
        const match = /^([a-zA-Z_][a-zA-Z_0-9]*)(?:=(.*))?$/su.exec(arg);
        if (!match) { await writeText(stderr, `${command}: ${arg}: not a valid identifier\n`); status = 1; continue; }
        const name = match[1]!;
        if (command === "local" && !locals!.has(name)) {
          locals!.set(name, assignments.get(name) ?? { value: state.variables[name], exported: state.exported.has(name) });
          if (!assignments.has(name) && match[2] === undefined) delete state.variables[name];
        }
        if (match[2] !== undefined) state.variables[name] = match[2];
        if (command === "export") state.exported.add(name);
        assignments.delete(name);
      }
      return status;
    }
    if (command === "unset") {
      let status = 0;
      for (const name of args) {
        if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name)) { await writeText(stderr, `unset: ${name}: not a valid identifier\n`); status = 1; continue; }
        delete state.variables[name];
        state.exported.delete(name);
      }
      return status;
    }
    if (command === "read") {
      const names = [...args];
      const raw = names[0] === "-r";
      if (raw) names.shift();
      if (names[0] === "--") names.shift();
      if (names.some((name) => !/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name))) {
        await writeText(stderr, "read: invalid variable name or unsupported option\n");
        return 2;
      }
      const input = context.stdin instanceof ShellInput ? context.stdin : new ShellInput(context.stdin, this.budget, this.signal);
      const line = await input.line(raw);
      if (!names.length) state.variables.REPLY = line.value;
      else {
        const separators = state.variables.IFS ?? " \t\n";
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
          const field = fields[index];
          state.variables[names[index]!] = field ? characters.slice(field.start, index === names.length - 1 && fields.length > names.length ? end : field.end).join("") : "";
        }
      }
      return line.terminated ? 0 : 1;
    }
    if (command === "exit" || command === "return") {
      if (command === "return" && state.functionDepth === 0) { await writeText(stderr, "return: not in a function\n"); return 1; }
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
    if (part.kind === "arithmetic") {
      try { return String(evaluateArithmetic(part.expression, state.variables)); }
      catch (error) { throw new ExpansionFailure(message(error)); }
    }
    if (part.kind === "substitution") {
      if (state.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
      const capture = new Capture();
      const child = cloneState(state);
      for (const [name, value] of state.redirectAssignments ?? []) {
        child.variables[name] = value;
        child.exported.add(name);
      }
      delete child.redirectAssignments;
      child.depth++;
      child.loopDepth = 0;
      state.substitutionStatus = await this.run(part.script, child, { ...io, stdout: this.budget.sink(capture, this.signal) });
      return new TextDecoder().decode(capture.bytes()).replace(/\0/gu, "").replace(/\n+$/u, "");
    }
    let value = part.name === "?" ? String(state.status)
      : part.name === "#" ? String(state.positional.length)
      : part.name === "@" || part.name === "*" ? state.positional.join(hereString && (part.name === "@" || !part.quoted) ? " " : Array.from(state.variables.IFS ?? " ")[0] ?? "")
      : part.name === "0" ? "virtual-bash"
      : /^\d+$/u.test(part.name) ? state.positional[Number(part.name) - 1]
      : state.variables[part.name];
    if (part.operator) {
      if (["#", "##", "%", "%%"].includes(part.operator)) {
        const pattern = (await this.word(part.alternate!, state, io, false, true, hereString)).join("");
        const expression = globExpression(pattern);
        const text = value ?? "";
        const lengths = Array.from({ length: text.length + 1 }, (_, index) => index);
        if (part.operator.length === 2) lengths.reverse();
        for (const length of lengths) {
          const prefix = part.operator.startsWith("#");
          if (expression.test(prefix ? text.slice(0, length) : text.slice(text.length - length))) {
            return prefix ? text.slice(length) : text.slice(0, text.length - length);
          }
        }
        return text;
      }
      const missing = value === undefined || (part.operator.startsWith(":") && value === "");
      const operator = part.operator.at(-1)!;
      if ((operator === "+" && !missing) || (operator !== "+" && missing)) {
        const alternate = (await this.word(part.alternate!, state, io, false, false, hereString)).join("");
        if (operator === "?") throw new ParameterExpansionFailure(`${part.name}: ${alternate || "parameter null or not set"}`);
        if (operator === "=") {
          if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(part.name)) throw new Error("Cannot assign special parameter");
          state.variables[part.name] = alternate;
        }
        value = alternate;
      } else if (operator === "+") value = "";
    }
    return part.length ? String(Array.from(value ?? "").length) : value ?? "";
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
      field.pattern += glob ? value : value.replace(pattern ? /[\\*?[\]\-^]/gu : /[\\*?[\]]/gu, "\\$&");
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
        const expression = globExpression(segment);
        for (const candidate of candidates) {
          let entries;
          try { entries = await this.fs.readdir(resolvePath(state.cwd, candidate || "."), { signal: this.signal }); }
          catch (error) { if (["ENOENT", "ENOTDIR", "EACCES"].includes(errorCode(error) ?? "")) continue; throw error; }
          for (const entry of entries) {
            if ((!entry.name.startsWith(".") || segment.startsWith(".")) && expression.test(entry.name)) {
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

function globExpression(pattern: string): RegExp {
  let expression = "^";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!;
    if (character === "\\" && index + 1 < pattern.length) expression += pattern[++index]!.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    else if (character === "*") expression += ".*";
    else if (character === "?") expression += ".";
    else if (character === "[") {
      const end = pattern.indexOf("]", index + 1);
      if (end > index + 1) {
        let contents = pattern.slice(index + 1, end);
        if (contents.startsWith("!")) contents = `^${contents.slice(1)}`;
        expression += `[${contents.replace(/\\/gu, "\\\\")}]`;
        index = end;
      } else expression += "\\[";
    } else expression += character.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
  try { return new RegExp(`${expression}(?![\\s\\S])`, "su"); }
  catch { return new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![\\s\\S])`, "su"); }
}
