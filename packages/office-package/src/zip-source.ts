/** Random reads from one stable caller-owned object. A retained safe-fs handle
 * can implement read directly. The caller keeps it open until all entries have
 * been consumed and closes it on every outcome. No ambient file access occurs.
 */
export interface ZipSource {
  readonly size: number;
  read(position: number, maxBytes: number, options: {readonly signal: AbortSignal}): Promise<Uint8Array>;
}

/** One metadata record at a time; payload reads bypass the metadata window. */
export class ZipWindow {
  private pending: Promise<void> = Promise.resolve();
  private start = 0;
  private bytes: Uint8Array = new Uint8Array();
  private view = new DataView(this.bytes.buffer);
  constructor(
    private readonly source: ZipSource,
    private readonly chunkSize: number,
    private readonly signal: AbortSignal,
    private readonly yieldTurn: (signal: AbortSignal) => Promise<void>,
    private readonly fail: (message: string) => never
  ) {}

  async read(start: number, length: number, signal = this.signal): Promise<Uint8Array> {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > this.source.size)
      this.fail("ZIP truncated archive range");
    signal.throwIfAborted();
    const bytes = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const maximum = Math.min(this.chunkSize, length - offset);
      // Multiple member iterators may share a reader. Own each response before
      // another read can reuse its backing buffer, including after a rejection.
      const request = this.pending.then(async () => {
        signal.throwIfAborted();
        const chunk = await this.source.read(start + offset, maximum, {signal});
        signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array) || !chunk.length || chunk.length > maximum)
          this.fail("ZIP truncated or invalid archive range");
        bytes.set(chunk, offset);
        return chunk.length;
      });
      this.pending = request.then(() => {}, () => {});
      offset += await request;
      await this.yieldTurn(signal);
      signal.throwIfAborted();
    }
    return bytes;
  }

  async load(start: number, end: number): Promise<void> {
    this.bytes = await this.read(start, end - start);
    this.start = start;
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }

  subarray(start: number, end: number): Uint8Array {
    if (start < this.start || end < start || end > this.byteLength) this.fail("ZIP truncated metadata");
    return this.bytes.subarray(start - this.start, end - this.start);
  }
  get byteLength(): number { return this.start + this.bytes.length; }
  getUint16(offset: number, littleEndian: boolean): number { return this.view.getUint16(offset - this.start, littleEndian); }
  getUint32(offset: number, littleEndian: boolean): number { return this.view.getUint32(offset - this.start, littleEndian); }
  getBigUint64(offset: number, littleEndian: boolean): bigint { return this.view.getBigUint64(offset - this.start, littleEndian); }
}
