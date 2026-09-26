import type { Cell } from "./display.js";
import { ColumnBudget } from "./internal.js";

export async function jsonOutput(rows: readonly Cell[][], names: readonly string[], tableName: string, budget: ColumnBudget, columns: readonly number[] = names.map((_, index) => index)): Promise<void> {
  const lower = (value: string): string => Array.from(value, character => character >= "A" && character <= "Z" ? character.toLowerCase() : character).join("");
  { const w = budget.work(names.length); if (w) await w; }
  const keys = columns.map(index => JSON.stringify(lower(names[index] ?? "")));
  await budget.text(`{\n   ${JSON.stringify(lower(tableName))}: [\n`);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    { const s = budget.step(); if (s) await s; }
    const row = rows[rowIndex]!;
    await budget.text(rowIndex ? "{\n" : "      {\n");
    if (!keys.length) await budget.text("\n");
    for (let index = 0; index < keys.length; index++) {
      { const s = budget.step(); if (s) await s; }
      const entry = row[columns[index]!];
      const value = entry?.text ? JSON.stringify(entry.text) : "null";
      await budget.text(`         ${keys[index]}: ${value}${index + 1 < keys.length ? "," : ""}\n`);
    }
    await budget.text(`      }${rowIndex + 1 < rows.length ? "," : "\n"}`);
  }
  await budget.text(`${rows.length ? "" : "\n"}   ]\n}\n`);
}

class TailPadding {
  private readonly sizes: number[] = [];
  private readonly next: number[] = [];
  private separatorBytes: Uint8Array | undefined;
  private constructor(readonly widths: readonly number[], readonly separator: string, readonly separatorSize: number) {}

  static async create(widths: readonly number[], separator: string, budget: ColumnBudget): Promise<TailPadding> {
    { const w = budget.work(widths.length); if (w) await w; }
    const padding = new TailPadding(widths, separator, Buffer.byteLength(separator));
    const last = widths.length - 1;
    padding.sizes[last] = 0;
    padding.next[last] = last;
    for (let index = last - 1; index >= 0; index--) {
      { const s = budget.step(); if (s) await s; }
      const size = widths[index]! + padding.separatorSize;
      padding.sizes[index] = Math.min(budget.columnLimits.maxOutputBytes + 1, size + padding.sizes[index + 1]!);
      padding.next[index] = size ? index : padding.next[index + 1]!;
    }
    return padding;
  }

  async emit(row: readonly Cell[], budget: ColumnBudget): Promise<void> {
    const start = row.length, last = this.widths.length - 1;
    if (start > last) return;
    const gap = start ? this.widths[start - 1]! - row[start - 1]!.width : 0;
    const size = start ? gap + this.separatorSize + this.sizes[start]! : this.sizes[0]!;
    if (!size) return;
    budget.checkOutput(size);
    { const w = budget.work(size); if (w) await w; }
    this.separatorBytes ??= Buffer.from(this.separator);
    let buffer = new Uint8Array(Math.min(size, ColumnBudget.outputChunkBytes)), used = 0;
    const flush = async (): Promise<void> => {
      if (!used) return;
      await budget.chunk(buffer.subarray(0, used));
      buffer = new Uint8Array(Math.min(size, ColumnBudget.outputChunkBytes));
      used = 0;
    };
    const append = async (count: number, bytes?: Uint8Array): Promise<void> => {
      let offset = 0;
      while (offset < count) {
        const length = Math.min(count - offset, buffer.length - used);
        if (bytes) buffer.set(bytes.subarray(offset, offset + length), used);
        else buffer.fill(32, used, used + length);
        offset += length;
        used += length;
        if (used === buffer.length) await flush();
      }
    };
    if (start) {
      await append(gap);
      await append(this.separatorSize, this.separatorBytes);
    }
    for (let index = this.next[start]!; index < last; index = this.next[index + 1]!) {
      await append(this.widths[index]!);
      await append(this.separatorSize, this.separatorBytes);
    }
    await flush();
  }
}

export async function tableOutput(rows: readonly Cell[][], widths: readonly number[], separator: string, budget: ColumnBudget): Promise<void> {
  if (!rows.length) return;
  const padding = await TailPadding.create(widths, separator, budget);
  for (const row of rows) {
    for (let index = 0; index < row.length; index++) {
      const entry = row[index]!;
      await budget.text(entry.text);
      if (index + 1 < row.length) {
        await budget.padding(widths[index]! - entry.width);
        await budget.text(separator);
      }
    }
    await padding.emit(row, budget);
    await budget.text("\n");
  }
}
