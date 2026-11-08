import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { parseA1, type Cell, type Range, type Sheet } from "../workbook.js";
import { metadataNode, type MetadataNode } from "./xlsx-write-support.js";

/** Shared admission and retained Gnumeric metadata, independent of document syntax. */
export function documentOutput(context: CapabilityContext, name: string, latin = false) {
  let work = 0, size = 0;
  const chunks: Uint8Array[] = [];
  const maximum = context.limits.workbookWork ?? context.limits.inputBytes * 8 + context.limits.cells * 32;
  function tick(amount = 1) {
    context.signal.throwIfAborted();
    if (amount > maximum - work) throw new SsconvertError("resource-limit", `ssconvert ${name} work limit exceeded`);
    work += amount;
  }
  function put(text: string) {
    tick(text.length);
    if (text.length > context.limits.outputBytes - size) throw new SsconvertError("resource-limit", `ssconvert ${name} output bytes limit exceeded`);
    const bytes = latin ? Uint8Array.from(text, c => c.charCodeAt(0)) : new TextEncoder().encode(text);
    if (bytes.length > context.limits.outputBytes - size) throw new SsconvertError("resource-limit", `ssconvert ${name} output bytes limit exceeded`);
    size += bytes.length; chunks.push(bytes);
  }
  function finish() {
    tick(); const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return bytes;
  }
  return { tick, put, finish };
}
export function documentSheet(sheet: Sheet, context: CapabilityContext, tick: (amount?: number) => void, mergesExtend: boolean, range?: Range) {
  const records = new Map<string, MetadataNode[]>();
  for (const record of sheet.unsupportedRecords ?? []) {
    tick(); const node = metadataNode(record.data, tick);
    if (node) records.set(record.kind, [...(records.get(record.kind) ?? []), ...node.children]);
  }
  const cells = new Map<string, Cell>();
  let startRow = Infinity, startColumn = Infinity, endRow = 0, endColumn = 0;
  function extend(r: Range) {
    startRow = Math.min(startRow, r.startRow); startColumn = Math.min(startColumn, r.startColumn);
    endRow = Math.max(endRow, r.endRow); endColumn = Math.max(endColumn, r.endColumn);
  }
  for (const cell of sheet.cells) {
    tick(); if (cells.size >= context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert document cells limit exceeded");
    cells.set(`${cell.row}:${cell.column}`, cell);
    const v = cell.cachedResult ?? cell.value;
    if (v.kind !== "blank" && !(v.kind === "string" && !v.value)) extend({ startRow: cell.row, endRow: cell.row, startColumn: cell.column, endColumn: cell.column });
  }
  if (mergesExtend) for (const merge of sheet.merges ?? []) {
    tick(); const cell = cells.get(`${merge.startRow}:${merge.startColumn}`), value = cell?.cachedResult ?? cell?.value;
    if (value && value.kind !== "blank" && !(value.kind === "string" && !value.value)) extend(merge);
  }
  for (const object of records.get("Objects") ?? []) {
    tick(); const parts = (object.attributes.ObjectBound ?? "").split(":").map(address => parseA1(address));
    if (parts[0]) extend({ startRow: parts[0].row, startColumn: parts[0].column, endRow: (parts[1] ?? parts[0]).row, endColumn: (parts[1] ?? parts[0]).column });
  }
  function styleAt(row: number, column: number, cell?: Cell): MetadataNode | undefined {
    let style: MetadataNode | undefined;
    for (const region of records.get("Styles") ?? []) {
      tick(); const a = region.attributes;
      if (row >= Number(a.startRow) && row <= Number(a.endRow) && column >= Number(a.startCol) && column <= Number(a.endCol)) {
        const next = region.children.find(n => n.name === "Style");
        if (next) style = style ? { ...next, attributes: { ...style.attributes, ...next.attributes }, children: [...style.children.filter(n => !next.children.some(c => c.name === n.name)), ...next.children] } : next;
      }
    }
    return metadataNode(cell?.style?.gnumeric, tick) ?? style;
  }
  const extent = range ?? { startRow: startRow === Infinity ? 0 : startRow, startColumn: startColumn === Infinity ? 0 : startColumn, endRow, endColumn };
  const count = (extent.endRow - extent.startRow + 1) * (extent.endColumn - extent.startColumn + 1);
  if (!Number.isSafeInteger(count) || count < 0 || count > maximumWork(context)) throw new SsconvertError("resource-limit", "ssconvert document range limit exceeded");
  return { cells, extent, records, styleAt };
}
function maximumWork(context: CapabilityContext): number { return context.limits.workbookWork ?? context.limits.inputBytes * 8 + context.limits.cells * 32; }
export function documentFont(style: MetadataNode | undefined) {
  const font = style?.children.find(n => n.name === "Font");
  const name = (font?.text ?? "Sans").toLowerCase();
  return { attributes: font?.attributes ?? {}, mono: name === "courier" || name === "fixed", helvetica: name === "helvetica", sans: ["helvetica", "avantgarde", "neep", "blippo", "capri", "clean", "fixed"].includes(name) };
}
