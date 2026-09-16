import { archiveSettings, InvalidValueError } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { validateDocxInvocation } from "./command.js";
import { twips, xmlValue } from "./create-content.js";
import { dialectForNamespace, documentDialects } from "./dialect.js";
import { addressKey, LocationIndex } from "./location-index.js";
import { closedRecord, encodeLocation, SelectionError, type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { DocumentPackage } from "./package.js";
import { DocumentArchiveEditor } from "./package-write.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { replaceParagraphContent } from "./paragraph-content.js";
import { editDocumentParagraphs } from "./paragraph-edit.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { runElementOpen } from "./run-properties.js";
import { tableContainerWidth } from "./table-insertion.js";
import { editMergedTable, mergedTableGrid } from "./table-merge.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";

export type TableEditOperation = "tables.add" | "tables.set" | "tables.rows.add" | "tables.rows.remove" | "tables.columns.add" | "tables.columns.remove" | "tables.merge" | "tables.split";
export type TableEditRequest = { [K in TableEditOperation]: { readonly operation: K; readonly options: DocxOperationArguments<K>; readonly input?: PublicationInput } }[TableEditOperation];
export interface TableEditData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "format" | "replace" | "insert" | "delete"; readonly before: Location; readonly after: Location }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}
const orders: Readonly<Record<string, readonly string[]>> = {
  tblPr: "tblStyle tblpPr tblOverlap bidiVisual tblStyleRowBandSize tblStyleColBandSize tblW jc tblCellSpacing tblInd tblBorders shd tblLayout tblCellMar tblLook tblCaption tblDescription tblPrChange".split(" "),
  trPr: "cnfStyle divId gridBefore gridAfter wBefore wAfter cantSplit trHeight tblHeader tblCellSpacing jc hidden ins del trPrChange".split(" "),
  tcPr: "cnfStyle tcW gridSpan hMerge vMerge tcBorders shd noWrap tcMar textDirection tcFitText vAlign hideMark cellIns cellDel cellMerge tcPrChange".split(" "),
  tblCellMar: ["top", "left", "start", "bottom", "right", "end"], tcMar: ["top", "left", "start", "bottom", "right", "end"]
};
function children(node: XmlElement, name: string): XmlElement[] { return node.children.filter(c => c.namespace === node.namespace && c.localName === name); }
function one(node: XmlElement, name: string): XmlElement | undefined {
  const found = children(node, name);
  if (found.length > 1) throw new UnsupportedEditError("Duplicate table properties cannot be edited.");
  return found[0];
}
function attr(node: XmlElement | undefined, name: string): string | undefined { return node?.attributes.find(a => a.namespace === node.namespace && a.localName === name)?.value; }
function element(w: string, name: string, attrs: Readonly<Record<string, string>>, source?: XmlElement, inner = ""): string {
  const keep = source?.attributes.filter(a => a.namespace !== "http://www.w3.org/2000/xmlns/" && !(a.namespace === w && Object.hasOwn(attrs, a.localName))) ?? [];
  const namespaces = new Map(source?.namespaces); let prefix = "te";
  while (namespaces.has(prefix) && namespaces.get(prefix) !== w) prefix += "e";
  namespaces.set(prefix, w);
  return `<${prefix}:${name}${[...namespaces].filter(([p]) => p !== "xml").map(([p, uri]) => ` ${p ? "xmlns:" + p : "xmlns"}="${xmlValue(uri)}"`).join("")}${keep.map(a => ` ${a.name}="${xmlValue(a.value)}"`).join("")}${Object.entries(attrs).map(([k, v]) => ` ${prefix}:${k}="${xmlValue(v)}"`).join("")}>${inner}</${prefix}:${name}>`;
}
/** Merge only requested property attributes, retaining extension children and lexical siblings. */
function properties(xml: DocumentXmlEditor, owner: XmlElement, name: string, values: ReadonlyMap<string, Readonly<Record<string, string>> | null>, nested?: { name: string; values: ReadonlyMap<string, Readonly<Record<string, string>>> }): string {
  const props = one(owner, name), changes = new Map<XmlElement, string>(), additions = new Map<string, string>();
  const set = (key: string, markup: string, old: XmlElement | undefined) => { if (old) changes.set(old, markup); else additions.set(key, markup); };
  for (const [key, value] of values) {
    const old = props ? one(props, key) : undefined;
    if (value === null) { if (old) changes.set(old, ""); continue; }
    if (old && Object.entries(value).every(([k, v]) => attr(old, k) === v)) continue;
    set(key, element(owner.namespace, key, value, old, old ? xml.sourceXml(old, new Map(), true) : ""), old);
  }
  if (nested) {
    const containerOwner = props ?? { ...owner, children: [] };
    const markup = properties(xml, containerOwner, nested.name, nested.values);
    const old = props ? one(props, nested.name) : undefined;
    if (markup !== (old ? xml.sourceXml(old) : "")) set(nested.name, markup, old);
  }
  if (!changes.size && !additions.size) return props ? xml.sourceXml(props) : "";
  const order = orders[name] ?? [], prefixes = new Map<XmlElement, string>(); let tail = "";
  for (const [key, markup] of additions) {
    const next = props?.children.find(c => c.namespace === owner.namespace && order.indexOf(c.localName) > order.indexOf(key));
    if (next) prefixes.set(next, (prefixes.get(next) ?? "") + markup); else tail += markup;
  }
  for (const [node, prefix] of prefixes) changes.set(node, prefix + (changes.get(node) ?? xml.sourceXml(node)));
  const inner = (props ? xml.sourceXml(props, changes, true) : "") + tail;
  return props ? runElementOpen(props) + inner + `</${props.name}>` : element(owner.namespace, name, {}, undefined, inner);
}
function withProperties(xml: DocumentXmlEditor, node: XmlElement, name: string, markup: string, patches = new Map<XmlElement, string>()): string {
  const old = one(node, name);
  if (old) { patches.set(old, markup); return xml.sourceXml(node, patches); }
  if (!markup) return xml.sourceXml(node, patches);
  return runElementOpen(node) + (old ? "" : markup) + xml.sourceXml(node, patches, true) + `</${node.name}>`;
}
function descendants(node: XmlElement): XmlElement[] { return [node, ...node.children.flatMap(descendants)]; }
function header(row: XmlElement): boolean { const props = one(row, "trPr"), flag = props && one(props, "tblHeader"); return Boolean(flag && !["0", "false", "off"].includes(attr(flag, "val") ?? "1")); }
function validateHeaders(flags: readonly boolean[]): void {
  let ended = false;
  for (const value of flags) { if (value && ended) throw new InvalidValueError("Repeated headers must be consecutive leading rows."); if (!value) ended = true; }
}

