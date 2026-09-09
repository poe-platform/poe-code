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
  readonly #stride: number;
  readonly #length: number;

  constructor(buffer: Uint8Array, exports: BufferExports, offset = 0, stride = 1, length = buffer.length) {
    this.#buffer = buffer;
    this.#exports = exports;
    this.#offset = offset;
    this.#stride = stride;
    this.#length = length;
    Object.freeze(this);
    exports.count++;
  }

  get length(): number {
    this.#checkActive();
    return this.#length;
  }

  #checkActive(): Uint8Array {
    if (this.#buffer === undefined) throw new PythonRuntimeError("ValueError", "operation forbidden on released memoryview object");
    return this.#buffer;
  }

  #index(index: bigint): number {
    if (BigInt.asIntN(64, index) !== index) throw new PythonRuntimeError("IndexError", "cannot fit 'int' into an index-sized integer");
    if (index < 0n) index += BigInt(this.#length);
    if (index < 0n || index >= BigInt(this.#length)) throw new PythonRuntimeError("IndexError", "index out of bounds on dimension 1");
    return this.#offset + Number(index) * this.#stride;
  }

  get(index: bigint, meter?: ExecutionMeter): number {
    meter?.checkpoint();
    const buffer = this.#checkActive();
    return buffer[this.#index(index)]!;
  }

  set(index: bigint, value: bigint, meter?: ExecutionMeter): void {
    meter?.checkpoint();
    const buffer = this.#checkActive();
    const offset = this.#index(index);
    if (value < 0n || value > 255n) throw new PythonRuntimeError("ValueError", "memoryview: invalid value for format 'B'");
    buffer[offset] = Number(value);
  }

  slice(start: bigint | null = null, stop: bigint | null = null, step: bigint | null = null, meter?: ExecutionMeter): ByteBufferView {
    meter?.checkpoint();
    const buffer = this.#checkActive();
    const indices = normalizeSlice(BigInt(this.#length), start, stop, step);
    const length = Number(indices.length);
    const offset = length === 0 ? 0 : this.#offset + Number(indices.start) * this.#stride;
    const stride = length > 1 ? Number(indices.step) * this.#stride : 0;
    return new ByteBufferView(buffer, this.#exports, offset, stride, length);
  }

  snapshot(meter?: ExecutionMeter): Uint8Array {
    meter?.checkpoint();
    const buffer = this.#checkActive();
    meter?.checkpoint(this.#length, this.#length);
    const output = new Uint8Array(this.#length);
    for (let index = 0; index < this.#length; index++) output[index] = buffer[this.#offset + index * this.#stride]!;
    return output;
  }

  /** Cleanup must remain available even after the execution budget has failed. */
  release(): void {
    if (this.#buffer === undefined) return;
    this.#buffer = undefined;
    this.#exports.count--;
  }
}
