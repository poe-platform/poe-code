import { createOutputOperation, FsError, type ByteSource, type CommandContext, type FileReadHandle, type FileStat, type OutputOperation } from "../contracts/index.js";
import { monotonicNow, yieldTurn } from "../contracts/yield.js";
import { compareCopyIdentity } from "./copy-identity.js";
import { diagnostic, output, pathOf, UsageError } from "./internal.js";

export interface TailFollowScheduler {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const tailFollowScheduler: TailFollowScheduler = {
  now: monotonicNow,
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function parseTailFollow(arguments_: readonly string[]): { args: string[]; mode: "f" | "F" | undefined; idleMs: number | undefined } {
  const args: string[] = [];
  let mode: "f" | "F" | undefined;
  let idleMs: number | undefined;
  let ended = false;
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]!;
    if (ended || argument === "-" || !argument.startsWith("-")) { args.push(argument); continue; }
    if (argument === "--") { ended = true; args.push(argument); continue; }
    if (argument === "--max-idle" || argument.startsWith("--max-idle=")) {
      const text = argument === "--max-idle" ? arguments_[++index] : argument.slice(11);
      if (text === undefined || !/^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/u.test(text)) throw new UsageError("max-idle must be nonnegative decimal seconds");
      const [whole = "", fraction = ""] = text.split(".");
      if (fraction.slice(3).split("").some(digit => digit !== "0")) throw new UsageError("max-idle must resolve to integer milliseconds");
      const milliseconds = BigInt(whole || "0") * 1000n + BigInt(fraction.slice(0, 3).padEnd(3, "0"));
      if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) throw new UsageError("max-idle exceeds safe milliseconds");
      idleMs = Number(milliseconds);
    } else if (argument.startsWith("--")) {
      args.push(argument);
      if ((argument === "--lines" || argument === "--bytes") && index + 1 < arguments_.length) args.push(arguments_[++index]!);
    } else {
      let kept = "-";
      for (let offset = 1; offset < argument.length; offset++) {
        const flag = argument[offset]!;
        if (flag === "f" || flag === "F") mode = flag;
        else {
          kept += flag;
          if (flag === "n" || flag === "c") {
            kept += argument.slice(offset + 1);
            if (offset + 1 === argument.length && index + 1 < arguments_.length) {
              args.push(kept, arguments_[++index]!);
              kept = "-";
            }
            break;
          }
        }
      }
      if (kept !== "-") args.push(kept);
    }
  }
  if (idleMs !== undefined && mode === undefined) throw new UsageError("max-idle requires -f or -F");
  return { args, mode, idleMs };
}

interface Reader {
  readonly handle: FileReadHandle;
  closing?: Promise<void>;
}

interface FollowEntry {
  readonly name: string;
  reader: Reader | undefined;
  identity: FileStat | undefined;
  offset: number;
  error: string | undefined;
  active: boolean;
}

interface FollowSelection {
  readonly names: readonly string[];
  readonly mode: "f" | "F";
  readonly idleMs: number | undefined;
  readonly count: number;
  readonly bytes: boolean;
  readonly positive: boolean;
  readonly headers: boolean;
}

const idleExpired = Symbol("tail idle expired");

class FollowSession {
  readonly operation: OutputOperation;
  readonly context: CommandContext;
  readonly readers = new Set<Reader>();
  readonly pending = new Set<Promise<void>>();
  readonly waiting = new Set<() => void>();
  readonly failures: unknown[] = [];
  accepting = true;
  opening = 0;
  closeFailed = false;
  private drain: Promise<void> | undefined;
  private stdin: { iterator: AsyncIterator<Uint8Array>; finished: boolean; closing?: Promise<void> } | undefined;

  constructor(readonly caller: CommandContext, readonly cap: number, readonly scheduler: TailFollowScheduler) {
    this.operation = createOutputOperation(caller, caller.stdout);
    this.context = { ...caller, stdout: this.operation.output, signal: this.operation.signal };
    this.operation.registerCleanup(() => this.close());
  }

  assertOpen(): void {
    this.caller.signal.throwIfAborted();
    this.operation.signal.throwIfAborted();
    if (!this.accepting || this.closeFailed) throw new Error("Tail follow admission is closed");
  }

