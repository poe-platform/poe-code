import type { ExecutionMeter } from "./execution-budget.js";

/** Python 3.14 compiler docstring cleanup: expand eight-column tabs, remove first
 * line leading ASCII spaces and the common indentation of subsequent nonblank
 * lines, preserving blank lines. Unlike inspect.cleandoc, do not trim newlines.
 * Work is metered; full host-string temporary allocation accounting is pending.
 */
export function cleanDocstring(points: Uint32Array, meter: ExecutionMeter): string {
  meter.checkpoint();
  const expanded: string[] = [];
  let column = 0;
  for (const point of points) {
    meter.checkpoint();
    if (point === 9) {
      const width = 8 - column % 8;
      expanded.push(" ".repeat(width)); column += width;
    } else {
      expanded.push(String.fromCodePoint(point));
      column = point === 10 || point === 13 ? 0 : column + 1;
    }
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
