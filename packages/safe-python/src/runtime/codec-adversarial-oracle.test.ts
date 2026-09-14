import {deepStrictEqual} from "node:assert";
import {it} from "vitest";
import utf7Reference from "./__snapshots__/utf7-adversarial-3.14.7.json";
import escapeReference from "./__snapshots__/escape-adversarial-3.14.7.json";
import {PythonDecodeError} from "./decode-error.js";
import {decodeUtf7} from "./utf7.js";
import {decodeUnicodeEscape} from "./unicode-escape.js";
import type {Utf8DecodeErrors} from "./utf8-decode.js";

// External CPython captures only: unit tests never invoke the oracle or create
// files. Keep every captured row, including duplicates and incomplete input.
for (const [family, reference] of [["utf7", utf7Reference], ["escape", escapeReference]] as const) {
  for (let start = 0; start < reference.samples.length; start += 500) {
    const samples = reference.samples.slice(start, start + 500);
    it(`${family}: pinned adversarial decoding rows ${start}–${start + samples.length - 1}`, () => {
      deepStrictEqual(reference.oracle.version, "3.14.7");
      deepStrictEqual(reference.oracle.unicode, "16.0.0");
      for (const sample of samples) {
        const input = Uint8Array.from(Buffer.from(sample.input, "hex"));
        const warnings: string[] = [];
        let actual: unknown;
        try {
          const result = "raw" in sample
            ? decodeUnicodeEscape(input, sample.raw, sample.errors as Utf8DecodeErrors, undefined, sample.final, message => warnings.push(message))
            : decodeUtf7(input, sample.errors as Utf8DecodeErrors, undefined, sample.final);
          actual = {result: [[...result.text], result.consumed]};
        } catch (error) {
          if (!(error instanceof PythonDecodeError)) throw error;
          actual = {error: [error.encoding, [...error.object], error.start, error.end, error.reason]};
        }
        deepStrictEqual(actual, sample.result === undefined ? {error: sample.error} : {result: sample.result}, JSON.stringify(sample));
        deepStrictEqual(warnings, "warnings" in sample ? sample.warnings : [], JSON.stringify(sample));
      }
    });
  }
}
