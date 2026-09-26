import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { CellRange, ImportedValue, Range, Sheet } from "../workbook.js";

function object(value: ImportedValue | undefined): Readonly<Record<string, ImportedValue>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, ImportedValue>> : undefined;
}

/** A copied region has resolved styles, rather than the source's layered patches. */
export function clipboardStyles(sheet: Sheet, selection: CellRange, defaults: ImportedValue,
  cellStyle: (style: Readonly<Record<string, ImportedValue>> | undefined, format: string | undefined) => ImportedValue,
  context: CapabilityContext): readonly { range: Range; style: ImportedValue }[] {
  let work = 0;
  const check = () => {
    context.signal.throwIfAborted();
    if (++work > (context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32))
      throw new SsconvertError("resource-limit", "ssconvert clipboard style work limit exceeded");
  };
  const merge = (base: ImportedValue, patch: ImportedValue): ImportedValue => {
    check();
    const a = object(base), b = object(patch);
    if (!a || !b) return patch;
    const attrs = new Map<string, ImportedValue>();
    for (const source of [a, b]) for (const raw of Array.isArray(source.attributes) ? source.attributes : []) {
      const attribute = object(raw);
      if (attribute) attrs.set(`${String(attribute.namespace)}:${String(attribute.name)}`, raw);
    }
    const children = [...(Array.isArray(a.children) ? a.children : [])];
    for (const child of Array.isArray(b.children) ? b.children : []) {
      const node = object(child), index = children.findIndex(raw => {
        const old = object(raw); return old?.name === node?.name && old?.namespace === node?.namespace;
      });
      if (index < 0) children.push(child); else children[index] = merge(children[index]!, child);
    }
    return { ...a, ...b, text: children.length ? "" : b.text || a.text || "", attributes: [...attrs.values()], children };
  };
  let regions: { range: Range; style: ImportedValue }[] = [{ range: selection, style: merge(defaults, {}) }];
  const apply = (range: Range, style: ImportedValue) => {
    const next: typeof regions = [];
    for (const region of regions) {
      check();
      const a = region.range;
      const r = { startRow: Math.max(a.startRow, range.startRow), endRow: Math.min(a.endRow, range.endRow),
        startColumn: Math.max(a.startColumn, range.startColumn), endColumn: Math.min(a.endColumn, range.endColumn) };
      if (r.startRow > r.endRow || r.startColumn > r.endColumn) { next.push(region); continue; }
      if (a.startRow < r.startRow) next.push({ range: { ...a, endRow: r.startRow - 1 }, style: region.style });
      if (a.endRow > r.endRow) next.push({ range: { ...a, startRow: r.endRow + 1 }, style: region.style });
      if (a.startColumn < r.startColumn) next.push({ range: { ...r, startColumn: a.startColumn, endColumn: r.startColumn - 1 }, style: region.style });
      if (a.endColumn > r.endColumn) next.push({ range: { ...r, startColumn: r.endColumn + 1, endColumn: a.endColumn }, style: region.style });
      next.push({ range: r, style: merge(region.style, style) });
    }
    regions = next;
  };
  for (const entry of sheet.unsupportedRecords ?? []) {
    check();
    if (entry.disposition !== "retained") continue;
    const data = object(entry.data);
    if (entry.kind === "Styles") for (const raw of Array.isArray(data?.children) ? data.children : []) {
      check();
      const region = object(raw);
      const bounds: Record<string, number> = {};
      for (const rawAttribute of Array.isArray(region?.attributes) ? region.attributes : []) {
        const attr = object(rawAttribute); if (typeof attr?.name === "string") bounds[attr.name] = Number(attr.value);
      }
      if (![bounds.startRow, bounds.endRow, bounds.startCol, bounds.endCol].every(v => Number.isSafeInteger(v) && v! >= 0)) continue;
      const style = (Array.isArray(region?.children) ? region.children : []).find(raw => object(raw)?.name === "Style");
      if (style) apply({ startRow: bounds.startRow!, endRow: bounds.endRow!, startColumn: bounds.startCol!, endColumn: bounds.endCol! }, style);
    }
    else if ((entry.kind === "StyleRange" || entry.kind === "FormatRange") && data) {
      const bounds = [data.startRow, data.endRow, data.startColumn, data.endColumn];
      if (bounds.every(v => typeof v === "number" && Number.isSafeInteger(v) && v >= 0))
        apply({ startRow: Number(data.startRow), endRow: Number(data.endRow), startColumn: Number(data.startColumn), endColumn: Number(data.endColumn) },
          cellStyle(object(data.style), typeof data.format === "string" ? data.format : undefined));
    }
  }
  for (const cell of sheet.cells) {
    check();
    if (cell.style || cell.format !== undefined) apply({ startRow: cell.row, endRow: cell.row, startColumn: cell.column, endColumn: cell.column }, cellStyle(cell.style, cell.format));
  }
  // Remove splits caused by patches that leave their resolved style unchanged.
  let changed = true;
  const identity = (style: ImportedValue) => JSON.stringify(style, (_name, value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
  while (changed) {
    changed = false;
    for (let i = 0; i < regions.length && !changed; i++) for (let j = i + 1; j < regions.length; j++) {
      check();
      const a = regions[i]!, b = regions[j]!;
      if (identity(a.style) !== identity(b.style)) continue;
      const x = a.range, y = b.range;
      if (x.startColumn === y.startColumn && x.endColumn === y.endColumn && (x.endRow + 1 === y.startRow || y.endRow + 1 === x.startRow) ||
        x.startRow === y.startRow && x.endRow === y.endRow && (x.endColumn + 1 === y.startColumn || y.endColumn + 1 === x.startColumn)) {
        regions[i] = { style: a.style, range: { startRow: Math.min(x.startRow, y.startRow), endRow: Math.max(x.endRow, y.endRow),
          startColumn: Math.min(x.startColumn, y.startColumn), endColumn: Math.max(x.endColumn, y.endColumn) } };
        regions.splice(j, 1); changed = true; break;
      }
    }
  }
  return regions.sort((a, b) => a.range.startColumn - b.range.startColumn || a.range.startRow - b.range.startRow);
}
