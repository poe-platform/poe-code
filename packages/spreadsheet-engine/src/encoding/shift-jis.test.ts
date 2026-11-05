import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { shiftJisDecoder } from "./shift-jis.js";

it("matches glibc 2.41 for every single byte and byte pair", () => {
  // Reference: bminor/glibc tag glibc-2.41, localedata/charmaps/SHIFT_JIS
  // and iconvdata/sjis.c. Hash each JSON result plus LF in byte order;
  // null denotes invalid input, an incomplete final lead contributes no text.
  const hash = createHash("sha256");
  const decode = shiftJisDecoder();
  for (let first = 0; first < 256; first++) {
    for (let second = -1; second < 256; second++) {
      const bytes = Uint8Array.from(second < 0 ? [first] : [first, second]);
      let text: string | null = null;
      // Every input is a separate conversion, including truncated/invalid ones.
      try { text = shiftJisDecoder()(bytes); } catch { /* Invalid native input. */ }
      hash.update(JSON.stringify(text) + "\n");
    }
  }
  expect(hash.digest("hex")).toBe("22b7d11e3d7d37c14db8a4fe5bd6f00bea168553eb9f50c042c02b01e066fe0b");
  expect(decode(Uint8Array.of(0x8a))).toBe("");
  expect(decode(Uint8Array.of(0xbf))).toBe("漢");
});
