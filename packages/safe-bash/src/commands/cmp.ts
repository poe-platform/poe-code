import { FsError, getCommandArguments, isFsError, type ByteSource, type CommandContext, type CommandDefinition, type FileReadHandle, type FileStat } from "../contracts/index.js";
import { yieldTurn } from "../contracts/yield.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { PublicDiagnostic, publicDiagnosticMessage } from "../diagnostics.js";
import { ByteInputBudget } from "./bytes/input-budget.js";
import { bufferLimit, output, pathOf, UsageError } from "./internal.js";
import { inputRequirements } from "./portable-requirements.js";
import { compareCopyIdentity, compareObservedEntries } from "./copy-identity.js";

const blockBytes = 4096;
const maxEmptyChunks = 65536;

function byteCount(text: string, option = "bytes"): number {
  const invalid = (): never => { throw new UsageError(`invalid --${option} value '${text}'`); };
  let position = 0;
  while (text[position] === " " || text.charCodeAt(position) >= 9 && text.charCodeAt(position) <= 13) position++;
  if (text[position] === "+") position++;
  let base = 10;
  if (text[position] === "0") {
    base = 8;
    if (text[position + 1]?.toLowerCase() === "x") { base = 16; position += 2; }
  }
  const start = position;
  let count = 0n;
  const maximum = option === "bytes" ? 18446744073709551615n : 9223372036854775807n;
  while (position < text.length) {
    const digit = "0123456789abcdef".indexOf(text[position]!.toLowerCase());
    if (digit < 0 || digit >= base) break;
    count = count * BigInt(base) + BigInt(digit);
    if (count > maximum) invalid();
    position++;
  }
  const suffix = text.slice(position);
  if (position === start) {
    if (position !== 0 || !"kKMGTPEZY".includes(suffix[0] ?? " ")) invalid();
    count = 1n;
  }
  if (suffix) {
    const power = "KMGTPEZY".indexOf(suffix[0] === "k" ? "K" : suffix[0]!) + 1;
    if (!power || !["", "B", "iB"].includes(suffix.slice(1))) invalid();
    count *= (suffix.endsWith("B") && !suffix.endsWith("iB") ? 1000n : 1024n) ** BigInt(power);
  }
  if (count > maximum) invalid();
  return Number(count);
}

interface CmpOptions {
  names: string[];
  skips: [number, number];
  limit: number;
  silent: boolean;
  verbose: boolean;
  printBytes: boolean;
  information?: "help" | "version";
}

