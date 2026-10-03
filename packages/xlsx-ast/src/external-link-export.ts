import { foldSheetName } from "@poe-code/spreadsheet-ast/case-fold";
import type { Workbook } from "@poe-code/spreadsheet-ast";
import { retainedExternalNameDefinitions, externalNameKey, type ExternalBookDefinitions, type ExternalNameDefinition } from "@poe-code/spreadsheet-engine/codecs/external-name-definitions";
import type { FormulaNode, ParsePosition } from "@poe-code/spreadsheet-engine/formulas/ast";
import { excelGrammar } from "@poe-code/spreadsheet-engine/formulas/conventions";
import { quoteFormulaString, serializeReference } from "@poe-code/spreadsheet-engine/formulas/serialization";

/** An XLSX link table is ordered independently of workbook relationship IDs. */
export class XlsxExternalLinkWriter {
  readonly books = new Map<string, { index: number; sheets: Map<string, string>; names: Map<string, { name: string; sheet?: string }>; definitions: ReadonlyMap<string, ExternalNameDefinition> }>();
  private readonly definitions: Map<string, ExternalBookDefinitions>;
  constructor(book: Workbook, private readonly charge: (amount?: number) => void) {
    this.definitions = retainedExternalNameDefinitions(book, charge);
  }
  private register(workbook: string, sheets: readonly (string | undefined)[]) {
    this.charge(workbook.length + 1);
    let book = this.books.get(workbook);
    if (!book) {
      const retained = this.definitions.get(workbook);
      book = { index: this.books.size + 1, sheets: new Map(), names: new Map(), definitions: retained?.names ?? new Map() };
      this.books.set(workbook, book);
      for (const sheet of retained?.sheets ?? []) {
        this.charge(sheet.length + 1);
        book.sheets.set(foldSheetName(sheet), sheet);
      }
    }
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
