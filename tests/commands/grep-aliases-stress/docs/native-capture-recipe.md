# Exact bounded native capture helper

This source ran once as `node /tmp/safe-bash-grep-aliases-verifier.VIG08c/capture-native.mjs`.
SHA-256: `47cdfb91de9f2b9e5f441b0fca8e8d2eae47f8f47eced6bebd913a0eb054e769`. Only its owned native fixture subtree
was created and removed; its full byte captures were transferred with apply_patch.
The JSON result was written before repeat assertions, so a failed assertion would
not erase the native observations. There were no failures in this execution.

For a later native-only replay, extract this code into a newly owned temporary
root, change only its `owner` constant, retain the original input and executable
pins, and record the changed helper hash separately. Never recapture over the
frozen files. Native availability is optional for tests consuming the goldens.
This recipe does not authorize candidate execution before the root handoff.

```javascript
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = '/Users/kjopek/Workspace/safe-bash';
const owner = '/tmp/safe-bash-grep-aliases-verifier.VIG08c';
const prefix = 'tests/commands/grep-aliases-stress';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const corpusBytes = readFileSync(join(root, prefix, 'data/corpus.json'));
const corpus = JSON.parse(corpusBytes);
assert.equal(sha256(corpusBytes), 'a745efbc79d4c48d31b6a5e3e5e5fe51de0bd19f1a51dd66d984abc24f7161a8');
assert.equal(corpus.cases.length, 26);
const decode = fixture => Buffer.from(fixture.hex ?? fixture.utf8, fixture.hex === undefined ? 'utf8' : 'hex');
const pins = {
  egrep: { path: '/usr/bin/egrep', sha256: '468ff46a0b9f0e88de268ce12640bfa37610d585f968127cf32cf4e86d5c70ab' },
  fgrep: { path: '/usr/bin/fgrep', sha256: '2146bcefd5e202919805f0b47701e4216ba636b994f272447301918267460062' }
};
const startedAt = new Date().toISOString();
const nativeRoot = mkdtempSync(join(owner, 'native-'));
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: join(nativeRoot, 'home'), TMPDIR: nativeRoot };
mkdirSync(environment.HOME);
const effects = directory => Object.fromEntries(readdirSync(directory).sort().map(name => [name, readFileSync(join(directory, name)).toString('hex')]));
let childCount = 0;
function capture(executable, args, cwd, input) {
  const result = spawnSync(executable, args, { cwd, input, env: environment, encoding: null, timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 65536, windowsHide: true });
  childCount += 1;
  return {
    executable,
    argv: args,
    cwd,
    stdinHex: input.toString('hex'),
    stdoutHex: (result.stdout ?? Buffer.alloc(0)).toString('hex'),
    stderrHex: (result.stderr ?? Buffer.alloc(0)).toString('hex'),
    status: result.status,
    signal: result.signal,
    launchError: result.error ? { name: result.error.name, code: result.error.code ?? null, message: result.error.message } : null
  };
}
const identities = {};
const records = [];
try {
  for (const [command, pin] of Object.entries(pins)) {
    assert.equal(sha256(readFileSync(pin.path)), pin.sha256);
    identities[command] = { ...pin, realpath: realpathSync(pin.path), version: capture(pin.path, ['--version'], nativeRoot, Buffer.alloc(0)) };
  }
  for (const row of corpus.cases) {
    const directory = join(nativeRoot, row.id);
    mkdirSync(directory);
    for (const [name, fixture] of Object.entries(row.files)) {
      assert.match(name, /^[A-Za-z0-9_.-]+$/);
      writeFileSync(join(directory, name), decode(corpus.fixtures[fixture]));
    }
    const filesBeforeHex = effects(directory);
    const runs = [1, 2].map(repeat => ({ repeat, ...capture(pins[row.command].path, row.args, directory, decode(corpus.fixtures[row.stdin])), filesAfterHex: effects(directory) }));
    records.push({ id: row.id, filesBeforeHex, runs });
  }
  for (const pin of Object.values(pins)) assert.equal(sha256(readFileSync(pin.path)), pin.sha256);
} finally {
  rmSync(nativeRoot, { recursive: true, force: false });
}
const result = {
  schemaVersion: 1,
  classification: 'raw-native-capture-data-not-typescript',
  startedAt,
  endedAt: new Date().toISOString(),
  profile: 'apple-bsd-grep-2.6.0-freebsd-darwin25.4-arm64-c-locale',
  candidateExecutions: 0,
  corpusSha256: sha256(corpusBytes),
  captureSourceSha256: sha256(readFileSync(new URL(import.meta.url))),
  environment,
  bounds: { timeoutMs: 2000, killSignal: 'SIGKILL', maxBufferBytes: 65536, nativeChildrenAtOnce: 1 },
  nativeChildCount: childCount,
  nativeRoot,
  exactOwnedNativeRootRemoved: true,
  stderrTransformations: [],
  identities,
  records
};
writeFileSync(join(owner, 'native-captures.json'), `${JSON.stringify(result, null, 2)}\n`);
assert.equal(records.length, 26);
for (const record of records) {
  const [first, second] = record.runs;
  for (const run of record.runs) {
    assert.equal(run.launchError, null);
    assert.equal(run.signal, null);
    assert.ok(Number.isInteger(run.status));
    assert.deepEqual(run.filesAfterHex, record.filesBeforeHex);
  }
  for (const field of ['status', 'stdoutHex', 'stderrHex']) assert.equal(first[field], second[field]);
}
console.log(JSON.stringify({ capturedCases: records.length, repeats: 2, nativeChildCount: childCount, candidateExecutions: 0, exactOwnedNativeRootRemoved: true }, null, 2));
for (const record of records) console.log(record.id, JSON.stringify({ status: record.runs[0].status, stdout: Buffer.from(record.runs[0].stdoutHex, 'hex').toString('utf8'), stderr: Buffer.from(record.runs[0].stderrHex, 'hex').toString('utf8') }));
```