function parse(context: CommandContext): CmpOptions {
  const parsed: CmpOptions = { names: [], skips: [0, 0], limit: Infinity, silent: false, verbose: false, printBytes: false };
  const long: Readonly<Record<string, string>> = { "print-bytes": "b", "print-chars": "c", "ignore-initial": "i", verbose: "l", bytes: "n", silent: "s", quiet: "s", version: "v", help: "help" };
  const operands: string[] = [];
  const argumentsWithBytes = getCommandArguments(context);
  let size = 0;
  const args = context.args.map((_argument, index) => {
    const bytes = argumentsWithBytes.bytes(index)!;
    size += bytes.length;
    if (size > 65536) throw new UsageError("argument limit exceeded");
    return Array.from(bytes, byte => String.fromCharCode(byte)).join("");
  });
  let ended = false;
  const apply = (key: string, argument: string | undefined): void => {
    if (key === "s" || key === "l") {
      if (key === "s" ? parsed.verbose : parsed.silent) throw new UsageError("options -l and -s are incompatible");
      if (key === "s") parsed.silent = true;
      else parsed.verbose = true;
    } else if (key === "b" || key === "c") parsed.printBytes = true;
    else if (key === "n") parsed.limit = Math.min(parsed.limit, byteCount(argument!));
    else if (key === "i") {
      const delimiter = argument!.indexOf(":");
      const first = delimiter < 0 ? argument! : argument!.slice(0, delimiter);
      try { parsed.skips[0] = Math.max(parsed.skips[0], byteCount(first, "ignore-initial")); }
      catch { throw new UsageError(`invalid --ignore-initial value '${argument}'`); }
      parsed.skips[1] = Math.max(parsed.skips[1], delimiter < 0 ? parsed.skips[0] : byteCount(argument!.slice(delimiter + 1), "ignore-initial"));
    } else parsed.information = key === "v" ? "version" : "help";
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (ended || argument === "-" || !argument.startsWith("-")) {
      operands.push(argument);
      if (Object.hasOwn(context.env, "POSIXLY_CORRECT")) ended = true;
    } else if (argument === "--") ended = true;
    else if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = argument.slice(2, equals < 0 ? undefined : equals);
      const matches = Object.keys(long).filter(candidate => candidate.startsWith(name));
      const selected = Object.hasOwn(long, name) ? name : matches[0];
      if (!Object.hasOwn(long, name) && matches.length > 1 && new Set(matches.map(match => long[match])).size > 1) {
        throw new UsageError(`option '${argument}' is ambiguous; possibilities: ${matches.map(match => `'--${match}'`).join(" ")}`);
      }
      if (!selected) throw new UsageError(`unrecognized option '${argument}'`);
      const key = long[selected]!;
      let value: string | undefined;
      if (key === "i" || key === "n") {
        value = equals < 0 ? args[++index] : argument.slice(equals + 1);
        if (value === undefined) throw new UsageError(`option '--${selected}' requires an argument`);
      } else if (equals >= 0) throw new UsageError(`option '--${selected}' doesn't allow an argument`);
      apply(key, value);
    } else {
      for (let offset = 1; offset < argument.length; offset++) {
        const key = argument[offset]!;
        if (!"bcilnsv".includes(key)) throw new UsageError(`invalid option -- '${key}'`);
        let value: string | undefined;
        if (key === "i" || key === "n") {
          value = argument.slice(offset + 1) || args[++index];
          if (value === undefined) throw new UsageError(`option requires an argument -- '${key}'`);
          offset = argument.length;
        }
        apply(key, value);
        if (parsed.information) return parsed;
      }
    }
    if (parsed.information) return parsed;
  }
  if (!operands.length) throw new UsageError(`missing operand after '${args.at(-1) ?? "cmp"}'`);
  parsed.names = [operands[0]!, operands[1] ?? "-"];
  for (const index of [0, 1] as const) {
    if (operands[index + 2] !== undefined) parsed.skips[index] = Math.max(parsed.skips[index], byteCount(operands[index + 2]!, "ignore-initial"));
  }
  if (operands.length > 4) throw new UsageError(`extra operand '${operands[4]}'`);
  return parsed;
}

class InputError extends PublicDiagnostic {
  constructor(message: string, readonly suppressInSilent: boolean) { super(message); }
}

function inputError(error: unknown, name: string, opening = false): unknown {
  if (!(error instanceof FsError)) return error;
  const messages: Partial<Record<FsError["code"], string>> = {
    EACCES: "Permission denied", EBADF: "Bad file descriptor", EIO: "Input/output error", EISDIR: "Is a directory",
    ELOOP: "Too many levels of symbolic links", ENAMETOOLONG: "File name too long", ENOENT: "No such file or directory",
    ENOTDIR: "Not a directory", ENOTSUP: "Operation not supported", EPERM: "Operation not permitted",
  };
  const detail = messages[error.code];
  return detail ? new InputError(`${name}: ${detail}`, opening) : error;
}

function printByte(byte: number): string {
  const prefix = byte >= 128 ? "M-" : "";
  const character = byte & 127;
  return prefix + (character < 32 ? `^${String.fromCharCode(character + 64)}` : character === 127 ? "^?" : String.fromCharCode(character));
}

