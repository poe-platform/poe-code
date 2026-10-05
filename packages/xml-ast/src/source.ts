/** Fill value with exactly the requested UTF-16 span before advancing the parser. */
export interface XmlSourceRead {
  readonly offset: number;
  readonly length: number;
  value?: string;
}
export type XmlSourceStep = number | XmlSourceRead;

/** One fixed window; individual returned tokens still have their own size cost. */
export class XmlSource {
  private window = '';
  private start = -1;
  constructor(readonly length: number) {
    if (!Number.isSafeInteger(length) || length < 0) throw new RangeError("Invalid XML source length");
  }

  *slice(start: number, end = this.length): Generator<XmlSourceStep, string, void> {
    start = start < 0 ? Math.max(0, this.length + start) : Math.min(start, this.length);
    end = end < 0 ? Math.max(0, this.length + end) : Math.min(end, this.length);
    let result = '';
    while (start < end) {
      if (start < this.start || start >= this.start + this.window.length) {
        const offset = Math.floor(start / 4096) * 4096;
        const read: XmlSourceRead = { offset, length: Math.min(4096, this.length - offset) };
        yield read;
        if (typeof read.value !== 'string' || read.value.length !== read.length) throw new TypeError('Incomplete XML source read');
        this.window = read.value;
        this.start = offset;
      }
      const stop = Math.min(end, this.start + this.window.length);
      result += this.window.slice(start - this.start, stop - this.start);
      start = stop;
    }
    return result;
  }
  *charCodeAt(offset: number): Generator<XmlSourceStep, number, void> {
    return (yield* this.slice(offset, offset + 1)).charCodeAt(0);
  }
  *startsWith(value: string, offset: number): Generator<XmlSourceStep, boolean, void> {
    return (yield* this.slice(offset, offset + value.length)) === value;
  }
  *indexOf(value: string, offset: number): Generator<XmlSourceStep, number, void> {
    while (offset < this.length) {
      const end = Math.min(this.length, offset + 4096 + value.length - 1);
      const found = (yield* this.slice(offset, end)).indexOf(value);
      if (found >= 0) return offset + found;
      offset += 4096;
    }
    return -1;
  }
}
