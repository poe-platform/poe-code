import {expect, it} from "vitest";
import reference from "./__snapshots__/codec-seeded-encode-3.14.7.json";
import {unicodeCodecName} from "../unicode-codec-name.js";
import {CodePointString} from "./code-point-string.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionBudget} from "./execution-budget.js";
import {encodeSingleByte} from "./single-byte-encode.js";
import {encodeUtf7} from "./utf7.js";
import {encodeUtf8, type Utf8EncodeErrors} from "./utf8-encode.js";
import {encodeWideUnicode} from "./utf-wide.js";

// The external oracle recorded every value and error field. Repeated records
// share an index only to reduce fixture size; no results are hashed or omitted.
// Unit execution uses the real kernels and pinned names, with no host codecs.
it.each(reference.groups)("matches pinned encoder corpus: $codec / $errors", group => {
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.oracle.platform).toBe("darwin");
  expect(reference.oracle.machine).toBe("arm64");
  expect(reference.oracle.byteorder).toBe("little");
  expect(group.results).toHaveLength(reference.inputs.length);
  for (const [index, points] of reference.inputs.entries()) {
    const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
    const input = new CodePointString(Uint32Array.from(points), meter);
    const errors = group.errors as Utf8EncodeErrors;
    let actual: unknown;
    try {
      const bytes = group.codec === "ascii" || group.codec === "latin-1"
        ? encodeSingleByte(input, group.codec, errors, meter, point => unicodeCodecName(point, meter))
        : group.codec === "utf-8" ? encodeUtf8(input, errors, meter)
          : group.codec === "utf-7" ? encodeUtf7(input, meter)
            : encodeWideUnicode(input, group.codec.includes("16") ? 16 : 32,
              group.codec.endsWith("le") ? -1 : group.codec.endsWith("be") ? 1 : 0, errors, meter);
      actual = {result: [...bytes]};
    } catch (error) {
      if (!(error instanceof PythonEncodeError)) throw error;
      actual = {
        error: [error.name, error.encoding, [...error.object], error.start, error.end, error.reason],
        args: [error.encoding, [...error.object], error.initial?.start ?? error.start,
          error.initial?.end ?? error.end, error.initial?.reason ?? error.reason]
      };
    }
    expect(actual, JSON.stringify({codec: group.codec, errors, points})).toEqual(reference.records[group.results[index]]);
  }
});
