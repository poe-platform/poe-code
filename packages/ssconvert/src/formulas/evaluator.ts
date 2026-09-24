import { functionDescriptors } from "./function-descriptors.js";
import { snapshotRuntimeFunctions } from "./runtime-functions.js";
import { SsconvertError, type CapabilityContext, type Diagnostic } from "../contracts.js";
import { MAX_SHEET_SIZE, snapshotWorkbook, type Cell, type CellValue, type Sheet, type Workbook } from "../workbook.js";
import { foldSheetName } from "../workbook/case-fold.js";
import type { FormulaNode, ParsePosition } from "./ast.js";
import { parseExpression } from "./parser.js";
import { buildDependencyGraph, type CalculationRange } from "./dependencies.js";
import { parseNamedExpression } from "./named-expressions.js";
import { localReferenceRange } from "./local-references.js";
import { translateFormulaGroup } from "./workbook.js";
import { binary, blank, difference, error, numeric, numericResult, product, sum } from "./values.js";
import { snapshotRecords } from "../workbook/model.js";
import type { ExternalFormulaRequest } from "../formulas.js";
import type { Reference, Matrix, Value, FunctionHost } from "./functions/types.js";
import { callFunction } from "./functions/registry.js";
import { matchNumber } from "./functions/text.js";
import { gnumericGrammar, sylkGrammar } from "./conventions.js";

