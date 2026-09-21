import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { DEFAULT_SHEET_SIZE, MAX_SHEET_SIZE, parseA1, snapshotWorkbook, type SheetSize, type Workbook } from "../workbook.js";
import { validSheetSize } from "./model.js";
import { foldSheetName } from "./case-fold.js";
import type { ReferenceEndpoint } from "../formulas/ast.js";
import { rewriteReferences, visitFormula } from "../formulas/rewriting.js";
import { rewriteWorkbook } from "../formulas/workbook.js";
import { resizeRetainedRecords } from "./resize-records.js";

/** gnm_sheet_suggest_size starts at defaults, then doubles each axis independently. */
export function suggestSheetSize(size: SheetSize): SheetSize {
  let { rows, columns } = DEFAULT_SHEET_SIZE;
  while (columns < size.columns && columns < MAX_SHEET_SIZE.columns) columns *= 2;
  while (rows < size.rows && rows < MAX_SHEET_SIZE.rows) rows *= 2;
  return { rows, columns };
}

/** sscanf("%dx%d"): the literal x is case sensitive and a trailing suffix is accepted. */
export function parseResize(text: string): { rows: number; columns: number } | undefined {
  let offset = 0;
  function integer(): number | undefined {
    while (" \t\n\r\f\v".includes(text[offset] ?? "\0")) offset++;
    const start = offset;
    if (text[offset] === "+" || text[offset] === "-") offset++;
    const digits = offset;
    while (text[offset] !== undefined && text[offset]! >= "0" && text[offset]! <= "9") offset++;
    if (digits === offset) return undefined;
    const value = Number(text.slice(start, offset));
    if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647)
      throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: overflowing resize integer");
    return value;
  }
  const rows = integer();
  if (rows === undefined || text[offset++] !== "x") return undefined;
  const columns = integer();
  return columns === undefined ? undefined : { rows, columns };
}


