import { Budget } from "./budget.js";
import type { Cell } from "./csv.js";

interface Field { readonly bytes: Uint8Array; readonly raw?: Uint8Array }
export class Writer {
  private atStart = true;
  constructor(readonly delimiter: number, readonly budget: Budget) {}
  async row(cells: readonly Cell[], positions?: readonly number[], preserveRaw = false): Promise<Uint8Array> {
    const count = positions?.length ?? cells.length;
    this.budget.hold(count * 32);
    const fields: Field[] = [];
    try {
      for (let index = 0; index < count; index++) {
        const cell = cells[positions ? positions[index]! : index]!;
        fields.push({ bytes: cell.decoded.view(), ...(preserveRaw && cell.faithful ? { raw: cell.raw.view() } : {}) });
      }
      return await this.fields(fields);
    } finally { this.budget.release(count * 32); }
  }
  async values(values: readonly Uint8Array[]): Promise<Uint8Array> {
    this.budget.hold(values.length * 32);
    try { return await this.fields(values.map(bytes => ({ bytes }))); }
    finally { this.budget.release(values.length * 32); }
  }
  private async fields(fields: readonly Field[]): Promise<Uint8Array> {
    const plans: { bytes: Uint8Array; quote: boolean; raw: boolean }[] = [];
    this.budget.hold(fields.length * 32);
    let size = Math.max(0, fields.length - 1) + 1;
    try {
      for (let index = 0; index < fields.length; index++) {
        const field = fields[index]!;
        let quote = fields.length === 1 && field.bytes.length === 0;
        let quotes = 0;
        let cr = false;
        const bom = this.atStart && index === 0 && field.bytes[0] === 239 && field.bytes[1] === 187 && field.bytes[2] === 191;
        quote ||= bom;
        for (let offset = 0; offset < field.bytes.length; offset++) {
          this.budget.work();
          const byte = field.bytes[offset]!;
          if (byte === this.delimiter || byte === 10 || byte === 13 || byte === 34) quote = true;
          if (byte === 34) quotes++;
          if (byte === 13) cr = true;
          if ((offset & 1023) === 0) await this.budget.checkpoint();
        }
        const raw = field.raw !== undefined && !cr && !(bom && field.raw[0] !== 34) && !(fields.length === 1 && field.raw.length === 0);
        const bytes = raw ? field.raw! : field.bytes;
        size += raw ? bytes.length : bytes.length + (quote ? quotes + 2 : 0);
        this.budget.bound("maxOutputBytes", (this.budget.totals.get("maxOutputBytes") ?? 0) + size);
        plans.push({ bytes, quote, raw });
      }
      this.budget.add("maxOutputBytes", size); this.budget.hold(size);
      let result: Uint8Array;
      try {
        result = new Uint8Array(size);
        let cursor = 0;
        for (let index = 0; index < plans.length; index++) {
          const plan = plans[index]!;
          if (index) { this.budget.work(); result[cursor++] = this.delimiter; }
          if (!plan.raw && plan.quote) { this.budget.work(); result[cursor++] = 34; }
          for (let offset = 0; offset < plan.bytes.length; offset++) {
            const byte = plan.bytes[offset]!;
            this.budget.work(); result[cursor++] = byte;
            if (!plan.raw && plan.quote && byte === 34) { this.budget.work(); result[cursor++] = byte; }
            if ((offset & 1023) === 0) await this.budget.checkpoint();
          }
          if (!plan.raw && plan.quote) { this.budget.work(); result[cursor++] = 34; }
        }
        this.budget.work(); result[cursor] = 10;
        this.atStart = false;
        return result;
      } catch (error) { this.budget.release(size); throw error; }
    } finally { this.budget.release(fields.length * 32); }
  }
  async text(text: string): Promise<Uint8Array> {
    const size = await this.budget.textSize(text);
    this.budget.add("maxOutputBytes", size);
    const bytes = await this.budget.encode(text); this.atStart &&= bytes.length === 0;
    return bytes;
  }
}
