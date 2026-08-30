import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { base, save } from './replay.mjs';

const initial = JSON.parse(readFileSync(`${base}/initial-ordinary-native-product.json`, 'utf8'));
const final = JSON.parse(readFileSync(`${base}/final-ordinary-native-product.json`, 'utf8'));
const typed = entries => Object.fromEntries(Object.entries(entries).map(([path, entry]) => [path, { type: entry.type, ...(entry.hex === undefined ? {} : { hex: entry.hex }), ...(entry.link === undefined ? {} : { link: entry.link }) }]));
const records = final.results.map((row, index) => {
  assert.deepEqual(row.fixture, initial.results[index].fixture);
  const native = row.natives.find(result => result.profile === 'gnu');
  assert.equal(row.virtual.status, native.status);
  assert.equal(row.virtual.stdoutHex, native.stdoutHex);
  assert.equal(row.virtual.stderrHex, native.stderrHex);
  assert.deepEqual(typed(row.virtual.after), typed(native.after));
  for (const [path, entry] of Object.entries(row.virtual.after)) {
    const before = row.virtual.before[path] ?? row.virtual.before['/work/target'];
    assert.equal(entry.mode, before.mode, path);
    assert.equal(entry.nlink, before.nlink, path);
  }
  for (const [nativeIndex, current] of row.natives.entries()) {
    const prior = initial.results[index].natives[nativeIndex];
    assert.equal(current.status, prior.status);
    assert.equal(current.stdoutHex, prior.stdoutHex);
    assert.equal(current.stderrHex, prior.stderrHex);
    assert.deepEqual(typed(current.after), typed(prior.after));
  }
  return { name: row.fixture.name, initialVirtualStatus: initial.results[index].virtual.status, finalVirtualStatus: row.virtual.status, gnuStatus: native.status, appleStatus: row.natives.find(result => result.profile === 'apple-calibration').status, exactGnuStreamsStatusTypedNamespace: true, virtualModesAndLinksPreserved: true };
});
save(`${base}/final-ordinary-evaluation.json`, { records, passed: records.length, failed: 0, coverage: 'Three existing repeated-hunk inputs rerun in ordinary/default-backup profile, not three new corpus cases. Atomic profile is separately recorded. Full native modes/link counts/identities retained without pretending Darwin and virtual directory nlink conventions match.' });
console.log(records);
