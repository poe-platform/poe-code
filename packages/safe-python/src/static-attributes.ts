import type { Expression } from "./ast.js";
import type { Statement } from "./statement-ast.js";
import type { SymbolScope } from "./symbol-collection.js";
import { statementChildren } from "./statement-children.js";

/** Collect Python 3.14 compiler static-attribute names. Only ordinary Store
 * targets with a literal `self` receiver count; augmented assignment emits a
 * separate opcode path and does not count. The owning class is the nearest class
 * on the enclosing code stack, excluding the current code unit. Inlined
 * comprehensions do not push a code unit. Type expressions are intentionally
 * absent. Results retain unmangled normalized names, sorted by Unicode code point.
 */
export function collectStaticAttributes(root: SymbolScope): ReadonlyMap<SymbolScope, readonly string[]> {
  const collected = new Map<SymbolScope, Set<string>>();
  const work: { scope: SymbolScope; owner?: SymbolScope; nearest?: SymbolScope }[] = [{ scope: root }];
  while (work.length) {
    const { scope, owner, nearest } = work.pop()!;
    if (scope.kind === "class") collected.set(scope, new Set());
    const currentNearest = scope.kind === "class" ? scope : nearest;
    for (let index = scope.children.length - 1; index >= 0; index--) {
      const child = scope.children[index], node = child.node;
      const inlined = node.kind === "dictionary-comprehension" || node.kind === "comprehension" && node.collection !== "generator";
      work.push({ scope: child, owner: inlined ? owner : currentNearest, nearest: currentNearest });
    }
    const names = owner === undefined ? undefined : collected.get(owner)!;
    const targets: Expression[] = [], statements: Statement[] = [];
    const node = scope.node;
    if (node.kind === "module" || node.kind === "function" || node.kind === "class") statements.push(...node.body);
    else if (node.kind === "comprehension" || node.kind === "dictionary-comprehension") {
      for (const clause of node.clauses) targets.push(clause.target);
    }
    while (statements.length) {
      const statement = statements.pop()!;
      if (statement.kind === "assignment") targets.push(...statement.targets);
      else if (statement.kind === "annotated-assignment" && statement.value !== null) targets.push(statement.target);
      else if (statement.kind === "for") targets.push(statement.target);
      else if (statement.kind === "with") for (const item of statement.items) { if (item.target) targets.push(item.target); }
      if (statement.kind !== "function" && statement.kind !== "class")
        for (const child of statementChildren(statement)) statements.push(child);
    }
    // Expression-level attribute stores occur only in comprehension targets;
    // their scopes (including header/default expressions) already have work items.
    while (targets.length) {
      const target = targets.pop()!;
      if (target.kind === "attribute" && target.object.kind === "name" && target.object.name === "self") names?.add(target.name);
      else if (target.kind === "tuple" || target.kind === "list")
        for (const item of target.items) targets.push(item.kind === "unpack" ? item.value : item);
    }
  }
  const result = new Map<SymbolScope, readonly string[]>();
  for (const [scope, names] of collected) result.set(scope, [...names].sort(compareNames));
  return result;
}

function compareNames(left: string, right: string): number {
  let a = 0, b = 0;
  while (a < left.length && b < right.length) {
    const x = left.codePointAt(a)!, y = right.codePointAt(b)!;
    if (x !== y) return x - y;
    a += x > 0xffff ? 2 : 1; b += y > 0xffff ? 2 : 1;
  }
  return left.length - a - (right.length - b);
}
