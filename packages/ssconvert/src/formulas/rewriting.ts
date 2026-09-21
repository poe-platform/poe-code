import { SsconvertError } from "../contracts.js";
import type { FormulaDocument, FormulaNode, ParsePosition, ReferenceEndpoint } from "./ast.js";
import { serializeReference, quoteFormulaString } from "./serialization.js";

export function visitFormula(node: FormulaNode, visitor: (node: FormulaNode) => void): void {
  visitor(node);
  if (node.kind === "unary" || node.kind === "parentheses") visitFormula(node.child, visitor);
  else if (node.kind === "binary") { visitFormula(node.left, visitor); visitFormula(node.right, visitor); }
  else if (node.kind === "call") for (const child of node.args) visitFormula(child, visitor);
  else if (node.kind === "array") for (const row of node.rows) for (const child of row) visitFormula(child, visitor);
}

export interface ReferenceRewrite {
  readonly position?: ParsePosition;
  /** copy: relative axes travel with the formula; move: keep their original targets. */
  readonly translation?: "copy" | "move";
  readonly sheets?: ReadonlyMap<string, string>;
  /** An explicit structural edit may replace individual reference endpoints. */
  readonly endpoint?: (reference: ReferenceEndpoint, position: ParsePosition) => ReferenceEndpoint;
  readonly signal?: AbortSignal;
}

/** Only reference tokens change; strings, unknown functions and other source bytes survive. */
export function rewriteReferences(document: FormulaDocument, edit: ReferenceRewrite): string {
  const changes: { start: number; end: number; text: string }[] = [];
  const lexicalReferences = new Set<string>();
  const target = edit.position ?? document.position;
  const endpoint = (ref: ReferenceEndpoint): ReferenceEndpoint => {
    let next: ReferenceEndpoint = ref;
    if (ref.workbook === undefined && ref.sheet && edit.sheets?.has(ref.sheet)) next = { ...ref, sheet: edit.sheets.get(ref.sheet)! };
    if (edit.translation === "move") for (const kind of ["row", "column"] as const) {
      const axis = next[kind];
      if (axis?.relative) next = { ...next, [kind]: { ...axis, value: axis.value + document.position[kind] - target[kind] } };
    }
    return ref.workbook === undefined ? edit.endpoint?.(next, document.position) ?? next : next;
  };
  visitFormula(document.root, node => {
    edit.signal?.throwIfAborted();
    if (node.kind === "reference" || node.kind === "name") {
      const token = `${node.start}:${node.end}`;
      if (lexicalReferences.has(token)) return;
      lexicalReferences.add(token);
    }
    if (node.kind === "reference") {
      const first = endpoint(node.first), last = node.last ? endpoint(node.last) : undefined;
      // External references still translate during a copy, but are never renamed locally.
      const unchanged = JSON.stringify(first) === JSON.stringify(node.first) && JSON.stringify(last) === JSON.stringify(node.last) &&
        target.row === document.position.row && target.column === document.position.column;
      if (!unchanged) changes.push({ start: node.start, end: node.end, text: serializeReference(first, last, document.grammar,
        { ...target, sheet: document.sheetNames?.[target.sheet] ?? target.sheet }) });
    } else if (node.kind === "name" && node.workbook === undefined && node.sheet && edit.sheets?.has(node.sheet)) {
      const text = quoteFormulaString(edit.sheets.get(node.sheet)!, "'", document.grammar) + document.grammar.sheetSeparator + node.name;
      changes.push({ start: node.start, end: node.end, text: document.grammar.bracketReferences ? "[" + text + "]" : text });
    }
  });
  let result = document.source;
  for (const change of changes.sort((a, b) => b.start - a.start)) {
    if (change.start < 0 || change.end < change.start || change.end > document.source.length) throw new SsconvertError("invalid-request", "Invalid formula span");
    result = result.slice(0, change.start) + change.text + result.slice(change.end);
  }
  return result;
}
