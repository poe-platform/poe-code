import path from "node:path";
import ts from "typescript";

function addBindingNames(name, names) {
  if (ts.isIdentifier(name)) names.add(name.text);
  else for (const element of name.elements) {
    if (ts.isBindingElement(element)) addBindingNames(element.name, names);
  }
}

/** Make external facade names explicit before esbuild shares them between entries. */
export function rewritePrivateExportStars(filename, text, exports) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const explicit = new Set();
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const item of statement.exportClause.elements) if (!item.isTypeOnly) explicit.add(item.name.text);
    } else if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) && !ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword || modifier.kind === ts.SyntaxKind.DeclareKeyword)) {
      if (ts.isVariableStatement(statement)) {
        for (const item of statement.declarationList.declarations) addBindingNames(item.name, explicit);
      } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) && statement.name && ts.isIdentifier(statement.name)) explicit.add(statement.name.text);
    }
  }
  const changes = [];
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.exportClause || statement.isTypeOnly || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const names = exports.get(statement.moduleSpecifier.text)?.filter(name => name !== "default" && !explicit.has(name));
    if (names !== undefined) changes.push({ start: statement.getStart(source), end: statement.end,
      text: `export { ${names.map(name => JSON.stringify(name)).join(", ")} } from ${JSON.stringify(statement.moduleSpecifier.text)};` });
  }
  for (const change of changes.reverse()) text = text.slice(0, change.start) + change.text + text.slice(change.end);
  return text;
}

export function privateExportStarsPlugin(exports, files, sourceRoot, resolveExports) {
  return { name: "private-export-stars", setup(builder) {
    builder.onLoad({ filter: /\.[cm]?[jt]s$/, namespace: "file" }, async args => {
      if ((!exports.size && !resolveExports) || sourceRoot && !args.path.startsWith(sourceRoot + path.sep)) return undefined;
      const text = (await files.readFile(args.path)).toString();
      if (resolveExports) {
        const source = ts.createSourceFile(args.path, text, ts.ScriptTarget.Latest, true);
        for (const statement of source.statements) {
          if (!ts.isExportDeclaration(statement) || statement.exportClause || statement.isTypeOnly || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
          const specifier = statement.moduleSpecifier.text;
          if (!exports.has(specifier)) {
            const names = await resolveExports(specifier);
            if (names !== undefined) exports.set(specifier, names);
          }
        }
      }
      const contents = rewritePrivateExportStars(args.path, text, exports);
      return contents === text ? undefined : { contents, loader: args.path.endsWith(".ts") ? "ts" : "js" };
    });
  } };
}
