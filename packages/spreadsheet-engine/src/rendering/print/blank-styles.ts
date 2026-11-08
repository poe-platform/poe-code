import type {Cell, ImportedValue, Range, Sheet} from "@poe-code/spreadsheet-ast";
import {SsconvertError} from "../../contracts.js";
import {cellPrintStyle} from "./cell-style.js";

const namespace = "http://www.gnumeric.org/v10.dtd";
function object(value: ImportedValue | undefined): Readonly<Record<string, ImportedValue>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, ImportedValue>> : undefined;
}

/** Project retained backgrounds/borders only inside already selected print pages. */
export function createPrintBlankStyles(sheet: Sheet, mergeRows: (row: number) => readonly Range[], tick: (amount?: number) => void) {
  const occupied = new Set<string>();
  for (const cell of sheet.cells) {tick(); occupied.add(`${cell.row}:${cell.column}`);}
  const regions: {range: Range; style: Readonly<Record<string, ImportedValue>>}[] = [];
  for (const record of sheet.unsupportedRecords ?? []) {
    tick();
    if (record.source !== "Gnumeric_XmlIO:sax" || record.kind !== "Styles" || record.disposition !== "retained") continue;
    const data = object(record.data);
    for (const raw of Array.isArray(data?.children) ? data.children : []) {
      tick();
      const region = object(raw);
      if (region?.name !== "StyleRegion" || region.namespace !== namespace) continue;
      const bounds: Record<string, number> = {};
      for (const raw of Array.isArray(region.attributes) ? region.attributes : []) {
        tick();
        const attribute = object(raw);
        if (attribute?.namespace === "" && typeof attribute.name === "string") bounds[attribute.name] = Number(attribute.value);
      }
      const range = {startRow: bounds.startRow!, endRow: bounds.endRow!, startColumn: bounds.startCol!, endColumn: bounds.endCol!};
      if (!Object.values(range).every(value => Number.isSafeInteger(value) && value >= 0) || range.startRow > range.endRow || range.startColumn > range.endColumn)
        throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: invalid PDF retained style region");
      const style = (Array.isArray(region.children) ? region.children : []).map(object).find(node => node?.name === "Style" && node.namespace === namespace);
      if (!style) continue;
      // Blank cells have no font, format, alignment or text effects. Modern
      // regions replace; the importer has already resolved legacy overlays.
      regions.push({range, style: {gnumeric: {...style,
        attributes: (Array.isArray(style.attributes) ? style.attributes : []).filter(raw => {
          tick(); const attribute = object(raw);
          return attribute?.namespace === "" && ["Shade", "Back", "PatternColor"].includes(String(attribute.name));
        }),
        children: (Array.isArray(style.children) ? style.children : []).filter(raw => {
          tick(); const child = object(raw); return child?.name !== "Font" || child.namespace !== namespace;
        })}}});
    }
  }
  const intersects = (a: Range, b: Range) => a.startRow <= b.endRow && b.startRow <= a.endRow && a.startColumn <= b.endColumn && b.startColumn <= a.endColumn;
  const blankCells = (area: Range): {cell: Cell; merge: Range | undefined}[] => {
    const candidates = new Map<string, {row: number; column: number; style: Readonly<Record<string, ImportedValue>>}>();
    for (const {range, style} of regions) {
      tick();
      if (!intersects(range, area)) continue;
      for (let row = Math.max(range.startRow, area.startRow); row <= Math.min(range.endRow, area.endRow); row++)
        for (let column = Math.max(range.startColumn, area.startColumn); column <= Math.min(range.endColumn, area.endColumn); column++) {
          tick(); const key = `${row}:${column}`;
          if (!occupied.has(key)) candidates.set(key, {row, column, style});
        }
    }
    // A merge continuing onto this page takes its style from its real corner.
    for (const merge of sheet.merges ?? []) {
      tick();
      if (!intersects(merge, area)) continue;
      const row = merge.startRow, column = merge.startColumn, key = `${row}:${column}`;
      if (occupied.has(key)) continue;
      for (const {range, style} of regions) {
        tick();
        if (row >= range.startRow && row <= range.endRow && column >= range.startColumn && column <= range.endColumn)
          candidates.set(key, {row, column, style});
      }
    }
    const result: {cell: Cell; merge: Range | undefined}[] = [];
    for (const candidate of candidates.values()) {
      tick();
      const merge = mergeRows(candidate.row).find(range => {tick(); return candidate.column >= range.startColumn && candidate.column <= range.endColumn;});
      if (merge && (merge.startRow !== candidate.row || merge.startColumn !== candidate.column)) continue;
      const style = cellPrintStyle(candidate.style, tick);
      if (style.background || style.borders?.length) result.push({cell: {...candidate, value: {kind: "blank"}}, merge});
    }
    return result;
  };
  return {blankCells, styleAt(row: number, column: number) {
    for (let index = regions.length - 1; index >= 0; index--) {
      tick();
      const {range, style} = regions[index]!;
      if (row >= range.startRow && row <= range.endRow && column >= range.startColumn && column <= range.endColumn) return style;
    }
    return undefined;
  }};
}
