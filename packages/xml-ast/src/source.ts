export interface XmlSourceSpan { readonly start: number; readonly end: number; }

/** Fill value before advancing. Streaming reads may be short; mark complete at EOF. */
export interface XmlSourceRead {
  readonly offset: number;
  readonly length: number;
  readonly streaming?: boolean;
  value?: string;
  complete?: boolean;
}
export type XmlSourceStep = number | XmlSourceRead;

/** One fixed window; individual returned tokens still have their own size cost. */
export class XmlSource {
  private window = '';
  private start = -1;
  private end: number;
  private readonly streaming: boolean;
  constructor(length: number | undefined) {
    if (length !== undefined && (!Number.isSafeInteger(length) || length < 0)) throw new RangeError('Invalid XML source length');
    this.streaming = length === undefined;
    this.end = length ?? Infinity;
  }
  get length(): number { return this.end; }

  private *load(offset: number): Generator<XmlSourceStep, void, void> {
    if (offset >= this.end || offset >= this.start && offset < this.start + this.window.length) return;
    const start = this.streaming ? offset : Math.floor(offset / 4096) * 4096;
    const request: XmlSourceRead = { offset: start, length: Math.min(this.streaming ? 512 : 4096, this.end - start),
      ...(this.streaming ? { streaming: true } : {}) };
    yield request;
    if (typeof request.value !== 'string' || request.value.length > request.length ||
      (!this.streaming && request.value.length !== request.length) ||
      (!request.value.length && !request.complete && this.streaming)) throw new TypeError('Incomplete XML source read');
    if (this.streaming && request.complete) this.end = start + request.value.length;
    this.window = request.value;
    this.start = start;
  }
  *has(offset: number): Generator<XmlSourceStep, boolean, void> {
    yield* this.load(offset);
    return offset < this.end;
  }
  *slice(start: number, end = this.length): Generator<XmlSourceStep, string, void> {
    start = start < 0 ? Math.max(0, this.length + start) : Math.min(start, this.length);
    end = end < 0 ? Math.max(0, this.length + end) : Math.min(end, this.length);
    let result = '';
    while (start < Math.min(end, this.length)) {
      yield* this.load(start);
      if (start >= this.end) break;
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
    for (let index = 0; index < value.length; index++) {
      if ((yield* this.charCodeAt(offset + index)) !== value.charCodeAt(index)) return false;
    }
    return true;
  }
  *indexOf(value: string, offset: number, end = Infinity): Generator<XmlSourceStep, number, void> {
    let tail = '';
    while (offset < end && (yield* this.has(offset))) {
      const stop = Math.min(end, this.start + this.window.length);
      const part = tail + this.window.slice(offset - this.start, stop - this.start);
      const found = part.indexOf(value);
      if (found >= 0) return offset - tail.length + found;
      tail = value.length > 1 ? part.slice(-(value.length - 1)) : '';
      offset = stop;
    }
    return -1;
  }
}
