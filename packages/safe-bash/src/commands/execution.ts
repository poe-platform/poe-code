import { FsError, getCommandArguments, readBytes, type ByteSource, type CommandDefinition, type CommandHandler } from "../contracts/index.js";
import { writeDiagnostic } from "../escaping.js";
import { shellValueByteLength } from "../contracts/value.js";
import { define, emptyInput, encoder, escapeBytes, integer, input as fileInput, options, output, pathOf, UsageError, value } from "./internal.js";
import { EnvSplitError, parseEnvOptions } from "./env-split.js";
import { delimitedArguments, replaceXargsArguments, xargsDisplay } from "./xargs-bytes.js";

export interface ExecutionCommandsOptions {
  readonly maxParallelProcesses?: number;
}

export function directExecutor(fallback: CommandHandler): CommandHandler {
  return async context => {
    context.signal.throwIfAborted();
    const argumentValues = getCommandArguments(context);
    const invoke = context.invoke;
    if (invoke) return invoke(context.command, argumentValues.args, {
      argumentValues, externalInvocation: true,
      ...(context.argv0 === undefined ? {} : { argv0: context.argv0 }),
      stdin: context.stdin, cwd: context.cwd, env: context.env, stdout: context.stdout, stderr: context.stderr,
      ...(context.stdinIsDefault === undefined ? {} : { stdinIsDefault: context.stdinIsDefault }),
    });
    return fallback({ ...context, args: argumentValues.args, argumentValues });
  };
}

async function* argumentsFrom(source: ByteSource, signal: AbortSignal, replacement = false, lines = false): AsyncGenerator<Uint8Array | null> {
  const current: number[] = [];
  const pendingBlanks: number[] = [];
  let active = false;
  let escaped = false;
  let quote = 0;
  let lineActive = false;
  let trailingBlank = false;
  for await (const chunk of readBytes(source, signal)) {
    signal.throwIfAborted();
    for (const byte of chunk) {
      if (byte === 0) throw new UsageError("NUL in non-NUL-delimited input is not supported");
      const blank = byte === 32 || byte === 9;
      if (byte === 10 && !quote && !escaped) {
        pendingBlanks.length = 0;
        if (active) { yield Uint8Array.from(current); current.length = 0; active = false; }
        if (lines && lineActive && !trailingBlank) { yield null; lineActive = false; }
        trailingBlank = false;
        continue;
      }
      if (!blank || quote || escaped) lineActive = true;
      trailingBlank = blank && !quote && !escaped;
      if (replacement && blank && !quote && !escaped) {
        if (active) pendingBlanks.push(byte);
        continue;
      }
      if (pendingBlanks.length) { for (const byte of pendingBlanks) current.push(byte); pendingBlanks.length = 0; }
      if (escaped) { current.push(byte); active = true; escaped = false; }
      else if (quote) {
        if (byte === 10) throw new UsageError("unmatched quote in input");
        if (byte === quote) quote = 0;
        else current.push(byte);
      } else if (byte === 92) { escaped = true; active = true; }
      else if (byte === 39 || byte === 34) { quote = byte; active = true; }
      else if (byte === 10 || !replacement && (byte === 32 || byte === 9 || byte === 13 || byte === 11 || byte === 12)) {
        if (active) { yield Uint8Array.from(current); current.length = 0; active = false; }
      } else if (replacement && !active && blank) continue;
      else { current.push(byte); active = true; }
    }
  }
  if (quote || escaped) throw new UsageError(quote ? "unmatched quote in input" : "trailing backslash in input");
  if (active) yield Uint8Array.from(current);
}

