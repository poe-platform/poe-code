import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const receipt=JSON.parse(readFileSync(new URL('./CANDIDATE.json',import.meta.url)));
const baseReceipt=JSON.parse(readFileSync(new URL('../../integration/full-gate-20260827/unified76-driver/amendment-v2/driver/CANDIDATE.json',import.meta.url)));
assert.equal(receipt.base,baseReceipt.candidate);
const git=(args,options={})=>execFileSync('git',['--no-replace-objects',...args],{maxBuffer:32*1024*1024,...options});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const revision of [baseReceipt.base,baseReceipt.fixtureSourceCommit,receipt.rootSource,receipt.moduleSource])git(['merge-base','--is-ancestor',revision,'HEAD']);
for(const row of receipt.changes){assert.equal(git(['rev-parse',`${row.sourceRevision}:${row.path}`]).toString().trim(),row.blob);assert.equal(sha(git(['show',`${row.sourceRevision}:${row.path}`])),row.sha256);}
const treeObjects=git(['ls-tree','-rd',baseReceipt.base]).toString().trim().split('\n').map(line=>line.split(/\s+/u)[2]);
const objects=[baseReceipt.base,git(['rev-parse',`${baseReceipt.base}^{tree}`]).toString().trim(),...treeObjects,...baseReceipt.changes.map(row=>row.afterBlob),...receipt.changes.map(row=>row.blob)];
const pack=git(['pack-objects','--stdout'],{input:[...new Set(objects)].join('\n')+'\n'});
const results=[];
for(const suffix of ['first','with spaces']){
  const root=mkdtempSync(join(tmpdir(),'which77-reconstruct-')),directory=join(root,suffix);mkdirSync(directory);
  git(['init','--bare',directory]);const env={...process.env,GIT_DIR:directory,GIT_INDEX_FILE:join(root,'index'),GIT_ALTERNATE_OBJECT_DIRECTORIES:'',GIT_OBJECT_DIRECTORY:join(directory,'objects')};
  assert.notEqual(spawnSync('git',['cat-file','-e',receipt.candidate],{env}).status,0);assert.notEqual(spawnSync('git',['cat-file','-e',baseReceipt.candidate],{env}).status,0);
  git(['index-pack','--stdin'],{env,input:pack});git(['read-tree',baseReceipt.base],{env});
  for(const row of baseReceipt.changes){assert.equal(sha(git(['cat-file','blob',row.afterBlob],{env})),row.afterSha256);git(['update-index','--add','--cacheinfo','100644',row.afterBlob,row.path],{env});}
  assert.equal(git(['write-tree','--missing-ok'],{env}).toString().trim(),baseReceipt.tree);const baseRaw=Buffer.from(baseReceipt.rawCommitBase64,'base64');assert.equal(sha(baseRaw),baseReceipt.rawCommitSha256);assert.equal(git(['hash-object','-w','-t','commit','--stdin'],{env,input:baseRaw}).toString().trim(),baseReceipt.candidate);
  git(['read-tree',baseReceipt.candidate],{env});for(const row of receipt.changes){assert.equal(sha(git(['cat-file','blob',row.blob],{env})),row.sha256);git(['update-index','--add','--cacheinfo','100644',row.blob,row.path],{env});}
  const tree=git(['write-tree','--missing-ok'],{env}).toString().trim();assert.equal(tree,receipt.tree);const raw=Buffer.from(receipt.rawCommitBase64,'base64');assert.equal(sha(raw),receipt.rawCommitSha256);assert.match(raw.toString(),new RegExp(`^tree ${tree}\nparent ${receipt.base}\n`,'u'));const commit=git(['hash-object','-w','-t','commit','--stdin'],{env,input:raw}).toString().trim();assert.equal(commit,receipt.candidate);results.push({directory,baseAndCandidateAbsentBefore:true,base:baseReceipt.candidate,tree,commit});
}
const result={candidate:receipt.candidate,base:baseReceipt.candidate,reachableInputs:[baseReceipt.base,baseReceipt.fixtureSourceCommit,receipt.rootSource,receipt.moduleSource],packBytes:pack.length,packSha256:sha(pack),results,qualification:'Minimal tree skeleton and selected blobs reconstruct both synthetic commits; actual other package inputs come from reachable44, not this minimal object pack',refsCreated:false};
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
