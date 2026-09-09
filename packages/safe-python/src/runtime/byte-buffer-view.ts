import { PythonRuntimeError } from "./error.js";
import { normalizeSlice } from "./integer-sequence.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Shared internal lease count; never exposed as a guest value. */
export interface BufferExports { count: number }

/** One-dimensional unsigned-byte view with explicit, deterministic release. */
export class ByteBufferView {
  #buffer: Uint8Array | undefined;
  readonly #exports: BufferExports;
  readonly #offset: number;
  readonly #stride: bigint;
  readonly #length: number;
  readonly #readonly: boolean;

  constructor(buffer: Uint8Array, exports: BufferExports, offset = 0, stride = 1n, length = buffer.length, readonly = false) {
    this.#buffer = buffer;
    this.#exports = exports;
    this.#offset = offset;
    this.#stride = stride;
    this.#length = length;
    this.#readonly = readonly;
    Object.freeze(this);
    exports.count++;
  }

  get length(): number {
    this.#checkActive();
    return this.#length;
  }

  get readonly(): boolean {
    this.#checkActive();
    return this.#readonly;
  }

  get cContiguous(): boolean {
    this.#checkActive();
    return this.#length === 1 || this.#stride === 1n;
  }

  #checkActive(): Uint8Array {
    if (this.#buffer === undefined) throw new PythonRuntimeError("ValueError", "operation forbidden on released memoryview object");
    return this.#buffer;
  }

  #checkWritable(): Uint8Array {
    const buffer = this.#checkActive();
    if (this.#readonly) throw new PythonRuntimeError("TypeError", "cannot modify read-only memory");
    return buffer;
  }

  #index(index: bigint): number {
    if (BigInt.asIntN(64, index) !== index) throw new PythonRuntimeError("IndexError", "cannot fit 'int' into an index-sized integer");
    if (index < 0n) index += BigInt(this.#length);
    if (index < 0n || index >= BigInt(this.#length)) throw new PythonRuntimeError("IndexError", "index out of bounds on dimension 1");
    return this.#offset + Number(index * this.#stride);
  }

  get(index: bigint, meter?: ExecutionMeter): number {
    meter?.checkpoint();
    const buffer = this.#checkActive();
    return buffer[this.#index(index)]!;
  }

  set(index: bigint, value: bigint, meter?: ExecutionMeter): void {
    meter?.checkpoint();
    const buffer = this.#checkWritable();
    const offset = this.#index(index);
    if (value < 0n || value > 255n) throw new PythonRuntimeError("ValueError", "memoryview: invalid value for format 'B'");
    buffer[offset] = Number(value);
  }

  slice(start: bigint | null = null, stop: bigint | null = null, step: bigint | null = null, meter?: ExecutionMeter): ByteBufferView {
    meter?.checkpoint();
    const buffer = this.#checkActive();
    // Buffer strides use the guest signed-64-bit index model, including empty
    // views where stride metadata still determines contiguous-buffer admission.
    const maximum = (1n << 63n) - 1n;
    if (step !== null) step = step < -maximum ? -maximum : step > maximum ? maximum : step;
    const indices = normalizeSlice(BigInt(this.#length), start, stop, step);
    const length = Number(indices.length);
    const offset = length === 0 ? 0 : this.#offset + Number(indices.start * this.#stride);
    const stride = BigInt.asIntN(64, indices.step * this.#stride);
    return new ByteBufferView(buffer, this.#exports, offset, stride, length, this.#readonly);
  }

  toreadonly(meter?: ExecutionMeter): ByteBufferView {
    meter?.checkpoint();
    const buffer = this.#checkActive();
    return new ByteBufferView(buffer, this.#exports, this.#offset, this.#stride, this.#length, true);
  }

  /** Equal-structure B-format assignment, including overlapping/strided sources. */
  assign(source: ByteBufferView | Uint8Array, meter?: ExecutionMeter): void {
    meter?.checkpoint();
    const buffer = this.#checkWritable();
    if (source.length !== this.#length) throw new PythonRuntimeError("ValueError", "memoryview assignment: lvalue and rvalue have different structures");
    let snapshot: Uint8Array;
    if (source instanceof ByteBufferView) snapshot = source.snapshot(meter);
    else {
      meter?.checkpoint(source.length, source.byteLength);
      snapshot = new Uint8Array(source);
    }
    // Snapshot the complete source and admit all writes before touching shared
    // storage. This also makes budget failure atomic for aliased assignments.
    meter?.checkpoint(this.#length);
    const stride = Number(this.#stride);
    for (let index = 0; index < this.#length; index++) buffer[this.#offset + index * stride] = snapshot[index]!;
  }

  snapshot(meter?: ExecutionMeter): Uint8Array {
    meter?.checkpoint();
    const buffer = this.#checkActive();
    meter?.checkpoint(this.#length, this.#length);
    const output = new Uint8Array(this.#length);
    const stride = Number(this.#stride);
    for (let index = 0; index < this.#length; index++) output[index] = buffer[this.#offset + index * stride]!;
    return output;
  }

  /** Cleanup must remain available even after the execution budget has failed. */
  release(): void {
    if (this.#buffer === undefined) return;
    this.#buffer = undefined;
    this.#exports.count--;
  }
}
