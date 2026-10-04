import type { PagedStorage } from "@poe-code/safe-fs/storage";
import { SortRecord, SortStorage } from "./records.js";
import { mergeRecords, type RecordCompare } from "./merge.js";
import { SortWork, sortRecords } from "./work.js";

type Run = { head: number };

/** Run payloads and links live in the injected filesystem. The binary carry
 * inventory has at most 53 slots, independent of the number of input runs. */
export class SortRuns {
  private store: PagedStorage | undefined;
  private readonly bins: (Run | undefined)[] = [];
  constructor(private readonly resources: SortStorage, private readonly compare: RecordCompare) {}

  async *read(run: Run): AsyncGenerator<SortRecord> {
    let node = run.head;
    while (node) {
      const header = await this.store!.read(node, 16);
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      const next = view.getFloat64(0, true), length = view.getFloat64(8, true);
      yield new SortRecord(length, undefined, this.store, node + 16, node);
      node = next;
    }
  }

  async save(records: AsyncIterable<SortRecord>): Promise<Run> {
    this.store ??= this.resources.acquire(Math.max(1, Math.floor(this.resources.limits.memoryBytes / (4 * 16 * 1024))));
    let head = 0, previous = 0;
    const pointer = new Uint8Array(8), pointerView = new DataView(pointer.buffer);
    for await (const record of records) {
      let failed = false;
      try {
        let node = record.storage === this.store ? record.node : 0;
        if (!node) {
          node = this.store.allocate(16 + record.length);
          const header = new Uint8Array(16);
          new DataView(header.buffer).setFloat64(8, record.length, true);
          await this.store.write(node, header);
          let offset = node + 16;
          for await (const chunk of record.chunks()) { await this.store.write(offset, chunk); offset += chunk.length; }
        }
        if (previous) { pointerView.setFloat64(0, node, true); await this.store.write(previous, pointer); }
        else head = node;
        previous = node;
      } catch (error) { failed = true; throw error; }
      finally { await record.close().catch(error => { if (!failed) throw error; }); }
    }
    if (previous) { pointer.fill(0); await this.store.write(previous, pointer); }
    return { head };
  }

  async add(run: Run): Promise<void> {
    let level = 0;
    while (this.bins[level]) {
      run = await this.save(mergeRecords([this.read(this.bins[level]!), this.read(run)], this.compare));
      this.bins[level++] = undefined;
    }
    this.bins[level] = run;
  }

  finish(): AsyncIterable<SortRecord> {
    const sources: AsyncIterable<SortRecord>[] = [];
    for (let index = this.bins.length - 1; index >= 0; index--) if (this.bins[index]) sources.push(this.read(this.bins[index]!));
    // Fold with two-way lazy merges so final fan-in never exceeds the budget.
    let records: AsyncIterable<SortRecord> = sources[0] ?? (async function* () {})();
    for (let i = 1; i < sources.length; i++) records = mergeRecords([records, sources[i]!], this.compare);
    return records;
  }

  async sort(source: AsyncIterable<SortRecord>, work: SortWork): Promise<AsyncIterable<SortRecord>> {
    let batch: SortRecord[] = [], bytes = 0, spilled = false;
    let owned = new Set<SortRecord>();
    const flush = async (): Promise<void> => {
      if (!batch.length) return;
      const ordered = await sortRecords(batch, this.compare, work);
      await this.add(await this.save((async function* () { yield* ordered; })()));
      batch = []; owned.clear(); bytes = 0; spilled = true;
    };
    try {
      for await (const record of source) {
        owned.add(record);
        batch.push(record);
        bytes += (record.bytes?.byteLength ?? 16 * 1024) + 128;
        if (bytes >= this.resources.limits.memoryBytes / 4) await flush();
      }
      if (spilled) { await flush(); return this.finish(); }
      const ordered = await sortRecords(batch, this.compare, work);
      const outputOwned = owned;
      owned = new Set();
      return (async function* () {
        let failed = false;
        try { yield* ordered; }
        catch (error) { failed = true; throw error; }
        finally {
          await Promise.allSettled([...outputOwned].map(record => record.close())).then(results => {
            const failure = results.find(result => result.status === "rejected");
            if (!failed && failure?.status === "rejected") throw failure.reason;
          });
        }
      })();
    } catch (error) {
      await Promise.allSettled([...owned].map(record => record.close()));
      throw error;
    }
  }
}
