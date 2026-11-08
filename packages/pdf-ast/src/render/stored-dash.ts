import type { PdfStoredDash } from "../ast.js";
import type { StrokeDashPattern } from "./stroke.js";

/** One owned read page; borrowed capability buffers never escape an I/O turn. */
export function storedStrokeDash(dash: PdfStoredDash, scale: number,
  io: (action: () => Promise<void>) => Generator<null, void, void>, signal?: AbortSignal): StrokeDashPattern {
  if (!Number.isSafeInteger(dash.position) || dash.position < 0 || !Number.isSafeInteger(dash.length * 8) || dash.length < 0 || !Number.isSafeInteger(dash.position + dash.length * 8)) throw new RangeError("Invalid stored dash");
  const bytes = new Uint8Array(4096), view = new DataView(bytes.buffer);
  let cached = -1;
  return { length: dash.length, total: dash.total * scale,
    *get(index) {
      signal?.throwIfAborted();
      if (!Number.isSafeInteger(index) || index < 0 || index >= dash.length) throw new RangeError("Invalid dash index");
      const page = Math.floor(index / 512);
      if (page !== cached) {
        yield* io(async () => {
          const length = Math.min(4096, (dash.length - page * 512) * 8);
          const part = await dash.storage.read(dash.position + page * 4096, length, signal ? { signal } : undefined);
          signal?.throwIfAborted();
          if (part.length !== length) throw new Error("Incomplete stored dash pattern");
          bytes.set(part); cached = page;
        });
      }
      return Math.max(0, view.getFloat64((index % 512) * 8, true) * scale);
    }
  };
}