async function discardsOutput(context: CommandContext): Promise<boolean> {
  if (!context.stdoutFile) return false;
  const options = { signal: context.signal };
  try {
    const paths = [context.stdoutFile.path, "/dev/null"] as const;
    for (const path of paths) {
      const capabilities = await context.fs.capabilitiesFor?.(path, options) ?? context.fs.capabilities;
      context.signal.throwIfAborted();
      if (capabilities.stat === false) return false;
    }
    const target = await context.fs.stat(paths[0], options);
    const empty = await context.fs.stat(paths[1], options);
    return await compareObservedEntries(context.fs, paths[0], target, context.fs, paths[1], empty, options) === "same";
  } catch (error) {
    context.signal.throwIfAborted();
    if (error instanceof FsError) return false;
    throw error;
  }
}

class Cursor {
  bytes: Uint8Array = new Uint8Array();
  offset = 0;
  size = Infinity;
  stat: FileStat | undefined;
  position = 0;
  private skip = 0;
  private requestBytes = blockBytes;
  private reader: AsyncIterator<Uint8Array> | undefined;
  private iterator: AsyncIterator<Uint8Array> | undefined;
  private source: (() => ByteSource) | undefined;
  private finished = false;
  private retirement: Promise<void> | undefined;
  private handle: FileReadHandle | undefined;
  private acquisition: Promise<FileReadHandle> | undefined;
  private handleClosing: Promise<void> | undefined;
  private readonly operations = new Set<Promise<unknown>>();

  constructor(readonly name: string, private readonly context: CommandContext, private readonly budget: ByteInputBudget,
    private readonly signal: AbortSignal, private readonly chargeChunk: (size: number) => Promise<void>) {}

