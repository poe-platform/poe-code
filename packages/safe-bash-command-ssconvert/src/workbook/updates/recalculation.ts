import { SsconvertError, type CapabilityContext } from "../../contracts.js";
import { snapshotWorkbook, type Cell, type CellRange, type Workbook } from "../../workbook.js";
import { parseExpression } from "../../formulas/parser.js";
import type { FormulaNode, ParsePosition } from "../../formulas/ast.js";
import { buildDependencyGraph } from "../../formulas/dependencies.js";
import { localReferenceRange } from "../../formulas/local-references.js";

function budget(context: CapabilityContext): () => void {
  let work = 0;
  const maximum = context.limits.workbookWork ?? context.limits.cells * 32 + context.limits.inputBytes;
  return () => {
    context.signal.throwIfAborted();
    if (++work > maximum) throw new SsconvertError("resource-limit", "ssconvert workbook work limit exceeded");
  };
}
/** Queue dependents without invalidating the original value/cache. */
export function dirtyWorkbook(book: Workbook, changes: readonly CellRange[], context: CapabilityContext): Workbook {
  if (!changes.length) return book;
  const tick = budget(context);
  book = snapshotWorkbook(book, context.limits);
  const dirty = new Set<Cell>();
  function parse(source: string, position: ParsePosition, arrayStringLiterals = false): FormulaNode {
    tick();
    const parsed = parseExpression(source, { position, arrayStringLiterals, workbook: book, signal: context.signal,
      maximumLength: context.limits.inputBytes, maximumNodes: context.limits.workbookWork ?? context.limits.cells * 32 + context.limits.inputBytes });
    if (!parsed.ok) throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: formula syntax at ${parsed.diagnostic.start}:${parsed.diagnostic.end}`);
    return parsed.document.root;
  }
  const roots = new Map<Cell, FormulaNode>();
  for (const sheet of book.sheets) for (const cell of sheet.cells) {
    tick();
    const group = sheet.formulaGroups?.find(group => group.id === cell.formulaGroup && group.kind === "array");
    const source = cell.formula ?? group?.expression;
    if (!source) continue;
    roots.set(cell, parse(source, { sheet: sheet.id, row: group?.range.startRow ?? cell.row, column: group?.range.startColumn ?? cell.column }, cell.arrayStringLiterals ?? group?.arrayStringLiterals));
    if (cell.formulaDirty) dirty.add(cell);
  }
  const graph = buildDependencyGraph(book, roots, (node, position) => localReferenceRange(book, node, position), parse, tick, (cell, range) => {
    for (const sheet of range.sheets) for (const change of changes) {
      tick();
      if (change.sheet === sheet.id && change.startRow <= range.lastRow && change.endRow >= range.firstRow &&
        change.startColumn <= range.lastColumn && change.endColumn >= range.firstColumn) dirty.add(cell);
    }
  });
  const queue = [...dirty];
  for (let index = 0; index < queue.length; index++) for (const dependent of graph.dependents.get(queue[index]!) ?? []) {
    tick();
    if (!dirty.has(dependent)) { dirty.add(dependent); queue.push(dependent); }
  }
  return snapshotWorkbook({ ...book, sheets: book.sheets.map(sheet => ({ ...sheet,
    cells: sheet.cells.map(cell => dirty.has(cell) ? { ...cell, formulaDirty: true } : cell) })) }, context.limits);
}

export { recalculateWorkbook } from "../../formulas/evaluator.js";
