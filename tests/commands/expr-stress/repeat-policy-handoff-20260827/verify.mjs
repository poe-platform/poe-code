import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(path.join(directory, 'MANIFEST.json')));
const git = args => execFileSync('/usr/bin/git', args, { cwd: root, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
const sources = new Map();
for (const source of manifest.sources) {
  const bytes = git(['show', `${source.commit}:${source.path}`]);
  assert.equal(bytes.length, source.bytes, source.path);
  assert.equal(hash(bytes), source.sha256, source.path);
  assert.equal(git(['rev-parse', `${source.commit}:${source.path}`]).toString().trim(), source.gitBlob);
  if (source.checkWorkingFile) assert.deepEqual(readFileSync(path.join(root, source.path)), bytes, source.path);
  sources.set(source.id, bytes);
}
const inventory = folder => readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
  assert.ok(!entry.isSymbolicLink(), entry.name);
  const filename = path.join(folder, entry.name);
  const relative = path.relative(directory, filename);
  if (entry.isDirectory()) return [{ path: relative, kind: 'directory' }, ...inventory(filename)];
  assert.ok(entry.isFile(), relative);
  if (relative === 'MANIFEST.json') return [];
  const bytes = readFileSync(filename);
  return [{ path: relative, kind: 'file', bytes: bytes.length, sha256: hash(bytes) }];
}).sort((left, right) => left.path.localeCompare(right.path));
assert.deepEqual(inventory(directory), manifest.entries);
const resolve = reference => reference.pointer.split('/').slice(1).reduce(
  (value, key) => value[key.replaceAll('~1', '/').replaceAll('~0', '~')],
  JSON.parse(sources.get(reference.source)),
);
const validateSpan = (span, maximum) => {
  assert.ok(Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end));
  assert.ok(span.start >= 0 && span.start <= span.end && span.end <= maximum);
};
for (const observation of manifest.observations) {
  const input = resolve(observation.inputReference);
  assert.deepEqual(input, observation.input);
  const candidate = resolve(observation.candidateReference);
  assert.deepEqual(candidate, observation.candidate);
  const result = candidate.result ?? candidate.internal;
  const command = candidate.command ?? candidate.cli;
  const argv = input.argv ?? ['+', input.subject, ':', input.pattern];
  assert.deepEqual(observation.invocation.argv, argv);
  assert.equal(observation.subjectHex, Buffer.from(argv[1]).toString('hex'));
  assert.equal(observation.patternHex, Buffer.from(argv[3]).toString('hex'));
  const subject = Buffer.from(argv[1]);
  assert.equal(result.offsetUnit, 'byte');
  assert.equal(result.matched, true);
  assert.equal(result.hasCapture, true);
  validateSpan(result.overall, subject.length);
  assert.equal(result.overall.start, 0);
  validateSpan(result.capture, result.overall.end);
  const captured = subject.subarray(result.capture.start, result.capture.end);
  assert.equal(command.stdoutHex, Buffer.concat([captured, Buffer.from('\n')]).toString('hex'));
  assert.equal(command.status, captured.length ? 0 : 1);
  assert.equal(command.stderrHex, '');
  assert.deepEqual(observation.nativeRecord, resolve(observation.nativeReference));
  assert.equal(observation.nativeExprSpans, 'not observed');
}
for (const observation of manifest.libcObservations) {
  assert.deepEqual(observation.record, resolve(observation.reference));
  const command = observation.record.libc;
  assert.equal(command.status, 0);
  assert.equal(command.stderrHex, '');
  assert.equal(command.error, null);
  assert.equal(command.signal, null);
  const result = JSON.parse(Buffer.from(command.stdoutHex, 'hex'));
  assert.equal(result.compiled, 0);
  assert.equal(result.executed, 0);
  const maximum = Buffer.byteLength(command.arguments[1]);
  for (const [start, end] of result.spans) {
    if (start === -1 && end === -1) continue;
    validateSpan({ start, end }, maximum);
  }
}
for (const receipt of manifest.receipts) {
  assert.equal(receipt.status, 0);
  assert.equal(receipt.signal, null);
  assert.equal(receipt.error, null);
  assert.equal(receipt.stderrHex, '');
}
console.log(JSON.stringify({ sourceBindings: manifest.sources.length, frozenRows: manifest.observations.length,
  libcRows: manifest.libcObservations.length, ownedEntrySetVerified: true, newSemanticExecutions: 0, promotion: false }));
