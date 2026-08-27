import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertPositiveDepthFailure as v1 } from './history/v1-predicate.mjs';
import { assertPositiveDepthFailure as v2 } from './n18-predicate.mjs';
import { peerVectors, independentPositiveVariants, subjectAndDiagnosticNegatives } from './peer-vectors.mjs';

const reply = (stderr) => ({ exitCode: 2, stdout: new Uint8Array(), stderr: new TextEncoder().encode(stderr) });
test('peer failure history is reproduced with the actual unchanged v1 helper, not approved', () => {
  for (const vector of peerVectors) assert.doesNotThrow(() => v1(reply(vector.stderr)));
});
for (const vector of peerVectors) {
  test(`v2 pure peer countercheck: ${vector.id}`, () => {
    if (vector.semanticallyAcceptable) assert.doesNotThrow(() => v2(reply(vector.stderr)));
    else assert.throws(() => v2(reply(vector.stderr)), assert.AssertionError);
  });
}
for (const [index, stderr] of independentPositiveVariants.entries()) {
  test(`v2 finite-profile independent positive ${index + 1}`, () => assert.doesNotThrow(() => v2(reply(stderr))));
}
for (const [name, stderr] of subjectAndDiagnosticNegatives) {
  test(`v2 whole-diagnostic rejection: ${name}`, () => assert.throws(() => v2(reply(stderr)), assert.AssertionError));
}
test('reversible helper delta is exact', async () => {
  const delta = JSON.parse(await readFile(new URL('./helper-delta.json', import.meta.url), 'utf8'));
  const v1Text = await readFile(new URL('./history/v1-predicate.mjs', import.meta.url), 'utf8');
  const v2Text = await readFile(new URL('./n18-predicate.mjs', import.meta.url), 'utf8');
  const reconstruct = (excluded) => `${delta.operations.filter((entry) => entry.tag !== excluded).map((entry) => entry.text).join('\n')}\n`;
  assert.equal(reconstruct('+'), v1Text);
  assert.equal(reconstruct('-'), v2Text);
});
