import ts from 'typescript';

/** Keep the pinned polling callback as source data across provider minification. */
export function preserveBrowserPolling(sourceText: string): string {
  const source = ts.createSourceFile('frames.js', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const owner = source.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'Frame');
  const method = owner?.members.find((node): node is ts.MethodDeclaration => ts.isMethodDeclaration(node) && node.name.getText(source) === 'waitForFunctionExpression');
  if (!method) throw new Error('Pinned provider polling method changed; qualify its source');
  const calls: ts.CallExpression[] = [];
  const collect = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(source) === 'injectedScript' && node.expression.name.text === 'evaluateHandle') calls.push(node);
    ts.forEachChild(node, collect);
  };
  collect(method);
  const call = calls[0];
  if (calls.length !== 1 || call?.arguments.length !== 2 || !ts.isArrowFunction(call.arguments[0]!)) {
    throw new Error('Pinned provider polling serialization changed; qualify its source');
  }
  const callback = call.arguments[0]!.getText(source);
  const result = ts.transform(source, [context => root => {
    const visit: ts.Visitor = node => {
      if (node === call) return context.factory.updateCallExpression(call,
        context.factory.createPropertyAccessExpression(context.factory.createIdentifier('injectedScript'), 'evaluateExpressionHandle'),
        call.typeArguments, [context.factory.createStringLiteral(callback),
          context.factory.createObjectLiteralExpression([context.factory.createPropertyAssignment('isFunction', context.factory.createTrue())]), call.arguments[1]!]);
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  try { return ts.createPrinter().printFile(result.transformed[0]!); }
  finally { result.dispose(); }
}
