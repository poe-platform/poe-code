import { commandRuntimeIdentity, FsError, getCommandArguments, isFsError, type ByteSource, type CommandContext, type CommandDefinition, type FileReadHandle, type FileStat, type VirtualShellPlugin } from "safe-bash-contracts";
import { yieldTurn } from "safe-bash-contracts/yield";
import { assertCommandRequirements } from "safe-bash-contracts/command-requirements";
import { PublicDiagnostic, publicDiagnosticMessage } from "safe-bash-contracts/diagnostics";
import { ByteInputBudget } from "safe-bash-byte-input-engine/index";
import { registerDefaultExecutor, output, pathOf, UsageError } from "safe-bash-io-engine/internal";
import { inputRequirements } from "safe-bash-io-engine/portable-requirements";
import { compareCopyIdentity, compareObservedEntries } from "safe-bash-contracts/filesystem-identity";

import { limitsFor, quote, type CmpLimits, type CmpCommandsOptions } from "./options.js";
export type { CmpLimits, CmpCommandsOptions } from "./options.js";
const defaultBlockBytes = 4096;

const maxCount = 18446744073709551616n;

function byteCount(text: string, option = "bytes", legacy = true): bigint {
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
    if (legacy && count > maximum) invalid();
    if (!legacy && count > 9223372036854775807n) count = 9223372036854775808n;
    position++;
  }
  const suffix = text.slice(position);
  if (position === start) {
    if (position !== 0 || !"kKMGTPEZY".includes(suffix[0] ?? " ")) invalid();
    count = 1n;
  }
  if (suffix) {
    const power = "KMGTPEZY".indexOf(suffix[0] === "k" ? "K" : suffix[0]!) + 1;
    if (!power || !["", "B", "D", "iB"].includes(suffix.slice(1))) invalid();
    count *= (suffix.endsWith("B") && !suffix.endsWith("iB") || suffix.endsWith("D") ? 1000n : 1024n) ** BigInt(power);
  }
  if (legacy && count > maximum) invalid();
  return !legacy && count > 9223372036854775807n ? 9223372036854775808n : count;
}

interface CmpOptions {
  names: string[];
  skips: [bigint, bigint];
  limit: bigint;
  silent: boolean;
  verbose: boolean;
  printBytes: boolean;
  information?: "help" | "version";
}

