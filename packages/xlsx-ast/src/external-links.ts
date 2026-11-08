import { SsconvertError } from "@poe-code/spreadsheet-engine/contracts";
import type { FormulaNode, ReferenceEndpoint } from "@poe-code/spreadsheet-engine/formulas/ast";

/** Link numbers are local to the package; only host-facing workbook identities escape it. */
export function resolveExternalLinks(root: FormulaNode, links: ReadonlyMap<string, string | undefined>, signal: AbortSignal): FormulaNode {
  const workbook = (name: string): string => {
    const numeric = name.length > 0 && [...name].every(character => character >= "0" && character <= "9");
    const key = numeric ? String(Number(name)) : name;
    if (!links.has(key)) {
      if (numeric && Number(name) > 0) throw new SsconvertError("unsupported-feature", "Unresolved XLSX external link index");
      return name;
    }
    const target = links.get(key);
    if (target === undefined) throw new SsconvertError("unsupported-feature", "Unsupported XLSX external link target");
    return target;
  };
  const endpoint = (value: ReferenceEndpoint): ReferenceEndpoint => value.workbook === undefined ? value : { ...value, workbook: workbook(value.workbook) };
  const visit = (node: FormulaNode): FormulaNode => {
    signal.throwIfAborted();
    switch (node.kind) {
      case "reference": return { ...node, first: endpoint(node.first), ...(node.last ? { last: endpoint(node.last) } : {}) };
      case "name": return node.workbook === undefined ? node : { ...node, workbook: workbook(node.workbook) };
      case "unary": case "parentheses": return { ...node, child: visit(node.child) };
      case "binary": return { ...node, left: visit(node.left), right: visit(node.right) };
      case "call": return { ...node, args: node.args.map(visit) };
      case "array": return { ...node, rows: node.rows.map(row => row.map(visit)) };
      default: return node;
    }
  };
  return links.size ? visit(root) : root;
}
