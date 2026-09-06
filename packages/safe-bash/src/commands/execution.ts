import { FsError, getCommandArguments, readBytes, type ByteSource, type CommandDefinition, type CommandHandler } from "../contracts/index.js";
import { writeDiagnostic } from "../escaping.js";
import { shellValueByteLength } from "../contracts/value.js";
import { define, emptyInput, encoder, escapeBytes, integer, options, output, pathOf, replaceArgument, UsageError, value } from "./internal.js";
import { EnvSplitError, parseEnvOptions } from "./env-split.js";

export interface ExecutionCommandsOptions {
  readonly maxParallelProcesses?: number;
}

export function directExecutor(fallback: CommandHandler): CommandHandler {
  return async context => {
    context.signal.throwIfAborted();
    const argumentValues = getCommandArguments(context);
    const invoke = context.invoke;
    if (invoke) return invoke(context.command, argumentValues.args, {
      argumentValues,
      stdin: context.stdin, cwd: context.cwd, env: context.env, stdout: context.stdout, stderr: context.stderr,
      ...(context.stdinIsDefault === undefined ? {} : { stdinIsDefault: context.stdinIsDefault }),
    });
    return fallback({ ...context, args: argumentValues.args, argumentValues });
  };
}

async function* argumentsFrom(source: ByteSource, signal: AbortSignal, delimiter?: string, replacement = false): AsyncGenerator<string> {
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  let current = "";
  let active = false;
  let escaped = false;
  let quote = "";
  const parse = function* (text: string): Generator<string> {
    for (const character of text) {
      if (delimiter !== undefined) {
        if (character === delimiter) { yield current; current = ""; active = false; }
        else { current += character; active = true; }
      } else if (escaped) { current += character; active = true; escaped = false; }
      else if (quote) {
        if (character === "\n") throw new UsageError("unmatched quote in input");
        if (character === quote) quote = "";
        else current += character;
      } else if (character === "\\") { escaped = true; active = true; }
      else if (character === "'" || character === '"') { quote = character; active = true; }
      else if (character === "\n" || !replacement && /[ \t\r\v\f]/u.test(character)) {
        if (active) { yield current; current = ""; active = false; }
      } else if (replacement && !active && /[ \t]/u.test(character)) continue;
      else { current += character; active = true; }
      if (current.length > 131072) throw new UsageError("argument exceeds 128 KiB limit");
    }
  };
  for await (const chunk of readBytes(source, signal)) { signal.throwIfAborted(); yield* parse(utf8.decode(chunk, { stream: true })); }
  yield* parse(utf8.decode());
  if (quote || escaped) throw new UsageError(quote ? "unmatched quote in input" : "trailing backslash in input");
  if (active) yield current;
}

