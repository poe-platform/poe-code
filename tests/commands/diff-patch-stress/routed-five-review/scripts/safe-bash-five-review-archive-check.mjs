import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {root,work,sha,save,git} from './safe-bash-five-review-tools.mjs';
for(const name of ['patch-quiet','stat-human']) assert.ok(existsSync(`/tmp/safe-bash-${name}.closed`));
const directory=join(root,'tests/commands/metadata-stress/sgid-feasibility');
const manifest=JSON.parse(readFileSync(join(directory,'MANIFEST.json')));
assert.equal(manifest.unresolvedOriginalCases,6);
const checks=manifest.records.map(record=> {
  const archived=readFileSync(join(directory,record.destination));
  const original=readFileSync(record.source.startsWith('/')?record.source:join(root,record.source));
  assert.equal(archived.length,record.bytes);assert.equal(sha(archived),record.sha256);assert.deepEqual(archived,original);
  return {...record,originalAndArchiveEqual:true};
});
const replay=JSON.parse(readFileSync(join(directory,'safe-bash-metadata-sgid-replay.json')));
const controls=JSON.parse(readFileSync(join(directory,'safe-bash-metadata-sgid-controls.json')));
for(const captured of [replay.before,replay.after,controls.before,controls.after]) {
  assert.equal(Object.keys(captured.files).length,97);
  assert.equal(sha(JSON.stringify(captured.files)),'1ae6a983ac29a446d4f5f9a444428b164e2ef171adba66a2813c57ddc63cc121');
}
assert.equal(replay.rows.length,6);
save(join(work,'sgid-archive-check.json'),{at:new Date().toISOString(),headLabel:git('rev-parse','HEAD'),checks,unresolvedCases:6,historicalInputHashes:97,historicalDigest:manifest.historicalConsumedInputDigest,originalsUnchanged:true,freshSGIDExecutionCount:0,permissionContractChangesByReviewer:0,limits:'Read-only verification of existing historical capture, not rerun or new compatibility evidence.'});
console.log('SGID archive verified: '+checks.length+' byte-identical artifacts; six historical failures retained, zero fresh SGID executions');
