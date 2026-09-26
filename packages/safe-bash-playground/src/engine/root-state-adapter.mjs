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
      const observation = (rootName) => {
        const root = factory.createIdentifier(rootName);
        const notify = factory.createExpressionStatement(
          factory.createCallChain(
            factory.createPropertyAccessExpression(factory.createIdentifier("options"), "onRootState"),
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
                      factory.createPropertyAccessExpression(root, "cwd")
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
              factory.createPropertyAccessExpression(root, "cwd"))
          ], ts.NodeFlags.Let)),
          factory.createExpressionStatement(factory.createCallExpression(
            factory.createPropertyAccessExpression(factory.createIdentifier("Object"), "defineProperty"),
            undefined,
            [root, factory.createStringLiteral("cwd"), factory.createObjectLiteralExpression([
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
        return { notify, observe };
      };
      let assignedRootBinding = false;
      const hasCwd = (initializer) => initializer && ts.isObjectLiteralExpression(initializer)
        && initializer.properties.some(property => ts.isShorthandPropertyAssignment(property) && property.name.text === "cwd");
      const isConstructedRoot = (initializer) => initializer && ts.isNewExpression(initializer)
        && ts.isIdentifier(initializer.expression) && initializer.expression.text === "RootShellState"
        && initializer.arguments?.length === 4
        && ["cwd", "variables", "exported"].every((name, index) =>
          ts.isIdentifier(initializer.arguments[index]) && initializer.arguments[index].text === name);
      const assignedValue = (statement, name) => {
        if (!statement || !ts.isExpressionStatement(statement)) return undefined;
        const expression = statement.expression;
        return ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isIdentifier(expression.left) && expression.left.text === name ? expression.right : undefined;
      };
      const isWarmProperty = (expression, name) => expression && ts.isPropertyAccessExpression(expression)
        && !expression.questionDotToken && ts.isIdentifier(expression.expression)
        && expression.expression.text === "warm" && expression.name.text === name;
      const warmRootSelection = (statement) => {
        const block = statement.parent;
        if (!ts.isBlock(block)) return undefined;
        const selection = block.statements[block.statements.indexOf(statement) + 1];
        if (!selection || !ts.isIfStatement(selection) || !ts.isIdentifier(selection.expression)
          || selection.expression.text !== "warm" || !ts.isBlock(selection.thenStatement)
          || !selection.elseStatement || !ts.isBlock(selection.elseStatement)) return undefined;
        const reused = selection.thenStatement.statements;
        if (reused.length !== 2 || !isWarmProperty(assignedValue(reused[0], "currentState"), "currentState")
          || !isWarmProperty(assignedValue(reused[1], "runtime"), "runtime")) return undefined;
        const constructed = selection.elseStatement.statements;
        let roots = 0;
        const countRoots = (child) => {
          if (ts.isFunctionLike(child) || ts.isClassLike(child)) return;
          if (isConstructedRoot(assignedValue(child, "currentState"))) roots++;
          ts.forEachChild(child, countRoots);
        };
        countRoots(selection.elseStatement);
        const constructedIndex = constructed.findIndex(child => isConstructedRoot(assignedValue(child, "currentState")));
        if (roots !== 1 || constructedIndex < 0) return undefined;
        const published = assignedValue(constructed[constructedIndex + 1], "state");
        if (!published || !ts.isIdentifier(published) || published.text !== "currentState") return undefined;
        return { name: "currentState", selection, constructedIndex };
      };
      const rootStateBinding = (statement) => {
        if (ts.isVariableStatement(statement)) {
          const declarations = statement.declarationList.declarations;
          if (declarations.length !== 1) return undefined;
          const declaration = declarations[0];
          if (!ts.isIdentifier(declaration.name)) return undefined;
          if (declaration.name.text === "state" && hasCwd(declaration.initializer)) return { name: "state" };
          if (declaration.name.text === "currentState") {
            if (isConstructedRoot(declaration.initializer)) return { name: "currentState" };
            if (!declaration.initializer
              && (statement.declarationList.flags & ts.NodeFlags.BlockScoped) === ts.NodeFlags.Let)
              return warmRootSelection(statement);
          }
          return undefined;
        }
        if (!assignedRootBinding || !ts.isExpressionStatement(statement)) return undefined;
        const expression = statement.expression;
        return ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isIdentifier(expression.left) && expression.left.text === "state" && hasCwd(expression.right)
          ? { name: "state" } : undefined;
      };
      const visitBody = (node) => {
        if (ts.isFunctionLike(node) || ts.isClassLike(node)) return node;
        if (ts.isBlock(node)) {
          const index = node.statements.findIndex(statement => rootStateBinding(statement) !== undefined);
          if (index >= 0) {
            adapted++;
            const binding = rootStateBinding(node.statements[index]);
            const { notify, observe } = observation(binding.name);
            if (binding.selection) {
              const selection = binding.selection;
              const reused = selection.thenStatement;
              const constructed = selection.elseStatement;
              const coldIndex = binding.constructedIndex + 1;
              const observedSelection = factory.updateIfStatement(
                selection,
                selection.expression,
                factory.updateBlock(reused, [reused.statements[0], ...observe, ...reused.statements.slice(1)]),
                factory.updateBlock(constructed, [
                  ...constructed.statements.slice(0, coldIndex),
                  ...observation(binding.name).observe,
                  ...constructed.statements.slice(coldIndex)
                ])
              );
              return factory.updateBlock(node, [
                ...node.statements.slice(0, index + 1),
                factory.createTryStatement(
                  factory.createBlock([observedSelection, ...node.statements.slice(index + 2)], true),
                  undefined,
                  factory.createBlock([factory.createIfStatement(
                    factory.createBinaryExpression(factory.createIdentifier(binding.name), ts.SyntaxKind.ExclamationEqualsEqualsToken,
                      factory.createIdentifier("undefined")),
                    notify
                  )], true)
                )
              ]);
            }
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
            if (rootStateBinding(child) !== undefined) candidates++;
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