  async open(limit: number, skip: number): Promise<void> {
    this.signal.throwIfAborted();
    this.skip = skip;
    if (this.name === "-") {
      const input = this.context.stdinInput;
      this.stat = input?.stat;
      this.position = input?.position ?? 0;
      if (this.stat?.type === "file" && Number.isSafeInteger(this.stat.size) && this.stat.size >= 0) this.size = Math.max(0, this.stat.size - this.position - skip);
      this.source = input ? () => ({ [Symbol.asyncIterator]: () => ({ next: () => input.read(this.requestBytes, this.signal) }) }) : () => this.context.stdin;
    }
    else {
      let name: string;
      try { name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(this.name, unit => unit.charCodeAt(0))); }
      catch { throw new FsError("ENOENT"); }
      const path = pathOf(this.context, name);
      const capabilities = await this.context.fs.capabilitiesFor?.(path, { signal: this.signal }) ?? this.context.fs.capabilities;
      this.signal.throwIfAborted();
      assertCommandRequirements({ ...this.context, signal: this.signal }, inputRequirements, ["file"], capabilities);
      let stat: FileStat | undefined;
      if (capabilities.stat !== false) {
        try { stat = await this.context.fs.stat(path, { signal: this.signal }); }
        catch (error) { this.signal.throwIfAborted(); if (!isFsError(error, "ENOTSUP")) throw error; }
      }
      this.signal.throwIfAborted();
      if (stat?.type !== "directory" && capabilities.retainedRead === true && this.context.fs.openReadFile) {
        this.acquisition = this.context.fs.openReadFile(path, { signal: this.signal }).then(handle => { this.handle = handle; return handle; });
        try {
          const handle = await this.acquisition;
          this.signal.throwIfAborted();
          stat = await this.work(() => handle.stat({ signal: this.signal }));
        } catch (error) {
          this.signal.throwIfAborted();
          if (this.handle || !isFsError(error, "ENOTSUP")) throw error;
        }
      }
      if (!this.handle && capabilities.access !== false) {
        try { await this.context.fs.access(path, 4, { signal: this.signal }); }
        catch (error) { this.signal.throwIfAborted(); if (!isFsError(error, "ENOTSUP")) throw error; }
      }
      this.signal.throwIfAborted();
      if (!stat && limit === 0) throw new FsError("ENOTSUP", { path, message: "zero-byte comparison requires metadata admission" });
      this.stat = stat;
      this.position = skip;
      if (stat?.type === "file" && Number.isSafeInteger(stat.size) && stat.size >= 0) this.size = Math.max(0, stat.size - skip);
      if (limit === 0 && (this.handle || Number.isFinite(this.size) || this.skip === 0)) {
        this.skip = 0;
        return;
      }
      if (this.handle) {
        const handle = this.handle;
        let position = Number.isFinite(this.size) ? Math.min(skip, stat!.size) : Math.min(skip, Number.MAX_SAFE_INTEGER);
        this.skip = 0;
        this.source = () => ({ [Symbol.asyncIterator]: () => ({ next: async () => {
          const bytes = await this.work(() => handle.read(position, this.requestBytes, { signal: this.signal }));
          if (!(bytes instanceof Uint8Array) || bytes.length > this.requestBytes) throw new FsError("EIO", { path, message: "invalid retained read size" });
          position += bytes.length;
          return bytes.length ? { done: false, value: bytes } : { done: true, value: undefined };
        } }) });
      } else if (this.context.fs.readStream && capabilities.streamingRead !== false) {
        const start = Number.isFinite(this.size) ? Math.min(skip, stat!.size) : 0;
        if (Number.isFinite(this.size)) this.skip = 0;
        this.source = () => this.context.fs.readStream!(path, { signal: this.signal, chunkSize: Math.min(blockBytes, limit || this.skip),
          ...(start ? { start } : {}),
          ...(limit === Infinity || this.skip ? {} : { endExclusive: Math.min(Number.MAX_SAFE_INTEGER, start + limit) }) });
      } else {
        if (capabilities.read === false) throw new FsError("ENOTSUP", { syscall: "readFile", path });
        const context = this.context;
        const signal = this.signal;
        this.source = () => ({ async *[Symbol.asyncIterator]() {
          yield await context.fs.readFile(path, { signal, maxBytes: bufferLimit });
        } });
      }
    }
  }

  async prepare(): Promise<void> {
    const input = this.name === "-" ? this.context.stdinInput : undefined;
    if (input?.seek) {
      this.signal.throwIfAborted();
      this.position = Math.min(Number.MAX_SAFE_INTEGER, input.position + this.skip);
      if (this.skip) {
        try { await input.seek(this.position, this.signal); }
        catch (error) { throw inputError(error, this.name); }
      }
      this.signal.throwIfAborted();
      this.skip = 0;
      if (this.stat?.type === "file") this.size = Math.max(0, this.stat.size - this.position);
    }
  }

  async fill(remaining: number): Promise<boolean> {
    this.signal.throwIfAborted();
    if (remaining === 0 && this.skip === 0) return false;
    if (!this.reader) {
      try { this.iterator = this.source!()[Symbol.asyncIterator](); }
      catch (error) { throw inputError(error, this.name); }
      this.reader = this.budget.read({ [Symbol.asyncIterator]: () => ({
        next: async () => {
          let result: IteratorResult<Uint8Array>;
          try { result = await this.iterator!.next(); }
          catch (error) { throw inputError(error, this.name); }
          if (result.done) this.finished = true;
          return result;
        },
        return: async () => { await this.retire(); return { done: true, value: undefined }; },
      }) }, this.signal)[Symbol.asyncIterator]();
    }
    while (this.offset === this.bytes.length) {
      this.signal.throwIfAborted();
      if (remaining === 0 && this.skip === 0) return false;
      this.requestBytes = Math.min(blockBytes, this.skip || remaining);
      const item = await this.reader!.next();
      if (item.done) return false;
      await this.chargeChunk(item.value.length);
      this.bytes = new Uint8Array(item.value);
      this.offset = Math.min(this.skip, this.bytes.length);
      this.skip -= this.offset;
    }
    return true;
  }

  private retire(): Promise<void> {
    this.retirement ??= Promise.resolve().then(async () => {
      try { if (!this.finished) await this.iterator?.return?.(); }
      catch (error) { throw inputError(error, this.name); }
    });
    return this.retirement;
  }

  private work<Result>(operation: () => Promise<Result>): Promise<Result> {
    this.signal.throwIfAborted();
    if (this.handleClosing) throw new FsError("EBADF", { path: this.name });
    const pending = Promise.resolve().then(() => {
      this.signal.throwIfAborted();
      return operation();
    });
    this.operations.add(pending);
    void pending.then(() => { this.operations.delete(pending); }, () => { this.operations.delete(pending); });
    return pending;
  }

  async close(): Promise<void> {
    this.handleClosing ??= Promise.resolve().then(async () => {
      await this.acquisition?.catch(() => undefined);
      await Promise.allSettled(this.operations);
      try { await this.handle?.close(); }
      catch (error) { throw inputError(error, this.name); }
    });
    const results = await Promise.allSettled([this.retire(), this.reader?.return?.(), this.handleClosing]);
    this.bytes = new Uint8Array();
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
}

