import { describe, expect, it } from "vitest";
import { utf8Codec } from "./utf8.js";
import { CsvkitBlocked } from "../errors.js";

// CPython 3.14.2 frozen reference: str.encode is a complete codec operation,
// unlike a borrowed host stdout sink whose encoding is separately profiled.
describe("Python UTF-8 encoder", () => {
  it.each([
    ["utf-8", "", []],
    ["utf-8", "é", [0xc3, 0xa9]],
    ["utf-8", "😀", [0xf0, 0x9f, 0x98, 0x80]],
    ["utf-8-sig", "", [0xef, 0xbb, 0xbf]],
    ["utf-8-sig", "é", [0xef, 0xbb, 0xbf, 0xc3, 0xa9]],
    ["UTF_8_SIG", "😀", [0xef, 0xbb, 0xbf, 0xf0, 0x9f, 0x98, 0x80]],
    ["utf-8-sig", "\ufeff", [0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf]]
  ] as const)("encodes %s %j with exact signature bytes", async (encoding, text, bytes) => {
    expect(await utf8Codec.encode(text, encoding, new AbortController().signal)).toEqual(Uint8Array.from(bytes));
  });

  it.each(["\ud800", "\udc00", "x\ud800y", "😀\udc00"])("refuses unqualified surrogate output %j", async text => {
    for (const encoding of ["utf-8", "utf-8-sig"]) {
      await expect(utf8Codec.encode(text, encoding, new AbortController().signal)).rejects.toBeInstanceOf(CsvkitBlocked);
      await expect(utf8Codec.encode(text, encoding, new AbortController().signal)).rejects.toThrow("UTF-8 unpaired surrogate encoding profile");
    }
  });

  it("preserves preexisting cancellation before encoding admission", async () => {
    const controller = new AbortController();
    controller.abort(false);
    await expect(utf8Codec.encode("\ud800", "utf-8-sig", controller.signal)).rejects.toBe(false);
  });
});
