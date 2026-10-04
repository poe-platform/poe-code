import type { CapabilityContext } from "../contracts.js";
import { resolveName, type NamedExpression, type Workbook } from "../workbook.js";
import { parseExpression } from "../formulas/parser.js";
import type { FormulaNode } from "../formulas/ast.js";
import { createGnumericNameGraph } from "./gnumeric-name-graph.js";
import { foldSheetName } from "../workbook/case-fold.js";

/** XML declarations start empty; native resolves delayed definitions in reverse source order. */
export async function rejectGnumericNameCycles(
  book: Workbook, declarations: readonly NamedExpression[], context: CapabilityContext, tick: () => void
): Promise<readonly NamedExpression[]> {
  const names = book.names ?? [], indices = new Map(names.map((name, index) => [name, index]));
  const accepted = new Map<number, readonly number[]>(), rejected = new Set<number>();
  const graph = context.createWorkingStorage ? createGnumericNameGraph(context) : undefined;
  for (let at = declarations.length - 1; at >= 0; at--) {
    tick();
    const name = declarations[at]!, index = indices.get(name)!;
    const parsed = parseExpression(name.expression, { maximumDepth: context.limits.formulaDepth, workbook: book,
      position: name.position ?? { sheet: name.sheet ?? book.sheets[0]?.id ?? "", row: 0, column: 0 },
      signal: context.signal, maximumLength: context.limits.inputBytes,
      ...(context.limits.workbookNodes === undefined ? {} : { maximumNodes: context.limits.workbookNodes }) });
    if (!parsed.ok) continue;
    function* references(node: FormulaNode): Generator<number> {
      tick();
      if (node.kind === "name" && (node.workbook === undefined || node.workbook === "")) {
        const scope = node.workbook === "" && node.sheet === undefined ? undefined : node.sheet === undefined ? name.sheet :
          book.sheets.find(sheet => foldSheetName(sheet.name) === foldSheetName(node.sheet!))?.id;
        if (node.sheet === undefined || scope !== undefined) {
          const target = resolveName(book, node.name, scope);
          if (target) yield indices.get(target)!;
        }
      }
      if (node.kind === "unary" || node.kind === "parentheses") yield* references(node.child);
      else if (node.kind === "binary") { yield* references(node.left); yield* references(node.right); }
      else if (node.kind === "call") for (const child of node.args) yield* references(child);
      else if (node.kind === "array") for (const row of node.rows) for (const child of row) yield* references(child);
      else if (node.kind === "reference" && node.label?.kind === "radical") {
        for (const ref of node.label.preceding ?? []) yield* references(ref);
        if (node.label.data) yield* references(node.label.data);
      }
    }
    const dependencies: number[] = [], pending: number[] = [], seen = new Set<number>();
    const list = graph?.list(); graph?.reset();
    for (const dependency of references(parsed.document.root)) {
      if (graph) { await list!.append(dependency); await graph.push(dependency); }
      else { dependencies.push(dependency); pending.push(dependency); }
    }
    let cyclic = false;
    while (true) {
      const dependency = graph ? await graph.pop() : pending.pop();
      if (dependency === undefined) break;
      tick();
      // Native compares the declared spelling, including across namespaces.
      if (names[dependency]!.name === name.name) { cyclic = true; break; }
      if (graph ? await graph.seen(dependency, at + 1) : seen.has(dependency)) continue;
      if (!graph) seen.add(dependency);
      for await (const next of graph ? graph.dependencies(dependency) : accepted.get(dependency) ?? []) {
        tick(); if (graph) await graph.push(next); else pending.push(next);
      }
    }
    if (cyclic) {
      if (graph) await graph.reject(index); else rejected.add(index);
      const message = `Ignoring would-be circular definition of ${name.name}\n`;
      await context.diagnostic?.({ code: "gnumeric-xml", severity: "warning", message, bytes: new TextEncoder().encode(message) });
      context.signal.throwIfAborted();
    } else if (graph) await graph.accept(index, list!.head); else accepted.set(index, dependencies);
  }
  const result: NamedExpression[] = [];
  for (const [index, name] of names.entries()) result.push((graph ? await graph.rejected(index) : rejected.has(index)) ? { ...name, expression: "",
    position: { sheet: name.position?.sheet ?? name.sheet ?? book.sheets[0]?.id ?? "", row: 0, column: 0 } } : name);
  return result;
}
