import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const recipe = dirname(fileURLToPath(import.meta.url)), scope = resolve(recipe, '..'), repository = resolve(scope, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = fs.readFileSync(join(recipe, 'MANIFEST.json')); assert.equal(hash(manifestBytes), process.argv[3]); assert.match(process.argv[2] ?? '', /^[a-f0-9]{40}$/u);
const manifest = JSON.parse(manifestBytes), node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node', git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
assert.equal(process.execPath, node); assert.equal(process.version, 'v22.22.2'); assert.equal(hash(fs.readFileSync(node)), '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011'); assert.equal(hash(fs.readFileSync(git)), '10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9');
let gitReturns = 0;
const get = (...args) => { const bytes = execFileSync(git, ['--no-replace-objects', '--no-optional-locks', '-C', repository, ...args], { timeout: 15000, maxBuffer: 32 * 1024 ** 2, env: { PATH: '/usr/bin:/bin', HOME: scope, TMPDIR: scope, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' } }); gitReturns++; return bytes; };
const files = { ...manifest.files, 'MANIFEST.json': process.argv[3] };
assert.deepEqual(fs.readdirSync(recipe).sort(), Object.keys(files).sort());
for (const [name, expected] of Object.entries(files)) {
  assert.ok(name && !name.includes('/') && name !== 'AGENTS.md'); const path = join(recipe, name); assert.ok(fs.lstatSync(path).isFile()); assert.equal(hash(fs.readFileSync(path)), expected);
  assert.equal(hash(get('show', `${process.argv[2]}:tests/commands/timeout-independent-20260828/repaired-f22-v1/recipe/${name}`)), expected);
}
const bindings = JSON.parse(fs.readFileSync(join(recipe, 'BINDINGS.json')));
assert.equal(bindings.candidate, 'a23867d6a42e1cb2f2e7278cf22061737a4bea9d'); assert.equal(bindings.baseline, '5137a74ec855a32d8a8860eb66b62eb44d11e290');
for (const row of bindings.protectedRows) { assert.ok(!row.path.split('/').includes('AGENTS.md')); const path = join(repository, row.path); assert.ok(fs.lstatSync(path).isFile()); assert.equal(hash(fs.readFileSync(path)), row.sha256, row.path); }
const listing = commit => get('ls-tree', '-r', commit).toString().trim().split('\n').map(line => { const [header, path] = line.split('\t'); const [mode, type, blob] = header.split(' '); return { path, mode, type, blob }; });
const selected = listing(bindings.baseline).filter(row => (row.path.startsWith('src/') || ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'].includes(row.path)) && !row.path.startsWith('src/commands/timeout/'));
selected.push(...listing(bindings.candidate).filter(row => row.path.startsWith('src/commands/timeout/')));
assert.equal(selected.length, bindings.inputs.length);
for (const row of bindings.inputs) {
  assert.ok(!row.path.split('/').includes('AGENTS.md')); const actual = selected.find(entry => entry.path === row.path); assert.ok(actual); assert.equal(actual.type, 'blob'); assert.equal(actual.mode, row.mode); assert.equal(actual.blob, row.blob);
  const bytes = get('cat-file', 'blob', row.blob); assert.equal(hash(bytes), row.sha256); assert.equal(bytes.length, row.bytes);
}
process.env.TIMEOUT_AUTH_GIT_RETURNS = String(gitReturns);
await import('./executor.mjs');
