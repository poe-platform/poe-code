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
    // CPython retains the decoded object when neither prefixing nor withholding
    // CR changes it and the native scan needs no translation buffer. Its LF-only
    // shortcut scans compact Unicode *bytes*, so U+010D/U+0D00/U+D0000 also leave
    // that shortcut. Once CR/CRLF has been seen, translation keeps copying even
    // later chunks without CR. Inspect pinned code-point bytes, never host text.
    if (!this.#pendingCR && (final || input.codePointAt(BigInt(input.length - 1), meter) !== 13)
      && (!this.translate || (this.#seen & 5) === 0)) {
      let seen = this.#seen, reusable = true;
      for (let index = 0; index < input.length; index++) {
        const point = input.codePointAt(BigInt(index), meter);
        if (this.translate && ((point & 255) === 13 || ((point >>> 8) & 255) === 13 || (point >>> 16) === 13)) {
          reusable = false;
          break;
        }
        if (point === 13) {
          if (index + 1 < input.length && input.codePointAt(BigInt(index + 1), meter) === 10) {
            seen |= 4;
            index++;
          } else seen |= 1;
        } else if (point === 10) seen |= 2;
      }
      if (reusable) {
        this.#seen = seen;
        return input;
      }
    }
    const capacity = input.length + (this.#pendingCR ? 1 : 0);
    meter?.checkpoint(0, 64 + capacity * Uint32Array.BYTES_PER_ELEMENT);
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
    // The result owns a string record and copied typed-array storage, even
    // when withholding a trailing CR produces an empty string. Admit that
    // metadata before construction and before committing either state field.
    meter?.checkpoint(0, 128);
    // Prefixing CR uses PyUnicode_New with the decoded string's allocation
    // maximum. Preserve that storage when returning the prefixed text directly.
    // Substring extraction (withholding CR) and newline translation instead
    // rebuild from code points and compact the result.
    const maximum = this.#pendingCR && !this.translate && !pendingCR ? input.storageMaximum(meter) : 127;
    const text = new CodePointString(output.subarray(0, written), meter, undefined, maximum);
    this.#pendingCR = pendingCR;
    this.#seen = seen;
    return text;
  }

  getstate(meter?: ExecutionMeter): NewlineState {
    // Each retained snapshot owns an immutable state record, even when no CR
    // is pending. Charge before allocation without mutating decoder state.
    meter?.checkpoint(1, 32);
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
