import { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";

export type NewlineForm = "\r" | "\n" | "\r\n";
export interface NewlineState { readonly pendingCR: boolean }

/** Newline-only layer over decoded code points; byte-codec state is kept separately. */
export class UniversalNewlineDecoder {
  #pendingCR = false;
  #seen = 0;

  constructor(readonly translate = true) { Object.freeze(this); }

  get newlines(): NewlineForm | readonly NewlineForm[] | null {
    const forms: NewlineForm[] = [];
    if (this.#seen & 1) forms.push("\r");
    if (this.#seen & 2) forms.push("\n");
    if (this.#seen & 4) forms.push("\r\n");
    return forms.length === 0 ? null : forms.length === 1 ? forms[0]! : Object.freeze(forms);
  }

  decode(input: CodePointString, final = false, meter?: ExecutionMeter): CodePointString {
    meter?.checkpoint();
    if (input.length === 0 && (!this.#pendingCR || !final)) return input;
    const capacity = input.length + (this.#pendingCR ? 1 : 0);
    meter?.checkpoint(0, capacity * Uint32Array.BYTES_PER_ELEMENT);
    const output = new Uint32Array(capacity);
    let written = 0, index = 0, seen = this.#seen;
    let pendingCR = false;
    const emitNewline = (kind: 1 | 2 | 4): void => {
      seen |= kind;
      if (kind === 4 && !this.translate) output[written++] = 13;
      output[written++] = kind === 1 && !this.translate ? 13 : 10;
    };
    if (this.#pendingCR) {
      if (input.length !== 0 && input.codePointAt(0n, meter) === 10) {
        emitNewline(4);
        index++;
      } else emitNewline(1);
    }
    while (index < input.length) {
      const point = input.codePointAt(BigInt(index), meter);
      if (point === 13) {
        if (index + 1 === input.length && !final) {
          pendingCR = true;
          break;
        }
        if (index + 1 < input.length && input.codePointAt(BigInt(index + 1), meter) === 10) {
          emitNewline(4);
          index++;
        } else emitNewline(1);
      } else if (point === 10) emitNewline(2);
      else output[written++] = point;
      index++;
    }
    const text = new CodePointString(output.subarray(0, written), meter);
    this.#pendingCR = pendingCR;
    this.#seen = seen;
    return text;
  }

  getstate(meter?: ExecutionMeter): NewlineState {
    meter?.checkpoint();
    return Object.freeze({ pendingCR: this.#pendingCR });
  }

  setstate(state: NewlineState, meter?: ExecutionMeter): void {
    meter?.checkpoint();
    this.#pendingCR = state.pendingCR;
  }

  reset(meter?: ExecutionMeter): void {
    meter?.checkpoint();
    this.#pendingCR = false;
    this.#seen = 0;
  }
}
