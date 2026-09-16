import { archiveSettings, InvalidValueError, type ArchiveContext } from "./archive.js";
import { validateDocxInvocation } from "./command.js";
import { openDocumentLocations, type DocumentLocations } from "./locations.js";
import type { DocumentBudget } from "./budget.js";
import { type Location, SelectionError } from "./location-token.js";
import { pathContains } from "./location-index.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { parseDocumentXml } from "./package-xml.js";
import { sectionAttribute } from "./section-properties.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { tableRows } from "./table-rows.js";
import { MarkupCompatibility, documentCompatibilityProfile, type CompatibilityContent } from "./compatibility.js";
import type { XmlElement } from "./package-xml.js";
import { UnsupportedEditError } from "./xml-write.js";

export interface TableDetails {
  readonly kind: "tables";
  readonly rows: number;
  readonly columns: number;
  readonly cells: readonly { row: number; column: number; rowSpan: number; columnSpan: number; location: Location; text: string }[];
  readonly omitted: readonly { row: number; before: number; after: number }[];
}

export interface TableInspectionData {
  readonly item: { readonly kind: "tables"; readonly location: Location; readonly properties: readonly never[];
    readonly references: readonly never[]; readonly support: "read"; readonly details: TableDetails };
}

export interface TableListData {
  readonly items: readonly TableInspectionData["item"][];
}

/** Lists stored table records within the explicitly selected story/owner scope. */
export async function inspectDocumentTables(input: Uint8Array, options: DocxOperationArguments<"tables.list">, context: ArchiveContext): Promise<TableListData> {
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: "tables.list", inputs: ["document"], options }, settings.budget);
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const owners = new Map<string, Location>();
  for (const selected of resolveDocxSelection(document, invocation)) {
    const owner = tableOwner(document, selected);
    owners.set(owner.token, owner);
  }
  const data: TableListData = { items: [...owners.values()].map(owner => readTable(document, owner, budget)) };
  const size = new TextEncoder().encode(JSON.stringify(data)).length;
  budget.check("serializedOutput", size); budget.charge("retainedBytes", size);
  return data;
}

/** Stored logical coordinates, independent of layout or external field evaluation. */
export async function inspectDocumentTable(input: Uint8Array, options: DocxOperationArguments<"tables.get">, context: ArchiveContext): Promise<TableInspectionData> {
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: "tables.get", inputs: ["document"], options }, settings.budget);
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const selected = resolveDocxSelection(document, invocation)[0]!;
  const data: TableInspectionData = { item: readTable(document, tableOwner(document, selected), budget) };
  const size = new TextEncoder().encode(JSON.stringify(data)).length;
  budget.check("serializedOutput", size); budget.charge("retainedBytes", size);
  return data;
}

function tableOwner(document: DocumentLocations, selected: Location): Location {
  const owner = selected.kind === "table" ? selected : document.list("table", { scope: "all-stories" })
    .filter(table => table.value.part === selected.value.part && table.value.story === selected.value.story && pathContains(table.value.path, selected.value.path))
    .sort((a, b) => b.value.path.length - a.value.path.length)[0];
  if (!owner) throw new SelectionError("missing-selection");
  return owner;
}

function readTable(document: DocumentLocations, owner: Location, budget: DocumentBudget): TableInspectionData["item"] {
  const archive = document.snapshot();
  const root = parseDocumentXml(archive.members.find(part => "/" + part.name === owner.value.part)!.bytes, {}, budget).root; let node = root;
  for (const i of owner.value.path) node = node.children[i]!;
  const active = new Map<XmlElement, XmlElement[]>(); const index = (content: readonly CompatibilityContent[]) => { for (const child of content) if ("source" in child) { active.set(child.source, child.content.filter(child => "source" in child).map(child => child.source)); index(child.content); } }; index(new MarkupCompatibility(root, documentCompatibilityProfile, budget).content);
  const property = (parent: XmlElement | undefined, name: string) => {
    const children = parent ? active.get(parent) ?? [] : [];
    budget.charge("work", children.length);
    const matches = children.filter(child => child.namespace === parent!.namespace && child.localName === name);
    if (matches.length > 1) throw new UnsupportedEditError("Duplicate logical table properties cannot be interpreted.");
    return matches[0];
  };
  const rows = tableRows(node, node => node, node => active.get(node) ?? [], budget);
  const grid = property(node, "tblGrid");
  const columns = (grid ? active.get(grid) ?? [] : []).filter(child => child.namespace === node.namespace && child.localName === "gridCol").length;
  budget.table(rows.length, columns);
  const cells = new Map<string, TableDetails["cells"][number]>();
  const omitted = rows.map((row, i) => {
    const props = property(row, "trPr");
    const before = Number(sectionAttribute(property(props, "gridBefore"), "val") ?? 0);
    const after = Number(sectionAttribute(property(props, "gridAfter"), "val") ?? 0);
    if (![before, after].every(value => Number.isSafeInteger(value) && value >= 0) || before + after > columns)
      throw new InvalidValueError("Invalid omitted table slots.");
    for (let column = before + 1; column <= columns - after; column++) {
      budget.charge("work", 1);
      let number = column, label = "";
      while (number) { number--; label = String.fromCharCode(65 + number % 26) + label; number = Math.floor(number / 26); }
      const location = document.cell(owner.token, label + (i + 1));
      const previous = cells.get(location.token);
      if (previous) {
        previous.rowSpan = Math.max(previous.rowSpan, i + 2 - previous.row);
        previous.columnSpan = Math.max(previous.columnSpan, column + 1 - previous.column);
      } else {
        const text = document.text({ select: location.token }).text;
        cells.set(location.token, { row: i + 1, column, rowSpan: 1, columnSpan: 1, location, text });
      }
    }
    return { row: i + 1, before, after };
  });
  return { kind: "tables", location: owner, properties: [], references: [], support: "read", details: { kind: "tables", rows: rows.length, columns, cells: [...cells.values()], omitted } };
}
