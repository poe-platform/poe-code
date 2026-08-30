import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = name => JSON.parse(readFileSync(path.join(directory, name), 'utf8'));
const manifest = read('MANIFEST.json');
for (const entry of manifest.files) assert.equal(hash(readFileSync(path.join(directory, entry.name))), entry.sha256, entry.name);
const capture = read('capture.json');
const fixture = read('CASES.json');
const tuple = observation => ({ status: observation.status, stdoutHex: observation.stdoutHex, stderrHex: observation.stderrHex });
const bytes = text => Buffer.from(text).toString('hex');
const observation = (record, expectedText) => {
  assert.equal(record.error, null);
  assert.equal(record.signal, null);
  assert.deepEqual(tuple(record), { status: expectedText ? 0 : 1, stdoutHex: bytes(`${expectedText}\n`), stderrHex: '' });
};
const inspectSpans = (record, subject) => {
  assert.equal(record.compiled, 0);
  if (record.executed === record.noMatchCode) return null;
  assert.equal(record.executed, 0);
  for (const [start, end] of record.spans) {
    if (start === -1 && end === -1) continue;
    assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(end));
    assert.ok(start >= 0 && start <= end && end <= Buffer.byteLength(subject), `invalid public span ${start},${end}`);
  }
  assert.ok(record.spans[0][0] >= 0);
  return record.spans;
};
assert.equal(capture.failure, undefined);
assert.equal(capture.inputFreeze, '3cbcdc1aefb4007f819e36610bbabdc41c913be4');
assert.equal(capture.casesSha256, hash(readFileSync(path.join(directory, 'CASES.json'))));
assert.deepEqual(capture.before, capture.after);
for (const input of capture.before) assert.equal(hash(readFileSync(path.join(directory, input.name))), input.sha256);
for (const name of ['gnu', 'apple', 'compiler']) assert.deepEqual(capture.native[name], capture.nativeAfter[name]);
assert.equal(capture.rows.length, 18);
const five = new Map([['P-empty', ''], ['P-a', ''], ['P-aa', 'a'], ['P-aaa', ''], ['Q-empty', '']]);
let differences = 0;
let successfulLibc = 0;
for (const [index, row] of capture.rows.entries()) {
  const input = fixture.cases[index];
  assert.equal(row.id, input.id);
  assert.deepEqual(row.gnuPlus.arguments, ['+', input.subject, ':', input.pattern]);
  for (const name of ['gnuPortable', 'applePortable']) assert.deepEqual(row[name].arguments, [input.subject, ':', input.pattern]);
  assert.deepEqual(row.libc.arguments, [input.pattern, input.subject]);
  for (const record of [row.gnuPlus, row.gnuPortable, row.applePortable, row.libc, ...row.gnuPosixEnvironment ? [row.gnuPosixEnvironment] : []]) {
    assert.equal(record.error, null);
    assert.equal(record.signal, null);
    assert.equal(record.stderrHex, '');
  }
  assert.deepEqual(tuple(row.gnuPlus), tuple(row.gnuPortable));
  if (five.has(row.id)) {
    observation(row.gnuPlus, five.get(row.id));
    assert.deepEqual(tuple(row.gnuPlus), tuple(row.gnuPosixEnvironment));
  }
  if (JSON.stringify(tuple(row.gnuPlus)) !== JSON.stringify(tuple(row.applePortable))) differences++;
  assert.equal(row.libc.status, 0);
  const spans = inspectSpans(JSON.parse(Buffer.from(row.libc.stdoutHex, 'hex').toString()), input.subject);
  if (spans) successfulLibc++;
  const captured = spans && spans[1][0] >= 0 ? input.subject.slice(...spans[1]) : '';
  observation(row.applePortable, captured);
}
assert.equal(differences, 4);
assert.equal(successfulLibc, 15);
const triple = capture.rows.find(row => row.id === 'P-aaa');
const tripleLibc = JSON.parse(Buffer.from(triple.libc.stdoutHex, 'hex').toString());
assert.deepEqual(tripleLibc.spans.slice(0, 2), [[0, 3], [1, 2]]);
const empty = JSON.parse(Buffer.from(capture.rows.find(row => row.id === 'Q-empty').libc.stdoutHex, 'hex').toString());
assert.deepEqual(empty.spans.slice(0, 2), [[0, 0], [0, 0]]);
const malformed = structuredClone(tripleLibc);
malformed.spans[1] = [0, -1];
assert.throws(() => inspectSpans(malformed, 'aaa'), /invalid public span/);
const outside = structuredClone(tripleLibc);
outside.spans[1] = [0, 4];
assert.throws(() => inspectSpans(outside, 'aaa'), /invalid public span/);
assert.throws(() => observation(triple.gnuPlus, 'a'), { code: 'ERR_ASSERTION' });
const falseNoMatch = structuredClone(empty);
falseNoMatch.executed = falseNoMatch.noMatchCode;
assert.throws(() => assert.deepEqual(inspectSpans(falseNoMatch, ''), [[0, 0], [0, 0], [-1, -1]]), { code: 'ERR_ASSERTION' });
assert.equal(capture.cleanup.activeOwnedChildren, 0);
assert.equal(capture.cleanup.executionRootRemoved, true);
console.log('18 frozen cases; 77 native semantic observations; 5 original GNU tuples retained; 4 GNU/Apple disagreements; 4 validator negative controls detected. No product execution or conformance pass count.');
