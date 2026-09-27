import { SsconvertError } from "../contracts.js";
import type { FormulaDocument, FormulaNode, ParsePosition, ReferenceEndpoint } from "./ast.js";
import { serializeReference, serializeLabelReference, quoteFormulaString } from "./serialization.js";

export function visitFormula(node: FormulaNode, visitor: (node: FormulaNode) => void): void {
  visitor(node);
  if (node.kind === "unary" || node.kind === "parentheses") visitFormula(node.child, visitor);
  else if (node.kind === "binary") { visitFormula(node.left, visitor); visitFormula(node.right, visitor); }
  else if (node.kind === "call") for (const child of node.args) visitFormula(child, visitor);
  else if (node.kind === "array") for (const row of node.rows) for (const child of row) visitFormula(child, visitor);
  else if (node.kind === "reference" && node.label?.kind === "radical") {
    for (const ref of node.label.preceding ?? []) visitFormula(ref, visitor);
    if (node.label.data) visitFormula(node.label.data, visitor);
  }
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
  const absorbedReferences = new Set<FormulaNode>();
  const target = edit.position ?? document.position;
  const endpoint = (ref: ReferenceEndpoint): ReferenceEndpoint => {
    let next: ReferenceEndpoint = ref;
    if (edit.translation === "copy" && target.sheet !== document.position.sheet && ref.sheet !== undefined && ref.sheetRelative && ref.workbook === undefined) {
      const origin = document.sheetOrder?.indexOf(document.position.sheet) ?? -1;
      const destination = document.sheetOrder?.indexOf(target.sheet) ?? -1;
      if (origin < 0 || destination < 0 || ref.sheetOffset === undefined)
        throw new SsconvertError("invalid-request", "Cross-sheet formula copy requires workbook tab order");
      const id = document.sheetOrder![destination + ref.sheetOffset];
      if (id === undefined) return { row: { value: -1, relative: false }, column: { value: 0, relative: false } };
      next = { ...ref, sheet: document.sheetNames![id]! };
    }
    if (edit.translation === "move" && target.sheet !== document.position.sheet && ref.workbook === undefined && ref.sheet === undefined)
      next = { ...ref, sheet: document.sheetNames?.[document.position.sheet] ?? document.position.sheet };
    if (next.workbook === undefined && next.sheet && edit.sheets?.has(next.sheet)) next = { ...next, sheet: edit.sheets.get(next.sheet)! };
    if (edit.translation === "move") for (const kind of ["row", "column"] as const) {
      const axis = next[kind];
      if (axis?.relative) next = { ...next, [kind]: { ...axis, value: axis.value + document.position[kind] - target[kind] } };
    }
    return ref.workbook === undefined ? edit.endpoint?.(next, document.position) ?? next : next;
  };
  visitFormula(document.root, node => {
    edit.signal?.throwIfAborted();
    if (absorbedReferences.has(node)) return;
    if (node.kind === "reference" || node.kind === "name") {
      const token = `${node.start}:${node.end}`;
      if (lexicalReferences.has(token)) return;
      lexicalReferences.add(token);
    }
    if (node.kind === "reference") {
      const first = endpoint(node.first), last = node.last ? endpoint(node.last) : undefined;
      // The parent replacement includes its explicit area's source span.
      if (node.label?.kind === "radical") {
        if (node.label.data) absorbedReferences.add(node.label.data);
        for (const ref of node.label.preceding ?? []) absorbedReferences.add(ref);
      }
      const label = node.label?.kind === "radical" ? { ...node.label,
        ...(node.label.preceding ? { preceding: node.label.preceding.map(ref => ({ ...ref, first: endpoint(ref.first) })) } : {}),
        data: node.label.data ? { ...node.label.data, first: endpoint(node.label.data.first), last: endpoint(node.label.data.last) } : null } : node.label;
      // External references still translate during a copy, but are never renamed locally.
      const unchanged = JSON.stringify(first) === JSON.stringify(node.first) && JSON.stringify(last) === JSON.stringify(node.last) && JSON.stringify(label) === JSON.stringify(node.label) &&
        target.row === document.position.row && target.column === document.position.column;
      if (!unchanged) {
        const position = { ...target, sheet: document.sheetNames?.[target.sheet] ?? target.sheet };
        changes.push({ start: node.start, end: node.end, text: label
          ? serializeLabelReference({ ...node, first, ...(last ? { last } : {}), label }, document.grammar, position)
          : serializeReference(first, last, document.grammar, position) });
      }
    } else if (node.kind === "name" && (node.workbook === undefined || node.workbook === "") && node.sheet && edit.sheets?.has(node.sheet)) {
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
