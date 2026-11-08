import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = realpathSync(process.argv[2]);
const ts = (await import(pathToFileURL(resolve(root, 'node_modules/typescript/lib/typescript.js')).href)).default;
const entries = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const pending = [...entries];
const visited = new Set();
const imports = [];
const computed = [];
const data = [];
const violations = [];
function localTarget(from, specifier) {
  const base = resolve(root, dirname(from), specifier);
  const candidates = [base, base.replace(/\.js$/, '.ts'), base.replace(/\.mjs$/, '.mts')];
  const target = candidates.find(candidate => existsSync(candidate));
  if (!target) throw new Error(`Unresolved ${from}: ${specifier}`);
  const actual = realpathSync(target);
  if (!actual.startsWith(`${root}/`)) violations.push({ from, specifier, target: actual });
  return relative(root, actual);
}
while (pending.length) {
  const file = pending.pop();
  if (visited.has(file)) continue;
  visited.add(file);
  const text = readFileSync(resolve(root, file), 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  function walk(node) {
    const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === 'require')) {
      if (node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
      else computed.push({ file, line, expression: node.getText(ast) });
    }
    if (specifier !== undefined) {
      const entry = { file, line, specifier };
      if (specifier.startsWith('.')) {
        entry.target = localTarget(file, specifier);
        pending.push(entry.target);
      } else if (!specifier.startsWith('node:')) {
        violations.push(entry);
      }
      imports.push(entry);
    }
    if (ts.isNewExpression(node) && node.expression.getText(ast) === 'URL' && node.arguments?.length === 2 &&
        ts.isStringLiteral(node.arguments[0]) && node.arguments[1].getText(ast) === 'import.meta.url') {
      data.push({ file, line, relativeURL: node.arguments[0].text });
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
}
console.log(JSON.stringify({ root, entries, files: [...visited].sort(), imports, computed, data, violations,
  limits: 'Conservative AST static import/export closure includes type-only edges. Literal relative imports resolve inside the regular snapshot; this is not proof about every possible computed import or unexecuted entrypoint.' }, null, 2));
if (violations.length) process.exitCode = 1;