  wait<Value>(pending: Promise<Value> | undefined, milliseconds?: number): Promise<Value | typeof idleExpired> {
    this.assertOpen();
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: unknown;
      let armed = false;
      const finish = (outcome: { value: Value | typeof idleExpired } | { reason: unknown }) => {
        if (settled) return;
        settled = true;
        this.waiting.delete(cancel);
        this.operation.signal.removeEventListener("abort", cancel);
        try { if (armed) this.scheduler.clearTimeout(timer); }
        catch (reason) { this.failures.push(reason); if (!("reason" in outcome)) outcome = { reason }; }
        if ("reason" in outcome) reject(outcome.reason);
        else resolve(outcome.value);
      };
      const cancel = () => finish({ reason: this.operation.signal.aborted ? this.operation.signal.reason : new Error("Tail follow is closed") });
      this.waiting.add(cancel);
      this.operation.signal.addEventListener("abort", cancel, { once: true });
      pending?.then(value => finish({ value }), reason => finish({ reason }));
      if (milliseconds !== undefined) {
        try {
          timer = this.scheduler.setTimeout(() => finish({ value: idleExpired }), Math.min(2_147_483_647, Math.max(0, milliseconds)));
          armed = true;
        } catch (reason) { finish({ reason }); }
      }
      if (this.operation.signal.aborted || !this.accepting) cancel();
    });
  }

  async work<Value>(start: () => Promise<Value>): Promise<Value> {
    this.assertOpen();
    const pending = Promise.resolve().then(() => { this.assertOpen(); return start(); });
    const settled = pending.then(() => {}, () => {});
    this.pending.add(settled);
    void settled.then(() => { this.pending.delete(settled); });
    return await this.wait(pending) as Value;
  }

  async open(name: string): Promise<Reader> {
    this.assertOpen();
    if (this.readers.size + this.opening >= this.cap) throw new FsError("EMFILE", { message: "maxTailFollowHandles exhausted" });
    this.opening++;
    try {
      return await this.work(async () => {
        const path = pathOf(this.context, name);
        const capabilities = await this.caller.fs.capabilitiesFor?.(path, { signal: this.operation.signal }) ?? this.caller.fs.capabilities;
        this.assertOpen();
        if (capabilities.retainedRead !== true || typeof this.caller.fs.openReadFile !== "function") throw new FsError("ENOTSUP", { path, message: "tail follow requires retainedRead and openReadFile" });
        const handle = await this.caller.fs.openReadFile(path, { signal: this.operation.signal });
        const reader = { handle };
        this.readers.add(reader);
        if (!this.accepting || this.operation.signal.aborted) { await this.release(reader); this.assertOpen(); }
        return reader;
      });
    } finally { this.opening--; }
  }

  release(reader: Reader): Promise<void> {
    reader.closing ??= Promise.resolve().then(() => reader.handle.close()).then(() => {
      this.readers.delete(reader);
    }, reason => {
      this.closeFailed = true;
      this.failures.push(reason);
      throw reason;
    });
    void reader.closing.catch(() => {});
    return reader.closing;
  }

  async stat(reader: Reader): Promise<FileStat> {
    const stat = await this.work(() => reader.handle.stat({ signal: this.operation.signal }));
    if (stat.type !== "file") throw new FsError("EISDIR");
    if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new FsError("EIO", { message: "invalid retained file size" });
    return stat;
  }

  async read(reader: Reader, offset: number, end: number): Promise<Uint8Array> {
    const maximum = Math.min(64 * 1024, end - offset);
    const chunk = await this.work(() => reader.handle.read(offset, maximum, { signal: this.operation.signal }));
    if (!(chunk instanceof Uint8Array) || chunk.byteLength > maximum) throw new FsError("EIO", { message: "invalid retained read result" });
    return chunk;
  }

  closeInput(): Promise<void> {
    const stdin = this.stdin;
    if (!stdin) return Promise.resolve();
    stdin.closing ??= Promise.resolve().then(async () => { if (!stdin.finished) await stdin.iterator.return?.(); }).catch(reason => {
      this.failures.push(reason);
      throw reason;
    });
    void stdin.closing.catch(() => {});
    return stdin.closing;
  }

  async *input(idleMs: number | undefined): ByteSource {
    this.assertOpen();
    const stdin = { iterator: this.caller.stdin[Symbol.asyncIterator](), finished: false };
    this.stdin = stdin;
    let deadline = idleMs === undefined ? undefined : this.scheduler.now() + idleMs;
    let failed = false;
    try {
      while (true) {
        const pending = Promise.resolve().then(() => { this.assertOpen(); return stdin.iterator.next(); });
        const result = await this.wait(pending, deadline === undefined ? undefined : Math.max(0, deadline - this.scheduler.now()));
        if (result === idleExpired) break;
        if (result.done) { stdin.finished = true; break; }
        if (!(result.value instanceof Uint8Array)) throw new TypeError("Shell stdin must yield Uint8Array");
        yield result.value;
        if (result.value.byteLength && idleMs !== undefined) deadline = this.scheduler.now() + idleMs;
        await yieldTurn(this.caller.signal);
      }
    } catch (reason) {
      failed = true;
      throw reason;
    } finally {
      await this.closeInput().catch(reason => { if (!failed) throw reason; });
    }
  }

  close(): Promise<void> {
    if (!this.drain) {
      this.accepting = false;
      for (const cancel of this.waiting) cancel();
      this.drain = Promise.resolve().then(async () => {
        await Promise.allSettled([...this.pending, ...[...this.readers].map(reader => this.release(reader)), this.closeInput()]);
        if (this.failures.length === 1) throw this.failures[0];
        if (this.failures.length) throw new AggregateError(this.failures, "Tail follow cleanup failed");
      });
    }
    return this.drain;
  }
}

