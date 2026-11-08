import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const destination = process.argv[2];
assert.ok(destination, 'Pass a unique isolated capture output directory');
mkdirSync(destination, { recursive: false });
const owner = dirname(destination);
const root = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const corpusBytes = readFileSync(join(root, 'data/corpus.json'));
assert.equal(sha256(corpusBytes), 'a745efbc79d4c48d31b6a5e3e5e5fe51de0bd19f1a51dd66d984abc24f7161a8');
const corpus = JSON.parse(corpusBytes);
const decode = fixture => Buffer.from(fixture.hex ?? fixture.utf8, fixture.hex === undefined ? 'utf8' : 'hex');
const nativeDirectory = '/private/tmp/safe-bash-gnu-grep-3.12.MJXqupXn/build/src';
const pins = {
  grep: 'e6f4094b2abbe43e2740d6bc32481a1e6bc3de86a754db23c920ddec56a48743',
  egrep: '6848c4b9df827591f8af3d846c98b4766d262f06c440efb8b6535eb6accac084',
  fgrep: 'e512071d46a7816b96564588c5ebbd1b9189212aa4130e453eb7cdcaabd30f9a'
};
const archive = '/private/tmp/safe-bash-gnu-grep-3.12.MJXqupXn/download/grep-3.12.tar.xz';
assert.equal(sha256(readFileSync(archive)), '2649b27c0e90e632eadcd757be06c6e9a4f48d941de51e7c0f83ff76408a07b9');
for (const [name, hash] of Object.entries(pins)) assert.equal(sha256(readFileSync(join(nativeDirectory, name))), hash);
const nativeRoot = mkdtempSync(join(owner, 'gnu-native-'));
const environment = { PATH: `${nativeDirectory}:/usr/bin:/bin`, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: join(nativeRoot, 'home'), TMPDIR: nativeRoot };
mkdirSync(environment.HOME);
const result = { classification: 'raw-GNU-native-capture-not-candidate-results', startedAt: new Date().toISOString(), corpusSha256: sha256(corpusBytes), helperSha256: sha256(readFileSync(fileURLToPath(import.meta.url))), nativeDirectory, pins, archiveSha256: sha256(readFileSync(archive)), environment, nativeRoot, stderrTransformations: [], candidateRuns: 0, nativeChildCount: 0, versions: [], records: [], bounds: { timeoutMs: 2000, maxBufferBytes: 65536, killSignal: 'SIGKILL', concurrency: 1 }, exactOwnedNativeRootRemoved: false };
const effects = directory => Object.fromEntries(readdirSync(directory).sort().map(name => [name, readFileSync(join(directory, name)).toString('hex')]));
function run(command, args, cwd, input) {
  const child = spawnSync(join(nativeDirectory, command), args, { cwd, env: environment, input, encoding: null, timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 65536 });
  result.nativeChildCount += 1;
  return { executable: join(nativeDirectory, command), args, cwd, stdinHex: input.toString('hex'), stdoutHex: (child.stdout ?? Buffer.alloc(0)).toString('hex'), stderrHex: (child.stderr ?? Buffer.alloc(0)).toString('hex'), status: child.status, signal: child.signal, launchError: child.error ? { message: child.error.message, code: child.error.code ?? null } : null };
}
try {
  for (const command of Object.keys(pins)) result.versions.push(run(command, ['--version'], nativeRoot, Buffer.alloc(0)));
  for (const row of corpus.cases) {
    const cwd = join(nativeRoot, row.id);
    mkdirSync(cwd);
    for (const [name, fixture] of Object.entries(row.files)) {
      assert.match(name, /^[A-Za-z0-9_.-]+$/);
      writeFileSync(join(cwd, name), decode(corpus.fixtures[fixture]));
    }
    const filesBeforeHex = effects(cwd);
    const runs = [1, 2].map(repeat => ({ repeat, ...run(row.command, row.args, cwd, decode(corpus.fixtures[row.stdin])), filesAfterHex: effects(cwd) }));
    result.records.push({ id: row.id, filesBeforeHex, runs });
  }
} finally {
  rmSync(nativeRoot, { recursive: true, force: false });
  result.exactOwnedNativeRootRemoved = true;
  result.endedAt = new Date().toISOString();
  writeFileSync(join(destination, 'captures.json'), `${JSON.stringify(result, null, 2)}\n`);
}
for (const [name, hash] of Object.entries(pins)) assert.equal(sha256(readFileSync(join(nativeDirectory, name))), hash);
assert.equal(result.records.length, 26);
for (const record of result.records) {
  const [first, second] = record.runs;
  for (const run of record.runs) {
    assert.equal(run.launchError, null);
    assert.equal(run.signal, null);
    assert.deepEqual(run.filesAfterHex, record.filesBeforeHex);
  }
  for (const field of ['stdoutHex', 'stderrHex', 'status']) assert.equal(first[field], second[field]);
}
console.log(JSON.stringify({ rows: result.records.length, nativeChildren: result.nativeChildCount, repeatAgreement: 26, candidateRuns: 0, captureSha256: sha256(readFileSync(join(destination, 'captures.json'))) }, null, 2));
