import { foldSheetName } from "@poe-code/spreadsheet-ast/case-fold";
import type { Workbook } from "@poe-code/spreadsheet-ast";
import { SsconvertError } from "@poe-code/spreadsheet-engine/contracts";
import type { FormulaNode, ParsePosition } from "@poe-code/spreadsheet-engine/formulas/ast";
import { excelGrammar } from "@poe-code/spreadsheet-engine/formulas/conventions";
import { quoteFormulaString, serializeReference } from "@poe-code/spreadsheet-engine/formulas/serialization";

interface ExternalNameDefinition { readonly name: string; readonly sheet?: string; readonly expression: string; }

function externalNameKey(name: string, sheet?: string): string {
  return JSON.stringify([foldSheetName(name), sheet === undefined ? null : foldSheetName(sheet)]);
}

/** An XLSX link table is ordered independently of workbook relationship IDs. */
export class XlsxExternalLinkWriter {
  readonly books = new Map<string, { index: number; sheets: Map<string, string>; names: Map<string, { name: string; sheet?: string }>; definitions: ReadonlyMap<string, ExternalNameDefinition> }>();
  private readonly definitions = new Map<string, Map<string, ExternalNameDefinition>>();
  constructor(book: Workbook, private readonly charge: (amount?: number) => void) {
    for (const record of book.unsupportedRecords ?? []) {
      charge();
      if (record.kind !== "externalLink" || !record.data || typeof record.data !== "object" || Array.isArray(record.data)) continue;
      const value = (record.data as Readonly<Record<string, unknown>>).externalNameDefinitions;
      if (value === undefined) continue;
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new SsconvertError("unsupported-feature", "Invalid retained XLSX external name definitions");
      const retained = value as Readonly<Record<string, unknown>>;
      if (typeof retained.workbook !== "string" || !retained.workbook || !Array.isArray(retained.names))
        throw new SsconvertError("unsupported-feature", "Invalid retained XLSX external name definitions");
      charge(retained.workbook.length + retained.names.length);
      const names = this.definitions.get(retained.workbook) ?? new Map<string, ExternalNameDefinition>();
      for (const value of retained.names) {
        if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.name !== "string" || !value.name ||
          typeof value.expression !== "string" || !value.expression || value.sheet !== undefined && typeof value.sheet !== "string")
          throw new SsconvertError("unsupported-feature", "Invalid retained XLSX external name definition");
        const definition: ExternalNameDefinition = { name: value.name, expression: value.expression, ...(typeof value.sheet === "string" ? { sheet: value.sheet } : {}) };
        charge(definition.name.length + definition.expression.length + (definition.sheet?.length ?? 0));
        const key = externalNameKey(definition.name, definition.sheet), previous = names.get(key);
        if (previous && previous.expression !== definition.expression)
          throw new SsconvertError("unsupported-feature", "Conflicting retained XLSX external name definitions");
        names.set(key, definition);
      }
      this.definitions.set(retained.workbook, names);
    }
  }
  private register(workbook: string, sheets: readonly (string | undefined)[]) {
    this.charge(workbook.length + 1);
    let book = this.books.get(workbook);
    if (!book) { book = { index: this.books.size + 1, sheets: new Map(), names: new Map(), definitions: this.definitions.get(workbook) ?? new Map() }; this.books.set(workbook, book); }
    for (const sheet of sheets) if (sheet !== undefined) { this.charge(sheet.length + 1); const key = foldSheetName(sheet); if (!book.sheets.has(key)) book.sheets.set(key, sheet); }
    return book;
  }
  reference(node: Extract<FormulaNode, { kind: "reference" }>, position: ParsePosition): string {
    const { index } = this.register(node.first.workbook!, [node.first.sheet, node.last?.sheet]);
    const sheet = node.first.sheet ?? position.sheet;
    const span = node.last?.sheet && node.last.sheet !== sheet ? sheet + ":" + node.last.sheet : sheet;
    const { workbook: ignoredFirstBook, sheet: ignoredFirstSheet, sheetRelative: ignoredFirstRelative, ...first } = node.first;
    const { workbook: ignoredLastBook, sheet: ignoredLastSheet, sheetRelative: ignoredLastRelative, ...last } = node.last ?? node.first;
    const address = serializeReference(first, node.last ? last : undefined, excelGrammar, position);
    return quoteFormulaString(`[${index}]${span}`, "'", excelGrammar) + "!" + address;
  }
  name(node: Extract<FormulaNode, { kind: "name" }>): string {
    const book = this.register(node.workbook!, [node.sheet]);
    this.charge(node.name.length + 1); book.names.set(externalNameKey(node.name, node.sheet), { name: node.name, ...(node.sheet === undefined ? {} : { sheet: node.sheet }) });
    const { index } = book;
    return (node.sheet ? quoteFormulaString(`[${index}]${node.sheet}`, "'", excelGrammar) : `[${index}]`) + "!" + node.name;
  }
}