/** A calculation run owns its indexes, traversal state and caches. No host I/O. */
export function recalculateWorkbook(input: Workbook, context: CapabilityContext, force = false, onDiagnostic?: (diagnostic: Diagnostic) => void,
  cellEvaluation?: { readonly changed: ParsePosition; readonly target: ParsePosition | null; readonly tick?: () => void }): Workbook {
  context.signal.throwIfAborted();
  if (context.runtimeFunctions !== undefined) context = { ...context, runtimeFunctions: snapshotRuntimeFunctions(context.runtimeFunctions) };
  input = snapshotWorkbook(input, context.limits);
  if (!force && !cellEvaluation && input.calculationMode === "manual") return input;
  const maximumWork = context.limits.workbookWork ?? context.limits.cells * 32 + context.limits.inputBytes;
  let work = 0, depth = 0, iterationRoot: Cell | undefined;
  const tick = () => {
    context.signal.throwIfAborted();
    cellEvaluation?.tick?.();
    if (++work > maximumWork) throw new SsconvertError("resource-limit", "ssconvert workbook work limit exceeded");
  };
  // Imported groups can describe cells absent from sparse storage. Admit before allocation.
  let cellCount = input.sheets.reduce((sum, sheet) => sum + sheet.cells.length, 0);
  const originals = new Map(input.sheets.map(sheet => [sheet.id, new Map(sheet.cells.map(cell => [`${cell.row}:${cell.column}`, cell]))]));
  const book: Workbook = { ...input, sheets: input.sheets.map(sheet => {
    const cells = new Map(sheet.cells.map(cell => [`${cell.row}:${cell.column}`, cell]));
    for (const group of sheet.formulaGroups ?? []) {
      const dirty = force || sheet.cells.some(cell => cell.formulaGroup === group.id && cell.formulaDirty);
      if (!dirty && !sheet.cells.some(cell => cell.formulaGroup === group.id && cell.formula)) continue;
      const area = (group.range.endRow - group.range.startRow + 1) * (group.range.endColumn - group.range.startColumn + 1);
      if (area > context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert formula group limit exceeded");
      for (let row = group.range.startRow; row <= group.range.endRow; row++) for (let column = group.range.startColumn; column <= group.range.endColumn; column++) {
        tick(); const key = `${row}:${column}`, previous = cells.get(key);
        if (!previous && ++cellCount > context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert formula group limit exceeded");
        cells.set(key, { ...previous, row, column, value: previous?.value ?? blank, formulaGroup: group.id,
          formula: group.kind === "shared" ? translateFormulaGroup(group, { sheet: sheet.id, row, column }, context) : group.expression,
          formulaDirty: dirty });
      }
    }
    return { ...sheet, cells: [...cells.values()] };
  }) };
  const indexes = new Map<Sheet, Map<string, Cell>>();
  const fetchedCells = new Set<Cell>();
  for (const sheet of [...book.sheets, ...book.detachedSheets ?? []]) indexes.set(sheet, new Map(sheet.cells.map(cell => [`${cell.row}:${cell.column}`, cell])));
  const results = new Map<Cell, CellValue>(), visiting = new Set<Cell>(), iterated = new Set<Cell>();
  const functionEmptyValues = new WeakSet<Value>();
  const cleared = new Set<Cell>(), tablePending = new Set<Cell>();
  const arrayKeys = new Map<Cell, string>();
  const expressions = new Map<Cell, FormulaNode>(), matrices = new Map<string, Value>();
  let activeCell: Cell | undefined;
  const dynamicCells = new Set<Cell>(), dynamicRanges = new Map<Cell, Map<string, CalculationRange>>();
  function trackRange(value: Value): void {
    if (!activeCell || value.kind !== "range") return;
    tick();
    let ranges = dynamicRanges.get(activeCell);
    if (!ranges) { ranges = new Map(); dynamicRanges.set(activeCell, ranges); }
    const key = JSON.stringify([value.sheets.map(sheet => sheet.id), value.firstRow, value.lastRow, value.firstColumn, value.lastColumn]);
    ranges.set(key, value);
  }
  function parse(source: string, position: ParsePosition): FormulaNode {
    tick();
    const parsed = parseExpression(source, { position, workbook: book, signal: context.signal, maximumLength: context.limits.inputBytes, maximumNodes: maximumWork - work });
    if (!parsed.ok) throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: formula syntax at ${parsed.diagnostic.start}:${parsed.diagnostic.end}`);
    return parsed.document.root;
  }
  for (const sheet of book.sheets) for (const cell of sheet.cells) {
    tick();
    if (!cell.formula) continue;
    const group = sheet.formulaGroups?.find(group => group.id === cell.formulaGroup && group.kind === "array");
    if (group) arrayKeys.set(cell, `${sheet.id}:${group.id}`);
    const root = parse(cell.formula, { sheet: sheet.id, row: group?.range.startRow ?? cell.row, column: group?.range.startColumn ?? cell.column });
    expressions.set(cell, root);
  }
  function read(sheet: Sheet, row: number, column: number): CellValue {
    tick(); const cell = indexes.get(sheet)?.get(`${row}:${column}`);
    return cell ? calculate(cell, sheet) : blank;
  }
  function external(request: ExternalFormulaRequest): Value {
    tick();
    if (!context.externalReferences) return error("#REF!");
    const result = context.externalReferences.resolve(snapshotRecords(request, context.limits), context.signal);
    tick();
    if (result === undefined) return error("#REF!");
    const owned = snapshotRecords(result, context.limits);
    if (owned === null || typeof owned !== "object") throw new SsconvertError("invalid-request", "Invalid ssconvert external formula result");
    const rows = owned.kind === "array" ? owned.rows : [[owned]];
    if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(rows[0]) || rows[0].length === 0)
      throw new SsconvertError("invalid-request", "Invalid ssconvert external formula array");
    const columns = rows[0].length;
    if (rows.length * columns > context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert calculation array limit exceeded");
    const cells: Cell[] = [];
    for (let row = 0; row < rows.length; row++) {
      if (!Array.isArray(rows[row]) || rows[row]!.length !== columns)
        throw new SsconvertError("invalid-request", "Invalid ssconvert external formula array");
      for (let column = 0; column < columns; column++) { tick(); cells.push({ row, column, value: rows[row]![column]! }); }
    }
    const admitted = snapshotWorkbook({ sheets: [{ id: "external", name: "External", size: MAX_SHEET_SIZE, cells }] }, context.limits).sheets[0]!.cells;
    if (owned.kind !== "array") return admitted[0]!.value;
    return { kind: "matrix", rows: rows.map((row, index) =>
      row.map((_: unknown, column: number) => admitted[index * columns + column]!.value)) };
  }
  function reference(node: Extract<FormulaNode, { kind: "reference" }>, position: ParsePosition): Value {
    const first = node.first, last = node.last ?? first;
    // External references never initiate host/file/network access.
    if (first.workbook !== undefined || last.workbook !== undefined) return external({ kind: "reference", first,
      ...(node.last ? { last: node.last } : {}), position });
    const range = localReferenceRange(book, node, position);
    return range ? { kind: "range", ...range } : error("#REF!");
  }
  function indirectRange(node: FormulaNode, position: ParsePosition, names: Set<object>, depth = 0): Value {
    tick();
    if (depth > 128) throw new SsconvertError("resource-limit", "ssconvert formula dependency depth limit exceeded");
    if (node.kind === "reference") return reference(node, position);
    if (node.kind === "parentheses") return indirectRange(node.child, position, names, depth + 1);
    if (node.kind !== "name" || node.workbook !== undefined && node.workbook !== "") return error("#REF!");
    const sheet = node.workbook === "" && node.sheet === undefined ? undefined : node.sheet === undefined ? position.sheet : book.sheets.find(sheet => foldSheetName(sheet.name) === foldSheetName(node.sheet!))?.id;
    const matches = (entry: NonNullable<Workbook["names"]>[number]) => entry.name === node.name;
    const name = book.names?.find(entry => entry.sheet === sheet && matches(entry)) ?? book.names?.find(entry => entry.sheet === undefined && matches(entry));
    if (!name || names.has(name)) return error("#REF!");
    return indirectRange(parseNamedExpression(name, book, parse, tick), position, new Set([...names, name]), depth + 1);
  }
  function scalar(value: Value, position: ParsePosition): CellValue {
    if (value.kind === "matrix") return value.rows[0]?.[0] ?? error("#VALUE!");
    if (value.kind === "set") return error("#VALUE!");
    if (value.kind !== "range") return value;
    if (value.sheets.length !== 1) return error("#VALUE!");
    let row = position.row, column = position.column;
    if (value.firstRow === value.lastRow && value.firstColumn === value.lastColumn) { row = value.firstRow; column = value.firstColumn; }
    else if (value.firstRow === value.lastRow && column >= value.firstColumn && column <= value.lastColumn) row = value.firstRow;
    else if (value.firstColumn === value.lastColumn && row >= value.firstRow && row <= value.lastRow) column = value.firstColumn;
    else return error("#VALUE!");
    return read(value.sheets[0]!, row, column);
  }
  function matrix(value: Value): Matrix {
    if (value.kind === "matrix") return value;
    if (value.kind !== "range") return { kind: "matrix", rows: [[value.kind === "set" ? error("#VALUE!") : value]] };
    const area = value.sheets.length * (value.lastRow - value.firstRow + 1) * (value.lastColumn - value.firstColumn + 1);
    if (area > context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert calculation range limit exceeded");
    const rows: CellValue[][] = [];
    for (const sheet of value.sheets) for (let row = value.firstRow; row <= value.lastRow; row++) {
      const values: CellValue[] = [];
      for (let column = value.firstColumn; column <= value.lastColumn; column++) values.push(read(sheet, row, column));
      rows.push(values);
    }
    return { kind: "matrix", rows };
  }
  function mapBinary(op: string, a: Value, b: Value, position: ParsePosition, array: boolean): Value {
    const admission = { tick, maximum: context.limits.outputBytes };
    if (!array || a.kind !== "range" && a.kind !== "matrix" && b.kind !== "range" && b.kind !== "matrix") return binary(op, scalar(a, position), scalar(b, position), admission);
    const x = matrix(a), y = matrix(b);
    const dimension = (a: number, b: number) => a === 1 ? b : b === 1 ? a : Math.min(a, b);
    const rows = dimension(x.rows.length, y.rows.length), columns = dimension(x.rows[0]?.length ?? 0, y.rows[0]?.length ?? 0);
    if (rows * columns > context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert calculation array limit exceeded");
    const at = (v: Matrix, r: number, c: number) => v.rows[v.rows.length === 1 ? 0 : r]?.[(v.rows[0]?.length ?? 0) === 1 ? 0 : c] ?? error("#N/A");
    return { kind: "matrix", rows: Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => { tick(); return binary(op, at(x, r, c), at(y, r, c), admission); })) };
  }
  function evaluate(node: FormulaNode, position: ParsePosition, array = false, names = new Set<object>(), wantReference = true): Value {
    tick();
    if (++depth > 128) { depth--; throw new SsconvertError("resource-limit", "ssconvert formula dependency depth limit exceeded"); }
    try {
      if (node.kind === "literal") return node.value;
      if (node.kind === "omitted") return blank;
      if (node.kind === "reference") {
        const value = reference(node, position);
        return !wantReference && !node.last && node.first.row && node.first.column ? scalar(value, position) : value;
      }
      if (node.kind === "parentheses") return evaluate(node.child, position, array, names, wantReference);
      if (node.kind === "array") return { kind: "matrix", rows: node.rows.map(row => row.map(child => scalar(evaluate(child, position, array, names), position))) };
      if (node.kind === "name") {
        if (node.workbook !== undefined && node.workbook !== "") return external({ kind: "name", workbook: node.workbook, name: node.name,
          ...(node.sheet !== undefined ? { sheet: node.sheet } : {}), position });
        const sheet = node.workbook === "" && node.sheet === undefined ? undefined : node.sheet === undefined ? position.sheet : book.sheets.find(s => foldSheetName(s.name) === foldSheetName(node.sheet!))?.id;
        const matches = (entry: NonNullable<Workbook["names"]>[number]) => entry.name === node.name;
        const name = book.names?.find(entry => entry.sheet === sheet && matches(entry)) ?? book.names?.find(entry => entry.sheet === undefined && matches(entry));
        if (!name || names.has(name)) return error("#NAME?");
        return evaluate(parseNamedExpression(name, book, parse, tick), position, array, new Set([...names, name]), wantReference);
      }
      if (node.kind === "unary") {
        const apply = (value: CellValue) => {
          if (value.kind === "error" || node.op === "+") return value;
          const n = numeric(value); return n === undefined ? error("#VALUE!") : numericResult(node.op === "-" ? -n : n / 100);
        };
        const v = evaluate(node.child, position, array, names);
        return array && (v.kind === "range" || v.kind === "matrix") ? { kind: "matrix", rows: matrix(v).rows.map(row => row.map(apply)) } : apply(scalar(v, position));
      }
      if (node.kind === "binary") {
        const a = evaluate(node.left, position, array, names, node.op === "union" ? wantReference : true);
        if (node.op === "union") {
          const b = evaluate(node.right, position, array, names, wantReference);
          if (wantReference) return { kind: "set", values: [a, b] };
          const rows: CellValue[][] = [];
          const collect = (value: Value) => {
            if (value.kind === "matrix") { for (const row of value.rows) rows.push([...row]); }
            else { const cell = scalar(value, position); rows.push([cell.kind === "blank" ? numericResult(0) : cell]); }
          };
          collect(a); collect(b); return { kind: "matrix", rows };
        }
        if (["intersection", ":"].includes(node.op)) {
          const b = evaluate(node.right, position, array, names);
          if (a.kind !== "range" || b.kind !== "range" || a.sheets.length !== 1 || b.sheets.length !== 1 || a.sheets[0] !== b.sheets[0]) return error("#VALUE!");
          const intersection = node.op === "intersection";
          const r: Reference = { kind: "range", sheets: a.sheets, firstRow: (intersection ? Math.max : Math.min)(a.firstRow, b.firstRow), lastRow: (intersection ? Math.min : Math.max)(a.lastRow, b.lastRow), firstColumn: (intersection ? Math.max : Math.min)(a.firstColumn, b.firstColumn), lastColumn: (intersection ? Math.min : Math.max)(a.lastColumn, b.lastColumn) };
          if (r.firstRow <= r.lastRow && r.firstColumn <= r.lastColumn) trackRange(r);
          return r.firstRow > r.lastRow || r.firstColumn > r.lastColumn ? error("#NULL!") : r;
        }
        // Gnumeric arithmetic rejects left text before evaluating the right expression.
        if (!array || a.kind !== "range" && a.kind !== "matrix") {
          const left = scalar(a, position);
          if (left.kind === "error") return left;
          if (["+", "-", "*", "/", "^"].includes(node.op) && numeric(left) === undefined) return error("#VALUE!");
        }
        return mapBinary(node.op, a, evaluate(node.right, position, array, names), position, array);
      }
      if (node.name === "IF") {
        if (node.args.length < 1 || node.args.length > 3) return error("#N/A");
        if (array) {
          // func.c's array path evaluates precomputed arguments before element dispatch.
          let first = evaluate(node.args[0]!, position, true, names, false);
          if (first.kind === "error") return first;
          if (first.kind === "string") {
            const text = first.value.toLowerCase();
            if (text !== "true" && text !== "false") return error("#VALUE!");
            first = { kind: "boolean", value: text === "true" };
          }
          const evaluated: Value[] = [];
          let shape: { height: number; width: number } | undefined;
          for (let index = 0; index < node.args.length; index++) {
            const value = index === 0 ? first : evaluate(node.args[index]!, position, true, names, false);
            if (value.kind === "range" || value.kind === "matrix") {
              const height = value.kind === "range" ? value.sheets.length * (value.lastRow - value.firstRow + 1) : value.rows.length;
              const width = value.kind === "range" ? value.lastColumn - value.firstColumn + 1 : value.rows[0]?.length ?? 0;
              // Precomputed function arguments require identical area dimensions;
              // unlike binary operators, even singleton array axes do not broadcast.
              if (shape && (shape.height !== height || shape.width !== width)) return error("#VALUE!");
              shape = { height, width };
            }
            evaluated.push(value);
          }
          if (evaluated.every(value => value.kind !== "range" && value.kind !== "matrix" && value.kind !== "set")) {
            const condition = scalar(evaluated[0]!, position);
            if (condition.kind === "error") return condition;
            if (condition.kind === "string" && !["true", "false"].includes(condition.value.toLowerCase())) return error("#VALUE!");
            const yes = condition.kind === "string" ? condition.value.toLowerCase() === "true" : (numeric(condition) ?? 0) !== 0;
            const branch = yes ? 1 : 2;
            return !node.args[branch] ? { kind: "boolean", value: yes } : node.args[branch]!.kind === "omitted" ? numericResult(0) : evaluated[branch]!;
          }
          const args = evaluated.map(value => matrix(value));
          const height = shape?.height ?? 1, width = shape?.width ?? 1;
          if (height * width > context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert calculation array limit exceeded");
          const at = (arg: Matrix, row: number, column: number): CellValue => arg.rows[arg.rows.length === 1 ? 0 : row]?.[(arg.rows[0]?.length ?? 0) === 1 ? 0 : column] ?? error("#N/A");
          return { kind: "matrix", rows: Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, column) => {
            tick(); const condition = at(args[0]!, row, column);
            if (condition.kind === "error") return condition;
            const number = condition.kind === "string" ? matchNumber(condition.value, { context, book, tick }) : numeric(condition);
            if (number === undefined) return error("#VALUE!");
            const yes = Number(number) !== 0;
            const branch = yes ? 1 : 2;
            if (!node.args[branch]) return { kind: "boolean", value: yes };
            if (node.args[branch]!.kind === "omitted") return numericResult(0);
            return at(args[branch]!, row, column);
          })) };
        }
        const condition = scalar(evaluate(node.args[0]!, position, false, names), position);
        if (condition.kind === "error") return condition;
        // IF's optimized scalar path ignores value_get_as_bool's text error flag.
        const yes = condition.kind === "string" ? condition.value.toLowerCase() === "true" : (numeric(condition) ?? 0) !== 0;
        const branch = yes ? 1 : 2, child = node.args[branch];
        return child === undefined ? { kind: "boolean", value: yes } : child.kind === "omitted" ? numericResult(0) : evaluate(child, position, array, names, wantReference);
      }
      if (node.name === "SUM" || node.name === "PRODUCT") {
        const values: number[] = [];
        let failure: CellValue | undefined;
        const collect = (v: Value) => {
          if (v.kind === "set") { for (const child of v.values) collect(child); return; }
          for (const row of matrix(v).rows) for (const item of row) { tick(); if (item.kind === "error") { failure ??= item; return; } if (item.kind === "number") values.push(item.value); }
        };
        for (const arg of node.args) { collect(evaluate(arg, position, array, names)); if (failure) return failure; }
        if (node.name === "SUM") return numericResult(sum(values, tick));
        return numericResult(product(values));
      }
      if (node.name === "GNUMERIC_VERSION") return node.args.length ? error("#N/A") : { kind: "string", value: "1.12.61" };
      if (node.name === "TABLE") return table(node.args, position, array);
      if (node.name === "RAND") {
        if (node.args.length) return error("#N/A");
        if (node.name === "RAND") {
          if (!context.random) throw new SsconvertError("capability-denied", "ssconvert RAND requires an explicit random source");
          const value = context.random.next(); tick();
          if (!Number.isFinite(value) || value < 0 || value >= 1) throw new SsconvertError("invalid-request", "Invalid ssconvert random result");
          return numericResult(value);
        }

      }
      const host: FunctionHost = {
        book, context, position, array, tick,
        ...(onDiagnostic === undefined ? {} : { diagnostic: onDiagnostic }),
        evaluate: (child, retainReference = wantReference, permitNonScalar = false) => evaluate(child, position, array || permitNonScalar, names, retainReference),
        scalar: value => scalar(value, position), matrix, read,
        cell: (sheet, row, column) => indexes.get(sheet)?.get(`${row}:${column}`),
        fetchCell: (sheet, row, column) => {
          tick();
          const index = indexes.get(sheet)!;
          const key = `${row}:${column}`, existing = index.get(key);
          if (existing) return existing;
          if (++cellCount > context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert calculation cell limit exceeded");
          const cell: Cell = { row, column, value: blank };
          index.set(key, cell); (sheet.cells as Cell[]).push(cell); fetchedCells.add(cell);
          return cell;
        },
        indirect: (text, a1) => {
          const parsed = parseExpression(text, { grammar: a1 ? gnumericGrammar : sylkGrammar, position, workbook: book,
            signal: context.signal, maximumLength: context.limits.inputBytes, maximumNodes: maximumWork - work });
          return parsed.ok ? indirectRange(parsed.document.root, position, new Set()) : error("#REF!");
        }
      };
      if (activeCell && ["INDIRECT", "OFFSET", "INDEX", "CHOOSE"].includes(node.name)) dynamicCells.add(activeCell);
      const result = callFunction(node.name, node.args, host);
      if (result) {
        trackRange(result);
        if (result.kind === "range" && activeCell) dynamicCells.add(activeCell);
      }
      if (result !== undefined) {
        // Native function results retain explicit empty values; cell references become zero.
        if (result.kind === "blank") {
          const owned: CellValue = { kind: "blank" };
          functionEmptyValues.add(owned);
          return owned;
        }
        if (result.kind === "matrix") functionEmptyValues.add(result);
        return result;
      }
      if (!Object.hasOwn(functionDescriptors, node.name)) return error("#NAME?");
      throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: formula function ${node.name}`);
    } finally { depth--; }
  }
  function table(args: readonly FormulaNode[], position: ParsePosition, array: boolean): Value {
    const sheet = book.sheets.find(s => s.id === position.sheet);
    const group = sheet?.formulaGroups?.find(g => g.kind === "array" && g.range.startRow === position.row && g.range.startColumn === position.column);
    if (!sheet || !group || !array || args.length !== 2 || position.row < 1 || position.column < 1) return error("#REF!");
    const inputs = args.map(arg => {
      if (arg.kind !== "reference" || arg.last || !arg.first.row || !arg.first.column) return undefined;
      // gnumeric_table fetches raw input coordinates on ep->sheet, ignoring the
      // reference's sheet/workbook qualifier. It never evaluates these arguments.
      const value = localReferenceRange(book, { ...arg, first: { row: arg.first.row, column: arg.first.column } }, position);
      if (!value) return undefined;
      const index = indexes.get(sheet)!, key = `${value.firstRow}:${value.firstColumn}`;
      let cell = index.get(key);
      if (!cell) {
        tick();
        if (++cellCount > context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert formula group limit exceeded");
        cell = { row: value.firstRow, column: value.firstColumn, value: blank }; index.set(key, cell);
      }
      return cell;
    });
    const saved = new Map(results), savedMatrices = new Map(matrices), savedCurrent = new Map(currentValues), savedCleared = new Set(cleared), savedPending = new Set(tablePending), rows: CellValue[][] = [];
    const restoreInputs = () => {
      results.clear();
      for (const [cell, value] of saved) { tick(); results.set(cell, value); }
      currentValues.clear(); for (const [cell, value] of savedCurrent) currentValues.set(cell, value);
      cleared.clear(); for (const cell of savedCleared) cleared.add(cell);
      matrices.clear(); for (const [key, value] of savedMatrices) matrices.set(key, value);
      tablePending.clear(); for (const cell of savedPending) tablePending.add(cell);
    };
    const substitute = (input: Cell, value: CellValue) => {
      const queue = [input], seen = new Set<Cell>(queue);
      const sparseDependents: Cell[] = [];
      if (!sheet.cells.includes(input)) for (const [cell, range] of dependencyRanges) {
        tick();
        if (range.sheets.includes(sheet) && input.row >= range.firstRow && input.row <= range.lastRow && input.column >= range.firstColumn && input.column <= range.lastColumn) sparseDependents.push(cell);
      }
      for (let index = 0; index < queue.length; index++) {
        tick();
        for (const dependent of [...graph.dependents.get(queue[index]!) ?? [], ...index === 0 ? sparseDependents : []]) {
          tick();
          if (seen.has(dependent) || visiting.has(dependent) || inputs.includes(dependent)) continue;
          seen.add(dependent); queue.push(dependent);
          results.delete(dependent); cleared.delete(dependent); tablePending.add(dependent);
          const key = arrayKeys.get(dependent); if (key) matrices.delete(key);
        }
      }
      results.set(input, value);
    };
    try {
      for (let row = group.range.startRow; row <= group.range.endRow; row++) rows.push(Array.from({ length: group.range.endColumn - group.range.startColumn + 1 }, () => numericResult(0)));
      for (let column = group.range.endColumn; column >= group.range.startColumn; column--) {
        tick();
        if (!indexes.get(sheet)!.has(`${position.row - 1}:${column}`)) continue;
        restoreInputs();
        const x = read(sheet, position.row - 1, column);
        for (let row = group.range.endRow; row >= group.range.startRow; row--) {
          tick();
          if (!indexes.get(sheet)!.has(`${row}:${position.column - 1}`)) continue;
          restoreInputs();
          if (inputs[0]) substitute(inputs[0], x);
          const y = read(sheet, row, position.column - 1);
          if (inputs[1]) substitute(inputs[1], y);
          const result = inputs[0] && inputs[1] ? read(sheet, position.row - 1, position.column - 1) : inputs[1] ? read(sheet, position.row - 1, column) : y;
          rows[row - position.row]![column - position.column] = result;
        }
      }
      return { kind: "matrix", rows };
    } finally {
      tablePending.clear(); for (const cell of savedPending) tablePending.add(cell);
      results.clear(); for (const [cell, value] of saved) results.set(cell, value);
      currentValues.clear(); for (const [cell, value] of savedCurrent) currentValues.set(cell, value);
      cleared.clear(); for (const cell of savedCleared) cleared.add(cell);
      matrices.clear(); for (const [key, value] of savedMatrices) matrices.set(key, value);
    }
  }
  function calculate(cell: Cell, sheet: Sheet): CellValue {
    tick();
    const cached = results.get(cell); if (cached) return cached;
    if (cleared.has(cell)) return currentValues.get(cell) ?? cell.cachedResult ?? cell.value;
    if (!cell.formula || !pending.has(cell) && !tablePending.has(cell)) return cell.cachedResult ?? cell.value;
    if (visiting.has(cell)) {
      if (book.iteration?.enabled && !iterationRoot) { iterationRoot = cell; iterated.add(cell); }
      // dependent_eval clears NEEDS_RECALC even for a recursive cycle bottom.
      cleared.add(cell);
      return currentValues.get(cell) ?? cell.cachedResult ?? cell.value;
    }
    if (visiting.size >= 128) throw new SsconvertError("resource-limit", "ssconvert formula dependency depth limit exceeded");
    visiting.add(cell);
    const previousCell = activeCell;
    activeCell = cell;
    const group = sheet.formulaGroups?.find(g => g.id === cell.formulaGroup && g.kind === "array");
    const position = { sheet: sheet.id, row: group?.range.startRow ?? cell.row, column: group?.range.startColumn ?? cell.column };
    const node = expressions.get(cell) ?? parse(cell.formula, position);
    let result: CellValue = cell.cachedResult ?? cell.value;
    try {
      let remaining = book.iteration?.maximum ?? 0;
      while (true) {
        tick();
        const key = `${sheet.id}:${group?.id ?? ""}`;
        let value = group ? matrices.get(key) : undefined;
        if (!value) { value = evaluate(node, position, Boolean(group)); if (group) matrices.set(key, value); }
        const output = group ? matrix(value) : undefined;
        const next = output ? output.rows[output.rows.length === 1 ? 0 : cell.row - position.row]?.[(output.rows[0]?.length ?? 0) === 1 ? 0 : cell.column - position.column] ?? error("#N/A") : scalar(value, position);
        const nonempty = next.kind === "blank" && (value.kind === "range" || !functionEmptyValues.has(next) && !functionEmptyValues.has(value)) ? numericResult(0) : next;
        if (iterationRoot !== cell || !iterated.has(cell)) { result = nonempty; if (iterationRoot === cell) iterationRoot = undefined; break; }
        iterated.delete(cell);
        if (remaining-- <= 0) { iterationRoot = undefined; break; }
        const tolerance = book.iteration!.tolerance;
        const converged = difference(result, nonempty) < tolerance;
        result = nonempty; results.set(cell, result);
        results.delete(cell); matrices.clear();
        if (!converged) iterationRoot = undefined;
        // A reentered cycle reads this iteration's value, independently of imported cache.
        currentValues.set(cell, result);
      }
    } finally { visiting.delete(cell); activeCell = previousCell; }
    results.set(cell, result); currentValues.set(cell, result); cleared.add(cell); return result;
  }
  const currentValues = new Map<Cell, CellValue>();
  const dependencyRanges: [Cell, CalculationRange][] = [];
  const graph = buildDependencyGraph(book, expressions, (node, position) => localReferenceRange(book, node, position), parse, tick, (cell, range) => dependencyRanges.push([cell, range]));
  const pending = new Set<Cell>();
  const queue: Cell[] = [];
  for (const cell of expressions.keys()) if (force || cell.formulaDirty || !cellEvaluation && graph.volatile.has(cell)) { pending.add(cell); queue.push(cell); }
  if (cellEvaluation) {
    const sheet = book.sheets.find(sheet => sheet.id === cellEvaluation.changed.sheet);
    const changed = sheet && indexes.get(sheet)?.get(`${cellEvaluation.changed.row}:${cellEvaluation.changed.column}`);
    if (changed) queue.push(changed);
  }
  for (let index = 0; index < queue.length; index++) for (const dependent of graph.dependents.get(queue[index]!) ?? []) {
    tick(); if (!pending.has(dependent)) { pending.add(dependent); queue.push(dependent); }
  }
  // All traversal order is invocation-local; source sheet/cell order is preserved.
  if (cellEvaluation) {
    const target = cellEvaluation.target;
    const sheet = target && book.sheets.find(sheet => sheet.id === target.sheet);
    const cell = sheet && indexes.get(sheet)?.get(`${target!.row}:${target!.column}`);
    if (cell && sheet) calculate(cell, sheet);
  } else for (const sheet of book.sheets) for (const cell of sheet.cells) calculate(cell, sheet);
  const dependencies = [...book.dependencies ?? []].filter(dependency => !dependency.dynamic || !book.sheets.some(sheet => sheet.id === dependency.dependent.sheet && sheet.cells.some(cell =>
    results.has(cell) && pending.has(cell) && cell.row >= dependency.dependent.startRow && cell.row <= dependency.dependent.endRow && cell.column >= dependency.dependent.startColumn && cell.column <= dependency.dependent.endColumn)));
  for (const sheet of book.sheets) for (const cell of sheet.cells) if (dynamicCells.has(cell)) {
    tick();
    const group = sheet.formulaGroups?.find(group => group.id === cell.formulaGroup && group.kind === "array");
    const dependent = { sheet: sheet.id, ...group?.range ?? { startRow: cell.row, endRow: cell.row, startColumn: cell.column, endColumn: cell.column } };
    for (const range of dynamicRanges.get(cell)?.values() ?? []) for (const precedent of range.sheets) {
      tick();
      dependencies.push({ dynamic: true, dependent, precedent: { sheet: precedent.id, startRow: range.firstRow, endRow: range.lastRow, startColumn: range.firstColumn, endColumn: range.lastColumn } });
    }
  }
  return snapshotWorkbook({ ...book, ...(dependencies.length || book.dependencies ? { dependencies } : {}), sheets: book.sheets.map(sheet => ({ ...sheet, cells: sheet.cells.filter(cell =>
    pending.has(cell) || fetchedCells.has(cell) || originals.get(sheet.id)!.has(`${cell.row}:${cell.column}`)).map(cell => {
    const original = originals.get(sheet.id)!.get(`${cell.row}:${cell.column}`);
    const result = results.get(cell);
    if (cellEvaluation && cell.formula && pending.has(cell) && !result) return { ...original ?? cell, formulaDirty: true };
    if (!result || !cell.formula || !pending.has(cell)) return original ?? cell;
    const { displayedText: ignoredDisplayedText, ...retained } = cell;
    return { ...retained, value: result, cachedResult: result, formulaDirty: false };
  }) })) }, context.limits);
}
