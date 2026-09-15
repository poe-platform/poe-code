import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ByteBufferView } from "./byte-buffer-view.js";

function checkIndex(value: bigint, message: string): void {
  if (BigInt.asIntN(64, value) !== value) throw new PythonRuntimeError("OverflowError", message);
}

/** Internal BytesIO storage. Guest object/protocol bindings are separate. */
export class MemoryByteStream {
  #buffer: Uint8Array;
  #length: number;
  #position = 0n;
  #closed = false;
  readonly #exports = { count: 0 };

  constructor(initial = new Uint8Array(), meter?: ExecutionMeter) {
    meter?.checkpoint(initial.length + 1, initial.byteLength);
    this.#buffer = new Uint8Array(initial);
    this.#length = initial.length;
  }

  get closed(): boolean { return this.#closed; }

  #checkOpen(): void {
    if (this.#closed) throw new PythonRuntimeError("ValueError", "I/O operation on closed file.");
  }

  #checkUnpinned(): void {
    if (this.#exports.count !== 0) throw new PythonRuntimeError("BufferError", "Existing exports of data: object cannot be re-sized");
  }

  tell(meter?: ExecutionMeter): bigint {
    meter?.checkpoint();
    this.#checkOpen();
    return this.#position;
  }

  seek(offset: bigint, whence = 0, meter?: ExecutionMeter): bigint {
    meter?.checkpoint();
    checkIndex(offset, "Python int too large to convert to C ssize_t");
    this.#checkOpen();
    if (whence !== 0 && whence !== 1 && whence !== 2) throw new PythonRuntimeError("ValueError", `invalid whence (${whence}, should be 0, 1 or 2)`);
    if (whence === 0 && offset < 0n) throw new PythonRuntimeError("ValueError", `negative seek value ${offset}`);
    let position = offset + (whence === 1 ? this.#position : whence === 2 ? BigInt(this.#length) : 0n);
    if (position < 0n) position = 0n;
    checkIndex(position, "new position too large");
    this.#position = position;
    return position;
  }

  /** untilLF selects binary readline behavior; no CR or Unicode translation. */
  read(size: bigint | null = null, untilLF = false, meter?: ExecutionMeter): Uint8Array {
    meter?.checkpoint();
    if (size !== null) checkIndex(size, "cannot fit 'int' into an index-sized integer");
    this.#checkOpen();
    const start = Number(this.#position < BigInt(this.#length) ? this.#position : BigInt(this.#length));
    let end = size === null || size < 0n || size >= BigInt(this.#length - start) ? this.#length : start + Number(size);
    if (untilLF) {
      for (let index = start; index < end; index++) {
        meter?.checkpoint();
        if (this.#buffer[index] === 10) { end = index + 1; break; }
      }
    }
    const count = end - start;
    // Empty copies still own typed-array metadata. Admit it before allocating
    // the result or advancing the cursor, including repeated reads at EOF.
    meter?.checkpoint(count, 64 + count);
    const output = this.#buffer.slice(start, end);
    this.#position += BigInt(count);
    return output;
  }

  readinto(target: Uint8Array | ByteBufferView, meter?: ExecutionMeter): bigint {
    meter?.checkpoint();
    if (target instanceof ByteBufferView) {
      let writable = false;
      try { writable = !target.readonly && target.cContiguous; }
      catch (error) {
        // CPython's writable-buffer argument conversion masks released-view
        // ValueError as the same TypeError used for readonly/strided views.
        if (!(error instanceof PythonRuntimeError) || error.name !== "ValueError") throw error;
      }
      if (!writable) throw new PythonRuntimeError("TypeError", "readinto() argument must be read-write bytes-like object, not memoryview");
    }
    this.#checkOpen();
    const start = Number(this.#position < BigInt(this.#length) ? this.#position : BigInt(this.#length));
    const count = Math.min(target.length, this.#length - start);
    // The borrowed source owns typed-array metadata even at EOF. Admit it
    // before constructing the view or mutating the destination and cursor.
    meter?.checkpoint(count, 64);
    const source = this.#buffer.subarray(start, start + count);
    if (target instanceof ByteBufferView) {
      const prefix = target.slice(0n, BigInt(count), 1n, meter);
      try { prefix.assign(source, meter); }
      finally { prefix.release(); }
    } else target.set(source);
    this.#position += BigInt(count);
    return BigInt(count);
  }

  write(input: Uint8Array | ByteBufferView, meter?: ExecutionMeter): bigint {
    meter?.checkpoint();
    if (input instanceof ByteBufferView && !input.cContiguous) throw new PythonRuntimeError("BufferError", "memoryview: underlying buffer is not C-contiguous");
    this.#checkOpen();
    this.#checkUnpinned();
    if (input.length === 0) return 0n;
    const endPosition = this.#position + BigInt(input.length);
    checkIndex(endPosition, "new buffer size too large");
    if (endPosition > BigInt(Number.MAX_SAFE_INTEGER)) throw new PythonRuntimeError("MemoryError", "");
    const bytes = input instanceof ByteBufferView ? input.snapshot(meter) : input;
    const end = Number(endPosition), start = Number(this.#position);
    const gap = Math.max(0, start - this.#length);
    let buffer = this.#buffer;
    if (end > buffer.length) {
      const capacity = Math.max(end, Math.min(Number.MAX_SAFE_INTEGER, Math.max(16, buffer.length * 2)));
      meter?.checkpoint(capacity, capacity);
      meter?.checkpoint(this.#length + gap + input.length);
      try { buffer = new Uint8Array(capacity); }
      catch (error) {
        if (error instanceof RangeError) throw new PythonRuntimeError("MemoryError", "");
        throw error;
      }
      buffer.set(this.#buffer.subarray(0, this.#length));
    } else meter?.checkpoint(gap + input.length);
    // All budget checks precede mutation, including when existing capacity is reused.
    buffer.fill(0, this.#length, start);
    buffer.set(bytes, start);
    this.#buffer = buffer;
    this.#length = Math.max(this.#length, end);
    this.#position = endPosition;
    return BigInt(input.length);
  }

  truncate(size: bigint | null = null, meter?: ExecutionMeter): bigint {
    meter?.checkpoint();
    this.#checkOpen();
    this.#checkUnpinned();
    const length = size ?? this.#position;
    checkIndex(length, "Python int too large to convert to C long");
    if (length < 0n) throw new PythonRuntimeError("ValueError", `negative size value ${length}`);
    if (length < BigInt(this.#length)) this.#length = Number(length);
    return length;
  }

  getvalue(meter?: ExecutionMeter): Uint8Array {
    meter?.checkpoint();
    this.#checkOpen();
    // getvalue returns independently owned storage even for an empty stream.
    meter?.checkpoint(this.#length, 64 + this.#length);
    return this.#buffer.slice(0, this.#length);
  }

  getbuffer(meter?: ExecutionMeter): ByteBufferView {
    meter?.checkpoint();
    this.#checkOpen();
    meter?.checkpoint(1, 96);
    return new ByteBufferView(this.#buffer.subarray(0, this.#length), this.#exports);
  }

  close(meter?: ExecutionMeter): void {
    meter?.checkpoint();
    this.#checkUnpinned();
    this.#buffer = new Uint8Array();
    this.#length = 0;
    this.#closed = true;
  }
}
