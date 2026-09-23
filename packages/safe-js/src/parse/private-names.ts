import {
  compilerElements,
  compilerEntries,
  compilerField,
  compilerIsArray
} from "./compact-module-ast.js";

type PrivateScope = { names: Set<string>; parent?: PrivateScope };

/** Check complete class bodies so private references may precede declarations. */
export function validatePrivateNames(root: unknown, inheritedNames?: ReadonlySet<string>): void {
  const pending: Array<{
    value: unknown;
    scope?: PrivateScope;
    declaration?: boolean;
  }> = [
    {
      value: root,
      scope: inheritedNames === undefined ? undefined : { names: new Set(inheritedNames) }
    }
  ];
  while (pending.length > 0) {
    const { value, scope, declaration } = pending.pop()!;
    if (value === null || typeof value !== "object") continue;
    if (compilerIsArray(value)) {
      for (const entry of compilerElements(value)) pending.push({ value: entry, scope });
      continue;
    }
    const type = compilerField(value, "type");
    if (type === "ClassDeclaration" || type === "ClassExpression") {
      pending.push({ value: compilerField(value, "superClass"), scope });
      const inner: PrivateScope = { names: new Set(), parent: scope };
      const declarations = new Map<string, { kind: string; static: boolean }>();
      const body = compilerField(value, "body");
      for (const element of compilerElements(compilerField(body, "body"))) {
        const key = compilerField(element, "key");
        if (
          compilerField(element, "type") === "StaticBlock" ||
          compilerField(key, "type") !== "PrivateIdentifier"
        )
          continue;
        const name = compilerField(key, "name") as string;
        if (name === "constructor") throw new Error("Private name #constructor is forbidden.");
        const kind =
          compilerField(element, "type") === "MethodDefinition"
            ? (compilerField(element, "kind") as string)
            : "field";
        const isStatic = compilerField(element, "static") as boolean;
        const previous = declarations.get(name);
        if (
          previous !== undefined &&
          !(
            previous.static === isStatic &&
            ((previous.kind === "get" && kind === "set") ||
              (previous.kind === "set" && kind === "get"))
          )
        )
          throw new Error(`Duplicate private name #${name}.`);
        declarations.set(name, {
          kind: previous === undefined ? kind : "pair",
          static: isStatic
        });
        inner.names.add(name);
      }
      pending.push({ value: body, scope: inner });
      continue;
    }
    if (type === "PrivateIdentifier") {
      if (declaration) continue;
      const name = String(compilerField(value, "name"));
      let owner = scope;
      while (owner !== undefined && !owner.names.has(name)) owner = owner.parent;
      if (owner === undefined) throw new Error(`Undeclared private name #${name}.`);
      continue;
    }
    if (type === "MemberExpression") {
      const property = compilerField(value, "property");
      if (
        compilerField(property, "type") === "PrivateIdentifier" &&
        compilerField(compilerField(value, "object"), "type") === "Super"
      )
        throw new Error("super cannot access a private name.");
    }
    if (type === "UnaryExpression" && compilerField(value, "operator") === "delete") {
      const argument = compilerField(value, "argument");
      if (
        compilerField(argument, "type") === "MemberExpression" &&
        compilerField(compilerField(argument, "property"), "type") === "PrivateIdentifier"
      )
        throw new Error("Private elements cannot be deleted.");
    }
    for (const [key, child] of compilerEntries(value)) {
      if (key === "span") continue;
      pending.push({
        value: child,
        scope,
        declaration: key === "key" && (type === "MethodDefinition" || type === "PropertyDefinition")
      });
    }
  }
}
