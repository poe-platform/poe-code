import { FsError } from "../contracts/index.js";

const segmentSize = 4096;

export class RecordBuffer {
  #segments: Uint8Array[] = [];
  #size = 0;
  #allocated = 0;

  constructor(readonly capacity: number, readonly finalizationCapacity = capacity * 2) {}

  get size(): number { return this.#size; }

  #admit(length: number): void {
    if (length > this.capacity - this.#size) {
      throw new FsError("EFBIG", { message: "line buffer limit exceeded" });
    }
  }

  append(bytes: Uint8Array, start = 0, end = bytes.length): void {
    this.#admit(end - start);
    let offset = start;
    while (offset < end) {
      let segment = this.#segments.at(-1);
      const used = this.#size % segmentSize;
      if (!segment || used === 0) {
        segment = new Uint8Array(Math.min(segmentSize, this.capacity - this.#allocated));
        this.#segments.push(segment);
        this.#allocated += segment.length;
      }
      const length = Math.min(end - offset, segment.length - used);
      segment.set(bytes.subarray(offset, offset + length), used);
      this.#size += length;
      offset += length;
    }
  }

  finish(admit?: (size: number) => void, bytes?: Uint8Array, start = 0, end = bytes?.length ?? 0): Uint8Array {
    this.#admit(end - start);
    const size = this.#size + end - start;
    admit?.(size);
    if (size > this.finalizationCapacity - this.#allocated) {
      throw new FsError("EFBIG", { message: "line finalization buffer limit exceeded" });
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const segment of this.#segments) {
      const length = Math.min(segment.length, this.#size - offset);
      result.set(segment.subarray(0, length), offset);
      offset += length;
    }
    if (bytes && end > start) result.set(bytes.subarray(start, end), offset);
    this.clear();
    return result;
  }

  clear(): void {
    this.#segments = [];
    this.#size = 0;
    this.#allocated = 0;
  }
}
