import { expect, it } from "vitest";
import { Stream, Type1Parser } from "../vendor/pdfjs-fonts.mjs";
import { FontProgramStore } from "./stored-program.js";
import { StoredFontBytes } from "./stored-font-bytes.js";
import { appendType1Bytes } from "./stored-type1-cipher.js";

async function decode(bytes: Uint8Array, key: number, discard: number, ascii = false) {
  const data = new Uint8Array(bytes.length * 3 + 65536);
  data.set(bytes);
  let end = bytes.length;
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      return at;
    },
    async read(at: number, n: number) {
      expect(n).toBeLessThanOrEqual(4096);
      return data.slice(at, at + n);
    },
    async write(at: number, bytes: Uint8Array) {
      expect(bytes.length).toBeLessThanOrEqual(4096);
      data.set(bytes, at);
    }
  };
  const source = new FontProgramStore({ storage, position: 0, byteLength: bytes.length }).range(),
    output = new StoredFontBytes(storage);
  const result = await appendType1Bytes(
    source,
    output,
    discard === -1 ? { kind: "plain" } : { kind: "cipher", key, discard, ascii }
  );
  const actual = new Uint8Array(result.length);
  for (let i = 0; i < actual.length; i++) actual[i] = (await result.byte(i))!;
  return actual;
}

it.each([0, 4, 100, -1, -2, 1.5, NaN])(
  "matches native Type1 charstring cipher with lenIV %s",
  async (discard) => {
    const bytes = Uint8Array.from({ length: 33 }, (_, i) => i * 7),
      parser = new Type1Parser(new Stream(new Uint8Array()), false, false);
    expect(await decode(bytes, 4330, discard)).toEqual(parser.readCharStrings(bytes, discard));
  }
);

it("matches native binary and whitespace-separated ASCII eexec decryption", async () => {
  for (const ascii of [false, true]) {
    const raw = Uint8Array.from({ length: 10000 }, (_, i) => i % 251);
    const bytes = ascii
      ? new TextEncoder().encode(
          Array.from(
            raw,
            (v, i) => v.toString(16).padStart(2, "0") + (i > 4 && i % 17 === 0 ? " \n" : "")
          ).join("") + "F"
        )
      : raw;
    const parser = new Type1Parser(new Stream(bytes), true, false) as unknown as {
      stream: { bytes: Uint8Array };
    };
    expect(await decode(bytes, 55665, 4, ascii)).toEqual(parser.stream.bytes);
  }
});
