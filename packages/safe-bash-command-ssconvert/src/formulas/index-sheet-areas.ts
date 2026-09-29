import { foldSheetName } from "../workbook/case-fold.js";
import type { FormulaDocument, FormulaNode, ReferenceEndpoint } from "./ast.js";

/** Excel/Calc INDEX takes reference areas; preserve 3D spans in the source model
 * until export so sheet-relative copies can resolve at their new anchor. */
export function expandIndexSheetAreas(document: FormulaDocument, onWork: () => void): FormulaDocument {
  const order = document.sheetOrder;
  if (!order) return document;
  let ids: Map<string, number> | undefined, names: Map<string, number> | undefined;
  const sheetIndex = (endpoint: ReferenceEndpoint) => {
    if (!ids || !names) {
      ids = new Map(); names = new Map();
      for (let index = 0; index < order.length; index++) {
        onWork();
        const id = order[index]!;
        ids.set(id, index); names.set(foldSheetName(document.sheetNames?.[id] ?? id), index);
      }
    }
    const name = endpoint.sheet ?? document.position.sheet;
    return ids.get(name) ?? names.get(foldSheetName(name)) ?? -1;
  };
  const visit = (node: FormulaNode): FormulaNode => {
    onWork();
    if (node.kind === "parentheses" || node.kind === "unary") return { ...node, child: visit(node.child) };
    if (node.kind === "binary") return { ...node, left: visit(node.left), right: visit(node.right) };
    if (node.kind === "array") return { ...node, rows: node.rows.map(row => row.map(visit)) };
    if (node.kind !== "call") return node;
    const args = node.args.map(visit);
    let source = args[0];
    while (source?.kind === "parentheses") source = source.child;
    if (node.name === "INDEX" && args.length >= 1 && args.length <= 4 && source?.kind === "reference" && source.last &&
      source.first.workbook === undefined && source.last.workbook === undefined && !source.label) {
      const first = sheetIndex(source.first), last = sheetIndex(source.last);
      if (first >= 0 && last >= 0 && first !== last) {
        let areas: FormulaNode[] = [];
        for (let index = Math.min(first, last); index <= Math.max(first, last); index++) {
          onWork();
          const sheet = document.sheetNames?.[order[index]!] ?? order[index]!;
          // Keep the flags so codecs can diagnose native copy-semantics loss.
          const first = { ...source.first, sheet };
          const last = { ...source.last, sheet };
          delete first.sheetOffset; delete last.sheetOffset;
          areas.push({ ...source, first, last });
        }
        // Keep generated tree depth logarithmic even for wide workbook spans.
        while (areas.length > 1) {
          const next: FormulaNode[] = [];
          for (let index = 0; index < areas.length; index += 2) {
            onWork();
            next.push(areas[index + 1] ? { kind: "binary", op: "union", start: source.start, end: source.end,
              left: areas[index]!, right: areas[index + 1]! } : areas[index]!);
          }
          areas = next;
        }
        args[0] = { kind: "parentheses", start: source.start, end: source.end, child: areas[0]! };
      }
    }
    return { ...node, args };
  };
  return { ...document, root: visit(document.root) };
}
