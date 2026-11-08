import type { PdfPixelStorage } from "../ast.js";
import { StoredType1Encoding } from "./stored-type1-encoding.js";
import { PdfError } from "../errors.js";
import { getEncoding } from "../vendor/pdfjs-fonts.mjs";
import type { FontProgramRange } from "./stored-program.js";
import { StoredType1Lexer } from "./stored-type1-lexer.js";

export async function readType1NumberArray(lexer: StoredType1Lexer, retain = 6) {
  await lexer.next();
  const values: number[] = [];
  let count = 0;
  while (true) {
    const token = await lexer.next();
    if (!token || (await token.equals("]")) || (await token.equals("}"))) break;
    if (count < retain) values.push(await token.number());
    count++;
  }
  return { count, values };
}
export async function readType1Header(
  lexer: StoredType1Lexer,
  initialMatrix: number[],
  storage: PdfPixelStorage,
  signal?: AbortSignal
) {
  let matrix = initialMatrix,
    encoding: StoredType1Encoding | undefined;
  while (true) {
    const token = await lexer.next();
    if (!token) break;
    if (!(await token.equals("/"))) continue;
    switch (await (await lexer.next())?.keyword()) {
      case "FontMatrix": {
        const field = await readType1NumberArray(lexer);
        matrix = field.count > 6 ? [...field.values, 0] : field.values;
        break;
      }
      case "FontBBox":
        await readType1NumberArray(lexer, 0);
        break;
      case "Encoding": {
        const argument = await lexer.next();
        if (!argument || !(await argument.digits())) {
          const native = getEncoding((await argument?.keyword()) ?? "");
          encoding = native
            ? new StoredType1Encoding(lexer.source, storage, signal, native)
            : undefined;
          break;
        }
        encoding = new StoredType1Encoding(lexer.source, storage, signal);
        const size = await argument.int32();
        await lexer.next();
        for (let j = 0; j < size; j++) {
          let token = await lexer.next();
          while (token && !(await token.equals("dup")) && !(await token.equals("def")))
            token = await lexer.next();
          if (!token) return { matrix, encoding };
          if (await token.equals("def")) break;
          const index = (await (await lexer.next())?.int32()) ?? 0;
          await lexer.next();
          const name = await lexer.next();
          await encoding.set(index, name);
          await lexer.next();
        }
        break;
      }
    }
  }
  return { matrix, encoding };
}

/** The native Length1 recovery scans overlapping 2048-byte windows. Retain
 * those boundary decisions while only fetching source bytes as needed. */
export async function splitType1Program(source: FontProgramRange, suggestedLength: number) {
  const pfb = (await source.byte(0)) === 128 && (await source.byte(1)) === 1;
  const start = pfb ? 6 : 0;
  if (pfb)
    suggestedLength =
      ((await source.byte(5))! << 24) |
      ((await source.byte(4))! << 16) |
      ((await source.byte(3))! << 8) |
      (await source.byte(2))!;
  async function find(at: number, length: number, scanStart: number) {
    let i = scanStart;
    const signature = [101, 101, 120, 101, 99];
    while (i < length - signature.length) {
      let j = 0;
      while (j < signature.length && (await source.byte(at + i + j)) === signature[j]) j++;
      if (j === signature.length) {
        i += j;
        while (i < length && [32, 9, 10, 13].includes((await source.byte(at + i))!)) i++;
        return { found: true, length: i };
      }
      i++;
    }
    return { found: false, length: i };
  }
  let headerLength: number | undefined;
  if (
    Number.isInteger(suggestedLength) &&
    suggestedLength >= 0 &&
    start + suggestedLength <= source.length
  ) {
    const found = await find(start, suggestedLength, suggestedLength - 10);
    if (found.found && found.length === suggestedLength) headerLength = suggestedLength;
  }
  if (headerLength === undefined) {
    let at = start;
    while (at < source.length) {
      const found = await find(at, Math.min(2048, source.length - at), 0);
      if (!found.length) break;
      at += found.length;
      if (found.found) {
        headerLength = at - start;
        break;
      }
    }
  }
  headerLength ??=
    suggestedLength > 0
      ? Math.min(Math.trunc(suggestedLength), source.length - start)
      : source.length - start;
  const header = source.subarray(start, start + headerLength),
    body = source.subarray(start + headerLength + (pfb ? 6 : 0));
  if (!body.length) throw new PdfError("E_PARSE", "getEexecBlock - no font program found.");
  return { header, body };
}
