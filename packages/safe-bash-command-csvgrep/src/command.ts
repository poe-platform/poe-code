import {
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition
} from "safe-bash-contracts/command";
import { shellValueByteLength } from "safe-bash-contracts/value";
import { FsError } from "safe-bash-contracts/errors";
import { readBytes, writeBytes, type ByteSource } from "safe-bash-contracts/io";
import { createOutputOperation, type OutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import {
  CsvBudget,
  CsvError,
  CsvParser,
  generatedHeaders,
  selectColumns,
  serializeRow,
  type CsvDialect,
  type CsvLimits,
  type CsvRow
} from "safe-bash-csv-engine";
import { createMatcher, matchesRow, pythonRstrip, pythonWhitespace, type MatchOptions } from "./match.js";
const bytePrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteExtent = Object.getOwnPropertyDescriptor(bytePrototype, "byteLength")!.get!;
const byteBuffer = Object.getOwnPropertyDescriptor(bytePrototype, "buffer")!.get!;
const byteOffset = Object.getOwnPropertyDescriptor(bytePrototype, "byteOffset")!.get!;
export interface CsvgrepOptions extends MatchOptions {
  columns?: string;
  any?: boolean;
  invert?: boolean;
  zero?: boolean;
  headerless?: boolean;
  lineNumbers?: boolean;
  names?: boolean;
  dialect?: CsvDialect;
  filePath?: string;
}
export interface CsvgrepCommandOptions {
  limits?: Partial<CsvLimits>;
  replace?: boolean;
}
export interface CsvgrepResult {
  readonly exitCode: number;
  readonly accounting: Readonly<CsvBudget["accounting"]>;
}
export function parseCsvgrepArguments(args: readonly string[], b: CsvBudget): CsvgrepOptions {
  const options: CsvgrepOptions = {},
    dialect: CsvDialect = {};
  let operand = false,
    ended = false;
  const boolean: Record<string, keyof CsvgrepOptions> = {
    "-a": "any",
    "--any-match": "any",
    "-i": "invert",
    "--invert-match": "invert",
    "--zero": "zero",
    "-H": "headerless",
    "--no-header-row": "headerless",
    "-l": "lineNumbers",
    "--linenumbers": "lineNumbers",
    "-n": "names",
    "--names": "names"
  };
  const string: Record<string, keyof CsvgrepOptions> = {
    "-c": "columns",
    "--columns": "columns",
    "-r": "regex",
    "--regex": "regex",
    "-m": "match",
    "--match": "match",
    "-f": "file",
    "--file": "file"
  };
  let shortOffset = 1;
  for (let i = 0; i < args.length; i++) {
    b.charge("work", 1);
    const raw = args[i]!;
    const equals = !ended && raw.startsWith("--") ? raw.indexOf("=") : -1;
    const short = !ended && raw.startsWith("-") && !raw.startsWith("--") && raw.length > 1;
    const arg = short ? `-${raw[shortOffset]}` : equals < 0 ? raw : raw.slice(0, equals);
    const groupedBoolean = short &&
      (Object.hasOwn(boolean, arg) || ["-t", "-b", "-S"].includes(arg));
    const valueStart = shortOffset + 1;
    // Walk grouped flags without copying the remaining token for each flag.
    if (groupedBoolean && valueStart < raw.length) {
      shortOffset++;
      i--;
    } else shortOffset = 1;
    const attached = short && !groupedBoolean && valueStart < raw.length;
    if (attached) {
      b.charge("work", raw.length - valueStart);
      b.charge("retainedBytes", (raw.length - valueStart) * 2);
    }
    const inline = attached ? raw.slice(valueStart) : equals < 0 ? undefined : raw.slice(equals + 1);
    const isBoolean = Object.hasOwn(boolean, arg),
      isString = Object.hasOwn(string, arg);
    if (
      inline !== undefined &&
      (isBoolean || ["--tabs", "--no-doublequote", "--skipinitialspace"].includes(arg))
    )
      throw new CsvError("ARGUMENT", `${arg} does not accept a value`);
    if (arg === "--" && !ended) {
      ended = true;
      continue;
    }
    if (!ended && isBoolean) {
      Object.assign(options, { [boolean[arg]!]: true });
      continue;
    }
    if (
      !ended &&
      (isString ||
        [
          "-d",
          "--delimiter",
          "-q",
          "--quotechar",
          "-p",
          "--escapechar",
          "-e",
          "--encoding",
          "-K",
          "--skip-lines",
          "-u",
          "--quoting",
          "-z",
          "--maxfieldsize"
        ].includes(arg))
    ) {
      const value = inline ?? args[++i];
      if (value === undefined || (inline === undefined && value.startsWith("-") && value !== "-"))
        throw new CsvError("ARGUMENT", `Expected a value for ${arg}`);
      if (isString) Object.assign(options, { [string[arg]!]: value });
      else if (arg === "-d" || arg === "--delimiter") dialect.delimiter = value;
      else if (arg === "-q" || arg === "--quotechar") dialect.quote = value;
      else if (arg === "-p" || arg === "--escapechar") dialect.escape = value;
      else if (arg === "-e" || arg === "--encoding") {
        if (!["utf-8-sig", "utf8-sig"].includes(value.toLowerCase()))
          throw new CsvError("UNSUPPORTED", "Only utf-8-sig decoding is qualified");
      } else if (arg === "-K" || arg === "--skip-lines") {
        let start = 0,
          end = value.length;
        while (start < end && pythonWhitespace(value.charCodeAt(start))) {
          b.charge("work", 1);
          start++;
        }
        while (end > start && pythonWhitespace(value.charCodeAt(end - 1))) {
          b.charge("work", 1);
          end--;
        }
        if (value[start] === "+") start++;
        let count = 0,
          digit = false;
        for (let at = start; at < end; at++) {
          b.charge("work", 1);
          const code = value.charCodeAt(at);
          if (code === 95 && digit && at + 1 < end) {
            digit = false;
            continue;
          }
          if (code < 48 || code > 57)
            throw new CsvError("ARGUMENT", "Invalid skip-lines value");
          count = count * 10 + (code - 48);
          if (!Number.isSafeInteger(count))
            throw new CsvError("ARGUMENT", "Invalid skip-lines value");
          digit = true;
        }
        if (!digit)
          throw new CsvError("ARGUMENT", "Invalid skip-lines value");
        dialect.skipLines = count;
      } else if (arg === "-u" || arg === "--quoting") {
        if (!["0", "1", "2", "3"].includes(value))
          throw new CsvError("ARGUMENT", "Invalid quoting value");
        if (value === "1" || value === "2")
          throw new CsvError("UNSUPPORTED", "Quoting modes 1 and 2 are not qualified");
        dialect.quoting = Number(value) as 0 | 3;
      } else
        throw new CsvError(
          "UNSUPPORTED",
          "Use invocation fieldBytes limits; native character field limits are unqualified"
        );
      continue;
    }
    if (!ended && (arg === "-t" || arg === "--tabs")) {
      dialect.tabs = true;
      continue;
    }
    if (!ended && (arg === "-b" || arg === "--no-doublequote")) {
      dialect.doubleQuote = false;
      continue;
    }
    if (!ended && (arg === "-S" || arg === "--skipinitialspace")) {
      dialect.skipInitialSpace = true;
      continue;
    }
    if (!ended && arg.startsWith("-") && arg !== "-")
      throw new CsvError("ARGUMENT", `Unsupported option ${arg}`);
    if (operand) throw new CsvError("ARGUMENT", "Only one CSV operand is accepted");
    options.filePath = arg;
    operand = true;
  }
  options.dialect = dialect;
  return options;
}
export async function csvgrep(
  context: CommandContext,
  invocation?: CsvgrepOptions,
  configuration: CsvgrepCommandOptions = {}
): Promise<CsvgrepResult> {
  const controller = new AbortController(),
    signal = controller.signal;
  const limits = Object.freeze({ ...configuration.limits });
  let accepting = true,
    closing: Promise<void> | undefined;
  let stdout: OutputOperation | undefined, stderr: OutputOperation | undefined;
  const abort = (): void => controller.abort(context.signal.reason);
  const cleanup = (): Promise<void> => {
    if (closing) return closing;
    accepting = false;
    controller.abort(new Error("csvgrep invocation closed"));
    closing = Promise.resolve().then(async () => {
      if (task) await task.catch(() => {});
      const results = await Promise.allSettled([stdout?.close(), stderr?.close()]);
      context.signal.removeEventListener("abort", abort);
      const failures = results.filter((r) => r.status === "rejected").map((r) => r.reason);
      if (failures.length) throw new AggregateError(failures, "csvgrep cleanup failed");
    });
    return closing;
  };
  context.registerCleanup?.(cleanup);
  // Snapshot SDK primitives synchronously, before the first asynchronous boundary.
  const supplied =
    invocation &&
    Object.freeze({ ...invocation, dialect: Object.freeze({ ...invocation.dialect }) });
  const task = Promise.resolve().then(async () => {
    context.signal.throwIfAborted();
    if (!accepting) throw new Error("csvgrep invocation closed");
    context.signal.addEventListener("abort", abort, { once: true });
    if (context.signal.aborted) abort();
    const b = new CsvBudget(limits, signal);
    stdout = createOutputOperation({ signal }, context.stdout);
    stderr = createOutputOperation({ signal }, context.stderr);
    const write = async (text: string, diagnostic = false): Promise<void> => {
      signal.throwIfAborted();
      // Diagnostics are best effort within the same invocation quotas. Never
      // replace an admitted failure status with another reservation failure.
      if (diagnostic && (
        text.length > b.limits.work - b.accounting.work ||
        text.length * 3 > b.limits.retainedBytes - b.accounting.retainedBytes ||
        text.length > b.limits.outputBytes - b.accounting.outputBytes
      )) return;
      b.charge("work", text.length);
      b.charge("retainedBytes", text.length * 3);
      // UTF-16 length is a lower bound for UTF-8; reserve the exact output before writing.
      if (text.length > b.limits.outputBytes - b.accounting.outputBytes)
        throw new CsvError("LIMIT", "outputBytes limit exceeded");
      const bytes = new TextEncoder().encode(text);
      if (diagnostic && bytes.length > b.limits.outputBytes - b.accounting.outputBytes) return;
      b.charge("outputBytes", bytes.length);
      await writeBytes((diagnostic ? stderr! : stdout!).output, bytes, signal);
    };
    const source = (path: string): ByteSource => {
      signal.throwIfAborted();
      if (path.includes("\0")) throw new CsvError("ARGUMENT", "NUL is unavailable in VFS paths");
      if (path === "-") return context.stdin;
      const resolved = path.startsWith("/") ? path : `${context.cwd}/${path}`;
      if (context.fs.readStream) return context.fs.readStream(resolved, { signal });
      return (async function* () {
        const maxBytes = Math.min(
          b.limits.inputBytes - b.accounting.inputBytes,
          b.limits.retainedBytes - b.accounting.retainedBytes
        );
        const bytes = await context.fs.readFile(resolved, { signal, maxBytes });
        signal.throwIfAborted();
        if (bytes.length > maxBytes) throw new CsvError("LIMIT", "VFS read limit exceeded");
        b.charge("retainedBytes", bytes.length);
        yield bytes;
      })();
    };
    // Own the underlying iterator's idempotent return; readBytes cancellation also requests it.
    const consume = async (
      input: ByteSource,
      receive: (bytes: Uint8Array) => Promise<void>,
      stop: () => boolean = () => false
    ): Promise<void> => {
      const producer = input[Symbol.asyncIterator]();
      let returned: Promise<IteratorResult<Uint8Array>> | undefined;
      const close = (): Promise<IteratorResult<Uint8Array>> =>
        (returned ??= Promise.resolve().then(() =>
          producer.return ? producer.return() : { done: true, value: undefined }
        ));
      const reader = readBytes(
        { [Symbol.asyncIterator]: () => ({ next: () => producer.next(), return: close }) },
        signal
      )[Symbol.asyncIterator]();
      let complete = false,
        stopped = false;
      let failure: { error: unknown } | undefined;
      try {
        for (;;) {
          b.charge("work", 1);
          const next = await reader.next();
          signal.throwIfAborted();
          if (next.done) {
            complete = true;
            break;
          }
          // Consume before advancing producer; decoding creates invocation-owned strings.
          const length = byteExtent.call(next.value) as number;
          const buffer = byteBuffer.call(next.value) as ArrayBuffer;
          const origin = byteOffset.call(next.value) as number;
          context.inputBudget?.check(b.accounting.inputBytes + length);
          if (length > b.limits.inputBytes - b.accounting.inputBytes)
            throw new CsvError("LIMIT", "inputBytes limit exceeded");
          for (let offset = 0; offset < length; offset += 4096) {
            await receive(new Uint8Array(buffer, origin + offset, Math.min(4096, length - offset)));
            if (stop()) {
              stopped = true;
              break;
            }
          }
          if (stopped) break;
        }
      } catch (error) {
        failure = { error };
      }
      {
        if (!complete) {
          const results = await Promise.allSettled([reader.return?.(undefined), close()]);
          const errors = results
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason);
          if (errors.length) {
            if (failure)
              throw new AggregateError(
                [failure.error, ...errors],
                "csvgrep input and cleanup failed"
              );
            if (errors.length === 1) throw errors[0];
            throw new AggregateError(errors, "csvgrep input cleanup failed");
          }
        }
      }
      if (failure) throw failure.error;
    };
    try {
      let options: CsvgrepOptions;
      if (supplied) {
        for (const value of [...Object.values(supplied), ...Object.values(supplied.dialect ?? {})])
          if (typeof value === "string") {
            b.charge("argumentBytes", value.length);
            b.text(value);
            b.charge("work", value.length);
            b.charge("retainedBytes", value.length * 3);
            b.charge("argumentBytes", new TextEncoder().encode(value).length - value.length);
          }
        options = supplied;
      } else {
        // Bound text before obtaining the canonical carrier, which may allocate for direct hosts.
        for (const value of context.args) {
          b.charge("argumentBytes", value.length + 1);
          b.text(value);
          b.charge("work", value.length + 1);
        }
        b.charge("retainedBytes", context.args.length * 128 + b.accounting.argumentBytes * 3);
        const carrier = getCommandArguments(context);
        for (let i = 0; i < carrier.values.length; i++) {
          const length = shellValueByteLength(carrier.values[i]!);
          b.charge("argumentBytes", Math.max(0, length - context.args[i]!.length));
          b.charge("retainedBytes", length * 3);
          b.charge("work", length);
          const bytes = carrier.bytes(i)!;
          try {
            new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
          } catch {
            throw new CsvError("ARGUMENT", "Arguments must be valid UTF-8");
          }
        }
        options = parseCsvgrepArguments(context.args, b);
      }
      if (!options.names) {
        if (!options.columns)
          throw new CsvError(
            "ARGUMENT",
            "You must specify at least one column to search using the -c option."
          );
        if (
          options.regex === undefined &&
          options.file === undefined &&
          options.match === undefined
        )
          throw new CsvError(
            "ARGUMENT",
            "One of -r, -m or -f must be specified, unless using the -n option."
          );
      } else if (options.headerless) throw new CsvError("ARGUMENT", "Names requires a header row");
      const parser = new CsvParser(options.dialect ?? {}, b),
        set = new Set<string>();
      if (!options.names && !options.regex && options.file !== undefined) {
        const decoder = new TextDecoder("utf-8", { fatal: true }),
          put = (line: string): void => {
            b.charge("work", line.length + 1);
            b.charge("fieldBytes", line.length * 2);
            const value = pythonRstrip(line);
            b.text(value);
            if (!set.has(value)) {
              b.charge("setEntries", 1);
              b.charge("setBytes", value.length * 2 + 32);
              b.charge("retainedBytes", value.length * 2 + 64);
              set.add(value);
            }
          };
        let line = "",
          cr = false;
        const decoded = async (text: string): Promise<void> => {
          b.charge("decodedBytes", text.length * 2);
          for (const char of text) {
            b.charge("work", 1);
            if (char === "\r" || char === "\n") {
              if (!(char === "\n" && cr)) put(line);
              line = "";
              cr = char === "\r";
            } else {
              cr = false;
              b.charge("fieldBytes", (line.length + char.length) * 2);
              b.charge("retainedBytes", (line.length + char.length) * 2);
              b.charge("work", line.length + char.length);
              line += char;
            }
          }
        };
        await consume(source(options.file), async (bytes) => {
          b.charge("inputBytes", bytes.length);
          b.charge("work", bytes.length);
          b.charge("retainedBytes", bytes.length * 2 + 8);
          let text: string;
          try {
            text = decoder.decode(bytes, { stream: true });
          } catch {
            throw new CsvError("INPUT", "Invalid UTF-8 match file");
          }
          await decoded(text);
        });
        let tail: string;
        try {
          tail = decoder.decode();
        } catch {
          throw new CsvError("INPUT", "Truncated UTF-8 match file");
        }
        await decoded(tail);
        if (line) put(line);
      }
      const matcher = options.names ? undefined : createMatcher(options, set, b);
      let headers: readonly string[] | undefined,
        columns: readonly number[] = [];
      const deliver = async (rows: readonly CsvRow[]): Promise<void> => {
        for (const row of rows) {
          signal.throwIfAborted();
          b.charge("work", 1);
          if (headers === undefined) {
            headers = options.headerless ? generatedHeaders(row.cells.length, b) : row.cells;
            if (options.lineNumbers) {
              b.charge("retainedBytes", headers.length * 8 + 32);
              headers = ["line_numbers", ...headers];
            }
            if (options.names) {
              for (let i = 0; i < headers.length; i++)
                await write(`${i + (options.zero ? 0 : 1)}: ${headers[i]}\n`);
              return;
            }
            columns = selectColumns(options.columns!, headers, options.zero ?? false, b);
            await write(serializeRow(headers, b));
            if (!options.headerless) continue;
          }
          const cells = options.lineNumbers
            ? [String(row.line - (options.headerless ? 0 : 1)), ...row.cells]
            : row.cells;
          if (options.lineNumbers) b.charge("retainedBytes", row.cells.length * 8 + 64);
          if (matchesRow(cells, columns, matcher, options.any ?? false, options.invert ?? false, b))
            await write(serializeRow(cells, b));
        }
      };
      await consume(
        source(options.filePath ?? "-"),
        async (bytes) => {
          await deliver(parser.push(bytes));
        },
        () => Boolean(options.names && headers !== undefined)
      );
      if (!options.names) await deliver(parser.end());
      return { exitCode: 0, accounting: Object.freeze({ ...b.accounting, retainedBytes: 0 }) };
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof CsvError) && !(error instanceof FsError)) throw error;
      await write(`error: ${error.message}\n`, true);
      return {
        exitCode: error instanceof CsvError && error.code === "ARGUMENT" ? 2 : 1,
        accounting: Object.freeze({ ...b.accounting, retainedBytes: 0 })
      };
    } finally {
      b.dispose();
    }
  });
  try {
    return await task;
  } finally {
    try {
      await cleanup();
    } finally {
      context.signal.throwIfAborted();
    }
  }
}
export function createCsvgrepCommand(options: CsvgrepCommandOptions = {}): Omit<
  CommandDefinition,
  "execute"
> & {
  readonly execute: (context: CommandContext) => Promise<CsvgrepResult>;
} {
  const configuration = Object.freeze({ ...options, limits: Object.freeze({ ...options.limits }) });
  return Object.freeze({
    name: "csvgrep",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Filter CSV rows using selected decoded cells",
    execute(context: CommandContext) {
      return csvgrep(context, undefined, configuration);
    }
  });
}
export const csvgrepCommand = createCsvgrepCommand();
export function csvgrepCommands(options: CsvgrepCommandOptions = {}): VirtualShellPlugin {
  const command = createCsvgrepCommand(options),
    replace = options.replace ?? false;
  return {
    name: "csvgrep",
    setup(host) {
      host.commands.register(command, { replace });
    }
  };
}
