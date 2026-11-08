import type {ImageFormat} from "../ast.js";
export function* netpbmHeaderSteps(size: number): Generator<number, {
  magic: string;
  format: ImageFormat;
  width: number;
  height: number;
  maxval: number;
  channels: 1 | 2 | 3 | 4 | 5;
  cmyk: boolean;
  hasAlpha: boolean;
  dataOffset: number;
},number|undefined> {
  const magic = String.fromCharCode((yield 0)!, (yield 1)!);
  if (magic === "P7") {
    let pos = 2;
    const fields = new Map<string, string>();
    while (pos < size) {
      let line = "";
      while (pos < size) {
        const byte = (yield pos++)!;
        if (byte === 10) break;
        line += String.fromCharCode(byte);
        if (line.length > 4096) throw new Error("PAM header line too long");
      }
      line = line.split("#")[0]!.trim();
      if (line === "ENDHDR") {
        const width = Number(fields.get("WIDTH")), height = Number(fields.get("HEIGHT"));
        const channels = Number(fields.get("DEPTH")), maxval = Number(fields.get("MAXVAL"));
        const tuple = fields.get("TUPLTYPE");
        if (!Number.isSafeInteger(width * height * 4) || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
            ![1, 2, 3, 4, 5].includes(channels) || !Number.isInteger(maxval) || maxval < 1 || maxval > 65535)
          throw new Error("Invalid PAM header");
        const tuples: Record<string, number> = { BLACKANDWHITE: 1, BLACKANDWHITE_ALPHA: 2, GRAYSCALE: 1, GRAYSCALE_ALPHA: 2, RGB: 3, RGB_ALPHA: 4, CMYK: 4, CMYK_ALPHA: 5 };
        if ((tuple && tuples[tuple] !== channels) || (channels === 5 && tuple !== "CMYK_ALPHA")) throw new Error("Unsupported PAM tuple type");
        return { magic, format: "pam", width, height, maxval, channels: channels as 1 | 2 | 3 | 4 | 5, cmyk: tuple === "CMYK" || tuple === "CMYK_ALPHA", hasAlpha: tuple === "CMYK_ALPHA" || (tuple !== "CMYK" && (channels === 2 || channels === 4)), dataOffset: pos };
      }
      if (!line) continue;
      let separator = 0;
      while (separator < line.length && line[separator] !== " " && line[separator] !== "\t") separator++;
      const key = line.slice(0, separator);
      if (["WIDTH", "HEIGHT", "DEPTH", "MAXVAL", "TUPLTYPE"].includes(key)) fields.set(key, line.slice(separator).trim());
    }
    throw new Error("Missing PAM ENDHDR");
  }
  const format: ImageFormat =
    magic === "P1" || magic === "P4"
      ? "pbm"
      : magic === "P2" || magic === "P5"
        ? "pgm"
        : "ppm";
  let pos = 2;
  const tokens: number[] = [];
  const needed = format === "pbm" ? 2 : 3;

  while (pos < size && tokens.length < needed) {
    while (pos < size) {
      const c = (yield pos)!;
      if (c === 0x23) {
        // '#' comment
        while (pos < size && (yield pos) !== 0x0a && (yield pos) !== 0x0d) pos++;
      } else if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
        pos++;
      } else {
        break;
      }
    }
    let num = 0;
    let hasDigit = false;
    while (pos < size && (yield pos)! >= 0x30 && (yield pos)! <= 0x39) {
      num = num * 10 + ((yield pos)! - 0x30);
      hasDigit = true;
      pos++;
    }
    if (!hasDigit) break;
    tokens.push(num);
  }
  // If there is horizontal whitespace followed by a # comment on the final header line, skip to newline
  let look = pos;
  while (look < size && ((yield look) === 0x20 || (yield look) === 0x09)) look++;
  if (look < size && (yield look) === 0x23) {
    pos = look;
    while (pos < size && (yield pos) !== 0x0a && (yield pos) !== 0x0d) pos++;
  }
  // Skip the single terminating whitespace/newline character after header
  if (
    pos < size &&
    ((yield pos) === 0x20 || (yield pos) === 0x09 || (yield pos) === 0x0a || (yield pos) === 0x0d)
  ) {
    if ((yield pos) === 0x0d && (yield pos + 1) === 0x0a) pos += 2;
    else pos++;
  }

  return {
    magic,
    format,
    width: tokens[0] ?? 0,
    height: tokens[1] ?? 0,
    maxval: format === "pbm" ? 1 : (tokens[2] ?? 255),
    channels: format === "ppm" ? 3 : 1,
    cmyk: false,
    hasAlpha: false,
    dataOffset: pos
  };
}

export function parseNetpbmHeader(bytes:Uint8Array) {
 const steps=netpbmHeaderSteps(bytes.length);
 let next=steps.next();
 while(!next.done) next=steps.next(bytes[next.value]);
 return next.value;
}

/** Locate frames by raster length, never by searching binary pixels for a magic string. */
export function* netpbmSequenceSteps(size: number, page?: number): Generator<number, {
  header: ReturnType<typeof parseNetpbmHeader>;
  pages: number;
}, number | undefined> {
  let offset = 0, pages = 0;
  let first: ReturnType<typeof parseNetpbmHeader> | undefined;
  while (offset < size) {
    const steps = netpbmHeaderSteps(size - offset);
    let next = steps.next();
    while (!next.done) next = steps.next(yield offset + next.value);
    const header = { ...next.value, dataOffset: offset + next.value.dataOffset };
    if (!["P1", "P2", "P3", "P4", "P5", "P6", "P7"].includes(header.magic)) throw new Error("Invalid Netpbm signature");
    first ??= header;
    if (pages++ === page) return { header, pages };
    const { width, height, magic, maxval } = header;
    if (!Number.isSafeInteger(width * height) || width <= 0 || height <= 0) throw new RangeError("Invalid Netpbm dimensions");
    offset = header.dataOffset;
    if (magic === "P4") offset += Math.ceil(width / 8) * height;
    else if (magic === "P5" || magic === "P6" || magic === "P7") {
      offset += width * height * header.channels * (maxval > 255 ? 2 : 1);
      if (magic === "P7" && offset > size) throw new Error("Truncated PAM raster");
    }
    else {
      for (let samples = width * height * (magic === "P3" ? 3 : 1); samples > 0 && offset < size; samples--) {
        while (offset < size) {
          const c = (yield offset)!;
          if (c === 35) { while (offset < size && (yield offset) !== 10 && (yield offset) !== 13) offset++; }
          else if (c <= 32) offset++;
          else break;
        }
        const start = offset;
        while (offset < size && (yield offset)! >= 48 && (yield offset)! <= 57) offset++;
        if (start === offset) { offset = size; break; }
      }
    }
    while (offset < size) {
      const c = (yield offset)!;
      if (c === 35) { while (offset < size && (yield offset) !== 10 && (yield offset) !== 13) offset++; }
      else if (c <= 32) offset++;
      else break;
    }
  }
  if (!first || page !== undefined) throw new RangeError("Netpbm page out of range");
  return { header: first, pages };
}

export function parseNetpbmSequence(bytes: Uint8Array, page?: number) {
  const steps = netpbmSequenceSteps(bytes.length, page);
  let next = steps.next();
  while (!next.done) next = steps.next(bytes[next.value]);
  return next.value;
}
