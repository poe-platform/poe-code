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
      const assignment = (statement, name) => {
        if (!ts.isExpressionStatement(statement)) return undefined;
        const expression = statement.expression;
        return ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isIdentifier(expression.left) && expression.left.text === name ? expression.right : undefined;
      };
      const isName = (node, name) => node && ts.isIdentifier(node) && node.text === name;
      const isWarmProperty = (node, name) => node && ts.isPropertyAccessExpression(node)
        && !node.questionDotToken && isName(node.expression, "warm") && node.name.text === name;
      const branchedRoot = (statements, index) => {
        const declaration = statements[index];
        if (!ts.isVariableStatement(declaration)
          || (declaration.declarationList.flags & ts.NodeFlags.BlockScoped) !== ts.NodeFlags.Let
          || declaration.declarationList.declarations.length !== 1) return undefined;
        const binding = declaration.declarationList.declarations[0];
        if (!isName(binding.name, "currentState") || binding.initializer) return undefined;
        const branch = statements[index + 1];
        if (!branch || !ts.isIfStatement(branch) || !isName(branch.expression, "warm")
          || !ts.isBlock(branch.thenStatement) || !branch.elseStatement || !ts.isBlock(branch.elseStatement)) return undefined;
        const warm = branch.thenStatement.statements;
        if (warm.length !== 2 || !isWarmProperty(assignment(warm[0], "currentState"), "currentState")
          || !isWarmProperty(assignment(warm[1], "runtime"), "runtime")) return undefined;
        const cold = branch.elseStatement.statements;
        const constructors = cold.flatMap((statement, position) =>
          isConstructedRoot(assignment(statement, "currentState")) ? [position] : []);
        if (constructors.length !== 1) return undefined;
        const constructed = constructors[0];
        if (!cold[constructed + 1] || !isName(assignment(cold[constructed + 1], "state"), "currentState")) return undefined;
        return { index, branch, constructed };
      };
      const rootStateBinding = (statement) => {
        if (ts.isVariableStatement(statement)) {
          const declarations = statement.declarationList.declarations;
          if (declarations.length !== 1) return undefined;
          const declaration = declarations[0];
          if (!ts.isIdentifier(declaration.name)) return undefined;
          if (declaration.name.text === "state" && hasCwd(declaration.initializer)) return "state";
          if (declaration.name.text === "currentState" && isConstructedRoot(declaration.initializer)) return "currentState";
          return undefined;
        }
        if (!assignedRootBinding || !ts.isExpressionStatement(statement)) return undefined;
        const expression = statement.expression;
        return ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isIdentifier(expression.left) && expression.left.text === "state" && hasCwd(expression.right)
          ? "state" : undefined;
      };
      const branches = new Map();
      const admissionMethods = new Set();
      const visitBody = (node) => {
        if (ts.isFunctionLike(node) || ts.isClassLike(node)) return node;
        if (ts.isBlock(node)) {
          const split = branches.get(node);
          if (split) {
            adapted++;
            const { index, branch, constructed } = split;
            const { notify, observe } = observation("currentState");
            const warm = branch.thenStatement;
            const cold = branch.elseStatement;
            const observedBranch = factory.updateIfStatement(branch, branch.expression,
              factory.updateBlock(warm, [warm.statements[0], ...observe, ...warm.statements.slice(1)]),
              factory.updateBlock(cold, [
                ...cold.statements.slice(0, constructed + 1),
                ...observation("currentState").observe,
                ...cold.statements.slice(constructed + 1)
              ]));
            // Both root selections must share the finally after command execution.
            return factory.updateBlock(node, [
              ...node.statements.slice(0, index + 1),
              factory.createTryStatement(factory.createBlock([
                observedBranch, ...node.statements.slice(index + 2)
              ], true), undefined, factory.createBlock([
                factory.createIfStatement(factory.createBinaryExpression(
                  factory.createIdentifier("currentState"), ts.SyntaxKind.ExclamationEqualsEqualsToken,
                  factory.createIdentifier("undefined")
                ), notify)
              ], true))
            ]);
          }
          const index = node.statements.findIndex(statement => rootStateBinding(statement) !== undefined);
          if (index >= 0) {
            adapted++;
            const { notify, observe } = observation(rootStateBinding(node.statements[index]));
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
          let splitBindings = 0;
          let assignedConstructors = 0;
          const countCandidates = (child) => {
            if (ts.isFunctionLike(child) || ts.isClassLike(child)) return;
            if (rootStateBinding(child) !== undefined) candidates++;
            if (ts.isVariableDeclaration(child) && isName(child.name, "currentState")
              && !isConstructedRoot(child.initializer)) splitBindings++;
            if (ts.isExpressionStatement(child)) {
              const value = assignment(child, "currentState");
              if (value && ts.isNewExpression(value) && isName(value.expression, "RootShellState")) assignedConstructors++;
            }
            if (ts.isBlock(child)) {
              child.statements.forEach((_, index) => {
                const split = branchedRoot(child.statements, index);
                if (split) { branches.set(child, split); candidates++; }
              });
            }
            ts.forEachChild(child, countCandidates);
          };
          countCandidates(node.body);
          if (candidates !== 1 || splitBindings !== branches.size || assignedConstructors !== branches.size)
            throw new Error("Pinned shell root-state structure changed; refusing browser adaptation");
          if (branches.size) {
            const methods = node.parent.members.filter(member => ts.isMethodDeclaration(member)
              && ts.isPrivateIdentifier(member.name) && member.name.text === "#isDefaultExecOptions");
            const method = methods[0];
            if (methods.length !== 1 || !isName(method.parameters[0]?.name, "options")
              || method.body?.statements.length !== 1 || !ts.isReturnStatement(method.body.statements[0])
              || !method.body.statements[0].expression)
              throw new Error("Pinned shell root-state structure changed; refusing browser adaptation");
            admissionMethods.add(method);
          }
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
      const visitAdmission = (node) => {
        if (admissionMethods.has(node)) {
          const original = node.body.statements[0];
          const absent = (name) => factory.createBinaryExpression(
            factory.createPropertyAccessExpression(factory.createIdentifier("options"), name),
            ts.SyntaxKind.EqualsEqualsEqualsToken, factory.createIdentifier("undefined")
          );
          // Observer options must reach #execute instead of the synchronous warm path.
          const condition = factory.createBinaryExpression(
            factory.createBinaryExpression(absent("onRootState"), ts.SyntaxKind.AmpersandAmpersandToken, absent("onCwd")),
            ts.SyntaxKind.AmpersandAmpersandToken, original.expression
          );
          return factory.updateMethodDeclaration(node, node.modifiers, node.asteriskToken, node.name,
            node.questionToken, node.typeParameters, node.parameters, node.type,
            factory.updateBlock(node.body, [factory.updateReturnStatement(original, condition)]));
        }
        return ts.visitEachChild(node, visitAdmission, context);
      };
      return (root) => ts.visitNode(ts.visitNode(root, visit), visitAdmission);
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
