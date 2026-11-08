import type { FormulaNode } from "../formulas/ast.js";

/** Preorder traversal can suspend between nodes while name state is in caller storage. */
export function* gnumericFormulaNodes(node: FormulaNode): Generator<FormulaNode> {
  yield node;
  if (node.kind === "unary" || node.kind === "parentheses") yield* gnumericFormulaNodes(node.child);
  else if (node.kind === "binary") { yield* gnumericFormulaNodes(node.left); yield* gnumericFormulaNodes(node.right); }
  else if (node.kind === "call") for (const child of node.args) yield* gnumericFormulaNodes(child);
  else if (node.kind === "array") for (const row of node.rows) for (const child of row) yield* gnumericFormulaNodes(child);
  else if (node.kind === "reference" && node.label?.kind === "radical") {
    for (const ref of node.label.preceding ?? []) yield* gnumericFormulaNodes(ref);
    if (node.label.data) yield* gnumericFormulaNodes(node.label.data);
  }
}
