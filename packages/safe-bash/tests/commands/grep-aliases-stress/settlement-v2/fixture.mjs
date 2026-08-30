import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const originalSha256 = 'd454002f97fa37b6546bad238feec5472774646a6bf0d766fea32c2c0c32977b';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const fixturePatch = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixture.patch'), 'utf8');
export const cases = [
  { id: 'S07', label: 'borrowed-external-Shell-stdin-return-rejection-not-waived' },
  { id: 'ROOT-CONTROL', label: 'public-registered-grep-reproduces-external-return-failure' }
];
export function changes() {
  const segments = fixturePatch.split('\n@@\n');
  assert.equal(segments.shift(), '*** Begin Patch\n*** Update File: holdouts.mts');
  assert.equal(segments.length, 2);
  return segments.map((segment, index) => {
    const lines = segment.replace(/\n\*\*\* End Patch\n$/, '').split('\n');
    assert.ok(lines.every(line => line.startsWith('-') || line.startsWith('+')));
    return { ...cases[index], before: lines.filter(line => line.startsWith('-')).map(line => line.slice(1)).join('\n'), after: lines.filter(line => line.startsWith('+')).map(line => line.slice(1)).join('\n') };
  });
}
export function derive(original) {
  assert.equal(sha256(original), originalSha256);
  let derived = original;
  const deltas = changes();
  const spans = [];
  for (const delta of deltas) {
    assert.equal(derived.split(delta.before).length, 2, delta.label);
    const start = original.indexOf(delta.before);
    const label = original.lastIndexOf(`['${delta.label}', async () => {`, start);
    assert.ok(label >= 0 && start - label < 650, delta.label);
    assert.equal(original.indexOf('finally { await shell.dispose(); }', start), start + delta.before.indexOf('finally { await shell.dispose(); }'));
    derived = derived.replace(delta.before, delta.after);
    spans.push({ ...cases[spans.length], start, originalBytes: Buffer.byteLength(delta.before), derivedBytes: Buffer.byteLength(delta.after), beforeSha256: sha256(delta.before), afterSha256: sha256(delta.after) });
  }
  let restored = derived;
  for (const delta of deltas) { assert.equal(restored.split(delta.after).length, 2); restored = restored.replace(delta.after, delta.before); }
  assert.equal(restored, original, 'Every byte outside the two authorized hunks must remain identical');
  const mask = (text, key) => deltas.reduce((value, delta, index) => value.replace(delta[key], `<AUTHORIZED-SETTLEMENT-${index}>`), text);
  assert.equal(mask(original, 'before'), mask(derived, 'after'));
  return { derived, receipt: { originalSha256, patchSha256: sha256(fixturePatch), derivedSha256: sha256(derived), unchangedRemainderSha256: sha256(mask(original, 'before')), reversibleByteExactOutsideTwoHunks: true, spans } };
}
export function applyToNewDirectory(original, destination, executable) {
  const { derived, receipt } = derive(original);
  const addition = `*** Begin Patch\n*** Add File: holdouts.mts\n${original.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const steps = [];
  for (const input of [addition, fixturePatch]) {
    const child = spawnSync(executable, [], { cwd: destination, input, timeout: 30000, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    steps.push({ status: child.status, signal: child.signal, error: child.error?.message ?? null, stdout: child.stdout, stderr: child.stderr });
    assert.equal(child.status, 0, child.stderr); assert.equal(child.signal, null); assert.equal(child.error, undefined);
  }
  assert.equal(readFileSync(join(destination, 'holdouts.mts'), 'utf8'), derived);
  return { ...receipt, applyPatchSteps: steps };
}
