import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import type { RetainedTextSnapshot, RetainedTextBlocks, RetainedTable } from "./retained-blocks.js";
import type { SofficeSnapshot } from "./retained-input.js";

/** Document structure contains only scalar handles into the caller's backing. */
export class RetainedOfficeBlocks implements RetainedTextBlocks {
  private readonly blocks: IntegerTable;
  private readonly rows: IntegerTable;
  private readonly cells: IntegerTable;
  private count = 0;
  private rowCount = 0;
  private cellCount = 0;
  private tableFirst = 0;
  private rowFirst = 0;
  private columns = 0;
  constructor(private readonly storage: PagedStorage, private readonly signal: AbortSignal) {
    this.blocks = new IntegerTable(storage); this.rows = new IntegerTable(storage); this.cells = new IntegerTable(storage);
  }
  snapshot(): RetainedTextSnapshot { return { firstPage: 0, firstBlock: 0, count: this.count }; }
  async paragraph(span: SofficeSnapshot, heading: boolean): Promise<void> {
    await this.record(heading ? 1 : 0, span.position, span.size, 0);
  }
  beginTable(): void { this.tableFirst = this.rowCount; this.columns = 0; }
  async cell(span: SofficeSnapshot): Promise<void> {
    await this.cells.set(BigInt(this.cellCount * 2), BigInt(span.position));
    await this.cells.set(BigInt(this.cellCount * 2 + 1), BigInt(span.size)); this.cellCount++;
  }
  async endRow(): Promise<void> {
    const count = this.cellCount - this.rowFirst;
    if (!count) return;
    await this.rows.set(BigInt(this.rowCount * 2), BigInt(this.rowFirst));
    await this.rows.set(BigInt(this.rowCount * 2 + 1), BigInt(count)); this.rowCount++;
    this.columns = Math.max(this.columns, count); this.rowFirst = this.cellCount;
  }
  async endTable(preserveEmpty = false): Promise<void> {
    if (preserveEmpty || this.rowCount > this.tableFirst) await this.record(2, this.tableFirst, this.rowCount - this.tableFirst, Math.max(1, this.columns));
  }
  private async record(kind: number, first: number, length: number, columns: number): Promise<void> {
    for (const [offset, value] of [kind, first, length, columns].entries()) await this.blocks.set(BigInt(this.count * 4 + offset), BigInt(value));
    this.count++;
  }
  async isHeading(snapshot: RetainedTextSnapshot, index: number): Promise<boolean> {
    return await this.blocks.get(BigInt((snapshot.firstBlock + index) * 4)) === 1n;
  }
  async table(snapshot: RetainedTextSnapshot, index: number): Promise<RetainedTable | undefined> {
    const block = (snapshot.firstBlock + index) * 4;
    if (await this.blocks.get(BigInt(block)) !== 2n) return undefined;
    const first = Number(await this.blocks.get(BigInt(block + 1))), rows = Number(await this.blocks.get(BigInt(block + 2))), columns = Number(await this.blocks.get(BigInt(block + 3)));
    const rowTable = this.rows, cellTable = this.cells, read = this.read.bind(this);
    return { rows, columns,
      async cells(row) { return Number(await rowTable.get(BigInt((first + row) * 2 + 1))); },
      async *streamCell(row, column) {
        const cell = Number(await rowTable.get(BigInt((first + row) * 2))) + column;
        const position = Number(await cellTable.get(BigInt(cell * 2))), size = Number(await cellTable.get(BigInt(cell * 2 + 1)));
        yield* read(position, size);
      }
    };
  }
  async *streamBlock(snapshot: RetainedTextSnapshot, index: number, range?: { readonly start: number; readonly length: number }): AsyncGenerator<Uint8Array> {
    const block = (snapshot.firstBlock + index) * 4;
    const position = Number(await this.blocks.get(BigInt(block + 1))), size = Number(await this.blocks.get(BigInt(block + 2))), start = range?.start ?? 0;
    yield* this.read(position + start, Math.min(size - start, range?.length ?? Infinity));
  }
  private async *read(position: number, size: number): AsyncGenerator<Uint8Array> {
    for (let offset = 0; offset < size; offset += 16384) {
      this.signal.throwIfAborted();
      yield new Uint8Array(await this.storage.read(position + offset, Math.min(16384, size - offset)));
    }
  }
}
