import type { Workbook } from "@poe-code/spreadsheet-ast";
import { foldSheetName } from "@poe-code/spreadsheet-ast/case-fold";
import { SsconvertError } from "../contracts.js";

export interface ExternalNameDefinition { readonly name: string; readonly sheet?: string; readonly expression: string; }
export interface ExternalBookDefinitions { readonly sheets: readonly string[]; readonly names: Map<string, ExternalNameDefinition>; }
export function externalNameKey(name: string, sheet?: string): string {
  return JSON.stringify([foldSheetName(name), sheet === undefined ? null : foldSheetName(sheet)]);
}

/** Portable transport metadata; definitions are never evaluated by this reader. */
export function retainedExternalNameDefinitions(book: Workbook, charge: (amount?: number) => void): Map<string, ExternalBookDefinitions> {
  const books = new Map<string, ExternalBookDefinitions>();
  for (const record of book.unsupportedRecords ?? []) {
    charge();
    if (!record.data || typeof record.data !== "object" || Array.isArray(record.data)) continue;
    const value = (record.data as Readonly<Record<string, unknown>>).externalNameDefinitions;
    if (value === undefined) continue;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new SsconvertError("unsupported-feature", "Invalid retained external name definitions");
    const retained = value as Readonly<Record<string, unknown>>;
    if (typeof retained.workbook !== "string" || !retained.workbook || !Array.isArray(retained.names) || retained.sheets !== undefined && !Array.isArray(retained.sheets))
      throw new SsconvertError("unsupported-feature", "Invalid retained external name definitions");
    charge(retained.workbook.length + retained.names.length);
    const sheets: string[] = [];
    for (const sheet of retained.sheets as unknown[] ?? []) {
      if (typeof sheet !== "string" || !sheet) throw new SsconvertError("unsupported-feature", "Invalid retained external sheet name");
      charge(sheet.length + 1); sheets.push(sheet);
    }
    const previousBook = books.get(retained.workbook);
    if (previousBook?.sheets.length && sheets.length && JSON.stringify(previousBook.sheets) !== JSON.stringify(sheets))
      throw new SsconvertError("unsupported-feature", "Conflicting retained external sheet order");
    const names = previousBook?.names ?? new Map<string, ExternalNameDefinition>();
    for (const value of retained.names) {
      if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.name !== "string" || !value.name ||
        typeof value.expression !== "string" || !value.expression || value.sheet !== undefined && typeof value.sheet !== "string")
        throw new SsconvertError("unsupported-feature", "Invalid retained external name definition");
      const definition: ExternalNameDefinition = { name: value.name, expression: value.expression, ...(typeof value.sheet === "string" ? { sheet: value.sheet } : {}) };
      charge(definition.name.length + definition.expression.length + (definition.sheet?.length ?? 0));
      const key = externalNameKey(definition.name, definition.sheet), previous = names.get(key);
      if (previous && previous.expression !== definition.expression)
        throw new SsconvertError("unsupported-feature", "Conflicting retained external name definitions");
      names.set(key, definition);
    }
    books.set(retained.workbook, { sheets: sheets.length ? sheets : previousBook?.sheets ?? [], names });
  }
  return books;
}
