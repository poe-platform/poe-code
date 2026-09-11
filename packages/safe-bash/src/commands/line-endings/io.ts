import type { ByteSink, ByteSource, FileStat } from "../../contracts/index.js";
import type { OutputOperation } from "../../contracts/output.js";
import { Budget, LineEndingError } from "./internal.js";

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const viewBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const viewOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const viewLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;

export class Lifecycle {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly cleanups: (() => Promise<void>)[] = [];
  private closing: Promise<void> | undefined;
  private diagnosticDestination: { destination: ByteSink; consumer: AbortSignal | undefined } | undefined;
  diagnosticCancellation: { reason: unknown } | undefined;
  constructor(readonly budget: Budget, output: OutputOperation, private readonly captured: ByteSink, private readonly caller: AbortSignal, readonly admission: { closed: boolean }) { output.registerCleanup(() => this.close()); }
  assertOpen(): void { this.budget.signal.throwIfAborted(); if (this.closing || this.admission.closed) throw new LineEndingError("command is closed"); }
  private assertDiagnosticOpen(): void {
    this.caller.throwIfAborted();
    const consumer = this.diagnosticDestination?.consumer;
    if (consumer?.aborted) {
      this.diagnosticCancellation = { reason: consumer.reason };
      consumer.throwIfAborted();
    }
  }
  cleanup(action: () => Promise<void>): void { this.assertOpen(); this.cleanups.push(action); }
  async operation<Value>(action: () => Value | Promise<Value>): Promise<Value> {
    this.assertOpen();
    const pending = Promise.resolve().then(async () => { await this.budget.step(); this.assertOpen(); return action(); });
    this.pending.add(pending);
    try { const value = await pending; this.assertOpen(); return value; }
    finally { this.pending.delete(pending); }
  }
  close(): Promise<void> {
    return this.closing ??= Promise.resolve().then(async () => {
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      const failures: unknown[] = [];
      for (const close of this.cleanups) { try { await close(); } catch (error) { failures.push(error); } }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "line-ending cleanup failed");
    });
  }
  async stdout(bytes: Uint8Array): Promise<void> {
    await this.operation(async () => {
      const write = this.captured.write;
      this.assertOpen();
      await Reflect.apply(write, this.captured, [bytes]);
    });
  }
  async diagnostic(text: string): Promise<void> {
    this.assertDiagnosticOpen();
    if (this.closing || this.admission.closed) throw new LineEndingError("command is closed");
    this.budget.check(text.length * 3, this.budget.limits.maxDiagnosticBytes, "diagnostic buffer bytes");
    const bytes = new TextEncoder().encode(text);
    this.budget.emitted(bytes.length, true);
    const pending = Promise.resolve().then(async () => {
      this.assertDiagnosticOpen();
      if (!this.diagnosticDestination) {
        const sink = this.budget.context.stderr;
        this.assertDiagnosticOpen();
        const capability = sink.ownedOutput;
        this.assertDiagnosticOpen();
        const consumer = capability?.consumerClosed;
        this.diagnosticDestination = { destination: capability ?? sink, consumer };
      }
      this.assertDiagnosticOpen();
      const destination = this.diagnosticDestination.destination;
      const write = destination.write;
      this.assertDiagnosticOpen();
      await Reflect.apply(write, destination, [bytes]);
    });
    this.pending.add(pending);
    try { await pending; this.assertDiagnosticOpen(); } finally { this.pending.delete(pending); }
  }
}

