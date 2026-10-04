import { expect, it } from "vitest";
import { Type1Parser, StringStream } from "../vendor/pdfjs-fonts.mjs";
import { FontProgramStore } from "./stored-program.js";
import { StoredType1Lexer } from "./stored-type1-lexer.js";
function lexer(text: string) {
  const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
  return new StoredType1Lexer(
    new FontProgramStore({
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
    }).range()
  );
}

it("keeps long tokens as ranges while matching native comments and punctuation", async () => {
  const text = "%" + "ignored".repeat(2000) + "\r/Name[" + "A".repeat(20000) + "]noaccess def";
  const native = new Type1Parser(new StringStream(text), false, false),
    source = lexer(text);
  let expected: string | null;
  while ((expected = native.getToken()) !== null) {
    const token = (await source.next())!;
    expect(token.length).toBe(expected.length);
    expect(await token.equals(expected)).toBe(true);
    if (expected.length < 32) expect(await token.keyword()).toBe(expected);
    else expect(await token.keyword()).toBeUndefined();
  }
  expect(await source.next()).toBeNull();
});
it.each([
  "+1.25e+2",
  "-Infinitysuffix",
  "Infinity",
  "--1",
  ".125",
  "1E-",
  "\v-12.5",
  "1" + "0".repeat(10000) + "E-10000",
  "0." + "0".repeat(10000) + "1E10001",
  "+2147483649tail",
  "18869896044948754"
])("matches native Type1 numbers: %s", async (text) => {
  const token = (await lexer(text).next())!;
  expect(Object.is(await token.number(), parseFloat(text))).toBe(true);
  expect(await token.int32()).toBe(parseInt(text, 10) | 0);
});
it("starts binary spans after exactly one lookahead byte", async () => {
  const source = lexer("RD \0ABC ND /Next");
  expect(await (await source.next())!.keyword()).toBe("RD");
  expect(source.binary(4)).toEqual({ start: 3, length: 4 });
  expect(await (await source.next())!.keyword()).toBe("ND");
  expect(await (await source.next())!.keyword()).toBe("/");
  source.previous();
  expect(await (await source.next())!.keyword()).toBe("/");
});
