import type { ReplayFile } from "./storage.js";

export interface ReplayRows<T> { read(): AsyncIterable<T>; close(): Promise<void> }

/** At most one record plus a bounded I/O chunk is decoded at a time. */
export class RowFile<T> implements ReplayRows<T> {
  constructor(readonly file: ReplayFile, readonly release: () => Promise<void>) {}
  async write(value: T): Promise<void> {
    const text = JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? { csvkitBigint: item.toString() } : item) + "\n";
    await this.file.write(new TextEncoder().encode(text));
  }
  async *read(): AsyncGenerator<T> {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let pending = "";
    for await (const bytes of this.file.read()) {
      pending += decoder.decode(bytes, { stream: true });
      let start = 0;
      for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n", start)) {
        const line = pending.slice(start, end);
        yield JSON.parse(line, (_key, value: unknown) => value !== null && typeof value === "object" && "csvkitBigint" in value ? BigInt(String(value.csvkitBigint)) : value) as T;
        start = end + 1;
      }
      pending = pending.slice(start);
    }
    pending += decoder.decode();
    if (pending) throw new Error("Incomplete replay record");
  }
  close(): Promise<void> { return this.release(); }
}

/** One cleanup registration, with only currently live files retained. */
export class RowStorage {
  readonly #files = new Set<ReplayFile>();
  readonly #pending = new Set<Promise<ReplayFile>>();
  #closing: Promise<void> | undefined;
  constructor(readonly create: () => Promise<ReplayFile>) {}
  async file<T>(): Promise<RowFile<T>> {
    if (this.#closing) throw new Error("Row storage closed");
    const pending = this.create().then(file => { this.#files.add(file); return file; });
    this.#pending.add(pending);
    try {
      const file = await pending;
      if (this.#closing) throw new Error("Row storage closed");
      return new RowFile<T>(file, async () => { try { await file.close(); } finally { this.#files.delete(file); } });
    } finally { this.#pending.delete(pending); }
  }
  close = (): Promise<void> => this.#closing ??= (async () => {
    await Promise.allSettled([...this.#pending]);
    const results = await Promise.allSettled([...this.#files].map(file => file.close()));
    this.#files.clear();
    const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, "row storage cleanup failed");
  })();
}

/** Balanced two-way merge tapes keep run metadata constant, even for huge inputs.
 * Initial runs retain at most runBytes plus one indivisible record. */
export async function externalSort<T>(storage: RowStorage, rows: AsyncIterable<T>, compare: (a: T, b: T) => number,
  step: () => void, runBytes = 256 * 1024): Promise<ReplayRows<T>> {
  type Frame = [] | [T];
  let tapes = [await storage.file<Frame>(), await storage.file<Frame>()];
  let runs = 0;
  let block: T[] = [];
  let bytes = 0;
  const flush = async (): Promise<void> => {
    if (!block.length) return;
    block.sort(compare);
    const target = tapes[runs++ % 2]!;
    for (const row of block) { step(); await target.write([row]); }
    await target.write([]);
    block = []; bytes = 0;
  };
  for await (const row of rows) {
    step();
    const size = JSON.stringify(row, (_key, value: unknown) => typeof value === "bigint" ? String(value) : value).length * 2 + 128;
    if (bytes + size > runBytes) await flush();
    block.push(row); bytes += size;
  }
  await flush();
  for (const tape of tapes) await tape.file.seal();
  while (runs > 1) {
    const output = [await storage.file<Frame>(), await storage.file<Frame>()];
    const left = tapes[0]!.read()[Symbol.asyncIterator]();
    const right = tapes[1]!.read()[Symbol.asyncIterator]();
    let merged = 0;
    try {
      for (let run = 0; run < runs; run += 2) {
        const target = output[merged++ % 2]!;
        let a = await left.next(), b = await right.next();
        while (!a.done && a.value.length || !b.done && b.value.length) {
          step();
          if (b.done || !b.value.length || !a.done && a.value.length && compare(a.value[0], b.value[0]) <= 0) {
            await target.write(a.value!); a = await left.next();
          } else { await target.write(b.value); b = await right.next(); }
        }
        await target.write([]);
      }
    } finally { await left.return?.(undefined); await right.return?.(undefined); }
    for (const tape of output) await tape.file.seal();
    for (const tape of tapes) await tape.close();
    tapes = output; runs = merged;
  }
  await tapes[1]!.close();
  const result = tapes[0]!;
  return { async *read() { for await (const frame of result.read()) if (frame.length) yield frame[0]; }, close: () => result.close() };
}
