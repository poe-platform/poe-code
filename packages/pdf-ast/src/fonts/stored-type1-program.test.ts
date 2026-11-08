import { expect, it } from "vitest";
import { Type1Font, Stream } from "../vendor/pdfjs-fonts.mjs";
import { FontProgramStore } from "./stored-program.js";
import { parseStoredType1Eexec } from "./stored-type1-program.js";
it("assembles native Type1 glyph order and repaired conversion bytes using caller records", async () => {
  const header = "%!PS\n/FontMatrix [.001 0 0 .001 0 0] def currentfile eexec\n";
  const code = String.fromCharCode(139, 248, 136, 13, 140, 139, 5, 14);
  const plain =
    "\0\0\0\0/lenIV -1 def /Subrs 0 array def /CharStrings 3 dict dup begin /A 8 RD " +
    code +
    " ND /.notdef 8 RD " +
    code +
    " ND /B 8 RD " +
    code +
    " ND end";
  let key = 55665;
  const encrypted = Array.from(plain, (c) => {
    const cipher = c.charCodeAt(0) ^ (key >> 8);
    key = ((cipher + key) * 52845 + 22719) & 65535;
    return cipher;
  });
  const bytes = Uint8Array.from([...Array.from(header, (c) => c.charCodeAt(0)), ...encrypted]);
  const props = {
    length1: header.length,
    length2: encrypted.length,
    fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    bbox: [0, 0, 0, 0],
    widths: {},
    flags: 32
  };
  const native = new Type1Font("EmbeddedType1", new Stream(bytes.slice()), props);
  const data = new Uint8Array(262144);
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
  const parsed = await parseStoredType1Eexec(
    new FontProgramStore({ storage, position: 0, byteLength: bytes.length }).range(),
    props,
    storage
  );
  expect(parsed.count).toBe(native.cff.charStrings.objects.length);
  for (let gid = 0; gid < parsed.count; gid++) {
    const glyph = (await parsed.glyph(gid))!,
      actual = [];
    for (let i = 0; i < glyph.code.length; i++) actual.push(await glyph.code.byte(i));
    expect(actual).toEqual(Array.from(native.cff.charStrings.objects[gid]!));
    if (typeof glyph.name === "string") expect(glyph.name).toBe(native.getCharset()[gid]);
    else expect(await glyph.name!.equals(native.getCharset()[gid]!)).toBe(true);
  }
  expect(data.subarray(0, bytes.length)).toEqual(bytes);
});
