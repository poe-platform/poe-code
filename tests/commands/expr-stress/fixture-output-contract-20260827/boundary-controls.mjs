import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const [flag, destination] = process.argv.slice(2);
assert.equal(flag, '--capture');
assert(destination && /^[a-z0-9-]+$/.test(destination));
const output = join(owned, destination);
assert(!existsSync(output));
mkdirSync(output);
const save = (name, value) => writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const hash = value => createHash('sha256').update(value).digest('hex');
function inventory(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const absolute = join(directory, name), entry = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) return [{ path: entry, target: readlinkSync(absolute) }];
    if (stat.isDirectory()) return [{ path: entry, directory: true }, ...inventory(absolute, entry)];
    return [{ path: entry, sha256: hash(readFileSync(absolute)) }];
  });
}
const base = '21220b465537bf45ffcfb36740956a69f43bf75e';
const selected = ['src', 'package.json', 'tsconfig.json', 'tsconfig.build.json'];
const archive = spawnSync('git', ['archive', '--format=tar', base, ...selected], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
assert.equal(archive.status, 0);
const scratch = mkdtempSync(join(owned, '.boundary-'));
const dependencies = realpathSync(join(root, 'node_modules'));
const dependenciesBefore = inventory(dependencies);
try {
  const unpack = spawnSync('tar', ['-xf', '-', '-C', scratch], { input: archive.stdout });
  assert.equal(unpack.status, 0);
  symlinkSync(dependencies, join(scratch, 'node_modules'), 'dir');
  const sourceBefore = inventory(scratch);
  const build = spawnSync(process.execPath, [join(dependencies, 'typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { cwd: scratch, timeout: 120000 });
  save('build.json', { status: build.status, stdout: build.stdout?.toString(), stderr: build.stderr?.toString(), error: build.error?.message });
  assert.equal(build.status, 0);
  const builtBefore = inventory(scratch);
  const originalDriver = join(owned, 'before-01/frozen-runtime-driver.mjs');
  const frozen = spawnSync('git', ['show', 'd0fb3ef0:tests/commands/expr-stress/diagnostics-review/runtime-driver.mjs'], { cwd: root });
  assert.equal(frozen.status, 0);
  assert.deepEqual(readFileSync(originalDriver), frozen.stdout);
  const { run } = await import(pathToFileURL(originalDriver).href);
  const ordinary = await run({ installed: scratch, input: { id: 'measured-syntax', argv: ['1', 'x'] } });
  const diagnostic = Buffer.from(ordinary.stderrBase64, 'base64');
  assert.equal(diagnostic.toString(), "expr: syntax error: unexpected argument 'x'\n");
  assert.equal(diagnostic.length, 44);
  const observations = [];
  for (const maxOutputBytes of [diagnostic.length - 1, diagnostic.length]) {
    const input = { id: `measured-syntax-output-${maxOutputBytes}`, argv: ['1', 'x'], limits: { maxOutputBytes } };
    const actual = await run({ installed: scratch, input });
    observations.push({ input, actual, stdout: Buffer.from(actual.stdoutBase64, 'base64').toString(), stderr: Buffer.from(actual.stderrBase64, 'base64').toString() });
  }
  assert.equal(observations[0].actual.status, 3);
  assert.equal(observations[0].stderr, 'expr: output bytes limit exceeded\n');
  assert.equal(observations[1].actual.status, 2);
  assert.equal(observations[1].stderr, diagnostic.toString());
  for (const row of observations) assert.equal(row.stdout, '');
  save('observations.json', { base, classification: 'Separate measured boundary controls, not changed frozen syntax-output-one or new acceptance denominator.', correction: 'before-01 exploratory labels used guessed 41/42 boundaries; observed diagnostic is 44 bytes. Original labels/results are preserved and are not boundary proof. This capture derives 43/44 from observed bytes.', diagnosticBytes: diagnostic.length, ordinary, observations });
  assert.deepEqual(inventory(scratch), builtBefore);
  assert.deepEqual(inventory(dependencies), dependenciesBefore);
  save('integrity.json', { base, selected, archiveTarSha256: hash(archive.stdout), sourceBefore, builtBefore, appendAwareArchiveUnchanged: true, dependenciesUnchanged: true, dependenciesInventorySha256: hash(JSON.stringify(dependenciesBefore)), driverSha256: hash(frozen.stdout) });
  console.log(JSON.stringify(observations.map(row => ({ limit: row.input.limits.maxOutputBytes, status: row.actual.status, stderr: row.stderr }))));
} finally {
  rmSync(scratch, { recursive: true, force: true });
  save('cleanup.json', { scratch, removed: !existsSync(scratch), onlyOwnedScratchRemoved: true, end: new Date().toISOString() });
}
