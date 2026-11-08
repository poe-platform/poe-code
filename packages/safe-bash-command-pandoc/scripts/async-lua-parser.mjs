import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);

// Only the lexer and parser suspend. The VM and its standard libraries retain
// their upstream synchronous implementation and share the same state objects.
function suspendReaders(source, fileName, readers) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = new Map();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer && ts.isFunctionExpression(declaration.initializer))
        functions.set(declaration.name.text, declaration.initializer);
    }
  }
  const suspends = new Set(readers);
  const callsReader = node => {
    if (ts.isCallExpression(node) && suspends.has(node.expression.getText(file))) return true;
    return ts.forEachChild(node, callsReader) ?? false;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, fn] of functions) {
      if (!suspends.has(name) && callsReader(fn.body)) {suspends.add(name); changed = true;}
    }
  }
  const transformation = ts.transform(file, [context => {
    const visit = node => {
      const next = ts.visitEachChild(node, visit, context);
      if (ts.isCallExpression(node) && suspends.has(node.expression.getText(file)))
        return context.factory.createAwaitExpression(next);
      if (ts.isFunctionExpression(node) && ts.isVariableDeclaration(node.parent) && suspends.has(node.parent.name.getText(file)))
        return context.factory.updateFunctionExpression(next,
          [context.factory.createModifier(ts.SyntaxKind.AsyncKeyword)], next.asteriskToken,
          next.name, next.typeParameters, next.parameters, next.type, next.body);
      return next;
    };
    return root => ts.visitNode(root, visit);
  }]);
  try {
    return {source: ts.createPrinter().printFile(transformation.transformed[0]),
      functions: [...functions.keys()].filter(name => suspends.has(name))};
  } finally {transformation.dispose();}
}

export const asyncLuaParser = {
  name: "async-lua-parser",
  async setup(builder) {
    const lexerPath = require.resolve("fengari/src/llex.js");
    const parserPath = require.resolve("fengari/src/lparser.js");
    const lexer = suspendReaders(await readFile(lexerPath, "utf8"), lexerPath, ["ls.z.zgetc"]);
    const parser = suspendReaders(await readFile(parserPath, "utf8"), parserPath, lexer.functions.map(name => "llex." + name));
    if (!parser.functions.includes("luaY_parser")) throw new Error("Fengari parser source no longer matches its asynchronous reader adapter");
    builder.onResolve({filter: /^fengari-async-parser$/}, () => ({path: parserPath, namespace: "async-lua"}));
    builder.onResolve({filter: /.*/, namespace: "async-lua"}, args => ({
      path: path.resolve(path.dirname(args.importer), args.path),
      ...(args.path === "./llex.js" ? {namespace: "async-lua"} : {namespace: "file"})
    }));
    builder.onLoad({filter: /.*/, namespace: "async-lua"}, args => ({
      contents: args.path === lexerPath ? lexer.source : parser.source,
      loader: "js", resolveDir: path.dirname(args.path)
    }));
  }
};
