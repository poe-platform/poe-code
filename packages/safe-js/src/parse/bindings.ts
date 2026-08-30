import type {
  ArrowFunctionExpression,
  ArrayPattern,
  AssignmentPattern,
  Identifier,
  MemberExpression,
  ObjectPattern,
  ParseResult,
  RestElement,
  VariableDeclaration
} from "./parser.js";

type BindingPattern =
  | Identifier
  | ArrayPattern
  | ObjectPattern
  | AssignmentPattern
  | RestElement
  | MemberExpression;

export function getFunctionLength(params: ArrowFunctionExpression["params"]): number {
  const firstOptional = params.findIndex(
    (param) => param.type === "AssignmentPattern" || param.type === "RestElement"
  );
  return firstOptional === -1 ? params.length : firstOptional;
}

export function* boundIdentifiers(pattern: BindingPattern): Iterable<Identifier> {
  switch (pattern.type) {
    case "Identifier":
      yield pattern;
      return;
    case "AssignmentPattern":
      yield* boundIdentifiers(pattern.left);
      return;
    case "RestElement":
      yield* boundIdentifiers(pattern.argument);
      return;
    case "ArrayPattern":
      for (const element of pattern.elements) {
        if (element !== null) yield* boundIdentifiers(element);
      }
      return;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        yield* boundIdentifiers(property.type === "RestElement" ? property : property.value);
      }
      return;
    case "MemberExpression":
      return;
  }
}

export function containsParameterExpression(pattern: BindingPattern): boolean {
  switch (pattern.type) {
    case "AssignmentPattern":
    case "MemberExpression":
      return true;
    case "RestElement":
      return containsParameterExpression(pattern.argument);
    case "ArrayPattern":
      return pattern.elements.some(
        (element) => element !== null && containsParameterExpression(element)
      );
    case "ObjectPattern":
      return pattern.properties.some((property) =>
        property.type === "RestElement"
          ? containsParameterExpression(property.argument)
          : property.computed || containsParameterExpression(property.value)
      );
    case "Identifier":
      return false;
  }
}

export function* hoistedVarDeclarations(
  nodes: readonly ParseResult[]
): Iterable<VariableDeclaration> {
  for (const node of nodes) {
    switch (node.type) {
      case "VariableDeclaration":
        if (node.kind === "var") yield node;
        break;
      case "BlockStatement":
        yield* hoistedVarDeclarations(node.body);
        break;
      case "IfStatement":
        yield* hoistedVarDeclarations([node.consequent]);
        if (node.alternate !== undefined) yield* hoistedVarDeclarations([node.alternate]);
        break;
      case "ForStatement":
        if (node.init?.type === "VariableDeclaration") yield* hoistedVarDeclarations([node.init]);
        yield* hoistedVarDeclarations([node.body]);
        break;
      case "ForInStatement":
      case "ForOfStatement":
        if (node.left.type === "VariableDeclaration") yield* hoistedVarDeclarations([node.left]);
        yield* hoistedVarDeclarations([node.body]);
        break;
      case "WhileStatement":
      case "DoWhileStatement":
        yield* hoistedVarDeclarations([node.body]);
        break;
      case "TryStatement":
        yield* hoistedVarDeclarations([node.block]);
        if (node.handler !== undefined) yield* hoistedVarDeclarations([node.handler.body]);
        if (node.finalizer !== undefined) yield* hoistedVarDeclarations([node.finalizer]);
        break;
      case "SwitchStatement":
        for (const switchCase of node.cases) yield* hoistedVarDeclarations(switchCase.consequent);
        break;
      case "ExportNamedDeclaration":
        yield* hoistedVarDeclarations([node.declaration]);
        break;
    }
  }
}
