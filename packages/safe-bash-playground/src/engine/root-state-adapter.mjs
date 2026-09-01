import ts from "typescript";

export function instrumentRootState(source) {
  const file = ts.createSourceFile(
    "shell.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  if (file.parseDiagnostics.length)
    throw new Error("Cannot parse the pinned shell state adapter input");
  let adapted = 0;
  const transformed = ts.transform(file, [
    (context) => {
      const factory = context.factory;
      const notify = factory.createExpressionStatement(
        factory.createCallChain(
          factory.createPropertyAccessExpression(factory.createIdentifier("options"), "onState"),
          factory.createToken(ts.SyntaxKind.QuestionDotToken),
          undefined,
          [
            factory.createCallExpression(
              factory.createPropertyAccessExpression(factory.createIdentifier("Object"), "freeze"),
              undefined,
              [
                factory.createObjectLiteralExpression([
                  factory.createPropertyAssignment(
                    "cwd",
                    factory.createPropertyAccessExpression(factory.createIdentifier("state"), "cwd")
                  )
                ])
              ]
            )
          ]
        )
      );
      const visitBody = (node) => {
        if (ts.isBlock(node)) {
          const index = node.statements.findIndex(
            (statement) =>
              ts.isVariableStatement(statement) &&
              statement.declarationList.declarations.some(
                (declaration) =>
                  ts.isIdentifier(declaration.name) &&
                  declaration.name.text === "state" &&
                  declaration.initializer &&
                  ts.isObjectLiteralExpression(declaration.initializer) &&
                  declaration.initializer.properties.some(
                    (property) =>
                      ts.isShorthandPropertyAssignment(property) && property.name.text === "cwd"
                  )
              )
          );
          if (index >= 0) {
            adapted++;
            return factory.updateBlock(node, [
              ...node.statements.slice(0, index + 1),
              factory.createTryStatement(
                factory.createBlock(node.statements.slice(index + 1), true),
                undefined,
                factory.createBlock([notify], true)
              )
            ]);
          }
        }
        return ts.visitEachChild(node, visitBody, context);
      };
      const visit = (node) => {
        if (
          ts.isMethodDeclaration(node) &&
          ts.isPrivateIdentifier(node.name) &&
          node.name.text === "#execute" &&
          node.body
        ) {
          return factory.updateMethodDeclaration(
            node,
            node.modifiers,
            node.asteriskToken,
            node.name,
            node.questionToken,
            node.typeParameters,
            node.parameters,
            node.type,
            visitBody(node.body)
          );
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (root) => ts.visitNode(root, visit);
    }
  ]);
  try {
    if (adapted !== 1)
      throw new Error("Pinned shell root-state structure changed; refusing browser adaptation");
    return ts.createPrinter().printFile(transformed.transformed[0]);
  } finally {
    transformed.dispose();
  }
}
