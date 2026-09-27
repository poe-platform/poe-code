import { SsconvertError } from "../contracts.js";
import { DEFAULT_SHEET_SIZE, type LabelRange, type Range, type Sheet } from "../workbook.js";
import { Binary, invalidBiff } from "./biff-binary.js";
import type { BiffOutput } from "./biff-write-binary.js";

// Calc xicontent.cxx constructs pairs from label rectangles. This codec binds
// the inferred data endpoints to its BIFF8 sheet size, not Calc's larger grid.
function dataRange(labels: Range, axis: LabelRange["axis"]): Range {
  if (axis === "row") return labels.endColumn < DEFAULT_SHEET_SIZE.columns - 1
    ? { ...labels, startColumn: labels.endColumn + 1, endColumn: DEFAULT_SHEET_SIZE.columns - 1 }
    : labels.startColumn > 0 ? { ...labels, startColumn: 0, endColumn: labels.startColumn - 1 } : { ...labels };
  return labels.endRow < DEFAULT_SHEET_SIZE.rows - 1
    ? { ...labels, startRow: labels.endRow + 1, endRow: DEFAULT_SHEET_SIZE.rows - 1 }
    : labels.startRow > 0 ? { ...labels, startRow: 0, endRow: labels.startRow - 1 } : { ...labels };
}

export function readBiffLabelRanges(parts: readonly Binary[], charge: (amount: number) => void): LabelRange[] {
  let part = 0, offset = 0;
  const byte = () => {
    while (part < parts.length && offset === parts[part]!.bytes.length) { part++; offset = 0; }
    if (part === parts.length) invalidBiff("truncated LABELRANGES");
    return parts[part]!.u8(offset++);
  };
  const word = () => byte() | byte() << 8;
  const pairs: LabelRange[] = [];
  for (const axis of ["row", "column"] as const) {
    const count = word(); charge(count);
    for (let i = 0; i < count; i++) {
      charge(0);
      const labels = { startRow: word(), endRow: word(), startColumn: word(), endColumn: word() };
      if (labels.startRow > labels.endRow || labels.startColumn > labels.endColumn || labels.endColumn >= 256)
        invalidBiff("invalid LABELRANGES rectangle");
      pairs.push({ axis, labels, data: dataRange(labels, axis) });
    }
  }
  if (parts.some((value, i) => i > part ? value.bytes.length !== 0 : i === part && offset !== value.bytes.length))
    invalidBiff("trailing LABELRANGES bytes");
  return pairs;
}

export function writeBiffLabelRanges(sheet: Sheet, revision: 7 | 8, output: BiffOutput, charge: (amount: number) => void): void {
  const pairs = sheet.labelRanges ?? [];
  if (!pairs.length) return;
  if (revision !== 8) throw new SsconvertError("unsupported-feature", "Excel BIFF7 cannot encode label ranges");
  const rows: Range[] = [], columns: Range[] = [];
  for (const pair of pairs) {
    charge(1);
    if (pair.axis !== "row" && pair.axis !== "column") throw new SsconvertError("invalid-request", "Invalid label range axis");
    if (pair.dataSheet !== undefined && pair.dataSheet !== sheet.id)
      throw new SsconvertError("unsupported-feature", "Excel BIFF8 cannot preserve label data on another sheet");
    const labels = pair.labels, expected = dataRange(labels, pair.axis);
    for (const [key, maximum] of [["startRow", 65536], ["endRow", 65536], ["startColumn", 256], ["endColumn", 256]] as const)
      if (!Number.isSafeInteger(labels[key]) || labels[key] < 0 || labels[key] >= maximum || pair.data[key] !== expected[key])
        throw new SsconvertError("unsupported-feature", "Excel BIFF8 cannot preserve these label/data ranges");
    if (labels.startRow > labels.endRow || labels.startColumn > labels.endColumn)
      throw new SsconvertError("invalid-request", "Reversed label range");
    const list = pair.axis === "row" ? rows : columns;
    if (list.length >= 65535) throw new SsconvertError("unsupported-feature", "Excel BIFF8 label range count exceeds version limits");
    list.push(labels);
  }
  // Stream words into bounded BIFF records; CONTINUE has no string-width byte.
  let payload = new Uint8Array(output.maximumRecord), offset = 0, opcode = 0x15f;
  const word = (value: number) => {
    if (offset === payload.length) { output.record(opcode, payload); opcode = 0x3c; payload = new Uint8Array(output.maximumRecord); offset = 0; }
    payload[offset++] = value & 255; payload[offset++] = value >> 8;
  };
  for (const ranges of [rows, columns]) {
    word(ranges.length);
    for (const range of ranges) { charge(1); word(range.startRow); word(range.endRow); word(range.startColumn); word(range.endColumn); }
  }
  output.record(opcode, payload.subarray(0, offset));
}
