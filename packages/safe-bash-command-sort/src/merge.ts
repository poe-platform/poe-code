import { SortRecord } from "./records.js";

export type RecordCompare = (left: SortRecord, right: SortRecord) => number | Promise<number>;
type Head = { record: SortRecord; source: number };

/** The caller bounds fan-in. Only one owned record per source is read ahead;
 * advancing the winning source happens after downstream accepts its record. */
export async function* mergeRecords(sources: readonly AsyncIterable<SortRecord>[], compare: RecordCompare): AsyncGenerator<SortRecord> {
  const iterators: AsyncIterator<SortRecord>[] = [];
  const heap: Head[] = [];
  const owned = new Set<SortRecord>();
  let failed = false;
  const before = async (left: Head, right: Head): Promise<boolean> => {
    const order = await compare(left.record, right.record);
    return order < 0 || order === 0 && left.source < right.source;
  };
  const push = async (head: Head): Promise<void> => {
    heap.push(head);
    let index = heap.length - 1;
    while (index) {
      const parent = Math.floor((index - 1) / 2);
      if (!await before(head, heap[parent]!)) break;
      heap[index] = heap[parent]!;
      index = parent;
    }
    heap[index] = head;
  };
  const pop = async (): Promise<Head> => {
    const first = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && await before(heap[child + 1]!, heap[child]!)) child++;
        if (!await before(heap[child]!, last)) break;
        heap[index] = heap[child]!;
        index = child;
      }
      heap[index] = last;
    }
    return first;
  };
  try {
    for (const source of sources) iterators.push(source[Symbol.asyncIterator]());
    for (let source = 0; source < iterators.length; source++) {
      const next = await iterators[source]!.next();
      if (!next.done) { owned.add(next.value); await push({ record: next.value, source }); }
    }
    while (heap.length) {
      const head = await pop();
      owned.delete(head.record);
      yield head.record;
      const next = await iterators[head.source]!.next();
      if (!next.done) { owned.add(next.value); await push({ record: next.value, source: head.source }); }
    }
  } catch (error) { failed = true; throw error;
  } finally {
    await Promise.allSettled([
      ...[...owned].map(record => record.close()),
      ...iterators.map(iterator => iterator.return?.()),
    ]).then(results => {
      const failure = results.find(result => result.status === "rejected");
      if (!failed && failure?.status === "rejected") throw failure.reason;
    });
  }
}
