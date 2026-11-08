import ts from "typescript";

/** Derive a single-opcode coroutine from the native converter. The driver
 * stores subroutine return positions externally instead of retaining JS frames. */
export function streamType1Conversion(source) {
  const start = source.indexOf("  convert(encoded, subrs, seacAnalysisEnabled) {"),
    end = source.indexOf("\n}", source.indexOf("  executeCommand(", start));
  if (start < 0 || end < start) throw new Error("Type1 conversion source markers changed");
  const file = ts.createSourceFile(
    "conversion.js",
    "class Conversion {\n" + source.slice(start, end) + "\n}",
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const f = ts.factory,
    id = (name) => f.createIdentifier(name),
    prop = (object, name) => f.createPropertyAccessExpression(object, name);
  const member = (node, name) =>
    ts.isPropertyAccessExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ThisKeyword &&
    node.name.text === name;
  const call = (object, name, args) => f.createCallExpression(prop(object, name), undefined, args);
  const yielded = (expression, delegate = false) =>
    f.createParenthesizedExpression(
      f.createYieldExpression(
        delegate ? f.createToken(ts.SyntaxKind.AsteriskToken) : undefined,
        expression
      )
    );
  const field = (name, value) => f.createPropertyAssignment(name, value);
  const result = (...fields) => f.createObjectLiteralExpression(fields, false);
  const next = () =>
    f.createBinaryExpression(id("i"), ts.SyntaxKind.PlusToken, f.createNumericLiteral(1));
  const methods = [];
  for (const original of file.statements[0].members) {
    const isConvert = original.name.text === "convert";
    const transformed = ts.transform(original, [
      (context) => {
        const visit = (node) => {
          if (
            ts.isVariableStatement(node) &&
            node.declarationList.declarations.some(
              (item) => ts.isIdentifier(item.name) && item.name.text === "count"
            )
          )
            return f.createEmptyStatement();
          if (ts.isExpressionStatement(node)) {
            const expression = node.expression;
            if (
              ts.isCallExpression(expression) &&
              ts.isPropertyAccessExpression(expression.expression) &&
              expression.expression.name.text === "onAllocation"
            )
              return f.createEmptyStatement();
            if (
              ts.isBinaryExpression(expression) &&
              expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
            ) {
              const left = expression.left,
                right = expression.right;
              if (
                member(left, "stack") ||
                (ts.isPropertyAccessExpression(left) &&
                  member(left.expression, "stack") &&
                  left.name.text === "length")
              )
                return f.createExpressionStatement(
                  yielded(call(prop(f.createThis(), "stack"), "clear", []))
                );
              if (ts.isCallExpression(right) && member(right.expression, "convert"))
                return f.createReturnStatement(
                  result(
                    field("call", ts.visitNode(right.arguments[0], visit)),
                    field("next", next()),
                    field("error", f.createFalse())
                  )
                );
            }
          }
          if (isConvert && ts.isForStatement(node))
            return f.createDoStatement(ts.visitNode(node.statement, visit), f.createFalse());
          if (isConvert && ts.isReturnStatement(node) && node.expression)
            return f.createReturnStatement(
              result(
                field("done", f.createTrue()),
                field("error", ts.visitNode(node.expression, visit))
              )
            );
          if (ts.isElementAccessExpression(node)) {
            if (
              ts.isIdentifier(node.expression) &&
              ["encoded", "subrs"].includes(node.expression.text)
            )
              return yielded(
                call(node.expression, node.expression.text === "encoded" ? "byte" : "get", [
                  ts.visitNode(node.argumentExpression, visit)
                ])
              );
            if (member(node.expression, "stack"))
              return yielded(
                call(node.expression, "get", [ts.visitNode(node.argumentExpression, visit)])
              );
          }
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const args = node.arguments.map((arg) => ts.visitNode(arg, visit));
            if (member(node.expression, "executeCommand"))
              return yielded(call(f.createThis(), "executeCommandSteps", args), true);
            if (
              member(node.expression.expression, "stack") ||
              member(node.expression.expression, "output")
            )
              return yielded(call(node.expression.expression, node.expression.name.text, args));
          }
          return ts.visitEachChild(node, visit, context);
        };
        return (node) => ts.visitNode(node, visit);
      }
    ]);
    let method = transformed.transformed[0];
    if (isConvert) {
      const statements = [...method.body.statements];
      statements.pop();
      statements.unshift(
        f.createVariableStatement(
          undefined,
          f.createVariableDeclarationList(
            [f.createVariableDeclaration("i", undefined, undefined, id("position"))],
            ts.NodeFlags.Let
          )
        )
      );
      statements.push(
        f.createReturnStatement(result(field("next", next()), field("error", id("error"))))
      );
      method = f.updateMethodDeclaration(
        method,
        method.modifiers,
        f.createToken(ts.SyntaxKind.AsteriskToken),
        id("convertStep"),
        method.questionToken,
        method.typeParameters,
        [...method.parameters, f.createParameterDeclaration(undefined, undefined, "position")],
        method.type,
        f.createBlock(statements, true)
      );
    } else
      method = f.updateMethodDeclaration(
        method,
        method.modifiers,
        f.createToken(ts.SyntaxKind.AsteriskToken),
        id("executeCommandSteps"),
        method.questionToken,
        method.typeParameters,
        method.parameters,
        method.type,
        method.body
      );
    methods.push(
      ts
        .createPrinter({ newLine: ts.NewLineKind.LineFeed })
        .printNode(ts.EmitHint.Unspecified, method, file)
    );
    transformed.dispose();
  }
  return (
    source +
    `\nexport class StoredType1CharString extends Type1CharString {
    constructor(stack, output) { super(); this.stack = stack; this.output = output; }
    ${methods
      .map((method) =>
        method
          .split("\n")
          .map((line) => line.trimEnd())
          .join("\n")
      )
      .join("\n")}
  }\n`
  );
}
