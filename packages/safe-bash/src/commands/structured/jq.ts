import { FsError, readBytes, toByteSource, writeBytes, type ByteSource, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { pathOf } from "../internal.js";
import { joinPath } from "../../contracts/path.js";
import { escapeText, writeDiagnostic } from "../../escaping.js";
import { Budget, copyObject, interruptible, JqError, JqLimitError, object, put, resolveJqLimits, truth, wellFormed, type InputLocation, type JqLimits, type Json, type StructuredCommandsOptions } from "./limits.js";
import { jsonValues, parseJson, rawValues, stringify, type JsonFormat } from "./input.js";
import { Interpreter } from "./interpreter.js";
import { moduleProgram, parse, type Ast } from "./parser.js";
import { sortObjectKeys } from "./values.js";

interface Options {
  stream: boolean;
  streamErrors: boolean;
  sequence: boolean;
  raw: boolean;
  rawInput: boolean;
  joinOutput: boolean;
  rawOutput0: boolean;
  monochrome: boolean;
  format: JsonFormat;
  sortKeys: boolean;
  slurp: boolean;
  nullInput: boolean;
  exitStatus: boolean;
  source: string | undefined;
  programFile: string | undefined;
  files: string[];
  moduleDirectories: string[];
  variables: Map<string, Json>;
}
async function argumentsFor(context: CommandContext, budget: Budget): Promise<Options> {
  const args = context.args;
  budget.collection(args.length);
  let argumentBytes = 0;
  for (const argument of args) {
    argumentBytes += Buffer.byteLength(argument);
    if (argumentBytes > budget.limits.maxInputBytes) throw new JqLimitError("maxInputBytes");
  }
  const options: Options = { stream: false, streamErrors: false, sequence: false, raw: false, rawInput: false, joinOutput: false, rawOutput0: false, monochrome: false, format: { indent: "  ", ascii: false, color: false }, sortKeys: false, slurp: false, nullInput: false, exitStatus: false, source: undefined, programFile: undefined, files: [], moduleDirectories: [], variables: new Map() };
  const named = object();
  let ended = false;
  let variableBytes = 0;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    const operand = (): string => { const value = args[++index]; if (value === undefined) throw new JqError(`${argument} requires an operand`, 2); return value; };
    if (!ended && argument === "--") { ended = true; continue; }
    if (!ended && argument.startsWith("-L")) {
      options.moduleDirectories.push(argument === "-L" ? operand() : argument.slice(2));
      continue;
    }
    if (!ended && (argument === "--arg" || argument === "--argjson" || argument === "--rawfile" || argument === "--slurpfile")) {
      const name = operand(); const text = operand();
      budget.text(name); budget.text(text);
      let value: Json;
      if (argument === "--rawfile" || argument === "--slurpfile") {
        if (!wellFormed(name)) throw new JqError("arguments must contain well-formed Unicode", 2);
        if (options.variables.has(name)) continue;
        try { value = await fileVariable(context, text, argument === "--rawfile", budget); }
        catch (error) {
          context.signal.throwIfAborted();
          if (!(error instanceof JqError) || error instanceof JqLimitError) throw error;
          throw new JqError(`Bad JSON in ${argument} ${name} ${text}: ${error.message}`, 2);
        }
      } else {
        try { value = argument === "--arg" ? text : parseJson(text, budget); }
        catch (error) { if (error instanceof JqLimitError) throw error; throw new JqError(`invalid JSON for --argjson ${name}`, 2); }
      }
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
    if (!ended && (argument === "--stream" || argument === "--stream-errors" || argument === "--seq")) {
      if (argument === "--seq") options.sequence = true;
      else { options.stream = true; options.streamErrors ||= argument === "--stream-errors"; }
      continue;
    }
    if (!ended && argument === "--indent") {
      const value = Number.parseInt(operand(), 10) || 0;
      if (value < -1 || value > 7) throw new JqError("--indent takes a number between -1 and 7", 2);
      options.format.indent = value === -1 ? "\t" : " ".repeat(value);
      continue;
    }
    if (!ended && argument === "--tab") { options.format.indent = "\t"; continue; }
    if (!ended && argument === "--raw-output0") { options.rawOutput0 = true; options.raw = true; continue; }
    // Each result already reaches the awaited sink before the next input is read.
    if (!ended && argument === "--unbuffered") continue;
    const long: Readonly<Record<string, string>> = { "--raw-output": "r", "--raw-input": "R", "--join-output": "j", "--compact-output": "c", "--sort-keys": "S", "--slurp": "s", "--null-input": "n", "--exit-status": "e", "--ascii-output": "a", "--color-output": "C", "--monochrome-output": "M" };
    if (!ended && argument.startsWith("-") && argument !== "-") {
      const flags = Object.hasOwn(long, argument) ? long[argument]! : argument.startsWith("--") ? "" : argument.slice(1);
      if (!flags || [...flags].some(flag => !"rRjcSsneaCM".includes(flag))) throw new JqError(`unsupported option ${argument}`, 2);
      for (const flag of flags) {
        if (flag === "r") options.raw = true;
        else if (flag === "R") options.rawInput = true;
        else if (flag === "j") { options.joinOutput = true; options.raw = true; }
        else if (flag === "c") options.format.indent = "";
        else if (flag === "a") options.format.ascii = true;
        else if (flag === "C") options.format.color = true;
        else if (flag === "M") options.monochrome = true;
        else if (flag === "S") options.sortKeys = true;
        else if (flag === "s") options.slurp = true;
        else if (flag === "n") options.nullInput = true;
        else options.exitStatus = true;
      }
      continue;
    }
    if (options.source === undefined && options.programFile === undefined) options.source = argument;
    else options.files.push(argument);
  }
  options.format.color &&= !options.monochrome;
  options.variables.set("ARGS", copyObject({ positional: [], named }));
  options.source ??= options.programFile === undefined ? "." : undefined;
  return options;
}
async function readProgram(context: CommandContext, path: string, limits: JqLimits): Promise<string> {
  const absolute = pathOf(context, path);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const capabilities = context.fs.capabilitiesFor
    ? await interruptible(() => context.fs.capabilitiesFor!(absolute, { signal: context.signal }), context.signal)
    : context.fs.capabilities;
  context.signal.throwIfAborted();
  if (context.fs.readStream && capabilities.streamingRead !== false) {
    for await (const chunk of readBytes(context.fs.readStream(absolute, { signal: context.signal }), context.signal)) {
      size += chunk.byteLength;
      if (size > limits.maxSourceBytes) throw new JqLimitError("maxSourceBytes");
      if (chunk.byteLength) chunks.push(new Uint8Array(chunk));
    }
  } else {
    const chunk = await interruptible(() => context.fs.readFile(absolute, { signal: context.signal, maxBytes: limits.maxSourceBytes }), context.signal);
    if (chunk.byteLength > limits.maxSourceBytes) throw new JqLimitError("maxSourceBytes");
    chunks.push(chunk);
  }
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)); }
  catch { throw new JqError("program file is not valid UTF-8", 3); }
}
export type FilterInput = (source: ByteSource) => Promise<ByteSource>;

