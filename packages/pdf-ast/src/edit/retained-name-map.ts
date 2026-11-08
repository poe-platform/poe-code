import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { PdfIndexStorage } from "../cos/object-index.js";

/** Replace complete ASCII resource-name tokens in one pass, including strings
 * and comments. Trie nodes, replacement bytes and pending prefixes use caller storage. */
export async function* replaceRetainedPdfNames(input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, names: AsyncIterable<readonly [string, string]> | Iterable<readonly [string, string]>, storage: PdfIndexStorage,
  options: { signal?: AbortSignal; chunkBytes?: number } = {}): AsyncGenerator<Uint8Array> {
  const signal = options.signal ?? new AbortController().signal, size = options.chunkBytes ?? 16384;
  if (!Number.isSafeInteger(size) || size < 1) throw new RangeError("Invalid name replacement chunk size");
  const trie = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4), pending = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const root = trie.allocate(40), prefixBase = pending.allocate(0); let output = new Uint8Array(size), used = 0, failed = false, work = 0;
  const body = (byte: number) => byte >= 48 && byte <= 57 || byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122 || [95, 46, 43, 45].includes(byte);
  async function checkpoint() { signal.throwIfAborted(); if (++work % 16384 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); }
  async function get(at: number) { const bytes = await trie.read(at, 40); return new DataView(bytes.buffer, bytes.byteOffset, bytes.length); }
  async function put(at: number, row: DataView) { await trie.write(at, new Uint8Array(row.buffer, row.byteOffset, row.byteLength)); }
  async function child(at: number, byte: number, create: boolean): Promise<number | undefined> {
    const parent = await get(at); let current = parent.getFloat64(0);
    while (current) { const row = await get(current); if (row.getFloat64(16) === byte) return current; current = row.getFloat64(8); }
    if (!create) return;
    const next = trie.allocate(40), row = new DataView(new ArrayBuffer(40)); row.setFloat64(8, parent.getFloat64(0)); row.setFloat64(16, byte); await put(next, row); parent.setFloat64(0, next); await put(at, parent); return next;
  }
  function emit(byte: number) { output[used++] = byte; if (used === size) { const full = output; output = new Uint8Array(size); used = 0; return full; } }
  async function* replay(store: PagedStorage, start: number, length: number) {
    for (let at = 0; at < length; at += size) for (const byte of await store.read(start + at, Math.min(size, length - at))) { await checkpoint(); const full = emit(byte); if (full) yield full; }
  }
  try {
    for await (const [name, replacement] of names) {
      let node = root, valid = true;
      for (let i = 0; i < name.length; i++) { await checkpoint(); if (!body(name.charCodeAt(i))) { valid = false; break; } node = (await child(node, name.charCodeAt(i), true))!; }
      if (!valid) continue;
      const start = trie.allocate(replacement.length), row = await get(node); row.setFloat64(24, start + 1); row.setFloat64(32, replacement.length); await put(node, row);
      for (let at = 0; at < replacement.length; at += size) { const bytes = new Uint8Array(Math.min(size, replacement.length - at)); for (let i = 0; i < bytes.length; i++) bytes[i] = replacement.charCodeAt(at + i); await trie.write(start + at, bytes); }
    }
    let matching = false, node = root, length = 0, capacity = 0, buffered = 0; const prefix = new Uint8Array(size);
    async function flushPrefix() { if (buffered) { if (length > capacity) { pending.allocate(length - capacity); capacity = length; } await pending.write(prefixBase + length - buffered, prefix.subarray(0, buffered)); buffered = 0; } }
    async function* finish() {
      await flushPrefix(); const row = await get(node), replacement = row.getFloat64(24); const slash = emit(47); if (slash) yield slash;
      if (replacement) yield* replay(trie, replacement - 1, row.getFloat64(32)); else yield* replay(pending, prefixBase, length);
      matching = false;
    }
    for await (const bytes of input) for (const byte of bytes) {
      await checkpoint();
      if (matching && body(byte)) {
        const next = await child(node, byte, false);
        if (next !== undefined) { node = next; prefix[buffered++] = byte; length++; if (buffered === size) await flushPrefix(); continue; }
        await flushPrefix(); const slash = emit(47); if (slash) yield slash; yield* replay(pending, prefixBase, length); matching = false;
      } else if (matching) yield* finish();
      if (byte === 47) { matching = true; node = root; length = 0; buffered = 0; }
      else { const full = emit(byte); if (full) yield full; }
    }
    if (matching) yield* finish(); if (used) yield output.subarray(0, used);
  } catch (error) { failed = true; throw error; }
  finally { const results = await Promise.allSettled([trie.close(), pending.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
}
