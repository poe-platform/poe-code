import { Utf8IncrementalDecoder } from "./utf8-incremental.js";
import type { Utf8DecodeErrors } from "./utf8-decode.js";
import { UniversalNewlineDecoder, type NewlineForm } from "./newline-decoder.js";
import type { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

/** Read-side decoding only: line extraction and filesystem access belong to streams. */
export class Utf8TextDecoder {
  #bytes = new Utf8IncrementalDecoder();
  #lines: UniversalNewlineDecoder | undefined;

  constructor(readonly newline: string | null = null, public errors: Utf8DecodeErrors = "strict") {
    if (newline !== null && !["", "\n", "\r", "\r\n"].includes(newline)) {
      throw new PythonRuntimeError("ValueError", "illegal newline value");
    }
    if (newline === null || newline === "") this.#lines = new UniversalNewlineDecoder(newline === null);
  }

  get newlines(): NewlineForm | readonly NewlineForm[] | null {
    return this.#lines?.newlines ?? null;
  }

  decode(input: Uint8Array, final = false, meter?: ExecutionMeter): CodePointString {
    // Stage byte state until the newline layer has also completed. That layer
    // commits atomically itself, so no fallible work may follow its decode.
    const bytes = new Utf8IncrementalDecoder(this.errors);
    bytes.setstate(this.#bytes.getstate(meter), meter);
    const decoded = bytes.decode(input, final, meter);
    const output = this.#lines?.decode(decoded, final, meter) ?? decoded;
    this.#bytes = bytes;
    return output;
  }

  reset(meter?: ExecutionMeter): void {
    meter?.checkpoint();
    this.#bytes = new Utf8IncrementalDecoder();
    if (this.#lines) this.#lines = new UniversalNewlineDecoder(this.newline === null);
  }
}
