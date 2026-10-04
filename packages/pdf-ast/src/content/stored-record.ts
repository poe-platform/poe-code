import type { PdfPixelStorage } from "../ast.js";

/** One admitted metadata value per record. Large geometry/pixel data is represented
 * by caller-backed descriptors. All record I/O uses fixed-size ranges. */
export async function writeStoredRecord(
  storage: PdfPixelStorage,
  value: unknown,
  next = -1,
  signal?: AbortSignal
): Promise<number> {
  signal?.throwIfAborted();
  const text = JSON.stringify(value, (key, value: unknown) => {
    if (key === "storage") {
      if (value !== storage) throw new TypeError("Captured resources must share caller backing");
      return null;
    }
    if (value instanceof Uint8Array) return { $pdfBytes: Array.from(value) };
    if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0)))
      return { $pdfNumber: Object.is(value, -0) ? "-0" : String(value) };
    return value;
  });
  const length = text.length * 2,
    position = storage.allocate(16 + length);
  if (
    !Number.isSafeInteger(position) ||
    position < 0 ||
    !Number.isSafeInteger(position + 16 + length)
  )
    throw new RangeError("Invalid capture allocation");
  const header = new Uint8Array(16),
    view = new DataView(header.buffer);
  view.setFloat64(0, next, true);
  view.setFloat64(8, length, true);
  await storage.write(position, header, signal ? { signal: signal } : undefined);
  const bytes = new Uint8Array(Math.min(4096, length)),
    data = new DataView(bytes.buffer);
  for (let offset = 0; offset < text.length; offset += 2048) {
    signal?.throwIfAborted();
    const size = Math.min(2048, text.length - offset);
    for (let i = 0; i < size; i++) data.setUint16(i * 2, text.charCodeAt(offset + i), true);
    await storage.write(
      position + 16 + offset * 2,
      bytes.subarray(0, size * 2),
      signal ? { signal: signal } : undefined
    );
  }
  signal?.throwIfAborted();
  return position;
}

export async function readStoredRecord<T>(
  storage: PdfPixelStorage,
  position: number,
  signal?: AbortSignal
): Promise<{ value: T; next: number }> {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(position) || position < 0)
    throw new RangeError("Invalid capture position");
  const header = await storage.read(position, 16, signal ? { signal } : undefined);
  if (header.length !== 16) throw new Error("Incomplete capture header");
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength),
    next = view.getFloat64(0, true),
    length = view.getFloat64(8, true);
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length % 2 !== 0 ||
    !Number.isSafeInteger(position + 16 + length)
  )
    throw new RangeError("Invalid capture length");
  const decoder = new TextDecoder("utf-16le");
  let text = "";
  for (let offset = 0; offset < length; offset += 4096) {
    signal?.throwIfAborted();
    const size = Math.min(4096, length - offset),
      bytes = await storage.read(position + 16 + offset, size, signal ? { signal } : undefined);
    if (bytes.length !== size) throw new Error("Incomplete capture record");
    text += decoder.decode(bytes, { stream: true });
  }
  text += decoder.decode();
  signal?.throwIfAborted();
  const value = JSON.parse(text, (key, value: unknown) => {
    if (key === "storage") return storage;
    if (value && typeof value === "object") {
      if ("$pdfBytes" in value) return Uint8Array.from(value.$pdfBytes as number[]);
      if ("$pdfNumber" in value) return Number(value.$pdfNumber);
    }
    return value;
  }) as T;
  return { value, next };
}

/** Persistent linked frames; only the frame currently being read is resident. */
export class StoredMetadataStack<T> {
  private head = -1;
  private count = 0;
  constructor(
    private readonly storage: PdfPixelStorage,
    private readonly signal?: AbortSignal
  ) {}
  get length(): number {
    return this.count;
  }
  async push(value: T): Promise<void> {
    const position = await writeStoredRecord(this.storage, value, this.head, this.signal);
    this.head = position;
    this.count++;
  }
  async pop(): Promise<T | undefined> {
    this.signal?.throwIfAborted();
    if (!this.count) return undefined;
    const record = await readStoredRecord<T>(this.storage, this.head, this.signal);
    this.head = record.next;
    this.count--;
    return record.value;
  }
}
