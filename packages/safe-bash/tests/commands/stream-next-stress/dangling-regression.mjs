import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, readdirSync, lstatSync, readlinkSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, '../../..');
const run = process.argv[2];
if (!run || !resolve(run).startsWith(join(owned, '.private/review-'))) throw new Error('Supply an owned emitted-review snapshot');
const source = JSON.parse(readFileSync(join(run, 'snapshot.json'), 'utf8'));
const releasePath = process.argv[3] ?? '/tmp/safe-bash-stream-next-review.ready';
const releaseDocument = readFileSync(releasePath, 'utf8');
const release = releasePath.endsWith('.json') ? JSON.parse(releaseDocument).rootRelease : releaseDocument;
if (!release.includes('CLOSED') || !release.includes(source.sourceCommit)) throw new Error('Snapshot not authorized by root release');
const scratch = mkdtempSync(join(owned, '.private/dangling-'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fixture = { id: 'post-discovery-dangling-output', command: 'split', args: ['-b2', 'input', 'out.'], stdin: '', locale: 'C', files: [{ path: 'input', type: 'file', bytes: Buffer.from('abc').toString('base64') }, { path: 'out.aa', type: 'symlink', target: 'target' }] };
const initial = JSON.parse(readFileSync(join(owned, 'evidence/initial/dangling-regression.json'), 'utf8'));
assert.deepEqual(fixture, initial.expected.fixture, 'Post-discovery input must remain unchanged');
const snapshot = cwd => readdirSync(cwd).sort().map(path => lstatSync(join(cwd, path)).isSymbolicLink()
  ? { path, type: 'symlink', target: readlinkSync(join(cwd, path)) }
  : { path, type: 'file', bytes: readFileSync(join(cwd, path)).toString('base64') });
const native = [];
for (const [profile, binary] of [['gnu-darwin', join(repository, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/split')], ['apple', '/usr/bin/split']]) {
  const cwd = mkdtempSync(join(scratch, 'native-'));
  writeFileSync(join(cwd, 'input'), 'abc');
  symlinkSync('target', join(cwd, 'out.aa'));
  const result = spawnSync(binary, fixture.args, { cwd, env: { LC_ALL: 'C', LANG: 'C' }, input: '', timeout: 3000 });
  assert.equal(result.error, undefined);
  native.push({ profile, binary, binarySha256: sha256(readFileSync(binary)), argv: [binary, ...fixture.args], env: { LC_ALL: 'C', LANG: 'C' }, status: result.status, stdout: result.stdout.toString('base64'), stderr: result.stderr.toString('base64'), after: snapshot(cwd) });
}
assert.deepEqual(native, initial.expected.native, 'Pinned supplementary native profiles must remain unchanged before product execution');
const expected = { recordedAt: new Date().toISOString(), sourceCommit: source.sourceCommit, fixture, native, origin: 'Root-disclosed author gap, separately frozen before this regression product execution; not part of original82 independent holdouts.' };
const expectedText = JSON.stringify(expected, null, 2) + '\n';
writeFileSync(join(scratch, 'native-before-product.json'), expectedText);
const frozenSha256 = sha256(expectedText);
const emitted = join(run, 'snapshot/emitted/src');
const { Shell } = await import(pathToFileURL(join(emitted, 'shell/index.js')).href);
const { MemoryFileSystem } = await import(pathToFileURL(join(emitted, 'fs/memory/index.js')).href);
const { RealFileSystem } = await import(pathToFileURL(join(emitted, 'fs/real/index.js')).href);
const { agentCommands } = await import(pathToFileURL(join(emitted, 'plugins/index.js')).href);
const { splitCommands } = await import(pathToFileURL(join(emitted, 'commands/split/index.js')).href);
const actual = [];
for (const backend of ['memory', 'real']) {
  const root = join(scratch, `real-${backend}`);
  mkdirSync(root);
  const fs = backend === 'memory' ? new MemoryFileSystem() : new RealFileSystem(root);
  await fs.mkdir('/fixture');
  await fs.writeFile('/fixture/input', Buffer.from('abc'));
  await fs.symlink('target', '/fixture/out.aa');
  const shell = new Shell({ fs, cwd: '/fixture', env: { LC_ALL: 'C', LANG: 'C' } }).use(agentCommands()).use(splitCommands());
  try {
    const result = await shell.exec('split -b2 input out.');
    const after = [];
    for (const entry of (await fs.readdir('/fixture')).sort((left, right) => left.name.localeCompare(right.name))) {
      after.push(entry.type === 'symlink' ? { path: entry.name, type: 'symlink', target: await fs.readlink(`/fixture/${entry.name}`) }
        : { path: entry.name, type: 'file', bytes: Buffer.from(await fs.readFile(`/fixture/${entry.name}`)).toString('base64') });
    }
    actual.push({ backend, status: result.exitCode, stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64'), after });
  } finally { await shell.dispose(); }
}
const outcome = record => ({ status: record.status, stdout: record.stdout, stderr: record.stderr, after: record.after });
const strict = actual.filter(record => JSON.stringify(outcome(record)) === JSON.stringify(outcome(native[0]))).length;
const document = { expected, frozenBeforeProductSha256: frozenSha256, observedAt: new Date().toISOString(), sourceTreeSha256: source.sourceTreeSha256, runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))), actual, strict, executions: actual.length };
writeFileSync(join(scratch, 'result.json'), JSON.stringify(document, null, 2) + '\n');
console.log(JSON.stringify({ scratch, sourceCommit: source.sourceCommit, frozenBeforeProductSha256: frozenSha256, native, actual, strict, executions: actual.length }, null, 2));
process.exitCode = strict === actual.length ? 0 : 1;
