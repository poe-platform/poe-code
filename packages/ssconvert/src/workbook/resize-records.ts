import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { parseA1, type ImportedValue, type Sheet, type SheetSize, type UnsupportedRecord } from "../workbook.js";

type Node = { readonly [key: string]: ImportedValue };
function object(value: ImportedValue | undefined): Node | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Node : undefined;
}
function attr(node: Node, name: string): string | undefined {
  if (!Array.isArray(node.attributes)) return undefined;
  for (const value of node.attributes) {
    const a = object(value);
    if (a?.namespace === "" && a.name === name && typeof a.value === "string") return a.value;
  }
  return undefined;
}
function attributes(node: Node, values: Readonly<Record<string, string>>): Node {
  return { ...node, attributes: Array.isArray(node.attributes) ? node.attributes.map(value => {
    const a = object(value);
    return a?.namespace === "" && typeof a.name === "string" && values[a.name] !== undefined ? { ...a, value: values[a.name]! } : value;
  }) : [] };
}

/** Retained XML remains namespace-aware; sparse rectangles never enumerate sheet dimensions. */
export function resizeRetainedRecords(sheet: Sheet, old: SheetSize, size: SheetSize, context: CapabilityContext): readonly UnsupportedRecord[] {
  let work = 0;
  const maximum = context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32;
  const tick = () => {
    context.signal.throwIfAborted();
    if (++work > maximum) throw new SsconvertError("resource-limit", "ssconvert workbook work limit exceeded");
  };
  const retained = (sheet.unsupportedRecords ?? []).flatMap(record => {
    tick();
    const data = object(record.data);
    if (record.disposition !== "retained" || !data) return [record];
    if (record.kind === "FormatRange" || record.kind === "StyleRange") {
      if (Number(data.startRow) >= size.rows || Number(data.startColumn) >= size.columns) return [];
      return [{ ...record, data: { ...data, endRow: Math.min(Number(data.endRow), size.rows - 1), endColumn: Math.min(Number(data.endColumn), size.columns - 1) } }];
    }
    if (record.source !== "Gnumeric_XmlIO:sax" || !Array.isArray(data.children)) return [record];
    if (record.kind === "Selections") {
      const selections = data.children.flatMap(value => {
        tick();
        const node = object(value);
        if (!node || node.name !== "Selection" || node.namespace !== data.namespace) return [];
        const r0 = Number(attr(node, "startRow")), r1 = Number(attr(node, "endRow")), c0 = Number(attr(node, "startCol")), c1 = Number(attr(node, "endCol"));
        if (![r0, r1, c0, c1].every(Number.isSafeInteger)) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: resize selection bounds");
        if (r0 >= size.rows || c0 >= size.columns) return [];
        return [attributes(node, { endRow: String(Math.min(r1, size.rows - 1)), endCol: String(Math.min(c1, size.columns - 1)) })];
      });
      if (selections.length === 0) selections.push({ name: "Selection", namespace: data.namespace ?? "", text: "", children: [],
        attributes: ["startCol", "startRow", "endCol", "endRow"].map(name => ({ name, namespace: "", value: "0" })) });
      const cursor = selections[selections.length - 1]!;
      return [{ ...record, data: { ...attributes(data, { CursorCol: attr(cursor, "startCol")!, CursorRow: attr(cursor, "startRow")! }), children: selections } }];
    }
    if (record.kind === "Objects") return [{ ...record, data: { ...data, children: data.children.filter(value => {
      tick();
      const node = object(value); const bound = node && attr(node, "ObjectBound");
      if (!bound) return true;
      const a = parseA1(bound.split(":")[0]!);
      // Object deletion is based on the starting anchor; crossing anchors remain unchanged.
      return a.row < size.rows && a.column < size.columns;
    }) } }];
    if (record.kind !== "Styles") return [record];
    const rectangles = data.children.flatMap(value => {
      tick();
      const node = object(value);
      if (!node || node.name !== "StyleRegion" || node.namespace !== data.namespace) return [];
      const r0 = Number(attr(node, "startRow")), r1 = Number(attr(node, "endRow")), c0 = Number(attr(node, "startCol")), c1 = Number(attr(node, "endCol"));
      if (![r0, r1, c0, c1].every(Number.isSafeInteger)) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: resize style bounds");
      return [{ node, r0, r1, c0, c1 }];
    });
    const children: ImportedValue[] = rectangles.filter(r => r.r0 < size.rows && r.c0 < size.columns).map(r =>
      attributes(r.node, { endRow: String(Math.min(r.r1, size.rows - 1)), endCol: String(Math.min(r.c1, size.columns - 1)) }));
    return [{ ...record, data: { ...data, children } }];
  });
  if (size.rows <= old.rows && size.columns <= old.columns) return retained;
  const rectangles: { r0: number; r1: number; c0: number; c1: number; style: Node }[] = [];
  for (const record of sheet.unsupportedRecords ?? []) {
    tick();
    const data = object(record.data);
    if (record.source !== "Gnumeric_XmlIO:sax" || record.kind !== "Styles" || record.disposition !== "retained" || !Array.isArray(data?.children)) continue;
    for (const value of data.children) {
      tick();
      const region = object(value);
      if (!region || region.name !== "StyleRegion" || region.namespace !== data.namespace || !Array.isArray(region.children)) continue;
      const xmlStyle = region.children.find(child => object(child)?.name === "Style" && object(child)?.namespace === data.namespace);
      const style = object(xmlStyle); if (!style) continue;
      const format = attr(style, "Format");
      rectangles.push({ r0: Number(attr(region, "startRow")), r1: Number(attr(region, "endRow")),
        c0: Number(attr(region, "startCol")), c1: Number(attr(region, "endCol")),
        style: { style: { gnumeric: style }, ...(format !== undefined ? { format } : {}) } });
    }
  }
  for (const record of sheet.unsupportedRecords ?? []) {
    tick();
    const data = object(record.data);
    if (record.disposition !== "retained" || !data || record.kind !== "FormatRange" && record.kind !== "StyleRange") continue;
    const style: Node = { ...(typeof data.format === "string" ? { format: data.format } : {}),
      ...(data.style ? { style: data.style } : {}), ...(data.reset === true ? { reset: true } : {}) };
    rectangles.push({ r0: Number(data.startRow), r1: Number(data.endRow), c0: Number(data.startColumn), c1: Number(data.endColumn), style });
  }
  for (const cell of sheet.cells) {
    tick();
    if (!cell.format && !cell.style) continue;
    rectangles.push({ r0: cell.row, r1: cell.row, c0: cell.column, c1: cell.column,
      style: { ...(cell.format ? { format: cell.format } : {}), ...(cell.style ? { style: cell.style } : {}) } });
  }
  if (rectangles.length === 0) return retained;
  // Choose styles from the original grid, partitioning at stored edges rather than allocating dimensions.
  const expand = (rows: boolean) => {
    const end = Math.min(rows ? old.columns : old.rows, rows ? size.columns : size.rows);
    const length = rows ? old.rows : old.columns;
    const edges = [...new Set([0, end, ...rectangles.flatMap(r => rows ? [r.c0, r.c1 + 1] : [r.r0, r.r1 + 1])])]
      .filter(v => v >= 0 && v <= end).sort((a, b) => a - b);
    const across = [...new Set([0, length, ...rectangles.flatMap(r => rows ? [r.r0, r.r1 + 1] : [r.c0, r.c1 + 1])])]
      .filter(v => v >= 0 && v <= length).sort((a, b) => a - b);
    for (let i = 0; i + 1 < edges.length; i++) {
      const counts = new Map<string, { style: Node; weight: number }>();
      for (let j = 0; j + 1 < across.length; j++) {
        let style: Node = {};
        for (const r of rectangles) {
          tick();
          const row = rows ? across[j]! : edges[i]!, column = rows ? edges[i]! : across[j]!;
          if (row >= r.r0 && row <= r.r1 && column >= r.c0 && column <= r.c1)
            style = r.style.reset === true ? r.style : { ...style, ...r.style,
              ...(r.style.style ? { style: { ...object(style.style), ...object(r.style.style) } } : {}) };
        }
        const key = JSON.stringify(style);
        const count = counts.get(key) ?? { style, weight: 0 };
        count.weight += across[j + 1]! - across[j]!; counts.set(key, count);
      }
      let best: { style: Node; weight: number } | undefined;
      for (const count of counts.values()) if (!best || count.weight > best.weight) best = count;
      if (!best || Object.keys(best.style).length === 0) continue;
      const bounds = rows ? { startRow: old.rows, endRow: size.rows - 1, startColumn: edges[i]!, endColumn: edges[i + 1]! - 1 }
        : { startRow: edges[i]!, endRow: edges[i + 1]! - 1, startColumn: old.columns, endColumn: size.columns - 1 };
      retained.push({ source: "ssconvert-resize", kind: "StyleRange", disposition: "retained", data: { ...bounds, ...best.style } });
      if (rows && size.columns > old.columns && edges[i + 1] === old.columns)
        retained.push({ source: "ssconvert-resize", kind: "StyleRange", disposition: "retained", data: {
          startRow: old.rows, endRow: size.rows - 1, startColumn: old.columns, endColumn: size.columns - 1, ...best.style } });
    }
  };
  if (size.columns > old.columns) expand(false);
  if (size.rows > old.rows) expand(true);
  return retained;
}
