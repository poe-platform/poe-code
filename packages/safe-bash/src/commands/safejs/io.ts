import { yieldTurn } from "../../contracts/yield.js";
import { readBytes, writeBytes, type ByteSink, type ByteSource } from "../../contracts/index.js";
import { SafeJsCommandLimitError } from "./types.js";
import { renderOutput } from "./render.js";

const chunkSize = 64 * 1024;

export class GuestInput {
  private readonly iterator: AsyncGenerator<Uint8Array>;
  private pending: Uint8Array = new Uint8Array();
  private consumed = 0;
  private pulls = 0;
  private queue = Promise.resolve();
  constructor(source: ByteSource, private readonly limit: number, private readonly signal: AbortSignal,
    private readonly fail: (error: unknown) => void, private readonly resource: "maxSourceBytes" | "maxInputBytes" = "maxInputBytes") {
    this.iterator = readBytes(source, signal);
  }
  private async take(size: number): Promise<Uint8Array | undefined> {
    this.signal.throwIfAborted();
    while (!this.pending.length) {
      if (++this.pulls % 64 === 0) await yieldTurn(this.signal);
      const next = await this.iterator.next();
      if (next.done) return undefined;
      this.pending = next.value;
    }
    const length = Math.min(size, this.pending.length);
    if (length > this.limit - this.consumed) {
      const error = new SafeJsCommandLimitError(this.resource); this.fail(error); throw error;
    }
    const bytes = this.pending.slice(0, length);
    this.pending = this.pending.subarray(length);
    this.consumed += length;
    return bytes;
  }
  private serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.queue.then(operation);
    this.queue = result.then(() => {}, () => {});
    return result;
  }
  readBytes(size: unknown = chunkSize): Promise<number[] | null> {
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > chunkSize) throw new TypeError("readBytes size must be an integer from 1 through 65536");
    return this.serialize(async () => { const bytes = await this.take(size); return bytes === undefined ? null : Array.from(bytes); });
  }
  readText(): Promise<string> {
    return this.serialize(async () => {
      const pieces: Uint8Array[] = [];
      for (;;) { const chunk = await this.take(chunkSize); if (!chunk) break; pieces.push(chunk); }
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(pieces));
    });
  }
  async close(): Promise<void> { await this.iterator.return(undefined); }
}

export class GuestOutput {
  private queue = Promise.resolve();
  private produced = 0;
  stderrFailed = false;
  constructor(private readonly stdout: ByteSink, private readonly stderr: ByteSink, private readonly limit: number,
    private readonly signal: AbortSignal, private readonly fail: (error: unknown) => void) {}
  private enqueue(bytes: Uint8Array, target: ByteSink): Promise<void> {
    this.signal.throwIfAborted();
    if (bytes.length > this.limit - this.produced) {
      const error = new SafeJsCommandLimitError("maxOutputBytes"); this.fail(error); throw error;
    }
    this.produced += bytes.length;
    const queued = this.queue.then(async () => {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) await writeBytes(target, bytes.subarray(offset, offset + chunkSize), this.signal);
    }).catch(error => { if (target === this.stderr) this.stderrFailed = true; this.fail(error); throw error; });
    this.queue = queued;
    void queued.catch(() => {});
    return queued;
  }
  text(value: unknown, stderr = false): Promise<void> {
    if (typeof value !== "string") throw new TypeError("stdio text output requires a string");
    if (Buffer.byteLength(value) > this.limit - this.produced) {
      const error = new SafeJsCommandLimitError("maxOutputBytes"); this.fail(error); throw error;
    }
    return this.enqueue(Buffer.from(value), stderr ? this.stderr : this.stdout);
  }
  bytes(value: unknown, stderr = false): Promise<void> {
    if (!Array.isArray(value) || value.length > chunkSize) throw new TypeError("stdio byte output requires an array of at most 65536 bytes");
    for (const byte of value) if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new TypeError("stdio byte values must be integers from 0 through 255");
    return this.enqueue(Uint8Array.from(value as number[]), stderr ? this.stderr : this.stdout);
  }
  console(args: readonly unknown[], stderr: boolean): void {
    void this.text(renderOutput(args, this.limit - this.produced, this.fail), stderr);
  }
  result(value: unknown): Promise<void> {
    return this.text(renderOutput([value], this.limit - this.produced, this.fail));
  }
  async drain(): Promise<void> { await this.queue; }
}
