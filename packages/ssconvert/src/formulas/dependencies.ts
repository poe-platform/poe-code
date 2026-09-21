import type { Cell, NamedExpression, Sheet, Workbook } from "../workbook.js";
import type { FormulaNode, ParsePosition } from "./ast.js";
import { SsconvertError } from "../contracts.js";
import { foldSheetName } from "../workbook/case-fold.js";
import { parseExpression } from "./parser.js";
import { gnumericGrammar, sylkGrammar } from "./conventions.js";
import { binary, numeric, numericResult } from "./values.js";
import type { CellValue } from "../workbook.js";

export interface CalculationRange {
  readonly sheets: readonly Sheet[];
  readonly firstRow: number;
  readonly lastRow: number;
  readonly firstColumn: number;
  readonly lastColumn: number;
}
export interface DependencyGraph {
  readonly precedents: ReadonlyMap<Cell, ReadonlySet<Cell>>;
  readonly dependents: ReadonlyMap<Cell, ReadonlySet<Cell>>;
  readonly volatile: ReadonlySet<Cell>;
}
/** Static links include both IF branches; evaluation still visits only the selected branch. */
export function buildDependencyGraph(
  book: Workbook,
  roots: ReadonlyMap<Cell, FormulaNode>,
  resolve: (node: Extract<FormulaNode, { kind: "reference" }>, position: ParsePosition) => CalculationRange | undefined,
  parse: (source: string, position: ParsePosition) => FormulaNode,
  tick: () => void,
  onRange?: (cell: Cell, value: CalculationRange) => void
): DependencyGraph {
  const precedents = new Map<Cell, Set<Cell>>(), dependents = new Map<Cell, Set<Cell>>(), volatile = new Set<Cell>();
  const link = (cell: Cell, precedent: Cell) => {
    tick();
    let parents = precedents.get(cell); if (!parents) { parents = new Set(); precedents.set(cell, parents); } parents.add(precedent);
    let children = dependents.get(precedent); if (!children) { children = new Set(); dependents.set(precedent, children); } children.add(cell);
  };
  const range = (cell: Cell, value: CalculationRange) => {
    tick(); onRange?.(cell, value);
    for (const sheet of value.sheets) for (const precedent of sheet.cells) {
      tick();
      if (precedent.row >= value.firstRow && precedent.row <= value.lastRow && precedent.column >= value.firstColumn && precedent.column <= value.lastColumn) link(cell, precedent);
    }
  };
  function named(node: Extract<FormulaNode, { kind: "name" }>, position: ParsePosition): NamedExpression | undefined {
    if (node.workbook !== undefined) return undefined;
    const sheet = node.sheet === undefined ? position.sheet : book.sheets.find(s => foldSheetName(s.name) === foldSheetName(node.sheet!))?.id;
    const matches = (name: NamedExpression) => name.name === node.name;
    return book.names?.find(name => name.sheet === sheet && matches(name)) ?? book.names?.find(name => name.sheet === undefined && matches(name));
  }
  // Construct only statically known ranges. Never evaluate functions or acquire host authority.
  function staticScalar(node: FormulaNode | undefined, position: ParsePosition, depth = 0): CellValue | undefined {
    tick();
    if (depth > 128) throw new SsconvertError("resource-limit", "ssconvert formula dependency depth limit exceeded");
    if (node?.kind === "literal") return node.value;
    if (node?.kind === "parentheses") return staticScalar(node.child, position, depth + 1);
    if (node?.kind === "reference") {
      const value = resolve(node, position);
      if (!value || value.sheets.length !== 1 || value.firstRow !== value.lastRow || value.firstColumn !== value.lastColumn) return undefined;
      const cell = value.sheets[0]!.cells.find(cell => { tick(); return cell.row === value.firstRow && cell.column === value.firstColumn; });
      return cell?.formulaDirty ? undefined : cell?.cachedResult ?? cell?.value ?? { kind: "blank" };
    }
    if (node?.kind === "binary" && ![":", "intersection", "union"].includes(node.op)) {
      const left = staticScalar(node.left, position, depth + 1), right = staticScalar(node.right, position, depth + 1);
      return left && right ? binary(node.op, left, right) : undefined;
    }
    if (node?.kind === "unary") {
      const value = staticScalar(node.child, position, depth + 1), n = value && numeric(value);
      return n === undefined ? undefined : numericResult(node.op === "-" ? -n : node.op === "%" ? n / 100 : n);
    }
    return undefined;
  }
  function staticRanges(node: FormulaNode, position: ParsePosition, names: Set<NamedExpression>, depth: number): readonly CalculationRange[] {
    tick();
    if (depth > 128) throw new SsconvertError("resource-limit", "ssconvert formula dependency depth limit exceeded");
    if (node.kind === "reference") { const value = resolve(node, position); return value ? [value] : []; }
    if (node.kind === "parentheses") return staticRanges(node.child, position, names, depth + 1);
    if (node.kind === "name") {
      const name = named(node, position);
      if (!name || names.has(name)) return [];
      const next = name.position ?? { ...position, sheet: name.sheet ?? position.sheet };
      return staticRanges(parse(name.expression, next), next, new Set([...names, name]), depth + 1);
    }
    if (node.kind === "call" && (node.name === "IF" || node.name === "CHOOSE")) {
      const ranges: CalculationRange[] = [];
      for (const branch of node.args.slice(1, node.name === "IF" ? 3 : undefined)) for (const value of staticRanges(branch, position, names, depth + 1)) { tick(); ranges.push(value); }
      return ranges;
    }
    if (node.kind === "call" && node.name === "INDIRECT") {
      const text = staticScalar(node.args[0], position), mode = staticScalar(node.args[1], position);
      if (text?.kind !== "string" || node.args[1] && (!mode || mode.kind !== "boolean" && mode.kind !== "number")) return [];
      const a1 = !mode || (mode.kind === "boolean" || mode.kind === "number") && Boolean(mode.value);
      const parsed = parseExpression(text.value, { grammar: a1 ? gnumericGrammar : sylkGrammar, position, workbook: book });
      return parsed.ok && ["reference", "parentheses", "name"].includes(parsed.document.root.kind) ? staticRanges(parsed.document.root, position, names, depth + 1) : [];
    }
    if (node.kind === "call" && node.name === "OFFSET" && node.args[0]) {
      const number = (node: FormulaNode | undefined) => { const value = staticScalar(node, position); return value && numeric(value); };
      const row = number(node.args[1]), column = number(node.args[2]);
      const height = node.args[3] ? number(node.args[3]) : undefined, width = node.args[4] ? number(node.args[4]) : undefined;
      if (row === undefined || column === undefined || node.args[3] && height === undefined || node.args[4] && width === undefined) return [];
      return staticRanges(node.args[0], position, names, depth + 1).flatMap(value => {
        tick();
        const firstRow = value.firstRow + Math.trunc(row), firstColumn = value.firstColumn + Math.trunc(column);
        const lastRow = firstRow + (height === undefined ? value.lastRow - value.firstRow + 1 : Math.trunc(height)) - 1;
        const lastColumn = firstColumn + (width === undefined ? value.lastColumn - value.firstColumn + 1 : Math.trunc(width)) - 1;
        return firstRow >= 0 && firstColumn >= 0 && lastRow >= firstRow && lastColumn >= firstColumn ? [{ ...value, firstRow, lastRow, firstColumn, lastColumn }] : [];
      });
    }
    if (node.kind !== "binary" || node.op !== ":" && node.op !== "intersection") return [];
    const left = staticRanges(node.left, position, names, depth + 1), right = staticRanges(node.right, position, names, depth + 1), ranges: CalculationRange[] = [];
    const intersection = node.op === "intersection";
    for (const a of left) for (const b of right) {
      tick();
      if (a.sheets.length !== 1 || b.sheets.length !== 1 || a.sheets[0] !== b.sheets[0]) continue;
      const value = { sheets: a.sheets, firstRow: (intersection ? Math.max : Math.min)(a.firstRow, b.firstRow), lastRow: (intersection ? Math.min : Math.max)(a.lastRow, b.lastRow), firstColumn: (intersection ? Math.max : Math.min)(a.firstColumn, b.firstColumn), lastColumn: (intersection ? Math.min : Math.max)(a.lastColumn, b.lastColumn) };
      if (value.firstRow <= value.lastRow && value.firstColumn <= value.lastColumn) ranges.push(value);
    }
    return ranges;
  }
  function visit(cell: Cell, root: FormulaNode, position: ParsePosition, names: Set<NamedExpression>) {
    const pending = [{ node: root, position, names, depth: 1 }];
    while (pending.length) {
      const { node, position, names, depth } = pending.pop()!;
      if (depth > 128) throw new SsconvertError("resource-limit", "ssconvert formula dependency depth limit exceeded");
      tick();
      if (node.kind === "call" && ["RAND", "NOW", "TODAY"].includes(node.name)) volatile.add(cell);
      if (node.kind === "reference") { const value = resolve(node, position); if (value) range(cell, value); }
      if (node.kind === "call" && (node.name === "INDIRECT" || node.name === "OFFSET")) for (const value of staticRanges(node, position, names, depth)) range(cell, value);
      if (node.kind === "binary" && node.op === ":") for (const value of staticRanges(node, position, names, depth)) range(cell, value);
      if (node.kind === "name" && node.workbook === undefined) {
        const name = named(node, position);
        if (name && !names.has(name)) {
          const next = name.position ?? { ...position, sheet: name.sheet ?? position.sheet };
          pending.push({ node: parse(name.expression, next), position: next, names: new Set([...names, name]), depth: depth + 1 });
        }
      }
      const children = node.kind === "unary" || node.kind === "parentheses" ? [node.child] : node.kind === "binary" ? [node.left, node.right] : node.kind === "call" ? node.args : node.kind === "array" ? node.rows.flat() : [];
      for (let index = children.length - 1; index >= 0; index--) pending.push({ node: children[index]!, position, names, depth: depth + 1 });
    }
  }
  for (const sheet of book.sheets) for (const cell of sheet.cells) {
    tick(); const root = roots.get(cell); if (!root) continue;
    const group = sheet.formulaGroups?.find(g => g.id === cell.formulaGroup && g.kind === "array");
    const table = root.kind === "call" && root.name === "TABLE";
    if (!table) visit(cell, root, { sheet: sheet.id, row: group?.range.startRow ?? cell.row, column: group?.range.startColumn ?? cell.column }, new Set());
    // gnumeric_table_link dynamically links the row and column headers.
    if (group && table && group.range.startRow > 0 && group.range.startColumn > 0) {
      range(cell, { sheets: [sheet], firstRow: group.range.startRow - 1, lastRow: group.range.startRow - 1,
        firstColumn: group.range.startColumn, lastColumn: group.range.endColumn });
      range(cell, { sheets: [sheet], firstRow: group.range.startRow, lastRow: group.range.endRow,
        firstColumn: group.range.startColumn - 1, lastColumn: group.range.startColumn - 1 });
    }
    for (const declared of book.dependencies ?? []) {
      tick(); const dependent = declared.dependent;
      if (dependent.sheet !== sheet.id || cell.row < dependent.startRow || cell.row > dependent.endRow || cell.column < dependent.startColumn || cell.column > dependent.endColumn) continue;
      const precedent = declared.precedent, first = book.sheets.findIndex(s => s.id === precedent.sheet), last = book.sheets.findIndex(s => s.id === (precedent.endSheet ?? precedent.sheet));
      if (first >= 0 && last >= 0) range(cell, { sheets: book.sheets.slice(Math.min(first, last), Math.max(first, last) + 1), firstRow: precedent.startRow, lastRow: precedent.endRow, firstColumn: precedent.startColumn, lastColumn: precedent.endColumn });
    }
  }
  return { precedents, dependents, volatile };
}
