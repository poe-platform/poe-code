import { shellValueBytes, shellValueFromBytes, type ShellValue, type ValueAllocation } from "../contracts/value.js";
import { compilePattern, compilePatternBoundaries } from "./pattern.js";
import { nextCodePointOffset, previousCodePointOffset, stringCheckpoint, type StringWork } from "./string-operations.js";

interface Projection {
  bytes: string;
  text: string;
  offsets: Int32Array;
  invalid: Uint32Array;
}

async function project(bytes: Uint8Array, work: StringWork): Promise<Projection> {
  work.allocation?.reserve(128 + (bytes.length + 1) * 16, 0);
  const offsets = new Int32Array(bytes.length + 1).fill(-1);
  const invalid = new Uint32Array(bytes.length + 1);
  let text = "";
  let binary = "";
  let errors = 0;
  for (let position = 0; position < bytes.length;) {
    const pending = stringCheckpoint(work);
    if (pending) await pending;
    offsets[position] = text.length;
    const first = bytes[position]!;
    let width = first < 128 ? 1 : first >= 194 && first <= 223 ? 2 : first >= 224 && first <= 239 ? 3 : first >= 240 && first <= 244 ? 4 : 0;
    let point = width === 1 ? first : first & (127 >> width);
    if (position + width > bytes.length) width = 0;
    for (let index = 1; index < width; index++) {
      const next = bytes[position + index]!;
      if (next < 128 || next > 191) { width = 0; break; }
      point = point * 64 + (next & 63);
    }
    if (width > 1 && (point < (width === 2 ? 128 : width === 3 ? 2048 : 65536) || point > 1114111 || point >= 55296 && point <= 57343)) width = 0;
    if (!width) { width = 1; point = 56320 + first; errors++; }
    text += String.fromCodePoint(point);
    for (let index = 0; index < width; index++) {
      binary += String.fromCharCode(bytes[position + index]!);
      invalid[position + index + 1] = errors;
    }
    position += width;
  }
  offsets[bytes.length] = text.length;
  return { bytes: binary, text, offsets, invalid };
}

export async function trimParameter(value: ShellValue, parts: readonly { value: ShellValue; literal: boolean }[], operator: string, byteMode: boolean, work: StringWork, allocation?: ValueAllocation): Promise<ShellValue> {
  const bytes = shellValueBytes(value, work.allocation);
  const subject = await project(bytes, work);
  let bytePattern = "";
  for (const part of parts) {
    const fragment = shellValueBytes(part.value, work.allocation);
    work.allocation?.reserve(64 + fragment.length * 4, 0);
    for (const byte of fragment) {
      const pending = stringCheckpoint(work);
      if (pending) await pending;
      const character = String.fromCharCode(byte);
      if (part.literal && "\\*?[]-^".includes(character)) bytePattern += "\\";
      bytePattern += character;
    }
  }
  work.allocation?.reserve(64 + bytePattern.length, 0);
  const patternBytes = new Uint8Array(bytePattern.length);
  for (let position = 0; position < patternBytes.length; position++) {
    const pending = stringCheckpoint(work);
    if (pending) await pending;
    patternBytes[position] = bytePattern.charCodeAt(position);
  }
  const projectedPattern = await project(patternBytes, work);
  const unicodePattern = projectedPattern.text;
  const patternInvalid = projectedPattern.invalid.at(-1)! > 0;
  const prefix = operator.startsWith("#");
  const longest = operator.length === 2;
  let cut: number | undefined;
  if (byteMode || !subject.invalid.at(-1)) {
    const text = byteMode ? subject.bytes : subject.text;
    const boundaries = await compilePatternBoundaries(byteMode ? bytePattern : unicodePattern, work);
    const ends = await boundaries(text, !longest && prefix, !prefix);
    let boundary = longest === prefix ? text.length : 0;
    while (true) {
      const pending = stringCheckpoint(work);
      if (pending) await pending;
      if (ends[prefix ? 0 : boundary] === (prefix ? boundary : text.length)) {
        if (byteMode) cut = boundary;
        else for (let position = 0; position < subject.offsets.length; position++) {
          const scanning = stringCheckpoint(work);
          if (scanning) await scanning;
          if (subject.offsets[position] === boundary) { cut = position; break; }
        }
        break;
      }
      if (boundary === (longest === prefix ? 0 : text.length)) break;
      boundary = longest === prefix ? previousCodePointOffset(text, boundary) : nextCodePointOffset(text, boundary);
    }
  } else {
    const byteMatch = await compilePattern(bytePattern, work);
    const unicodeMatch = await compilePattern(unicodePattern, work);
    for (let length = longest ? bytes.length : 0; longest ? length >= 0 : length <= bytes.length; length += longest ? -1 : 1) {
      const pending = stringCheckpoint(work);
      if (pending) await pending;
      const start = prefix ? 0 : bytes.length - length;
      const end = prefix ? length : bytes.length;
      const valid = !patternInvalid && subject.offsets[start]! >= 0 && subject.offsets[end]! >= 0 && subject.invalid[start] === subject.invalid[end];
      const matched = valid ? await unicodeMatch(subject.text, subject.offsets[start], subject.offsets[end]) : await byteMatch(subject.bytes, start, end);
      if (matched) { cut = prefix ? end : start; break; }
    }
  }
  work.signal.throwIfAborted();
  if (cut === undefined) return value;
  return shellValueFromBytes(bytes.subarray(prefix ? cut : 0, prefix ? bytes.length : cut), allocation);
}
