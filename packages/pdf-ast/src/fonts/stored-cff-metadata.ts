import type { PdfPixelStorage } from "../ast.js";
import { PdfError } from "../errors.js";
import { CFFParser, CFFStrings, Stream } from "../vendor/pdfjs-fonts.mjs";
import { readCffDictionary, readCffIndex } from "./stored-cff-records.js";
import type { FontProgramRange } from "./stored-program.js";
import { StoredFontValues } from "./stored-values.js";

type Dictionary = Awaited<ReturnType<typeof readCffDictionary>>;
type Index = Awaited<ReturnType<typeof readCffIndex>>;
const TOP_FIELDS = new Set([15, 16, 17, 18, 3079, 3102, 3108, 3109]);
const PRIVATE_FIELDS = new Set([19]);
const DEFAULT_MATRIX = [0.001, 0, 0, 0.001, 0, 0];
function scalar(dict: Dictionary, field: number, fallback = 0): number {
  return dict.get(field)?.values[0] ?? fallback;
}
function matrix(dict: Dictionary): number[] | undefined {
  const entry = dict.get(3079);
  if (!entry) return undefined;
  // Preserve native rejection for malformed matrices rather than truncating
  // extra operands into an apparently valid six-element transform.
  return entry.count > 6 ? [...entry.values, 0] : entry.values;
}
function multiply(a: number[], b: number[]): number[] {
  return [
    a[0]! * b[0]! + a[2]! * b[1]!,
    a[1]! * b[0]! + a[3]! * b[1]!,
    a[0]! * b[2]! + a[2]! * b[3]!,
    a[1]! * b[2]! + a[3]! * b[3]!,
    a[0]! * b[4]! + a[2]! * b[5]! + a[4]!,
    a[1]! * b[4]! + a[3]! * b[5]! + a[5]!
  ];
}

/** Parse only rendering metadata. Variable indexes and strings remain source
 * views; selected FD dictionaries use a two-entry cache, and FD selection uses
 * caller backing. Unused names, hinting arrays and widths are never expanded. */
