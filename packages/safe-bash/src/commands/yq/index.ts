import { escapeText } from "../../escaping.js";
import {
  createOutputOperation,
  FsError,
  readBytes,
  resolvePath,
  type ByteSource,
  type CommandContext,
  type CommandDefinition,
  type InvocationCleanup,
  type OutputOperation,
  type VirtualShellPlugin,
} from "../../contracts/index.js";
import { createYqQuerySession, YqValueFailure, type YqQuerySession } from "../structured/query-core.js";
import { JqError, JqLimitError, wellFormed, type Json } from "../structured/limits.js";
import { YqLedger, yqCaps } from "./accounting.js";
import { encodeJson, encodeRaw, encodeYaml } from "./encoder.js";
import { fromJqLimit, YqError, type YqCode } from "./errors.js";
import { parseYamlDocuments } from "./parser.js";

const help = "virtual-bash restricted YAML profile\nusage: yq [eval|e] [OPTION ...] [--] [FILTER [FILE ...]]\n       yq [eval|e] --help\n       yq [eval|e] --version\noptions:\n  -o, --output-format FORMAT  FORMAT is yaml or json\n      --output-format=FORMAT  same as above\n  -c, --compact-output       compact JSON; requires -o json\n  -r, --unwrapScalar         raw strings; requires -o json\n  -h, --help                 show this help (sole argument)\n      --version              show profile identity (sole argument)\n";
const version = "virtual-bash restricted YAML profile\n";
const diagnosticFallback = "yq: limit: DIAGNOSTIC_TRUNCATED\n";

interface ParsedArguments {
  readonly format: "yaml" | "json";
  readonly explicitJson: boolean;
  readonly compact: boolean;
  readonly raw: boolean;
  readonly filter: string;
  readonly files: readonly string[];
}

interface InputFrame {
  readonly bytes: Uint8Array;
  readonly rawBytes: number;
  readonly lineOffset: number;
}

interface FrameRange {
  readonly start: number;
  readonly end: number;
  readonly lineOffset: number;
}

class RawDocumentFramer {
  readonly #ranges: FrameRange[] = [];
  #offset = 0;
  #frameStart = 0;
  #frameLine = 0;
  #lineStart = 0;
  #lineNumber = 0;
  #line = "";
  #pendingCr = false;
  #frameBytes = 0;
  #lineBytes = 0;
  #lineCouldBeMarker = true;
  #markerComment = false;
  #hasContent = false;

