import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {candidate,git,sha} from './common.mjs';
assert.deepEqual(process.argv.slice(2),['--restore-exact-objects']);
for(const revision of [candidate.base,candidate.fixtureSourceCommit])git(['merge-base','--is-ancestor',revision,'HEAD']);
const temporary=mkdtempSync(join(tmpdir(),'unified76-restore-')),env={...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_INDEX_FILE:join(temporary,'index')};
git(['read-tree',candidate.base],{env});
for(const entry of candidate.changes){const bytes=git(['show',`${candidate.fixtureSourceCommit}:${entry.path}`]);assert.equal(sha(bytes),entry.afterSha256);const blob=git(['rev-parse',`${candidate.fixtureSourceCommit}:${entry.path}`]).toString().trim();assert.equal(blob,entry.afterBlob);git(['update-index','--add','--cacheinfo','100644',blob,entry.path],{env});}
assert.equal(git(['write-tree'],{env}).toString().trim(),candidate.tree);
const raw=Buffer.from(candidate.rawCommitBase64,'base64');assert.equal(sha(raw),candidate.rawCommitSha256);
assert.equal(git(['hash-object','-w','-t','commit','--stdin'],{input:raw}).toString().trim(),candidate.candidate);
console.log(JSON.stringify({candidate:candidate.candidate,tree:candidate.tree,temporary,refsCreated:false,sharedIndexWritten:false}));