async function compileProgram(context: CommandContext, options: Options, source: string, budget: Budget): Promise<Ast> {
  if (!options.moduleDirectories.length) return parse(source, options.variables, budget);
  let sourceBytes = Buffer.byteLength(source);
  const active = new Set<string>();
  const compile = async (text: string, depth: number, module: boolean): Promise<{ ast: Ast; definitions: Map<string, Ast> }> => {
    await budget.tick();
    if (sourceBytes > budget.limits.maxSourceBytes) throw new JqLimitError("maxSourceBytes");
    if (depth > budget.limits.maxAstDepth) throw new JqLimitError("maxAstDepth");
    const program = moduleProgram(text, budget);
    const definitions = new Map<string, Ast>();
    for (const entry of program.imports) {
      const parts = entry.name.split("/");
      if (parts.some(part => !part || part === "." || part === ".." || part.includes("\0"))) throw new JqError("invalid module path", 3);
      let loaded: { ast: Ast; definitions: Map<string, Ast> } | undefined;
      for (const directory of options.moduleDirectories) {
        await budget.tick();
        const path = pathOf(context, joinPath(directory, `${entry.name}.jq`));
        if (active.has(path)) throw new JqError(`module dependency cycle: ${entry.name}`, 3);
        let contents: string;
        try { contents = await readProgram(context, path, { ...budget.limits, maxSourceBytes: budget.limits.maxSourceBytes - sourceBytes }); }
        catch (error) {
          context.signal.throwIfAborted();
          if (error instanceof FsError && (error.code === "ENOENT" || error.code === "ENOTDIR")) continue;
          throw error;
        }
        sourceBytes += Buffer.byteLength(contents);
        active.add(path);
        try { loaded = await compile(contents, depth + 1, true); }
        finally { active.delete(path); }
        break;
      }
      if (!loaded) throw new JqError(`module not found: ${entry.name}`, 3);
      for (const [name, body] of loaded.definitions) {
        definitions.set(entry.alias === undefined ? name : `${entry.alias}::${name}`, body);
        budget.collection(definitions.size);
      }
    }
    return { ast: parse(program.source, options.variables, budget, definitions, module), definitions };
  };
  return (await compile(source, 1, false)).ast;
}