async function compare(context: CommandContext, parsed: CmpOptions): Promise<number> {
  const { names, skips, limit, silent, verbose, printBytes } = parsed;
  const controller = new AbortController();
  const signal = AbortSignal.any([context.signal, controller.signal]);
  const budget = new ByteInputBudget(bufferLimit);
  let chunks = 0;
  let emptyChunks = 0;
  const chargeChunk = async (size: number): Promise<void> => {
    if (size === 0 && ++emptyChunks > maxEmptyChunks) throw new FsError("EFBIG", { message: "cmp empty input chunk limit exceeded" });
    if (++chunks % 64 === 0) await yieldTurn(signal);
  };
  const cursors = names.map(name => new Cursor(name, context, budget, signal, chargeChunk));
  let closing: Promise<void> | undefined;
  const cleanupErrors: unknown[] = [];
  const close = (): Promise<void> => {
    if (!closing) {
      controller.abort(new FsError("EPIPE", { message: "cmp input closed" }));
      closing = Promise.allSettled(cursors.map(cursor => cursor.close())).then(results => {
        for (const result of results) if (result.status === "rejected") cleanupErrors.push(result.reason);
      });
    }
    return closing;
  };
  context.registerCleanup?.(close);
  let duplicateStdinClose = false;
  const run = async (): Promise<number> => {
    assertCommandRequirements({ ...context, signal }, inputRequirements, [names.some(name => name !== "-") ? "file" : "stdin"]);
    const sharedStdin = names.every(name => name === "-");
    if (sharedStdin && (skips[0] === skips[1] || !context.stdinInput?.seek)) return 0;
    for (const index of [0, 1] as const) {
      const cursor = cursors[index]!;
      try { await cursor.open(limit, skips[index]); }
      catch (error) { throw inputError(error, cursor.name, true); }
      if (index === 0 && names[0] === names[1] && skips[0] === skips[1] && cursor.stat) return 0;
    }
    const [left, right] = cursors as [Cursor, Cursor];
    for (const cursor of cursors) await cursor.prepare();
    if (!sharedStdin && left.position === right.position && compareCopyIdentity(left.stat, right.stat) === "same") return 0;
    if (silent && Number.isFinite(left.size) && Number.isFinite(right.size) && left.size !== right.size && Math.min(left.size, right.size) < limit) return 1;
    for (const cursor of cursors) if (cursor.stat?.type === "directory") throw inputError(new FsError("EISDIR"), cursor.name);
    const noStdout = !silent && await discardsOutput(context);
    const known = Math.min(left.size, right.size, limit);
    const width = Number.isFinite(known) ? String(known).length : 19;
    duplicateStdinClose = sharedStdin;
    let compared = 0;
    let newlines = 0;
    let lastByte = -1;
    let different = false;
    let report = "";
    const flush = async (): Promise<void> => {
      if (report) { await output(context, report); report = ""; }
    };
    for (const cursor of cursors) await cursor.fill(0);
    while (compared < limit) {
      const hasLeft = await left.fill(limit - compared);
      const hasRight = await right.fill(limit - compared);
      if (!hasLeft || !hasRight) {
        await flush();
        if (hasLeft === hasRight) return different ? 1 : 0;
        if (!silent) {
          const shorter = hasLeft ? right.name : left.name;
          const detail = compared === 0 ? "which is empty" : `after byte ${compared}${verbose || noStdout ? "" : `, ${lastByte === 10 ? "" : "in "}line ${newlines + (lastByte === 10 ? 0 : 1)}`}`;
          await output({ ...context, stdout: context.stderr }, Uint8Array.from(`cmp: EOF on ${shorter} ${detail}\n`, unit => unit.charCodeAt(0)));
        }
        return 1;
      }
      const count = Math.min(left.bytes.length - left.offset, right.bytes.length - right.offset, limit - compared, blockBytes - compared % blockBytes);
      for (let index = 0; index < count; index++) {
        const leftByte = left.bytes[left.offset++]!;
        const rightByte = right.bytes[right.offset++]!;
        compared++;
        if (leftByte !== rightByte) {
          different = true;
          if (silent || noStdout) return 1;
          if (!verbose) {
            const locale = context.env.LC_ALL || context.env.LC_MESSAGES || context.env.LANG;
            const unit = !printBytes && (!locale || locale === "C" || locale === "POSIX") ? "char" : "byte";
            const detail = printBytes ? ` is ${leftByte.toString(8).padStart(3)} ${printByte(leftByte)} ${rightByte.toString(8).padStart(3)} ${printByte(rightByte)}` : "";
            await output(context, Uint8Array.from(`${left.name} ${right.name} differ: ${unit} ${compared}, line ${newlines + 1}${detail}\n`, character => character.charCodeAt(0)));
            return 1;
          }
          report += `${String(compared).padStart(width)} ${leftByte.toString(8).padStart(3)} ${printBytes ? `${printByte(leftByte).padEnd(4)} ` : ""}${rightByte.toString(8).padStart(3)}${printBytes ? ` ${printByte(rightByte)}` : ""}\n`;
          if (report.length >= 16384) await flush();
        }
        if (leftByte === 10) newlines++;
        lastByte = leftByte;
      }
      if (compared % blockBytes === 0) await yieldTurn(signal);
    }
    await flush();
    return different ? 1 : 0;
  };
  let result: number;
  try { result = await run(); }
  catch (error) { await close(); throw error; }
  await close();
  if (cleanupErrors.length) throw cleanupErrors[0];
  if (duplicateStdinClose) throw inputError(new FsError("EBADF"), "-");
  return result;
}