  admit(chunk: Uint8Array): void {
    for (const byte of chunk) {
      this.#offset++;
      this.#lineBytes++;
      if (this.#lineBytes > yqCaps.maxDocumentBytes) throw new YqError("limit", "LIMIT_MAX_DOCUMENT_BYTES", 5);
      if (this.#pendingCr) {
        this.#pendingCr = false;
        if (byte === 0x0a) {
          this.#line += "\n";
          this.#finishLine(this.#offset);
          continue;
        }
        this.#finishLine(this.#offset - 1);
      }
      if (!this.#markerComment && (this.#line.length <= 8 || /^(?:---|\.\.\.)[ \t]+#/u.test(this.#line))) {
        this.#line += String.fromCharCode(byte);
      }
      if (/^(?:---|\.\.\.)[ \t]+#/u.test(this.#line)) this.#markerComment = true;
      const candidate = this.#line.replace(/[\r\n]+$/u, "");
      this.#lineCouldBeMarker = /^(?:-{0,3}|\.{0,3})$/u.test(candidate)
        || /^(?:---|\.\.\.)(?:[ \t]*|[ \t]+#.*)$/u.test(candidate);
      if (!this.#lineCouldBeMarker && this.#lineBytes > yqCaps.maxDocumentBytes - this.#frameBytes) {
        throw new YqError("limit", "LIMIT_MAX_DOCUMENT_BYTES", 5);
      }
      if (byte === 0x0d) this.#pendingCr = true;
      else if (byte === 0x0a) this.#finishLine(this.#offset);
    }
  }

  finish(bytes: Uint8Array): InputFrame[] {
    if (this.#line !== "") {
      this.#pendingCr = false;
      this.#finishLine(this.#offset);
    }
    if (this.#frameStart < this.#offset) this.#ranges.push({ start: this.#frameStart, end: this.#offset, lineOffset: this.#frameLine });
    return this.#ranges.map(range => ({
      bytes: bytes.subarray(range.start, range.end),
      rawBytes: range.end - range.start,
      lineOffset: range.lineOffset,
    }));
  }

  #finishLine(end: number): void {
    const line = this.#line.replace(/[\r\n]+$/u, "");
    const marker = /^---(?:[ \t]+#.*)?$/u.test(line);
    const endMarker = /^\.\.\.(?:[ \t]+#.*)?$/u.test(line);
    if (marker && this.#hasContent && this.#lineStart > this.#frameStart) {
      this.#ranges.push({ start: this.#frameStart, end: this.#lineStart, lineOffset: this.#frameLine });
      this.#frameStart = this.#lineStart;
      this.#frameLine = this.#lineNumber;
      this.#frameBytes = this.#lineBytes;
      this.#hasContent = false;
    } else {
      if (this.#lineBytes > yqCaps.maxDocumentBytes - this.#frameBytes) throw new YqError("limit", "LIMIT_MAX_DOCUMENT_BYTES", 5);
      this.#frameBytes += this.#lineBytes;
    }
    const visible = line.replace(/^\ufeff/u, "").trimStart();
    if (visible !== "" && !visible.startsWith("#") && !visible.startsWith("%") && !marker && !endMarker) this.#hasContent = true;
    if (endMarker && this.#frameStart < end) {
      this.#ranges.push({ start: this.#frameStart, end, lineOffset: this.#frameLine });
      this.#frameStart = end;
      this.#frameLine = this.#lineNumber + 1;
      this.#frameBytes = 0;
      this.#hasContent = false;
    }
    this.#line = "";
    this.#lineBytes = 0;
    this.#lineCouldBeMarker = true;
    this.#markerComment = false;
    this.#lineStart = end;
    this.#lineNumber++;
  }
}

class SinkFailure {
  constructor(readonly reason: unknown) {}
}

class InvocationOwner {
  #accepting = true;
  #callbacks: InvocationCleanup[] = [];
  #closePromise: Promise<void> | undefined;

  assertOpen(signal: AbortSignal): void {
    if (signal.aborted) throw signal.reason;
    if (!this.#accepting) throw new Error("yq invocation is closed");
  }

  register(cleanup: InvocationCleanup): void {
    if (!this.#accepting) throw new Error("yq invocation is closed");
    if (typeof cleanup !== "function") throw new TypeError("cleanup must be callable");
    this.#callbacks.push(cleanup);
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#accepting = false;
    this.#closePromise = (async (): Promise<void> => {
      const results = await Promise.allSettled(this.#callbacks.map(async cleanup => cleanup()));
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map(result => result.reason);
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "yq invocation cleanup failed");
    })();
    void this.#closePromise.catch(() => {});
    return this.#closePromise;
  }
}

function cli(code: YqCode): YqError {
  return new YqError("cli", code, 2);
}

function preflightArguments(args: readonly string[]): void {
  if (args.length > yqCaps.maxArgvEntries) throw cli("CLI_ARGV_ENTRIES_LIMIT");
  let bytes = 0;
  for (const argument of args) {
    if (!wellFormed(argument)) throw cli("CLI_INVALID_UNICODE");
    const incoming = Buffer.byteLength(argument);
    if (incoming > yqCaps.maxArgvUtf8Bytes - bytes) throw cli("CLI_ARGV_BYTES_LIMIT");
    bytes += incoming;
  }
}

function isInformationForm(args: readonly string[]): "help" | "version" | undefined {
  const offset = args[0] === "eval" || args[0] === "e" ? 1 : 0;
  if (args.length !== offset + 1) return undefined;
  const token = args[offset];
  if (token === "-h" || token === "--help") return "help";
  if (token === "--version") return "version";
  return undefined;
}

function parseArguments(args: readonly string[]): ParsedArguments {
  let index = args[0] === "eval" || args[0] === "e" ? 1 : 0;
  if (args[0] === "eval-all" || args[0] === "ea") throw cli("CLI_UNSUPPORTED_COMMAND");
  let ended = false;
  let format: "yaml" | "json" = "yaml";
  let explicitJson = false;
  let formatSeen = false;
  let compact = false;
  let compactSeen = false;
  let raw = false;
  let rawSeen = false;
  const operands: string[] = [];
  const refused = /^(?:-s|-n|-p|-i|--slurp|--null-input|--input-format|--yaml-schema|--schema|--json-schema|--failsafe-schema|--inplace|--in-place|--allow-lossy-write|--write|--split-exp|--front-matter|--xml|--properties|--color-output)(?:=.*)?$/u;
  for (; index < args.length; index++) {
    const argument = args[index]!;
    if (!ended && argument === "--") {
      ended = true;
      continue;
    }
    if (!ended && (argument === "-o" || argument === "--output-format")) {
      if (formatSeen) throw cli("CLI_DUPLICATE_OPTION");
      const value = args[++index];
      if (value === undefined) throw cli("CLI_MISSING_OPTION_VALUE");
      if (value !== "yaml" && value !== "json") throw cli("CLI_INVALID_OPTION_VALUE");
      formatSeen = true;
      format = value;
      explicitJson = value === "json";
      continue;
    }
    if (!ended && argument.startsWith("--output-format=")) {
      if (formatSeen) throw cli("CLI_DUPLICATE_OPTION");
      const value = argument.slice("--output-format=".length);
      if (value === "") throw cli("CLI_MISSING_OPTION_VALUE");
      if (value !== "yaml" && value !== "json") throw cli("CLI_INVALID_OPTION_VALUE");
      formatSeen = true;
      format = value;
      explicitJson = value === "json";
      continue;
    }
    if (!ended && (argument === "-c" || argument === "--compact-output")) {
      if (compactSeen) throw cli("CLI_DUPLICATE_OPTION");
      compactSeen = true;
      compact = true;
      continue;
    }
    if (!ended && (argument === "-r" || argument === "--unwrapScalar")) {
      if (rawSeen) throw cli("CLI_DUPLICATE_OPTION");
      rawSeen = true;
      raw = true;
      continue;
    }
    if (!ended && refused.test(argument)) throw cli("CLI_UNSUPPORTED_OPTION");
    if (!ended && argument.startsWith("-") && argument !== "-") throw cli("CLI_UNKNOWN_OPTION");
    operands.push(argument);
  }
  if ((compact || raw) && !explicitJson) throw cli("CLI_INCOMPATIBLE_OPTIONS");
  const filter = operands[0] ?? ".";
  const files = operands.slice(1);
  let stdinSeen = false;
  for (const file of files) {
    if (file === "-") {
      if (stdinSeen) throw cli("CLI_DUPLICATE_STDIN");
      stdinSeen = true;
    } else if (Buffer.byteLength(file) > yqCaps.maxVfsOperandPathBytes) throw cli("CLI_VFS_OPERAND_LIMIT");
  }
  return { format, explicitJson, compact, raw, filter, files };
}

function displayedSource(source: string): string {
  if (source === "<stdin>") return source;
  const parts: string[] = ['"'];
  let bytes = 2;
  let truncated = false;
  for (const character of source) {
    const encoded = escapeText(JSON.stringify(character).slice(1, -1), "diagnostic");
    const incoming = Buffer.byteLength(encoded);
    if (incoming > yqCaps.maxDisplayedFilenameBytes - bytes) {
      truncated = true;
      break;
    }
    parts.push(encoded);
    bytes += incoming;
  }
  if (truncated) {
    while (parts.length > 1 && Buffer.byteLength(parts.join("")) + 4 > yqCaps.maxDisplayedFilenameBytes) parts.pop();
    parts.push("...");
  }
  parts.push('"');
  return parts.join("");
}

function diagnostic(error: YqError): string {
  let location = "";
  if (error.source !== undefined) {
    location = ` at ${displayedSource(error.source)}`;
    if (error.line !== undefined && error.column !== undefined) location += `:${error.line}:${error.column}`;
  }
  return `yq: ${error.category}: ${error.code}${location}\n`;
}

function classifyValueFailure(error: YqValueFailure): YqError {
  const category = error.code.startsWith("ENCODE_") ? "encode" : "schema";
  return new YqError(category, error.code, 5);
}

function withSource(error: YqError, source: string): YqError {
  if (error.source !== undefined) return error;
  return new YqError(error.category, error.code, error.status, source, error.line, error.column);
}

async function collectSource(
  context: CommandContext,
  owner: InvocationOwner,
  session: YqQuerySession,
  sourceName: string,
  source: ByteSource,
  vfs: boolean,
): Promise<InputFrame[]> {
  let iterator: AsyncIterator<Uint8Array> | undefined;
  let returned: Promise<unknown> | undefined;
  owner.register(async () => {
    if (iterator?.return) {
      returned ??= Promise.resolve().then(() => iterator!.return!());
      await returned;
    }
  });
  iterator = readBytes(source, context.signal)[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  const framer = new RawDocumentFramer();
  let size = 0;
  while (true) {
    let next: IteratorResult<Uint8Array>;
    try {
      next = await iterator.next();
    } catch (failure) {
      if (context.signal.aborted) throw context.signal.reason;
      if (vfs && failure instanceof FsError) throw new YqError("vfs", "VFS_INPUT_READ", 2, sourceName);
      throw failure;
    }
    owner.assertOpen(context.signal);
    if (next.done) break;
    const chunk = next.value;
    session.ownedWork.admitInputBytes(chunk.byteLength);
    if (chunk.byteLength > yqCaps.maxInputBytes - size) throw fromJqLimit(new JqLimitError("maxInputBytes"));
    framer.admit(chunk);
    const owned = new Uint8Array(chunk);
    owner.assertOpen(context.signal);
    chunks.push(owned);
    size += owned.byteLength;
  }
  owner.assertOpen(context.signal);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  owner.assertOpen(context.signal);
  return framer.finish(bytes);
}

async function sourceFrames(
  context: CommandContext,
  owner: InvocationOwner,
  session: YqQuerySession,
  sourceName: string,
): Promise<InputFrame[]> {
  if (sourceName === "-") return collectSource(context, owner, session, "<stdin>", context.stdin, false);
  const path = resolvePath(context.cwd, sourceName);
  if (context.fs.readStream) {
    let source: ByteSource;
    try { source = context.fs.readStream(path, { signal: context.signal }); }
    catch (failure) {
      if (context.signal.aborted) throw context.signal.reason;
      if (failure instanceof FsError) throw new YqError("vfs", "VFS_INPUT_OPEN", 2, sourceName);
      throw failure;
    }
    return collectSource(context, owner, session, sourceName, source, true);
  }
  let bytes: Uint8Array;
  try {
    bytes = await context.fs.readFile(path, { signal: context.signal, maxBytes: yqCaps.maxInputBytes });
  } catch (failure) {
    if (context.signal.aborted) throw context.signal.reason;
    if (failure instanceof FsError) throw new YqError("vfs", "VFS_INPUT_READ", 2, sourceName);
    throw failure;
  }
  owner.assertOpen(context.signal);
  session.ownedWork.admitInputBytes(bytes.byteLength);
  const framer = new RawDocumentFramer();
  framer.admit(bytes);
  const owned = new Uint8Array(bytes);
  owner.assertOpen(context.signal);
  return framer.finish(owned);
}

function decodeDocument(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes); }
  catch { throw new YqError("input", "INPUT_INVALID_UTF8", 5); }
}

async function writeOperation(
  operation: OutputOperation,
  bytes: Uint8Array,
  owner: InvocationOwner,
  callerSignal: AbortSignal,
): Promise<void> {
  owner.assertOpen(callerSignal);
  try { await operation.output.write(bytes); }
  catch (failure) { throw new SinkFailure(failure); }
  owner.assertOpen(callerSignal);
}

async function runCommand(context: CommandContext, owner: InvocationOwner): Promise<{ exitCode: number }> {
  const ledger = new YqLedger();
  let session: YqQuerySession | undefined;
  let stdout: OutputOperation | undefined;
  let stderr: OutputOperation | undefined;
  const stdoutOperation = (): OutputOperation => {
    stdout ??= createOutputOperation({ signal: context.signal, registerCleanup: cleanup => owner.register(cleanup) }, context.stdout);
    return stdout;
  };
  const stderrOperation = (): OutputOperation => {
    stderr ??= createOutputOperation({ signal: context.signal, registerCleanup: cleanup => owner.register(cleanup) }, context.stderr);
    return stderr;
  };
  const emitDiagnostic = async (error: YqError): Promise<void> => {
    const preferred = Buffer.from(diagnostic(error));
    const fallback = Buffer.from(diagnosticFallback);
    const selected = ledger.canAdmitDiagnostic(preferred.byteLength) ? preferred : ledger.canAdmitDiagnostic(fallback.byteLength) ? fallback : undefined;
    if (!selected) return;
    ledger.admitDiagnostic(selected.byteLength);
    session?.ownedWork.admitOutputBytes(selected.byteLength);
    await writeOperation(stderrOperation(), selected, owner, context.signal);
  };
  try {
    preflightArguments(context.args);
    const info = isInformationForm(context.args);
    if (context.args.some(argument => argument === "-h" || argument === "--help" || argument === "--version") && info === undefined) {
      throw cli("CLI_INFO_COMBINATION");
    }
    if (info) {
      const bytes = Buffer.from(info === "help" ? help : version);
      ledger.admitStdout(bytes.byteLength);
      await writeOperation(stdoutOperation(), bytes, owner, context.signal);
      return { exitCode: 0 };
    }
    const options = parseArguments(context.args);
    if (Buffer.byteLength(options.filter) > yqCaps.maxQuerySourceBytes) throw new YqError("limit", "LIMIT_MAX_QUERY_SOURCE_BYTES", 5);
    owner.register(async () => session?.close());
    session = createYqQuerySession({ signal: context.signal });
    try { session.compileOnce(options.filter); }
    catch (failure) {
      if (failure instanceof JqLimitError) throw fromJqLimit(failure);
      if (failure instanceof JqError) throw new YqError("query", "QUERY_COMPILE_FAILED", 3);
      throw failure;
    }
    const files = options.files.length > 0 ? options.files : ["-"];
    let emitted = 0;
    for (const file of files) {
      const sourceName = file === "-" ? "<stdin>" : file;
      let frames: InputFrame[];
      try { frames = await sourceFrames(context, owner, session, file); }
      catch (failure) { throw failure instanceof YqError ? withSource(failure, sourceName) : failure; }
      owner.assertOpen(context.signal);
      for (const frame of frames) {
        ledger.admitDocumentBytes(frame.rawBytes);
        let input: string;
        try { input = decodeDocument(frame.bytes); }
        catch (failure) { throw failure instanceof YqError ? withSource(failure, sourceName) : failure; }
        owner.assertOpen(context.signal);
        const documents = parseYamlDocuments(input, session.ownedWork, ledger, frame.rawBytes, frame.lineOffset);
        try {
        for await (const document of documents) {
        owner.assertOpen(context.signal);
        try { await session.ownedWork.measure(document); }
        catch (failure) {
          if (failure instanceof JqLimitError) throw fromJqLimit(failure);
          if (failure instanceof YqValueFailure) throw classifyValueFailure(failure);
          throw failure;
        }
        owner.assertOpen(context.signal);
        const iterator = session.run(document);
        try {
          while (true) {
            let next: IteratorResult<Json>;
            try { next = await iterator.next(); }
            catch (failure) {
              if (context.signal.aborted) throw context.signal.reason;
              if (failure instanceof JqLimitError) throw fromJqLimit(failure);
              if (failure instanceof JqError) throw new YqError("query", "QUERY_RUNTIME_FAILED", 5, sourceName);
              throw failure;
            }
            owner.assertOpen(context.signal);
            if (next.done) break;
            try { await session.ownedWork.measure(next.value); }
            catch (failure) {
              if (failure instanceof JqLimitError) throw fromJqLimit(failure);
              if (failure instanceof YqValueFailure) throw classifyValueFailure(failure);
              throw failure;
            }
            owner.assertOpen(context.signal);
            session.ownedWork.admitResult();
            const separator = emitted === 0 || options.format === "json" ? "" : "---\n";
            const suffixBytes = Buffer.byteLength(separator) + 1;
            const remaining = yqCaps.stdoutCapBytes - ledger.stdoutBytes;
            if (suffixBytes > remaining) throw new YqError("limit", "LIMIT_MAX_OUTPUT_BYTES", 5, sourceName);
            let encoded: string;
            try {
              encoded = options.format === "yaml"
                ? await encodeYaml(next.value, session.ownedWork, remaining - suffixBytes)
                : options.raw && typeof next.value === "string"
                  ? await encodeRaw(next.value, session.ownedWork, remaining - 1)
                  : await encodeJson(next.value, session.ownedWork, !options.compact, remaining - 1);
            } catch (failure) {
              if (failure instanceof JqLimitError) throw fromJqLimit(failure);
              if (failure instanceof YqValueFailure) throw classifyValueFailure(failure);
              throw failure;
            }
            owner.assertOpen(context.signal);
            const encodedBytes = Buffer.byteLength(encoded);
            const outputBytes = encodedBytes + suffixBytes;
            ledger.admitStdout(outputBytes);
            session.ownedWork.admitOutputBytes(outputBytes);
            owner.assertOpen(context.signal);
            const output = Buffer.allocUnsafe(outputBytes);
            let offset = 0;
            if (separator !== "") offset += output.write(separator, offset, "utf8");
            offset += output.write(encoded, offset, "utf8");
            output[offset] = 0x0a;
            owner.assertOpen(context.signal);
            await writeOperation(stdoutOperation(), output, owner, context.signal);
            emitted++;
          }
        } finally {
          await iterator.return(undefined);
          owner.assertOpen(context.signal);
        }
        }
        } catch (failure) {
          throw failure instanceof YqError ? withSource(failure, sourceName) : failure;
        }
      }
    }
    return { exitCode: 0 };
  } catch (failure) {
    if (context.signal.aborted) throw context.signal.reason;
    if (failure instanceof SinkFailure) throw failure.reason;
    let normal: YqError | undefined;
    if (failure instanceof YqError) normal = failure;
    else if (failure instanceof JqLimitError) normal = fromJqLimit(failure);
    else if (failure instanceof YqValueFailure) normal = classifyValueFailure(failure);
    if (!normal) throw failure;
    await emitDiagnostic(normal);
    return { exitCode: normal.status };
  }
}

async function execute(context: CommandContext): Promise<{ exitCode: number }> {
  const owner = new InvocationOwner();
  context.registerCleanup?.(() => owner.close());
  let result: { exitCode: number } | undefined;
  let primary: unknown;
  let hasPrimary = false;
  try {
    result = await runCommand(context, owner);
  } catch (failure) {
    primary = failure;
    hasPrimary = true;
  }
  let cleanup: unknown;
  let hasCleanup = false;
  try { await owner.close(); }
  catch (failure) {
    cleanup = failure;
    hasCleanup = true;
  }
  if (context.signal.aborted) throw context.signal.reason;
  if (hasPrimary) throw primary;
  if (hasCleanup) throw cleanup;
  return result!;
}

export interface YqCommandsOptions {
  readonly replace?: boolean;
}

export function createYqCommand(): CommandDefinition {
  return Object.freeze({
    name: "yq",
    description: "Bounded restricted YAML query and formatter",
    execute,
  });
}

export function createYqCommands(): readonly CommandDefinition[] {
  return Object.freeze([createYqCommand()]);
}

export function yqCommands(options: YqCommandsOptions = {}): VirtualShellPlugin {
  if (typeof options !== "object" || options === null) throw new TypeError("options must be an object");
  const keys = Object.keys(options);
  if (keys.some(key => key !== "replace")) throw new TypeError("unsupported yq option");
  const replace = options.replace;
  if (replace !== undefined && typeof replace !== "boolean") throw new TypeError("replace must be a boolean");
  const definitions = createYqCommands();
  const plugin: VirtualShellPlugin = {
    name: "yq-commands",
    setup(host) {
      if (!replace) for (const definition of definitions) {
        if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
      }
      for (const definition of definitions) host.commands.register(definition, { replace: replace ?? false });
    },
  };
  return Object.freeze(plugin);
}
