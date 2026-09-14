import {expect, it} from "vitest";
import {codecBoundaryAuditCases} from "../codec-boundary-audit-cases.js";
import {PythonDecodeError} from "./decode-error.js";
import {decodeUtf7} from "./utf7.js";
import type {Utf8DecodeErrors} from "./utf8-decode.js";
import {decodeWideUnicode, type UnicodeByteOrder} from "./utf-wide.js";

it("matches all 19,200 pinned boundary outcomes, including cached exception arguments", () => {
  expect(codecBoundaryAuditCases).toHaveLength(19200);
  for (const row of codecBoundaryAuditCases) {
    const input = new Uint8Array(row.input), policy = row.policy as Utf8DecodeErrors;
    let actual: unknown;
    try {
      if (row.width === undefined) {
        const result = decodeUtf7(input, policy, undefined, row.final);
        actual = {result: [[...result.text], result.consumed]};
      } else {
        const result = decodeWideUnicode(input, row.width as 16 | 32, row.order as UnicodeByteOrder, policy, undefined, row.final);
        actual = {result: [[...result.text], result.consumed, result.byteorder]};
      }
    } catch (error) {
      if (!(error instanceof PythonDecodeError)) throw error;
      const initial = error.initial ?? error;
      actual = {error: [error.encoding, error.start, error.end, error.reason],
        args: [error.encoding, [...error.object], initial.start, initial.end, initial.reason]};
    }
    expect(actual, JSON.stringify(row)).toEqual(row.expected);
  }
});
