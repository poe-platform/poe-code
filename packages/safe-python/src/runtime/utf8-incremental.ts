import { decodeUtf8, type Utf8DecodeErrors } from "./utf8-decode.js";
import type { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";

export type Utf8DecoderState = readonly [Uint8Array, bigint];

/** Incremental UTF-8 state. Decode failures leave previously buffered bytes intact. */
export class Utf8IncrementalDecoder {
  #pending = new Uint8Array();

  constructor(public errors: Utf8DecodeErrors = "strict") {}

  decode(input: Uint8Array, final = false, meter?: ExecutionMeter): CodePointString {
    meter?.checkpoint();
    let combined = input;
    if (this.#pending.length !== 0) {
      const length = this.#pending.length + input.length;
      meter?.checkpoint(length, length);
      combined = new Uint8Array(length);
      combined.set(this.#pending);
      combined.set(input, this.#pending.length);
    }
    const result = decodeUtf8(combined, this.errors, meter, final);
    const remaining = combined.length - result.consumed;
    meter?.checkpoint(remaining, remaining);
    const pending = combined.slice(result.consumed);
    this.#pending = pending;
    return result.text;
  }

  getstate(meter?: ExecutionMeter): Utf8DecoderState {
    meter?.checkpoint(this.#pending.length + 1, this.#pending.byteLength);
    return [this.#pending.slice(), 0n];
  }

  setstate(state: Utf8DecoderState, meter?: ExecutionMeter): void {
    meter?.checkpoint(state[0].length + 1, state[0].byteLength);
    const pending = new Uint8Array(state[0]);
    this.#pending = pending;
  }

  reset(meter?: ExecutionMeter): void {
    meter?.checkpoint();
    this.#pending = new Uint8Array();
  }
}
