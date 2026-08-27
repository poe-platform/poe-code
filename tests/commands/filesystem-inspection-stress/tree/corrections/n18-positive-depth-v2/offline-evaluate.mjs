import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPositiveDepthFailure as v1 } from './history/v1-predicate.mjs';
import { assertPositiveDepthFailure as v2 } from './n18-predicate.mjs';
import { peerVectors } from './peer-vectors.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function accepted(predicate, reply) {
  try { predicate(reply); return true; }
  catch (error) { assert.ok(error instanceof assert.AssertionError); return false; }
}
const peerObservations = peerVectors.map((vector) => {
  const reply = { exitCode: 2, stdout: new Uint8Array(), stderr: new TextEncoder().encode(vector.stderr) };
  const observation = { ...vector, v1Accepted: accepted(v1, reply), v2Accepted: accepted(v2, reply), evaluation: 'pure builtin mock bytes only' };
  assert.equal(observation.v1Accepted, true);
  assert.equal(observation.v2Accepted, vector.semanticallyAcceptable);
  return observation;
});
await writeFile(join(directory, 'peer-countercheck-results.json'), `${JSON.stringify({ recordedAt: new Date().toISOString(), peerObservations,
  v1Verdict: 'HOLD remains; false accepts reproduced', v2Verdict: 'pending peer review; concrete peer negatives rejected', productExecutions: 0, nativeExecutions: 0 }, null, 2)}\n`, { flag: 'wx' });
const captures = [];
for (const [label, path] of [['initial-product-N18', 'history/initial-N18-observations.json'], ['historical-v1-fresh-product-N18', 'history/v1-N18-observations.json']]) {
  const bytes = await readFile(join(directory, path));
  const invocation = JSON.parse(bytes).invocations[0];
  const output = (stream) => Buffer.concat(invocation[stream].filter((entry) => entry.state === 'fulfilled').map((entry) => Buffer.from(entry.attemptedBase64, 'base64')));
  const reply = { exitCode: invocation.result.exitCode, stdout: output('stdout'), stderr: output('stderr') };
  const offlineAccepted = accepted(v2, reply);
  assert.equal(offlineAccepted, true);
  captures.push({ label, capturePath: path, captureSha256: hash(bytes), capturedSourceCommit: 'e2d1b9230f4304650651572395523ca9d1644e74',
    capturedExitCode: reply.exitCode, capturedStdoutBase64: reply.stdout.toString('base64'), capturedStderrBase64: reply.stderr.toString('base64'),
    offlineV2Accepted: offlineAccepted, newProductExecution: false });
}
const nativeBytes = await readFile(join(directory, 'derived/native.json'));
const native = JSON.parse(nativeBytes).find((entry) => entry.id === 'N18');
assert.equal(accepted(v2, { exitCode: native.exitCode, stdout: Buffer.from(native.stdoutBase64, 'base64'), stderr: Buffer.from(native.stderrBase64, 'base64') }), true);
captures.push({ label: 'original-native-N18-capture', capturePath: 'derived/native.json', captureSha256: hash(nativeBytes), capturedExitCode: native.exitCode,
  capturedStdoutBase64: native.stdoutBase64, capturedStderrBase64: native.stderrBase64, offlineV2Accepted: true, newNativeExecution: false });
await writeFile(join(directory, 'offline-capture-evaluation.json'), `${JSON.stringify({ evaluatedAt: new Date().toISOString(), mode: 'OFFLINE_CAPTURE_BYTES_ONLY', captures,
  predicateSha256: hash(await readFile(join(directory, 'n18-predicate.mjs'))), productExecutions: 0, nativeExecutions: 0, newSourceCases: 0,
  unchangedHistory: 'Initial raw38 and v1 one-fresh execution remain historical. No new semantic cohort/pass count is claimed. V1 HOLD is not lifted by this offline check.',
  nativeParity: 'Original native status1 versus historical product status2 and differing diagnostic bytes remain not-parity',
  sourceSafetyFix: 'In progress elsewhere; not inspected, imported, or executed here. Full38 awaits a separate freeze, peer GO, and root authorization.' }, null, 2)}\n`, { flag: 'wx' });

function applyDifference(source, difference, reverse = false) {
  const input = source.split('\n').slice(0, -1);
  const lines = difference.split('\n').slice(0, -1);
  const output = [];
  let cursor = 0;
  let index = 2;
  while (index < lines.length) {
    const header = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/u.exec(lines[index++]);
    assert.ok(header);
    const start = Number(header[reverse ? 3 : 1]) - 1;
    const consumedExpected = Number(header[reverse ? 4 : 2]);
    const producedExpected = Number(header[reverse ? 2 : 4]);
    assert.ok(start >= cursor);
    output.push(...input.slice(cursor, start));
    cursor = start;
    let consumed = 0;
    let produced = 0;
    while (index < lines.length && !lines[index].startsWith('@@')) {
      const line = lines[index++];
      const tag = reverse ? ({ '+': '-', '-': '+', ' ': ' ' })[line[0]] : line[0];
      assert.ok([' ', '-', '+'].includes(tag));
      const text = line.slice(1);
      if (tag !== '+') { assert.equal(input[cursor++], text); consumed++; }
      if (tag !== '-') { output.push(text); produced++; }
    }
    assert.equal(consumed, consumedExpected);
    assert.equal(produced, producedExpected);
  }
  output.push(...input.slice(cursor));
  return `${output.join('\n')}\n`;
}
const before = await readFile(join(directory, 'history/v1-predicate.mjs'), 'utf8');
const after = await readFile(join(directory, 'n18-predicate.mjs'), 'utf8');
const difference = await readFile(join(directory, 'helper.diff'), 'utf8');
assert.equal(applyDifference(before, difference), after);
assert.equal(applyDifference(after, difference, true), before);
await writeFile(join(directory, 'diff-roundtrip.json'), `${JSON.stringify({ forward: 'exact-v2', reverse: 'exact-v1', method: 'pure builtin unified-diff application, no external diff/patch process',
  v1Sha256: hash(before), v2Sha256: hash(after), diffSha256: hash(difference), productExecutions: 0, nativeExecutions: 0 }, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ peerNegativeResults: peerObservations.filter((entry) => !entry.semanticallyAcceptable).map(({ id, v1Accepted, v2Accepted }) => ({ id, v1Accepted, v2Accepted })),
  offlineCapturedRecordsAccepted: captures.length, newProductExecutions: 0, newNativeExecutions: 0, diffRoundtrip: 'exact-both-directions', peerVerdict: 'pending' }));
