import { yieldTurn } from "safe-bash-contracts/yield";
import { wordRanges } from "./word-ranges.js";

type Reader = { size: number; read(position: number, maxBytes: number): Promise<Uint8Array> };
type Range = { start: number; end: number };

function isWord(value: number): boolean {
  let low = 0, high = wordRanges.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const [start, end] = wordRanges[mid]!;
    if (value < start) high = mid - 1;
    else if (value > end) low = mid + 1;
    else return true;
  }
  return false;
}

/** Select exact pinned fenced content using bounded random-access reads. */
export async function findExtractedRange(reader: Reader, last: boolean, signal: AbortSignal): Promise<Range | undefined> {
  let cache: Uint8Array = new Uint8Array(0);
  let cacheStart = -1, work = 0;
  async function byte(position: number): Promise<number> {
    signal.throwIfAborted();
    if (++work % 4096 === 0) await yieldTurn(signal);
    if (position < 0 || position >= reader.size) throw new Error("Invalid extraction position");
    if (position < cacheStart || position >= cacheStart + cache.length) {
      cache = await reader.read(position, Math.min(16384, reader.size - position));
      cacheStart = position;
      signal.throwIfAborted();
      if (!cache.length || cache.length > Math.min(16384, reader.size - position)) throw new Error("Invalid extraction read");
    }
    return cache[position - cacheStart]!;
  }
  async function line(start: number) {
    let position = start, ticks = 0;
    while (position < reader.size && (await byte(position)) === 96) {
      ticks++;
      position++;
    }
    let opening = ticks >= 3, closing = ticks >= 3;
    while (position < reader.size) {
      const value = await byte(position);
      if (value === 10) return { start, next: position + 1, ticks, opening, closing };
      closing = closing && value === 32;
      let point = value, width = 1;
      if (value >= 0xc2 && value <= 0xf4) {
        width = value < 0xe0 ? 2 : value < 0xf0 ? 3 : 4;
        point = value & (width === 2 ? 31 : width === 3 ? 15 : 7);
        for (let i = 1; i < width; i++) {
          if (position + i >= reader.size) { opening = false; width = 1; break; }
          const continuation = await byte(position + i);
          if (continuation < 128 || continuation > 191) { opening = false; width = 1; break; }
          point = (point << 6) | (continuation & 63);
        }
      } else if (value >= 128) opening = false;
      opening = opening && isWord(point);
      position += width;
    }
    return { start, next: reader.size, ticks, opening: false, closing };
  }
  // Cache only proven suffix failures. The fixed bitset never rejects an
  // unexamined delimiter length, and remains valid as the scan moves forward.
  const failedLengths = new Uint8Array(16384);
  let position = 0, selected: Range | undefined;
  while (position < reader.size) {
    const candidate = await line(position);
    position = candidate.next;
    if (!candidate.opening) continue;
    if (candidate.ticks < failedLengths.length * 8 && (failedLengths[candidate.ticks >>> 3]! & (1 << (candidate.ticks & 7)))) continue;
    let matched = false;
    let search = candidate.next;
    while (search < reader.size) {
      const ending = await line(search);
      search = ending.next;
      if (ending.closing && ending.ticks === candidate.ticks) {
        matched = true;
        selected = { start: candidate.next, end: ending.start };
        if (!last) return selected;
        position = ending.next;
        break;
      }
    }
    if (!matched && candidate.ticks < failedLengths.length * 8) failedLengths[candidate.ticks >>> 3]! |= 1 << (candidate.ticks & 7);
  }
  return selected;
}
