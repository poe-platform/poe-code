import type { ClassNode } from "./parser.js";

type PrivateScope = { names: Set<string>; parent?: PrivateScope };

/** Check complete class bodies so private references may precede declarations. */
export function validatePrivateNames(root: unknown, inheritedNames?: ReadonlySet<string>): void {
  const pending: Array<{ value: unknown; scope?: PrivateScope; declaration?: boolean }> = [{
    value: root,
    scope: inheritedNames === undefined ? undefined : {names: new Set(inheritedNames)}
  }];
  while (pending.length > 0) {
    const { value, scope, declaration } = pending.pop()!;
    if (value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const entry of value) pending.push({ value: entry, scope });
      continue;
    }
    const node = value as Record<string, unknown>;
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      const klass = value as ClassNode;
      pending.push({ value: klass.superClass, scope });
      const inner: PrivateScope = { names: new Set(), parent: scope };
      const declarations = new Map<string, { kind: string; static: boolean }>();
      for (const element of klass.body.body) {
        if (element.type === "StaticBlock" || element.key.type !== "PrivateIdentifier") continue;
        const name = element.key.name;
        if (name === "constructor") throw new Error("Private name #constructor is forbidden.");
        const kind = element.type === "MethodDefinition" ? element.kind : "field";
        const previous = declarations.get(name);
        if (previous !== undefined && !(previous.static === element.static &&
            (previous.kind === "get" && kind === "set" || previous.kind === "set" && kind === "get")))
          throw new Error(`Duplicate private name #${name}.`);
        declarations.set(name, { kind: previous === undefined ? kind : "pair", static: element.static });
        inner.names.add(name);
      }
      pending.push({ value: klass.body, scope: inner });
      continue;
    }
    if (node.type === "PrivateIdentifier") {
      if (declaration) continue;
      let owner = scope;
      while (owner !== undefined && !owner.names.has(String(node.name))) owner = owner.parent;
      if (owner === undefined) throw new Error(`Undeclared private name #${String(node.name)}.`);
      continue;
    }
    if (node.type === "MemberExpression") {
      const property = node.property as Record<string, unknown>;
      if (property.type === "PrivateIdentifier" && (node.object as Record<string, unknown>).type === "Super")
        throw new Error("super cannot access a private name.");
    }
    if (node.type === "UnaryExpression" && node.operator === "delete") {
      const argument = node.argument as Record<string, unknown>;
      if (argument.type === "MemberExpression" && (argument.property as Record<string, unknown>).type === "PrivateIdentifier")
        throw new Error("Private elements cannot be deleted.");
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "span") continue;
      pending.push({ value: child, scope,
        declaration: key === "key" && (node.type === "MethodDefinition" || node.type === "PropertyDefinition") });
    }
  }
}