/** Explicit table transactions preserve untouched XML and validate the complete candidate before publication. */
export async function editDocumentTables(input: Uint8Array, request: TableEditRequest, context: PublicationContext): Promise<TableEditData> {
  closedRecord(request, ["operation", "options", "input"]);
  if (request.operation === "tables.add") return editDocumentParagraphs(input, request, context);
  if (!["tables.set", "tables.rows.add", "tables.rows.remove", "tables.columns.add", "tables.columns.remove", "tables.merge", "tables.split"].includes(request.operation)) throw new DocxUsageError("Expected a table editing operation.");
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: request.operation, inputs: [request.input?.path ?? "document"], options: request.options }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"tables.set"> & DocxOperationArguments<"tables.rows.add"> & Partial<DocxOperationArguments<"tables.merge"> & DocxOperationArguments<"tables.split">>;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const selected = resolveDocxSelection(document, invocation);
  const archive = document.snapshot(); assertDocumentEditable(archive, { ...settings, budget });
  const main = document.list("story", { scope: "body" })[0]!.value.part.slice(1);
  const dialect = dialectForNamespace(parseDocumentXml(archive.members.find(m => m.name === main)!.bytes, {}, budget).root.namespace)!;
  const w = documentDialects[dialect].w;
  let styleId: string | undefined;
  if (opts.style !== undefined) {
    const graph = new DocumentPackage(archive, settings.limits, budget);
    const edge = graph.relationships("/" + main).find(e => e.reltype === documentDialects[dialect].r + "/styles");
    const styles = edge && !edge.is_external ? parseDocumentXml(edge.target_part.bytes, {}, budget).root : undefined;
    const found = styles?.children.filter(n => n.namespace === w && n.localName === "style" && attr(n, "type") === "table" && attr(one(n, "name"), "val") === opts.style) ?? [];
    if (found.length !== 1 || !(styleId = attr(found[0], "styleId"))) throw new InvalidValueError("Expected one existing table style.");
  }
  const editor = new DocumentArchiveEditor(archive, {}, undefined, budget);
  const updates: { before: Location; path: readonly number[]; kind: "format" | "replace" | "insert" | "delete"; resultKind: "table" | "cell" }[] = [];
  const edited = new Set<string>();
  for (const before of selected) {
    budget.charge("work", 1);
    const xml = editor.xml(before.value.part.slice(1)); let node = xml.root;
    const ancestors = [node]; for (const i of before.value.path) { node = node.children[i]!; ancestors.push(node); }
    if (!["table", "cell"].includes(before.kind) || before.value.range) throw new InvalidValueError("Table editing requires a whole table or cell anchor.");
    const table = [...ancestors].reverse().find(n => n.namespace === w && n.localName === "tbl");
    if (!table) throw new InvalidValueError("Expected a table anchor.");
    if (ancestors.some(n => n.namespace === w && ["ins", "del", "moveFrom", "moveTo"].includes(n.localName)) || descendants(table).some(n => n.namespace === w && ["tblPrChange", "trPrChange", "tcPrChange", "cellIns", "cellDel", "cellMerge"].includes(n.localName))) throw new UnsupportedEditError("Tracked table changes require explicit revision operations.");
    budget.charge("work", descendants(table).length);
    const tablePath = before.value.path.slice(0, ancestors.indexOf(table));
    const key = before.value.part + ":" + tablePath.join(",");
    if (edited.has(key)) throw new InvalidValueError("Overlapping table edits require separate transactions."); edited.add(key);
    const rows = children(table, "tr"), selectedRow = before.kind === "cell" ? [...ancestors].reverse().find(n => n.namespace === w && n.localName === "tr") : undefined;
    const patches = new Map<XmlElement, string>(); let replacement: string;
    const logical = mergedTableGrid(table, budget);
    if (request.operation === "tables.set" && opts.cell !== undefined && opts.cell !== before.positions.cell && opts.covered !== "owner") throw new SelectionError("ambiguous-selection", [before.token]);
    if (request.operation === "tables.set") {
      if (opts.text !== undefined && before.kind !== "cell") throw new InvalidValueError("Scalar table text requires a logical cell selection.");
      if (before.kind === "cell" && [opts.style, opts.autofit, opts.alignment, opts.direction].some(v => v !== undefined)) throw new InvalidValueError("Table style, layout, alignment and direction require a table selection.");
      const values = new Map<string, Record<string, string> | null>();
      if (styleId !== undefined) values.set("tblStyle", { val: styleId });
      if (opts.width !== undefined) values.set(before.kind === "cell" ? "tcW" : "tblW", { w: String(twips(opts.width)), type: "dxa" });
      if (opts.autofit !== undefined) values.set("tblLayout", { type: opts.autofit ? "autofit" : "fixed" });
      if (opts.alignment !== undefined) values.set("jc", opts.alignment === null ? null : { val: { LEFT: dialect === "strict" ? "start" : "left", CENTER: "center", RIGHT: dialect === "strict" ? "end" : "right" }[opts.alignment.name] });
      if (opts.direction !== undefined) values.set("bidiVisual", opts.direction === null ? null : { val: opts.direction.name === "RTL" ? "1" : "0" });
      const margin = opts.cellMargin === undefined ? undefined : String(twips(opts.cellMargin, false));
      const nested = margin === undefined ? undefined : { name: before.kind === "cell" ? "tcMar" : "tblCellMar", values: new Map((dialect === "strict" ? ["top", "start", "bottom", "end"] : ["top", "left", "bottom", "right"]).map(edge => [edge, { w: margin, type: "dxa" }])) };
      const target = before.kind === "cell" ? node : table, propertyName = before.kind === "cell" ? "tcPr" : "tblPr";
      const targetPatches = new Map<XmlElement, string>();
      if (opts.text !== undefined) {
        const storyNames = ["body", "hdr", "ftr", "footnote", "endnote", "comment", "txbxContent"];
        const story = [...ancestors].reverse().find(n => n.namespace === w && storyNames.includes(n.localName)) ?? xml.root;
        let fieldDepth = 0, reached = false;
        const precedingFields = (current: XmlElement): void => {
          if (reached) return;
          budget.charge("work", 1);
          if (current === target) { reached = true; return; }
          if (current !== story && current.namespace === w && storyNames.includes(current.localName)) return;
          if (current.namespace === w && current.localName === "fldChar") {
            const kind = attr(current, "fldCharType");
            if (kind === "begin") fieldDepth++;
            if (kind === "end") fieldDepth--;
          }
          for (const child of current.children) precedingFields(child);
        };
        precedingFields(story);
        if (fieldDepth > 0 || ancestors.some(n => n.namespace === w && n.localName === "fldSimple")) throw new UnsupportedEditError("Cell text replacement cannot edit content inside a field range.");
        if (target.children.some(n => n.namespace !== w || !["tcPr", "p"].includes(n.localName))) throw new UnsupportedEditError("Cell text replacement cannot discard nested tables or opaque content.");
        const paragraphs = children(target, "p");
        if (!paragraphs.length) throw new UnsupportedEditError("Cell text replacement requires a paragraph.");
        for (const [i, p] of paragraphs.entries()) {
          const props = one(p, "pPr");
          const updated = replaceParagraphContent(xml, p, props ? xml.sourceXml(props) : "", i === 0 ? opts.text : "");
          if (i > 0 && (p.content.some(c => c.kind !== "element" && c.kind !== "text") || descendants(p).some(c => c.namespace === w && ["bookmarkStart", "bookmarkEnd", "commentRangeStart", "commentRangeEnd", "permStart", "permEnd", "proofErr"].includes(c.localName)))) throw new UnsupportedEditError("Cell replacement cannot remove annotated paragraphs.");
          targetPatches.set(p, i === 0 ? updated : "");
        }
      }
      const formatted = withProperties(xml, target, propertyName, properties(xml, target, propertyName, values, nested), targetPatches);
      if (target === table) patches.set(table, formatted);
      else patches.set(selectedRow!, xml.sourceXml(selectedRow!, new Map([[target, formatted]])));
      if (opts.repeatHeader !== undefined || opts.allowRowSplit !== undefined) {
        const affected = selectedRow ? [selectedRow] : rows;
        validateHeaders(rows.map(row => affected.includes(row) && opts.repeatHeader !== undefined ? opts.repeatHeader : header(row)));
        for (const row of affected) {
          const rowValues = new Map<string, Record<string, string>>();
          if (opts.repeatHeader !== undefined) rowValues.set("tblHeader", { val: String(Number(opts.repeatHeader)) });
          if (opts.allowRowSplit !== undefined) rowValues.set("cantSplit", { val: String(Number(!opts.allowRowSplit)) });
          patches.set(row, withProperties(xml, row, "trPr", properties(xml, row, "trPr", rowValues), target === node && before.kind === "cell" ? new Map([[node, formatted]]) : new Map()));
        }
      }
      if (target === table) {
        const rowPatches = new Map([...patches].filter(([n]) => n !== table));
        replacement = withProperties(xml, table, "tblPr", properties(xml, table, "tblPr", values, nested), rowPatches);
      } else replacement = xml.sourceXml(table, patches);
    } else if (request.operation === "tables.merge" || request.operation === "tables.split" || request.operation === "tables.rows.remove" && logical.owners.some(o => o.rowSpan > 1 || o.columnSpan > 1)) {
      if (request.operation !== "tables.rows.remove" && descendants(table).some(c => c.namespace === w && ["fldChar", "bookmarkStart", "bookmarkEnd", "commentRangeStart", "commentRangeEnd", "permStart", "permEnd"].includes(c.localName))) throw new UnsupportedEditError("Merge and split cannot move range markers or complex fields.");
      if (request.operation === "tables.rows.remove" && before.kind !== "table") throw new InvalidValueError("Row removal requires a table anchor.");
      if (request.operation === "tables.rows.remove" && descendants(rows[(opts.index ?? 0) - 1] ?? table).some(c => c.namespace === w && ["bookmarkStart", "bookmarkEnd", "commentRangeStart", "commentRangeEnd", "permStart", "permEnd", "fldChar"].includes(c.localName))) throw new UnsupportedEditError("Structural deletion cannot remove range markers or complex fields.");
      replacement = editMergedTable(xml, table, node, request.operation, opts, budget);
    } else {
      if (before.kind !== "table") throw new InvalidValueError("Row and column operations require a table anchor.");
      const grid = one(table, "tblGrid"), columns = grid ? children(grid, "gridCol") : [];
      if (!grid || !columns.length || !rows.length) throw new UnsupportedEditError("Structural edits require a nonempty table grid.");
      if (table.children.some(c => c.namespace !== w || !["tblPr", "tblGrid", "tr"].includes(c.localName)) || grid.children.some(c => c.namespace !== w || c.localName !== "gridCol")) throw new UnsupportedEditError("Structural edits require a rectangular table without wrapped rows or columns.");
      for (const row of rows) {
        if (row.children.some(c => c.namespace !== w || !["trPr", "tc"].includes(c.localName))) throw new UnsupportedEditError("Structural edits require rectangular rows without wrapped cells.");
        const props = one(row, "trPr");
        if (props && ["gridBefore", "gridAfter"].some(name => { const v = one(props, name); return v && attr(v, "val") !== "0"; }) || children(row, "tc").length !== columns.length || children(row, "tc").some(tc => { const p = one(tc, "tcPr"); return p && ["gridSpan", "vMerge", "hMerge"].some(n => one(p, n)); })) throw new UnsupportedEditError("Structural edits require a rectangular unmerged table without omitted cells.");
      }
      const rowOperation = request.operation.startsWith("tables.rows."), adding = request.operation.endsWith(".add"), count = rowOperation ? rows.length : columns.length;
      const position = opts.index ?? count + 1;
      if (!Number.isSafeInteger(position) || position < 1) throw new InvalidValueError("Table index must be a positive one-based integer.");
      if (position > count + (adding ? 1 : 0)) throw new SelectionError("missing-selection");
      if (!adding && count === 1) throw new InvalidValueError("Structural removal must retain at least one row and column.");
      budget.table(rows.length + (rowOperation ? adding ? 1 : -1 : 0), columns.length + (rowOperation ? 0 : adding ? 1 : -1));
      const widths = columns.map(column => Number(attr(column, "w")));
      if (adding && widths.some(value => !Number.isSafeInteger(value) || value <= 0)) throw new UnsupportedEditError("Insertion requires stored positive grid widths.");
      const emptyCell = (width: number) => element(w, "tc", {}, undefined, element(w, "tcPr", {}, undefined, element(w, "tcW", { w: String(width), type: "dxa" })) + element(w, "p", {}));
      const insert = (parent: XmlElement, values: readonly XmlElement[], markup: string) => {
        const next = values[position - 1];
        if (next) patches.set(next, markup + xml.sourceXml(next));
        else { const last = values.at(-1)!; patches.set(last, xml.sourceXml(last) + markup); }
        return xml.sourceXml(parent, patches);
      };
      if (rowOperation) {
        if (opts.width !== undefined && twips(opts.width) !== widths.reduce((a, b) => a + b, 0)) throw new InvalidValueError("New row width must equal the table grid width.");
        if (adding) {
          const flags = rows.map(header), repeated = position <= flags.filter(Boolean).length;
          flags.splice(position - 1, 0, repeated); validateHeaders(flags);
          replacement = insert(table, rows, element(w, "tr", {}, undefined, (repeated ? element(w, "trPr", {}, undefined, element(w, "tblHeader", { val: "1" })) : "") + widths.map(emptyCell).join("")));
        } else { patches.set(rows[position - 1]!, ""); replacement = xml.sourceXml(table, patches); }
      } else {
        const width = adding ? opts.width ? twips(opts.width) : Math.floor(tableContainerWidth(before, xml.root, editor.xml(main).root) / (columns.length + 1)) : widths[position - 1]!;
        if (adding && (!Number.isSafeInteger(width) || width < 1)) throw new InvalidValueError("Column insertion requires a positive width.");
        const gridMarkup = adding ? insert(grid, columns, element(w, "gridCol", { w: String(width) })) : xml.sourceXml(grid, new Map([[columns[position - 1]!, ""]]));
        patches.clear(); patches.set(grid, gridMarkup);
        for (const row of rows) {
          const cells = children(row, "tc"), local = new Map<XmlElement, string>();
          if (adding) { const next = cells[position - 1]; const anchor = next ?? cells.at(-1)!; local.set(anchor, next ? emptyCell(width) + xml.sourceXml(anchor) : xml.sourceXml(anchor) + emptyCell(width)); }
          else local.set(cells[position - 1]!, "");
          patches.set(row, xml.sourceXml(row, local));
        }
        const props = one(table, "tblPr"), preferred = props && one(props, "tblW");
        const oldWidth = Number(attr(preferred, "w"));
        if (attr(preferred, "type") === "dxa" && Number.isSafeInteger(oldWidth) && Number.isSafeInteger(width)) {
          const newWidth = oldWidth + (adding ? width : -width);
          if (newWidth <= 0) throw new InvalidValueError("Column removal leaves an invalid preferred table width.");
          replacement = withProperties(xml, table, "tblPr", properties(xml, table, "tblPr", new Map([["tblW", { w: String(newWidth), type: "dxa" }]])), patches);
        } else replacement = xml.sourceXml(table, patches);
      }
      if (!adding) {
        const removed = rowOperation ? [rows[position - 1]!] : rows.map(row => children(row, "tc")[position - 1]!);
        if (removed.some(n => descendants(n).some(c => c.namespace === w && ["bookmarkStart", "bookmarkEnd", "commentRangeStart", "commentRangeEnd", "permStart", "permEnd", "fldChar"].includes(c.localName)))) throw new UnsupportedEditError("Structural deletion cannot remove range markers or complex fields.");
      }
    }
    if (replacement === xml.sourceXml(table)) continue;
    const resultingTable = parseDocumentXml(new TextEncoder().encode(runElementOpen(table) + replacement + `</${table.name}>`), {}, budget).root.children[0]!;
    mergedTableGrid(resultingTable, budget);
    xml.replaceElement(table, replacement);
    let resultPath = tablePath;
    if (request.operation === "tables.set" && before.kind === "cell") {
      const replaced = parseDocumentXml(new TextEncoder().encode(runElementOpen(table) + replacement + `</${table.name}>`), {}, budget).root.children[0]!;
      const row = children(replaced, "tr")[rows.indexOf(selectedRow!)]!;
      const cell = children(row, "tc")[children(selectedRow!, "tc").indexOf(node)]!;
      resultPath = [...tablePath, replaced.children.indexOf(row), row.children.indexOf(cell)];
    }
    updates.push({ before, path: resultPath, kind: request.operation === "tables.set" ? opts.text === undefined ? "format" : "replace" : ["tables.merge", "tables.split"].includes(request.operation) ? "replace" : request.operation.endsWith(".add") ? "insert" : "delete", resultKind: request.operation === "tables.set" && before.kind === "cell" ? "cell" : "table" });
  }
  const candidate = editor.snapshot(), index = new LocationIndex(candidate, settings.limits, main, dialect, budget);
  budget.check("matches", updates.length);
  const changes = updates.map(({ before, path, kind, resultKind }) => {
    const entry = index.byAddress.get(addressKey({ ...before.value, path }))?.find(e => e.kind === resultKind);
    if (!entry) throw new UnsupportedEditError("Table edit could not resolve its resulting location.");
    const value = { ...before.value, generation: 1, path, range: null };
    return { kind, before, after: { kind: resultKind, value, token: encodeLocation(value), positions: entry.positions } as Location };
  });
  const publication = { ...(request.input ? { input: request.input } : {}), ...(opts.output === undefined ? {} : { output: opts.output }), ...(opts.inPlace === undefined ? {} : { inPlace: opts.inPlace }), ...(opts.force === undefined ? {} : { force: opts.force }), ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }), ...(opts.json === undefined ? {} : { json: opts.json }) };
  const prospective = { changed: changes.length > 0, changes, dryRun: opts.dryRun ?? false, output: opts.dryRun ? null : { path: opts.inPlace ? request.input?.path ?? null : opts.output === "-" ? null : opts.output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: request.operation, ok: true, data: prospective, affected: changes.length, locations: changes.map(c => c.after), warnings: [], errors: [] }) + "\n").length);
  const result = await publishDocumentArchive(candidate, publication, { ...context, budget });
  return { changed: changes.length > 0, changes, dryRun: opts.dryRun ?? false, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
