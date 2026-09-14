import { Utf8IncrementalDecoder } from "./utf8-incremental.js";
import type { Utf8DecodeErrors } from "./utf8-decode.js";
import { UniversalNewlineDecoder, type NewlineForm } from "./newline-decoder.js";
import type { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { validateTextNewline } from "./text-newline-validation.js";

/** Read-side decoding only: line extraction and filesystem access belong to streams. */
export class Utf8TextDecoder {
  #bytes = new Utf8IncrementalDecoder();
  #lines: UniversalNewlineDecoder | undefined;

  constructor(readonly newline: string | null = null, public errors: Utf8DecodeErrors = "strict", meter?: ExecutionMeter) {
    validateTextNewline(newline, meter);
    if (newline === null || newline === "") this.#lines = new UniversalNewlineDecoder(newline === null);
  }

  get newlines(): NewlineForm | readonly NewlineForm[] | null {
    return this.#lines?.newlines ?? null;
  }

  decode(input: Uint8Array, final = false, meter?: ExecutionMeter): CodePointString {
    // Stage byte state until the newline layer has also completed. That layer
    // commits atomically itself, so no fallible work may follow its decode.
    // Admit the temporary decoder and its initial empty owned buffer before
    // constructing them, independently of the subsequent state copies.
    meter?.checkpoint(1, 128);
    const bytes = new Utf8IncrementalDecoder(this.errors);
    bytes.setstate(this.#bytes.getstate(meter), meter);
    const decoded = bytes.decode(input, final, meter);
    const output = this.#lines?.decode(decoded, final, meter) ?? decoded;
    this.#bytes = bytes;
    return output;
  }

  reset(meter?: ExecutionMeter): void {
    // Admit the byte decoder, its empty owned buffer and optional newline
    // decoder together, before discarding either layer's pending state.
    meter?.checkpoint(1, 128 + (this.#lines ? 64 : 0));
    this.#bytes = new Utf8IncrementalDecoder();
    if (this.#lines) this.#lines = new UniversalNewlineDecoder(this.newline === null);
  }
}
