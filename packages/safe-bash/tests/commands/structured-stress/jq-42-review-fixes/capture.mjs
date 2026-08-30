import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { digest, sourceSnapshot } from '../jq-42-independent-review/common.mjs';
import { artifact } from './artifacts.mjs';

const executable = '/usr/bin/jq';
const executableSha256 = digest(readFileSync(executable));
assert.equal(executableSha256, '1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f');
const environment = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', NO_COLOR: '1', PATH: '/usr/bin:/bin' };
const native = (argv, input) => {
  const result = spawnSync(executable, argv, { input, env: environment, timeout: 3000, maxBuffer: 65536 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { status: result.status, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex') };
};
const version = native(['--version'], Buffer.alloc(0));
assert.equal(Buffer.from(version.stdoutHex, 'hex').toString(), 'jq-1.7.1-apple\n');
const terms = [
  ['object-missing-value', '{"a":}'], ['object-space-value', '{"a":  }'],
  ['object-newline-value', '{"a":\n}'], ['object-unicode-key', '{"é":}'],
  ['object-wrong-value-close', '{"a":]'], ['nested-object-value', '[{"a":}]'],
  ['nested-array-value', '{"a":[}]'], ['array-wrong-close', '[}'],
  ['root-object-close', '}'], ['root-array-close', ']'],
  ['array-trailing-comma', '[1,]'], ['array-comma-wrong-close', '[1,}'],
  ['object-trailing-comma', '{"a":0,}'], ['object-key-wrong-close', '{]'],
  ['object-missing-colon', '{"a"}'], ['object-missing-colon-wrong-close', '{"a"]'],
  ['nested-comma', '[[],]'], ['nested-empty', '{"a":[]}'],
  ['empty-array', '[]'], ['empty-object', '{}'], ['valid-object', '{"a":1}'],
];
const cases = terms.flatMap(([id, term]) => [
  { id: `fromjson-${id}`, argv: ['-c', 'fromjson'], inputHex: Buffer.from(`${JSON.stringify(term)}\n`).toString('hex') },
  { id: `raw-fromjson-${id}`, argv: ['-Rsc', 'fromjson'], inputHex: Buffer.from(term).toString('hex') },
]);
for (const [id, term] of terms.filter(([id]) => ['object-missing-value', 'object-space-value', 'object-newline-value', 'object-unicode-key', 'array-trailing-comma', 'object-trailing-comma', 'empty-array', 'empty-object', 'valid-object'].includes(id))) {
  cases.push({ id: `json-${id}`, argv: ['-c', '.'], inputHex: Buffer.from(`${term}\n`).toString('hex') });
}
cases.push({ id: 'two-error-records', argv: ['-c', 'fromjson'], inputHex: '225b345d220a225b220a227b5c22615c223a7d220a2266616c7365220a' });
for (const vector of cases) {
  vector.expected = native(vector.argv, Buffer.from(vector.inputHex, 'hex'));
  vector.cohort = 'nearby';
  vector.allBoundaries = true;
}
artifact('native-frozen.json', { recordedAt: new Date().toISOString(), executable, executableSha256, version, environment, sourceBefore: sourceSnapshot(), cases });
console.log(JSON.stringify({ cases: cases.length, nativeInvocations: cases.length + 1, diagnostics: cases.filter(vector => vector.id.startsWith('fromjson-')).map(vector => [vector.id, Buffer.from(vector.expected.stderrHex, 'hex').toString()]) }, null, 2));
