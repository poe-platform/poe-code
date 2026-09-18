import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { readRegularInput } from './typecheck-integration-inputs.mjs';

export function renderNativeStorageSources(text) {
  const source = ts.createSourceFile('native-storage-realm.ts', text, ts.ScriptTarget.ES2022, true);
  const printer = ts.createPrinter();
  const output = ['// Generated from native-storage-realm.ts; regenerate with scripts/generate-native-storage-sources.mjs.'];
  for (const name of ['collectStorageOrigin', 'restoreStorageOrigin']) {
    const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.equal(declarations.length, 1, 'canonical native storage declaration must be unique: ' + name);
    const original = declarations[0];
    const declaration = ts.factory.updateFunctionDeclaration(original,
      original.modifiers?.filter(modifier => modifier.kind !== ts.SyntaxKind.ExportKeyword),
      original.asteriskToken, original.name, original.typeParameters, original.parameters, original.type, original.body);
    const emitted = ts.transpileModule(printer.printNode(ts.EmitHint.Unspecified, declaration, source), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true }, reportDiagnostics: true,
    });
    assert.ok(!emitted.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error), 'native storage source emission failed');
    const javascript = ts.createSourceFile(name + '.js', emitted.outputText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    assert.equal(javascript.statements.length, 1, 'native storage realm must contain one self-contained declaration');
    assert.ok(ts.isFunctionDeclaration(javascript.statements[0]) && javascript.statements[0].name?.text === name, 'native storage source identity changed');
    output.push('export const ' + name + 'Source = ' + JSON.stringify(javascript.statements[0].getText(javascript)) + ';');
  }
  return output.join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const canonical = readRegularInput(root, 'src/playwright/native-storage-realm.ts', 262144).toString('utf8');
  writeFileSync(new URL('../src/playwright/native-storage-sources.generated.ts', import.meta.url), renderNativeStorageSources(canonical));
}
