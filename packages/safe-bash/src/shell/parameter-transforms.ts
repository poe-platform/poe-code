import { shellValueByteLength, shellValueBytes, shellValueFromBytes, type ShellValue, type ValueAllocation } from "../contracts/value.js";
import { scanString, stringCheckpoint, type StringWork } from "./string-operations.js";

interface TransformOptions {
  readonly maximumBytes: number;
  readonly byteLocale: boolean;
  readonly work: StringWork;
  readonly allocation: ValueAllocation;
}

function hexadecimal(byte: number): number {
  return byte >= 48 && byte <= 57 ? byte - 48 : byte >= 65 && byte <= 70 ? byte - 55 : byte >= 97 && byte <= 102 ? byte - 87 : -1;
}

function utf8Unit(bytes: Uint8Array, offset: number): { point: number; size: number } {
  const first = bytes[offset]!;
  if (first < 128) return { point: first, size: 1 };
  const size = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
  if (!size || offset + size > bytes.length) return { point: -1, size: 1 };
  let point = first & (127 >> size);
  for (let index = 1; index < size; index++) {
    const byte = bytes[offset + index]!;
    if (byte < 128 || byte > 191) return { point: -1, size: 1 };
    point = point * 64 + (byte & 63);
  }
  if (point < (size === 2 ? 128 : size === 3 ? 2048 : 65536) || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff) return { point: -1, size: 1 };
  return { point, size };
}

const controlEscapes: Readonly<Record<number, number>> = { 7: 97, 8: 98, 9: 116, 10: 110, 11: 118, 12: 102, 13: 114, 27: 69 };
const decodedEscapes: Readonly<Record<number, number>> = { 97: 7, 98: 8, 116: 9, 110: 10, 118: 11, 102: 12, 114: 13, 101: 27, 69: 27, 92: 92, 39: 39, 34: 34, 63: 63 };

/** Two-pass transforms: output length is admitted before its buffer exists. */
export async function transformParameter(value: ShellValue, operator: "Q" | "E", options: TransformOptions): Promise<ShellValue> {
  const { work, allocation, maximumBytes } = options;
  work.signal.throwIfAborted();
  if (typeof value === "string") {
    if (value.length > maximumBytes) work.exhausted();
    if ((await scanString(value, work)).bytes > maximumBytes) work.exhausted();
  } else if (shellValueByteLength(value) > maximumBytes) work.exhausted();
  const input = shellValueBytes(value, allocation);
  let ansi = false;
  if (operator === "Q") {
    for (let offset = 0; offset < input.length;) {
      const pending = stringCheckpoint(work);
      if (pending) await pending;
      const unit = options.byteLocale ? { point: input[offset]!, size: 1 } : utf8Unit(input, offset);
      const printable = unit.point >= 32 && unit.point < 127 || !options.byteLocale && unit.point >= 128 && !/[\p{Cc}\p{Cf}\p{Cn}]/u.test(String.fromCodePoint(unit.point));
      if (!printable) ansi = true;
      offset += unit.size;
    }
  }
  let output: Uint8Array | undefined = undefined;
  let size = 0;
  const emit = (byte: number): void => {
    if (size >= maximumBytes) work.exhausted();
    if (output) output[size] = byte;
    size++;
  };
  const ascii = (text: string): void => { for (let index = 0; index < text.length; index++) emit(text.charCodeAt(index)); };
  const scan = async (): Promise<void> => {
    size = 0;
    if (operator === "Q") {
      ascii(ansi ? "$'" : "'");
      for (let offset = 0; offset < input.length;) {
        const pending = stringCheckpoint(work);
        if (pending) await pending;
        const unit = options.byteLocale ? { point: input[offset]!, size: 1 } : utf8Unit(input, offset);
        const printable = unit.point >= 32 && unit.point < 127 || !options.byteLocale && unit.point >= 128 && !/[\p{Cc}\p{Cf}\p{Cn}]/u.test(String.fromCodePoint(unit.point));
        if (ansi && !printable) {
          if (unit.size === 1 && controlEscapes[input[offset]!] !== undefined) { emit(92); emit(controlEscapes[input[offset]!]!); }
          else for (let index = 0; index < unit.size; index++) ascii("\\" + input[offset + index]!.toString(8).padStart(3, "0"));
        } else if (unit.point === 39) ascii(ansi ? "\\'" : "'\\''");
        else if (ansi && unit.point === 92) ascii("\\\\");
        else for (let index = 0; index < unit.size; index++) emit(input[offset + index]!);
        offset += unit.size;
      }
      emit(39);
      return;
    }
    for (let offset = 0; offset < input.length;) {
      const pending = stringCheckpoint(work);
      if (pending) await pending;
      let byte = input[offset++]!;
      if (byte === 92 && offset < input.length) {
        const escape = input[offset++]!;
        if (decodedEscapes[escape] !== undefined) byte = decodedEscapes[escape]!;
        else if (escape >= 48 && escape <= 55) {
          byte = escape - 48;
          for (let count = 1; count < 3 && offset < input.length && input[offset]! >= 48 && input[offset]! <= 55; count++) byte = byte * 8 + input[offset++]! - 48;
          byte &= 255;
        } else if (escape === 120 || escape === 117 || escape === 85) {
          const maximum = escape === 120 ? 2 : escape === 117 ? 4 : 8;
          let point = 0;
          let count = 0;
          while (count < maximum && offset < input.length && hexadecimal(input[offset]!) >= 0) { point = point * 16 + hexadecimal(input[offset++]!); count++; }
          if (!count) { emit(92); emit(escape); continue; }
          if (escape === 120) byte = point;
          else {
            if (!point || point >= 0x80000000) return;
            if (options.byteLocale && point >= 0xd800 && point <= 0xdfff) ascii(`\\u${point.toString(16).toUpperCase().padStart(4, "0")}`);
            else {
              const width = point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : point < 0x200000 ? 4 : point < 0x4000000 ? 5 : 6;
              if (width === 1) emit(point);
              else {
                const divisor = 64 ** (width - 1);
                emit((256 - 2 ** (8 - width)) + Math.floor(point / divisor));
                for (let shift = width - 2; shift >= 0; shift--) emit(128 + Math.floor(point / 64 ** shift) % 64);
              }
            }
            continue;
          }
        } else if (escape === 99 && offset < input.length) {
          const control = input[offset++]!;
          if (control === 92 && input[offset] === 92) offset++;
          byte = control === 63 ? 127 : control & 31;
        } else { emit(92); byte = escape; }
      }
      if (!byte) return;
      emit(byte);
    }
  };
  await scan();
  allocation.reserve(size + 64, 1);
  output = new Uint8Array(size);
  await scan();
  work.signal.throwIfAborted();
  return shellValueFromBytes(output, allocation);
}
