import type { Expression, Parameter, SourceSpan } from "./ast.js";
import type { DeclaredName, Module, Statement } from "./statement-ast.js";
import type { Pattern } from "./pattern-ast.js";
import { expressionChildren } from "./expression-children.js";
import { statementExpressions } from "./statement-expressions.js";
import { manglePrivateName } from "./private-names.js";
import type {SourceMeter} from "./source.js";

export type SymbolEvent = SourceSpan & {
  readonly kind: "read" | "implicit-read" | "write" | "delete" | "parameter" | "global" | "nonlocal" | "annotation" | "import" | "write-outer";
  readonly name: string;
};
export type SymbolScope = {
  /** Parent event position at scope creation, after evaluating outer inputs.
   * This preserves evaluation order when code-owning scopes inline children. */
  readonly parentEventIndex?: number;
  readonly privateName: string | null;
  readonly kind: "module" | "function" | "class" | "lambda" | "comprehension";
  readonly node: Module | Statement | Expression;
  readonly events: readonly SymbolEvent[];
  readonly children: readonly SymbolScope[];
};
type MutableScope = Omit<SymbolScope, "events" | "children"> & { events: SymbolEvent[]; children: MutableScope[] };
type Walk=Generator<Walk,void,unknown>;

/** Collect lexical occurrences without resolving names or executing user code. */
export function collectSymbols(module: Module,meter?:SourceMeter): SymbolScope {
  meter?.checkpoint(1,192);
  try {
  const root: MutableScope = { kind: "module", privateName: null, node: module, events: [], children: [] };
  function record(scope: MutableScope, kind: SymbolEvent["kind"], name: DeclaredName | (SourceSpan & { name: string })): void {
    meter?.checkpoint(1,80);
    scope.events.push({ kind, name: manglePrivateName(name.name, scope.privateName,meter), start: name.start, end: name.end });
  }
  function child(scope: MutableScope, kind: SymbolScope["kind"], node: SymbolScope["node"]): MutableScope {
    meter?.checkpoint(1,200);
    const privateName = node.kind === "class" ? node.name.name : scope.privateName;
    const nested: MutableScope = { kind, privateName, node, parentEventIndex: scope.events.length, events: [], children: [] };
    scope.children.push(nested);
    return nested;
  }
  function parameters(scope: MutableScope, values: readonly Parameter[]): void {
    for (const parameter of values) record(scope, "parameter", parameter);
  }
  function* expression(node: Expression, scope: MutableScope, walrusScope = scope): Walk {
    if (node.kind === "name") {
      record(scope, "read", node);
      if (node.name === "super" && scope.kind !== "module" && scope.kind !== "class") {
        meter?.checkpoint(0,64);
        record(scope, "implicit-read", { name: "__class__", start: node.start, end: node.end });
      }
      return;
    }
    if (node.kind === "assignment-expression") {
      yield expression(node.value, scope, walrusScope);
      record(walrusScope, "write", node.target);
      if (scope !== walrusScope) record(scope, "write-outer", node.target);
      return;
    }
    if (node.kind === "lambda") {
      for (const parameter of node.parameters) {meter?.checkpoint();if (parameter.default) yield expression(parameter.default, scope, walrusScope);}
      const nested = child(scope, "lambda", node);
      parameters(nested, node.parameters);
      yield expression(node.body, nested);
      return;
    }
    if (node.kind === "comprehension" || node.kind === "dictionary-comprehension") {
      yield expression(node.clauses[0]!.iterable, scope, walrusScope);
      const nested = child(scope, "comprehension", node);
      if(node.kind==="comprehension"&&node.collection==="generator"){meter?.checkpoint(0,64);record(nested,"parameter",{name:".0",start:node.start,end:node.start});}
      for (let index = 0; index < node.clauses.length; index++) {
        const clause = node.clauses[index]!;
        if (index) yield expression(clause.iterable, nested, walrusScope);
        yield target(clause.target, nested, "write", walrusScope);
        for (const filter of clause.filters) yield expression(filter, nested, walrusScope);
      }
      if (node.kind === "comprehension") yield expression(node.element, nested, walrusScope);
      else { yield expression(node.key, nested, walrusScope); yield expression(node.value, nested, walrusScope); }
      return;
    }
    meter?.checkpoint(0,128);for (const item of expressionChildren(node,meter)) yield expression(item, scope, walrusScope);
  }
  function* target(node: Expression, scope: MutableScope, kind: "write" | "delete", walrusScope = scope): Walk {
    if (node.kind === "name") { record(scope, kind, node); return; }
    if (node.kind === "tuple" || node.kind === "list") {
      for (const item of node.items) yield target(item.kind === "unpack" ? item.value : item, scope, kind, walrusScope);
      return;
    }
    meter?.checkpoint(0,128);for (const item of expressionChildren(node,meter)) yield expression(item, scope, walrusScope);
  }
  function* pattern(node: Pattern, scope: MutableScope): Walk {
    switch (node.kind) {
      case "capture": case "star": if (node.name) record(scope, "write", node.name); return;
      case "value": case "singleton": yield expression(node.value, scope); return;
      case "as": yield pattern(node.pattern, scope); record(scope, "write", node.name); return;
      case "or": for (const alternative of node.patterns) yield pattern(alternative, scope); return;
      case "sequence": for (const item of node.items) yield pattern(item, scope); return;
      case "mapping":
        for (const entry of node.entries) { yield expression(entry.key, scope); yield pattern(entry.pattern, scope); }
        if (node.rest) record(scope, "write", node.rest);
        return;
      case "class":
        yield expression(node.class, scope);
        for (const item of node.positional) yield pattern(item, scope);
        for (const keyword of node.keywords) yield pattern(keyword.pattern, scope);
        return;
      default: { const exhaustive: never = node; throw new Error(`unknown pattern: ${exhaustive}`); }
    }
  }
  function* statements(body: readonly Statement[], scope: MutableScope): Walk {
    for (const node of body) {
      meter?.checkpoint();
      switch (node.kind) {
        case "function": {
          for (const decorator of node.decorators) yield expression(decorator, scope);
          for (const parameter of node.parameters) {meter?.checkpoint();if (parameter.default) yield expression(parameter.default, scope);}
          record(scope, "write", node.name);
          const nested = child(scope, "function", node);
          parameters(nested, node.parameters);
          yield statements(node.body, nested);
          break;
        }
        case "class": {
          for (const decorator of node.decorators) yield expression(decorator, scope);
          for (const argument of node.arguments) yield expression(argument.value, scope);
          record(scope, "write", node.name);
          yield statements(node.body, child(scope, "class", node));
          break;
        }
        case "assignment":
          yield expression(node.value, scope);
          for (const item of node.targets) yield target(item, scope, "write");
          break;
        case "augmented-assignment":
          if (node.target.kind === "name") record(scope, "read", node.target);
          yield target(node.target, scope, "write");
          yield expression(node.value, scope);
          break;
        case "annotated-assignment":
          if (node.value) yield expression(node.value, scope);
          if (node.simple && node.target.kind === "name") record(scope, "annotation", node.target);
          else if (node.value || node.target.kind !== "name") yield target(node.target, scope, "write");
          break;
        case "delete": for (const item of node.targets) yield target(item, scope, "delete"); break;
        case "global": case "nonlocal": for (const name of node.names) record(scope, node.kind, name); break;
        case "import": case "import-from":
          if (node.imports !== "*") for (const item of node.imports) record(scope, "import", item.alias ?? item.path[0]!);
          break;
        case "for":
          yield expression(node.iterable, scope);
          yield target(node.target, scope, "write");
          yield statements(node.body, scope); yield statements(node.otherwise, scope);
          break;
        case "while": yield expression(node.condition, scope); yield statements(node.body, scope); yield statements(node.otherwise, scope); break;
        case "with":
          for (const item of node.items) { yield expression(item.context, scope); if (item.target) yield target(item.target, scope, "write"); }
          yield statements(node.body, scope);
          break;
        case "if":
          for (const branch of node.branches) { yield expression(branch.condition, scope); yield statements(branch.body, scope); }
          yield statements(node.otherwise, scope);
          break;
        case "match":
          yield expression(node.subject, scope);
          for (const clause of node.cases) { yield pattern(clause.pattern, scope); if (clause.guard) yield expression(clause.guard, scope); yield statements(clause.body, scope); }
          break;
        case "try":
          yield statements(node.body, scope);
          for (const handler of node.handlers) {
            if (handler.exception) yield expression(handler.exception, scope);
            if (handler.alias) record(scope, "write", handler.alias);
            yield statements(handler.body, scope);
          }
          yield statements(node.otherwise, scope); yield statements(node.finalizer, scope);
          break;
        case "type-alias":
          record(scope, "write", node.name);
          break;
        case "pass": case "break": case "continue": break;
        case "expression-statement": case "return": case "raise": case "assert":
          meter?.checkpoint(0,128);for (const item of statementExpressions(node, false,meter)) yield expression(item, scope);
          break;
        default: { const exhaustive: never = node; throw new Error(`unknown statement: ${exhaustive}`); }
      }
    }
  }
  // A yielded generator represents a child visit, not recursive delegation.
  // Advance only the top frame so mutations after each child retain their order.
  meter?.checkpoint(0,160);const pending:Walk[]=[statements(module.body,root)];
  while(pending.length){
    // Reserve the iterator result and at most one yielded child generator before
    // advancing its parent. This also checks expressionless traversal work.
    meter?.checkpoint(1,160);const next=pending[pending.length-1].next();
    if(next.done)pending.pop();else {meter?.checkpoint(0,8);pending.push(next.value);}
  }
  return root;
  } finally {meter?.checkpoint();}
}
