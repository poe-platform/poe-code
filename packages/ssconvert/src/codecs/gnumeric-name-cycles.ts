import type { CapabilityContext } from "../contracts.js";
import { resolveName, type NamedExpression, type Workbook } from "../workbook.js";
import { parseExpression } from "../formulas/parser.js";
import { visitFormula } from "../formulas/rewriting.js";
import { foldSheetName } from "../workbook/case-fold.js";

/** XML declarations start empty; native resolves delayed definitions in reverse source order. */
export async function rejectGnumericNameCycles(
  book: Workbook, declarations: readonly NamedExpression[], context: CapabilityContext, tick: () => void
): Promise<readonly NamedExpression[]> {
  const names = book.names ?? [], indices = new Map(names.map((name, index) => [name, index]));
  const accepted = new Map<number, readonly number[]>(), rejected = new Set<number>();
  for (let at = declarations.length - 1; at >= 0; at--) {
    tick();
    const name = declarations[at]!, index = indices.get(name)!;
    const parsed = parseExpression(name.expression, { workbook: book,
      position: name.position ?? { sheet: name.sheet ?? book.sheets[0]?.id ?? "", row: 0, column: 0 },
      signal: context.signal, maximumLength: context.limits.inputBytes,
      ...(context.limits.workbookNodes === undefined ? {} : { maximumNodes: context.limits.workbookNodes }) });
    if (!parsed.ok) continue;
    const dependencies: number[] = [];
    visitFormula(parsed.document.root, node => {
      tick();
      if (node.kind !== "name" || node.workbook !== undefined && node.workbook !== "") return;
      const scope = node.workbook === "" && node.sheet === undefined ? undefined : node.sheet === undefined ? name.sheet :
        book.sheets.find(sheet => foldSheetName(sheet.name) === foldSheetName(node.sheet!))?.id;
      if (node.sheet !== undefined && scope === undefined) return;
      const target = resolveName(book, node.name, scope);
      if (target) dependencies.push(indices.get(target)!);
    });
    const pending = [...dependencies], seen = new Set<number>();
    let cyclic = false;
    while (pending.length) {
      tick();
      const dependency = pending.pop()!;
      // Native compares the declared spelling, including across namespaces.
      if (names[dependency]!.name === name.name) { cyclic = true; break; }
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      for (const next of accepted.get(dependency) ?? []) { tick(); pending.push(next); }
    }
    if (cyclic) {
      rejected.add(index);
      const message = `Ignoring would-be circular definition of ${name.name}\n`;
      await context.diagnostic?.({ code: "gnumeric-xml", severity: "warning", message, bytes: new TextEncoder().encode(message) });
      context.signal.throwIfAborted();
    } else accepted.set(index, dependencies);
  }
  return names.map((name, index) => rejected.has(index) ? { ...name, expression: "",
    position: { sheet: name.position?.sheet ?? name.sheet ?? book.sheets[0]?.id ?? "", row: 0, column: 0 } } : name);
}
