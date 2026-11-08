import type { PdfClipPath, PdfPixelStorage, PdfStoredClipPaths, PdfStoredPath } from "../ast.js";
import { StoredPathWriter, readStoredPath } from "./stored-path.js";

const PAGE_BYTES = 4096,
  RECORD_BYTES = 64,
  LEAF_ENTRIES = PAGE_BYTES / RECORD_BYTES,
  BRANCH_ENTRIES = PAGE_BYTES / 8;
function validate(source: PdfStoredClipPaths): void {
  if (
    !Number.isSafeInteger(source.count) ||
    source.count < 0 ||
    !Number.isInteger(source.height) ||
    source.height < 0 ||
    source.height > 6 ||
    source.count > LEAF_ENTRIES * BRANCH_ENTRIES ** source.height
  )
    throw new RangeError("Invalid stored clip vector");
}
async function page(
  storage: PdfPixelStorage,
  position: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(position) || position < 0)
    throw new RangeError("Invalid clip page position");
  const bytes = (await storage.read(position, PAGE_BYTES, signal ? { signal } : undefined)).slice();
  if (bytes.length !== PAGE_BYTES) throw new Error("Incomplete clip page");
  return bytes;
}
async function writePage(
  storage: PdfPixelStorage,
  bytes: Uint8Array,
  signal?: AbortSignal
): Promise<number> {
  signal?.throwIfAborted();
  const position = storage.allocate(PAGE_BYTES);
  if (
    !Number.isSafeInteger(position) ||
    position < 0 ||
    !Number.isSafeInteger(position + PAGE_BYTES)
  )
    throw new RangeError("Invalid clip page allocation");
  await storage.write(position, bytes, signal ? { signal } : undefined);
  signal?.throwIfAborted();
  return position;
}
function blank(height: number): Uint8Array {
  const bytes = new Uint8Array(PAGE_BYTES);
  if (height > 0) {
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < PAGE_BYTES; i += 8) view.setFloat64(i, -1, true);
  }
  return bytes;
}

/** Path copying keeps prior q/Q and paint snapshots immutable. A leaf holds 64
 * clips; internal pages hold 512 children. At most seven pages are live during
 * append/traversal, even at the maximum safe integer clip count. */
export async function appendStoredClip(
  storage: PdfPixelStorage,
  previous: PdfStoredClipPaths | undefined,
  clip: PdfClipPath,
  signal?: AbortSignal
): Promise<PdfStoredClipPaths> {
  signal?.throwIfAborted();
  if (previous) validate(previous);
  if (previous && previous.storage !== storage)
    throw new TypeError("Clip snapshots must share caller backing");
  const count = previous?.count ?? 0;
  if (!Number.isSafeInteger(count + 1)) throw new RangeError("Clip count overflow");
  const value = "segments" in clip ? clip : { segments: clip, fillRule: "nonzero" as const };
  let path: PdfStoredPath | undefined = "segments" in clip ? clip.storedSegments : undefined;
  if (!path || path.storage !== storage) {
    const writer = new StoredPathWriter(storage, signal);
    if (path)
      for await (const segment of readStoredPath(path, signal)) await writer.append(segment);
    else for (const segment of value.segments) await writer.append(segment);
    path = await writer.finish();
  }
  const record = new Uint8Array(RECORD_BYTES),
    recordView = new DataView(record.buffer);
  recordView.setFloat64(0, path.position, true);
  recordView.setFloat64(8, path.count, true);
  for (let i = 0; i < 4; i++) recordView.setFloat64(16 + i * 8, path.bounds[i]!, true);
  recordView.setFloat64(48, value.fillRule === "evenodd" ? 1 : 0, true);
  let height = previous?.height ?? 0,
    root = previous?.position ?? -1;
  if (count === LEAF_ENTRIES * BRANCH_ENTRIES ** height) {
    height++;
    const bytes = blank(height);
    new DataView(bytes.buffer).setFloat64(0, root, true);
    root = await writePage(storage, bytes, signal);
  }
  async function append(position: number, level: number, index: number): Promise<number> {
    const bytes = position < 0 ? blank(level) : await page(storage, position, signal),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (level === 0) bytes.set(record, index * RECORD_BYTES);
    else {
      const capacity = LEAF_ENTRIES * BRANCH_ENTRIES ** (level - 1),
        slot = Math.floor(index / capacity);
      view.setFloat64(
        slot * 8,
        await append(view.getFloat64(slot * 8, true), level - 1, index % capacity),
        true
      );
    }
    return writePage(storage, bytes, signal);
  }
  return {
    kind: "stored-clips",
    storage,
    position: await append(root, height, count),
    count: count + 1,
    height
  };
}

export async function* readStoredClips(
  source: PdfStoredClipPaths,
  signal?: AbortSignal
): AsyncGenerator<Extract<PdfClipPath, { segments: unknown }>> {
  validate(source);
  async function* walk(
    position: number,
    height: number,
    count: number
  ): AsyncGenerator<Extract<PdfClipPath, { segments: unknown }>> {
    const bytes = await page(source.storage, position, signal),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (height === 0) {
      for (let i = 0; i < count; i++) {
        signal?.throwIfAborted();
        const at = i * RECORD_BYTES;
        yield {
          segments: [],
          fillRule: view.getFloat64(at + 48, true) === 1 ? "evenodd" : "nonzero",
          storedSegments: {
            kind: "stored-path",
            storage: source.storage,
            position: view.getFloat64(at, true),
            count: view.getFloat64(at + 8, true),
            bounds: [
              view.getFloat64(at + 16, true),
              view.getFloat64(at + 24, true),
              view.getFloat64(at + 32, true),
              view.getFloat64(at + 40, true)
            ]
          }
        };
      }
    } else {
      const capacity = LEAF_ENTRIES * BRANCH_ENTRIES ** (height - 1);
      for (let i = 0; count > 0; i++) {
        const selected = Math.min(count, capacity);
        yield* walk(view.getFloat64(i * 8, true), height - 1, selected);
        count -= selected;
      }
    }
  }
  if (source.count) yield* walk(source.position, source.height, source.count);
}
