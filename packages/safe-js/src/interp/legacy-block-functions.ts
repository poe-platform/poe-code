import { boundIdentifiers } from "../parse/bindings.js";
import { functionStrictness } from "../parse/function-source.js";
import type { FunctionDeclaration, FunctionNode, Statement, VariableDeclaration } from "../parse/parser.js";
import type { Scope } from "./scope.js";

export const legacyBlockFunctions = new WeakSet<FunctionDeclaration>();
const declarations = new WeakMap<FunctionNode, Set<FunctionDeclaration>>();

export function prepareLegacyBlockFunctions(node: FunctionNode, scope: Scope): void {
  if (functionStrictness.get(node) !== false || node.body.type !== "BlockStatement") return;
  let functions = declarations.get(node);
  if (functions === undefined) {
    functions = new Set();
    const parameters = new Set(node.params.flatMap(parameter => [...boundIdentifiers(parameter)].map(id => id.name)));
    collectStatementList(node.body.body, parameters, functions, true);
    declarations.set(node, functions);
    for (const declaration of functions) legacyBlockFunctions.add(declaration);
  }
  for (const declaration of functions) {
    const name = declaration.id!.name;
    if (name !== "arguments" && !scope.hasOwnBinding(name)) scope.declareVar(name);
  }
}

export function prepareLegacyEvalFunctions(statements: readonly Statement[], scope: Scope): void {
  const functions = new Set<FunctionDeclaration>();
  collectStatementList(statements, new Set(), functions, true);
  for (const declaration of functions) {
    const name = declaration.id!.name;
    if (scope.findEvalVarConflict(new Set([name])) !== undefined) continue;
    scope.declareVar(name, {deletable: true});
    legacyBlockFunctions.add(declaration);
  }
}

function addLexicalNames(declaration: VariableDeclaration, names: Set<string>): void {
  if (declaration.kind === "var") return;
  for (const entry of declaration.declarations)
    for (const identifier of boundIdentifiers(entry.id)) names.add(identifier.name);
}

function collectStatementList(
  statements: readonly Statement[], outer: ReadonlySet<string>, functions: Set<FunctionDeclaration>, root = false
): void {
  const blocked = new Set(outer);
  for (const statement of statements) {
    if (statement.type === "VariableDeclaration") addLexicalNames(statement, blocked);
    else if (statement.type === "ClassDeclaration") blocked.add(statement.id.name);
  }
  if (!root) for (const statement of statements) {
    if (statement.type === "FunctionDeclaration" && !statement.async && !statement.generator &&
      statement.id !== undefined && !blocked.has(statement.id.name)) functions.add(statement);
  }
  const nested = new Set(blocked);
  if (!root) for (const statement of statements)
    if (statement.type === "FunctionDeclaration" && statement.id !== undefined) nested.add(statement.id.name);
  for (const statement of statements) collectStatement(statement, nested, functions);
}

function collectStatement(statement: Statement, blocked: ReadonlySet<string>, functions: Set<FunctionDeclaration>): void {
  switch (statement.type) {
    case "BlockStatement":
      collectStatementList(statement.body, blocked, functions);
      break;
    case "IfStatement":
      collectStatement(statement.consequent, blocked, functions);
      if (statement.alternate !== undefined) collectStatement(statement.alternate, blocked, functions);
      break;
    case "ForStatement": {
      const nested = new Set(blocked);
      if (statement.init?.type === "VariableDeclaration") addLexicalNames(statement.init, nested);
      collectStatement(statement.body, nested, functions);
      break;
    }
    case "ForInStatement":
    case "ForOfStatement": {
      const nested = new Set(blocked);
      if (statement.left.type === "VariableDeclaration") addLexicalNames(statement.left, nested);
      collectStatement(statement.body, nested, functions);
      break;
    }
    case "WhileStatement":
    case "WithStatement":
    case "DoWhileStatement":
      collectStatement(statement.body, blocked, functions);
      break;
    case "SwitchStatement":
      collectStatementList(statement.cases.flatMap(entry => entry.consequent), blocked, functions);
      break;
    case "TryStatement": {
      collectStatement(statement.block, blocked, functions);
      if (statement.handler !== undefined) {
        const nested = new Set(blocked);
        if (statement.handler.param !== undefined && statement.handler.param.type !== "Identifier")
          for (const identifier of boundIdentifiers(statement.handler.param)) nested.add(identifier.name);
        collectStatement(statement.handler.body, nested, functions);
      }
      if (statement.finalizer !== undefined) collectStatement(statement.finalizer, blocked, functions);
      break;
    }
  }
}
