import { FsError, resolvePath, type ByteSink, type ByteSource } from "../../contracts/index.js";
import type { OutputOperation } from "../../contracts/output.js";
import { Budget, HexdumpError, bytes, pathText } from "./internal.js";

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const viewBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const viewOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const viewLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;

export class Lifecycle {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly cleanups = new Set<() => Promise<void>>();
  private closing: Promise<void> | undefined;
  private diagnostic: { destination: ByteSink; consumer: AbortSignal | undefined } | undefined;
  diagnosticCancellation: { reason: unknown } | undefined;
  constructor(readonly budget: Budget, output: OutputOperation, private readonly stdout: ByteSink, private readonly caller: AbortSignal) { output.registerCleanup(() => this.close()); }
  cleanup(action: () => Promise<void>): void { this.assertOpen(); this.cleanups.add(action); }
  forget(action: () => Promise<void>): void { this.cleanups.delete(action); }
  assertOpen(): void {
    this.budget.signal.throwIfAborted();
    if (this.closing) throw new HexdumpError("command is closed");
  }
  private assertDiagnosticOpen(): void {
    this.caller.throwIfAborted();
    const consumer = this.diagnostic?.consumer;
    if (consumer?.aborted) {
      this.diagnosticCancellation = { reason: consumer.reason };
      consumer.throwIfAborted();
    }
  }
  async operation<Value>(action: () => Value | Promise<Value>, diagnostic = false): Promise<Value> {
    if (diagnostic) this.assertDiagnosticOpen();
    else this.assertOpen();
    if (this.closing) throw new HexdumpError("command is closed");
    if (!diagnostic) this.budget.charge();
    const pending = Promise.resolve().then(() => {
      if (diagnostic) this.assertDiagnosticOpen();
      else this.assertOpen();
      return action();
    });
    this.pending.add(pending);
    try {
      const value = await pending;
      if (diagnostic) this.assertDiagnosticOpen();
      else this.assertOpen();
      return value;
    }
    finally { this.pending.delete(pending); }
  }
  close(): Promise<void> {
    return this.closing ??= Promise.resolve().then(async () => {
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      const failures: unknown[] = [];
      for (const cleanup of this.cleanups) {
        try { await cleanup(); } catch (error) { failures.push(error); }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "hexdump cleanup failed");
    });
  }
  async write(value: string, diagnostic = false): Promise<void> {
    this.budget.emitted(value.length, diagnostic);
    await this.operation(async () => {
      if (!diagnostic) this.budget.retain(value.length * 3);
      try {
        let destination: ByteSink;
        if (diagnostic) {
          if (!this.diagnostic) {
            const sink = this.budget.context.stderr;
            this.assertDiagnosticOpen();
            const capability = sink.ownedOutput;
            this.assertDiagnosticOpen();
            const consumer = capability?.consumerClosed;
            this.diagnostic = { destination: capability ?? sink, consumer };
          }
          this.assertDiagnosticOpen();
          destination = this.diagnostic.destination;
        } else {
          destination = this.stdout;
          this.assertOpen();
        }
        const write = destination.write;
        if (diagnostic) this.assertDiagnosticOpen();
        else this.assertOpen();
        await Reflect.apply(write, destination, [bytes(value)]);
      } finally { if (!diagnostic) this.budget.retain(-value.length * 3); }
    }, diagnostic);
  }
}

