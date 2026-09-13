import { ShapeIdAllocator } from "./shape-id.js";
import type { BinaryInput, Scope } from "./contracts.js";
import { OfficeError } from "./errors.js";
import {
  applyTableStructure,
  validateTableStructureOperation,
  type TableStructureOperation
} from "./table-spans.js";
import { child, loadShared, required } from "./masters.js";
import { nodeFor, selected } from "./shape-operations.js";
import { SelectionError, type SelectionContext, type SelectionRecord } from "./selectors.js";
import {
  applyTableUpdate,
  createTableXml,
  readTable,
  validateTableUpdate,
  type TableUpdate
} from "./tables.js";

export interface TableSelection {
  readonly scope?: Scope;
  readonly slide?: number;
  readonly table?: number;
  readonly cell?: string;
  readonly select?: string;
  readonly all?: boolean;
  readonly allowEmpty?: boolean;
}
export function tableCell(value: string): { row: number; column: number } {
  if (typeof value !== "string") throw new SelectionError("invalid-selection");
  const parts = value.split(",");
  if (
    parts.length !== 2 ||
    parts.some(
      (p) =>
        !p.length ||
        [...p].some((c) => c < "0" || c > "9") ||
        !Number.isSafeInteger(Number(p)) ||
        Number(p) < 1
    )
  )
    throw new SelectionError("invalid-selection");
  return { row: Number(parts[0]) - 1, column: Number(parts[1]) - 1 };
}
export function validateTableSelection(options: TableSelection, action: "read" | "add" | "set") {
  const allowed = [
    "scope",
    "slide",
    "select",
    "cell",
    ...(action === "add" ? [] : ["table"]),
    ...(action === "read" ? [] : ["update"]),
    ...(action === "set" ? ["all", "allowEmpty"] : [])
  ];
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(
      (k) =>
        typeof k !== "string" ||
        !allowed.includes(k) ||
        !("value" in Object.getOwnPropertyDescriptor(options, k)!)
    )
  )
    throw new OfficeError("invalid-value", "Invalid table selection options.", "usage");
  for (const key of ["slide", "table"] as const)
    if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key]! < 1))
      throw new OfficeError(
        "invalid-value",
        "Table selectors require positive integer positions.",
        "usage"
      );
  for (const key of ["all", "allowEmpty"] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean")
      throw new OfficeError("invalid-value", "Table selection controls require booleans.", "usage");
  if (options.scope !== undefined && options.scope !== "slides")
    throw new SelectionError("invalid-selection");
  if (options.cell !== undefined) tableCell(options.cell);
  if (
    options.select !== undefined &&
    (typeof options.select !== "string" ||
      !options.select.length ||
      options.slide !== undefined ||
      options.table !== undefined ||
      options.cell !== undefined ||
      options.all !== undefined)
  )
    throw new SelectionError("invalid-selection");
}
function tableRecords(s: Awaited<ReturnType<typeof loadShared>>, options: TableSelection) {
  const records = selected(s, {
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    ...(options.slide === undefined ? {} : { slide: options.slide }),
    ...(options.select === undefined ? {} : { select: options.select })
  });
  const positions = new Map<string, number>();
  const parts = new Set(records.map((r) => r.part));
  const documents = new Map<string, ReturnType<typeof s.doc>>();
  const all = s.index.objects.filter((r) => {
    if (!parts.has(r.part)) return false;
    let doc = documents.get(r.part);
    if (!doc) {
      doc = s.doc(r.part);
      documents.set(r.part, doc);
    }
    const node = nodeFor(doc.root, r.id);
    const graphic = node.children.find(
      (n) => n.name.localName === "graphic" && n.name.namespace === s.a
    );
    return (
      node.name.localName === "graphicFrame" &&
      !!graphic &&
      !!child(required(graphic, "graphicData"), "tbl")
    );
  });
  const ordinal = new Map<SelectionRecord, number>();
  for (const r of all) {
    const n = (positions.get(r.part) ?? 0) + 1;
    positions.set(r.part, n);
    ordinal.set(r, n);
  }
  return records.filter(
    (r) => ordinal.has(r) && (options.table === undefined || ordinal.get(r) === options.table)
  );
}
function count(records: readonly SelectionRecord[], options: TableSelection) {
  if (!options.select && options.slide === undefined && options.table === undefined && !options.all)
    throw new SelectionError("invalid-selection");
  if (!records.length && !options.allowEmpty) throw new SelectionError("missing-selection");
  if (records.length > 1 && !options.all)
    throw new SelectionError(
      "ambiguous-selection",
      records.map((r) => r.location)
    );
}
export async function readTables(
  input: BinaryInput,
  options: TableSelection,
  context: SelectionContext
) {
  validateTableSelection(options, "read");
  const s = await loadShared(input, context, false);
  return tableRecords(s, options).map((r) => {
    const doc = s.doc(r.part),
      record = readTable(nodeFor(doc.root, r.id), doc);
    if (options.cell !== undefined) {
      const c = tableCell(options.cell);
      if (c.row >= record.rows || c.column >= record.columns)
        throw new SelectionError("missing-selection");
    }
    return { ...record, location: r.location, token: r.token, part: r.part };
  });
}
function selectedUpdate(
  options: TableSelection & { readonly update: TableUpdate },
  creating = false
): TableUpdate {
  if (
    !options.update ||
    typeof options.update !== "object" ||
    Reflect.ownKeys(options.update).some(
      (k) =>
        typeof k !== "string" || !("value" in Object.getOwnPropertyDescriptor(options.update, k)!)
    )
  )
    throw new OfficeError("invalid-value", "Table updates require stored data.", "usage");
  if (
    !creating &&
    !Object.keys(options.update).some((k) => options.update[k as keyof TableUpdate] !== undefined)
  )
    throw new OfficeError("invalid-value", "A table edit is required.", "usage");
  if (options.update.cell !== undefined)
    throw new OfficeError(
      "invalid-value",
      "Use the table cell selector for package edits.",
      "usage"
    );
  const update = {
    ...options.update,
    ...(options.cell === undefined ? {} : { cell: tableCell(options.cell) })
  };
  validateTableUpdate(update, creating);
  return update;
}
export async function addTable(
  input: BinaryInput,
  options: TableSelection & { readonly update: TableUpdate },
  context: SelectionContext
) {
  validateTableSelection(options, "add");
  const update = selectedUpdate(options, true);
  const cells = options.update.rows! * options.update.columns!;
  if (cells > Math.floor(context.xmlLimits.maxNodes / 5))
    throw new OfficeError("resource-limit", "Table grid exceeds XML node budget.", "usage");
  const s = await loadShared(input, context),
    records = selected(s, options, true);
  if (records.length !== 1)
    throw new SelectionError(records.length ? "ambiguous-selection" : "missing-selection");
  const record = records[0]!,
    doc = s.doc(record.part),
    tree = required(required(doc.root, "cSld"), "spTree");
  const id = new ShapeIdAllocator(() => doc).next();
  const ext = child(tree, "extLst");
  s.save(
    record.part,
    doc.spliceChildren(tree, ext ? tree.children.indexOf(ext) : tree.children.length, 0, [
      createTableXml(id, update, s.p)
    ])
  );
  return {
    ...(await s.finish(
      record.part,
      s.index.inventory.slides.filter((x) => x.part === record.part).map((x) => x.position)
    )),
    affected: 1,
    records: [{ ...record, id: String(id) }]
  };
}
export async function mutateTables(
  input: BinaryInput,
  options: TableSelection & { readonly update: TableUpdate },
  context: SelectionContext
) {
  validateTableSelection(options, "set");
  const update = selectedUpdate(options);
  return editTables(input, options, context, update);
}
export async function restructureTables(
  input: BinaryInput,
  options: TableSelection & { readonly operation: TableStructureOperation },
  context: SelectionContext
) {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(
      (key) =>
        typeof key !== "string" || !("value" in Object.getOwnPropertyDescriptor(options, key)!)
    )
  )
    throw new OfficeError("invalid-value", "Structural options require stored data.", "usage");
  const { operation, ...selection } = options;
  validateTableStructureOperation(operation);
  if (Object.hasOwn(selection, "update"))
    throw new OfficeError(
      "invalid-value",
      "Formatting updates cannot be mixed with structural edits.",
      "usage"
    );
  validateTableSelection(selection, "set");
  if (selection.cell !== undefined) {
    const cell = tableCell(selection.cell);
    if (
      operation.kind !== "split" ||
      operation.cell.row !== cell.row ||
      operation.cell.column !== cell.column
    )
      throw new OfficeError("invalid-value", "Cell selector must match the split origin.", "usage");
  }
  return editTables(input, selection, context, undefined, operation);
}
async function editTables(
  input: BinaryInput,
  options: TableSelection,
  context: SelectionContext,
  update?: TableUpdate,
  structure?: TableStructureOperation
) {
  const s = await loadShared(input, context),
    records = tableRecords(s, options);
  count(records, options);
  for (const r of records) {
    const doc = s.doc(r.part);
    s.save(
      r.part,
      structure
        ? applyTableStructure(doc, nodeFor(doc.root, r.id), structure)
        : applyTableUpdate(doc, nodeFor(doc.root, r.id), update!)
    );
  }
  const part = records[0]?.part ?? s.main;
  const affectedSlides = s.index.inventory.slides
    .filter((x) => records.some((r) => r.part === x.part))
    .map((x) => x.position);
  const unchanged = [...s.changes].every(([name, bytes]) => {
    const original = s.reader.get(name);
    return bytes.length === original.length && bytes.every((value, i) => value === original[i]);
  });
  return {
    ...(unchanged
      ? { bytes: s.source, part, affectedSlides }
      : await s.finish(part, affectedSlides)),
    affected: records.length,
    records
  };
}
