import type { StoredType1Encoding } from "./stored-type1-encoding.js";
import type { StoredFontByteRange } from "./stored-font-bytes.js";
import type { PdfPixelStorage } from "../ast.js";
import type { Type1Properties } from "../vendor/pdfjs-fonts.mjs";
import type { FontProgramRange } from "./stored-program.js";
import { StoredFontBytes } from "./stored-font-bytes.js";
import { StoredFontValues } from "./stored-values.js";
import { StoredNumberRangeTree } from "./stored-range-tree.js";
import { StoredType1Lexer, StoredType1Token } from "./stored-type1-lexer.js";
import { readType1Header, readType1NumberArray, splitType1Program } from "./stored-type1-header.js";
import { appendType1Bytes } from "./stored-type1-cipher.js";
import { StoredType1Converter } from "./stored-type1-convert.js";

export interface StoredType1Glyph {
  name: string | StoredType1Token | null;
  code: StoredFontByteRange;
  width: number;
  lsb: number;
  seac: Array<number | undefined> | undefined;
}
export interface StoredType1Program {
  count: number;
  header: { matrix: number[]; encoding?: StoredType1Encoding | undefined };
  glyph(gid: number): Promise<StoredType1Glyph | undefined>;
}

const RECORD_FIELDS = 14;
function hex(byte: number | undefined) {
  return (
    byte !== undefined &&
    ((byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 70) || (byte >= 97 && byte <= 102))
  );
}

