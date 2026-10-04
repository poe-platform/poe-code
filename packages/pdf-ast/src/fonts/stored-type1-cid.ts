import type { PdfPixelStorage } from "../ast.js";
import type { Type1Properties } from "../vendor/pdfjs-fonts.mjs";
import type { FontProgramRange } from "./stored-program.js";
import { StoredFontBytes } from "./stored-font-bytes.js";
import { StoredFontValues } from "./stored-values.js";
import { StoredType1Lexer, type StoredType1Token } from "./stored-type1-lexer.js";
import { readType1NumberArray } from "./stored-type1-header.js";
import { appendType1Bytes } from "./stored-type1-cipher.js";
import { StoredType1Converter } from "./stored-type1-convert.js";
import type { StoredType1Program } from "./stored-type1-program.js";

export async function isStoredCidType1(source: FontProgramRange): Promise<boolean> {
  if ((await source.byte(0)) !== 37 || (await source.byte(1)) !== 33) return false;
  let text = "";
  for (let i = 0; i < Math.min(2048, source.length); i++)
    text += String.fromCharCode((await source.byte(i))!);
  if (text.includes("Resource-CIDFont")) return true;
  let from = 0;
  while (true) {
    const at = text.indexOf("/CIDFontType", from);
    if (at < 0) return false;
    let end = at + 12,
      space = false;
    while ([9, 10, 11, 12, 13, 32, 160].includes(text.charCodeAt(end))) {
      space = true;
      end++;
    }
    const next = text.charCodeAt(end + 1),
      word =
        next === 95 ||
        (next >= 48 && next <= 57) ||
        (next >= 65 && next <= 90) ||
        (next >= 97 && next <= 122);
    if (space && text[end] === "0" && !word) return true;
    from = at + 1;
  }
}

