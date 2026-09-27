import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { FormulaGroup, Workbook } from "../workbook.js";
import { formatA1 } from "../workbook/model.js";
import { parseExpression } from "../formulas/parser.js";
import { Binary, invalidBiff } from "./biff-binary.js";

/** Excel File Format 1.42 sections 5.24-25; modern mapping also follows Gnumeric. */
export function readBiffDataTable(data: Binary, revision: number, opcode: number): string | undefined {
  const both = revision === 2 ? opcode === 0x37 : !!(data.u16(6) & 8);
  data.check(0, revision === 2 && !both ? 12 : 16);
  const flags = revision === 2 ? data.u8(7) : data.u16(6);
  // MS-XLS 2.4.319: BIFF8 reserved bits and an unused second input are ignored.
  // Active deleted inputs remain unrepresented; retain their records and caches.
  if (revision === 2 ? !both && flags > 1 : revision >= 8 ? flags & (both ? 0x30 : 0x10) : flags & ~15) return undefined;
  const row = revision === 2 ? !!flags : !!(flags & 4);
  const input = (offset: number) => {
    const r = data.u16(offset), c = data.u16(offset + 2);
    if (c >= 256 || r >= (revision === 8 ? 65536 : 16384)) invalidBiff("invalid data-table input cell");
    return formatA1(r, c);
  };
  const first = input(8);
  return `=TABLE(${both || row ? first : ""},${both ? input(12) : row ? "" : first})`;
}

/** Recognize TABLE only in an array group, where its border/input semantics apply. */
export function writeBiffDataTable(group: FormulaGroup, sheet: string, book: Workbook,
  context: CapabilityContext, maxRows: number): Uint8Array | undefined {
  const position = { sheet, row: group.range.startRow, column: group.range.startColumn };
  const parsed = parseExpression(group.expression, { workbook: book, position, signal: context.signal,
    maximumNodes: context.limits.workbookNodes ?? context.limits.cells,
    maximumLength: context.limits.workbookTextBytes ?? context.limits.outputBytes });
  if (!parsed.ok) return undefined;
  let root = parsed.document.root;
  while (root.kind === "parentheses") root = root.child;
  if (root.kind !== "call" || root.name !== "TABLE") return undefined;
  if (root.args.length !== 2 || position.row < 1 || position.column < 1)
    throw new SsconvertError("unsupported-feature", "Cannot export Excel data table without its border or two input slots");
  const inputs = root.args.map(arg => {
    if (arg.kind === "omitted" || arg.kind === "literal" && arg.value.kind === "blank") return undefined;
    if (arg.kind !== "reference" || arg.last || !arg.first.row || !arg.first.column)
      throw new SsconvertError("unsupported-feature", "Cannot export Excel data table input expression");
    // TABLE evaluates raw coordinates on its own sheet, including qualified inputs.
    const row = arg.first.row.value + (arg.first.row.relative ? position.row : 0);
    const column = arg.first.column.value + (arg.first.column.relative ? position.column : 0);
    if (row < 0 || row >= maxRows || column < 0 || column >= 256)
      throw new SsconvertError("unsupported-feature", "Cannot export Excel data table input outside version limits");
    return { row, column };
  });
  if (!inputs[0] && !inputs[1]) throw new SsconvertError("unsupported-feature", "Cannot export Excel data table without an input cell");
  if (context.limits.outputBytes < 16) throw new SsconvertError("resource-limit", "ssconvert BIFF data-table bytes limit exceeded");
  const bytes = new Uint8Array(16), data = new DataView(bytes.buffer);
  data.setUint16(0, position.row, true); data.setUint16(2, Math.min(group.range.endRow, maxRows - 1), true);
  bytes[4] = position.column; bytes[5] = Math.min(group.range.endColumn, 255);
  data.setUint16(6, inputs[0] && inputs[1] ? 12 : inputs[0] ? 4 : 0, true);
  const first = inputs[0] ?? inputs[1]!;
  data.setUint16(8, first.row, true); data.setUint16(10, first.column, true);
  if (inputs[0] && inputs[1]) { data.setUint16(12, inputs[1].row, true); data.setUint16(14, inputs[1].column, true); }
  return bytes;
}
