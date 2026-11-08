import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function ownBytes(name) {
  const location = new URL(name, import.meta.url);
  const metadata = lstatSync(location);
  assert(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= 1048576, 'Bounded regular adapter input');
  return readFileSync(location);
}

export function prepareCmd22AssertionAdapter({ assertCaptureSource, contextSource, integritySource }) {
  const adaptation = JSON.parse(ownBytes('ADAPTATION.json'));
  for (const [name, bytes] of Object.entries({ 'assert-capture.mjs': assertCaptureSource, 'context.mjs': contextSource, 'integrity.mjs': integritySource })) {
    assert(bytes instanceof Uint8Array, 'Explicit authenticated source bytes required');
    assert.equal(sha256(bytes), adaptation.requiredBaseHashes[name], `Unbound base source: ${name}`);
  }
  let changed = Buffer.from(assertCaptureSource).toString('utf8');
  for (const edit of adaptation.edits) {
    assert.equal(changed.split(edit.before).length, 2, 'Exactly one frozen assertion anchor required');
    changed = changed.replace(edit.before, () => edit.after);
  }
  const files = new Map([['assert-capture.mjs', Buffer.from(changed)]]);
  for (const [target, source] of Object.entries(adaptation.additions)) files.set(target, ownBytes(source));
  for (const [name, bytes] of files) assert.equal(sha256(bytes), adaptation.outputHashes[name], `Exact successor assertion artifact: ${name}`);
  return {
    version: adaptation.version, files, state: 'PRESEAL_ONLY_NOT_EXECUTION_AUTHORIZATION',
    completeRecipe: false, grantsGO: false, candidateBinding: null,
    requiredFreshBindings: adaptation.requiredFreshBindings,
  };
}
