import {expect, it} from "vitest";
import reference from "./__snapshots__/codec-seeded-decode-3.14.7.json";
import {PythonDecodeError} from "./decode-error.js";
import {decodeUtf7} from "./utf7.js";
import {decodeUtf8, type Utf8DecodeErrors} from "./utf8-decode.js";
import {decodeWideUnicode, type UnicodeByteOrder} from "./utf-wide.js";
import {decodeUnicodeEscape} from "./unicode-escape.js";

// External-oracle snapshots only: tests execute the package's real kernels,
// without Python, filesystem writes, host codecs, or network capabilities.
// Public modules, buffer protocols and service adapters need separate evidence.
it.each(reference.groups)("matches the pinned adversarial $name corpus", group => {
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.byteorder).toBe("little");
  for (const row of group.rows) {
    const input = Uint8Array.from(row.input), errors = row.errors as Utf8DecodeErrors;
    const warnings: string[][] = [];
    let actual: unknown;
    try {
      const decoded = row.width === 7 ? decodeUtf7(input, errors, undefined, row.final)
        : row.width === 8 ? decodeUtf8(input, errors, undefined, row.final)
        : row.width === 16 || row.width === 32
          ? decodeWideUnicode(input, row.width, row.order as UnicodeByteOrder, errors, undefined, row.final)
          : decodeUnicodeEscape(input, row.raw!, errors, undefined, row.final,
            message => warnings.push(["DeprecationWarning", message]));
      actual = {result: [[...decoded.text], decoded.consumed,
        ...("byteorder" in decoded ? [decoded.byteorder] : [])], warnings};
    } catch (error) {
      if (!(error instanceof PythonDecodeError)) throw error;
      actual = {error: [error.name, error.encoding, [...error.object], error.start, error.end, error.reason], warnings};
    }
    expect(actual, JSON.stringify(row)).toEqual(row.expected);
  }
});
