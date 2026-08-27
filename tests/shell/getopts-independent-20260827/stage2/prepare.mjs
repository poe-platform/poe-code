import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scripts } from './corpus.mjs';
import { owned, baseline, hash, inventory, save, verifyPhase1 } from './lib.mjs';

assert(!fs.existsSync(path.join(owned, 'freeze-manifest.json')), 'never overwrite freeze');
const observation = baseline();
assert.equal(observation.registration, 'notregistered', 'unexpected Stage2 chronology boundary: stop before inspecting implementation');
const invariants = JSON.parse(fs.readFileSync(path.join(owned, 'invariants.json')));
assert.equal(scripts.length, 16);
assert.equal(invariants.controls.length, 12);
assert.equal(new Set(scripts.map(entry => entry.id)).size, scripts.length);
assert(scripts.every(entry => entry.productScript.length < 8192));
save('baseline.json', { ...observation, phase1: verifyPhase1(), stage2Ownership: 'WITHHELD to Poincare until explicit Sagan release; concurrent commits are not release', priorFamiliarity: 'Phase1 source and P03/T20 captures already inspected; historical author Stage2 native evidence read before this freeze. Not blind to those findings.' });
const entries = inventory(owned);
const files = Object.fromEntries(Object.entries(entries).filter(([, entry]) => entry.type === 'file'));
save('freeze-manifest.json', {
  format: 'independent-stage2-freeze-v1', frozenAt: new Date().toISOString(), baselineCommit: observation.commit, files,
  scripts: scripts.map(entry => ({ id: entry.id, productBytes: Buffer.byteLength(entry.productScript), productSHA256: hash(Buffer.from(entry.productScript)), completeControlSHA256: hash(Buffer.from(JSON.stringify(entry))) })),
  invariants: invariants.controls.map(entry => ({ id: entry.id, sha256: hash(Buffer.from(JSON.stringify(entry))) })),
  requiredCommitBeforeNative: true, noCandidateExecution: true, counts: { nativeScripts: 16, hostProfileInvariants: 12, fixtureBodies: 2, pendingRootDecisions: 3 },
});
console.log(JSON.stringify({ frozen: true, scripts: 16, invariants: 12, baseline: observation.commit, registration: observation.registration, nativeExecuted: 0 }));
