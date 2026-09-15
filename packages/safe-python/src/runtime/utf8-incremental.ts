import { decodeUtf8, type Utf8DecodeErrors, type Utf8DecodeRecovery } from "./utf8-decode.js";
import type { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";

export type Utf8DecoderState = readonly [Uint8Array, bigint];

/** Incremental UTF-8 state. Decode failures leave previously buffered bytes intact. */
export class Utf8IncrementalDecoder {
  #pending = new Uint8Array();

  constructor(public errors: Utf8DecodeErrors | Utf8DecodeRecovery = "strict") {}

  decode(input: Uint8Array, final = false, meter?: ExecutionMeter): CodePointString {
    meter?.checkpoint();
    let combined = input;
    if (this.#pending.length !== 0) {
      const length = this.#pending.length + input.length;
      // Admit both the temporary typed-array metadata and its byte payload.
      meter?.checkpoint(length, 64 + length);
      combined = new Uint8Array(length);
      combined.set(this.#pending);
      combined.set(input, this.#pending.length);
    }
    const result = decodeUtf8(combined, this.errors, meter, final);
    const remaining = Math.max(0, combined.length - result.consumed);
    // Every successful call replaces the owned buffer, including an empty tail.
    meter?.checkpoint(remaining + 1, 64 + remaining);
    const pending = combined.slice(result.consumed);
    this.#pending = pending;
    return result.text;
  }

  getstate(meter?: ExecutionMeter): Utf8DecoderState {
    // Charge the state pair and copied buffer even when the pending tail is empty.
    meter?.checkpoint(this.#pending.length + 1, 96 + this.#pending.byteLength);
    return [this.#pending.slice(), 0n];
  }

  setstate(state: Utf8DecoderState, meter?: ExecutionMeter): void {
    meter?.checkpoint(state[0].length + 1, 64 + state[0].byteLength);
    const pending = new Uint8Array(state[0]);
    this.#pending = pending;
  }

  reset(meter?: ExecutionMeter): void {
    meter?.checkpoint(1, 64);
    this.#pending = new Uint8Array();
  }
}
