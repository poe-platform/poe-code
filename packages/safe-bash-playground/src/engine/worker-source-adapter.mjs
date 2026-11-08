import ts from "typescript";

export function selectBrowserWorker(source, identity) {
  const file = ts.createSourceFile(
    "worker-owner.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  if (file.parseDiagnostics.length) throw new Error("Cannot parse the pinned worker owner");
  let adapted = 0;
  const transformed = ts.transform(file, [
    (context) => {
      const visit = (node) => {
        if (
          ts.isNewExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "Worker"
        ) {
          if (
            !node.arguments?.length ||
            !ts.isNewExpression(node.arguments[0]) ||
            !ts.isIdentifier(node.arguments[0].expression) ||
            node.arguments[0].expression.text !== "URL"
          )
            throw new Error("Pinned worker constructor changed; refusing browser adaptation");
          adapted++;
          return context.factory.updateNewExpression(node, node.expression, node.typeArguments, [
            context.factory.createStringLiteral(identity),
            ...node.arguments.slice(1)
          ]);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (root) => ts.visitNode(root, visit);
    }
  ]);
  try {
    if (adapted !== 1)
      throw new Error("Pinned worker structure changed; refusing browser adaptation");
    return ts.createPrinter().printFile(transformed.transformed[0]);
  } finally {
    transformed.dispose();
  }
}
