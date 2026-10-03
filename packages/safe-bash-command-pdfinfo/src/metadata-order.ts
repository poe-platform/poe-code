import { PdfFileSource, type PdfIndexStorage } from "@poe-code/pdf-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

/** Stable ordering with 64 resident indices and logarithmically many backed runs.
 * The comparator's metadata values remain owned/admitted by the PDF parser. */
export async function* sortMetadataIndices(
  input: AsyncIterable<number>, compare: (a: number, b: number) => number,
  storage: PdfIndexStorage, signal?: AbortSignal,
): AsyncGenerator<number> {
  const levels: Array<PdfFileSource | undefined> = [], live = new Set<PdfFileSource>();
  const order = (a: number, b: number) => compare(a, b) || a - b;
  let turns = 0, failed = false;
  async function checkpoint() { signal?.throwIfAborted(); if (++turns % 64 === 0) await yieldTurn(signal); }
  async function* encode(indices: AsyncIterable<number> | Iterable<number>) {
    let bytes = new Uint8Array(512), view = new DataView(bytes.buffer), used = 0;
    for await (const index of indices) {
      await checkpoint(); view.setFloat64(used, index, true); used += 8;
      if (used === bytes.length) { yield bytes; bytes = new Uint8Array(512); view = new DataView(bytes.buffer); used = 0; }
    }
    if (used) yield bytes.slice(0, used);
  }
  async function stage(indices: AsyncIterable<number> | Iterable<number>) {
    const source = await PdfFileSource.fromStream(storage.fs, storage.directory, encode(indices), { chunkBytes: 512, cacheBytes: 512, ...(signal ? { signal } : {}) });
    live.add(source); return source;
  }
  async function close(source: PdfFileSource) { await source.close(); live.delete(source); }
  async function* read(source: PdfFileSource) {
    for await (const bytes of source.stream(0, source.size, signal)) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let at = 0; at < bytes.length; at += 8) { await checkpoint(); yield view.getFloat64(at, true); }
    }
  }
  async function* merge(a: PdfFileSource, b: PdfFileSource) {
    const left = read(a), right = read(b);
    try {
      let l = await left.next(), r = await right.next();
      while (!l.done || !r.done) {
        if (r.done || (!l.done && order(l.value, r.value) <= 0)) { yield l.value!; l = await left.next(); }
        else { yield r.value; r = await right.next(); }
      }
    } finally { await left.return(); await right.return(); }
  }
  async function add(tail: number[]) {
    tail.sort(order); let current = await stage(tail), level = 0;
    while (levels[level]) {
      const previous = levels[level]!;
      const combined = await stage(merge(previous, current));
      await close(previous); await close(current); levels[level] = undefined;
      current = combined; level++;
    }
    levels[level] = current;
  }
  try {
    let tail: number[] = [];
    for await (const index of input) { await checkpoint(); tail.push(index); if (tail.length === 64) { await add(tail); tail = []; } }
    if (tail.length) await add(tail);
    let combined: PdfFileSource | undefined;
    for (const run of levels) if (run) {
      if (!combined) combined = run;
      else { const next = await stage(merge(combined, run)); await close(combined); await close(run); combined = next; }
    }
    if (combined) yield* read(combined);
  } catch (error) { failed = true; throw error; } finally {
    const results = await Promise.allSettled([...live].map(source => source.close()));
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}
