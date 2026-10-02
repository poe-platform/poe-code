import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'vitest';
import ts from 'typescript';
import { adapterStatements } from './fixtures/command-adapter-statements.js';

const commands = ['apply-patch', 'awk', 'cmp', 'column', 'csplit', 'docx', 'du', 'expr', 'factor', 'file', 'find', 'getopt', 'hexdump', 'html-to-markdown', 'iconv', 'install', 'pptx', 'pr', 'split', 'tar', 'timeout', 'tree', 'truncate', 'tsort', 'which', 'xan'];
const json = (path: string) => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const root = json('package.json');
const shell = json('packages/safe-bash/package.json');
test('html-to-markdown owns its rendering and limit regression suites and builds unit prerequisites', () => {
  const files = readdirSync(new URL('../packages/safe-bash-command-html-to-markdown/src/', import.meta.url));
  for (const name of ['render', 'limits', 'repair', 'adversarial']) assert.ok(files.includes(`${name}.test.ts`), `Missing owned ${name} suite`);
  const turbo = json('turbo.json');
  assert.ok(turbo.tasks['safe-bash-command-html-to-markdown#test:unit'].dependsOn.includes('^build'));
});
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
        const evaluator = 'evalSync' + command.split('-').map(part => part[0]!.toUpperCase() + part.slice(1)).join('');
        assert.ok(adapterStatements(parsed, name, evaluator).every(statement => {
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
    const evaluator = 'evalSync' + command[0]!.toUpperCase() + command.slice(1);
    assert.ok(adapterStatements(parsed, `safe-bash-command-${command}`, evaluator, './internal.js').every(statement => ts.isExportDeclaration(statement)
      && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text === `safe-bash-command-${command}`));
  });
}

test('adapter registration does not admit implementation, incomplete wiring or foreign evaluators', () => {
  const registration = 'import { syncCommandEvaluators } from "../internal.js"; import { evalSyncDu } from "safe-bash-command-du"; syncCommandEvaluators.evalSyncDu = evalSyncDu;';
  const remaining = (text: string) => adapterStatements(ts.createSourceFile('index.ts', text, ts.ScriptTarget.Latest, true), 'safe-bash-command-du', 'evalSyncDu');
  assert.equal(remaining(registration).length, 0);
  assert.equal(remaining(registration + 'function implementation() {}').length, 1);
  for (const invalid of [registration.replace('= evalSyncDu', '= () => {}'), registration.replace('safe-bash-command-du', 'foreign'), registration + registration, registration.slice(registration.indexOf(';') + 1)]) {
    assert.ok(remaining(invalid).length > 0);
  }
});

test('awk legacy modules forward to the private owner without a return dependency', () => {
  const name = 'safe-bash-command-awk';
  const pkg = json(`packages/${name}/package.json`);
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    assert.ok(!Object.keys(pkg[field] ?? {}).some(value => ['@poe-platform/safe-bash', 'poe-code'].includes(value)));
  }
  const directory = new URL('../packages/safe-bash/src/commands/text-programs/', import.meta.url);
  for (const entry of readdirSync(directory).filter(value => value.startsWith('awk') && value.endsWith('.ts'))) {
    const parsed = ts.createSourceFile(entry, readFileSync(new URL(entry, directory), 'utf8'), ts.ScriptTarget.Latest, true);
    assert.equal(parsed.statements.length, 1);
    const statement = parsed.statements[0]!;
    assert.ok(ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier));
    assert.equal(statement.moduleSpecifier.text, `${name}/${entry.slice(0, -3)}`);
  }
});


test('grep owns matching, file selection and aliases above an independent search leaf', () => {
  const owner = 'safe-bash-command-grep';
  const pkg = json(`packages/${owner}/package.json`);
  assert.equal(pkg.private, true);
  for (const entry of ['grep', 'grep-files', 'aliases', 'alias-options']) {
    const source = readFileSync(new URL(`../packages/${owner}/src/${entry}.ts`, import.meta.url), 'utf8');
    assert.ok(source.length > 100, `${entry} must own its implementation`);
  }
  for (const name of ['safe-bash-search-engine', 'safe-bash-command-rg', 'safe-bash-io-engine']) {
    const manifest = json(`packages/${name}/package.json`);
    assert.ok(!manifest.devDependencies[owner], `${name} must not depend on grep`);
  }
  for (const entry of ['grep', 'grep-files']) {
    const source = readFileSync(new URL(`../packages/safe-bash/src/commands/search/${entry}.ts`, import.meta.url), 'utf8');
    assert.equal(source.trim(), `export * from "${owner}/${entry}";`);
  }
});

test('install owns its argument regressions and builds canonical prerequisites', () => {
  const files = readdirSync(new URL('../packages/safe-bash-command-install/src/', import.meta.url));
  assert.ok(files.includes('grammar.test.ts'));
  const turbo = json('turbo.json');
  assert.ok(turbo.tasks['safe-bash-command-install#test:unit'].dependsOn.includes('^build'));
});


test('find owns direct option regressions while Shell retains integration coverage', () => {
  const files = readdirSync(new URL('../packages/safe-bash-command-find/src/', import.meta.url));
  for (const name of ['options.test.ts', 'expression.test.ts', 'expression.ts', 'invocation.ts', 'find-format.ts', 'find.ts']) {
    assert.ok(files.includes(name), `Missing find ownership: ${name}`);
  }
  const shellTests = readdirSync(new URL('../packages/safe-bash/tests/commands/', import.meta.url));
  assert.ok(!shellTests.includes('find-options.test.ts'));
  for (const name of ['find-printf.test.ts', 'find-time-delete.test.ts', 'find-deleted-entry.test.ts']) assert.ok(shellTests.includes(name));
});


test('du owns regression coverage and declares unit build prerequisites', () => {
  const files = readdirSync(new URL('../packages/safe-bash-command-du/src/', import.meta.url));
  assert.ok(files.includes('accounting.test.ts'));
  const turbo = json('turbo.json');
  assert.ok(turbo.tasks['safe-bash-command-du#test:unit'].dependsOn.includes('^build'));
});

test('split owns its behavioral regressions and extraction plan', () => {
  const files = readdirSync(new URL('../packages/safe-bash-command-split/src/', import.meta.url));
  for (const name of ['buffer-admission', 'options-compatibility', 'elide']) assert.ok(files.includes(`${name}.test.ts`), `Missing owned ${name} suite`);
  assert.ok(readFileSync(new URL('../docs/plans/safe-bash-command-split.md', import.meta.url), 'utf8').includes('private'));
  assert.ok(json('turbo.json').tasks['safe-bash-command-split#test:unit'].dependsOn.includes('^build'));
});

test('tree owns its report-count regressions and builds unit prerequisites', () => {
  const files = readdirSync(new URL('../packages/safe-bash-command-tree/src/', import.meta.url));
  assert.ok(files.includes('report-counts.test.ts'), 'Missing owned report-count suite');
  const turbo = json('turbo.json');
  assert.ok(turbo.tasks['safe-bash-command-tree#test:unit'].dependsOn.includes('^build'));
});

test('hexdump owns direct regressions and declares unit build prerequisites', () => {
  const files = readdirSync(new URL('../packages/safe-bash-command-hexdump/src/', import.meta.url));
  for (const name of ['native.test.ts', 'fresh.test.ts', 'path.test.ts', 'lifecycle.test.ts', 'acquisition-close.test.ts']) assert.ok(files.includes(name), `Missing hexdump ownership: ${name}`);
  const turbo = json('turbo.json');
  assert.ok(turbo.tasks['safe-bash-command-hexdump#test:unit'].dependsOn.includes('^build'));
});
