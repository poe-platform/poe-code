import { CodePointString } from "./code-point-string.js";
import { encodeUtf8, type Utf8EncodeErrors } from "./utf8-encode.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { validateTextNewline } from "./text-newline-validation.js";

export interface Utf8TextEncodeOptions {
  readonly newline?: string | null;
  /** Guest platform separator; deliberately independent of the host OS. */
  readonly lineSeparator?: "\n" | "\r" | "\r\n";
  readonly errors?: Utf8EncodeErrors;
}

export interface Utf8TextWrite {
  readonly bytes: Uint8Array;
  /** Original code-point count, not translated character or encoded byte count. */
  readonly characters: number;
  /** Whether the original write contains CR or LF, for stream line buffering. */
  readonly lineBreak: boolean;
}

/** Prepare a complete write without performing I/O or retaining caller data. */
export function encodeUtf8Text(input: CodePointString, options: Utf8TextEncodeOptions = {}, meter?: ExecutionMeter): Utf8TextWrite {
  meter?.checkpoint();
  const newline = options.newline ?? null;
  validateTextNewline(newline, meter);
  const separator = newline === null ? options.lineSeparator ?? "\n" : newline;
  let feeds = 0, lineBreak = false;
  for (let index = 0; index < input.length; index++) {
    const point = input.codePointAt(BigInt(index), meter);
    if (point === 10) feeds++;
    if (point === 10 || point === 13) lineBreak = true;
  }
  let translated = input;
  if (feeds !== 0 && (separator === "\r" || separator === "\r\n")) {
    const length = input.length + (separator === "\r\n" ? feeds : 0);
    meter?.checkpoint(0, length * Uint32Array.BYTES_PER_ELEMENT);
    const points = new Uint32Array(length);
    let written = 0;
    for (let index = 0; index < input.length; index++) {
      const point = input.codePointAt(BigInt(index), meter);
      if (point === 10) {
        points[written++] = 13;
        if (separator === "\r\n") points[written++] = 10;
      } else points[written++] = point;
    }
    translated = new CodePointString(points, meter);
  }
  const bytes = encodeUtf8(translated, options.errors, meter);
  return { bytes, characters: input.length, lineBreak };
}
