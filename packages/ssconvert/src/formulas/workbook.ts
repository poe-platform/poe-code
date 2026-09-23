import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { snapshotWorkbook, type FormulaGroup, type ImportedValue, type Sheet, type Workbook } from "../workbook.js";
export { resizeWorkbookReferences } from "../workbook/resize.js";
import { foldSheetName } from "../workbook/case-fold.js";
import type { FormulaDocument, ParsePosition } from "./ast.js";
import { parseExpression } from "./parser.js";
import { quoteFormulaString } from "./serialization.js";
import { gnumericGrammar } from "./conventions.js";
import { rewriteReferences, visitFormula } from "./rewriting.js";
import { chartDataTypes } from "../objects/data.js";

export function rewriteWorkbook(book: Workbook, context: CapabilityContext, rewrite: (document: FormulaDocument, namedExpression: boolean) => string): Workbook {
  let work = 0;
  const maximum = context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32;
  const formula = (source: string, position: ParsePosition, namedExpression = false) => {
    context.signal.throwIfAborted();
    work += source.length + 1;
    if (work > maximum) throw new SsconvertError("resource-limit", "ssconvert workbook work limit exceeded");
    const parsed = parseExpression(source, { position, workbook: book, signal: context.signal });
    if (!parsed.ok) throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: formula syntax at ${parsed.diagnostic.start}:${parsed.diagnostic.end}`);
    return rewrite(parsed.document, namedExpression);
  };
  // GOffice chart dimensions carry serialized expressions, not display text.
  const chart = (value: ImportedValue, sheet: string, parent?: "Objects" | "graph" | "GogObject" | "data", namespace?: string): ImportedValue => {
    context.signal.throwIfAborted();
    if (++work > maximum) throw new SsconvertError("resource-limit", "ssconvert workbook work limit exceeded");
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const node = value as { readonly [key: string]: ImportedValue };
    const role = parent === undefined && node.name === "Objects" ? "Objects"
      : parent === "Objects" && node.namespace === namespace && (node.name === "SheetObjectGraph" || node.name === "GnmGraph") ? "graph"
      : (parent === "graph" || parent === "GogObject") && node.namespace === "" && node.name === "GogObject" ? "GogObject"
      : parent === "GogObject" && node.namespace === "" && node.name === "data" ? "data" : undefined;
    const dimension = parent === "data" && node.name === "dimension" && node.namespace === "";
    if (role === undefined && !dimension) return value;
    const type = Array.isArray(node.attributes) ? node.attributes.find(attribute => attribute !== null && typeof attribute === "object" && !Array.isArray(attribute) && attribute.name === "type" && attribute.namespace === "") : undefined;
    const typeName = type && typeof type === "object" && !Array.isArray(type) && typeof type.value === "string" ? type.value : "";
    return { ...node,
      ...(dimension && Object.hasOwn(chartDataTypes, typeName) && chartDataTypes[typeName]!.storage === "expression" && typeof node.text === "string" && node.text
        ? { text: formula(node.text, { sheet, row: 0, column: 0 }) } : {}),
      ...(role !== undefined && Array.isArray(node.children) ? { children: node.children.map(child => chart(child, sheet, role, role === "Objects" && typeof node.namespace === "string" ? node.namespace : namespace)) } : {}) };
  };
  const rewriteSheet = (sheet: Sheet): Sheet => ({ ...sheet,
      cells: sheet.cells.map(cell => cell.formula === undefined ? cell : { ...cell, formula: formula(cell.formula, { sheet: sheet.id, row: cell.row, column: cell.column }) }),
      ...(sheet.formulaGroups ? { formulaGroups: sheet.formulaGroups.map(group => ({ ...group, expression: formula(group.expression,
        { sheet: sheet.id, row: group.range.startRow, column: group.range.startColumn }) })) } : {}),
      ...(sheet.unsupportedRecords ? { unsupportedRecords: sheet.unsupportedRecords.map(record =>
        record.source === "Gnumeric_XmlIO:sax" && record.kind === "Objects" && record.disposition === "retained" && record.data !== undefined
          ? { ...record, data: chart(record.data, sheet.id) } : record) } : {}) });
  return snapshotWorkbook({ ...book,
    sheets: book.sheets.map(rewriteSheet),
    ...(book.detachedSheets ? { detachedSheets: book.detachedSheets.map(rewriteSheet) } : {}),
    ...(book.names ? { names: book.names.map(name => ({ ...name, expression: formula(name.expression, name.position ?? {
      sheet: name.sheet ?? book.activeSheet ?? book.sheets[0]?.id ?? "", row: 0, column: 0 }, true) })) } : {})
  }, context.limits);
}

export function renameWorkbookSheet(book: Workbook, sheetId: string, name: string, context: CapabilityContext): Workbook {
  context.signal.throwIfAborted();
  book = snapshotWorkbook(book, context.limits);
  const sheet = book.sheets.find(sheet => sheet.id === sheetId);
  if (!sheet || !name || name.includes("\0") || book.sheets.some(s => s.id !== sheetId && foldSheetName(s.name) === foldSheetName(name)))
    throw new SsconvertError("invalid-request", "Invalid sheet rename");
  if (sheet.name === name) return book;
  const renamed = rewriteWorkbook(book, context, document => {
    const spellings = new Map<string, string>();
    visitFormula(document.root, node => {
      const names = node.kind === "reference" ? [node.first.sheet, node.last?.sheet] : node.kind === "name" ? [node.sheet] : [];
      for (const spelling of names) if (spelling !== undefined && foldSheetName(spelling) === foldSheetName(sheet.name)) spellings.set(spelling, name);
    });
    return rewriteReferences(document, { sheets: spellings, signal: context.signal });
  });
  return snapshotWorkbook({ ...renamed, sheets: renamed.sheets.map(s => s.id === sheetId ? { ...s, name } : s),
    ...(renamed.names ? { names: renamed.names.map(entry => entry.sheet === sheetId && entry.name === "Sheet_Title"
      ? { ...entry, expression: quoteFormulaString(name, '"', gnumericGrammar) } : entry) } : {})
  }, context.limits);
}

/** Rehome incoming sheet identities and their local expression namespace in one pass. */
export function remapWorkbookSheets(book: Workbook, mapping: ReadonlyMap<string, { id: string; name: string }>, context: CapabilityContext): Workbook {
  context.signal.throwIfAborted();
  book = snapshotWorkbook(book, context.limits);
  const names = new Map(book.sheets.map(sheet => [foldSheetName(sheet.name), mapping.get(sheet.id)?.name ?? sheet.name]));
  const rewritten = rewriteWorkbook(book, context, document => {
    const spellings = new Map<string, string>();
    visitFormula(document.root, node => {
      const refs = node.kind === "reference" ? [node.first.sheet, node.last?.sheet] : node.kind === "name" ? [node.sheet] : [];
      for (const spelling of refs) if (spelling !== undefined && names.has(foldSheetName(spelling))) spellings.set(spelling, names.get(foldSheetName(spelling))!);
    });
    return rewriteReferences(document, { sheets: spellings, signal: context.signal });
  });
  const id = (value: string) => mapping.get(value)?.id ?? value;
  const renamedTitles = new Map(book.sheets.flatMap(sheet => {
    const target = mapping.get(sheet.id);
    return target && target.name !== sheet.name ? [[sheet.id, quoteFormulaString(target.name, '"', gnumericGrammar)]] : [];
  }));
  const range = <T extends { sheet: string; endSheet?: string }>(value: T): T => ({ ...value, sheet: id(value.sheet), ...(value.endSheet ? { endSheet: id(value.endSheet) } : {}) });
  return snapshotWorkbook({ ...rewritten, sheets: rewritten.sheets.map(sheet => ({ ...sheet, ...mapping.get(sheet.id) })),
    ...(rewritten.activeSheet ? { activeSheet: id(rewritten.activeSheet) } : {}),
    ...(rewritten.names ? { names: rewritten.names.map(name => ({ ...name, ...(name.sheet ? { sheet: id(name.sheet) } : {}),
      ...(name.name === "Sheet_Title" && name.sheet !== undefined && renamedTitles.has(name.sheet) ? { expression: renamedTitles.get(name.sheet)! } : {}),
      ...(name.position ? { position: { ...name.position, sheet: id(name.position.sheet) } } : {}) })) } : {}),
    ...(rewritten.dependencies ? { dependencies: rewritten.dependencies.map(dep => ({ ...dep, dependent: range(dep.dependent), precedent: range(dep.precedent) })) } : {})
  }, context.limits);
}

/** Sheet references retain stable identities/endpoints when tab order changes. */
export function moveWorkbookSheet(book: Workbook, sheet: string, index: number, context: CapabilityContext): Workbook {
  context.signal.throwIfAborted();
  book = snapshotWorkbook(book, context.limits);
  const current = book.sheets.findIndex(s => s.id === sheet);
  if (current < 0 || !Number.isSafeInteger(index) || index < 0 || index >= book.sheets.length) throw new SsconvertError("invalid-request", "Invalid sheet move");
  const sheets = [...book.sheets], [moved] = sheets.splice(current, 1); sheets.splice(index, 0, moved!);
  return snapshotWorkbook({ ...book, sheets }, context.limits);
}

export function translateFormulaGroup(group: FormulaGroup, target: ParsePosition, context: CapabilityContext): string {
  context.signal.throwIfAborted();
  if (!Number.isSafeInteger(target.row) || !Number.isSafeInteger(target.column) || target.row < group.range.startRow || target.row > group.range.endRow || target.column < group.range.startColumn || target.column > group.range.endColumn)
    throw new SsconvertError("invalid-request", "Invalid formula group member");
  if (group.kind === "array") return group.expression;
  const result = parseExpression(group.expression, { position: { sheet: target.sheet, row: group.range.startRow, column: group.range.startColumn }, signal: context.signal });
  if (!result.ok) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: shared formula syntax");
  return rewriteReferences(result.document, { position: target, translation: "copy", signal: context.signal });
}