export function executionCommands(execute: CommandHandler, configuration: ExecutionCommandsOptions = {}): CommandDefinition[] {
  const configured = configuration.maxParallelProcesses;
  const maxParallelProcesses = configured === undefined ? Infinity : configured;
  if (maxParallelProcesses !== Infinity && (!Number.isSafeInteger(maxParallelProcesses) || maxParallelProcesses < 1)) throw new RangeError("maxParallelProcesses must be a positive safe integer or Infinity");
  return [
    define("env", async context => {
      const argumentValues = getCommandArguments(context);
      const preserveLegacyStatus = argumentValues.args.some(arg => arg.startsWith("-S") || arg.startsWith("--split-string"))
        || (argumentValues.args.length === 1 && (argumentValues.args[0] === "-a" || argumentValues.args[0] === "--argv0"));
      let parsed: Awaited<ReturnType<typeof parseEnvOptions>>;
      let debug = false;
      let env: Record<string, string>;
      let names: string[];
      let offset = 0;
      let cwd = context.cwd;
      let argv0: string | undefined;
      try {
        parsed = await parseEnvOptions(argumentValues.args, context.env, context.signal, argumentValues);
        debug = parsed.flags.has("v");
        if (debug && parsed.flags.has("i")) await writeDiagnostic(context.stderr, "cleaning environ\n", context.signal);
        env = Object.assign(Object.create(null) as Record<string, string>, parsed.flags.has("i") ? {} : context.env);
        for (const name of parsed.values.get("u") ?? []) {
          if (!name || name.includes("=") || name.includes("\0")) throw new UsageError(`cannot unset '${name}': Invalid argument`);
          if (debug) await writeDiagnostic(context.stderr, `unset:    ${name}\n`, context.signal);
          delete env[name];
        }
        const inheritedNames = Object.keys(env);
        const addedNames: string[] = [];
        while (parsed.operands[offset]?.includes("=")) {
          const assignment = parsed.operands[offset++]!;
          const equals = assignment.indexOf("=");
          const name = assignment.slice(0, equals);
          if (name.includes("\0")) throw new UsageError("invalid environment variable name");
          const content = assignment.slice(equals + 1);
          if (content.includes("\0")) throw new UsageError("environment values cannot contain NUL");
          if (debug) await writeDiagnostic(context.stderr, `setenv:   ${assignment}\n`, context.signal);
          if (!Object.hasOwn(env, name)) addedNames.push(name);
          env[name] = content;
        }
        names = [...addedNames.reverse(), ...inheritedNames];
        if (offset < parsed.operands.length && parsed.flags.has("0")) throw new UsageError("cannot specify --null with a command");
        const directory = value(parsed, "C");
        if (directory !== undefined) {
          if (debug) await writeDiagnostic(context.stderr, `chdir:    '${directory}'\n`, context.signal);
          cwd = pathOf(context, directory);
          if ((await context.fs.stat(cwd, { signal: context.signal })).type !== "directory") throw new FsError("ENOTDIR", { path: cwd });
          cwd = await context.fs.realpath(cwd, { signal: context.signal });
        }
        argv0 = value(parsed, "a");
        if (argv0?.includes("\0")) throw new UsageError("argv0 cannot contain NUL");
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof EnvSplitError || (!preserveLegacyStatus && (error instanceof UsageError || error instanceof FsError))) {
          await writeDiagnostic(context.stderr, `${context.command}: ${(error as Error).message}\n`, context.signal);
          return { exitCode: 125 };
        }
        throw error;
      }
      if (offset < parsed.operands.length) {
        if (debug) {
          await writeDiagnostic(context.stderr, `executing: ${parsed.operands[offset]}\n`, context.signal);
          for (let index = offset; index < parsed.operands.length; index++) {
            await writeDiagnostic(context.stderr, `   arg[${index - offset}]= '${parsed.operands[index]}'\n`, context.signal);
          }
        }
        const childArguments = parsed.operandValues!.slice(offset + 1);
        const childEnv: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, Object.fromEntries(names.map(name => [name, env[name]!])));
        if (context.invoke) return context.invoke(parsed.operands[offset]!, childArguments.args, {
          argumentValues: childArguments, externalInvocation: true,
          ...(argv0 === undefined ? {} : { argv0 }),
          env: childEnv, replaceEnv: true, cwd, stdin: context.stdin, stdout: context.stdout, stderr: context.stderr,
          ...(context.stdinIsDefault === undefined ? {} : { stdinIsDefault: context.stdinIsDefault }),
        });
        return execute({ ...context, argv0, command: parsed.operands[offset]!, args: childArguments.args, argumentValues: childArguments, env: childEnv, cwd });
      }
      for (const name of names) await output(context, `${name}=${env[name]}${parsed.flags.has("0") ? "\0" : "\n"}`);
      return { exitCode: 0 };
    }),
    define("xargs", async context => {
      const rawArgumentValues = getCommandArguments(context);
      const normalizedValues = [...rawArgumentValues.values];
      const shortOptions = "0rn:s:I:d:tP:xE:a:L:";
      let expectOptionValue = false;
      for (let i = 0; i < normalizedValues.length; i++) {
        const arg = rawArgumentValues.args[i]!;
        if (expectOptionValue) { expectOptionValue = false; continue; }
        if (arg === "--" || !arg.startsWith("-") || arg === "-") break;
        if (arg === "-i" || arg === "--replace") { normalizedValues[i] = "-I{}"; continue; }
        if (arg.startsWith("-i") && !arg.startsWith("--")) { normalizedValues[i] = "-I" + arg.slice(2); continue; }
        if (arg === "-l" || arg === "--max-lines") { normalizedValues[i] = "-L1"; continue; }
        if (arg.startsWith("-l") && !arg.startsWith("--")) { normalizedValues[i] = "-L" + arg.slice(2); continue; }
        if (arg === "-e" || arg === "--eof") { normalizedValues[i] = "--eof="; continue; }
        if (arg.startsWith("-e") && !arg.startsWith("--")) { normalizedValues[i] = "-E" + arg.slice(2); continue; }
        if (!arg.startsWith("--")) {
          for (let offset = 1; offset < arg.length; offset++) {
            const specification = shortOptions.indexOf(arg[offset]!);
            if (specification < 0 || shortOptions[specification + 1] !== ":") continue;
            expectOptionValue = offset + 1 === arg.length;
            break;
          }
        } else if (["--arg-file", "--max-args", "--max-chars", "--delimiter", "--max-procs", "--process-slot-var"].includes(arg)) {
          expectOptionValue = true;
        }
      }
      const argumentValues = rawArgumentValues.withValues(normalizedValues);
      const operandIndices: number[] = [];
      let replacementOrigin: { index: number; offset: number } | undefined;
      let batching: string | undefined;
      let lastDelimMode: "0" | "d" | undefined;
      const longOptions = { "arg-file": "a", "max-lines": "L", null: "0", "no-run-if-empty": "r", "max-args": "n", "max-chars": "s", replace: "I", delimiter: "d", verbose: "t", "max-procs": "P", exit: "x", eof: "E", "process-slot-var": "process-slot-var:" };
      const parsed = options(argumentValues.args, shortOptions, longOptions, true, index => { operandIndices.push(index); },
        (key, index, offset) => { if (key === "I") replacementOrigin = { index, offset }; },
        key => {
          if (key === "I" || key === "L" || key === "n") batching = key;
          if (key === "0" || key === "d") lastDelimMode = key;
        });
      const requested = integer(value(parsed, "P") ?? "1");
      const parallelism = requested === 0 ? maxParallelProcesses : Math.min(requested, maxParallelProcesses);
      const slotVariable = value(parsed, "process-slot-var");
      if (slotVariable !== undefined && (!slotVariable || slotVariable.includes("=") || slotVariable.includes("\0"))) throw new UsageError("invalid environment variable name");
      const replacement = batching === "I" ? value(parsed, "I") : undefined;
      if (replacement === "") throw new UsageError("replacement string cannot be empty");
      let replacementPattern: Uint8Array | undefined;
      if (batching === "I" && replacementOrigin) {
        const { index, offset } = replacementOrigin;
        replacementPattern = argumentValues.bytes(index)!.subarray(offset);
      }
      const maxLines = batching === "L" ? integer(value(parsed, "L")!, 1) : undefined;
      const argumentFile = value(parsed, "a");
      const childInput = argumentFile === undefined ? emptyInput() : context.stdin;
      const childInputIsDefault = argumentFile === undefined ? true : context.stdinIsDefault;
      const maxArgs = replacement === undefined ? integer(batching === "n" ? value(parsed, "n")! : (maxLines === undefined ? "5000" : String(Number.MAX_SAFE_INTEGER)), 1) : 1;
      const size = value(parsed, "s");
      const maxBytes = size === undefined || size === "Infinity" ? Infinity : integer(size, 1);
      let delimiter = parsed.flags.has("0") ? "\0" : undefined;
      const suppliedDelimiter = value(parsed, "d");
      if (suppliedDelimiter !== undefined) {
        const bytes = escapeBytes(suppliedDelimiter).bytes;
        if (bytes.length !== 1 || bytes[0]! > 127) throw new UsageError("delimiter must be one ASCII byte");
        if (lastDelimMode === "d") delimiter = String.fromCharCode(bytes[0]!);
      }
      const command = parsed.operands[0] ?? "echo";
      const initial = argumentValues.select(operandIndices).slice(1);
      const baseBytes = encoder.encode(command).length + 1 + initial.values.reduce((sum, argument) => sum + shellValueByteLength(argument) + 1, 0);
      if (baseBytes >= maxBytes) throw new UsageError("initial arguments exceed command size limit");
      let batch: (string | Uint8Array)[] = [];
      let bytes = baseBytes;
      let lines = 0;
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
      const slots = new Set<number>();
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
        inputIterator = (argumentFile === undefined ? context.stdin : fileInput({ ...context, signal: inputSignal }, pathOf(context, argumentFile)))[Symbol.asyncIterator]();
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
        const childArguments = initial.withValues(replacementPattern === undefined || parsed.operands.length === 0 ? [...initial.values, ...batch] : await replaceXargsArguments(initial.values, replacementPattern, batch[0] ?? "", maxBytes - encoder.encode(command).length - 1, context.signal));
        const args = childArguments.args;
        const size = encoder.encode(command).length + 1 + childArguments.values.reduce((sum, argument) => sum + shellValueByteLength(argument) + 1, 0);
        if (size > maxBytes) throw new UsageError("expanded arguments exceed command size limit");
        if (parsed.flags.has("t")) await writeDiagnostic(context.stderr, [command, ...childArguments.values].map(xargsDisplay).join(" ") + "\n", context.signal);
        if (stop) return;
        context.signal.throwIfAborted();
        executed = true;
        batch = []; bytes = baseBytes; lines = 0;
        let slot = 0;
        while (slots.has(slot)) slot++;
        slots.add(slot);
        const pending = Promise.resolve().then(() => {
          childSignal.throwIfAborted();
          const env = { ...context.env, ...(slotVariable === undefined ? {} : { [slotVariable]: String(slot) }) };
          if (context.invoke) return context.invoke(command, args, {
            argumentValues: childArguments, externalInvocation: true, stdin: childInput, ...(childInputIsDefault === undefined ? {} : { stdinIsDefault: childInputIsDefault }),
            cwd: context.cwd, env, stdout: context.stdout, stderr: context.stderr, signal: childSignal,
          });
          return execute({ ...context, command, args, argumentValues: childArguments, stdin: childInput, ...(childInputIsDefault === undefined ? {} : { stdinIsDefault: childInputIsDefault }), env, signal: childSignal });
        }).then(result => {
          const exitCode = result.exitCode;
          if (!terminal && (exitCode === 255 || exitCode === 126 || exitCode === 127)) {
            terminal = true;
            status = exitCode === 255 ? 124 : exitCode;
            stopInput();
          } else if (!terminal && exitCode !== 0) status = 123;
        }).catch(fail).then(() => { slots.delete(slot); active.delete(pending); notify(); });
        active.add(pending);
      };
      const eof = value(parsed, "E");
      const eofBytes = eof !== undefined && eof !== "" ? encoder.encode(eof) : undefined;
      try {
        if (delimiter !== undefined && eof !== undefined && eof !== "") await writeDiagnostic(context.stderr, "xargs: warning: the -E option has no effect if -0 or -d is used.\n\n", context.signal);
        const incoming = delimiter === undefined
          ? argumentsFrom(source, inputSignal, replacement !== undefined, maxLines !== undefined && replacement === undefined)
          : delimitedArguments(source, inputSignal, context.signal, delimiter.charCodeAt(0), replacement === undefined ? maxBytes - baseBytes - 1 : maxBytes - 1);
        for await (const argument of incoming) {
          if (argument === null) {
            if (++lines === maxLines && batch.length) {
              await dispatch();
              await capacity();
              if (stop) break;
            }
            continue;
          }
          if (stop || delimiter === undefined && eofBytes !== undefined && Buffer.compare(argument, eofBytes) === 0) break;
          const size = (typeof argument === "string" ? Buffer.byteLength(argument) : argument.byteLength) + 1;
          if (replacement === undefined && baseBytes + size > maxBytes) throw new UsageError("single argument exceeds command size limit");
          if (batch.length && (batch.length === maxArgs || bytes + size > maxBytes)) {
            if ((parsed.flags.has("x") || maxLines !== undefined) && batch.length < maxArgs) throw new UsageError("command size limit exceeded");
            await dispatch();
            await capacity();
            if (stop) break;
          }
          batch.push(argument); bytes += size;
          if (batch.length === maxArgs || delimiter !== undefined && maxLines !== undefined && ++lines === maxLines) {
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
