import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import {BackedTextSet} from "./backed-text-set.js";
import type {BackedText, TextRange} from "./backed-text.js";

type Entry = {next: number; identity: number; value: TextRange};
/** Intern keys and merge-sort caller-backed links in JavaScript UTF-16 order.
 * Sorting holds two text chunks and a fixed set of scalar cursors, never a key array. */
export class BackedTextOrder {
  private readonly keys: BackedTextSet;
  private readonly records: IntegerTable;
  private head = 0;
  private tail = 0;
  private length = 0;
  private sorted = true;
  constructor(private readonly storage: PagedStorage, private readonly text: BackedText) {
    this.keys = new BackedTextSet(storage, text); this.records = new IntegerTable(storage, 64);
  }
  async add(value: TextRange): Promise<number> {
    const identity = await this.keys.add(value);
    if (await this.records.get(BigInt(identity))) return identity;
    const bytes = new Uint8Array(40), view = new DataView(bytes.buffer);
    [0, identity, value.first, value.last, value.units].forEach((number, index) => view.setFloat64(index * 8, number, true));
    const position = await this.storage.append(bytes);
    if (this.tail) await this.link(this.tail, position); else this.head = position;
    this.tail = position; this.length++; this.sorted = false;
    await this.records.set(BigInt(identity), BigInt(position)); return identity;
  }
  async find(value: TextRange): Promise<number> {
    return await this.keys.has(value) ? this.keys.add(value) : 0;
  }
  private async read(position: number): Promise<Entry> {
    const bytes = await this.storage.read(position, 40), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return {next: view.getFloat64(0, true), identity: view.getFloat64(8, true), value: {first: view.getFloat64(16, true), last: view.getFloat64(24, true), units: view.getFloat64(32, true)}};
  }
  private async link(position: number, next: number): Promise<void> {
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, next, true); await this.storage.write(position, bytes);
  }
  private async compare(left: TextRange, right: TextRange): Promise<number> {
    const source = this.text.chunks(right); let current = "", offset = 0;
    try {
      for await (const chunk of this.text.chunks(left)) for (let i = 0; i < chunk.length; i++) {
        if (offset === current.length) {const next = await source.next(); if (next.done) return 1; current = next.value; offset = 0;}
        const difference = chunk.charCodeAt(i) - current.charCodeAt(offset++);
        if (difference) return difference;
      }
      return offset < current.length || !(await source.next()).done ? -1 : 0;
    } finally {await source.return(undefined);}
  }
  private async sort(): Promise<void> {
    if (this.sorted) return;
    for (let width = 1; width < this.length; width *= 2) {
      let cursor = this.head, head = 0, tail = 0;
      while (cursor) {
        let left = cursor, right = cursor, leftCount = 0, rightCount = 0;
        for (; leftCount < width && right; leftCount++) right = (await this.read(right)).next;
        cursor = right;
        for (; rightCount < width && cursor; rightCount++) cursor = (await this.read(cursor)).next;
        while (leftCount || rightCount) {
          const fromLeft = !rightCount || leftCount > 0 && await this.compare((await this.read(left)).value, (await this.read(right)).value) <= 0;
          const position = fromLeft ? left : right, next = (await this.read(position)).next;
          if (fromLeft) {left = next; leftCount--;} else {right = next; rightCount--;}
          if (tail) await this.link(tail, position); else head = position;
          tail = position;
        }
      }
      if (tail) await this.link(tail, 0);
      this.head = head; this.tail = tail;
    }
    this.sorted = true;
  }
  async *entries(): AsyncGenerator<{identity: number; value: TextRange}> {
    await this.sort();
    for (let position = this.head; position;) {
      const entry = await this.read(position); position = entry.next;
      yield {identity: entry.identity, value: entry.value};
    }
  }
}
