import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { ImportedValue, Sheet, Workbook } from "@poe-code/spreadsheet-ast";
import { odfObject, odfNamespaces } from "../codecs/odf-write-support.js";
import { translateOdfHyperlink } from "../codecs/odf-hyperlinks.js";
import { parseExpression } from "../formulas/parser.js";
import { rewriteReferences } from "../formulas/rewriting.js";
import { foldSheetName } from "@poe-code/spreadsheet-ast/case-fold";

/** Rewrite only recognized internal-link fields; retained XML is otherwise passive. */
export function rewriteWorkbookHyperlinks(book: Workbook, names: ReadonlyMap<string, string>, context: CapabilityContext): Workbook {
  let work = 0;
  const maximum = context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32;
  function charge(amount = 1) {
    context.signal.throwIfAborted();
    if (amount > maximum - work) throw new SsconvertError("resource-limit", "ssconvert hyperlink work limit exceeded");
    work += amount;
  }
  const sheets = [...book.sheets, ...book.detachedSheets ?? []].map(sheet => sheet.name);
  const changes = new Map(sheets.flatMap(name => {
    charge(name.length);
    const next = names.get(foldSheetName(name));
    return next === undefined || next === name ? [] : [[foldSheetName(name), next]];
  }));
  if (!changes.size) return book;
  const renamedSheets = sheets.map(name => names.get(foldSheetName(name)) ?? name);
  function target(source: string, odf: boolean): string {
    charge(source.length);
    if (odf && !source.startsWith("#")) return source;
    const native = odf ? translateOdfHyperlink(source, "import", charge, sheets) : source;
    const parsed = parseExpression("=" + native, { position: { sheet: "", row: 0, column: 0 }, onWork: charge, signal: context.signal });
    if (!parsed.ok) return source;
    const node = parsed.document.root;
    const spellings = node.kind === "name" && node.workbook === undefined ? [node.sheet]
      : node.kind === "reference" && !node.label && node.first.workbook === undefined && node.last?.workbook === undefined
        ? [node.first.sheet, node.last?.sheet] : [];
    const replacements = new Map<string, string>();
    for (const spelling of spellings) if (spelling !== undefined) {
      charge(spelling.length);
      const name = changes.get(foldSheetName(spelling));
      if (name !== undefined && name !== spelling) replacements.set(spelling, name);
    }
    if (!replacements.size) return source;
    const rewritten = rewriteReferences(parsed.document, { sheets: replacements, signal: context.signal }).slice(1);
    charge(rewritten.length);
    return odf ? translateOdfHyperlink(rewritten, "export", charge, renamedSheets) : rewritten;
  }
  function xml(value: ImportedValue, odf: boolean, root: string, implicitNamespace = false): ImportedValue {
    let result = value;
    const pending = [{ value, role: root, depth: 0, assign: (next: ImportedValue) => { result = next; } }];
    while (pending.length) {
      const item = pending.pop()!;
      charge();
      const node = odfObject(item.value);
      if (!node || typeof node.name !== "string" || node.name !== item.role) continue;
      const validNamespace = odf ? node.namespace === odfNamespaces.text || node.namespace === "http://openoffice.org/2000/text"
        : node.namespace === "http://www.gnumeric.org/v10.dtd" || implicitNamespace && (node.namespace === undefined || node.namespace === "");
      if (!validNamespace) continue;
      if (item.depth > (context.limits.xmlDepth ?? Infinity)) throw new SsconvertError("resource-limit", "ssconvert hyperlink depth limit exceeded");
      const updated: Record<string, ImportedValue> = { ...node };
      item.assign(updated);
      const attributes = odfObject(node.attributes);
      const list = Array.isArray(node.attributes) ? node.attributes : [];
      const field = (name: string, namespace: string) => {
        if (attributes && !namespace && typeof attributes[name] === "string") return attributes[name];
        for (const value of list) {
          charge(); const attribute = odfObject(value);
          if (attribute?.name === name && attribute.namespace === namespace && typeof attribute.value === "string") return attribute.value;
        }
        return undefined;
      };
      const link = odf ? node.name === "a" : node.name === "HyperLink" && field("type", "") === "GnmHLinkCurWB";
      if (link) {
        const name = odf ? "href" : "target", namespace = odf ? odfNamespaces.xlink! : "";
        const source = field(name, namespace);
        if (source !== undefined) {
          const rewritten = target(source, odf);
          updated.attributes = attributes ? { ...attributes, [name]: rewritten } : list.map(value => {
            charge(); const attribute = odfObject(value);
            return attribute?.name === name && attribute.namespace === namespace ? { ...attribute, value: rewritten } : value;
          });
        }
      }
      const childRole = odf ? undefined : node.name === "Styles" ? "StyleRegion" : node.name === "StyleRegion" ? "Style" : node.name === "Style" ? "HyperLink" : "";
      const enqueue = (value: ImportedValue, assign: (next: ImportedValue) => void) => {
        charge(); const child = odfObject(value);
        if (typeof child?.name === "string") pending.push({ value, role: childRole ?? child.name, depth: item.depth + 1, assign });
      };
      if (Array.isArray(node.children)) {
        const children = [...node.children]; updated.children = children;
        children.forEach((child, index) => enqueue(child, next => { children[index] = next; }));
      }
      if (odf && Array.isArray(node.content)) {
        const content = [...node.content]; updated.content = content;
        content.forEach((value, index) => {
          charge(); const entry = odfObject(value);
          if (entry?.kind === "element" && entry.index === undefined && entry.value !== undefined)
            enqueue(entry.value, next => { content[index] = { ...entry, value: next }; });
        });
      }
    }
    return result;
  }
  const style = (value: Readonly<Record<string, ImportedValue>> | undefined) => {
    charge();
    return value?.gnumeric === undefined ? value : { ...value, gnumeric: xml(value.gnumeric, false, "Style", true) };
  };
  const sheet = (value: Sheet): Sheet => ({ ...value,
    cells: value.cells.map(cell => { charge(); return { ...cell, ...(cell.style ? { style: style(cell.style)! } : {}) }; }),
    ...(value.rows ? { rows: value.rows.map(row => ({ ...row, ...(row.style ? { style: style(row.style)! } : {}) })) } : {}),
    ...(value.columns ? { columns: value.columns.map(column => ({ ...column, ...(column.style ? { style: style(column.style)! } : {}) })) } : {}),
    ...(value.unsupportedRecords ? { unsupportedRecords: value.unsupportedRecords.map(record => {
      charge(); if (record.disposition !== "retained" || record.data === undefined) return record;
      if (record.source === "Gnumeric_XmlIO:sax" && record.kind === "Styles") return { ...record, data: xml(record.data, false, "Styles") };
      if (record.kind === "p" && (record.source === "Gnumeric_OpenCalc:openoffice" || record.source === "odf:cell-content")) {
        const data = odfObject(record.data);
        return data?.xml === undefined ? { ...record, data: xml(record.data, true, "p") }
          : { ...record, data: { ...data, xml: xml(data.xml, true, "p") } };
      }
      return record;
    }) } : {}) });
  return { ...book, sheets: book.sheets.map(sheet), ...(book.detachedSheets ? { detachedSheets: book.detachedSheets.map(sheet) } : {}) };
}
