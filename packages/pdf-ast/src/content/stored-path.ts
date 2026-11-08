import type { PdfPathSegment, PdfPixelStorage, PdfStoredPath } from "../ast.js";

const BLOCK_BYTES = 4096, RECORD_BYTES = 56, RECORDS = Math.floor((BLOCK_BYTES - 8) / RECORD_BYTES);
const kinds = ["close", "move", "line", "cubic", "rect"] as const;

/** Fixed-size linked blocks avoid an in-memory block index, including when
 * nested parsers interleave allocations in the caller's backing store. */
export class StoredPathWriter {
  private readonly bytes = new Uint8Array(BLOCK_BYTES);
  private readonly view = new DataView(this.bytes.buffer);
  private first = -1;
  private position = -1;
  private used = 0;
  private count = 0;
  private finished = false;
  private readonly bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  constructor(private readonly storage: PdfPixelStorage, private readonly signal?: AbortSignal) {}
  private allocate(): number {
    const at = this.storage.allocate(BLOCK_BYTES);
    if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(at + BLOCK_BYTES)) throw new RangeError("Invalid PDF path allocation");
    return at;
  }
  async append(segment: PdfPathSegment): Promise<void> {
    this.signal?.throwIfAborted();
    if (this.finished) throw new Error("PDF path is already finished");
    if (this.position === -1) this.first = this.position = this.allocate();
    if (this.used === RECORDS) {
      const next = this.allocate(); this.view.setFloat64(0, next, true);
      await this.storage.write(this.position, this.bytes, this.signal ? {signal:this.signal} : undefined);
      this.position = next; this.used = 0;
    }
    const at = 8 + this.used++ * RECORD_BYTES;
    this.view.setFloat64(at, kinds.indexOf(segment.kind), true);
    const values = segment.kind === "close" ? [] : segment.kind === "cubic"
      ? [segment.x, segment.y, segment.x1, segment.y1, segment.x2, segment.y2]
      : segment.kind === "rect" ? [segment.x, segment.y, segment.width, segment.height] : [segment.x, segment.y];
    for (let i = 0; i < values.length; i++) this.view.setFloat64(at + 8 + i * 8, values[i]!, true);
    const include = (x: number, y: number) => {
      this.bounds[0] = Math.min(this.bounds[0], x); this.bounds[1] = Math.min(this.bounds[1], y);
      this.bounds[2] = Math.max(this.bounds[2], x); this.bounds[3] = Math.max(this.bounds[3], y);
    };
    if (segment.kind !== "close") include(segment.x, segment.y);
    if (segment.kind === "cubic") { include(segment.x1, segment.y1); include(segment.x2, segment.y2); }
    if (segment.kind === "rect") include(segment.x + segment.width, segment.y + segment.height);
    this.count++;
  }
  async finish(): Promise<PdfStoredPath> {
    this.signal?.throwIfAborted();
    if (this.finished) throw new Error("PDF path is already finished");
    this.finished = true;
    if (this.position !== -1) {
      this.view.setFloat64(0, -1, true);
      await this.storage.write(this.position, this.bytes.subarray(0, 8 + this.used * RECORD_BYTES), this.signal ? {signal:this.signal} : undefined);
    }
    return {kind:"stored-path",storage:this.storage,position:this.first,count:this.count,bounds:this.bounds};
  }
}

export async function* readStoredPath(path: PdfStoredPath, signal?: AbortSignal): AsyncGenerator<PdfPathSegment> {
  let position = path.position, remaining = path.count;
  while (remaining > 0) {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(position) || position < 0) throw new Error("Invalid PDF path block");
    const count = Math.min(RECORDS, remaining), length = 8 + count * RECORD_BYTES;
    // The capability may reuse its read buffer while a consumer is suspended.
    const bytes = (await path.storage.read(position, length, signal ? {signal} : undefined)).slice();
    if (bytes.length !== length) throw new Error("Incomplete PDF path block");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    position = view.getFloat64(0, true);
    for (let i = 0; i < count; i++) {
      signal?.throwIfAborted();
      const at = 8 + i * RECORD_BYTES, kind = kinds[view.getFloat64(at, true)];
      const value = (n: number) => view.getFloat64(at + 8 + n * 8, true);
      if (kind === "close") yield {kind};
      else if (kind === "move" || kind === "line") yield {kind,x:value(0),y:value(1)};
      else if (kind === "rect") yield {kind,x:value(0),y:value(1),width:value(2),height:value(3)};
      else if (kind === "cubic") yield {kind,x:value(0),y:value(1),x1:value(2),y1:value(3),x2:value(4),y2:value(5)};
      else throw new Error("Invalid PDF path record");
    }
    remaining -= count;
  }
}
