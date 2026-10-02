import ts from "typescript";

/**
 * @param {string} filename
 * @param {string} text
 * @param {(specifier: string, kind: "module" | "url") => string} rewrite
 */
export function rewriteModuleSpecifiers(filename, text, rewrite) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest);
  const replacements = [];
  const pending = [source];
  while (pending.length) {
    const node = pending.pop();
    let literal;
    let kind = /** @type {"module" | "url"} */ ("module");
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) literal = node.moduleSpecifier;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) literal = node.argument.literal;
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) literal = node.arguments[0];
    else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL") {
      kind = "url";
      const base = node.arguments?.[1];
      if (base && ts.isPropertyAccessExpression(base) && base.name.text === "url" && ts.isMetaProperty(base.expression) && base.expression.keywordToken === ts.SyntaxKind.ImportKeyword) literal = node.arguments?.[0];
    }
    if (literal && ts.isStringLiteral(literal)) {
      const value = rewrite(literal.text, kind);
      if (value !== literal.text) replacements.push({ start: literal.getStart(source), end: literal.end, value: JSON.stringify(value) });
    }
    const children = [];
    ts.forEachChild(node, child => { children.push(child); });
    for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
  }
  if (replacements.length === 0) return text;
  const parts = [];
  let offset = 0;
  for (const replacement of replacements.sort((left, right) => left.start - right.start)) {
    parts.push(text.slice(offset, replacement.start), replacement.value);
    offset = replacement.end;
  }
  parts.push(text.slice(offset));
  return parts.join("");
}
