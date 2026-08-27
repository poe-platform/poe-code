import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, symlinkSync, unlinkSync, realpathSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { owned, root, command, hash, save, inventory, git } from './prepare.mjs';

const { source, candidate } = JSON.parse(readFileSync(join(owned, 'provenance.json')));
const relativeOracle = 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr';
const native = realpathSync(join(root, relativeOracle));
const expectedHash = 'e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c';
assert.equal(hash(readFileSync(native)), expectedHash);
assert.equal(process.platform, 'darwin');
const before = inventory(source);
const probe = (executable, args, env = { LC_ALL: 'C', LANG: 'C', PATH: '/usr/bin:/bin', TZ: 'UTC' }) => {
  const observed = spawnSync(executable, args, { cwd: source, env, timeout: 3000, maxBuffer: 1024 * 1024 });
  assert.ifError(observed.error); assert.equal(observed.signal, null);
  return { status: observed.status, stdout: observed.stdout.toString(), stderr: observed.stderr.toString() };
};
const version = probe(native, ['--version']); assert(version.stdout.startsWith('expr (GNU coreutils) 9.7\n'));
const locale = ['C', 'C.UTF-8', 'en_US.UTF-8'].map(name => ({ name, charmap: probe('/usr/bin/locale', ['charmap'], { LC_ALL: name, LANG: name, PATH: '/usr/bin:/bin' }), scalar: probe(native, ['length', '😀'], { LC_ALL: name }) }));
assert.equal(locale[0].scalar.stdout, '4\n'); assert.equal(locale[1].scalar.stdout, '1\n'); assert.equal(locale[2].scalar.stdout, '1\n');
mkdirSync(dirname(join(source, relativeOracle)), { recursive: true });
symlinkSync(native, join(source, relativeOracle));
save('native-prerequisites.json', { platform: process.platform, release: probe('/usr/bin/uname', ['-a']), macOS: probe('/usr/bin/sw_vers', []), native, expectedHash, version, libraries: probe('/usr/bin/otool', ['-L', native]), locale, apple: { path: '/bin/expr', sha256: hash(readFileSync('/bin/expr')) }, declaredAdditions: inventory(source).filter(entry => !before.some(old => old.path === entry.path)), qualification: 'Authenticated GNU coreutils 9.7 on Darwin; not Linux. Explicit read-only symlink authorized for archived native prerequisites. Apple separately identified. No new native result captures committed.' });
try {
  const legacy = JSON.parse(readFileSync(join(source, 'tests/commands/expr-stress/diagnostics-candidate-review/replay/legacy-plan.json')));
  const shared = command('shared-legacy276', process.execPath, legacy.args, { cwd: source });
  const expr = readdirSync(join(source, 'tests/commands/expr')).filter(name => name.endsWith('.test.ts')).map(name => `tests/commands/expr/${name}`);
  const original = expr.filter(path => !['diagnostics-regression', 'named-profile', 'inactive-prefix'].some(name => path.endsWith(`/${name}.test.ts`)));
  const canonical = command('expr-legacy241-candidate', process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', ...original], { cwd: source });
  const author = command('source-author-additional', process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', ...expr.filter(path => !original.includes(path))], { cwd: source });
  const compiler = command('source-tests-strict', process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(source, 'tests/commands/expr/tsconfig.json'), '--skipLibCheck', 'false'], { cwd: source });
  const summary = entry => ({ name: entry.name, status: entry.status, counts: Object.fromEntries([...entry.stdout.matchAll(/^ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])])) });
  save('regression-summary.json', { candidate, shared: summary(shared), legacy: summary(canonical), author: summary(author), compiler: summary(compiler), exactSharedFileHashes: legacy.args.filter(path => path.endsWith('.ts')).map(path => ({ path, sha256: hash(readFileSync(join(source, path))), historical: legacy.identities.find(entry => entry.path === path)?.candidate })), originalFiles: original, authorFiles: expr.filter(path => !original.includes(path)), distinction: 'Archived source controls and author regressions are not independent frozen holdouts. One obsolete en_US length assertion remains unchanged. Historical 239/241 is not rewritten.' });
  console.log(JSON.stringify({ shared: summary(shared), legacy: summary(canonical), author: summary(author), compiler: compiler.status }));
} finally {
  unlinkSync(join(source, relativeOracle));
  rmSync(join(source, 'tests/commands/metadata-stress'), { recursive: true });
  assert.equal(hash(readFileSync(native)), expectedHash);
  assert.deepEqual(inventory(source), before, 'declared oracle additions removed, including added-entry detection');
  save('oracle-binding-cleanup.json', { removed: true, oracleHashUnchanged: true, sourceInventoryIncludingNewEntriesRestored: true });
}
