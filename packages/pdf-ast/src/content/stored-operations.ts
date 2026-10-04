import { readStoredRecord, writeStoredRecord } from "./stored-record.js";
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
    const position = await writeStoredRecord(this.storage, operation, -1, this.signal);
    const header = new Uint8Array(8),
      view = new DataView(header.buffer);
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
    const { value, next } = await readStoredRecord<PdfPaintOperation>(
      source.storage,
      position,
      signal
    );
    yield value;
    position = next;
  }
}
