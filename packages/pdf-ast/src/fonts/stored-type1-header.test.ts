import { expect, it } from "vitest";
import { FontProgramStore } from "./stored-program.js";
import { StoredType1Lexer } from "./stored-type1-lexer.js";
import { readType1Header, splitType1Program } from "./stored-type1-header.js";
import { StringStream, Type1Parser } from "../vendor/pdfjs-fonts.mjs";
function source(text: string) {
  const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
  return new FontProgramStore({
    storage: {
      allocate() {
        throw Error("read only");
      },
      async read(at, n) {
        expect(n).toBeLessThanOrEqual(4096);
        return bytes.slice(at, at + n);
      },
      async write() {
        throw Error("read only");
      }
    },
    position: 0,
    byteLength: bytes.length
  }).range();
}
it("preserves native Type1 header matrices and custom encoding names as spans", async () => {
  const text =
    "/FontMatrix [1 0 0 1 0 0] def /Encoding 256 array 0 1 255 {} for dup 65 /" +
    "A".repeat(10000) +
    " put dup 66 /B put readonly def";
  const native: { fontMatrix?: number[]; builtInEncoding?: string[] } = {};
  new Type1Parser(new StringStream(text), false, true).extractFontHeader(native);
  const data = new Uint8Array(131072);
  let end = 0;
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      return at;
    },
    async read(at: number, n: number) {
      return data.slice(at, at + n);
    },
    async write(at: number, bytes: Uint8Array) {
      data.set(bytes, at);
    }
  };
  const header = await readType1Header(
    new StoredType1Lexer(source(text)),
    [0.001, 0, 0, 0.001, 0, 0],
    storage
  );
  expect(header.matrix).toEqual(native.fontMatrix);
  const name = (await header.encoding!.get(65))!;
  expect(typeof name).not.toBe("string");
  if (typeof name !== "string") expect(await name.equals(native.builtInEncoding![65]!)).toBe(true);
});
it.each([1, 100000])("recovers eexec bounds when declared Length1 is %s", async (length) => {
  const header = "%!PS\n/FontType 1 def\ncurrentfile eexec\n",
    input = source(header + "ABCDEF");
  const parts = await splitType1Program(input, length);
  expect(parts.header.length).toBe(header.length);
  expect(await parts.body.byte(0)).toBe(65);
});