export function cmpCommand(): CommandDefinition {
  return { name: "cmp", filesystemRequirements: inputRequirements, async execute(context) {
    context.signal.throwIfAborted();
    let silent = false;
    try {
      let argumentBytes = 0;
      for (const argument of context.args) {
        argumentBytes += argument.length;
        if (argumentBytes > 65536 || context.args.length > 4096) throw new UsageError("argument limit exceeded");
      }
      const parsed = parse(context);
      if (parsed.information) {
        await output(context, parsed.information === "version" ? "cmp (virtual-bash)\n" : "Usage: cmp [OPTION]... FILE1 [FILE2 [SKIP1 [SKIP2]]]\nCompare bytes in the virtual filesystem; omitted FILE2 or '-' reads stdin.\n  -s, --silent, --quiet  report status only\n  -l, --verbose         list differing bytes in octal\n  -b, -c, --print-bytes  also display byte characters\n  -i, --ignore-initial=SKIP[:SKIP2]  skip initial bytes\n  -n, --bytes=LIMIT     compare at most LIMIT bytes\n  --help, -v, --version show virtual-bash command information\nInput is bounded to 32 MiB per invocation; empty-chunk and argument limits apply.\n");
        return { exitCode: 0 };
      }
      silent = parsed.silent;
      return { exitCode: await compare(context, parsed) };
    } catch (error) {
      context.signal.throwIfAborted();
      if (!silent || !(error instanceof InputError) || !error.suppressInSilent) {
        const message = publicDiagnosticMessage(error, context.onInternalError);
        const diagnostic = `cmp: ${message}\n${error instanceof UsageError ? "cmp: Try 'cmp --help' for more information.\n" : ""}`;
        await output({ ...context, stdout: context.stderr }, error instanceof UsageError || error instanceof InputError ? Uint8Array.from(diagnostic, unit => unit.charCodeAt(0)) : diagnostic);
      }
      return { exitCode: 2 };
    }
  } };
}