export function executionCommands(execute: CommandHandler, configuration: ExecutionCommandsOptions = {}): CommandDefinition[] {
  const configured = configuration.maxParallelProcesses;
  const maxParallelProcesses = configured === undefined ? 4 : configured;
  if (!Number.isSafeInteger(maxParallelProcesses) || maxParallelProcesses < 1) throw new RangeError("maxParallelProcesses must be a positive safe integer");
  return [
    define("env", async context => {
      const argumentValues = getCommandArguments(context);
      let parsed: Awaited<ReturnType<typeof parseEnvOptions>>;
      try { parsed = await parseEnvOptions(argumentValues.args, context.env, context.signal, argumentValues); }
      catch (error) {
        context.signal.throwIfAborted();
        if (!(error instanceof EnvSplitError)) throw error;
        await writeDiagnostic(context.stderr, `${context.command}: ${error.message}\n`, context.signal);
        return { exitCode: 125 };
      }
      const env: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, parsed.flags.has("i") ? {} : context.env);
      for (const name of parsed.values.get("u") ?? []) delete env[name];
      const inheritedNames = Object.keys(env);
      const addedNames: string[] = [];
      let offset = 0;
      while (parsed.operands[offset]?.includes("=")) {
        const assignment = parsed.operands[offset++]!;
        const equals = assignment.indexOf("=");
        const name = assignment.slice(0, equals);
        if (!name || name.includes("\0")) throw new UsageError("invalid environment variable name");
        const content = assignment.slice(equals + 1);
        if (content.includes("\0")) throw new UsageError("environment values cannot contain NUL");
        if (!Object.hasOwn(env, name)) addedNames.push(name);
        env[name] = content;
      }
      const names = [...addedNames.reverse(), ...inheritedNames];
      if (offset < parsed.operands.length && parsed.flags.has("0")) throw new UsageError("cannot specify --null with a command");
      let cwd = context.cwd;
      const directory = value(parsed, "C");
      if (directory !== undefined) {
        cwd = pathOf(context, directory);
        if ((await context.fs.stat(cwd, { signal: context.signal })).type !== "directory") throw new FsError("ENOTDIR", { path: cwd });
        cwd = await context.fs.realpath(cwd, { signal: context.signal });
      }
      if (offset < parsed.operands.length) {
        const childArguments = parsed.operandValues!.slice(offset + 1);
        const childEnv: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, Object.fromEntries(names.map(name => [name, env[name]!])));
        if (context.invoke) return context.invoke(parsed.operands[offset]!, childArguments.args, {
          argumentValues: childArguments,
          env: childEnv, replaceEnv: true, cwd, stdin: context.stdin, stdout: context.stdout, stderr: context.stderr,
          ...(context.stdinIsDefault === undefined ? {} : { stdinIsDefault: context.stdinIsDefault }),
        });
        return execute({ ...context, command: parsed.operands[offset]!, args: childArguments.args, argumentValues: childArguments, env: childEnv, cwd });
      }
      for (const name of names) await output(context, `${name}=${env[name]}${parsed.flags.has("0") ? "\0" : "\n"}`);
      return { exitCode: 0 };
    }),
    define("xargs", async context => {
      const argumentValues = getCommandArguments(context);
      const operandIndices: number[] = [];
      const parsed = options(argumentValues.args, "0rn:s:I:d:tP:xE:", { null: "0", "no-run-if-empty": "r", "max-args": "n", "max-chars": "s", replace: "I", delimiter: "d", verbose: "t", "max-procs": "P", exit: "x", eof: "E" }, true, index => { operandIndices.push(index); });
      const requested = integer(value(parsed, "P") ?? "1");
      const parallelism = requested === 0 ? maxParallelProcesses : Math.min(requested, maxParallelProcesses);
      const replacement = value(parsed, "I");
      if (replacement === "") throw new UsageError("replacement string cannot be empty");
      if (replacement !== undefined && parsed.flags.has("n")) throw new UsageError("cannot combine -I and -n");
      const maxArgs = replacement === undefined ? integer(value(parsed, "n") ?? "5000", 1) : 1;
      const maxBytes = integer(value(parsed, "s") ?? "131072", 1);
      if (maxBytes > 131072) throw new UsageError("command size limit cannot exceed 128 KiB");
      let delimiter = parsed.flags.has("0") ? "\0" : undefined;
      const suppliedDelimiter = value(parsed, "d");
      if (suppliedDelimiter !== undefined) {
        const bytes = escapeBytes(suppliedDelimiter).bytes;
        if (bytes.length !== 1 || bytes[0]! > 127) throw new UsageError("delimiter must be one ASCII byte");
        delimiter = String.fromCharCode(bytes[0]!);
      }
      const command = parsed.operands[0] ?? "echo";
      const initial = argumentValues.select(operandIndices).slice(1);
      const baseBytes = encoder.encode(command).length + 1 + initial.values.reduce((sum, argument) => sum + shellValueByteLength(argument) + 1, 0);
      if (baseBytes >= maxBytes) throw new UsageError("initial arguments exceed command size limit");
      let batch: string[] = [];
      let bytes = baseBytes;
      let executed = false;
      let status = 0;
      let stop = false;
      let terminal = false;
      let failure: { reason: unknown } | undefined;
      let finishing = false;
      let cleanupPromise: Promise<void> | undefined;
      let inputIterator: AsyncIterator<Uint8Array> | undefined;
      let inputFinished = false;
      let inputReturn: Promise<IteratorResult<Uint8Array>> | undefined;
      let wake: (() => void) | undefined;
      const active = new Set<Promise<void>>();
      const children = new AbortController();
      const input = new AbortController();
      const inputStopped = new Error("xargs input admission closed");
      const childSignal = AbortSignal.any([context.signal, children.signal]);
      const inputSignal = AbortSignal.any([context.signal, input.signal]);
      const notify = () => { const waiting = wake; wake = undefined; waiting?.(); };
      const stopInput = () => { stop = true; input.abort(inputStopped); notify(); };
      const closeInput = (): Promise<IteratorResult<Uint8Array>> => {
        inputReturn ??= Promise.resolve().then(() => inputFinished ? { done: true, value: undefined } : inputIterator?.return?.() ?? { done: true, value: undefined });
        return inputReturn;
      };
      const fail = (reason: unknown) => {
        failure ??= { reason };
        stopInput();
        children.abort(reason);
      };
      const cancelled = () => { stopInput(); children.abort(context.signal.reason); };
      const cleanup = (): Promise<void> => {
        if (!cleanupPromise) {
          stopInput();
          if (!finishing) children.abort(inputStopped);
          cleanupPromise = Promise.resolve().then(async () => {
            try {
              const results = await Promise.allSettled([closeInput(), ...active]);
              for (const result of results) if (result.status === "rejected") throw result.reason;
            } finally { context.signal.removeEventListener("abort", cancelled); }
          });
        }
        return cleanupPromise;
      };
      context.registerCleanup?.(cleanup);
      context.signal.addEventListener("abort", cancelled, { once: true });
      if (context.signal.aborted) cancelled();
      const source: ByteSource = { [Symbol.asyncIterator]() {
        inputSignal.throwIfAborted();
        inputIterator = context.stdin[Symbol.asyncIterator]();
        return {
          async next() {
            const result = await inputIterator!.next();
            inputFinished = result.done === true;
            return result;
          },
          return: closeInput,
        };
      } };
      const capacity = async () => {
        while (!stop && active.size >= parallelism) await new Promise<void>(resolve => { wake = resolve; });
      };
      const dispatch = async () => {
        if (stop) return;
        const childArguments = initial.withValues(replacement === undefined ? [...initial.values, ...batch] : initial.values.map((argument, index) => replaceArgument(typeof argument === "string" ? argument : initial.bytes(index)!, replacement, batch[0] ?? "")));
        const args = childArguments.args;
        const size = encoder.encode(command).length + 1 + childArguments.values.reduce((sum, argument) => sum + shellValueByteLength(argument) + 1, 0);
        if (size > maxBytes) throw new UsageError("expanded arguments exceed command size limit");
        if (parsed.flags.has("t")) await writeDiagnostic(context.stderr, [command, ...args].map(argument => /^[A-Za-z0-9_./-]+$/u.test(argument) ? argument : `'${argument.replaceAll("'", "'\\''")}'`).join(" ") + "\n", context.signal);
        if (stop) return;
        context.signal.throwIfAborted();
        executed = true;
        batch = []; bytes = baseBytes;
        const pending = Promise.resolve().then(() => {
          childSignal.throwIfAborted();
          if (context.invoke) return context.invoke(command, args, {
            argumentValues: childArguments, stdin: emptyInput(), stdinIsDefault: true,
            cwd: context.cwd, env: { ...context.env }, stdout: context.stdout, stderr: context.stderr, signal: childSignal,
          });
          return execute({ ...context, command, args, argumentValues: childArguments, stdin: emptyInput(), stdinIsDefault: true, env: { ...context.env }, signal: childSignal });
        }).then(result => {
          const exitCode = result.exitCode;
          if (!terminal && (exitCode === 255 || exitCode === 126 || exitCode === 127)) {
            terminal = true;
            status = exitCode === 255 ? 124 : exitCode;
            stopInput();
          } else if (!terminal && exitCode !== 0) status = 123;
        }).catch(fail).then(() => { active.delete(pending); notify(); });
        active.add(pending);
      };
      const eof = value(parsed, "E");
      try {
        for await (const argument of argumentsFrom(source, inputSignal, delimiter, replacement !== undefined)) {
          if (stop || delimiter === undefined && eof !== undefined && eof !== "" && argument === eof) break;
          const size = encoder.encode(argument).length + 1;
          if (replacement === undefined && baseBytes + size > maxBytes) throw new UsageError("single argument exceeds command size limit");
          if (batch.length && (batch.length === maxArgs || bytes + size > maxBytes)) {
            if (parsed.flags.has("x") && batch.length < maxArgs) throw new UsageError("command size limit exceeded");
            await dispatch();
            await capacity();
            if (stop) break;
          }
          batch.push(argument); bytes += size;
          if (batch.length === maxArgs) {
            await dispatch();
            await capacity();
            if (stop) break;
          }
        }
        if (!stop && (batch.length || !executed && !parsed.flags.has("r") && replacement === undefined)) await dispatch();
      } catch (error) {
        if (error !== inputStopped) fail(error);
      } finally {
        finishing = true;
        try { await cleanup(); }
        catch (error) { failure ??= { reason: error }; }
      }
      context.signal.throwIfAborted();
      if (failure) throw failure.reason;
      return { exitCode: status };
    }),
  ];
}
