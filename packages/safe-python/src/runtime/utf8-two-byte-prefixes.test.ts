import {createHash} from "node:crypto";
import {expect, it} from "vitest";
import reference from "./__snapshots__/utf8-two-byte-prefixes-3.14.7.json";
import {decodeUtf8, type Utf8DecodeErrors} from "./utf8-decode.js";
import {PythonDecodeError} from "./decode-error.js";

it("retains every two-byte UTF-8 prefix under all six policies and both final modes", () => {
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.oracle.platform).toBe("darwin");
  expect(reference.oracle.byteorder).toBe("little");
  expect(reference.policies).toEqual(["strict", "ignore", "replace", "surrogateescape", "surrogatepass", "backslashreplace"]);
  expect(reference.cases).toBe(786432);
  expect(reference.blocks.map(({first, final, count}) => [first, final, count])).toEqual(
    Array.from({length: 256}, (_, first) => [false, true].map(final => [first, final, 1536])).flat()
  );
});

// Each bounded block compares every exact result, including exception args,
// through the digest produced by the external pinned oracle. No host codecs,
// subprocesses or filesystem writes occur while running these unit tests.
it.each(reference.blocks)("matches all UTF-8 second bytes after $first (final=$final)", ({first, final, sha256}) => {
  const outcomes: unknown[] = [];
  for (let second = 0; second < 256; second++) {
    const input = Uint8Array.of(first, second);
    for (const policy of reference.policies) {
      try {
        const result = decodeUtf8(input, policy as Utf8DecodeErrors, undefined, final);
        outcomes.push(["ok", [...result.text], result.consumed]);
      } catch (error) {
        if (!(error instanceof PythonDecodeError)) throw error;
        const initial = error.initial ?? error;
        outcomes.push(["error", error.encoding, [...error.object], error.start, error.end, error.reason,
          [error.encoding, [...error.object], initial.start, initial.end, initial.reason]]);
      }
    }
  }
  expect(createHash("sha256").update(JSON.stringify(outcomes)).digest("hex")).toBe(sha256);
});
