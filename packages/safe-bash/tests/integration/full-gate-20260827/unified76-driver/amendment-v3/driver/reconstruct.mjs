import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const receipt=JSON.parse(readFileSync(new URL('./CANDIDATE.json',import.meta.url)));
const git=(args,options={})=>execFileSync('git',['--no-replace-objects',...args],{maxBuffer:32*1024*1024,...options});
for(const revision of [receipt.base,receipt.fixtureSourceCommit])git(['merge-base','--is-ancestor',revision,'HEAD']);
const treeObjects=git(['ls-tree','-rd',receipt.base]).toString().trim().split('\n').map(line=>line.split(/\s+/u)[2]);
const objects=[receipt.base,git(['rev-parse',`${receipt.base}^{tree}`]).toString().trim(),...treeObjects,...receipt.changes.map(e=>e.afterBlob)];
for(const entry of receipt.changes)assert.equal(git(['rev-parse',`${receipt.fixtureSourceCommit}:${entry.path}`]).toString().trim(),entry.afterBlob);
const pack=git(['pack-objects','--stdout'],{input:[...new Set(objects)].join('\n')+'\n'});
const raw=Buffer.from(receipt.rawCommitBase64,'base64');assert.equal(createHash('sha256').update(raw).digest('hex'),receipt.rawCommitSha256);
assert.equal(createHash('sha1').update(`commit ${raw.length}\0`).update(raw).digest('hex'),receipt.candidate);
const results=[];
for(const suffix of ['first','with spaces']){const root=mkdtempSync(join(tmpdir(),'unified76-reconstruct-')),directory=join(root,suffix);mkdirSync(directory);git(['init','--bare','--quiet',directory]);const env={...process.env,GIT_DIR:directory,GIT_INDEX_FILE:join(root,'index'),GIT_ALTERNATE_OBJECT_DIRECTORIES:'',GIT_OBJECT_DIRECTORY:join(directory,'objects')};git(['unpack-objects'],{env,input:pack});assert.notEqual(spawnSync('git',['cat-file','-e',receipt.candidate],{env}).status,0,'candidate must initially be absent');git(['read-tree',receipt.base],{env});for(const e of receipt.changes){assert.equal(createHash('sha256').update(git(['cat-file','blob',e.afterBlob],{env})).digest('hex'),e.afterSha256);git(['update-index','--add','--cacheinfo','100644',e.afterBlob,e.path],{env});}const tree=git(['write-tree','--missing-ok'],{env}).toString().trim();assert.equal(tree,receipt.tree);const commit=git(['hash-object','-w','-t','commit','--stdin'],{env,input:raw}).toString().trim();assert.equal(commit,receipt.candidate);assert.match(raw.toString(),new RegExp(`^tree ${tree}\nparent ${receipt.base}\n`,'u'));results.push({directory,absentBefore:true,tree,commit});}
const result={candidate:receipt.candidate,reachableBase:receipt.base,reachableFixtures:receipt.fixtureSourceCommit,packBytes:pack.length,qualification:'fresh minimal tree skeleton and four blobs reconstruct exact tree/commit; other product/evidence blobs remain supplied by the separately reachable full base, not by this skeleton',results};
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
