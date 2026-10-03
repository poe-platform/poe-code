import { SsconvertError } from "../contracts.js";
import { resolveName, type NamedExpression, type Sheet, type Workbook } from "@poe-code/spreadsheet-ast";
import { foldSheetName } from "@poe-code/spreadsheet-ast/case-fold";
import type { Axis, FormulaNode, NameRelocation, ParsePosition, ReferenceEndpoint } from "./ast.js";

/** Resolve a live name's sheet transform without losing identities after a tab move. */
export function relocatedNameSheet(book: Workbook, source: string, relocation: NameRelocation, tick: () => void): Sheet | undefined {
  const entry = Object.entries(relocation.sheetMapping ?? {}).find(([name]) => { tick(); return foldSheetName(name) === foldSheetName(source); });
  const mapped = entry ? entry[1] : source;
  if (mapped === null) return undefined;
  const index = book.sheets.findIndex(sheet => { tick(); return foldSheetName(sheet.name) === foldSheetName(mapped); });
  return index < 0 ? undefined : book.sheets[index + relocation.sheet];
}

/** Parse relative offsets at the declaration anchor and bind nested names there.
 * References and functions in the resulting expression still use the caller's
 * evaluation position, as in native expr_name_eval. */
export function parseNamedExpression(
  name: NamedExpression,
  book: Workbook,
  parse: (source: string, position: ParsePosition, arrayStringLiterals?: boolean) => FormulaNode,
  tick: () => void,
  maximumDepth = Infinity,
  relocation?: NameRelocation
): FormulaNode {
  if (name.expression === "" || name.expression === "=") {
    tick();
    return { kind: "literal", value: { kind: "blank" }, start: 0, end: 0 };
  }
  const position = name.position ?? { sheet: name.sheet ?? book.sheets[0]?.id ?? "", row: 0, column: 0 };
  function displace(ref: ReferenceEndpoint, fallback?: string): ReferenceEndpoint | undefined {
    if (!relocation || ref.workbook !== undefined) return ref;
    const origin = book.sheets.findIndex(sheet => sheet.id === position.sheet);
    const index = ref.sheetRelative ? origin + (ref.sheetOffset ?? 0) : ref.sheet !== undefined || fallback !== undefined
      ? book.sheets.findIndex(sheet => foldSheetName(sheet.name) === foldSheetName(ref.sheet ?? fallback!)) : origin;
    const source = book.sheets[index];
    const target = source ? relocatedNameSheet(book, source.name, relocation, tick) : undefined;
    if (!target) return undefined;
    const axis = (value: Axis, key: "row" | "column") => ({ value: value.value + (value.relative ? position[key] : 0) + relocation[key], relative: false });
    return { ...ref, sheet: target.name, sheetRelative: false, ...(ref.row ? { row: axis(ref.row, "row") } : {}), ...(ref.column ? { column: axis(ref.column, "column") } : {}) };
  }
  function bind(node: FormulaNode, depth = 0): FormulaNode {
    tick();
    if (depth > maximumDepth) throw new SsconvertError("resource-limit", "ssconvert formula dependency depth limit exceeded");
    if (node.kind === "reference" && relocation) {
      const first = displace(node.first), last = node.last ? displace(node.last, node.first.sheet) : undefined;
      if (!first || node.last && !last) return { kind: "literal", value: { kind: "error", value: "#REF!" }, start: node.start, end: node.end };
      return { ...node, first, ...(last ? { last } : {}) };
    }
    if (node.kind === "name" && (node.workbook === undefined || node.workbook === "")) {
      const inherited = relocation ? { ...relocation,
        row: relocation.row + (node.relocation?.row ?? 0), column: relocation.column + (node.relocation?.column ?? 0),
        sheet: relocation.sheet + (node.relocation?.sheet ?? 0),
        ...(node.relocation && (relocation.sheetMapping || node.relocation.sheetMapping) ? {
          sheet: 0, sheetMapping: Object.fromEntries(book.sheets.map(source => {
            tick();
            const inner = relocatedNameSheet(book, source.name, node.relocation!, tick);
            return [source.name, inner ? relocatedNameSheet(book, inner.name, relocation, tick)?.name ?? null : null];
          }))
        } : {}) } : node.relocation;
      const bound = inherited ? { ...node, relocation: inherited } : node;
      if (node.workbook === "" && node.sheet === undefined) return bound;
      const scope = node.sheet === undefined ? name.sheet : book.sheets.find(sheet => foldSheetName(sheet.name) === foldSheetName(node.sheet!))?.id;
      // Preserve an unresolved qualifier so it cannot bind to a global name.
      if (node.sheet !== undefined && scope === undefined) return bound;
      const target = resolveName(book, node.name, scope);
      if (target?.sheet === undefined) {
        const { sheet: ignoredSheet, ...global } = bound;
        return { ...global, workbook: "" };
      }
      const sheet = book.sheets.find(sheet => sheet.id === target.sheet);
      return sheet ? { ...bound, sheet: sheet.name } : bound;
    }
    if (node.kind === "parentheses" || node.kind === "unary") return { ...node, child: bind(node.child, depth + 1) };
    if (node.kind === "binary") return { ...node, left: bind(node.left, depth + 1), right: bind(node.right, depth + 1) };
    if (node.kind === "call") return { ...node, args: node.args.map(child => bind(child, depth + 1)) };
    if (node.kind === "array") return { ...node, rows: node.rows.map(row => row.map(child => bind(child, depth + 1))) };
    return node;
  }
  return bind(parse(name.expression, position, name.arrayStringLiterals));
}
