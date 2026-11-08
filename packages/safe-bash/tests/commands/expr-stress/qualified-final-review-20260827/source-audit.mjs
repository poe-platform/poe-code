import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { owned, root, git, hash, save, inventory, command } from './prepare.mjs';
const { source, installed, candidate } = JSON.parse(readFileSync(join(owned, 'provenance.json')));
const baseline = '21220b465537bf45ffcfb36740956a69f43bf75e';
const samePaths = ['src/commands/expr/bre-worker.ts', ...['client', 'protocol', 'worker', 'matching'].map(name => `src/commands/regex-execution/${name}.ts`)];
const unchanged = samePaths.map(path => ({ path, baseline: hash(git('show', `${baseline}:${path}`)), candidate: hash(readFileSync(join(source, path))) }));
for (const entry of unchanged) assert.equal(entry.baseline, entry.candidate);
assert.equal(git('diff', 'c433d023^', 'c433d023', '--', 'src').length, 0);
const prefixDiff = git('diff', '4f01c159^', '4f01c159', '--', 'src/commands/expr/evaluate.ts').toString();
assert.deepEqual(prefixDiff.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')), ['+    if (!active) return zero;']);
const exprInputs = inventory(join(source, 'src/commands/expr')).filter(entry => entry.type === 'file');
const disallowed = exprInputs.flatMap(entry => {
  const text = readFileSync(join(source, 'src/commands/expr', entry.path), 'utf8');
  return [...text.matchAll(/process\.env|Intl\.|node:child_process|node:fs/g)].map(match => ({ path: entry.path, text: match[0] }));
});
assert.deepEqual(disallowed, []);
const ts = await import(pathToFileURL(join(root, 'node_modules/typescript/lib/typescript.js')));
const pending = [join(installed, 'dist/commands/regex-execution/worker.js')], graph = [], visited = new Set();
while (pending.length) {
  const path = pending.pop(); if (visited.has(path)) continue; visited.add(path);
  const text = readFileSync(path, 'utf8'), tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), imports = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      if (!specifier.startsWith('node:')) { assert(specifier.startsWith('.')); const target = resolve(dirname(path), specifier); assert(target.startsWith(installed + '/')); pending.push(target); }
      imports.push(specifier);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree); graph.push({ path: path.slice(installed.length + 1), sha256: hash(text), imports });
}
save('source-audit.json', { candidate, baseline, unchanged, unpromotedRepeatCommit: git('rev-parse', 'c433d023').toString().trim(), repeatCommitHasNoSrcChanges: true, noPatchApplied: true, prefixDiff, exprInputs, disallowedAmbientOrHostImports: disallowed, compiledWorkerStaticGraph: graph, qualification: 'Static import closure only, not proof about arbitrary computed host imports. Dynamic runtime confinement and zero dependency manifest recorded separately.' });
const output = command('moved-runtime-flags', process.execPath, ['--unhandled-rejections=strict', '--max-old-space-size=256', join(owned, 'moved-runtime.mjs')], { cwd: dirname(dirname(installed)), env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', NODE_PATH: '', NODE_OPTIONS: '' } });
assert.equal(output.status, 0, output.stderr);
console.log(JSON.stringify({ unchanged: unchanged.length, staticGraph: graph.length, moved: JSON.parse(output.stdout).passed }));