export async function parseStoredType1Cid(
  source: FontProgramRange,
  properties: Type1Properties,
  storage: PdfPixelStorage,
  signal?: AbortSignal
): Promise<StoredType1Program | undefined> {
  const lexer = new StoredType1Lexer(source),
    previous: Array<StoredType1Token | null> = [];
  let cidCount = 0,
    cidMapOffset = -1,
    fdBytes = 1,
    gdBytes = 0,
    subrMapOffset = -1,
    sdBytes = 0,
    subrCount = 0,
    startDataLength = 0,
    startDataIsHex = false,
    found = false,
    lenIV = 4;
  function remember(token: StoredType1Token | null) {
    previous.push(token);
    if (previous.length > 4) previous.shift();
  }
  while (true) {
    const token = await lexer.next();
    if (!token) break;
    if (await token.equals("StartData")) {
      const dataType = await previous.at(-3)?.keyword(),
        dataLength = previous.at(-1);
      if (
        !(await previous.at(-4)?.equals("(")) ||
        !(await previous.at(-2)?.equals(")")) ||
        (dataType !== "Binary" && dataType !== "Hex") ||
        !(await dataLength?.digits())
      )
        return undefined;
      startDataLength = await dataLength!.integer();
      if (startDataLength <= 0) return undefined;
      startDataIsHex = dataType === "Hex";
      found = true;
      break;
    }
    remember(token);
    if (!(await token.equals("/"))) continue;
    const keyToken = await lexer.next();
    remember(keyToken);
    const key = await keyToken?.keyword();
    switch (key) {
      case "FontMatrix": {
        const field = await readType1NumberArray(lexer);
        properties.fontMatrix = field.count > 6 ? [...field.values, 0] : field.values;
        break;
      }
      case "FontBBox":
        await readType1NumberArray(lexer, 0);
        break;
      case "CIDCount":
        cidCount = (await (await lexer.next())?.int32()) ?? 0;
        break;
      case "CIDMapOffset":
        cidMapOffset = (await (await lexer.next())?.int32()) ?? 0;
        break;
      case "FDBytes":
        fdBytes = (await (await lexer.next())?.int32()) ?? 0;
        break;
      case "GDBytes":
        gdBytes = (await (await lexer.next())?.int32()) ?? 0;
        break;
      case "SubrMapOffset":
        subrMapOffset = (await (await lexer.next())?.int32()) ?? 0;
        break;
      case "SDBytes":
        sdBytes = (await (await lexer.next())?.int32()) ?? 0;
        break;
      case "SubrCount":
        subrCount = (await (await lexer.next())?.int32()) ?? 0;
        break;
      case "lenIV":
        lenIV = (await (await lexer.next())?.number()) ?? 0;
        break;
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
  if (
    !found ||
    cidCount <= 0 ||
    cidMapOffset < 0 ||
    fdBytes < 0 ||
    fdBytes > 4 ||
    gdBytes < 1 ||
    gdBytes > 4
  )
    return undefined;
  const remaining = source.length - Math.min(source.length, lexer.position + 1);
  if (startDataLength > remaining) {
    if (!startDataIsHex) startDataLength = remaining;
    else if (startDataLength > 2 * remaining) return undefined;
  }
  const span = lexer.binary(startDataIsHex ? remaining : startDataLength),
    programs = new StoredFontBytes(storage, signal),
    output = new StoredFontBytes(storage, signal);
  const raw = source.subarray(span.start, span.start + span.length);
  const binary = startDataIsHex
    ? await appendType1Bytes(raw, programs, { kind: "hex", length: startDataLength })
    : raw;
  if (startDataIsHex && binary.length !== startDataLength) return undefined;
  const entrySize = fdBytes + gdBytes;
  if (
    cidMapOffset + (cidCount + 1) * entrySize > binary.length ||
    (subrCount > 0 &&
      (subrMapOffset < 0 ||
        sdBytes < 1 ||
        sdBytes > 4 ||
        subrMapOffset + (subrCount + 1) * sdBytes > binary.length))
  )
    return undefined;
  async function uint(at: number, length: number) {
    let value = 0;
    for (let i = 0; i < length; i++) value = (value << 8) | (await binary.byte(at + i))!;
    return value >>> 0;
  }
  if (fdBytes)
    for (let cid = 0; cid < cidCount; cid++)
      if ((await uint(cidMapOffset + cid * entrySize, fdBytes)) !== 0) return undefined;
  async function decode(start: number, end: number) {
    const input = {
      length: end - start,
      async byte(at: number) {
        return at >= 0 && at < end - start ? binary.byte(start + at) : undefined;
      }
    };
    return appendType1Bytes(
      input,
      programs,
      lenIV === -1 ? { kind: "plain" } : { kind: "cipher", key: 4330, discard: lenIV }
    );
  }
  const subrRecords = new StoredFontValues(storage, signal);
  for (let i = 0; i < subrCount; i++) {
    if (i % 256 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    const start = await uint(subrMapOffset + i * sdBytes, sdBytes),
      end = await uint(subrMapOffset + (i + 1) * sdBytes, sdBytes);
    const code =
      end > binary.length || end < start
        ? programs.range(programs.length)
        : await decode(start, end);
    await subrRecords.set(i * 2, code.start);
    await subrRecords.set(i * 2 + 1, code.length);
  }
  const subrs = {
    async get(i: number) {
      return Number.isInteger(i) && i >= 0 && i < subrCount
        ? { start: (await subrRecords.get(i * 2))!, length: (await subrRecords.get(i * 2 + 1))! }
        : undefined;
    }
  };
  await output.push(139, 14);
  const records = new StoredFontValues(storage, signal),
    converter = new StoredType1Converter(programs, output, storage, signal);
  let prevOffset = await uint(cidMapOffset + fdBytes, gdBytes);
  for (let cid = 0; cid < cidCount; cid++) {
    if (cid % 256 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    const next = await uint(cidMapOffset + (cid + 1) * entrySize + fdBytes, gdBytes),
      at = cid * 9;
    if (next > prevOffset && next <= binary.length) {
      const code = await decode(prevOffset, next),
        result = await converter.convert(code.start, code.length, subrs);
      await records.set(at, result.code.start);
      await records.set(at + 1, result.code.length);
      await records.set(at + 2, result.width);
      await records.set(at + 3, result.lsb);
      await records.set(at + 4, result.seac?.length ?? -1);
      for (let i = 0; i < (result.seac?.length ?? 0); i++)
        await records.set(at + 5 + i, result.seac![i]);
    } else {
      await records.set(at, cid ? (await records.get(0))! : 0);
      await records.set(at + 1, cid ? (await records.get(1))! : 2);
      await records.set(at + 2, cid ? (await records.get(2)) || 0 : 0);
      await records.set(at + 3, cid ? (await records.get(3)) || 0 : 0);
      await records.set(at + 4, -1);
    }
    prevOffset = next;
  }
  await programs.flush();
  await output.flush();
  return {
    count: cidCount + 1,
    header: { matrix: properties.fontMatrix },
    async glyph(gid) {
      if (!Number.isInteger(gid) || gid < 0 || gid > cidCount) return undefined;
      if (!gid)
        return { name: ".notdef", code: output.range(0, 2), width: 0, lsb: 0, seac: undefined };
      const cid = gid - 1,
        at = cid * 9,
        start = (await records.get(at))!,
        length = (await records.get(at + 1))!,
        seacLength = (await records.get(at + 4))!;
      return {
        name: cid === 0 ? ".notdef" : `cid${cid}`,
        code: output.range(start, start + length),
        width: (await records.get(at + 2))!,
        lsb: (await records.get(at + 3))!,
        seac: seacLength < 0 ? undefined : await records.slice(at + 5, at + 5 + seacLength)
      };
    }
  };
}