/** Parse eexec containers without resident program, subroutine or glyph arrays. */
export async function parseStoredType1Eexec(
  source: FontProgramRange,
  properties: Type1Properties,
  storage: PdfPixelStorage,
  signal?: AbortSignal
): Promise<StoredType1Program> {
  const parts = await splitType1Program(source, Number(properties.length1) || 0);
  const header = await readType1Header(
    new StoredType1Lexer(parts.header),
    properties.fontMatrix,
    storage,
    signal
  );
  let ascii =
    hex(await parts.body.byte(0)) || [32, 9, 10, 13].includes((await parts.body.byte(0))!);
  for (let i = 1; i < 8; i++) ascii &&= hex(await parts.body.byte(i));
  const programs = new StoredFontBytes(storage, signal),
    output = new StoredFontBytes(storage, signal);
  const body = await appendType1Bytes(parts.body, programs, {
    kind: "cipher",
    key: 55665,
    discard: 4,
    ascii
  });
  const lexer = new StoredType1Lexer(body),
    records = new StoredFontValues(storage, signal),
    subrTree = new StoredNumberRangeTree(storage, signal);
  let lenIV = 4,
    subrsParsed = false,
    charStringsParsed = false,
    count = 0;
  const subrs = {
    async get(index: number) {
      if (!Number.isInteger(index) || index < -0x80000000 || index > 0x7fffffff) return undefined;
      const pointer = await subrTree.lookup(index + 0x80000000);
      if (!pointer) return undefined;
      const bytes = await storage.read(pointer - 1, 16, signal ? { signal } : undefined),
        view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { start: view.getFloat64(0), length: view.getFloat64(8) };
    }
  };
  async function charstring(length: number) {
    const span = lexer.binary(length),
      input = programs.range(body.start + span.start, body.start + span.start + span.length);
    return appendType1Bytes(
      input,
      programs,
      lenIV === -1 ? { kind: "plain" } : { kind: "cipher", key: 4330, discard: lenIV }
    );
  }
  while (true) {
    signal?.throwIfAborted();
    const token = await lexer.next();
    if (!token) break;
    if (!(await token.equals("/"))) continue;
    const key = await (await lexer.next())?.keyword();
    switch (key) {
      case "CharStrings": {
        if (charStringsParsed) break;
        charStringsParsed = true;
        for (let i = 0; i < 4; i++) await lexer.next();
        while (true) {
          const token = await lexer.next();
          if (!token || (await token.equals("end"))) break;
          if (!(await token.equals("/"))) continue;
          const name = await lexer.next(),
            length = (await (await lexer.next())?.int32()) ?? 0;
          await lexer.next();
          const code = await charstring(length),
            after = await lexer.next();
          if (await after?.equals("noaccess")) await lexer.next();
          else if (await after?.equals("/")) lexer.previous();
          const at = count++ * RECORD_FIELDS;
          await records.set(at, name ? body.start + name.start : 0);
          await records.set(at + 1, name?.length ?? -1);
          await records.set(at + 2, code.start);
          await records.set(at + 3, code.length);
          await records.set(at + 13, (await name?.equals(".notdef")) ? 1 : 0);
        }
        break;
      }
      case "Subrs": {
        if (subrsParsed) break;
        subrsParsed = true;
        await lexer.next();
        await lexer.next();
        while (await (await lexer.next())?.equals("dup")) {
          const index = (await (await lexer.next())?.int32()) ?? 0,
            length = (await (await lexer.next())?.int32()) ?? 0;
          await lexer.next();
          const code = await charstring(length),
            after = await lexer.next();
          if (await after?.equals("noaccess")) await lexer.next();
          const pointer = storage.allocate(16),
            bytes = new Uint8Array(16),
            view = new DataView(bytes.buffer);
          view.setFloat64(0, code.start);
          view.setFloat64(8, code.length);
          await storage.write(pointer, bytes, signal ? { signal } : undefined);
          await subrTree.assign(index + 0x80000000, index + 0x80000000, pointer + 1);
        }
        break;
      }
      case "BlueValues":
      case "OtherBlues":
      case "FamilyBlues":
      case "FamilyOtherBlues":
      case "StemSnapH":
      case "StemSnapV":
      case "StdHW":
      case "StdVW":
        await readType1NumberArray(lexer, 0);
        break;
      case "lenIV":
        lenIV = (await (await lexer.next())?.number()) ?? 0;
        break;
      case "BlueShift":
      case "BlueFuzz":
      case "BlueScale":
      case "LanguageGroup":
      case "ExpansionFactor":
      case "ForceBold":
        await lexer.next();
        break;
    }
  }
  // Native Type1 wrapping inserts a synthetic .notdef ahead of parsed glyphs.
  await output.push(139, 14);
  const converter = new StoredType1Converter(programs, output, storage, signal);
  for (let index = 0; index < count; index++) {
    if (index % 256 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    const at = index * RECORD_FIELDS,
      result = await converter.convert(
        (await records.get(at + 2))!,
        (await records.get(at + 3))!,
        subrs
      );
    await records.set(at + 4, result.code.start);
    await records.set(at + 5, result.code.length);
    await records.set(at + 6, result.width);
    await records.set(at + 7, result.lsb);
    await records.set(at + 8, result.seac?.length ?? -1);
    for (let i = 0; i < (result.seac?.length ?? 0); i++)
      await records.set(at + 9 + i, result.seac![i]);
  }
  const order = new StoredFontValues(storage, signal);
  let next = 0;
  // Each native unshift places the most recently parsed .notdef first.
  for (let i = count - 1; i >= 0; i--)
    if (await records.get(i * RECORD_FIELDS + 13)) await order.set(next++, i);
  for (let i = 0; i < count; i++)
    if (!(await records.get(i * RECORD_FIELDS + 13))) await order.set(next++, i);
  await programs.flush();
  await output.flush();
  return {
    count: count + 1,
    header,
    async glyph(gid: number) {
      if (!Number.isInteger(gid) || gid < 0 || gid > count) return undefined;
      if (gid === 0)
        return { name: ".notdef", code: output.range(0, 2), width: 0, lsb: 0, seac: undefined };
      const index = (await order.get(gid - 1))!,
        at = index * RECORD_FIELDS,
        nameStart = (await records.get(at))!,
        nameLength = (await records.get(at + 1))!;
      const start = (await records.get(at + 4))!,
        length = (await records.get(at + 5))!,
        seacLength = (await records.get(at + 8))!;
      const seac = seacLength < 0 ? undefined : await records.slice(at + 9, at + 9 + seacLength);
      return {
        name: nameLength < 0 ? null : new StoredType1Token(programs.range(), nameStart, nameLength),
        code: output.range(start, start + length),
        width: (await records.get(at + 6))!,
        lsb: (await records.get(at + 7))!,
        seac
      };
    }
  };
}
