import ts from "typescript";

export function limitCommandBuffers(source) {
  const file = ts.createSourceFile(
    "internal.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  if (file.parseDiagnostics.length)
    throw new Error("Cannot parse the pinned command buffer adapter input");
  let adapted = 0;
  const transformed = ts.transform(file, [
    (context) => {
      const visit = (node) => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === "bufferLimit"
        ) {
          if (node.initializer?.getText(file) !== "32 * 1024 * 1024") {
            throw new Error(
              "Pinned command buffer initializer changed; refusing browser adaptation"
            );
          }
          adapted++;
          return context.factory.updateVariableDeclaration(
            node,
            node.name,
            node.exclamationToken,
            node.type,
            context.factory.createNumericLiteral(2 * 1024 * 1024)
          );
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (root) => ts.visitNode(root, visit);
    }
  ]);
  try {
    if (adapted !== 1)
      throw new Error("Pinned command buffer structure changed; refusing browser adaptation");
    return ts.createPrinter().printFile(transformed.transformed[0]);
  } finally {
    transformed.dispose();
  }
}
