import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url)), repo = resolve(own, '../../../..');
const candidate = 'eba049535d154f4e028f57ffd8efd7622b2239ca', baseline = 'a03b9288a6f4b652387be9fefa8faf17ef58b9e7';
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('/usr/bin/git', ['--no-replace-objects', ...args], { cwd: repo, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 128 * 1024 * 1024 });
const binding = JSON.parse(git(['show', 'f27b7b595c529d26161a21cf86d2a86fc0d2cee3:tests/integration/owned-output-production-rebase/author/SOURCE-CANDIDATE.json']));
assert.equal(git(['rev-parse', candidate + '^{tree}']).toString().trim(), '62d75ef09e89d4d3b6afc032c518d2846dcd03b7');
const paths = binding.sourcePaths.map(entry => entry.path);
for (const entry of binding.sourcePaths) assert.equal(hash(git(['show', candidate + ':' + entry.path])), entry.sha256, entry.path);
const patch = git(['diff', '--binary', baseline, candidate, '--', ...paths]);
assert.equal(hash(patch), '83b339002970df881efb56cc50fa0e0e74f1f832edb6c8706287827a3dc5e4ad');
const commitPaths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', candidate]).toString().trim().split('\n').sort();
assert.deepEqual(commitPaths.filter(path => path.startsWith('src/')), [...paths].sort());
assert.deepEqual(commitPaths.filter(path => !path.startsWith('src/')), ['helpers.ts', 'network.test.ts', 'operation.test.ts', 'public-consumer.mts.data', 'shell.test.ts'].map(name => 'tests/integration/owned-output-production-rebase/author/' + name));
for (const path of ['src/commands/network/shared.ts', 'src/commands/network/input.ts']) {
  const before = git(['ls-tree', baseline, '--', path]).toString();
  const after = git(['ls-tree', candidate, '--', path]).toString(); assert.equal(after, before, path);
}
const work = realpathSync(mkdtempSync(join(tmpdir(), 'owned-output-independent-'))), product = join(work, 'product'), consumer = join(work, 'consumer');
for (const directory of [product, consumer, join(work, 'pack'), join(consumer, 'node_modules/virtual-bash'), join(work, 'home')]) mkdirSync(directory, { recursive: true });
const rootFiles = git(['ls-tree', candidate]).toString().trim().split('\n').filter(line => line.split('\t')[0].includes(' blob ')).map(line => line.split('\t')[1]);
const selected = ['src', 'scripts', ...rootFiles];
execFileSync('/usr/bin/tar', ['-xf', '-', '-C', product], { input: git(['archive', candidate, ...selected]), maxBuffer: 128 * 1024 * 1024 });
const entries = git(['ls-tree', '-r', candidate, '--', ...selected]).toString().trim().split('\n').map(line => { const [header, path] = line.split('\t'); return { path, blob: header.split(' ')[2] }; });
const inputs = {};
for (const entry of entries) {
  const bytes = readFileSync(join(product, entry.path));
  assert.equal(createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex'), entry.blob, entry.path);
  inputs[entry.path] = hash(bytes);
}
symlinkSync(join(repo, 'node_modules'), join(product, 'node_modules'), 'dir');
writeFileSync(join(work, 'empty.npmrc'), '');
writeFileSync(join(work, 'empty-global.npmrc'), '');
const env = { ...process.env, PATH: dirname(node) + ':/usr/bin:/bin', HOME: join(work, 'home'), npm_config_cache: join(work, 'npm-cache'), npm_config_userconfig: join(work, 'empty.npmrc'), npm_config_globalconfig: join(work, 'empty-global.npmrc'), npm_config_ignore_scripts: 'true', npm_config_offline: 'true' };
const commands = [];
function run(id, args, cwd = product) {
  const result = spawnSync(node, args, { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(join(work, id + '.stdout'), result.stdout ?? ''); writeFileSync(join(work, id + '.stderr'), result.stderr ?? '');
  commands.push({ id, status: result.status, signal: result.signal }); assert.equal(result.status, 0, id + result.stdout + result.stderr); return result.stdout;
}
run('build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']);
const npm = '/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm/bin/npm-cli.js';
const packed = JSON.parse(run('pack', [npm, 'pack', '--json', '--ignore-scripts', '--offline', '--pack-destination', join(work, 'pack')]))[0];
const tarball = join(work, 'pack', packed.filename);
execFileSync('/usr/bin/tar', ['-xf', tarball, '--strip-components=1', '-C', join(consumer, 'node_modules/virtual-bash')]);
writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
function inventory(directory) {
  return Object.fromEntries(readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).flatMap(entry => {
    const path = join(directory, entry.name); if (entry.isDirectory()) return Object.entries(inventory(path)).map(([name, digest]) => [entry.name + '/' + name, digest]);
    assert(entry.isFile()); return [[entry.name, hash(readFileSync(path))]];
  }));
}
for (const name of ['CASES.json', 'assert-observation.mjs']) cpSync(join(own, '..', name), join(consumer, name));
const state = { candidate, baseline, candidateTree: binding.candidateTree, patchSHA256: hash(patch), work, product, consumer, node, nodeSHA256: hash(readFileSync(node)), packageSHA256: hash(readFileSync(tarball)), packageJsonSHA256: hash(readFileSync(join(product, 'package.json'))), tarball, commands, inputs, installed: inventory(join(consumer, 'node_modules/virtual-bash')), frozenCasesSHA256: hash(readFileSync(join(consumer, 'CASES.json'))) };
writeFileSync(join(work, 'STATE.json'), JSON.stringify(state, null, 2) + '\n');
writeFileSync('/tmp/owned-output-independent-current.json', JSON.stringify({ work, state: join(work, 'STATE.json') }) + '\n');
console.log(JSON.stringify({ work, candidate, packageSHA256: state.packageSHA256, installedFiles: Object.keys(state.installed).length, archiveFiles: entries.length }));
