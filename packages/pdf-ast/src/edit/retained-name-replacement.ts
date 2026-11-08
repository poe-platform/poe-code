import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";

/** Match the editor's literal /name search, including comments and strings.
 * Prefix fallback lives on caller storage, even for a single very long name. */
export async function* replaceRetainedPdfName(input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, oldName: string, newName: string,
  storage: PdfIndexStorage, options: { chunkBytes?: number; maxOutputBytes?: number; signal?: AbortSignal } = {}): AsyncGenerator<Uint8Array> {
  const chunkBytes = options.chunkBytes ?? 16384, maximum = options.maxOutputBytes ?? Infinity;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new RangeError("Invalid name replacement chunk size");
  if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid name replacement output limit");
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const table = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4), length = oldName.length + 1;
  const base = table.allocate(length * 8), record = new Uint8Array(8), view = new DataView(record.buffer);
  const pattern = (at: number) => at ? oldName.charCodeAt(at - 1) : 47;
  let buffer = new Uint8Array(chunkBytes), used = 0, total = 0, work = 0, failed = false;
  function checkpoint(): Promise<void> | undefined {
    signal.throwIfAborted();
    if (++work % 16384 === 0) return new Promise<void>(resolve => setTimeout(resolve, 0)).then(() => { signal.throwIfAborted(); });
  }
  async function prefix(at: number) { const bytes = await table.read(base + at * 8, 8); return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0); }
  function emit(byte: number): Uint8Array | undefined {
    if (total >= maximum) throw new PdfError("E_LIMIT", "PDF name replacement output limit exceeded");
    total++; buffer[used++] = byte & 255;
    if (used !== chunkBytes) return;
    const output = buffer; buffer = new Uint8Array(chunkBytes); used = 0; return output;
  }
  async function* units(count: number, code: (at: number) => number) {
    for (let at = 0; at < count; at++) { const pending = checkpoint(); if (pending) await pending; const output = emit(code(at)); if (output) yield output; }
  }
  const delimiter = (byte: number) => [32, 9, 10, 13, 47, 60, 62, 91, 93, 40, 41].includes(byte);
  try {
    let border = 0;
    for (let at = 1; at < length; at++) {
      const pending = checkpoint(); if (pending) await pending;
      while (border && pattern(at) !== pattern(border)) border = await prefix(border - 1);
      if (pattern(at) === pattern(border)) border++;
      view.setFloat64(0, border); await table.write(base + at * 8, record);
    }
    let matched = 0;
    for await (const bytes of input) for (const byte of bytes) {
      const pending = checkpoint(); if (pending) await pending;
      if (matched === length) {
        if (delimiter(byte)) yield* units(newName.length + 1, at => at ? newName.charCodeAt(at - 1) : 47);
        else yield* units(length, pattern);
        matched = 0;
      }
      while (matched && byte !== pattern(matched)) {
        const next = await prefix(matched - 1);
        yield* units(matched - next, pattern); matched = next;
      }
      if (byte === pattern(matched)) matched++;
      else { const output = emit(byte); if (output) yield output; }
    }
    if (matched === length) yield* units(newName.length + 1, at => at ? newName.charCodeAt(at - 1) : 47);
    else yield* units(matched, pattern);
    if (used) yield buffer.subarray(0, used);
    signal.throwIfAborted();
  } catch (error) { failed = true; throw error; }
  finally { await table.close().catch(error => { if (!failed) throw error; }); }
}
