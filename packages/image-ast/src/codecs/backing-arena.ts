import type { ImageByteStorage } from "./png-storage.js";

/** Reusable caller-backed address space; geometric segments need at most 42 descriptors. */
export class BackingArena implements ImageByteStorage {
  private readonly segments: { start: number; length: number; position: number }[] = [];
  private capacity = 0;
  private end = 0;
  constructor(private readonly storage: ImageByteStorage) {}
  reset(): void {
    this.end = 0;
  }
  allocate(length: number): number {
    const start = this.end,
      end = start + length;
    if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(end))
      throw new RangeError("Invalid image backing length");
    while (this.capacity < end) {
      const size = Math.min(
          4096 * 2 ** this.segments.length,
          Number.MAX_SAFE_INTEGER - this.capacity
        ),
        position = this.storage.allocate(size);
      if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(position + size))
        throw new RangeError("Invalid image backing allocation");
      this.segments.push({ start: this.capacity, length: size, position });
      this.capacity += size;
    }
    this.end = end;
    return start;
  }
  private *ranges(position: number, length: number) {
    if (
      !Number.isSafeInteger(position) ||
      position < 0 ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > 4096 ||
      !Number.isSafeInteger(position + length) ||
      position + length > this.end
    )
      throw new RangeError("Invalid image backing range");
    let used = 0;
    for (const segment of this.segments) {
      const local = Math.max(0, position + used - segment.start),
        size = Math.min(segment.length - local, length - used);
      if (size > 0) {
        yield { position: segment.position + local, offset: used, length: size };
        used += size;
      }
      if (used === length) return;
    }
  }
  async read(
    position: number,
    length: number,
    options?: { readonly signal?: AbortSignal }
  ): Promise<Uint8Array> {
    options?.signal?.throwIfAborted();
    // Validate before allocating even when called with an invalid oversized range.
    const ranges = this.ranges(position, length),
      first = ranges.next();
    const output = new Uint8Array(length);
    for (let next = first; !next.done; next = ranges.next()) {
      const range = next.value;
      options?.signal?.throwIfAborted();
      const bytes = await this.storage.read(range.position, range.length, options);
      options?.signal?.throwIfAborted();
      if (!(bytes instanceof Uint8Array) || bytes.length !== range.length)
        throw new Error("Truncated image backing storage");
      output.set(bytes, range.offset);
    }
    return output;
  }
  async write(
    position: number,
    bytes: Uint8Array,
    options?: { readonly signal?: AbortSignal }
  ): Promise<void> {
    options?.signal?.throwIfAborted();
    for (const range of this.ranges(position, bytes.length)) {
      options?.signal?.throwIfAborted();
      await this.storage.write(
        range.position,
        bytes.subarray(range.offset, range.offset + range.length),
        options
      );
      options?.signal?.throwIfAborted();
    }
  }
}
