import type { PdfFontAllocation } from "./memory.js";

/** Compact width records in source order, preserving later overrides. */
export class FontWidths {
  private readonly ranges: Array<{ first: number; last: number; width: number }> = [];
  private ordered = true;
  constructor(private readonly allocation: PdfFontAllocation) {}

  set(first: number, width: number, last = first): void {
    if (last < first) return;
    this.allocation.admit(64);
    const previous = this.ranges[this.ranges.length - 1];
    if (previous && first <= previous.last) this.ordered = false;
    this.ranges.push({ first, last, width });
  }

  get(code: number): number | undefined {
    if (!Number.isFinite(code)) return undefined;
    if (this.ordered) {
      let first = 0, last = this.ranges.length - 1;
      while (first <= last) {
        const middle = Math.floor((first + last) / 2);
        const range = this.ranges[middle]!;
        if (code < range.first) last = middle - 1;
        else if (code > range.last) first = middle + 1;
        else return Number.isInteger(code - range.first) ? range.width : undefined;
      }
    } else {
      for (let index = this.ranges.length - 1; index >= 0; index--) {
        const range = this.ranges[index]!;
        if (code >= range.first && code <= range.last && Number.isInteger(code - range.first)) return range.width;
      }
    }
    return undefined;
  }

  // PDF.js Type1 only reads numeric properties and writes inferred widths.
  // Keep those writes separate from PDF widths and avoid Object.fromEntries.
  createType1View(): Record<number, number> {
    this.allocation.admit(128);
    return new Proxy(Object.create(null) as Record<number, number>, {
      get: (target, key) => {
        if (Object.hasOwn(target, key)) return Reflect.get(target, key);
        if (typeof key !== "string") return undefined;
        const code = Number(key);
        return String(code) === key ? this.get(code) : undefined;
      },
      set: (target, key, value) => {
        if (!Object.hasOwn(target, key)) this.allocation.admit(64);
        return Reflect.set(target, key, value);
      },
    });
  }

  has(code: number): boolean {
    return this.get(code) !== undefined;
  }
}
