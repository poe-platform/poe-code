import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { owned, save, sha256 } from './support.mjs';
import { pinned, profileIdentity, registryTruth, safePluginTuple, strictTuple } from './review-checks.mjs';

const native = JSON.parse(await readFile(resolve(owned, 'native-role-corrected.json')));
const row = native.profiles[0].rows.find(row => row.id === 'control/exact-tuple');
const expected = { stdout: row.result.stdout, stderr: row.result.stderr, status: row.result.status, effects: row.effects };
const observations = [];
function reject(name, mutate) { const changed = structuredClone(expected); mutate(changed); const rejected = !strictTuple(expected, changed); assert.ok(rejected, name); observations.push({ name, rejected }); }
assert.ok(strictTuple(expected, structuredClone(expected)));
reject('same-status-corrupted-stderr', changed => { changed.stderr = ''; });
reject('wrong-status-correct-bytes', changed => { changed.status = 0; });
reject('stdout-byte-loss', changed => { changed.stdout = Buffer.from('firstlast\n').toString('base64'); });
reject('missing-stderr-field', changed => { delete changed.stderr; });
reject('file-byte-loss', changed => { changed.effects.result.base64 = ''; });
reject('file-mode-loss', changed => { changed.effects.result.mode = 0o666; });
const identity = { profile: 'gnu53', role: 'bash', commandName: 'profile-review', locale: 'C', source: 'printf "%s" "$0"; :\ncommand -z true', args: ['-c', 'literal', 'profile-review'] };
for (const [field, value] of [['profile', 'apple32'], ['commandName', 'shell'], ['source', `:\n${identity.source}`]]) {
  const rejected = !profileIdentity(identity, { ...identity, [field]: value }); assert.ok(rejected); observations.push({ name: `identity-${field}-switch`, rejected });
}
const fingerprint = sha256(JSON.stringify(expected));
const rewritten = structuredClone(expected); rewritten.stderr = '';
observations.push({ name: 'mass-golden-rewrite', rejected: !pinned(rewritten, fingerprint) });
const safe = safePluginTuple('control/registry-truth', '/work');
assert.ok(registryTruth('control/registry-truth', '/work', safe, { printfRegistered: true }));
const spoof = { ...safe, stdout: Buffer.from('true is a shell builtin\nprintf is a shell builtin\nbuiltin\nbuiltin\n').toString('base64') };
observations.push({ name: 'native-builtin-label-spoof', rejected: !registryTruth('control/registry-truth', '/work', spoof, { printfRegistered: true }) });
observations.push({ name: 'false-registry-membership', rejected: !registryTruth('control/registry-truth', '/work', safe, { printfRegistered: false }) });
assert.equal(observations.length, 12); assert.ok(observations.every(row => row.rejected));
save('negative-controls.json', { capturedAt: new Date().toISOString(), checkerSha256: sha256(await readFile(resolve(owned, 'review-checks.mjs'))), nativeSha256: sha256(await readFile(resolve(owned, 'native-role-corrected.json'))), validControls: 2, mutants: observations, limits: 'Independent checker controls only. Author candidate assertions have not been read or executed; candidate mutation injection remains mandatory in the later review.' });
console.log(JSON.stringify({ rejectedMutants: observations.length, positiveControls: 2 }));
