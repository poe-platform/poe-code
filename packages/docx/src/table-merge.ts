import { InvalidValueError } from "./archive.js";
import type { DocumentBudget } from "./budget.js";
import { cellCoordinates } from "./location-index.js";
import { SelectionError } from "./location-token.js";
import { InvalidPackageError, type XmlElement } from "./package-xml.js";
import { runElementOpen } from "./run-properties.js";
import { UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";

function children(node: XmlElement, name: string): XmlElement[] { return node.children.filter(c => c.namespace === node.namespace && c.localName === name); }
function one(node: XmlElement, name: string): XmlElement | undefined {
  const found = children(node, name);
  if (found.length > 1) throw new InvalidPackageError("Duplicate table grid property.");
  return found[0];
}
function attribute(node: XmlElement, name: string): string | undefined { return node.attributes.find(a => a.namespace === node.namespace && a.localName === name)?.value; }
function count(node: XmlElement | undefined, fallback: number): number {
  if (!node) return fallback;
  const value = attribute(node, "val");
  if (!value || [...value].some(c => c < "0" || c > "9") || !Number.isSafeInteger(Number(value))) throw new InvalidPackageError("Invalid table grid count.");
  return Number(value);
}
interface PhysicalCell { node: XmlElement; row: number; column: number; span: number; owner: LogicalCell }
interface LogicalCell { node: XmlElement; row: number; column: number; rowSpan: number; columnSpan: number; physical: PhysicalCell[] }

/** Parse physical continuations separately from their owning rectangular cells. */
export function mergedTableGrid(table: XmlElement, budget: DocumentBudget) {
  const grid = one(table, "tblGrid"), rows = children(table, "tr");
  const columns = grid ? children(grid, "gridCol") : [];
  if (!columns.length || !rows.length) throw new InvalidPackageError("Expected a nonempty table grid.");
  budget.table(rows.length, columns.length);
  const owners: LogicalCell[] = [], physical: PhysicalCell[][] = [], slots: (LogicalCell | undefined)[][] = [];
  let above = new Map<number, LogicalCell>();
  for (const [r, row] of rows.entries()) {
    const props = one(row, "trPr");
    let cursor = count(props && one(props, "gridBefore"), 0);
    const after = count(props && one(props, "gridAfter"), 0), next = new Map<number, LogicalCell>();
    physical.push([]); slots.push([]);
    for (const node of children(row, "tc")) {
      const props = one(node, "tcPr"), span = count(props && one(props, "gridSpan"), 1);
      if (!span || cursor + span > columns.length) throw new InvalidPackageError("Cell exceeds the table grid.");
      if (props && one(props, "hMerge")) throw new UnsupportedEditError("Legacy horizontal merge markers are ambiguous.");
      const merge = props && one(props, "vMerge"), value = merge ? attribute(merge, "val") ?? "continue" : undefined;
      if (value !== undefined && !["continue", "restart"].includes(value)) throw new InvalidPackageError("Invalid vertical merge marker.");
      let owner: LogicalCell;
      if (value === "continue") {
        const prior = above.get(cursor);
        if (!prior || prior.column !== cursor || prior.columnSpan !== span) throw new InvalidPackageError("Vertical continuation does not match its owner.");
        owner = prior; owner.rowSpan++;
      } else { owner = { node, row: r, column: cursor, rowSpan: 1, columnSpan: span, physical: [] }; owners.push(owner); }
      const entry = { node, row: r, column: cursor, span, owner };
      owner.physical.push(entry); physical[r]!.push(entry);
      for (let c = cursor; c < cursor + span; c++) {
        budget.charge("work", 1); budget.charge("retainedBytes", 64);
        slots[r]![c] = owner;
      }
      if (merge) next.set(cursor, owner);
      cursor += span;
    }
    if (cursor + after !== columns.length) throw new InvalidPackageError("Row disagrees with its logical table grid.");
    above = next;
  }
  return { rows, columns, owners, physical, slots };
}

type Grid = ReturnType<typeof mergedTableGrid>;
function closedStructure(table: XmlElement, grid: Grid): void {
  if (table.children.some(n => n.namespace !== table.namespace || !["tblPr", "tblGrid", "tr"].includes(n.localName)) ||
      grid.rows.some(row => row.children.some(n => n.namespace !== table.namespace || !["trPr", "tc"].includes(n.localName))) ||
      grid.slots.some(row => Array.from({ length: grid.columns.length }, (_, i) => row[i]).some(cell => !cell)))
    throw new UnsupportedEditError("Merge edits require rectangular tables without omitted or wrapped cells.");
}
function tag(w: string, name: string, value?: string): string { return `<m:${name} xmlns:m="${w}"${value === undefined ? "" : ` m:val="${value}"`}/>`; }
function fragment(xml: DocumentXmlEditor, node: XmlElement): string { return runElementOpen(node) + xml.sourceXml(node, new Map(), true) + `</${node.name}>`; }
function blocks(xml: DocumentXmlEditor, node: XmlElement): string {
  const props = one(node, "tcPr");
  // Preserve comments, whitespace and processing instructions along with rich blocks.
  const patches = new Map<XmlElement, string>(props ? [[props, ""]] : []);
  for (const child of node.children) if (child !== props) patches.set(child, fragment(xml, child));
  return xml.sourceXml(node, patches, true);
}
function empty(node: XmlElement): boolean {
  return node.children.every(n => n.localName === "tcPr" && n.namespace === node.namespace || n.localName === "p" && n.namespace === node.namespace && n.children.length === 0 && n.attributes.every(a => a.namespace === "http://www.w3.org/2000/xmlns/") && n.content.every(c => c.kind === "text" && !c.text.trim())) && node.content.every(c => c.kind === "element" || c.kind === "text" && !c.text.trim());
}
function cellMarkup(xml: DocumentXmlEditor, node: XmlElement, span: number, merge: "restart" | "continue" | undefined, body: string, width?: number): string {
  const props = one(node, "tcPr");
  const changes = new Map<XmlElement, string>();
  for (const name of ["gridSpan", "vMerge", ...(width === undefined ? [] : ["tcW"])]) {
    const old = props && one(props, name); if (old) changes.set(old, "");
  }
  const additions = (width === undefined ? "" : `<m:tcW xmlns:m="${node.namespace}" m:w="${width}" m:type="dxa"/>`) + (span > 1 ? tag(node.namespace, "gridSpan", String(span)) : "") + (merge ? tag(node.namespace, "vMerge", merge) : "");
  // Span properties precede borders and other cell formatting in schema order.
  const early = ["cnfStyle", "tcW"];
  const next = props?.children.find(n => !early.includes(n.localName) && !changes.has(n));
  if (next) changes.set(next, additions + xml.sourceXml(next));
  const inner = (props ? xml.sourceXml(props, changes, true) : "") + (next ? "" : additions);
  const properties = props ? runElementOpen(props) + inner + `</${props.name}>` : `<m:tcPr xmlns:m="${node.namespace}">${inner}</m:tcPr>`;
  return runElementOpen(node) + properties + body + `</${node.name}>`;
}
function width(grid: Grid, start: number, span: number, row: number): number | undefined {
  const widths = grid.columns.slice(start, start + span).map(n => Number(attribute(n, "w")));
  const total = widths.reduce((a, b) => a + b, 0);
  if (widths.every(n => Number.isSafeInteger(n) && n > 0) && Number.isSafeInteger(total)) return total;
  let sum = 0;
  for (const cell of grid.physical[row]!.filter(p => p.column < start + span && p.column + p.span > start)) {
    const props = one(cell.node, "tcPr"), stored = props && one(props, "tcW");
    if (!stored || attribute(stored, "type") !== "dxa") return undefined;
    const overlap = Math.min(start + span, cell.column + cell.span) - Math.max(start, cell.column);
    const value = Number(attribute(stored, "w")) * overlap / cell.span;
    if (!Number.isSafeInteger(value) || value <= 0) return undefined;
    sum += value;
  }
  return Number.isSafeInteger(sum) && sum > 0 ? sum : undefined;
}

export function editMergedTable(xml: DocumentXmlEditor, table: XmlElement, selected: XmlElement, operation: "tables.merge" | "tables.split" | "tables.rows.remove", options: { from?: string | undefined; to?: string | undefined; rows?: number | undefined; cols?: number | undefined; join?: string | undefined; distribute?: string | undefined; index?: number | undefined }, budget: DocumentBudget): string {
  const grid = mergedTableGrid(table, budget); closedStructure(table, grid);
  const patches = new Map<XmlElement, string>();
  if (operation === "tables.rows.remove") {
    const r = options.index! - 1;
    if (!grid.rows[r]) throw new SelectionError("missing-selection");
    if (grid.rows.length === 1) throw new InvalidValueError("Removal must retain one row.");
    const crossing = grid.owners.filter(o => o.rowSpan > 1 && o.row <= r && o.row + o.rowSpan > r);
    if (crossing.length && options.join !== "paragraphs") throw new InvalidValueError("Deleting through spans requires an explicit paragraphs join.");
    if (crossing.length) {
      // Joining continuations can cross ranges anchored in neighboring retained cells.
      const pending = [table];
      while (pending.length) {
        const node = pending.pop()!;
        budget.charge("work", 1);
        if (node.namespace === table.namespace && ["fldChar", "bookmarkStart", "bookmarkEnd", "commentRangeStart", "commentRangeEnd", "permStart", "permEnd"].includes(node.localName))
          throw new UnsupportedEditError("Deleting through spans cannot move range markers or complex fields.");
        for (const child of node.children) pending.push(child);
      }
    }
    for (const owner of crossing) {
      const retained = owner.physical.filter(p => p.row !== r), first = retained[0]!;
      const content = owner.physical.filter(p => p.node === owner.node || !empty(p.node)).map(p => blocks(xml, p.node)).join("");
      for (const p of retained) patches.set(p.node, cellMarkup(xml, p.node, owner.columnSpan, retained.length > 1 ? p === first ? "restart" : "continue" : undefined, p === first ? content : tag(table.namespace, "p"), width(grid, p.column, p.span, p.row)));
    }
    const rowPatches = new Map<XmlElement, string>();
    for (const row of grid.rows) {
      const local = new Map([...patches].filter(([n]) => row.children.includes(n)));
      if (local.size) rowPatches.set(row, xml.sourceXml(row, local));
    }
    rowPatches.set(grid.rows[r]!, "");
    return xml.sourceXml(table, rowPatches);
  }
  let top: number, left: number, bottom: number, right: number;
  if (operation === "tables.merge") {
    if (selected !== table) throw new InvalidValueError("Merge requires a table anchor and explicit corners.");
    const from = cellCoordinates(options.from!), to = cellCoordinates(options.to!);
    top = from.row - 1; left = from.column - 1; bottom = to.row - 1; right = to.column - 1;
    if (top > bottom || left > right) throw new InvalidValueError("Merge corners must be top-left and bottom-right.");
  } else {
    const owner = grid.owners.find(o => o.node === selected);
    if (!owner) throw new InvalidValueError("Split requires a logical cell anchor.");
    top = owner.row; left = owner.column; bottom = top + owner.rowSpan - 1; right = left + owner.columnSpan - 1;
    if (owner.rowSpan % options.rows! !== 0 || owner.columnSpan % options.cols! !== 0 || owner.rowSpan * owner.columnSpan === 1)
      throw new InvalidValueError("Split dimensions must divide the existing merged grid slots.");
  }
  if (!grid.slots[top]?.[left] || !grid.slots[bottom]?.[right]) throw new SelectionError("missing-selection");
  const owners = grid.owners.filter(o => o.row <= bottom && o.row + o.rowSpan > top && o.column <= right && o.column + o.columnSpan > left);
  if (owners.some(o => o.row < top || o.column < left || o.row + o.rowSpan - 1 > bottom || o.column + o.columnSpan - 1 > right))
    throw new SelectionError("ambiguous-selection");
  const physical = grid.physical.flat().filter(p => owners.includes(p.owner));
  if (operation === "tables.merge") {
    if (options.join === "reject" && physical.some(p => !empty(p.node))) throw new InvalidValueError("Merge content requires paragraphs join.");
    const body = physical.filter(p => !empty(p.node)).map(p => blocks(xml, p.node)).join("") || tag(table.namespace, "p");
    for (let r = top; r <= bottom; r++) {
      const local = physical.filter(p => p.row === r);
      for (const [i, p] of local.entries()) patches.set(p.node, i ? "" : cellMarkup(xml, p.node, right - left + 1, bottom > top ? r === top ? "restart" : "continue" : undefined, r === top ? body : tag(table.namespace, "p"), width(grid, left, right - left + 1, r)));
    }
  } else {
    const body = physical.filter(p => p.node === selected || !empty(p.node)).map(p => blocks(xml, p.node)).join("");
    let distribution: string[] | undefined;
    if (options.distribute === "paragraphs") {
      const content = physical.filter(p => p.node === selected || !empty(p.node));
      if (content.some(p => p.node.children.some(n => n.localName !== "tcPr" && (n.namespace !== table.namespace || n.localName !== "p")) || p.node.content.some(c => c.kind !== "element" && (c.kind !== "text" || c.text.trim())))) throw new UnsupportedEditError("Paragraph distribution requires only paragraph blocks.");
      distribution = content.flatMap(p => children(p.node, "p").map(n => fragment(xml, n)));
      if (distribution.length !== options.rows! * options.cols!) throw new InvalidValueError("Paragraph distribution requires one paragraph per resulting cell.");
    }
    for (const p of physical) {
      let markup = "";
      const rowStep = (bottom - top + 1) / options.rows!, columnStep = (right - left + 1) / options.cols!;
      const first = (p.row - top) % rowStep === 0;
      for (let c = left; c <= right; c += columnStep) {
        const i = Math.floor((p.row - top) / rowStep) * options.cols! + (c - left) / columnStep;
        const content = first ? distribution ? distribution[i]! : i === 0 ? body : tag(table.namespace, "p") : tag(table.namespace, "p");
        markup += cellMarkup(xml, p.node, columnStep, rowStep > 1 ? first ? "restart" : "continue" : undefined, content, width(grid, c, columnStep, p.row));
      }
      patches.set(p.node, markup);
    }
  }
  const rowPatches = new Map<XmlElement, string>();
  for (const row of grid.rows) {
    const local = new Map([...patches].filter(([n]) => row.children.includes(n)));
    if (local.size) rowPatches.set(row, xml.sourceXml(row, local));
  }
  return xml.sourceXml(table, rowPatches);
}
