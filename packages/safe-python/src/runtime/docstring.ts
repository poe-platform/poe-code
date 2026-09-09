import type { ExecutionMeter } from "./execution-budget.js";
import { CodePointString } from "./code-point-string.js";
import { PythonEncodeError } from "./encode-error.js";

/** Python 3.14 compiler docstring cleanup: expand eight-column tabs, remove first
 * line leading ASCII spaces and the common indentation of subsequent nonblank
 * lines, preserving blank lines. Validate strict UTF-8 after expansion and before
 * indentation removal. Unlike inspect.cleandoc, do not trim newlines.
 * Work is metered; full host-string temporary allocation accounting is pending.
 */
export function cleanDocstring(points: Uint32Array, meter: ExecutionMeter): string {
  meter.checkpoint();
  const expanded: string[] = [];
  let column = 0, length = 0, invalidStart = -1, invalidEnd = -1;
  for (const point of points) {
    meter.checkpoint();
    if (point === 9) {
      const width = 8 - column % 8;
      expanded.push(" ".repeat(width)); column += width; length += width;
    } else {
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
    throw new PythonEncodeError("utf-8", new CodePointString(errorPoints, meter), invalidStart, invalidEnd, "surrogates not allowed");
  }
  const lines = expanded.join("").split("\n"), indents: number[] = [];
  let margin = Infinity;
  for (let index = 0; index < lines.length; index++) {
    meter.checkpoint();
    const line = lines[index];
    let indent = 0;
    while (line[indent] === " ") { meter.checkpoint(); indent++; }
    indents.push(indent);
    if (index > 0 && indent < line.length) margin = Math.min(margin, indent);
  }
  if (margin === Infinity) margin = 0;
  for (let index = 0; index < lines.length; index++) {
    meter.checkpoint();
    lines[index] = lines[index].slice(index === 0 ? indents[index] : Math.min(margin, indents[index]));
  }
  return lines.join("\n");
}
