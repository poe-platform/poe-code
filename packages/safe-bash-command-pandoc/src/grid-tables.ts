import type {AdapterContext} from "./types.js";

/** Grid columns are delimited by fixed border positions, not pipes in cell text. */
export function gridTable(lines: readonly string[], context: AdapterContext) {
  const top = lines[0]?.trimEnd();
  if (!top?.startsWith("+-")) return undefined;
  const edges = [0];
  for (let i = 1; i < top.length; i++) {
    context.checkpoint();
    if (top[i] === "+" && i > edges[edges.length - 1]! + 1) edges.push(i);
    else if (top[i] !== "-") return undefined;
  }
  if (edges.length < 2 || edges[edges.length - 1] !== top.length - 1) return undefined;
  context.charge("retainedBytes", edges.length * 8);
  const rows: string[][] = [];
  let header: string[] | undefined, cells: string[][] = [], consumed = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trimEnd();
    context.checkpoint(line.length);
    if (line.startsWith("+")) {
      const separator = line[1];
      if (line.length !== top.length || (separator !== "-" && separator !== "=")) return undefined;
      let edge = 0;
      for (let j = 0; j < line.length; j++) {
        if (j === edges[edge]) {if (line[j] !== "+") return undefined; edge++;}
        else if (line[j] !== separator) return undefined;
      }
      if (!cells.length) return undefined;
      const row = cells.map(parts => {
        // Remove the common padding, preserving indentation inside block content.
        let indent = Infinity;
        for (const part of parts) if (part.trim()) {
          let start = 0; while (part[start] === " ") start++;
          indent = Math.min(indent, start);
        }
        return parts.map(part => part.slice(Number.isFinite(indent) ? indent : 0).trimEnd()).join("\n").trimEnd();
      });
      if (separator === "=") {
        if (header || rows.length) return undefined;
        header = row;
      } else rows.push(row);
      cells = [];
      consumed = i + 1;
      if (!lines[i + 1]?.startsWith("|")) break;
    } else {
      if (line.length !== top.length || edges.some(edge => line[edge] !== "|")) return undefined;
      if (!cells.length) {
        context.charge("tableCells", edges.length - 1);
        cells = edges.slice(1).map(() => []);
      }
      for (let column = 0; column < cells.length; column++) {
        const part = line.slice(edges[column]! + 1, edges[column + 1]);
        context.charge("retainedBytes", part.length * 2 + 16);
        cells[column]!.push(part);
      }
    }
  }
  if (!consumed || cells.length) return undefined;
  const denominator = Math.max(72, top.length - 1);
  return {header, rows, consumed, widths: edges.slice(1).map((edge, index) => (edge - edges[index]!) / denominator)};
}