/** Gnumeric deletes disappearing rows/columns: intersecting ranges shorten; removed cells become #REF!. */
export function resizeWorkbookReferences(book: Workbook, sheetId: string, size: SheetSize, context: CapabilityContext): Workbook {
  context.signal.throwIfAborted();
  book = snapshotWorkbook(book, context.limits);
  const sheet = book.sheets.find(s => s.id === sheetId);
  if (!sheet || !validSheetSize(size)) throw new SsconvertError("invalid-request", "Invalid sheet size");
  const oldSize = sheet.size ?? DEFAULT_SHEET_SIZE;
  if (size.rows === oldSize.rows && size.columns === oldSize.columns) return book;
  const shrinking = size.rows < oldSize.rows || size.columns < oldSize.columns;
  const retained = snapshotWorkbook({ ...book, sheets: book.sheets.map(s => {
    if (s.id !== sheetId) return s;
    for (const merge of s.merges ?? [])
      if (merge.startRow < size.rows && merge.startColumn < size.columns && (merge.endRow >= size.rows || merge.endColumn >= size.columns))
        throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: resize splits merge");
    for (const group of s.formulaGroups ?? [])
      // Columns disappear first, before an array in disappearing rows can be removed.
      if (group.kind === "array" && group.range.startColumn < size.columns &&
        (size.columns < oldSize.columns && group.range.endColumn >= size.columns ||
          size.rows < oldSize.rows && group.range.startRow < size.rows && group.range.endRow >= size.rows))
        throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: resize formula group");
    return { ...s, cells: s.cells.filter(cell => cell.row < size.rows && cell.column < size.columns),
      ...(s.formulaGroups ? { formulaGroups: s.formulaGroups.filter(group => group.range.startRow < size.rows && group.range.startColumn < size.columns).map(group => ({ ...group, range: { ...group.range, endRow: Math.min(group.range.endRow, size.rows - 1), endColumn: Math.min(group.range.endColumn, size.columns - 1) } })) } : {}) };
  }) }, context.limits);
  const rewritten = shrinking ? rewriteWorkbook(retained, context, (document, namedExpression) => {
    const replacements = new Map<ReferenceEndpoint, ReferenceEndpoint>();
    visitFormula(document.root, node => {
      if (node.kind !== "reference" || node.first.workbook !== undefined || node.last?.workbook !== undefined) return;
      const first = node.first, last = node.last ?? first;
      const name = (ref: ReferenceEndpoint) => ref.sheet ?? retained.sheets.find(s => s.id === document.position.sheet)?.name;
      if (name(first) === undefined || name(last) === undefined || foldSheetName(name(first)!) !== foldSheetName(name(last)!)) return; // reloc_range explicitly ignores 3D ranges
      if (name(first) === undefined || foldSheetName(name(first)!) !== foldSheetName(sheet.name)) return;
      let a = first, b = last;
      let removed = false;
      for (const axis of ["row", "column"] as const) {
        const maximum = axis === "row" ? size.rows : size.columns;
        const av = a[axis], bv = b[axis]; if (!av || !bv) continue;
        const x = namedExpression && av.relative ? 0 : av.value + (av.relative ? document.position[axis] : 0);
        const y = namedExpression && bv.relative ? 0 : bv.value + (bv.relative ? document.position[axis] : 0);
        const oldMaximum = axis === "row" ? oldSize.rows : oldSize.columns;
        if (maximum >= oldMaximum) continue;
        const entirelyRemoved = Math.min(x, y) >= maximum;
        removed ||= entirelyRemoved;
        const clipped = (value: typeof av, coordinate: number) => namedExpression && value.relative && !entirelyRemoved ? value : ({ ...value,
          value: entirelyRemoved ? -1 : Math.min(coordinate, maximum - 1) - (value.relative ? document.position[axis] : 0),
          relative: entirelyRemoved ? false : value.relative });
        a = { ...a, [axis]: clipped(av, x) }; b = { ...b, [axis]: clipped(bv, y) };
      }
      if (removed) {
        // A deleted reference becomes an error expression, without its former sheet qualifier.
        const { sheet: ignoredFirstSheet, ...unqualifiedFirst } = a;
        const { sheet: ignoredLastSheet, ...unqualifiedLast } = b;
        a = unqualifiedFirst; b = unqualifiedLast;
      } else if (namedExpression) {
        // Named expressions ignore relative axes during deletion. Gnumeric prints
        // those coordinates modulo the resized sheet dimensions, then orders ranges.
        for (const axis of ["row", "column"] as const) {
          const maximum = axis === "row" ? size.rows : size.columns;
          const wrap = (ref: ReferenceEndpoint): ReferenceEndpoint => {
            const value = ref[axis];
            if (!value?.relative) return ref;
            const coordinate = value.value + document.position[axis];
            return { ...ref, [axis]: { ...value, value: ((coordinate % maximum) + maximum) % maximum - document.position[axis] } };
          };
          a = wrap(a); b = wrap(b);
          const av = a[axis], bv = b[axis];
          if (node.last && av && bv && av.value + (av.relative ? document.position[axis] : 0) > bv.value + (bv.relative ? document.position[axis] : 0)) {
            a = { ...a, [axis]: bv }; b = { ...b, [axis]: av };
          }
        }
      }
      replacements.set(first, a); replacements.set(last, b);
    });
    return rewriteReferences(document, { signal: context.signal, endpoint: ref => replacements.get(ref) ?? ref });
  }) : retained;
  const { dependencies: ignoredDependencies, ...uncached } = rewritten;
  return snapshotWorkbook({ ...uncached,
    ...(rewritten.detachedSheets ? { detachedSheets: rewritten.detachedSheets.map(s => ({ ...s,
      cells: s.cells.map(cell => cell.formula === undefined ? cell : { ...cell, formulaDirty: true }) })) } : {}),
    sheets: rewritten.sheets.map(s => ({ ...s,
    ...(s.id === sheetId ? { size: { ...size },
      ...(typeof s.view?.selection === "string" && (parseA1(s.view.selection).row >= size.rows || parseA1(s.view.selection).column >= size.columns)
        ? { view: { ...s.view, selection: "A1" } } : {}),
      ...((s.unsupportedRecords || sheet.cells.some(cell => cell.style || cell.format)) ? { unsupportedRecords: resizeRetainedRecords({ ...s, cells: sheet.cells }, oldSize, size, context) } : {}),
      ...(s.rows ? { rows: s.rows.filter(row => row.index < size.rows) } : {}),
      ...(s.columns ? { columns: s.columns.filter(column => column.index < size.columns) } : {}),
      ...(s.merges ? { merges: s.merges.filter(merge => merge.startRow < size.rows && merge.startColumn < size.columns) } : {}) } : {}),
    cells: s.cells.map(cell => cell.formula === undefined ? cell : { ...cell, formulaDirty: true }) })) }, context.limits);
}
