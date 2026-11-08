import { readFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';
import { createWorkspaceBuildPlan } from './build-workspaces.mjs';

const commands = ['csvcut', 'csvgrep', 'csvkit', 'diff3', 'exiftool', 'ffmpeg', 'fmt', 'fold', 'htmlq', 'imagemagick', 'mmdc', 'op', 'pandoc', 'pdfimages', 'pdfinfo', 'pdftk', 'pdftoppm', 'pdftotext', 'qpdf', 'sips', 'soffice', 'ssconvert', 'unrtf', 'wkhtmltopdf', 'xz'];
test('every required command has a portable integration profile', async () => {
  const manifest = JSON.parse(await readFile('packages/safe-bash/package.json', 'utf8'));
  expect(manifest.exports["./core"]).toMatchObject({workerd: "./dist/core.browser.js", browser: "./dist/core.browser.js", import: "./dist/core.js"});
  for (const name of commands) {
    expect(manifest.poeCode.integration.privateWorkspaces['safe-bash-command-' + name]?.portable, name).toBe(true);
  }
});

const directories: string[] = [];
function collectDirectories(directory: string) {
  directories.push(directory);
  for (const entry of readdirSync(directory, {withFileTypes: true}))
    if (entry.isDirectory()) collectDirectories(path.join(directory, entry.name));
}
for (const workspace of createWorkspaceBuildPlan(process.cwd()).workspaces) {
  const name = path.basename(workspace.path);
  if (name.startsWith('safe-bash-command-') || ['safe-bash', 'safe-bash-query-engine', 'safe-bash-compression-engine', 'safe-fs'].includes(name))
    collectDirectories(path.join(workspace.path, 'src'));
}
test.each(directories)('%s binds Buffer locally instead of requiring the host global', directory => {
  const failures: string[] = [];
  function visit(directory: string) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) continue;
      if (!filename.endsWith('.ts') || filename.endsWith('.d.ts') || filename.includes('.test.') || filename.includes('.test-') || ['fixtures.ts', 'helpers.ts', 'test-helpers.ts', 'translit-fixtures.ts'].includes(entry.name)) continue;
      const contents = readFileSync(filename, 'utf8');
      if (!contents.includes('Buffer.')) continue;
      const source = ts.createSourceFile(filename, contents, ts.ScriptTarget.Latest, true);
      let usesBuffer = false;
      let localBuffer = false;
      function inspect(node: ts.Node) {
        if (ts.isClassDeclaration(node) && node.name?.text === "Buffer" || ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "Buffer") localBuffer = true;
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Buffer') usesBuffer = true;
        ts.forEachChild(node, inspect);
      }
      inspect(source);
      if (usesBuffer && !localBuffer && !source.statements.some(statement => ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) && statement.importClause.namedBindings.elements.some(element => element.name.text === 'Buffer'))) failures.push(filename);
    }
  }
  visit(directory);
  expect(failures).toEqual([]);
});

test('the trap subpath selects a portable signal catalog in workerd', async () => {
  const manifest = JSON.parse(await readFile('packages/safe-bash/package.json', 'utf8'));
  expect(manifest.exports['./trap'].workerd).toBe('./dist/trap.browser.js');
  expect(manifest.exports['./trap'].browser).toBe('./dist/trap.browser.js');
});
