import type { ByteSource } from "./runtime.js";
import type { ZipMetadataStorage } from "./zip-index.js";

/** A sequential byte chain whose headers and payloads live in caller storage.
 * Only the endpoints and total sizes are retained between transfers. */
export class ZipWriteChain {
  private head = 0;
  private tail = 0;
  private count = 0;
  length = 0;
  constructor(private readonly storage: ZipMetadataStorage, private readonly chunkSize: number,
    private readonly signal: AbortSignal, private readonly checkpoint: (signal: AbortSignal) => Promise<void>) {}

  async append(source: ByteSource | Iterable<Uint8Array>, length: number): Promise<void> {
    this.signal.throwIfAborted();
    const position = this.storage.allocate(16 + length);
    if (!Number.isSafeInteger(position) || position <= 0 || !Number.isSafeInteger(position + 16 + length))
      throw new RangeError("Invalid ZIP storage address");
    const header = new Uint8Array(16), view = new DataView(header.buffer);
    view.setFloat64(8, length, true);
    await this.storage.write(position, header);
    this.signal.throwIfAborted();
    let written = 0;
    for await (const chunk of source) {
      this.signal.throwIfAborted();
      if (!(chunk instanceof Uint8Array) || chunk.length > length - written) throw new RangeError("ZIP compressed size mismatch");
      for (let offset = 0; offset < chunk.length; offset += this.chunkSize) {
        this.signal.throwIfAborted();
        const bytes = chunk.subarray(offset, offset + this.chunkSize);
        await this.storage.write(position + 16 + written, bytes);
        written += bytes.length;
        await this.checkpoint(this.signal);
      }
      if (!chunk.length) await this.checkpoint(this.signal);
    }
    this.signal.throwIfAborted();
    if (written !== length) throw new RangeError("ZIP compressed size mismatch");
    if (this.tail) {
      const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, position, true);
      await this.storage.write(this.tail, link);
    } else this.head = position;
    this.tail = position; this.count++; this.length += length;
  }

  /** Transfer an already staged chain without copying its payload. */
  async join(other: ZipWriteChain): Promise<void> {
    this.signal.throwIfAborted();
    if (other === this || other.storage !== this.storage) throw new TypeError("Invalid ZIP storage chain transfer");
    if (!other.count) return;
    if (this.tail) {
      const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, other.head, true);
      await this.storage.write(this.tail, link);
    } else this.head = other.head;
    this.tail = other.tail; this.count += other.count; this.length += other.length;
    other.head = 0; other.tail = 0; other.count = 0; other.length = 0;
  }

  async *read(): AsyncGenerator<Uint8Array> {
    let position = this.head, total = 0;
    for (let index = 0; index < this.count; index++) {
      this.signal.throwIfAborted();
      if (!Number.isSafeInteger(position) || position <= 0) throw new RangeError("Invalid ZIP storage link");
      const header = new Uint8Array(await this.storage.read(position, 16));
      if (header.length !== 16) throw new RangeError("Truncated ZIP storage header");
      const view = new DataView(header.buffer), next = view.getFloat64(0, true), length = view.getFloat64(8, true);
      if (!Number.isSafeInteger(length) || length < 0 || length > this.length - total || !Number.isSafeInteger(position + 16 + length))
        throw new RangeError("Invalid ZIP storage length");
      for (let offset = 0; offset < length; offset += this.chunkSize) {
        this.signal.throwIfAborted();
        const size = Math.min(this.chunkSize, length - offset);
        const bytes = new Uint8Array(await this.storage.read(position + 16 + offset, size));
        this.signal.throwIfAborted();
        if (bytes.length !== size) throw new RangeError("Truncated ZIP storage payload");
        yield bytes;
        await this.checkpoint(this.signal);
      }
      total += length; position = next;
    }
    if (position !== 0 || total !== this.length) throw new RangeError("Invalid ZIP storage chain");
    this.signal.throwIfAborted();
  }
}