class FollowReadError {
  constructor(readonly reason: unknown) {}
}

export async function followTail(
  caller: CommandContext,
  selection: FollowSelection,
  cap: number,
  select: (context: CommandContext, source: ByteSource) => Promise<void>,
  scheduler: TailFollowScheduler = tailFollowScheduler,
): Promise<{ exitCode: number }> {
  const named = selection.names.filter(name => name !== "-").length;
  if (named + Number(selection.mode === "F" && named > 0) > cap) throw new UsageError(`maxTailFollowHandles exceeded (limit ${cap})`);
  if (selection.mode === "F" && selection.names.includes("-")) throw new FsError("ENOTSUP", { message: "cannot follow standard input by name" });
  const session = new FollowSession(caller, cap, scheduler);
  const context = session.context;
  const entries: FollowEntry[] = selection.names.map(name => ({ name, reader: undefined, identity: undefined, offset: 0, error: undefined, active: name !== "-" }));
  let lastHeader: FollowEntry | undefined;
  let exitCode = 0;
  let primary: { reason: unknown } | undefined;
  let acknowledged = scheduler.now();
  const header = async (entry: FollowEntry) => {
    if (selection.headers && lastHeader !== entry) {
      await output(context, `${lastHeader ? "\n" : ""}==> ${entry.name === "-" ? "standard input" : entry.name} <==\n`);
      lastHeader = entry;
    }
  };
  const failure = async (entry: FollowEntry, reason: unknown, initial: boolean) => {
    session.assertOpen();
    if (!(reason instanceof FsError) || !["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EISDIR"].includes(reason.code)) throw reason;
    if (initial) exitCode = 1;
    if (initial && reason.code === "EISDIR" || !initial && reason.code === "EACCES" && entry.reader) await header(entry);
    if (entry.error !== reason.code) await diagnostic(context, reason);
    entry.error = reason.code;
    if (entry.reader) { await session.release(entry.reader); entry.reader = undefined; }
    if (selection.mode === "f") { entry.active = false; exitCode = 1; }
  };
  const acquire = async (entry: FollowEntry, initial: boolean): Promise<FileStat | undefined> => {
    let candidate: Reader | undefined;
    let stat: FileStat;
    try {
      candidate = await session.open(entry.name);
      stat = await session.stat(candidate);
      if (selection.mode === "F" && compareCopyIdentity(stat, stat) === "unknown") throw new FsError("ENOTSUP", { path: entry.name, message: "name follow requires complete retained identity" });
    } catch (reason) {
      if (candidate) {
        try { await session.release(candidate); }
        catch { throw reason; }
      }
      await failure(entry, reason, initial);
      return undefined;
    }
    if (entry.reader && compareCopyIdentity(entry.identity, stat) === "same") {
      await session.release(candidate);
      return stat;
    }
    const replaced = entry.reader !== undefined;
    if (entry.reader) await session.release(entry.reader);
    entry.reader = candidate;
    entry.identity = stat;
    entry.offset = 0;
    if (!initial) {
      const message = replaced ? "has been replaced; following new file" : entry.error === "ENOENT" ? "has appeared; following new file" : "has become accessible";
      await diagnostic(context, new Error(`'${entry.name}' ${message}`));
    }
    entry.error = undefined;
    return stat;
  };
  try {
    for (const entry of entries) {
      if (entry.name === "-") {
        await header(entry);
        await select(context, session.input(selection.idleMs));
        continue;
      }
      const stat = await acquire(entry, true);
      if (!stat) {
        if (entry.error === "EISDIR" && selection.positive && !selection.bytes) break;
        continue;
      }
      await header(entry);
      if (!selection.positive && selection.count === 0) entry.offset = stat.size;
      else {
        if (selection.bytes && !selection.positive) entry.offset = Math.max(0, stat.size - selection.count);
        const source = (async function* (): ByteSource {
          while (entry.offset < stat.size) {
            let chunk: Uint8Array;
            try { chunk = await session.read(entry.reader!, entry.offset, stat.size); }
            catch (reason) { throw new FollowReadError(reason); }
            if (!chunk.byteLength) break;
            yield chunk;
            entry.offset += chunk.byteLength;
            await yieldTurn(caller.signal);
          }
        })();
        try { await select(context, source); }
        catch (reason) {
          if (!(reason instanceof FollowReadError)) throw reason;
          await failure(entry, reason.reason, true);
        }
        if (selection.bytes && selection.positive) entry.offset = Math.max(entry.offset, selection.count - 1);
      }
    }
    acknowledged = scheduler.now();
    if (selection.idleMs !== 0 && !(selection.positive && !selection.bytes && entries.some(entry => entry.error === "EISDIR"))) {
      while (entries.some(entry => entry.active)) {
        session.assertOpen();
        if (selection.idleMs !== undefined && scheduler.now() - acknowledged >= selection.idleMs) break;
        const round: { entry: FollowEntry; end: number }[] = [];
        for (const entry of entries) {
          if (!entry.active) continue;
          let stat: FileStat | undefined;
          if (selection.mode === "F") stat = await acquire(entry, false);
          else {
            try { stat = await session.stat(entry.reader!); }
            catch (reason) { await failure(entry, reason, false); }
          }
          if (!stat) continue;
          if (stat.size < entry.offset) {
            await diagnostic(context, new Error(`${entry.name}: file truncated`));
            entry.offset = 0;
          }
          if (stat.size > entry.offset) round.push({ entry, end: stat.size });
        }
        let progressed = false;
        while (round.some(item => item.entry.reader && item.entry.offset < item.end)) {
          for (const item of round) {
            const { entry } = item;
            if (!entry.reader || entry.offset >= item.end) continue;
            let chunk: Uint8Array;
            try { chunk = await session.read(entry.reader, entry.offset, item.end); }
            catch (reason) { await failure(entry, reason, false); item.end = entry.offset; continue; }
            if (!chunk.byteLength) { item.end = entry.offset; continue; }
            await header(entry);
            await output(context, chunk);
            entry.offset += chunk.byteLength;
            acknowledged = scheduler.now();
            progressed = true;
            await yieldTurn(caller.signal);
          }
        }
        await yieldTurn(caller.signal);
        if (!progressed && entries.some(entry => entry.active)) {
          const remaining = selection.idleMs === undefined ? 100 : Math.min(100, selection.idleMs - (scheduler.now() - acknowledged));
          if (remaining <= 0) break;
          await session.wait<void>(undefined, remaining);
        }
      }
    }
  } catch (reason) { primary = { reason }; }
  finally {
    try { await session.operation.close(); }
    catch (reason) { primary ??= { reason }; }
  }
  caller.signal.throwIfAborted();
  if (primary) {
    if (session.operation.signal.aborted && session.operation.signal.reason instanceof FsError && session.operation.signal.reason.code === "EPIPE") return { exitCode: 141 };
    throw primary.reason;
  }
  return { exitCode };
}