function parse(context: CommandContext, legacy: boolean): CmpOptions {
  const parsed: CmpOptions = { names: [], skips: [0n, 0n], limit: maxCount, silent: false, verbose: false, printBytes: false };
  const long: Readonly<Record<string, string>> = { "print-bytes": "b", "print-chars": "c", "ignore-initial": "i", verbose: "l", bytes: "n", silent: "s", quiet: "s", version: "v", help: "help" };
  const operands: string[] = [];
  const argumentsWithBytes = getCommandArguments(context);
  const args = context.args.map((_argument, index) => {
    const bytes = argumentsWithBytes.bytes(index)!;
    return Array.from(bytes, byte => String.fromCharCode(byte)).join("");
  });
  let ended = false;
  const apply = (key: string, argument: string | undefined): void => {
    if (key === "s" || key === "l") {
      if (key === "s" ? parsed.verbose : parsed.silent) throw new UsageError("options -l and -s are incompatible");
      if (key === "s") parsed.silent = true;
      else parsed.verbose = true;
    } else if (key === "b" || key === "c") parsed.printBytes = true;
    else if (key === "n") {
      const next = byteCount(argument!, "bytes", legacy);
      if (next < parsed.limit) parsed.limit = next;
    } else if (key === "i") {
      const delimiter = argument!.indexOf(":");
      const first = delimiter < 0 ? argument! : argument!.slice(0, delimiter);
      let firstSkip: bigint;
      try { firstSkip = byteCount(first, "ignore-initial", legacy); }
      catch { throw new UsageError(`invalid --ignore-initial value '${argument}'`); }
      if (firstSkip > parsed.skips[0]) parsed.skips[0] = firstSkip;
      const secondSkip = delimiter < 0 ? firstSkip : byteCount(argument!.slice(delimiter + 1), "ignore-initial", legacy);
      if (secondSkip > parsed.skips[1]) parsed.skips[1] = secondSkip;
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
    if (operands[index + 2] !== undefined) {
      const next = byteCount(operands[index + 2]!, "ignore-initial", legacy);
      if (next > parsed.skips[index]) parsed.skips[index] = next;
    }
  }
  if (operands.length > 4) throw new UsageError(`extra operand '${operands[4]}'`);
  return parsed;
}

async function observe<Value>(operation: () => Promise<Value>, signal: AbortSignal): Promise<Value> {
  signal.throwIfAborted();
  return new Promise<Value>((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(value => {
      signal.removeEventListener("abort", abort); resolve(value);
    }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

class InvocationClosed extends Error {}

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
  position = 0n;
  private skip = 0;
  private retained: { bytes: Uint8Array; offset: number } | undefined;
  private requestBytes = defaultBlockBytes;
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
    private readonly signal: AbortSignal, private readonly chargeChunk: () => Promise<void>, private readonly blockBytes: number, private readonly limits: CmpLimits, private readonly legacy: boolean) {}

  async open(limit: number, skip: bigint): Promise<void> {
    this.signal.throwIfAborted();
    const numericSkip = skip > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(skip);
    this.skip = numericSkip;
    if (this.name === "-") {
      const input = this.context.stdinInput;
      this.stat = input?.stat;
      this.position = BigInt(input?.position ?? 0);
      if (this.stat?.type === "file" && Number.isSafeInteger(this.stat.size) && this.stat.size >= 0) {
        const remaining = BigInt(this.stat.size) - this.position - skip;
        this.size = remaining > 0n ? Number(remaining) : 0;
      }
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
        try { stat = await observe(() => this.context.fs.stat(path, { signal: this.signal }), this.signal); }
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
        try { await observe(() => this.context.fs.access(path, 4, { signal: this.signal }), this.signal); }
        catch (error) { this.signal.throwIfAborted(); if (!isFsError(error, "ENOTSUP")) throw error; }
      }
      this.signal.throwIfAborted();
      if (!stat && limit === 0) throw new FsError("ENOTSUP", { path, message: "zero-byte comparison requires metadata admission" });
      this.stat = stat;
      this.position = skip;
      if (stat?.type === "file" && Number.isSafeInteger(stat.size) && stat.size >= 0) {
        const remaining = BigInt(stat.size) - skip;
        this.size = remaining > 0n ? Number(remaining) : 0;
      }
      if (limit === 0 && (this.handle || Number.isFinite(this.size) || this.skip === 0)) {
        this.skip = 0;
        return;
      }
      if (!this.legacy && stat?.type === "file" && skip > BigInt(Number.MAX_SAFE_INTEGER)) {
        this.skip = 0;
        this.source = () => ({ async *[Symbol.asyncIterator]() { /* Empty beyond the regular file. */ } });
      } else if (this.handle) {
        const handle = this.handle;
        let position = Number.isFinite(this.size) ? Math.min(numericSkip, stat!.size) : numericSkip;
        this.skip = 0;
        this.source = () => ({ [Symbol.asyncIterator]: () => ({ next: async () => {
          const bytes = await this.work(() => handle.read(position, this.requestBytes, { signal: this.signal }));
          if (!(bytes instanceof Uint8Array) || bytes.length > this.requestBytes) throw new FsError("EIO", { path, message: "invalid retained read size" });
          position += bytes.length;
          return bytes.length ? { done: false, value: bytes } : { done: true, value: undefined };
        } }) });
      } else if (this.context.fs.readStream && capabilities.streamingRead !== false) {
        const start = Number.isFinite(this.size) ? Math.min(numericSkip, stat!.size) : 0;
        if (Number.isFinite(this.size)) this.skip = 0;
        this.source = () => this.context.fs.readStream!(path, { signal: this.signal, chunkSize: Math.min(this.blockBytes, this.limits.maxChunkBytes, limit || this.skip),
          ...(start ? { start } : {}),
          ...(limit === Infinity || this.skip ? {} : { endExclusive: Math.min(Number.MAX_SAFE_INTEGER, start + limit) }) });
      } else {
        if (capabilities.read === false) throw new FsError("ENOTSUP", { syscall: "readFile", path });
        const context = this.context;
        const signal = this.signal;
        const maximum = this.limits.maxFallbackBytes;
        if (!this.legacy && (!stat || !Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > maximum)) {
          throw new InputError(this.name + ": bounded comparison requires readStream or a file within maxFallbackBytes", false);
        }
        const chunkBytes = this.limits.maxChunkBytes;
        this.source = () => ({ async *[Symbol.asyncIterator]() {
          const bytes = await context.fs.readFile(path, { signal, ...(maximum === Infinity ? {} : { maxBytes: maximum }) });
          if (bytes.byteLength > maximum) throw new FsError("EFBIG", { message: "cmp fallback byte limit exceeded" });
          for (let offset = 0; offset < bytes.length; offset += chunkBytes) yield bytes.subarray(offset, offset + chunkBytes);
        } });
      }
    }
  }

  async prepare(): Promise<void> {
    const input = this.name === "-" ? this.context.stdinInput : undefined;
    if (input?.seek) {
      this.signal.throwIfAborted();
      const targetPosition = Math.min(Number.MAX_SAFE_INTEGER, input.position + this.skip);
      this.position = BigInt(input.position) + BigInt(this.skip);
      if (this.skip) {
        try { await input.seek(targetPosition, this.signal); }
        catch (error) { throw inputError(error, this.name); }
      }
      this.signal.throwIfAborted();
      this.skip = 0;
      if (this.stat?.type === "file") {
        const remaining = BigInt(this.stat.size) - this.position;
        this.size = remaining > 0n ? Number(remaining) : 0;
      }
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
      this.requestBytes = Math.min(this.blockBytes, this.limits.maxChunkBytes, this.skip || remaining);
      const item = await this.reader!.next();
      if (item.done) return false;
      await this.chargeChunk();
      if (!this.legacy && item.value.byteLength >= 65536) await yieldTurn(this.signal);
      if (item.value.byteLength > this.limits.maxChunkBytes) throw new FsError("EFBIG", { message: "cmp chunk byte limit exceeded" });
      this.bytes = new Uint8Array(item.value);
      this.offset = Math.min(this.skip, this.bytes.length);
      this.skip -= this.offset;
    }
    return true;
  }

  async block(count: number): Promise<void> {
    if (this.retained) { this.bytes = this.retained.bytes; this.offset = this.retained.offset; }
    const bytes = new Uint8Array(count);
    let size = 0;
    while (size < count && await this.fill(count - size)) {
      const length = Math.min(count - size, this.bytes.length - this.offset);
      bytes.set(this.bytes.subarray(this.offset, this.offset + length), size);
      this.offset += length;
      size += length;
    }
    this.retained = { bytes: this.bytes, offset: this.offset };
    this.bytes = bytes.subarray(0, size);
    this.offset = 0;
  }

  private retire(): Promise<void> {
    this.retirement ??= Promise.resolve().then(async () => {
      try { if (!this.finished) await this.iterator?.return?.(); }
      catch (error) { throw !this.legacy && error instanceof Error ? new InputError(this.name + ": " + error.message, false) : inputError(error, this.name); }
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

async function compare(context: CommandContext, parsed: CmpOptions, blockBytes: number, limits: CmpLimits, legacy: boolean, preferredBlock: boolean): Promise<number> {
  const { names, skips, silent, verbose, printBytes } = parsed;
  const limit = parsed.limit >= maxCount ? Infinity : parsed.limit > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(parsed.limit);
  const controller = new AbortController();
  const signal = AbortSignal.any([context.signal, controller.signal]);
  const budget = new ByteInputBudget(Infinity);
  let chunks = 0;
  const chargeChunk = async (): Promise<void> => {
    if (++chunks % 64 === 0) await yieldTurn(signal);
  };
  const cursors = names.map(name => new Cursor(name, context, budget, signal, chargeChunk, blockBytes, limits, legacy));
  let closing: Promise<void> | undefined;
  const cleanupErrors: unknown[] = [];
  const close = (): Promise<void> => {
    if (!closing) {
      controller.abort(legacy ? new FsError("EPIPE", { message: "cmp input closed" }) : new InvocationClosed("cmp invocation closed"));
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
    if (sharedStdin && (!legacy || skips[0] === skips[1] || !context.stdinInput?.seek && context.stdinInput?.stat?.type !== "file")) return 0;
    for (const index of [0, 1] as const) {
      const cursor = cursors[index]!;
      try { await cursor.open(limit, skips[index]); }
      catch (error) { throw inputError(error, cursor.name, true); }
      if (index === 0 && names[0] === names[1] && skips[0] === skips[1] && cursor.stat) return 0;
    }
    const [left, right] = cursors as [Cursor, Cursor];
    if (!legacy && preferredBlock) {
      blockBytes = left.stat?.ioBlockSize ?? 65536;
      if (!Number.isSafeInteger(blockBytes) || blockBytes < 1) throw new InputError(left.name + ": invalid preferred I/O block size", false);
    }
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
    let blockRemaining = 0;
    while (compared < limit || !legacy && blockRemaining === blockBytes) {
      if (!legacy) {
        const requested = Math.min(blockBytes, limit - compared);
        await flush();
        await left.block(requested);
        await right.block(requested);
        different = false;
        blockRemaining = Math.min(left.bytes.length, right.bytes.length);
      }
      const hasLeft = (legacy ? await left.fill(limit - compared) : left.bytes.length > 0);
      const hasRight = (legacy ? await right.fill(limit - compared) : right.bytes.length > 0);
      if (!hasLeft || !hasRight) {
        await flush();
        if (hasLeft === hasRight) return different ? 1 : 0;
        if (!silent) {
          const shorter = hasLeft ? right.name : left.name;
          const detail = compared === 0 ? "which is empty" : `after byte ${compared}${verbose || noStdout ? "" : `, ${lastByte === 10 ? "" : "in "}line ${newlines + (lastByte === 10 ? 0 : 1)}`}`;
          await output({ ...context, stdout: context.stderr }, Uint8Array.from(`cmp: EOF on ${legacy ? shorter : quote(shorter)} ${detail}\n`, unit => unit.charCodeAt(0)));
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
      if (!legacy && left.bytes.length !== right.bytes.length) {
        await flush();
        if (!silent) {
          const shorter = left.bytes.length < right.bytes.length ? left.name : right.name;
          const detail = compared === 0 ? "which is empty" : `after byte ${compared}${verbose || noStdout ? "" : `, ${lastByte === 10 ? "" : "in "}line ${newlines + (lastByte === 10 ? 0 : 1)}`}`;
          await output({ ...context, stdout: context.stderr }, `cmp: EOF on ${quote(shorter)} ${detail}\n`);
        }
        return 1;
      }
      if (!legacy && blockRemaining !== blockBytes) { await flush(); return different ? 1 : 0; }
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

function buildCmpCommand(legacy: boolean, options: CmpCommandsOptions = {}): CommandDefinition {
  const limits = limitsFor(options);
  const blockBytes = options.comparisonBlockBytes ?? (legacy ? defaultBlockBytes : 65536);
  if (!Number.isSafeInteger(blockBytes) || blockBytes < 1) throw new RangeError("cmp comparisonBlockBytes must be positive");
  const definition: CommandDefinition = { name: "cmp", runtimeIdentity: commandRuntimeIdentity, filesystemRequirements: inputRequirements, async execute(context) {
    context.signal.throwIfAborted();
    let silent = false;
    try {
      const parsed = parse(context, legacy);
      if (parsed.information) {
        await output(context, parsed.information === "version" ? (legacy ? "cmp (virtual-bash)\n" : "cmp (virtual-bash, GNU diffutils 3.12 profile)\n") : "Usage: cmp [OPTION]... FILE1 [FILE2 [SKIP1 [SKIP2]]]\nCompare bytes in the virtual filesystem; omitted FILE2 or '-' reads stdin.\n  -s, --silent, --quiet  report status only\n  -l, --verbose         list differing bytes in octal\n  -b, -c, --print-bytes  also display byte characters\n  -i, --ignore-initial=SKIP[:SKIP2]  skip initial bytes\n  -n, --bytes=LIMIT     compare at most LIMIT bytes\n  --help, -v, --version show virtual-bash command information\n");
        return { exitCode: 0 };
      }
      silent = parsed.silent;
      return { exitCode: await compare(context, parsed, blockBytes, limits, legacy, options.comparisonBlockBytes === undefined) };
    } catch (error) {
      context.signal.throwIfAborted();
      if (error instanceof InvocationClosed) throw error;
      if (!silent || !(error instanceof InputError) || !error.suppressInSilent) {
        const message = !legacy && error instanceof Error ? error.message : publicDiagnosticMessage(error, context.onInternalError);
        const diagnostic = `cmp: ${message}\n${error instanceof UsageError ? "cmp: Try 'cmp --help' for more information.\n" : ""}`;
        await output({ ...context, stdout: context.stderr }, error instanceof UsageError || error instanceof InputError ? Uint8Array.from(diagnostic, unit => unit.charCodeAt(0)) : diagnostic);
      }
      return { exitCode: 2 };
    }
  } };
  return registerDefaultExecutor(definition, options);
}

export function evalSyncCmp(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (path: string) => Uint8Array | undefined,
): string | undefined {
  try {
    const operands: string[] = [];
    const skips: [bigint, bigint] = [0n, 0n];
    let count = 9223372036854775807n;
    let stopped = false;
    const setSkip = (idx: 0 | 1, text: string) => {
      const p = byteCount(text, "ignore-initial");
      if (p > skips[idx]) skips[idx] = p;
    };
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (stopped || a === "-" || !a.startsWith("-")) { operands.push(a); continue; }
      if (a === "--") { stopped = true; continue; }
      if (a === "-s" || a === "--silent" || a === "--quiet" || a === "-b" || a === "-c" || a === "--print-bytes" || a === "-l" || a === "--verbose") continue;
      if (a === "-i" || a === "--ignore-initial" || a.startsWith("-i") || a.startsWith("--ignore-initial=")) {
        const v = (a === "-i" || a === "--ignore-initial") ? opArgs[++i] : (a.startsWith("--ignore-initial=") ? a.slice(17) : a.slice(2));
        if (v === undefined || v === "") return undefined;
        const d = v.indexOf(":");
        if (d < 0) { setSkip(0, v); if (skips[0] > skips[1]) skips[1] = skips[0]; }
        else { setSkip(0, v.slice(0, d)); setSkip(1, v.slice(d + 1)); }
        continue;
      }
      if (a === "-n" || a === "--bytes" || a.startsWith("-n") || a.startsWith("--bytes=")) {
        const v = (a === "-n" || a === "--bytes") ? opArgs[++i] : (a.startsWith("--bytes=") ? a.slice(8) : a.slice(2));
        if (v === undefined || v === "") return undefined;
        const p = byteCount(v, "bytes");
        if (p < count) count = p;
        continue;
      }
      return undefined;
    }
    if (operands.length < 1 || operands.length > 4) return undefined;
    if (operands[2] !== undefined) setSkip(0, operands[2]);
    if (operands[3] !== undefined) setSkip(1, operands[3]);
    const f0 = operands[0]!;
    const f1 = operands[1] ?? "-";
    if (f0 === "-" && f1 === "-") {
      if (skips[0] === skips[1]) return "";
      return undefined;
    }
    const b0 = f0 === "-" ? inBytes : readFileSync?.(f0);
    const b1 = f1 === "-" ? inBytes : readFileSync?.(f1);
    if (!b0 || !b1 || b0.byteLength > 16384 || b1.byteLength > 16384) return undefined;
    if (skips[0] > BigInt(b0.byteLength) || skips[1] > BigInt(b1.byteLength)) return undefined;
    const s0 = Number(skips[0]);
    const s1 = Number(skips[1]);
    const rem0 = b0.byteLength - s0;
    const rem1 = b1.byteLength - s1;
    const limit = count < BigInt(Math.max(rem0, rem1)) ? Number(count) : Math.max(rem0, rem1);
    const len0 = Math.min(rem0, limit);
    const len1 = Math.min(rem1, limit);
    if (len0 !== len1) return undefined;
    for (let i = 0; i < len0; i++) {
      if (b0[s0 + i] !== b1[s1 + i]) return undefined;
    }
    return "";
  } catch {
    return undefined;
  }
}

/** Opt-in GNU comparison-block behavior; producer fragments do not define blocks. */
export const createCmpCommand = buildCmpCommand.bind(undefined, false);
/** Existing default-shell behavior, sharing the same retained-input engine. */
export const cmpCommand = buildCmpCommand.bind(undefined, true);
export function createCmpCommands(options: CmpCommandsOptions = {}): readonly CommandDefinition[] { return [createCmpCommand(options)]; }
export function cmpCommands(options: CmpCommandsOptions = {}): VirtualShellPlugin {
 const commands = createCmpCommands(options);
 return { name: "cmp-commands", setup(host) {
  if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
  for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