export class Reader {
  private iterator: AsyncIterator<Uint8Array> | undefined;
  private chunk: Uint8Array = new Uint8Array();
  private offset = 0;
  private ended = false;
  private empties = 0;
  private snapshotBytes = 0;
  private closed: Promise<void> | undefined;
  constructor(readonly name: string | undefined, readonly lifecycle: Lifecycle) {
    lifecycle.budget.retain(256);
    lifecycle.cleanup(this.close);
  }
  readonly close = (): Promise<void> => this.closed ??= Promise.resolve().then(async () => {
    try { if (!this.ended) await this.iterator?.return?.(); }
    finally {
      this.iterator = undefined;
      this.releaseSnapshot();
      this.lifecycle.budget.retain(-this.chunk.length - 256);
      this.chunk = new Uint8Array();
      this.lifecycle.forget(this.close);
    }
  });
  private readonly releaseSnapshot = (): void => {
    this.lifecycle.budget.retain(-this.snapshotBytes);
    this.snapshotBytes = 0;
  };
  async open(): Promise<void> {
    const { budget } = this.lifecycle;
    await this.lifecycle.operation(async () => {
      let source: ByteSource;
      let needsAcquisitionCleanup = false;
      if (this.name === undefined) source = budget.context.stdin;
      else {
        if (this.name === "") throw new FsError("ENOENT", { path: this.name });
        const cwd = budget.context.cwd;
        this.lifecycle.assertOpen();
        const path = resolvePath(cwd, pathText(this.name));
        const fs = budget.context.fs;
        this.lifecycle.assertOpen();
        const statMethod = fs.stat;
        this.lifecycle.assertOpen();
        const stat = await Reflect.apply(statMethod, fs, [path, { signal: budget.signal }]);
        this.lifecycle.assertOpen();
        const type = stat.type;
        this.lifecycle.assertOpen();
        if (this.name.endsWith("/") && type !== "directory") throw new FsError("ENOTDIR", { path });
        if (type === "directory") throw new FsError("EISDIR", { path });
        if (type !== "file" && type !== "character") throw new FsError("ENOTSUP", { path });
        const capabilitiesFor = fs.capabilitiesFor;
        this.lifecycle.assertOpen();
        const selected = capabilitiesFor ? await Reflect.apply(capabilitiesFor, fs, [path, { signal: budget.signal }]) : undefined;
        this.lifecycle.assertOpen();
        const capabilities = selected ?? fs.capabilities;
        this.lifecycle.assertOpen();
        const readStream = fs.readStream;
        this.lifecycle.assertOpen();
        const streamingRead = readStream && capabilities.streamingRead !== false;
        this.lifecycle.assertOpen();
        if (readStream && streamingRead) {
          source = Reflect.apply(readStream, fs, [path, { signal: budget.signal, chunkSize: 16_384 }]);
          needsAcquisitionCleanup = budget.signal.aborted;
        } else {
          const maximum = Math.min(budget.limits.maxInputBytes, Math.floor(budget.limits.maxBufferedBytes / 2));
          const size = stat.size;
          this.lifecycle.assertOpen();
          budget.check(size, maximum, "buffered input bytes");
          budget.retain(maximum);
          this.snapshotBytes = maximum;
          const readFile = fs.readFile;
          this.lifecycle.assertOpen();
          const content = await Reflect.apply(readFile, fs, [path, { signal: budget.signal, maxBytes: maximum }]);
          this.lifecycle.assertOpen();
          if (!(content instanceof Uint8Array)) throw new TypeError("hexdump input requires bytes");
          const length = viewLength.call(content) as number;
          budget.check(length, maximum, "buffered input bytes");
          budget.retain(length - maximum);
          this.snapshotBytes = length;
          const { releaseSnapshot } = this;
          source = { async *[Symbol.asyncIterator]() { try { yield content; } finally { releaseSnapshot(); } } };
        }
      }
      if (!needsAcquisitionCleanup) this.lifecycle.assertOpen();
      const factory = source[Symbol.asyncIterator];
      if (!needsAcquisitionCleanup) this.lifecycle.assertOpen();
      this.iterator = Reflect.apply(factory, source, []);
    });
  }
  async get(): Promise<number> {
    const { budget } = this.lifecycle;
    budget.charge();
    await budget.checkpointWork();
    while (this.offset === this.chunk.length) {
      if (this.ended) return -1;
      await budget.checkpointWork();
      const next = await this.lifecycle.operation(() => {
        const iterator = this.iterator!;
        const advance = iterator.next;
        this.lifecycle.assertOpen();
        return Reflect.apply(advance, iterator, []);
      });
      budget.retain(-this.chunk.length);
      this.chunk = new Uint8Array();
      this.offset = 0;
      const done = next.done;
      this.lifecycle.assertOpen();
      if (done) { this.ended = true; this.iterator = undefined; return -1; }
      const value = next.value;
      this.lifecycle.assertOpen();
      if (!(value instanceof Uint8Array)) throw new TypeError("hexdump input requires bytes");
      const buffer = viewBuffer.call(value) as ArrayBuffer;
      const offset = viewOffset.call(value) as number;
      const length = viewLength.call(value) as number;
      this.lifecycle.assertOpen();
      budget.inputBytes(length);
      budget.charge(length);
      budget.retain(length);
      try {
        if (viewOffset.call(value) !== offset || viewLength.call(value) < length) throw new TypeError("hexdump input extent changed during admission");
        this.chunk = new Uint8Array(new Uint8Array(buffer, offset, length));
      } catch (error) { budget.retain(-length); throw error; }
      if (!this.chunk.length) budget.check(++this.empties, budget.limits.maxEmptyChunks, "empty input chunks");
    }
    return this.chunk[this.offset++]!;
  }
}

export function fsDetail(error: FsError): string {
  const details: Partial<Record<FsError["code"], string>> = {
    EACCES: "Permission denied", EPERM: "Operation not permitted", ENOENT: "No such file or directory",
    EISDIR: "Is a directory", ENOTDIR: "Not a directory", EIO: "Input/output error", ELOOP: "Too many levels of symbolic links",
    ENAMETOOLONG: "File name too long", ENOTSUP: "Operation not supported",
  };
  return details[error.code] ?? error.message;
}
