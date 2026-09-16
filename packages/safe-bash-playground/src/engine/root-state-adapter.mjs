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
      const observedCwd = factory.createIdentifier("playgroundRootCwd");
      const cwdValue = factory.createIdentifier("value");
      const observe = [
        factory.createVariableStatement(undefined, factory.createVariableDeclarationList([
          factory.createVariableDeclaration(observedCwd, undefined, undefined,
            factory.createPropertyAccessExpression(factory.createIdentifier("state"), "cwd"))
        ], ts.NodeFlags.Let)),
        factory.createExpressionStatement(factory.createCallExpression(
          factory.createPropertyAccessExpression(factory.createIdentifier("Object"), "defineProperty"),
          undefined,
          [factory.createIdentifier("state"), factory.createStringLiteral("cwd"), factory.createObjectLiteralExpression([
            factory.createPropertyAssignment("enumerable", factory.createTrue()),
            factory.createPropertyAssignment("configurable", factory.createTrue()),
            factory.createPropertyAssignment("get", factory.createArrowFunction(
              undefined, undefined, [], undefined, factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), observedCwd
            )),
            factory.createPropertyAssignment("set", factory.createArrowFunction(
              undefined, undefined, [factory.createParameterDeclaration(undefined, undefined, cwdValue)],
              undefined, factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), factory.createBlock([
                factory.createIfStatement(
                  factory.createBinaryExpression(observedCwd, ts.SyntaxKind.EqualsEqualsEqualsToken, cwdValue),
                  factory.createReturnStatement()
                ),
                factory.createExpressionStatement(factory.createAssignment(observedCwd, cwdValue)),
                factory.createExpressionStatement(factory.createCallChain(
                  factory.createPropertyAccessExpression(factory.createIdentifier("options"), "onCwd"),
                  factory.createToken(ts.SyntaxKind.QuestionDotToken), undefined, [cwdValue]
                ))
              ], true)
            ))
          ])]
        ))
      ];
      let assignedRootBinding = false;
      const hasCwd = (initializer) => initializer && ts.isObjectLiteralExpression(initializer)
        && initializer.properties.some(property => ts.isShorthandPropertyAssignment(property) && property.name.text === "cwd");
      const isRootState = (statement) => {
        if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some(declaration =>
          ts.isIdentifier(declaration.name) && declaration.name.text === "state" && hasCwd(declaration.initializer));
        if (!assignedRootBinding || !ts.isExpressionStatement(statement)) return false;
        const expression = statement.expression;
        return ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isIdentifier(expression.left) && expression.left.text === "state" && hasCwd(expression.right);
      };
      const visitBody = (node) => {
        if (ts.isFunctionLike(node) || ts.isClassLike(node)) return node;
        if (ts.isBlock(node)) {
          const index = node.statements.findIndex(isRootState);
          if (index >= 0) {
            adapted++;
            return factory.updateBlock(node, [
              ...node.statements.slice(0, index + 1),
              ...observe,
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
          const bindings = node.body.statements.filter(statement => ts.isVariableStatement(statement)
            && (statement.declarationList.flags & ts.NodeFlags.BlockScoped) === ts.NodeFlags.Let
            && statement.declarationList.declarations.length === 1
            && ts.isIdentifier(statement.declarationList.declarations[0].name)
            && statement.declarationList.declarations[0].name.text === "state"
            && !statement.declarationList.declarations[0].initializer);
          assignedRootBinding = bindings.length === 1;
          let candidates = 0;
          const countCandidates = (child) => {
            if (ts.isFunctionLike(child) || ts.isClassLike(child)) return;
            if (isRootState(child)) candidates++;
            ts.forEachChild(child, countCandidates);
          };
          countCandidates(node.body);
          if (candidates !== 1) throw new Error("Pinned shell root-state structure changed; refusing browser adaptation");
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