export class Reader {
  private iterator: AsyncIterator<Uint8Array> | undefined;
  private chunk: Uint8Array = new Uint8Array();
  private offset = 0;
  private ended = false;
  private empties = 0;
  private snapshotBytes = 0;
  private closing: Promise<void> | undefined;
  constructor(readonly life: Lifecycle) { life.cleanup(() => this.close()); }
  close(): Promise<void> {
    return this.closing ??= (async () => {
      try {
        if (!this.ended && this.iterator) {
          const iterator = this.iterator;
          const close = iterator.return;
          if (close) await Reflect.apply(close, iterator, []);
        }
      } finally {
        this.iterator = undefined;
        this.life.budget.retain(-this.chunk.length - this.snapshotBytes);
        this.chunk = new Uint8Array(); this.snapshotBytes = 0;
      }
    })();
  }
  async open(path?: string, stat?: FileStat): Promise<void> {
    const { context, signal, limits } = this.life.budget;
    await this.life.operation(async () => {
      let source: ByteSource;
      let acquisitionAborted = false;
      if (path === undefined) source = context.stdin;
      else {
        const fs = context.fs;
        const capabilitiesFor = fs.capabilitiesFor;
        this.life.assertOpen();
        const selected = capabilitiesFor ? await Reflect.apply(capabilitiesFor, fs, [path, { signal }]) : undefined;
        this.life.assertOpen();
        const capabilities = selected ?? fs.capabilities;
        this.life.assertOpen();
        const readStream = fs.readStream;
        this.life.assertOpen();
        const streaming = capabilities.streamingRead !== false;
        this.life.assertOpen();
        if (readStream && streaming) {
          source = Reflect.apply(readStream, fs, [path, { signal, chunkSize: limits.chunkSize }]);
          acquisitionAborted = signal.aborted || this.life.admission.closed;
        } else {
          const maximum = Math.min(limits.maxInputBytes, Math.floor(limits.maxBufferedBytes / 3));
          const size = stat!.size;
          this.life.assertOpen();
          this.life.budget.check(size, maximum, "buffered input bytes");
          this.life.budget.retain(maximum);
          this.snapshotBytes = maximum;
          const readFile = fs.readFile;
          this.life.assertOpen();
          const bytes = await Reflect.apply(readFile, fs, [path, { signal, maxBytes: maximum }]);
          this.life.assertOpen();
          if (!(bytes instanceof Uint8Array)) throw new TypeError("line-ending input requires bytes");
          this.life.budget.check(viewLength.call(bytes) as number, maximum, "buffered input bytes");
          source = { [Symbol.asyncIterator]: (async function* (this: Reader) { try { yield bytes; } finally { this.life.budget.retain(-this.snapshotBytes); this.snapshotBytes = 0; } }).bind(this) };
        }
      }
      if (!acquisitionAborted) this.life.assertOpen();
      const factory = source[Symbol.asyncIterator];
      if (!acquisitionAborted) this.life.assertOpen();
      this.iterator = Reflect.apply(factory, source, []);
    });
  }
  async get(): Promise<number> {
    await this.life.budget.step();
    this.life.assertOpen();
    while (this.offset === this.chunk.length) {
      if (this.ended) return -1;
      const next = await this.life.operation(() => {
        const iterator = this.iterator!;
        const advance = iterator.next;
        this.life.assertOpen();
        return Reflect.apply(advance, iterator, []);
      });
      this.life.budget.retain(-this.chunk.length); this.chunk = new Uint8Array(); this.offset = 0;
      const done = next.done;
      this.life.assertOpen();
      if (done) { this.ended = true; this.iterator = undefined; return -1; }
      const value = next.value;
      this.life.assertOpen();
      if (!(value instanceof Uint8Array)) throw new TypeError("line-ending input requires bytes");
      const buffer = viewBuffer.call(value) as ArrayBuffer;
      const offset = viewOffset.call(value) as number;
      const length = viewLength.call(value) as number;
      this.life.budget.incoming(length);
      this.life.budget.retain(length);
      try {
        if (viewOffset.call(value) !== offset || viewLength.call(value) < length) throw new TypeError("line-ending input extent changed during admission");
        this.chunk = new Uint8Array(new Uint8Array(buffer, offset, length));
      } catch (error) { this.life.budget.retain(-length); throw error; }
      if (!this.chunk.length) this.life.budget.check(++this.empties, this.life.budget.limits.maxEmptyChunks, "empty input chunks");
    }
    return this.chunk[this.offset++]!;
  }
}

export class Writer {
  private buffer: Uint8Array;
  private used = 0;
  constructor(readonly life: Lifecycle, readonly publish: (bytes: Uint8Array) => Promise<void>) {
    const size = Math.min(life.budget.limits.chunkSize, life.budget.limits.maxBufferedBytes);
    life.budget.retain(size);
    this.buffer = new Uint8Array(size);
    life.cleanup(async () => { this.release(); });
  }
  release(): void { this.life.budget.retain(-this.buffer.length); this.buffer = new Uint8Array(); this.used = 0; }
  async put(byte: number): Promise<void> {
    await this.life.budget.step();
    this.life.assertOpen();
    this.life.budget.emitted(1);
    this.buffer[this.used++] = byte;
    if (this.used === this.buffer.length) await this.flush();
  }
  async flush(): Promise<void> {
    this.life.assertOpen();
    if (this.used) { await this.publish(this.buffer.subarray(0, this.used)); this.used = 0; }
  }
}