export async function readStoredCffMetadata(
  input: FontProgramRange,
  storage: PdfPixelStorage,
  signal?: AbortSignal,
  repairInput = input
) {
  let shift = 0;
  while (shift < input.length && (await input.byte(shift)) !== 1) shift++;
  if (shift === input.length) throw new PdfError("E_PARSE", "Invalid CFF header");
  const source = input.subarray(shift),
    repairs = repairInput.subarray(shift);
  const names = await readCffIndex(source, (await source.byte(2))!);
  const tops = await readCffIndex(source, names.end);
  const strings = await readCffIndex(source, tops.end);
  const gsubrs = await readCffIndex(source, strings.end, repairs);
  const topSource = await tops.get(0);
  if (!topSource) throw new PdfError("E_PARSE", "Missing CFF top dictionary");
  const top = await readCffDictionary(topSource, TOP_FIELDS);
  const glyphs = await readCffIndex(source, scalar(top, 17), repairs);
  const isCID = top.has(3102),
    topMatrix = matrix(top);
  async function privateSubrs(dict: Dictionary): Promise<Index | undefined> {
    const entry = dict.get(18);
    if (!entry) return undefined;
    if (entry.count !== 2) throw new PdfError("E_PARSE", "Invalid CFF Private DICT");
    const [size, offset] = entry.values as [number, number];
    if (size === 0 || offset >= source.length) return undefined;
    if (offset + size > source.length)
      throw new PdfError("E_PARSE", "CFF Private DICT extends past end of font");
    const fields = await readCffDictionary(source.subarray(offset, offset + size), PRIVATE_FIELDS);
    const relative = scalar(fields, 19);
    if (!relative || relative + offset >= source.length) return undefined;
    return readCffIndex(source, relative + offset, repairs);
  }
  const subrs = await privateSubrs(top);
  const fdIndex = isCID ? await readCffIndex(source, scalar(top, 3108)) : undefined;
  const fdValues = new StoredFontValues(storage, signal);
  if (isCID) {
    let position = scalar(top, 3109),
      length = 0;
    const format = await source.byte(position++);
    if (format === 0) {
      for (; length < glyphs.count; length++)
        await fdValues.set(length, await source.byte(position++));
    } else if (format === 3) {
      const count = ((await source.byte(position++))! << 8) | (await source.byte(position++))!;
      for (let i = 0; i < count; i++) {
        let first = ((await source.byte(position++))! << 8) | (await source.byte(position++))!;
        if (i === 0) first = 0;
        const id = await source.byte(position++);
        const next = ((await source.byte(position))! << 8) | (await source.byte(position + 1))!;
        for (let gid = first; gid < next; gid++) await fdValues.set(length++, id);
      }
    } else throw new PdfError("E_PARSE", "Unknown CFF FDSelect format");
    if (length !== glyphs.count) throw new PdfError("E_PARSE", "Invalid CFF FDSelect length");
  }
  const fdCache = new Map<
    number,
    {
      getByName(name: string): number[] | undefined;
      privateDict: { subrsIndex?: { objects: Index } | undefined };
    }
  >();
  const fdArray = {
    length: fdIndex?.count ?? 0,
    async get(id: number) {
      let value = fdCache.get(id);
      if (value) return value;
      const bytes = await fdIndex?.get(id);
      if (!bytes) return undefined;
      const dict = await readCffDictionary(bytes, TOP_FIELDS);
      const local = await privateSubrs(dict),
        childMatrix = matrix(dict);
      const transform = topMatrix
        ? childMatrix
          ? multiply(topMatrix, childMatrix)
          : topMatrix.slice()
        : (childMatrix ?? DEFAULT_MATRIX);
      value = {
        getByName(name) {
          return name === "FontMatrix" ? transform : undefined;
        },
        privateDict: { subrsIndex: local ? { objects: local } : undefined }
      };
      if (fdCache.size === 2) fdCache.delete(fdCache.keys().next().value!);
      fdCache.set(id, value);
      return value;
    }
  };
  const standard = new CFFStrings();
  const charsetOffset = scalar(top, 15);
  const predefined =
    charsetOffset >= 0 && charsetOffset <= 2
      ? new CFFParser(new Stream(new Uint8Array()), {}, false).parseCharsets(
          charsetOffset,
          glyphs.count,
          null,
          isCID
        ).charset
      : undefined;
  async function* charset(): AsyncGenerator<string | number> {
    if (predefined) {
      yield* predefined;
      return;
    }
    let position = charsetOffset;
    const format = await source.byte(position++);
    yield isCID ? 0 : ".notdef";
    if (format === 0) {
      for (let i = 1; i < glyphs.count; i++)
        yield ((await source.byte(position++))! << 8) | (await source.byte(position++))!;
    } else if (format === 1 || format === 2) {
      let length = 1;
      while (length < glyphs.count) {
        if (position + (format === 1 ? 3 : 4) > source.length)
          throw new PdfError("E_PARSE", "Truncated CFF charset range");
        let id = ((await source.byte(position++))! << 8) | (await source.byte(position++))!;
        let count = (await source.byte(position++))!;
        if (format === 2) count = (count << 8) | (await source.byte(position++))!;
        for (let i = 0; i <= count; i++) {
          yield id++;
          length++;
        }
      }
    } else throw new PdfError("E_PARSE", "Unknown CFF charset format");
  }
  return {
    source,
    repairs,
    glyphs,
    subrs,
    gsubrs,
    isCID,
    fdArray,
    fdSelect: {
      async getFDIndex(gid: number) {
        return (await fdValues.get(gid)) ?? -1;
      }
    },
    matrix: isCID && topMatrix ? DEFAULT_MATRIX : (topMatrix ?? DEFAULT_MATRIX),
    encodingOffset: scalar(top, 16),
    charset,
    async name(id: string | number): Promise<string | FontProgramRange | undefined> {
      if (typeof id === "string") return id;
      if (id >= 0 && id < 391) return standard.get(id);
      if (id - 391 > strings.count) return ".notdef";
      return strings.get(id - 391);
    }
  };
}
