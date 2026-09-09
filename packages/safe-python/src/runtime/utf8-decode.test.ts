import { describe, expect, it } from "vitest";
import { decodeUtf8 } from "./utf8-decode.js";
import { ExecutionBudget } from "./execution-budget.js";

describe("UTF-8 decoding", () => {
  it.each([
    [[], []], [[0, 65, 127], [0, 65, 127]], [[0xc2, 0x80], [0x80]],
    [[0xdf, 0xbf], [0x7ff]], [[0xe0, 0xa0, 0x80], [0x800]],
    [[0xed, 0x9f, 0xbf], [0xd7ff]], [[0xee, 0x80, 0x80], [0xe000]],
    [[0xef, 0xbf, 0xbf], [0xffff]], [[0xf0, 0x90, 0x80, 0x80], [0x10000]],
    [[0xf4, 0x8f, 0xbf, 0xbf], [0x10ffff]], [[0xef, 0xbb, 0xbf, 65], [0xfeff, 65]]
  ])("decodes bytes %s to code points %s", (bytes, points) => {
    expect([...decodeUtf8(new Uint8Array(bytes))]).toEqual(points);
  });

  it.each([
    [[0xff], 0, 1, "invalid start byte"], [[65, 0x80], 1, 2, "invalid start byte"],
    [[0xc0, 0x80], 0, 1, "invalid start byte"],
    [[0xe2, 0x82], 0, 2, "unexpected end of data"],
    [[0xe2, 65], 0, 1, "invalid continuation byte"],
    [[0xe2, 0x82, 65], 0, 2, "invalid continuation byte"],
    [[0xed, 0xa0, 0x80], 0, 1, "invalid continuation byte"],
    [[0xf4, 0x90, 0x80, 0x80], 0, 1, "invalid continuation byte"]
  ])("reports exact malformed-byte spans for %s", (bytes, start, end, reason) => {
    expect(() => decodeUtf8(new Uint8Array(bytes))).toThrow(expect.objectContaining({ name: "UnicodeDecodeError", encoding: "utf-8", start, end, reason }));
  });

  it("formats error messages and snapshots the offending input", () => {
    const bytes = new Uint8Array([65, 0xe2, 0x82, 66]);
    let failure: unknown;
    try { decodeUtf8(bytes); } catch (error) { failure = error; }
    bytes.fill(0);
    expect(failure).toMatchObject({ message: "'utf-8' codec can't decode bytes in position 1-2: invalid continuation byte", object: new Uint8Array([65, 0xe2, 0x82, 66]) });
    expect(() => decodeUtf8(new Uint8Array([0xff]))).toThrow("'utf-8' codec can't decode byte 0xff in position 0: invalid start byte");
  });

  it("replaces one malformed prefix at a time without consuming following ASCII", () => {
    expect([...decodeUtf8(new Uint8Array([0xe2, 0x82, 65, 0xff]), "replace")]).toEqual([0xfffd, 65, 0xfffd]);
    expect([...decodeUtf8(new Uint8Array([0xed, 0xa0, 0x80]), "replace")]).toEqual([0xfffd, 0xfffd, 0xfffd]);
    expect([...decodeUtf8(new Uint8Array([0xe2, 0x82]), "ignore")]).toEqual([]);
  });

  it("escapes each malformed byte independently", () => {
    const input = new Uint8Array([0xe2, 0x82, 65, 0xff]);
    expect([...decodeUtf8(input, "surrogateescape")]).toEqual([0xdce2, 0xdc82, 65, 0xdcff]);
    expect([...decodeUtf8(input, "backslashreplace")]).toEqual(Array.from("\\xe2\\x82A\\xff", char => char.codePointAt(0)!));
  });

  it("passes complete encoded surrogates without merging them", () => {
    expect([...decodeUtf8(new Uint8Array([0xed, 0xa0, 0x80, 0xed, 0xb0, 0x80]), "surrogatepass")]).toEqual([0xd800, 0xdc00]);
    for (const input of [[0xed, 0xa0], [0xed, 0xa0, 65]]) {
      expect(() => decodeUtf8(new Uint8Array(input), "surrogatepass")).toThrow(expect.objectContaining({ start: 0, end: 1, reason: "invalid continuation byte" }));
    }
  });

  it("meters working/output storage and decoding work", () => {
    const denied = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 3 });
    expect(() => decodeUtf8(new Uint8Array([65]), "strict", denied)).toThrow(expect.objectContaining({ reason: "allocation" }));
    expect(denied.usage.allocatedBytes).toBe(0);
    const allowed = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 8 });
    expect([...decodeUtf8(new Uint8Array([65]), "strict", allowed)]).toEqual([65]);
    expect(allowed.usage.allocatedBytes).toBe(8);
    const steps = new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 100 });
    expect(() => decodeUtf8(new Uint8Array([65, 66]), "strict", steps)).toThrow(expect.objectContaining({ reason: "steps" }));
  });
});
