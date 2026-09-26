import type { CsvkitLimits } from "./contracts.js";
import { CsvkitBlocked, CsvkitWorkBudgetError } from "./errors.js";

/** Admit the data graph before structuredClone can allocate invocation-owned settings. */
export class SettingsAdmission {
  retainedBytes = 0;
  #arguments = 0;
  #argumentBytes = 0;
  #work = 0;
  readonly #seen = new Set<object>();
  constructor(readonly limits: CsvkitLimits, readonly signal: AbortSignal) {}

  #step(): void {
    this.signal.throwIfAborted();
    if (++this.#work > this.limits.maxWork) throw new CsvkitWorkBudgetError();
  }
  #retain(bytes: number): void {
    this.retainedBytes += bytes;
    if (!Number.isSafeInteger(this.retainedBytes) || this.retainedBytes > this.limits.maxRetainedBytes)
      throw new CsvkitBlocked("retained byte budget exceeded");
  }
  admit(value: unknown): void {
    // Each setting is independently cloned, even when callers reuse a graph.
    this.#seen.clear();
    this.#visit(value, 0);
  }
  #visit(value: unknown, depth: number): void {
    this.#step();
    if (value !== null && typeof value === "object") {
      if (this.#seen.has(value)) return;
      if (depth > this.limits.maxNestingDepth) throw new CsvkitBlocked("SDK settings nesting budget exceeded");
      this.#retain(64);
      this.#seen.add(value);
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        // structuredClone copies the full backing store, including bytes outside a view.
        const buffer = value instanceof ArrayBuffer ? value : value.buffer;
        if (!(buffer instanceof ArrayBuffer)) throw new CsvkitBlocked("shared SDK settings buffer");
        if (!this.#seen.has(buffer) || buffer === value) {
          this.#retain(buffer.byteLength);
          this.#seen.add(buffer);
        }
        return;
      }
      if (value instanceof Date) return;
      if (value instanceof Map) {
        for (const [key, item] of value) { this.#visit(key, depth + 1); this.#visit(item, depth + 1); }
        return;
      }
      if (value instanceof Set) {
        for (const item of value) this.#visit(item, depth + 1);
        return;
      }
      if (Array.isArray(value)) {
        // Reject excessive/sparse arrays before enumeration or allocation.
        if (value.length > this.limits.maxArguments - this.#arguments)
          throw new CsvkitBlocked("SDK argument count budget exceeded");
        this.#retain(value.length * 8);
      } else if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new CsvkitBlocked("SDK settings object profile");
      }
      for (const key in value) {
        const property = Object.getOwnPropertyDescriptor(value, key);
        if (!property?.enumerable) continue;
        if (!("value" in property)) throw new CsvkitBlocked("SDK settings accessor profile");
        if (!Array.isArray(value)) this.#visit(key, depth + 1);
        this.#visit(property.value, depth + 1);
      }
      return;
    }
    if (++this.#arguments > this.limits.maxArguments) throw new CsvkitBlocked("SDK argument count budget exceeded");
    this.#retain(16);
    if (typeof value === "string") {
      this.#retain(value.length * 2);
      // Count UTF-8 without allocating an encoded copy; lone surrogates cost three bytes.
      for (let index = 0; index < value.length; index++) {
        if (index % 256 === 0) this.#step();
        const point = value.codePointAt(index)!;
        this.#argumentBytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
        if (point > 0xffff) index++;
        if (this.#argumentBytes > this.limits.maxArgumentBytes) throw new CsvkitBlocked("SDK argument byte budget exceeded");
      }
    } else if (typeof value === "bigint") {
      // String conversion itself allocates; reject oversized magnitudes first.
      const allowance = Math.min(this.limits.maxArgumentBytes - this.#argumentBytes,
        Math.floor((this.limits.maxRetainedBytes - this.retainedBytes) / 2));
      if (allowance < 1) throw new CsvkitBlocked("SDK argument byte budget exceeded");
      if (Number.isFinite(allowance)) {
        const bits = BigInt(Math.ceil(allowance * Math.log2(10)));
        if (value >> bits !== 0n && value >> bits !== -1n) throw new CsvkitBlocked("SDK argument byte budget exceeded");
      }
      const text = value.toString();
      this.#argumentBytes += text.length;
      if (this.#argumentBytes > this.limits.maxArgumentBytes) throw new CsvkitBlocked("SDK argument byte budget exceeded");
      this.#retain(text.length * 2);
    }
  }
}
