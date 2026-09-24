import type { SourceSpan } from "./parser.js";
import type { Position } from "./tokenizer.js";

const positionOwners = new WeakMap<Position, CompactSourcePositions>();
const getOwner = WeakMap.prototype.get.bind(positionOwners);
const setOwner = WeakMap.prototype.set.bind(positionOwners);
const cacheSize = 514;
const writableSpan = Symbol("compiler span writability");

/** Immutable source coordinates shared by compiler-owned offset spans. */
export class CompactSourcePositions {
  private readonly sourceLength: number;
  private readonly lines = [0];
  private readonly positions = new Map<number, Position>();
  private readonly evictionOffsets = new Float64Array(cacheSize);
  private evictionIndex = 0;
  private readonly makeSpan: (start: number, end: number) => SourceSpan;

  constructor(source: string) {
    this.sourceLength = source.length;
    for (let offset = 0; offset < source.length; offset++) {
      const code = source.charCodeAt(offset);
      if (code === 13 && source.charCodeAt(offset + 1) === 10) offset++;
      if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029)
        this.lines.push(offset + 1);
    }
    // Span getters use a different receiver, so capture their source index.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const owner = this;
    type Endpoint = number | { assigned: Position };
    class Span implements SourceSpan {
      #start: Endpoint;
      #end: Endpoint;

      constructor(start: number, end: number) {
        this.#start = start;
        this.#end = end;
        Object.defineProperties(this, descriptors);
      }

      get start(): Position {
        return typeof this.#start === "number" ? owner.position(this.#start) : this.#start.assigned;
      }
      set start(value: Position) {
        if (Object.isFrozen(this)) throw new TypeError("Cannot assign to a frozen source span.");
        this.#start = getOwner(value) === owner ? value.offset : { assigned: value };
      }
      get end(): Position {
        return typeof this.#end === "number" ? owner.position(this.#end) : this.#end.assigned;
      }
      set end(value: Position) {
        if (Object.isFrozen(this)) throw new TypeError("Cannot assign to a frozen source span.");
        this.#end = getOwner(value) === owner ? value.offset : { assigned: value };
      }
    }
    // Shared own accessors preserve enumerable start/end fields without a pair
    // of getter closures or permanently retained Position objects per span.
    const descriptors = {
      start: {
        ...Object.getOwnPropertyDescriptor(Span.prototype, "start")!,
        enumerable: true
      },
      end: {
        ...Object.getOwnPropertyDescriptor(Span.prototype, "end")!,
        enumerable: true
      },
      // Sealed accessor-only objects otherwise report as frozen. This private
      // data field preserves the distinction for the mutable endpoint setters.
      [writableSpan]: { value: true, writable: true, configurable: true }
    };
    // The fields belong to each span. Deleting one must not expose an inherited
    // getter that silently recreates the deleted endpoint.
    delete (Span.prototype as Partial<SourceSpan>).start;
    delete (Span.prototype as Partial<SourceSpan>).end;
    this.makeSpan = (start, end) => new Span(start, end);
  }

  position(offset: number): Position {
    this.assertOffset(offset);
    const cached = this.positions.get(offset);
    if (cached !== undefined) return cached;
    let low = 0,
      high = this.lines.length;
    while (low + 1 < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (this.lines[middle]! <= offset) low = middle;
      else high = middle;
    }
    const position = Object.freeze({
      line: low + 1,
      column: offset - this.lines[low]! + 1,
      offset
    });
    setOwner(position, this);
    // Keep FIFO order without restarting a Map iterator through deleted slots.
    if (this.positions.size === cacheSize)
      this.positions.delete(this.evictionOffsets[this.evictionIndex]!);
    this.positions.set(offset, position);
    this.evictionOffsets[this.evictionIndex] = offset;
    this.evictionIndex = (this.evictionIndex + 1) % cacheSize;
    return position;
  }

  span(start: number, end: number): SourceSpan {
    this.assertOffset(start);
    this.assertOffset(end);
    return this.makeSpan(start, end);
  }

  compatiblePosition(position: Position): Position | undefined {
    if (
      !Number.isSafeInteger(position.offset) ||
      position.offset < 0 ||
      position.offset > this.sourceLength
    )
      return undefined;
    const point = this.position(position.offset);
    return point.line === position.line && point.column === position.column ? point : undefined;
  }

  private assertOffset(offset: number): void {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > this.sourceLength)
      throw new RangeError("Source coordinate offset is outside its source.");
  }
}

/** Rebased template coordinates compact only when their existing data agrees. */
export function compactDerivedPosition(base: Position, position: Position): Position | undefined {
  return getOwner(base)?.compatiblePosition(position);
}

/** Only privately owned points from the same source can become offset spans. */
export function compactSourceSpan(start: Position, end: Position): SourceSpan | undefined {
  const owner = getOwner(start);
  return owner !== undefined && getOwner(end) === owner
    ? owner.span(start.offset, end.offset)
    : undefined;
}
