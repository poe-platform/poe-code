import { SsconvertError } from "../contracts.js";
import { resolveName, type NamedExpression, type Workbook } from "../workbook.js";
import { foldSheetName } from "../workbook/case-fold.js";
import type { FormulaNode, ParsePosition } from "./ast.js";

/** Parse relative offsets at the declaration anchor and bind nested names there.
 * References and functions in the resulting expression still use the caller's
 * evaluation position, as in native expr_name_eval. */
export function parseNamedExpression(
  name: NamedExpression,
  book: Workbook,
  parse: (source: string, position: ParsePosition, arrayStringLiterals?: boolean) => FormulaNode,
  tick: () => void
): FormulaNode {
  if (name.expression === "" || name.expression === "=") {
    tick();
    return { kind: "literal", value: { kind: "blank" }, start: 0, end: 0 };
  }
  const position = name.position ?? { sheet: name.sheet ?? book.sheets[0]?.id ?? "", row: 0, column: 0 };
  function bind(node: FormulaNode, depth = 0): FormulaNode {
    tick();
    if (depth > 128) throw new SsconvertError("resource-limit", "ssconvert formula dependency depth limit exceeded");
    if (node.kind === "name" && (node.workbook === undefined || node.workbook === "" && node.sheet !== undefined)) {
      const scope = node.sheet === undefined ? name.sheet : book.sheets.find(sheet => foldSheetName(sheet.name) === foldSheetName(node.sheet!))?.id;
      const target = resolveName(book, node.name, scope);
      if (target?.sheet === undefined) return { kind: "name", name: node.name, workbook: "", start: node.start, end: node.end };
      const sheet = book.sheets.find(sheet => sheet.id === target.sheet);
      return sheet ? { ...node, sheet: sheet.name } : node;
    }
    if (node.kind === "parentheses" || node.kind === "unary") return { ...node, child: bind(node.child, depth + 1) };
    if (node.kind === "binary") return { ...node, left: bind(node.left, depth + 1), right: bind(node.right, depth + 1) };
    if (node.kind === "call") return { ...node, args: node.args.map(child => bind(child, depth + 1)) };
    if (node.kind === "array") return { ...node, rows: node.rows.map(row => row.map(child => bind(child, depth + 1))) };
    return node;
  }
  return bind(parse(name.expression, position, name.arrayStringLiterals));
}
