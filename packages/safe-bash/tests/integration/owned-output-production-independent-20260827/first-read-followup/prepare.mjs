import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const own = dirname(fileURLToPath(import.meta.url)), repo = resolve(own, '../../../..');
const old = JSON.parse(readFileSync(JSON.parse(readFileSync('/tmp/owned-output-independent-current.json')).state));
assert.equal(old.candidate, 'eba049535d154f4e028f57ffd8efd7622b2239ca');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(readFileSync(old.tarball)), '280b76a2a3577176716534e13d2e10475eb8a13e423190a24d25555a050f72e1');
const work = realpathSync(mkdtempSync(join(tmpdir(), 'owned-output-first-read-'))), consumer = join(work, 'consumer');
mkdirSync(join(consumer, 'node_modules/virtual-bash'), { recursive: true });
execFileSync('/usr/bin/tar', ['-xf', old.tarball, '--strip-components=1', '-C', join(consumer, 'node_modules/virtual-bash')]);
writeFileSync(join(consumer, 'package.json'), '{"type":"module","private":true}\n');
const ts = (await import(pathToFileURL(join(repo, 'node_modules/typescript/lib/typescript.js')))).default;
const inputs = {}, generated = {};
for (const [path, output, replacements] of [
  ['tests/stress/remote-cancellation/helpers.ts', 'helpers.mjs', [['"../../../src/index.js"', '"virtual-bash"'], ['"../../fs/webdav/mock.js"', '"./mock.mjs"']]],
  ['tests/fs/webdav/mock.ts', 'mock.mjs', [['"../../../src/fs/webdav/resource-id.js"', '"./node_modules/virtual-bash/dist/fs/webdav/resource-id.js"']]],
]) {
  const source = execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', repo, 'show', old.candidate + ':' + path]);
  inputs[path] = hash(source);
  let compiled = ts.transpileModule(source.toString(), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
  for (const [before, after] of replacements) { assert.equal(compiled.split(before).length, 2, path + ':' + before); compiled = compiled.replace(before, after); }
  writeFileSync(join(consumer, output), compiled); generated[output] = { sha256: hash(compiled), input: path, replacements };
}
for (const path of ['tests/shell/first-read-probe.ts', 'tests/shell/remote-close.test.ts']) inputs[path] = hash(execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', repo, 'show', old.candidate + ':' + path]));
function inventory(root) { return Object.fromEntries(readdirSync(root).sort().flatMap(name => {
  const path = join(root, name), stat = lstatSync(path); assert(!stat.isSymbolicLink(), path);
  if (stat.isDirectory()) return Object.entries(inventory(path)).map(([child, digest]) => [name + '/' + child, digest]);
  assert(stat.isFile()); return [[name, hash(readFileSync(path))]];
})); }
const installed = inventory(join(consumer, 'node_modules/virtual-bash')); assert.deepEqual(installed, old.installed);
cpSync(join(own, '../candidate-v1/audit-loader.mjs'), join(consumer, 'loader.mjs'));
const binding = { candidate: old.candidate, tree: old.candidateTree, packageSHA256: old.packageSHA256, node: old.node, nodeSHA256: hash(readFileSync(old.node)), work, consumer, installed, inputs, generated, compilerSHA256: hash(readFileSync(join(repo, 'node_modules/typescript/lib/typescript.js'))) };
writeFileSync(join(work, 'BINDING.json'), JSON.stringify(binding, null, 2));
writeFileSync('/tmp/owned-output-first-read-current.json', JSON.stringify({ work, binding: join(work, 'BINDING.json') }));
console.log(JSON.stringify({ work, candidate: binding.candidate, packageSHA256: binding.packageSHA256, files: Object.keys(installed).length }));
