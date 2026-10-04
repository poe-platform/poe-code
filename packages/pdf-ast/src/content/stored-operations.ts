import type { PdfPaintOperation, PdfPixelStorage, PdfStoredOperations } from "../ast.js";

/** Bit 1: blend effects; bit 2: soft masks; bit 4: groups requiring a backdrop. */
export function operationEffects(operation: PdfPaintOperation): number {
  const value = operation.value;
  let effects =
    (value.softMask ? 2 : 0) |
    (value.blendMode && value.blendMode !== "Normal" && value.blendMode !== "Compatible" ? 1 : 0);
  if (operation.kind === "group") {
    let children = operation.value.storedOperations?.effects ?? 0;
    for (const child of operation.value.operations) children |= operationEffects(child);
    if (operation.value.isolated === false && children & 3) effects |= 4;
    effects |= children;
  }
  return effects;
}

/** Captures retain one operation's metadata at a time, independently of capture
 * length. Geometry, pixels and nested captures remain descriptors in the same
 * caller backing. Individual font/resource metadata has separate ownership. */
export class StoredOperationsWriter {
  private first = -1;
  private last = -1;
  private count = 0;
  private effects = 0;
  constructor(
    private readonly storage: PdfPixelStorage,
    private readonly signal?: AbortSignal
  ) {}
  async append(operation: PdfPaintOperation): Promise<void> {
    this.signal?.throwIfAborted();
    const text = JSON.stringify(operation, (key, value: unknown) => {
      if (key === "storage") {
        if (value !== this.storage)
          throw new TypeError("Captured resources must share caller backing");
        return null;
      }
      if (value instanceof Uint8Array) return { $pdfBytes: Array.from(value) };
      if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0)))
        return { $pdfNumber: Object.is(value, -0) ? "-0" : String(value) };
      return value;
    });
    const length = text.length * 2,
      position = this.storage.allocate(16 + length);
    if (
      !Number.isSafeInteger(position) ||
      position < 0 ||
      !Number.isSafeInteger(position + 16 + length)
    )
      throw new RangeError("Invalid capture allocation");
    const header = new Uint8Array(16),
      view = new DataView(header.buffer);
    view.setFloat64(0, -1, true);
    view.setFloat64(8, length, true);
    await this.storage.write(position, header, this.signal ? { signal: this.signal } : undefined);
    const bytes = new Uint8Array(Math.min(4096, length)),
      data = new DataView(bytes.buffer);
    for (let offset = 0; offset < text.length; offset += 2048) {
      this.signal?.throwIfAborted();
      const size = Math.min(2048, text.length - offset);
      for (let i = 0; i < size; i++) data.setUint16(i * 2, text.charCodeAt(offset + i), true);
      await this.storage.write(
        position + 16 + offset * 2,
        bytes.subarray(0, size * 2),
        this.signal ? { signal: this.signal } : undefined
      );
    }
    if (this.last >= 0) {
      view.setFloat64(0, position, true);
      await this.storage.write(
        this.last,
        header.subarray(0, 8),
        this.signal ? { signal: this.signal } : undefined
      );
    }
    this.signal?.throwIfAborted();
    if (this.first < 0) this.first = position;
    this.last = position;
    this.count++;
    this.effects |= operationEffects(operation);
  }
  snapshot(): PdfStoredOperations {
    return {
      kind: "stored-operations",
      storage: this.storage,
      position: this.first,
      count: this.count,
      effects: this.effects
    };
  }
}

export async function* readStoredOperations(
  source: PdfStoredOperations,
  signal?: AbortSignal
): AsyncGenerator<PdfPaintOperation> {
  if (!Number.isSafeInteger(source.count) || source.count < 0)
    throw new RangeError("Invalid capture count");
  let position = source.position;
  for (let record = 0; record < source.count; record++) {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(position) || position < 0)
      throw new RangeError("Invalid capture position");
    const header = await source.storage.read(position, 16, signal ? { signal } : undefined);
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
        bytes = await source.storage.read(
          position + 16 + offset,
          size,
          signal ? { signal } : undefined
        );
      if (bytes.length !== size) throw new Error("Incomplete capture record");
      text += decoder.decode(bytes, { stream: true });
    }
    text += decoder.decode();
    signal?.throwIfAborted();
    yield JSON.parse(text, (key, value: unknown) => {
      if (key === "storage") return source.storage;
      if (value && typeof value === "object") {
        if ("$pdfBytes" in value) return Uint8Array.from(value.$pdfBytes as number[]);
        if ("$pdfNumber" in value) return Number(value.$pdfNumber);
      }
      return value;
    }) as PdfPaintOperation;
    position = next;
  }
}
