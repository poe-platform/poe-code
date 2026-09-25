import { FsError, readBytes, toByteSource, writeBytes, type ByteSource, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { pathOf } from "../internal.js";
import { joinPath } from "../../contracts/path.js";
import { escapeText, writeDiagnostic } from "../../escaping.js";
import { Budget, copyObject, interruptible, JqHalt, JqError, JqLimitError, object, put, resolveJqLimits, truth, wellFormed, type InputLocation, type JqLimits, type Json, type StructuredCommandsOptions } from "./limits.js";
import { jsonValues, parseJson, rawValues, stringify, tryStringifyCompactSync, tryWriteCompactSync, type JsonFormat } from "./input.js";
import { Interpreter } from "./interpreter.js";
import { moduleProgram, parse, type Ast } from "./parser.js";
import { sortObjectKeys } from "./values.js";

const DEFAULT_INTERPRETER_RUN = Interpreter.prototype.run;
const JQ_LONG_FLAGS: Readonly<Record<string, string>> = {
  "--raw-output": "r", "--raw-input": "R", "--join-output": "j", "--compact-output": "c",
  "--sort-keys": "S", "--slurp": "s", "--null-input": "n", "--exit-status": "e",
  "--ascii-output": "a", "--color-output": "C", "--monochrome-output": "M",
};
const jqAstCache = new Map<string, Ast>();

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
function argumentsFor(context: CommandContext, budget: Budget): Options | Promise<Options> {
  const args = context.args;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--rawfile" || a === "--slurpfile") return argumentsForAsync(context, budget);
  }
  budget.collection(args.length);
  let argumentBytes = 0;
  for (const argument of args) {
    argumentBytes += Buffer.byteLength(argument);
    if (argumentBytes > budget.limits.maxInputBytes) throw new JqLimitError("maxInputBytes");
  }
  const options: Options = { stream: false, streamErrors: false, sequence: false, raw: false, rawInput: false, joinOutput: false, rawOutput0: false, monochrome: false, format: { indent: "  ", ascii: false, color: false }, sortKeys: false, slurp: false, nullInput: false, exitStatus: false, source: undefined, programFile: undefined, files: [], moduleDirectories: [], variables: new Map() };
  let named: ReturnType<typeof object> | undefined;
  const positional: Json[] = [];
  let positionalMode: "--args" | "--jsonargs" | undefined;
  let ended = false;
  let variableBytes = 0;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    const operand = (): string => { const value = args[++index]; if (value === undefined) throw new JqError(`${argument} requires an operand`, 2); return value; };
    if (!ended && argument === "--") { ended = true; continue; }
    if (!ended && (argument === "--args" || argument === "--jsonargs")) { positionalMode = argument; continue; }
    if (!ended && argument.startsWith("-L")) {
      options.moduleDirectories.push(argument === "-L" ? operand() : argument.slice(2));
      continue;
    }
    if (!ended && (argument === "--arg" || argument === "--argjson")) {
      const name = operand(); const text = operand();
      budget.text(name); budget.text(text);
      let value: Json;
      try { value = argument === "--arg" ? text : parseJson(text, budget); }
      catch (error) { if (error instanceof JqLimitError) throw error; throw new JqError(`invalid JSON for --argjson ${name}`, 2); }
      if (!wellFormed(name) || (typeof value === "string" && !wellFormed(value))) throw new JqError("arguments must contain well-formed Unicode", 2);
      variableBytes += Buffer.byteLength(name) + budget.value(value);
      if (variableBytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
      if (!options.variables.has(name)) { options.variables.set(name, value); put((named ??= object()), name, value); }
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
    if (!ended && argument === "--unbuffered") continue;
    const flagStart = argument[1] ?? "";
    const positionalOperand = positionalMode !== undefined && flagStart !== "-" && !(flagStart >= "a" && flagStart <= "z") && !(flagStart >= "A" && flagStart <= "Z");
    if (!ended && argument.startsWith("-") && argument !== "-" && !positionalOperand) {
      const flags = Object.hasOwn(JQ_LONG_FLAGS, argument) ? JQ_LONG_FLAGS[argument]! : argument.startsWith("--") ? "" : argument.slice(1);
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
    else if (positionalMode !== undefined) {
      budget.text(argument);
      let value: Json;
      try { value = positionalMode === "--args" ? argument : parseJson(argument, budget); }
      catch (error) { if (error instanceof JqLimitError) throw error; throw new JqError("invalid JSON text passed to --jsonargs", 2); }
      if (typeof value === "string" && !wellFormed(value)) throw new JqError("arguments must contain well-formed Unicode", 2);
      variableBytes += budget.value(value) + (positional.length ? 1 : 2);
      if (variableBytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
      positional.push(value);
    }
    else options.files.push(argument);
  }
  options.format.color &&= !options.monochrome;
  if (positional.length) budget.value(positional);
  options.source ??= options.programFile === undefined ? "." : undefined;
  if (positional.length > 0 || named !== undefined || options.programFile !== undefined || options.source?.includes("ARGS")) {
    options.variables.set("ARGS", copyObject({ positional, named: named ?? object() }));
  }
  return options;
}
async function argumentsForAsync(context: CommandContext, budget: Budget): Promise<Options> {
  const args = context.args;
  budget.collection(args.length);
  let argumentBytes = 0;
  for (const argument of args) {
    argumentBytes += Buffer.byteLength(argument);
    if (argumentBytes > budget.limits.maxInputBytes) throw new JqLimitError("maxInputBytes");
  }
  const options: Options = { stream: false, streamErrors: false, sequence: false, raw: false, rawInput: false, joinOutput: false, rawOutput0: false, monochrome: false, format: { indent: "  ", ascii: false, color: false }, sortKeys: false, slurp: false, nullInput: false, exitStatus: false, source: undefined, programFile: undefined, files: [], moduleDirectories: [], variables: new Map() };
  const named = object();
  const positional: Json[] = [];
  let positionalMode: "--args" | "--jsonargs" | undefined;
  let ended = false;
  let variableBytes = 0;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    const operand = (): string => { const value = args[++index]; if (value === undefined) throw new JqError(`${argument} requires an operand`, 2); return value; };
    if (!ended && argument === "--") { ended = true; continue; }
    if (!ended && (argument === "--args" || argument === "--jsonargs")) { positionalMode = argument; continue; }
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
    const flagStart = argument[1] ?? "";
    // jq treats negative numbers and punctuation after '-' as operands.
    const positionalOperand = positionalMode !== undefined && flagStart !== "-" && !(flagStart >= "a" && flagStart <= "z") && !(flagStart >= "A" && flagStart <= "Z");
    if (!ended && argument.startsWith("-") && argument !== "-" && !positionalOperand) {
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
    else if (positionalMode !== undefined) {
      budget.text(argument);
      let value: Json;
      try { value = positionalMode === "--args" ? argument : parseJson(argument, budget); }
      catch (error) { if (error instanceof JqLimitError) throw error; throw new JqError("invalid JSON text passed to --jsonargs", 2); }
      if (typeof value === "string" && !wellFormed(value)) throw new JqError("arguments must contain well-formed Unicode", 2);
      variableBytes += budget.value(value) + (positional.length ? 1 : 2);
      if (variableBytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
      positional.push(value);
    }
    else options.files.push(argument);
  }
  options.format.color &&= !options.monochrome;
  if (positional.length) budget.value(positional);
  options.variables.set("ARGS", copyObject({ positional, named }));
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
    const chunk = await interruptible(() => context.fs.readFile(absolute, { signal: context.signal, ...(Number.isFinite(limits.maxSourceBytes) ? { maxBytes: limits.maxSourceBytes } : {}) }), context.signal);
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
      else source = toByteSource(await interruptible(() => context.fs.readFile(absolute, { signal: context.signal, ...(Number.isFinite(remaining) ? { maxBytes: remaining } : {}) }), context.signal));
    }
    budget.inputLocation = { name: file === "-" ? "<stdin>" : file, line: 0, complete: false };
    yield convert ? await convert(source) : source;
  }
}
async function fileVariable(context: CommandContext, path: string, raw: boolean, budget: Budget): Promise<Json> {
  const previousLocation = budget.inputLocation;
  try {
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
  } finally {
    budget.inputLocation = previousLocation;
  }
}
function inputs(
  context: CommandContext,
  options: Options,
  budget: Budget,
  convert?: FilterInput,
  onValue?: (value: Json) => Promise<void> | void,
  onChunkEnd?: () => Promise<void> | void,
  hasPendingDiagnostics?: () => boolean,
): AsyncGenerator<Json> {
  if (options.rawInput) {
    return rawValues(inputSources(context, options, budget, convert), budget, options.slurp);
  }
  let source: ByteSource;
  if (!options.files.length && !convert) {
    budget.inputLocation = { name: "<stdin>", line: 0, complete: false };
    source = context.stdin;
  } else {
    async function* joined(): ByteSource {
      for await (const s of inputSources(context, options, budget, convert)) yield* readBytes(s, context.signal);
    }
    source = joined();
  }
  return jsonValues(source, budget, {
    stream: options.stream, streamErrors: options.streamErrors, sequence: options.sequence,
    ...(onValue ? { onValue } : {}),
    ...(onChunkEnd ? { onChunkEnd } : {}),
    ...(hasPendingDiagnostics ? { hasPendingDiagnostics } : {}),
    warning: async message => {
      const bytes = Buffer.byteLength(message) + 5;
      budget.outputBytes += bytes;
      if (budget.outputBytes > budget.limits.maxOutputBytes) throw new JqLimitError("maxOutputBytes");
      await writeDiagnostic(context.stderr, `jq: ${message}\n`, context.signal);
    },
  });
}
export async function executeJq(context: CommandContext, limits: JqLimits, convert?: FilterInput): Promise<{ exitCode: number }> {
  const budget = new Budget(limits, context.signal);
  context.signal.throwIfAborted();
  const diagnostics: { location: InputLocation; message: string }[] = [];
  let diagnosticBytes = 0;
  let diagnosticWriteFailed = false;
  let stdoutWriteFailed = false;
  const OUT_BUF_SIZE = 16 * 1024;
  let outBuf: Uint8Array | null = null;
  let outPos = 0;
  const flushStdout = async (): Promise<void> => {
    if (outPos > 0 && outBuf) {
      const slice = outBuf.subarray(0, outPos);
      outPos = 0;
      try { await writeBytes(context.stdout, slice, context.signal); }
      catch (error) { stdoutWriteFailed = true; throw error; }
    }
  };
  const flush = async (force = false): Promise<void> => {
    if (outPos > 0) await flushStdout();
    if (!diagnostics.length) return;
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
    const optionsOrPromise = argumentsFor(context, budget);
    const options = optionsOrPromise instanceof Promise ? await optionsOrPromise : optionsOrPromise;
    const source = options.programFile === undefined ? options.source! : await readProgram(context, options.programFile, limits);
    let ast: Ast;
    if (!options.moduleDirectories.length && options.variables.size === 0 && !source.includes("$") && budget.limits.maxSourceBytes >= source.length * 4 && budget.limits.maxAstDepth >= 256 && budget.limits.maxSteps >= 1000) {
      let cachedAst = jqAstCache.get(source);
      if (!cachedAst) {
        cachedAst = parse(source, options.variables, budget);
        if (jqAstCache.size < 64) jqAstCache.set(source, cachedAst);
      }
      ast = cachedAst;
    } else if (!options.moduleDirectories.length) {
      ast = parse(source, options.variables, budget);
    } else {
      ast = await compileProgram(context, options, source, budget);
    }
    const interpreter = new Interpreter(budget, options.variables);
    let lastTruth: boolean | undefined;
    let status = 0;
    const suffix = options.rawOutput0 ? "\0" : options.joinOutput ? "" : "\n";
    const isCompactPlain = options.format.indent === "" && !options.format.ascii && !options.format.color && !options.sortKeys && !options.sequence;
    const tryPublishSync = (result: Json): boolean => {
      if (!isCompactPlain || budget.needsYield()) return false;
      if (budget.results + 1 > limits.maxResults) throw new JqLimitError("maxResults");
      const remaining = limits.maxOutputBytes - budget.outputBytes;
      let buf = outBuf;
      if (!buf) buf = outBuf = new Uint8Array(OUT_BUF_SIZE);
      const newPos = tryWriteCompactSync(result, budget, buf, outPos, suffix, Math.max(0, remaining - suffix.length));
      if (newPos >= 0) {
        const chunkLen = newPos - outPos;
        if (chunkLen > remaining) throw new JqLimitError("maxOutputBytes");
        budget.results++;
        budget.outputBytes += chunkLen;
        outPos = newPos;
        return true;
      }
      budget.step();
      budget.value(result);
      const text = tryStringifyCompactSync(result, budget, Math.max(0, remaining - suffix.length), "maxOutputBytes");
      if (text === undefined) return false;
      const chunkLen = text.length + suffix.length;
      if (chunkLen > remaining) throw new JqLimitError("maxOutputBytes");
      if (chunkLen > OUT_BUF_SIZE) return false;
      if (outPos + chunkLen > OUT_BUF_SIZE) return false;
      budget.results++;
      budget.outputBytes += chunkLen;
      let pos = outPos;
      for (let i = 0; i < text.length; i++) buf[pos++] = text.charCodeAt(i);
      for (let i = 0; i < suffix.length; i++) buf[pos++] = suffix.charCodeAt(i);
      outPos = pos;
      return true;
    };
    const publishResult = async (result: Json): Promise<void> => {
      const pt = budget.tickSync();
      if (pt) await pt;
      budget.value(result);
      if (++budget.results > limits.maxResults) throw new JqLimitError("maxResults");
      const remaining = limits.maxOutputBytes - budget.outputBytes;
      const prefix = options.sequence && !(options.raw && typeof result === "string") ? "\x1e" : "";
      const output = options.sortKeys ? await sortObjectKeys(result, budget) : result;
      const rawString = options.raw && typeof output === "string";
      const format = rawString ? { ...options.format, color: false } : options.format;
      const text = rawString && !format.ascii ? output : await stringify(output, budget, format, Math.max(0, remaining - suffix.length - prefix.length), "maxOutputBytes");
      const chunkText = `${prefix}${text}${suffix}`;
      const chunkBuf = Buffer.from(chunkText);
      const byteLen = chunkBuf.byteLength;
      if (byteLen > remaining) throw new JqLimitError("maxOutputBytes");
      budget.outputBytes += byteLen;
      await flushStdout();
      try { await writeBytes(context.stdout, chunkBuf, context.signal); }
      catch (error) { stdoutWriteFailed = true; throw error; }
    };
    const emitSyncOrAsync = (input: Json): Promise<void> | void => {
      if (!diagnostics.length && !options.rawOutput0 && interpreter.run === DEFAULT_INTERPRETER_RUN) {
        const syncResults = interpreter.tryRunSync(ast, input);
        if (syncResults !== undefined) {
          status = options.exitStatus ? lastTruth === undefined ? 4 : lastTruth ? 0 : 1 : 0;
          let invocationLast: Json | undefined;
          let idx = 0;
          while (idx < syncResults.length) {
            const result = syncResults[idx]!;
            if (!tryPublishSync(result)) {
              return (async () => {
                for (; idx < syncResults.length; idx++) {
                  const r = syncResults[idx]!;
                  await publishResult(r);
                  invocationLast = r;
                  status = options.exitStatus ? truth(r) ? 0 : 1 : 0;
                }
                if (status < 2 && invocationLast !== undefined) lastTruth = truth(invocationLast);
                if (diagnostics.length) await flush();
              })();
            }
            invocationLast = result;
            status = options.exitStatus ? truth(result) ? 0 : 1 : 0;
            idx++;
          }
          if (status < 2 && invocationLast !== undefined) lastTruth = truth(invocationLast);
          interpreter.releaseScratch();
          return;
        }
      }
      return emit(input);
    };
    const emit = async (input: Json): Promise<void> => {
      if (diagnostics.length) await flush();
      status = options.exitStatus ? lastTruth === undefined ? 4 : lastTruth ? 0 : 1 : 0;
      let invocationLast: Json | undefined;
      if (!options.rawOutput0 && interpreter.run === DEFAULT_INTERPRETER_RUN) {
        const syncResults = interpreter.tryRunSync(ast, input);
        if (syncResults !== undefined) {
          for (let i = 0; i < syncResults.length; i++) {
            const result = syncResults[i]!;
            if (!tryPublishSync(result)) await publishResult(result);
            invocationLast = result;
            status = options.exitStatus ? truth(result) ? 0 : 1 : 0;
          }
          if (status < 2 && invocationLast !== undefined) lastTruth = truth(invocationLast);
          if (diagnostics.length) await flush();
          return;
        }
      }
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
          await publishResult(result);
          invocationLast = result;
          status = options.exitStatus ? truth(result) ? 0 : 1 : 0;
        }
      } finally { await iterator.return(undefined); }
      if (status < 2 && invocationLast !== undefined) lastTruth = truth(invocationLast);
      if (diagnostics.length) await flush();
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
    } else for await (const value of inputs(context, options, budget, convert, emitSyncOrAsync, flushStdout, () => diagnostics.length > 0)) {
      const p = emitSyncOrAsync(value);
      if (p) await p;
    }
    await flushStdout();
    await flush(true);
    return { exitCode: options.exitStatus && lastTruth === undefined && status === 0 ? 4 : status };
  } catch (error) {
    if (diagnosticWriteFailed) throw error;
    context.signal.throwIfAborted();
    if (stdoutWriteFailed) throw error;
    if (error instanceof JqHalt) {
      await flush(true);
      await writeBytes(context.stderr, Buffer.from(error.stderr), context.signal);
      return { exitCode: error.exitCode };
    }
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