async function* inputSources(context: CommandContext, options: Pick<Options, "files" | "rawInput">, budget: Budget, convert?: FilterInput): AsyncGenerator<ByteSource> {
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
      const absolute = pathOf(context, file);
      const remaining = budget.limits.maxInputBytes - budget.inputBytes;
      await budget.tick();
      const capabilities = context.fs.capabilitiesFor
        ? await interruptible(() => context.fs.capabilitiesFor!(absolute, { signal: context.signal }), context.signal)
        : context.fs.capabilities;
      context.signal.throwIfAborted();
      if (context.fs.readStream && capabilities.streamingRead !== false) source = context.fs.readStream(absolute, { signal: context.signal });
      else source = toByteSource(await interruptible(() => context.fs.readFile(absolute, { signal: context.signal, maxBytes: remaining }), context.signal));
    }
    budget.inputLocation = { name: file === "-" ? "<stdin>" : file, line: 0, complete: false };
    yield convert ? await convert(source) : source;
  }
}
async function fileVariable(context: CommandContext, path: string, raw: boolean, budget: Budget): Promise<Json> {
  // Resolve first so a literal '-' remains a file, never the command's stdin.
  const sources = inputSources(context, { files: [pathOf(context, path)], rawInput: raw }, budget);
  if (raw) {
    for await (const value of rawValues(sources, budget, true)) return value;
    return "";
  }
  const values: Json[] = [];
  let bytes = 2;
  for await (const source of sources) {
    for await (const value of jsonValues(source, budget)) {
      budget.collection(values.length + 1);
      bytes += budget.value(value) + (values.length ? 1 : 0);
      if (bytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
      values.push(value);
    }
  }
  budget.value(values);
  return values;
}
async function* inputs(context: CommandContext, options: Options, budget: Budget, convert?: FilterInput): AsyncGenerator<Json> {
  if (options.rawInput) {
    yield* rawValues(inputSources(context, options, budget, convert), budget, options.slurp);
  } else {
    async function* joined(): ByteSource {
      for await (const source of inputSources(context, options, budget, convert)) yield* readBytes(source, context.signal);
    }
    yield* jsonValues(joined(), budget, {
      stream: options.stream, streamErrors: options.streamErrors, sequence: options.sequence,
      warning: async message => {
        const bytes = Buffer.byteLength(message) + 5;
        budget.outputBytes += bytes;
        if (budget.outputBytes > budget.limits.maxOutputBytes) throw new JqLimitError("maxOutputBytes");
        await writeDiagnostic(context.stderr, `jq: ${message}\n`, context.signal);
      },
    });
  }
}
export async function executeJq(context: CommandContext, limits: JqLimits, convert?: FilterInput): Promise<{ exitCode: number }> {
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
        const place = location.name === "<unknown>" ? location.name : `${escapeText(location.name, "diagnostic")}:${location.line}`;
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
    const options = await argumentsFor(context, budget);
    const source = options.programFile === undefined ? options.source! : await readProgram(context, options.programFile, limits);
    const ast = await compileProgram(context, options, source, budget);
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
          try {
            next = await iterator.next();
            if (!next.done && options.rawOutput0 && !options.format.ascii && typeof next.value === "string") {
              await budget.tick(next.value.length);
              if (next.value.includes("\0")) throw new JqError("Cannot dump a string containing NUL with --raw-output0 option");
            }
          }
          catch (error) {
            context.signal.throwIfAborted();
            if (!(error instanceof JqError) || error instanceof JqLimitError) throw error;
            const message = escapeText(error.message.slice(0, 1000), "diagnostic");
            diagnosticBytes += Buffer.byteLength(message) + Buffer.byteLength(escapeText(budget.inputLocation.name, "diagnostic")) + 64;
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
          const suffix = options.rawOutput0 ? "\0" : options.joinOutput ? "" : "\n";
          const prefix = options.sequence && !(options.raw && typeof result === "string") ? "\x1e" : "";
          const output = options.sortKeys ? await sortObjectKeys(result, budget) : result;
          const rawString = options.raw && typeof output === "string";
          const format = rawString ? { ...options.format, color: false } : options.format;
          const text = rawString && !format.ascii ? output : await stringify(output, budget, format, Math.max(0, remaining - suffix.length - prefix.length), "maxOutputBytes");
          if (prefix.length + Buffer.byteLength(text) + suffix.length > remaining) throw new JqLimitError("maxOutputBytes");
          const bytes = Buffer.from(`${prefix}${text}${suffix}`);
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
    if (options.nullInput) {
      await emit(null);
      // XML frontends still parse their documents when jq receives null.
      if (convert) for await (const value of inputs(context, options, budget, convert)) budget.value(value);
    }
    else if (options.slurp && !options.rawInput) {
      const values: Json[] = [];
      let bytes = 2;
      for await (const value of inputs(context, options, budget, convert)) {
        budget.collection(values.length + 1);
        bytes += budget.value(value) + (values.length ? 1 : 0);
        if (bytes > limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
        values.push(value);
      }
      budget.value(values); await emit(values);
    } else for await (const value of inputs(context, options, budget, convert)) await emit(value);
    await flush(true);
    return { exitCode: options.exitStatus && last === undefined && status === 0 ? 4 : status };
  } catch (error) {
    if (diagnosticWriteFailed) throw error;
    context.signal.throwIfAborted();
    if (stdoutWriteFailed) throw error;
    if (!(error instanceof JqError) && !(error instanceof FsError)) throw error;
    if (error instanceof FsError && error.code === "EPIPE") throw error;
    await flush(true);
    await writeDiagnostic(context.stderr, `jq: ${error.message.slice(0, 1000)}\n`, context.signal);
    return { exitCode: error instanceof JqError ? error.exitCode : 2 };
  }
}
export function jqCommand(options: StructuredCommandsOptions = {}): CommandDefinition {
  const limits = resolveJqLimits(options.limits);
  return { name: "jq", description: "Bounded, dependency-free JSON filter interpreter", execute: context => executeJq(context, limits) };
}
