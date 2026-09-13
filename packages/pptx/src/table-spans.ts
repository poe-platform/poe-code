import { OfficeError } from "./errors.js";
import { attr, required } from "./masters.js";
import { nodeFor } from "./shape-operations.js";
import { applyTableUpdate, readTable } from "./tables.js";
import { parseXmlPart, type XmlElement, type XmlPart } from "./xml.js";
export interface TableCoordinate {
  readonly row: number;
  readonly column: number;
}
export type TableStructureOperation =
  | { readonly kind: "merge"; readonly from: TableCoordinate; readonly to: TableCoordinate }
  | { readonly kind: "split"; readonly cell: TableCoordinate }
  | {
      readonly kind: "rows-add" | "columns-add";
      readonly position: number;
      readonly spanPolicy: "expand" | "reject";
    }
  | {
      readonly kind: "rows-remove" | "columns-remove";
      readonly position: number;
      readonly spanPolicy: "shrink" | "reject";
    };
interface Region {
  row: number;
  column: number;
  width: number;
  height: number;
}
const limits = { maxBytes: 64000000, maxNodes: 4000000, maxDepth: 64 };
function invalid(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
function conflict(message: string): never {
  throw new OfficeError("unsupported-edit", message, "validate-intent");
}
function elements(node: XmlElement, name: string): XmlElement[] {
  return node.children.filter(
    (n) => n.name.namespace === node.name.namespace && n.name.localName === name
  );
}
function table(frame: XmlElement): XmlElement {
  const graphic = frame.children.find((n) => n.name.localName === "graphic")!;
  return required(required(graphic, "graphicData"), "tbl");
}
function fragment(doc: XmlPart, element: XmlElement): XmlPart {
  return parseXmlPart(new TextEncoder().encode(doc.markup(element, true)), {
    ...limits,
    maxDepth: Math.max(limits.maxDepth, doc.nodeCount)
  });
}
function flag(cell: XmlElement, name: string): boolean {
  const value = attr(cell, name);
  if (value !== undefined && !["1", "0", "true", "false"].includes(value))
    conflict("Invalid table merge flag.");
  return value === "1" || value === "true";
}
function span(cell: XmlElement, name: string): number {
  const value = attr(cell, name) ?? "1";
  if (!value || [...value].some((c) => !"0123456789".includes(c))) conflict("Invalid table span.");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) conflict("Invalid table span.");
  return n;
}
function regions(grid: readonly (readonly XmlPart[])[]): Region[] {
  const height = grid.length,
    width = grid[0]!.length,
    owners = new Set<number>(),
    result: Region[] = [];
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) {
      const cell = grid[row]![column]!.root;
      if (owners.has(row * width + column)) continue;
      if (flag(cell, "hMerge") || flag(cell, "vMerge"))
        conflict("Table has an orphan continuation cell.");
      const region = { row, column, width: span(cell, "gridSpan"), height: span(cell, "rowSpan") };
      if (column + region.width > width || row + region.height > height)
        conflict("Table span extends outside its rectangular grid.");
      for (let r = row; r < row + region.height; r++)
        for (let c = column; c < column + region.width; c++) {
          const current = grid[r]![c]!.root,
            key = r * width + c;
          if (
            owners.has(key) ||
            flag(current, "hMerge") !== c > column ||
            flag(current, "vMerge") !== r > row ||
            span(current, "gridSpan") !== (c === column ? region.width : 1) ||
            span(current, "rowSpan") !== (r === row ? region.height : 1)
          )
            conflict("Table spans do not form disjoint rectangles.");
          owners.add(key);
        }
      if (region.width > 1 || region.height > 1) result.push(region);
    }
  return result;
}
function point(value: TableCoordinate, rows: number, columns: number): void {
  data(value, ["row", "column"]);
  if (
    ![value.row, value.column].every(Number.isSafeInteger) ||
    value.row < 0 ||
    value.column < 0 ||
    value.row >= rows ||
    value.column >= columns
  )
    invalid("Cell is outside the table grid.");
}
function data(value: unknown, keys: readonly string[]): void {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (k) =>
        typeof k !== "string" ||
        !keys.includes(k) ||
        !("value" in Object.getOwnPropertyDescriptor(value, k)!)
    )
  )
    invalid("Structural options require stored supported data.");
}
function replaceBody(cell: XmlPart, body: XmlPart): XmlPart {
  const old = required(cell.root, "txBody");
  return cell.spliceChildren(cell.root, cell.root.children.indexOf(old), 1, [
    body.markup(body.root, true)
  ]);
}
function empty(cell: XmlPart): XmlPart {
  let body = fragment(cell, required(cell.root, "txBody"));
  const paragraphs = elements(body.root, "p");
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const current = elements(body.root, "p")[i]!;
    body = body.spliceChildren(body.root, body.root.children.indexOf(current), 1, []);
  }
  const ns = body.root.name.namespace;
  body = body.spliceChildren(
    body.root,
    body.root.children.findIndex((n) => n.name.localName === "extLst") < 0
      ? body.root.children.length
      : body.root.children.findIndex((n) => n.name.localName === "extLst"),
    0,
    [`<a:p xmlns:a="${ns}"/>`]
  );
  return replaceBody(cell, body);
}
export function validateTableStructureOperation(operation: TableStructureOperation): void {
  data(operation, ["kind", "from", "to", "cell", "position", "spanPolicy"]);
  const keys =
    operation.kind === "merge"
      ? ["kind", "from", "to"]
      : operation.kind === "split"
        ? ["kind", "cell"]
        : ["kind", "position", "spanPolicy"];
  data(operation, keys);
  if (
    !["merge", "split", "rows-add", "rows-remove", "columns-add", "columns-remove"].includes(
      operation.kind
    )
  )
    invalid("Unknown table structural operation.");
  if (operation.kind === "merge") {
    point(operation.from, 250000, 250000);
    point(operation.to, 250000, 250000);
    if (operation.from.row > operation.to.row || operation.from.column > operation.to.column)
      invalid("Merge endpoints require an ordered rectangle.");
  } else if (operation.kind === "split") point(operation.cell, 250000, 250000);
  else {
    if (
      !Number.isSafeInteger(operation.position) ||
      operation.position < 0 ||
      operation.position > 250000
    )
      invalid("Structural position is outside the grid.");
    if (
      !(operation.kind.endsWith("add") ? ["expand", "reject"] : ["shrink", "reject"]).includes(
        operation.spanPolicy
      )
    )
      invalid("An explicit valid span policy is required.");
  }
}
export function applyTableStructure(
  document: XmlPart,
  node: XmlElement,
  operation: TableStructureOperation
): XmlPart {
  validateTableStructureOperation(operation);
  applyTableUpdate(document, node, {});
  const before = readTable(node, document),
    tbl = table(node),
    ns = tbl.name.namespace;
  const rows = elements(tbl, "tr").map((row) => fragment(document, row));
  const grid = rows.map((row) => elements(row.root, "tc").map((cell) => fragment(row, cell)));
  const widths = [...before.columnWidths],
    heights = [...before.rowHeights];
  let merges = regions(grid);
  if (before.cells.some((c) => c.isSpanned && c.text !== ""))
    conflict("Continuation cells must not own text.");
  if (operation.kind === "merge") {
    point(operation.from, grid.length, widths.length);
    point(operation.to, grid.length, widths.length);
    const { row, column } = operation.from,
      width = operation.to.column - column + 1,
      height = operation.to.row - row + 1;
    if (width < 1 || height < 1) invalid("Merge endpoints require an ordered rectangle.");
    const endRow = row + height,
      endColumn = column + width;
    for (const old of merges) {
      const intersects =
        old.row < endRow &&
        old.row + old.height > row &&
        old.column < endColumn &&
        old.column + old.width > column;
      if (
        intersects &&
        !(
          old.row >= row &&
          old.column >= column &&
          old.row + old.height <= endRow &&
          old.column + old.width <= endColumn
        )
      )
        conflict("Merge range partially intersects an existing span.");
    }
    if (
      (width === 1 && height === 1) ||
      merges.some(
        (old) =>
          old.row === row && old.column === column && old.width === width && old.height === height
      )
    )
      return document;
    const paragraphs: string[] = [];
    for (let r = row; r < endRow; r++)
      for (let c = column; c < endColumn; c++) {
        const record = before.cells[r * widths.length + c]!;
        if (!record.isSpanned) {
          const cell = grid[r]![c]!,
            body = required(cell.root, "txBody"),
            ps = elements(body, "p");
          if (
            record.text !== "" ||
            ps.length > 1 ||
            ps.some((p) => p.attributes.length > 0 || p.children.length > 0)
          )
            paragraphs.push(...ps.map((p) => cell.markup(p, true)));
        }
        grid[r]![c] = empty(grid[r]![c]!);
      }
    if (paragraphs.length) {
      const origin = grid[row]![column]!;
      let body = fragment(origin, required(origin.root, "txBody"));
      const p = required(body.root, "p");
      body = body.spliceChildren(body.root, body.root.children.indexOf(p), 1, paragraphs);
      grid[row]![column] = replaceBody(origin, body);
    }
    merges = merges.filter(
      (old) =>
        !(
          old.row >= row &&
          old.column >= column &&
          old.row + old.height <= endRow &&
          old.column + old.width <= endColumn
        )
    );
    if (width > 1 || height > 1) merges.push({ row, column, width, height });
  } else if (operation.kind === "split") {
    point(operation.cell, grid.length, widths.length);
    const selected = merges.find(
      (r) => r.row === operation.cell.row && r.column === operation.cell.column
    );
    if (!selected) conflict("Split requires one merge origin.");
    merges = merges.filter((r) => r !== selected);
  } else {
    const rowAxis = operation.kind.startsWith("rows"),
      add = operation.kind.endsWith("add"),
      size = rowAxis ? heights.length : widths.length,
      index = operation.position;
    if (!Number.isSafeInteger(index) || index < 0 || index > size - (add ? 0 : 1))
      invalid("Structural position is outside the grid.");
    if (!(add ? ["expand", "reject"] : ["shrink", "reject"]).includes(operation.spanPolicy))
      invalid("An explicit valid span policy is required.");
    if (!add && size === 1) conflict("A table must retain at least one row and column.");
    if (
      add &&
      (rowAxis ? (heights.length + 1) * widths.length : heights.length * (widths.length + 1)) >
        250000
    )
      invalid("Table cell budget exceeded.");
    const next: Region[] = [];
    for (const original of merges) {
      const region = { ...original },
        start = rowAxis ? region.row : region.column,
        length = rowAxis ? region.height : region.width;
      const intersects = add
        ? index > start && index < start + length
        : index >= start && index < start + length;
      if (intersects && operation.spanPolicy === "reject")
        conflict("Structural operation intersects a merged span.");
      if (intersects && !add && index === start && length > 1) {
        const r = region.row + (rowAxis ? 1 : 0),
          c = region.column + (rowAxis ? 0 : 1),
          owner = grid[region.row]![region.column]!;
        grid[r]![c] = replaceBody(grid[r]![c]!, fragment(owner, required(owner.root, "txBody")));
      }
      const coordinate = rowAxis ? "row" : "column",
        extent = rowAxis ? "height" : "width";
      if (add) {
        if (index <= start) region[coordinate]++;
        else if (intersects) region[extent]++;
      } else {
        if (index < start) region[coordinate]--;
        else if (intersects) region[extent]--;
      }
      if (region.width > 0 && region.height > 0 && (region.width > 1 || region.height > 1))
        next.push(region);
    }
    merges = next;
    if (rowAxis) {
      if (add) {
        const adjacent = Math.min(index, size - 1);
        rows.splice(index, 0, rows[adjacent]!);
        grid.splice(index, 0, grid[adjacent]!.map(empty));
        heights.splice(index, 0, heights[adjacent]!);
      } else {
        rows.splice(index, 1);
        grid.splice(index, 1);
        heights.splice(index, 1);
      }
    } else {
      if (add) {
        const adjacent = Math.min(index, size - 1);
        for (const row of grid) row.splice(index, 0, empty(row[adjacent]!));
        widths.splice(index, 0, widths[adjacent]!);
      } else {
        for (const row of grid) row.splice(index, 1);
        widths.splice(index, 1);
      }
    }
  }
  const ownership = new Map<number, Region>();
  for (const region of merges)
    for (let r = region.row; r < region.row + region.height; r++)
      for (let c = region.column; c < region.column + region.width; c++)
        ownership.set(r * widths.length + c, region);
  for (let r = 0; r < grid.length; r++)
    for (let c = 0; c < widths.length; c++) {
      const region = ownership.get(r * widths.length + c),
        cell = grid[r]![c]!;
      const values = {
        gridSpan: region && c === region.column && region.width > 1 ? String(region.width) : null,
        rowSpan: region && r === region.row && region.height > 1 ? String(region.height) : null,
        hMerge: region && c > region.column ? "1" : null,
        vMerge: region && r > region.row ? "1" : null
      };
      grid[r]![c] = cell.merge(cell.root, {
        attributes: Object.entries(values).map(([localName, value]) => ({
          namespace: "",
          localName,
          value
        }))
      });
    }
  let result = document;
  const frame = () => nodeFor(result.root, String(before.shapeId)),
    current = () => table(frame());
  for (let r = 0; r < rows.length; r++) {
    let row = rows[r]!,
      old = elements(row.root, "tc");
    for (let c = old.length - 1; c >= 0; c--) {
      old = elements(row.root, "tc");
      row = row.spliceChildren(row.root, row.root.children.indexOf(old[c]!), 1, []);
    }
    row = row.merge(row.root, {
      attributes: [{ namespace: "", localName: "h", value: String(heights[r]) }]
    });
    row = row.spliceChildren(
      row.root,
      0,
      0,
      grid[r]!.map((cell) => cell.markup(cell.root, true))
    );
    rows[r] = row;
  }
  const oldRows = elements(current(), "tr");
  for (let r = oldRows.length - 1; r >= 0; r--) {
    const target = current(),
      row = elements(target, "tr")[r]!;
    result = result.spliceChildren(target, target.children.indexOf(row), 1, []);
  }
  const target = current(),
    gridNode = required(target, "tblGrid");
  result = result.spliceChildren(
    target,
    target.children.indexOf(gridNode) + 1,
    0,
    rows.map((row) => row.markup(row.root, true))
  );
  const oldGrid = required(current(), "tblGrid");
  let columnGrid = fragment(result, oldGrid),
    columns = elements(columnGrid.root, "gridCol");
  const templates = columns.map((c) => fragment(columnGrid, c));
  for (let c = columns.length - 1; c >= 0; c--) {
    columns = elements(columnGrid.root, "gridCol");
    columnGrid = columnGrid.spliceChildren(
      columnGrid.root,
      columnGrid.root.children.indexOf(columns[c]!),
      1,
      []
    );
  }
  if (operation.kind === "columns-add")
    templates.splice(
      operation.position,
      0,
      templates[Math.min(operation.position, templates.length - 1)]!
    );
  if (operation.kind === "columns-remove") templates.splice(operation.position, 1);
  columnGrid = columnGrid.spliceChildren(
    columnGrid.root,
    0,
    0,
    widths.map((width, c) => {
      const col = templates[c]!,
        edited = col.merge(col.root, {
          attributes: [{ namespace: "", localName: "w", value: String(width) }]
        });
      return edited.markup(edited.root, true);
    })
  );
  result = result.spliceChildren(
    current(),
    current().children.indexOf(required(current(), "tblGrid")),
    1,
    [columnGrid.markup(columnGrid.root, true)]
  );
  const totals = [widths, heights].map((values) => values.reduce((a, b) => a + b, 0));
  if (totals.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 27273042316900))
    invalid("Table dimension total exceeds coordinate bounds.");
  result = result.merge(required(frame(), "xfrm"), {
    children: {
      sequence: [
        { namespace: ns, localName: "off" },
        { namespace: ns, localName: "ext" }
      ],
      upsert: [
        {
          name: { namespace: ns, localName: "ext" },
          merge: {
            attributes: totals.map((n, i) => ({
              namespace: "",
              localName: i === 0 ? "cx" : "cy",
              value: String(n)
            }))
          }
        }
      ]
    }
  });
  return result;
}
