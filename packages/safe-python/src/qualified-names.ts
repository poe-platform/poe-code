import type { SymbolScope } from "./symbol-collection.js";
import { manglePrivateName } from "./private-names.js";

type CodeParent = { scope: SymbolScope; name: string; globals: ReadonlySet<string> };

/** Compile lexical code names from validated scopes, independent of runtime
 * rebinding. Python 3.14 list/set/dict comprehensions are inlined and therefore
 * have no code-name entry; their children belong to the containing code scope.
 * Generator expressions retain a code scope. Ignored type syntax creates none.
 * Returned names use normalized source spelling, not private storage mangling.
 */
export function collectQualifiedNames(root: SymbolScope): ReadonlyMap<SymbolScope, string> {
  const names = new Map<SymbolScope, string>();
  const work: { scope: SymbolScope; parent?: CodeParent }[] = [{ scope: root }];
  while (work.length) {
    const { scope, parent } = work.pop()!;
    const node = scope.node;
    const inlined = node.kind === "dictionary-comprehension" || node.kind === "comprehension" && node.collection !== "generator";
    let current = parent;
    if (!inlined) {
      const own = node.kind === "class" || node.kind === "function" ? node.name.name
        : node.kind === "lambda" ? "<lambda>" : node.kind === "comprehension" ? "<genexpr>" : "<module>";
      const forcedGlobal = parent !== undefined && (node.kind === "class" || node.kind === "function")
        && parent.globals.has(manglePrivateName(own, parent.scope.privateName));
      const prefix = parent === undefined || parent.scope.kind === "module" || forcedGlobal ? ""
        : parent.name + (parent.scope.kind === "function" || parent.scope.kind === "lambda" ? ".<locals>." : ".");
      const name = prefix + own;
      names.set(scope, name);
      const globals = new Set<string>();
      for (const event of scope.events) if (event.kind === "global") globals.add(event.name);
      current = { scope, name, globals };
    }
    for (let index = scope.children.length - 1; index >= 0; index--) work.push({ scope: scope.children[index], parent: current });
  }
  return names;
}
