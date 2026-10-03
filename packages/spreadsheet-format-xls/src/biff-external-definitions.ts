import { externalNameKey } from "@poe-code/spreadsheet-engine/codecs/external-name-definitions";
import { serializeReference } from "@poe-code/spreadsheet-engine/formulas/serialization";
import { gnumericGrammar } from "@poe-code/spreadsheet-engine/formulas/conventions";
import { biffErrors } from "./biff-formulas.js";
import { SsconvertError, type CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { UnsupportedRecord, Workbook } from "@poe-code/spreadsheet-ast";

export interface RetainedExternalName {
  readonly sheets: readonly string[];
  readonly tokens: Uint8Array;
  readonly record?: UnsupportedRecord;
}

/** Definitions remain transport metadata; resolving a name still requires the host. */
export function retainedBiffExternalNames(book: Workbook, context: CapabilityContext): Map<string, Map<string, RetainedExternalName>> {
  const books = new Map<string, Map<string, RetainedExternalName>>();
  let work = 0;
  const charge = (amount: number) => {
    context.signal.throwIfAborted(); work += amount;
    if (work > (context.limits.workbookWork ?? context.limits.outputBytes * 8))
      throw new SsconvertError("resource-limit", "ssconvert BIFF external definition work limit exceeded");
  };
  function invalid(): never { throw new SsconvertError("unsupported-feature", "Invalid retained BIFF external name definition"); }
  for (const record of book.unsupportedRecords ?? []) {
    charge(1);
    if (record.source !== "biff" || !record.data || typeof record.data !== "object" || Array.isArray(record.data)) continue;
    const value = (record.data as Readonly<Record<string, unknown>>).externalNameDefinition;
    if (value === undefined) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    const data = value as Readonly<Record<string, unknown>>;
    if (typeof data.workbook !== "string" || !data.workbook || typeof data.name !== "string" || !data.name ||
      data.scope !== undefined && typeof data.scope !== "string" || !Array.isArray(data.sheets) || typeof data.tokens !== "string") invalid();
    charge(data.workbook.length + data.name.length + data.sheets.length + data.tokens.length);
    if (data.sheets.length >= 0xfffe) invalid();
    const sheets: string[] = [], seen = new Set<string>();
    for (const sheet of data.sheets) {
      if (typeof sheet !== "string" || !sheet || sheet.length > 31) invalid();
      charge(sheet.length);
      if (seen.has(sheet)) invalid();
      seen.add(sheet);
      sheets.push(sheet);
    }
    if (![4, 18, 26].includes(data.tokens.length)) invalid();
    const tokens = new Uint8Array(data.tokens.length / 2), hex = "0123456789abcdef";
    for (let i = 0; i < tokens.length; i++) {
      const high = hex.indexOf(data.tokens[i * 2]!), low = hex.indexOf(data.tokens[i * 2 + 1]!);
      if (high < 0 || low < 0) invalid(); tokens[i] = high * 16 + low;
    }
    if (!(tokens[0] === 0x1c && tokens.length === 2 || tokens[0] === 0x3a && tokens.length === 9 || tokens[0] === 0x3b && tokens.length === 13)) invalid();
    if (tokens[0] !== 0x1c) {
      const view = new DataView(tokens.buffer);
      if (view.getUint16(1, true) >= sheets.length || view.getUint16(3, true) >= sheets.length) invalid();
    }
    if (data.scope !== undefined && !sheets.includes(data.scope as string)) invalid();
    const names = books.get(data.workbook) ?? new Map<string, RetainedExternalName>();
    const first = names.values().next().value;
    if (first && JSON.stringify(first.sheets) !== JSON.stringify(sheets))
      throw new SsconvertError("unsupported-feature", "Conflicting retained BIFF external sheet order");
    const key = externalNameKey(data.name, data.scope as string | undefined), previous = names.get(key);
    if (previous && (JSON.stringify(previous.sheets) !== JSON.stringify(sheets) ||
      previous.tokens.length !== tokens.length || previous.tokens.some((byte, index) => byte !== tokens[index])))
      throw new SsconvertError("unsupported-feature", "Conflicting retained BIFF external name definitions");
    names.set(key, { sheets, tokens, record }); books.set(data.workbook, names);
  }
  return books;
}

/** BIFF external definitions have direct SUPBOOK sheet indexes, not cell-formula indexes. */
export function biffExternalNameExpression(tokens: Uint8Array, workbook: string, sheets: readonly string[]): string | undefined {
  if (tokens[0] === 0x1c && tokens.length === 2) return biffErrors[tokens[1]!] === undefined ? undefined : "=" + biffErrors[tokens[1]!];
  const area = tokens[0] === 0x3b;
  if (!(tokens[0] === 0x3a && tokens.length === 9 || area && tokens.length === 13)) return undefined;
  const view = new DataView(tokens.buffer, tokens.byteOffset, tokens.byteLength);
  const firstSheet = sheets[view.getUint16(1, true)], lastSheet = sheets[view.getUint16(3, true)];
  const firstRow = view.getUint16(5, true), lastRow = area ? view.getUint16(7, true) : firstRow;
  const firstColumn = view.getUint16(area ? 9 : 7, true), lastColumn = area ? view.getUint16(11, true) : firstColumn;
  // Relative definitions still retain their exact native tokens; portable transport is qualified for absolute endpoints.
  if (!firstSheet || !lastSheet || firstColumn > 255 || lastColumn > 255) return undefined;
  const first = { workbook, sheet: firstSheet, row: { value: firstRow, relative: false }, column: { value: firstColumn, relative: false } };
  const last = area || firstSheet !== lastSheet ? { workbook, sheet: lastSheet, row: { value: lastRow, relative: false }, column: { value: lastColumn, relative: false } } : undefined;
  return "=" + serializeReference(first, last, gnumericGrammar, { sheet: firstSheet, row: 0, column: 0 });
}
