import ts from "typescript";

/** Derive a cooperative repair method from the pinned native routine. Keep the
 * validation tables, recovery decisions and recursion rules in one source. */
export function streamCffRepairs(source) {
  const start = source.indexOf("  parseCharString(state, data, localSubrIndex, globalSubrIndex) {"),
    end = source.indexOf("\n  parseCharStrings(", start);
  if (start < 0 || end < start) throw new Error("CFF repair source markers changed");
  const file = ts.createSourceFile("repair.js", "class Repair {\n" + source.slice(start, end) + "\n}", ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const original = file.statements[0].members[0], f = ts.factory;
  const name = node => ts.isIdentifier(node) ? node.text : undefined;
  const method = (object, member, args) => f.createCallExpression(f.createPropertyAccessExpression(f.createIdentifier(object), member), undefined, args);
  const yielded = (call, delegate = false) => f.createParenthesizedExpression(f.createYieldExpression(delegate ? f.createToken(ts.SyntaxKind.AsteriskToken) : undefined, call));
  const transformed = ts.transform(original, [context => {
    const visit = node => {
      if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => name(item.name) === "view")) return f.createEmptyStatement();
      if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "onAllocation") return f.createEmptyStatement();
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isElementAccessExpression(node.left)) {
        const object = name(node.left.expression);
        if (object === "data" || object === "stack") return yielded(method(object, object === "data" ? "writeByte" : "set", [ts.visitNode(node.left.argumentExpression, visit), ts.visitNode(node.right, visit)]));
      }
      if (ts.isElementAccessExpression(node) && ["data", "stack"].includes(name(node.expression))) return yielded(method(name(node.expression), name(node.expression) === "data" ? "byte" : "get", [ts.visitNode(node.argumentExpression, visit)]));
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const object = name(node.expression.expression), member = node.expression.name.text;
        const args = node.arguments.map(arg => ts.visitNode(arg, visit));
        if (object === "view" && ["getInt16", "getInt32"].includes(member)) return yielded(method("data", "parserInt", [...args, f.createNumericLiteral(member === "getInt16" ? 2 : 4)]));
        if ((object === "data" && ["copyWithin", "fill"].includes(member)) || (object === "stack" && member === "slice") || (object === "subrsIndex" && member === "get")) return yielded(method(object, member, args));
        if (object === "validationCommand" && member === "stackFn") return yielded(f.createCallExpression(f.createIdentifier("cffValidationMath"), undefined, [f.createIdentifier("validationCommand"), ...args]), true);
        if (node.expression.expression.kind === ts.SyntaxKind.ThisKeyword && member === "parseCharString") return yielded(f.createCallExpression(f.createPropertyAccessExpression(f.createThis(), "parseCharStringSteps"), undefined, args), true);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return node => ts.visitNode(node, visit);
  }]);
  const result = transformed.transformed[0];
  const generator = f.updateMethodDeclaration(result, result.modifiers, f.createToken(ts.SyntaxKind.AsteriskToken), f.createIdentifier("parseCharStringSteps"), result.questionToken, result.typeParameters, result.parameters, result.type, result.body);
  const text = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printNode(ts.EmitHint.Unspecified, generator, file);
  transformed.dispose();
  const math = `function* cffValidationMath(command, stack, size) {
    const values = [yield stack.get(size - 2), yield stack.get(size - 1)];
    command.stackFn(values, 2);
    if (size >= 2) yield stack.set(size - 2, values[0]);
    yield stack.set(size - 1, values[1]);
  }\n`;
  return math + source.slice(0, end) + "\n  " + text + source.slice(end);
}
