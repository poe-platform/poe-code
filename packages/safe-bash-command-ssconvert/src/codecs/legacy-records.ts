import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { Cell, Workbook } from "../workbook.js";
import type { FormulaGrammar, ParsePosition } from "../formulas/ast.js";
import { parseExpression } from "../formulas/parser.js";
import { gnumericGrammar } from "../formulas/conventions.js";
import { quoteNativeSheet, serializeExpression } from "../formulas/serialization.js";

export function legacyCells(context: CapabilityContext, name: string) {
  const cells = new Map<string, Cell>();
  return {
    cells,
    put(cell: Cell) {
      context.signal.throwIfAborted();
      const key = `${cell.row}:${cell.column}`;
      if (!cells.has(key) && cells.size >= context.limits.cells)
        throw new SsconvertError("resource-limit", `ssconvert ${name} cells limit exceeded`);
      cells.set(key, cell);
    },
    finish() { return [...cells.values()].sort((a, b) => a.row - b.row || a.column - b.column); }
  };
}

export function legacyExpression(source: string, grammar: FormulaGrammar, position: ParsePosition,
  context: CapabilityContext, workbook?: Workbook) {
  const parsed = parseExpression(source, { grammar, position, ...(workbook ? { workbook } : {}), signal: context.signal,
    maximumLength: context.limits.inputBytes, maximumNodes: context.limits.operations });
  if (!parsed.ok) return parsed;
  return { ...parsed, formula: serializeExpression(parsed.document, { ...gnumericGrammar, quoteSheetName: quoteNativeSheet }, false, true) };
}

export function asciiLetter(c: string | undefined): boolean {
  return c !== undefined && (c >= "A" && c <= "Z" || c >= "a" && c <= "z");
}
export function asciiDigit(c: string | undefined): boolean { return c !== undefined && c >= "0" && c <= "9"; }

export function legacyCoordinate(source: string, rowBase: number, maxLetters = 2) {
  let at = 0, column = 0;
  while (asciiLetter(source[at]) && at < maxLetters) column = column * 26 + source[at++]!.toUpperCase().charCodeAt(0) - 64;
  const start = at;
  while (asciiDigit(source[at])) at++;
  if (!column || start === at) return undefined;
  const row = Number(source.slice(start, at)) - rowBase;
  return Number.isSafeInteger(row) && row >= 0 ? { row, column: column - 1, end: at } : undefined;
}

export function probeSignature(bytes: Uint8Array, signature: string, context: CapabilityContext): boolean {
  context.signal.throwIfAborted();
  return bytes.length >= signature.length && [...signature].every((c, i) => bytes[i] === c.charCodeAt(0));
}
