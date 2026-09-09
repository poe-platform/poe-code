import type { Expression, Parameter, SourceSpan } from "./ast.js";
import type { DeclaredName, Module, Statement } from "./statement-ast.js";
import type { Pattern } from "./pattern-ast.js";
import { expressionChildren } from "./expression-children.js";
import { statementExpressions } from "./statement-expressions.js";
import { manglePrivateName } from "./private-names.js";

export type SymbolEvent = SourceSpan & {
  readonly kind: "read" | "implicit-read" | "write" | "delete" | "parameter" | "global" | "nonlocal" | "annotation" | "import" | "write-outer";
  readonly name: string;
};
export type SymbolScope = {
  readonly privateName: string | null;
  readonly kind: "module" | "function" | "class" | "lambda" | "comprehension";
  readonly node: Module | Statement | Expression;
  readonly events: readonly SymbolEvent[];
  readonly children: readonly SymbolScope[];
};
type MutableScope = Omit<SymbolScope, "events" | "children"> & { events: SymbolEvent[]; children: MutableScope[] };

/** Collect lexical occurrences without resolving names or executing user code. */
export function collectSymbols(module: Module): SymbolScope {
  const root: MutableScope = { kind: "module", privateName: null, node: module, events: [], children: [] };
  function record(scope: MutableScope, kind: SymbolEvent["kind"], name: DeclaredName | (SourceSpan & { name: string })): void {
    scope.events.push({ kind, name: manglePrivateName(name.name, scope.privateName), start: name.start, end: name.end });
  }
  function child(scope: MutableScope, kind: SymbolScope["kind"], node: SymbolScope["node"]): MutableScope {
    const privateName = node.kind === "class" ? node.name.name : scope.privateName;
    const nested: MutableScope = { kind, privateName, node, events: [], children: [] };
    scope.children.push(nested);
    return nested;
  }
  function parameters(scope: MutableScope, values: readonly Parameter[]): void {
    for (const parameter of values) record(scope, "parameter", parameter);
  }
  function expression(node: Expression, scope: MutableScope, walrusScope = scope): void {
    if (node.kind === "name") {
      record(scope, "read", node);
      if (node.name === "super" && scope.kind !== "module" && scope.kind !== "class") {
        record(scope, "implicit-read", { name: "__class__", start: node.start, end: node.end });
      }
      return;
    }
    if (node.kind === "assignment-expression") {
      expression(node.value, scope, walrusScope);
      record(walrusScope, "write", node.target);
      if (scope !== walrusScope) record(scope, "write-outer", node.target);
      return;
    }
    if (node.kind === "lambda") {
      for (const parameter of node.parameters) if (parameter.default) expression(parameter.default, scope, walrusScope);
      const nested = child(scope, "lambda", node);
      parameters(nested, node.parameters);
      expression(node.body, nested);
      return;
    }
    if (node.kind === "comprehension" || node.kind === "dictionary-comprehension") {
      expression(node.clauses[0]!.iterable, scope, walrusScope);
      const nested = child(scope, "comprehension", node);
      for (let index = 0; index < node.clauses.length; index++) {
        const clause = node.clauses[index]!;
        if (index) expression(clause.iterable, nested, walrusScope);
        target(clause.target, nested, "write", walrusScope);
        for (const filter of clause.filters) expression(filter, nested, walrusScope);
      }
      if (node.kind === "comprehension") expression(node.element, nested, walrusScope);
      else { expression(node.key, nested, walrusScope); expression(node.value, nested, walrusScope); }
      return;
    }
    for (const item of expressionChildren(node)) expression(item, scope, walrusScope);
  }
  function target(node: Expression, scope: MutableScope, kind: "write" | "delete", walrusScope = scope): void {
    if (node.kind === "name") { record(scope, kind, node); return; }
    if (node.kind === "tuple" || node.kind === "list") {
      for (const item of node.items) target(item.kind === "unpack" ? item.value : item, scope, kind, walrusScope);
      return;
    }
    for (const item of expressionChildren(node)) expression(item, scope, walrusScope);
  }
  function pattern(node: Pattern, scope: MutableScope): void {
    switch (node.kind) {
      case "capture": case "star": if (node.name) record(scope, "write", node.name); return;
      case "value": case "singleton": expression(node.value, scope); return;
      case "as": pattern(node.pattern, scope); record(scope, "write", node.name); return;
      case "or": for (const alternative of node.patterns) pattern(alternative, scope); return;
      case "sequence": for (const item of node.items) pattern(item, scope); return;
      case "mapping":
        for (const entry of node.entries) { expression(entry.key, scope); pattern(entry.pattern, scope); }
        if (node.rest) record(scope, "write", node.rest);
        return;
      case "class":
        expression(node.class, scope);
        for (const item of node.positional) pattern(item, scope);
        for (const keyword of node.keywords) pattern(keyword.pattern, scope);
        return;
      default: { const exhaustive: never = node; throw new Error(`unknown pattern: ${exhaustive}`); }
    }
  }
  function statements(body: readonly Statement[], scope: MutableScope): void {
    for (const node of body) {
      switch (node.kind) {
        case "function": {
          for (const decorator of node.decorators) expression(decorator, scope);
          for (const parameter of node.parameters) if (parameter.default) expression(parameter.default, scope);
          record(scope, "write", node.name);
          const nested = child(scope, "function", node);
          parameters(nested, node.parameters);
          statements(node.body, nested);
          break;
        }
        case "class": {
          for (const decorator of node.decorators) expression(decorator, scope);
          for (const argument of node.arguments) expression(argument.value, scope);
          record(scope, "write", node.name);
          statements(node.body, child(scope, "class", node));
          break;
        }
        case "assignment":
          expression(node.value, scope);
          for (const item of node.targets) target(item, scope, "write");
          break;
        case "augmented-assignment":
          if (node.target.kind === "name") record(scope, "read", node.target);
          target(node.target, scope, "write");
          expression(node.value, scope);
          break;
        case "annotated-assignment":
          if (node.value) expression(node.value, scope);
          if (node.simple && node.target.kind === "name") record(scope, "annotation", node.target);
          else if (node.value || node.target.kind !== "name") target(node.target, scope, "write");
          break;
        case "delete": for (const item of node.targets) target(item, scope, "delete"); break;
        case "global": case "nonlocal": for (const name of node.names) record(scope, node.kind, name); break;
        case "import": case "import-from":
          if (node.imports !== "*") for (const item of node.imports) record(scope, "import", item.alias ?? item.path[0]!);
          break;
        case "for":
          expression(node.iterable, scope);
          target(node.target, scope, "write");
          statements(node.body, scope); statements(node.otherwise, scope);
          break;
        case "while": expression(node.condition, scope); statements(node.body, scope); statements(node.otherwise, scope); break;
        case "with":
          for (const item of node.items) { expression(item.context, scope); if (item.target) target(item.target, scope, "write"); }
          statements(node.body, scope);
          break;
        case "if":
          for (const branch of node.branches) { expression(branch.condition, scope); statements(branch.body, scope); }
          statements(node.otherwise, scope);
          break;
        case "match":
          expression(node.subject, scope);
          for (const clause of node.cases) { pattern(clause.pattern, scope); if (clause.guard) expression(clause.guard, scope); statements(clause.body, scope); }
          break;
        case "try":
          statements(node.body, scope);
          for (const handler of node.handlers) {
            if (handler.exception) expression(handler.exception, scope);
            if (handler.alias) record(scope, "write", handler.alias);
            statements(handler.body, scope);
          }
          statements(node.otherwise, scope); statements(node.finalizer, scope);
          break;
        case "type-alias": case "pass": case "break": case "continue": break;
        case "expression-statement": case "return": case "raise": case "assert":
          for (const item of statementExpressions(node, false)) expression(item, scope);
          break;
        default: { const exhaustive: never = node; throw new Error(`unknown statement: ${exhaustive}`); }
      }
    }
  }
  statements(module.body, root);
  return root;
}
