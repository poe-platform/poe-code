import type { ExecutionMeter } from "./execution-budget.js";
import { CodePointString } from "./code-point-string.js";
import { PythonEncodeError } from "./encode-error.js";

/** Python 3.14 compiler docstring cleanup: expand eight-column tabs, remove first
 * line leading ASCII spaces and the common indentation of subsequent nonblank
 * lines, preserving blank lines. Validate strict UTF-8 after expansion and before
 * indentation removal. Unlike inspect.cleandoc, do not trim newlines.
 * Work and temporary strings/arrays are charged before materialization.
 */
export function cleanDocstring(points: Uint32Array, meter: ExecutionMeter): string {
  try {
  meter.checkpoint(1, 32);
  const expanded: string[] = [];
  let column = 0, length = 0, invalidStart = -1, invalidEnd = -1;
  let units = 0, lineCount = 1;
  for (const point of points) {
    meter.checkpoint();
    if (point === 9) {
      const width = 8 - column % 8;
      meter.checkpoint(width, 40 + 2 * width);
      units += width;
      expanded.push(" ".repeat(width)); column += width; length += width;
    } else {
      const width = point > 0xffff ? 2 : 1;
      meter.checkpoint(1, 40 + 2 * width);
      units += width;
      if (point === 10) lineCount++;
      if (point >= 0xd800 && point <= 0xdfff && (invalidStart === -1 || invalidEnd === length)) {
        if (invalidStart === -1) invalidStart = length;
        invalidEnd = length + 1;
      }
      expanded.push(String.fromCodePoint(point));
      length++;
      column = point === 10 || point === 13 ? 0 : column + 1;
    }
  }
  if (invalidStart !== -1) {
    meter.checkpoint(1, length * Uint32Array.BYTES_PER_ELEMENT);
    const errorPoints = new Uint32Array(length);
    let index = 0;
    // Decode each original expansion separately. Joining UTF-16 fragments first
    // would incorrectly combine adjacent high/low surrogate code points.
    for (const part of expanded) for (const character of part) {
      meter.checkpoint(); errorPoints[index++] = character.codePointAt(0)!;
    }
    meter.checkpoint(1, 512);
    throw new PythonEncodeError("utf-8", new CodePointString(errorPoints, meter), invalidStart, invalidEnd, "surrogates not allowed");
  }
  meter.checkpoint(1 + units, 96 + 4 * units + lineCount * 40);
  const lines = expanded.join("").split("\n"), indents: number[] = [];
  let margin = Infinity;
  for (let index = 0; index < lines.length; index++) {
    meter.checkpoint();
    const line = lines[index];
    let indent = 0;
    while (line[indent] === " ") { meter.checkpoint(); indent++; }
    meter.checkpoint(0, 8); indents.push(indent);
    if (index > 0 && indent < line.length) margin = Math.min(margin, indent);
  }
  if (margin === Infinity) margin = 0;
  for (let index = 0; index < lines.length; index++) {
    meter.checkpoint();
    const start = index === 0 ? indents[index] : Math.min(margin, indents[index]);
    meter.checkpoint(1 + lines[index].length - start, 32 + 2 * (lines[index].length - start));
    lines[index] = lines[index].slice(start);
  }
  meter.checkpoint(1 + units, 32 + 2 * units);
  return lines.join("\n");
  } finally { meter.checkpoint(); }
}
