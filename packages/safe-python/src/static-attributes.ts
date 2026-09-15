import type { Expression } from "./ast.js";
import type { Statement } from "./statement-ast.js";
import type { SymbolScope } from "./symbol-collection.js";
import { statementChildren } from "./statement-children.js";
import type {SourceMeter} from "./source.js";

/** Collect Python 3.14 compiler static-attribute names. Only ordinary Store
 * targets with a literal `self` receiver count; augmented assignment emits a
 * separate opcode path and does not count. The owning class is the nearest class
 * on the enclosing code stack, excluding the current code unit. Inlined
 * comprehensions do not push a code unit. Type expressions are intentionally
 * absent. Results retain unmangled normalized names, sorted by Unicode code point.
 */
export function collectStaticAttributes(root: SymbolScope,meter?:SourceMeter): ReadonlyMap<SymbolScope, readonly string[]> {
  meter?.checkpoint(1,160);
  try {
  const collected = new Map<SymbolScope, Set<string>>();
  const work: { scope: SymbolScope; owner?: SymbolScope; nearest?: SymbolScope }[] = [{ scope: root }];
  while (work.length) {
    meter?.checkpoint();
    const { scope, owner, nearest } = work.pop()!;
    if (scope.kind === "class") {meter?.checkpoint(0,96);collected.set(scope, new Set());}
    const currentNearest = scope.kind === "class" ? scope : nearest;
    for (let index = scope.children.length - 1; index >= 0; index--) {
      meter?.checkpoint(1,64);
      const child = scope.children[index], node = child.node;
      const inlined = node.kind === "dictionary-comprehension" || node.kind === "comprehension" && node.collection !== "generator";
      work.push({ scope: child, owner: inlined ? owner : currentNearest, nearest: currentNearest });
    }
    const names = owner === undefined ? undefined : collected.get(owner)!;
    meter?.checkpoint(0,64);const targets: Expression[] = [], statements: Statement[] = [];
    const node = scope.node;
    if (node.kind === "module" || node.kind === "function" || node.kind === "class") {
      for(const statement of node.body){meter?.checkpoint(1,8);statements.push(statement);}
    }
    else if (node.kind === "comprehension" || node.kind === "dictionary-comprehension") {
      for (const clause of node.clauses) {meter?.checkpoint(1,8);targets.push(clause.target);}
    }
    while (statements.length) {
      meter?.checkpoint();
      const statement = statements.pop()!;
      if (statement.kind === "assignment") for(const target of statement.targets){meter?.checkpoint(1,8);targets.push(target);}
      else if (statement.kind === "annotated-assignment" && statement.value !== null) {meter?.checkpoint(0,8);targets.push(statement.target);}
      else if (statement.kind === "for") {meter?.checkpoint(0,8);targets.push(statement.target);}
      else if (statement.kind === "with") for (const item of statement.items) {meter?.checkpoint();if (item.target) {meter?.checkpoint(0,8);targets.push(item.target);} }
      if (statement.kind !== "function" && statement.kind !== "class")
        {meter?.checkpoint(0,128);for (const child of statementChildren(statement,meter)) {meter?.checkpoint(1,8);statements.push(child);}}
    }
    // Expression-level attribute stores occur only in comprehension targets;
    // their scopes (including header/default expressions) already have work items.
    while (targets.length) {
      meter?.checkpoint();
      const target = targets.pop()!;
      if (target.kind === "attribute" && target.object.kind === "name" && target.object.name === "self" && names) {
        meter?.checkpoint(target.name.length);if(!names.has(target.name))meter?.checkpoint(0,32);names.add(target.name);
      }
      else if (target.kind === "tuple" || target.kind === "list")
        for (const item of target.items) {meter?.checkpoint(1,8);targets.push(item.kind === "unpack" ? item.value : item);}
    }
  }
  meter?.checkpoint(0,64);const result = new Map<SymbolScope, readonly string[]>();
  for (const [scope, names] of collected) {
    meter?.checkpoint(1+names.size,128+16*names.size);
    result.set(scope, [...names].sort((left,right)=>compareNames(left,right,meter)));
  }
  return result;
  } finally {meter?.checkpoint();}
}

function compareNames(left: string, right: string,meter?:SourceMeter): number {
  meter?.checkpoint();
  let a = 0, b = 0;
  while (a < left.length && b < right.length) {
    meter?.checkpoint();
    const x = left.codePointAt(a)!, y = right.codePointAt(b)!;
    if (x !== y) return x - y;
    a += x > 0xffff ? 2 : 1; b += y > 0xffff ? 2 : 1;
  }
  return left.length - a - (right.length - b);
}
