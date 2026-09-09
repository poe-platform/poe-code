import { describe, expect, it } from "vitest";
import { encodeUtf8 } from "./utf8-encode.js";
import { decodeUtf8 } from "./utf8-decode.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget } from "./execution-budget.js";

function text(points: number[]): CodePointString {
  return new CodePointString(new Uint32Array(points));
}

describe("UTF-8 encoding", () => {
  it.each([
    [[], []], [[0, 65, 127], [0, 65, 127]], [[0x80], [0xc2, 0x80]],
    [[0x7ff], [0xdf, 0xbf]], [[0x800], [0xe0, 0xa0, 0x80]],
    [[0xd7ff], [0xed, 0x9f, 0xbf]], [[0xe000], [0xee, 0x80, 0x80]],
    [[0xffff], [0xef, 0xbf, 0xbf]], [[0x10000], [0xf0, 0x90, 0x80, 0x80]],
    [[0x10ffff], [0xf4, 0x8f, 0xbf, 0xbf]], [[0xfeff, 65], [0xef, 0xbb, 0xbf, 65]]
  ])("encodes code points %s as bytes %s", (points, bytes) => {
    expect([...encodeUtf8(text(points))]).toEqual(bytes);
  });

  it("reports contiguous surrogate error spans and retains immutable input", () => {
    const input = text([65, 0xd800, 0xdc00, 66]);
    expect(() => encodeUtf8(input)).toThrow(expect.objectContaining({ name: "UnicodeEncodeError", encoding: "utf-8", start: 1, end: 3, reason: "surrogates not allowed", object: input,
      message: "'utf-8' codec can't encode characters in position 1-2: surrogates not allowed" }));
    expect(() => encodeUtf8(text([0xd800]))).toThrow("'utf-8' codec can't encode character '\\ud800' in position 0: surrogates not allowed");
  });

  it.each([
    ["ignore", "AB"], ["replace", "A??B"],
    ["backslashreplace", "A\\ud800\\udc00B"],
    ["namereplace", "A\\ud800\\udc00B"],
    ["xmlcharrefreplace", "A&#55296;&#56320;B"]
  ] as const)("handles surrogate runs with %s", (mode, expected) => {
    expect([...encodeUtf8(text([65, 0xd800, 0xdc00, 66]), mode)]).toEqual(Array.from(expected, character => character.charCodeAt(0)));
  });

  it("surrogatepass writes separate surrogate encodings rather than joining pairs", () => {
    expect([...encodeUtf8(text([0xd800, 0xdc00]), "surrogatepass")]).toEqual([0xed, 0xa0, 0x80, 0xed, 0xb0, 0x80]);
  });

  it("surrogateescape restores escaped bytes and reports the remaining invalid run", () => {
    expect([...encodeUtf8(text([0xdc80, 65, 0xdcff]), "surrogateescape")]).toEqual([0x80, 65, 0xff]);
    expect(() => encodeUtf8(text([0xdc80, 0xd800, 0xdc81]), "surrogateescape")).toThrow(expect.objectContaining({ start: 1, end: 3, reason: "surrogates not allowed" }));
    expect(() => encodeUtf8(text([0xdc7f]), "surrogateescape")).toThrow(expect.objectContaining({ start: 0, end: 1 }));
  });

  it("round-trips arbitrary bytes through surrogateescape", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(encodeUtf8(decodeUtf8(bytes, "surrogateescape"), "surrogateescape")).toEqual(bytes);
  });

  it("returns independently owned byte buffers", () => {
    const input = text([65]);
    const first = encodeUtf8(input);
    first[0] = 0;
    expect([...encodeUtf8(input)]).toEqual([65]);
    expect([...input]).toEqual([65]);
  });

  it("checks working and final output allocation against the budget", () => {
    const input = text([65]);
    const denied = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 3 });
    expect(() => encodeUtf8(input, "strict", denied)).toThrow(expect.objectContaining({ reason: "allocation" }));
    expect(denied.usage.allocatedBytes).toBe(0);
    const partial = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 4 });
    expect(() => encodeUtf8(input, "strict", partial)).toThrow(expect.objectContaining({ reason: "allocation" }));
    expect(partial.usage.allocatedBytes).toBe(4);
    const allowed = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 5 });
    expect([...encodeUtf8(input, "strict", allowed)]).toEqual([65]);
    expect(allowed.usage.allocatedBytes).toBe(5);
  });
});
