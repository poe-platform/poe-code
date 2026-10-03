import type {ImageFormat} from "../ast.js";
export function* netpbmHeaderSteps(size: number): Generator<number, {
  magic: string;
  format: ImageFormat;
  width: number;
  height: number;
  maxval: number;
  dataOffset: number;
},number|undefined> {
  const magic = String.fromCharCode((yield 0)!, (yield 1)!);
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
    dataOffset: pos
  };
}

export function parseNetpbmHeader(bytes:Uint8Array) {
 const steps=netpbmHeaderSteps(bytes.length);
 let next=steps.next();
 while(!next.done) next=steps.next(bytes[next.value]);
 return next.value;
}
