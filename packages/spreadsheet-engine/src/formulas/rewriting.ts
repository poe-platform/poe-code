import { SsconvertError } from "../contracts.js";
import { foldSheetName } from "@poe-code/spreadsheet-ast/case-fold";
import type { FormulaDocument, FormulaNode, ParsePosition, ReferenceEndpoint } from "./ast.js";
import { serializeExpression, serializeReference, serializeLabelReference, quoteFormulaString } from "./serialization.js";

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
  /** Display name -> new name, falling back to a captured workbook sheet ID. */
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
  const sheetIds = new Map(Object.entries(document.sheetNames ?? {}).map(([id, name]) => [foldSheetName(name), id]));
  const requested = edit.position ?? document.position;
  const target = { ...requested, sheet: document.sheetNames && Object.hasOwn(document.sheetNames, requested.sheet)
    ? requested.sheet : sheetIds.get(foldSheetName(requested.sheet)) ?? requested.sheet };
  const renamedSheet = (name: string): string | undefined => {
    const id = sheetIds.get(foldSheetName(name));
    return edit.sheets?.get(name) ?? (id === undefined ? undefined : edit.sheets?.get(id));
  };
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
    const renamed = next.workbook === undefined && next.sheet ? renamedSheet(next.sheet) : undefined;
    if (renamed !== undefined) next = { ...next, sheet: renamed };
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
      let unchanged = true;
      const rewrite = (ref: ReferenceEndpoint): ReferenceEndpoint => {
        const next = endpoint(ref);
        // A1 spells resolved coordinates; R1C1 spells offsets. Compare at the
        // original anchor so moving a formula alone does not change A1 spelling.
        let comparable = next;
        if (document.grammar.address === "a1") for (const kind of ["row", "column"] as const) {
          const axis = next[kind];
          if (axis?.relative) comparable = { ...comparable, [kind]: { ...axis, value: axis.value + target[kind] - document.position[kind] } };
        }
        if (JSON.stringify(comparable) !== JSON.stringify(ref)) unchanged = false;
        return next;
      };
      const first = rewrite(node.first), last = node.last ? rewrite(node.last) : undefined;
      // The parent replacement includes its explicit area's source span.
      if (node.label?.kind === "radical") {
        if (node.label.data) absorbedReferences.add(node.label.data);
        for (const ref of node.label.preceding ?? []) absorbedReferences.add(ref);
      }
      const label = node.label?.kind === "radical" ? { ...node.label,
        ...(node.label.preceding ? { preceding: node.label.preceding.map(ref => ({ ...ref, first: rewrite(ref.first) })) } : {}),
        data: node.label.data ? { ...node.label.data, first: rewrite(node.label.data.first), last: rewrite(node.label.data.last) } : null } : node.label;
      if (!unchanged) {
        const position = { ...target, sheet: document.sheetNames?.[target.sheet] ?? target.sheet };
        changes.push({ start: node.start, end: node.end, text: label
          ? serializeLabelReference({ ...node, first, ...(last ? { last } : {}), label }, document.grammar, position)
          : serializeReference(first, last, document.grammar, position) });
      }
    } else if (node.kind === "name" && node.relocation && edit.translation === "copy") {
      const relocation = { ...node.relocation };
      if (relocation.relative) {
        relocation.row += target.row - document.position.row;
        relocation.column += target.column - document.position.column;
      }
      if (relocation.sheetRelative !== false && target.sheet !== document.position.sheet) {
        const origin = document.sheetOrder?.indexOf(document.position.sheet) ?? -1;
        const destination = document.sheetOrder?.indexOf(target.sheet) ?? -1;
        if (origin < 0 || destination < 0) throw new SsconvertError("invalid-request", "Cross-sheet formula copy requires workbook tab order");
        relocation.sheet += destination - origin;
      }
      if (![relocation.row, relocation.column, relocation.sheet].every(Number.isSafeInteger))
        throw new SsconvertError("invalid-request", "Invalid live name displacement");
      const text = serializeExpression({ ...document, root: { ...node, relocation } }, document.grammar, false).slice(document.grammar.prefixes[0]?.length ?? 0);
      changes.push({ start: node.start, end: node.end, text });
    } else if (node.kind === "name" && (node.workbook === undefined || node.workbook === "") && node.sheet && renamedSheet(node.sheet) !== undefined) {
      const text = quoteFormulaString(renamedSheet(node.sheet)!, "'", document.grammar) + document.grammar.sheetSeparator + node.name;
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
