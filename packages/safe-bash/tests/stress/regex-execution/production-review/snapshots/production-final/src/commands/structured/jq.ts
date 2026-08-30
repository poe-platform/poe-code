import { FsError, readBytes, resolvePath, toByteSource, writeBytes, type ByteSource, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { Budget, copyObject, interruptible, JqError, JqLimitError, object, put, resolveJqLimits, truth, wellFormed, type InputLocation, type JqLimits, type Json, type StructuredCommandsOptions } from "./limits.js";
import { jsonValues, parseJson, rawValues, stringify } from "./input.js";
import { Interpreter } from "./interpreter.js";
import { parse } from "./parser.js";

interface Options {
  raw: boolean;
  rawInput: boolean;
  joinOutput: boolean;
  compact: boolean;
  slurp: boolean;
  nullInput: boolean;
  exitStatus: boolean;
  source: string | undefined;
  programFile: string | undefined;
  files: string[];
  variables: Map<string, Json>;
}
function argumentsFor(args: readonly string[], budget: Budget): Options {
  budget.collection(args.length);
  let argumentBytes = 0;
  for (const argument of args) {
    argumentBytes += Buffer.byteLength(argument);
    if (argumentBytes > budget.limits.maxInputBytes) throw new JqLimitError("maxInputBytes");
  }
  const options: Options = { raw: false, rawInput: false, joinOutput: false, compact: false, slurp: false, nullInput: false, exitStatus: false, source: undefined, programFile: undefined, files: [], variables: new Map() };
  const named = object();
  let ended = false;
  let variableBytes = 0;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    const operand = (): string => { const value = args[++index]; if (value === undefined) throw new JqError(`${argument} requires an operand`, 2); return value; };
    if (!ended && argument === "--") { ended = true; continue; }
    if (!ended && (argument === "--arg" || argument === "--argjson")) {
      const name = operand(); const text = operand();
      budget.text(name); budget.text(text);
      let value: Json;
      try { value = argument === "--arg" ? text : parseJson(text, budget); }
      catch (error) { if (error instanceof JqLimitError) throw error; throw new JqError(`invalid JSON for --argjson ${name}`, 2); }
      if (!wellFormed(name) || (typeof value === "string" && !wellFormed(value))) throw new JqError("arguments must contain well-formed Unicode", 2);
      variableBytes += Buffer.byteLength(name) + budget.value(value);
      if (variableBytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
      if (!options.variables.has(name)) { options.variables.set(name, value); put(named, name, value); }
      continue;
    }
    if (!ended && (argument === "-f" || argument === "--from-file")) {
      if (options.programFile !== undefined || options.source !== undefined) throw new JqError("provide exactly one filter program", 2);
      options.programFile = operand(); continue;
    }
    const long: Readonly<Record<string, string>> = { "--raw-output": "r", "--raw-input": "R", "--join-output": "j", "--compact-output": "c", "--slurp": "s", "--null-input": "n", "--exit-status": "e" };
    if (!ended && argument.startsWith("-") && argument !== "-") {
      const flags = Object.hasOwn(long, argument) ? long[argument]! : argument.startsWith("--") ? "" : argument.slice(1);
      if (!flags || !/^[rRjcsne]+$/u.test(flags)) throw new JqError(`unsupported option ${argument}`, 2);
      for (const flag of flags) {
        if (flag === "r") options.raw = true;
        else if (flag === "R") options.rawInput = true;
        else if (flag === "j") { options.joinOutput = true; options.raw = true; }
        else if (flag === "c") options.compact = true;
        else if (flag === "s") options.slurp = true;
        else if (flag === "n") options.nullInput = true;
        else options.exitStatus = true;
      }
      continue;
    }
    if (options.source === undefined && options.programFile === undefined) options.source = argument;
    else options.files.push(argument);
  }
  options.variables.set("ARGS", copyObject({ positional: [], named }));
  options.source ??= options.programFile === undefined ? "." : undefined;
  return options;
}
async function readProgram(context: CommandContext, path: string, limits: JqLimits): Promise<string> {
  const absolute = resolvePath(context.cwd, path);
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (context.fs.readStream) {
    for await (const chunk of readBytes(context.fs.readStream(absolute, { signal: context.signal }), context.signal)) {
      size += chunk.byteLength;
      if (size > limits.maxSourceBytes) throw new JqLimitError("maxSourceBytes");
      if (chunk.byteLength) chunks.push(chunk.slice());
    }
  } else {
    const chunk = await interruptible(() => context.fs.readFile(absolute, { signal: context.signal, maxBytes: limits.maxSourceBytes }), context.signal);
    if (chunk.byteLength > limits.maxSourceBytes) throw new JqLimitError("maxSourceBytes");
    chunks.push(chunk);
  }
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)); }
  catch { throw new JqError("program file is not valid UTF-8", 3); }
}
async function* inputSources(context: CommandContext, options: Options, budget: Budget): AsyncGenerator<ByteSource> {
  const files = options.files.length ? options.files : ["-"];
  let usedStdin = false;
  for (const file of files) {
    let source: ByteSource;
    if (file === "-") {
      if (options.rawInput && usedStdin) continue;
      usedStdin = true;
      source = context.stdin;
    }
    else {
      const absolute = resolvePath(context.cwd, file);
      const remaining = budget.limits.maxInputBytes - budget.inputBytes;
      if (context.fs.readStream) source = context.fs.readStream(absolute, { signal: context.signal });
      else source = toByteSource(await interruptible(() => context.fs.readFile(absolute, { signal: context.signal, maxBytes: remaining }), context.signal));
    }
    budget.inputLocation = { name: file === "-" ? "<stdin>" : file, line: 0, complete: false };
    yield source;
  }
}
async function* inputs(context: CommandContext, options: Options, budget: Budget): AsyncGenerator<Json> {
  if (options.rawInput) {
    yield* rawValues(inputSources(context, options, budget), budget, options.slurp);
  } else {
    async function* joined(): ByteSource {
      for await (const source of inputSources(context, options, budget)) yield* readBytes(source, context.signal);
    }
    yield* jsonValues(joined(), budget);
  }
}
async function execute(context: CommandContext, limits: JqLimits): Promise<{ exitCode: number }> {
  const budget = new Budget(limits, context.signal);
  context.signal.throwIfAborted();
  const diagnostics: { location: InputLocation; message: string }[] = [];
  let diagnosticBytes = 0;
  let diagnosticWriteFailed = false;
  let stdoutWriteFailed = false;
  const flush = async (force = false): Promise<void> => {
    let written = 0;
    try {
      while (written < diagnostics.length && (force || diagnostics[written]!.location.complete)) {
        const { location, message } = diagnostics[written++]!;
        const place = location.name === "<unknown>" ? location.name : `${location.name}:${location.line}`;
        await writeBytes(context.stderr, Buffer.from(`jq: error (at ${place}): ${message}\n`), context.signal);
      }
    } catch (error) {
      diagnosticWriteFailed = true;
      throw error;
    } finally {
      diagnostics.splice(0, written);
    }
  };
  try {
    const options = argumentsFor(context.args, budget);
    const source = options.programFile === undefined ? options.source! : await readProgram(context, options.programFile, limits);
    const ast = parse(source, options.variables, budget);
    const interpreter = new Interpreter(budget, options.variables);
    let last: Json | undefined;
    let status = 0;
    const emit = async (input: Json): Promise<void> => {
      await flush();
      status = options.exitStatus ? last === undefined ? 4 : truth(last) ? 0 : 1 : 0;
      let invocationLast: Json | undefined;
      const iterator = interpreter.run(ast, input);
      try {
        while (true) {
          let next: IteratorResult<Json>;
          try { next = await iterator.next(); }
          catch (error) {
            context.signal.throwIfAborted();
            if (!(error instanceof JqError) || error instanceof JqLimitError) throw error;
            const message = error.message.slice(0, 1000);
            diagnosticBytes += Buffer.byteLength(message) + Buffer.byteLength(budget.inputLocation.name) + 64;
            if (diagnosticBytes > limits.maxOutputBytes) throw new JqLimitError("maxOutputBytes");
            diagnostics.push({ location: budget.inputLocation, message });
            status = error.exitCode;
            break;
          }
          if (next.done) break;
          const result = next.value;
          await budget.tick(); budget.value(result);
          if (++budget.results > limits.maxResults) throw new JqLimitError("maxResults");
          const remaining = limits.maxOutputBytes - budget.outputBytes;
          const suffix = options.joinOutput ? "" : "\n";
          const text = options.raw && typeof result === "string" ? result : stringify(result, budget, !options.compact, Math.max(0, remaining - suffix.length), "maxOutputBytes");
          const bytes = Buffer.from(`${text}${suffix}`);
          if (bytes.byteLength > remaining) throw new JqLimitError("maxOutputBytes");
          budget.outputBytes += bytes.byteLength;
          try { await writeBytes(context.stdout, bytes, context.signal); }
          catch (error) { stdoutWriteFailed = true; throw error; }
          invocationLast = result;
          status = options.exitStatus ? truth(result) ? 0 : 1 : 0;
        }
      } finally { await iterator.return(undefined); }
      if (status < 2 && invocationLast !== undefined) last = invocationLast;
      await flush();
    };
    if (options.nullInput) await emit(null);
    else if (options.slurp && !options.rawInput) {
      const values: Json[] = [];
      let bytes = 2;
      for await (const value of inputs(context, options, budget)) {
        budget.collection(values.length + 1);
        bytes += budget.value(value) + (values.length ? 1 : 0);
        if (bytes > limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
        values.push(value);
      }
      budget.value(values); await emit(values);
    } else for await (const value of inputs(context, options, budget)) await emit(value);
    await flush(true);
    return { exitCode: options.exitStatus && last === undefined && status === 0 ? 4 : status };
  } catch (error) {
    if (diagnosticWriteFailed) throw error;
    context.signal.throwIfAborted();
    if (stdoutWriteFailed) throw error;
    if (!(error instanceof JqError) && !(error instanceof FsError)) throw error;
    if (error instanceof FsError && error.code === "EPIPE") throw error;
    await flush(true);
    await writeBytes(context.stderr, Buffer.from(`jq: ${error.message.slice(0, 1000)}\n`), context.signal);
    return { exitCode: error instanceof JqError ? error.exitCode : 2 };
  }
}
export function jqCommand(options: StructuredCommandsOptions = {}): CommandDefinition {
  const limits = resolveJqLimits(options.limits);
  return { name: "jq", description: "Bounded, dependency-free JSON filter interpreter", execute: context => execute(context, limits) };
}
