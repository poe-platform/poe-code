import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'vitest';
import ts from 'typescript';

const commands = ['apply-patch', 'cmp', 'column', 'csplit', 'docx', 'du', 'expr', 'factor', 'file', 'getopt', 'hexdump', 'html-to-markdown', 'iconv', 'install', 'pptx', 'pr', 'split', 'timeout', 'tree', 'truncate', 'tsort', 'which', 'xan'];
const json = (path: string) => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const root = json('package.json');
const shell = json('packages/safe-bash/package.json');
for (const command of commands) {
  test(`${command} ships through a registered private workspace and public adapter`, () => {
    const name = `safe-bash-command-${command}`;
    const pkg = json(`packages/${name}/package.json`);
    assert.equal(pkg.name, name);
    assert.equal(pkg.private, true);
    assert.equal(root.devDependencies[name], '*');
    assert.equal(shell.devDependencies[name], '*');
    assert.equal(shell.poeCode.integration.privateWorkspaces[name].version, pkg.version);
    const adapter = readFileSync(new URL(`../packages/safe-bash/src/commands/${command}/index.ts`, import.meta.url), 'utf8').trim();
    assert.ok(adapter.includes(`export * from "${name}";`));
    for (const entry of readdirSync(new URL(`../packages/safe-bash/src/commands/${command}/`, import.meta.url))) {
      if (entry.endsWith('.ts')) {
        const source = readFileSync(new URL(`../packages/safe-bash/src/commands/${command}/${entry}`, import.meta.url), 'utf8').trim();
        const parsed = ts.createSourceFile(entry, source, ts.ScriptTarget.Latest, true);
        assert.ok(parsed.statements.every(statement => {
          if (ts.isImportDeclaration(statement)) return !statement.importClause
            && !statement.attributes && ts.isStringLiteral(statement.moduleSpecifier)
            && statement.moduleSpecifier.text === '../../portable-buffer.js';
          return ts.isExportDeclaration(statement)
            && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
            && (statement.moduleSpecifier.text === name || statement.moduleSpecifier.text.startsWith(name + '/'));
        }), `${entry} retains an implementation in the shell`);
      }
    }
  });
}

for (const command of ['cmp', 'truncate']) {
  test(`${command} legacy registrations contain no second implementation`, () => {
    const source = readFileSync(new URL(`../packages/safe-bash/src/commands/${command}.ts`, import.meta.url), 'utf8');
    const parsed = ts.createSourceFile(`${command}.ts`, source, ts.ScriptTarget.Latest, true);
    assert.ok(parsed.statements.every(statement => ts.isExportDeclaration(statement)
      && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text === `safe-bash-command-${command}`));
  });
}
