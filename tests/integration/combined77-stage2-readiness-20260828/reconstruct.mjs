import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const chain=JSON.parse(readFileSync(new URL('./RECONSTRUCTION-CHAIN.json',import.meta.url)));
const git=(args,options={})=>execFileSync('git',['--no-replace-objects',...args],{timeout:60000,maxBuffer:32*1024*1024,...options});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const base=chain[0].base;
const changes=receipt=>receipt.changes.map(row=>({path:row.path,blob:row.afterBlob??row.blob,sha256:row.afterSha256??row.sha256,revision:row.revision??row.sourceRevision??receipt.fixtureSourceCommit}));
const anchors=[...new Set([base,...chain.flatMap(receipt=>changes(receipt).map(row=>row.revision))])];
for(const revision of anchors)git(['merge-base','--is-ancestor',revision,'HEAD']);
for(const receipt of chain)for(const row of changes(receipt)){assert.equal(git(['rev-parse',`${row.revision}:${row.path}`]).toString().trim(),row.blob);assert.equal(sha(git(['show',`${row.revision}:${row.path}`])),row.sha256);}
const trees=git(['ls-tree','-rd',base]).toString().trim().split('\n').map(line=>line.split(/\s+/u)[2]);
const objects=[base,git(['rev-parse',`${base}^{tree}`]).toString().trim(),...trees,...chain.flatMap(receipt=>changes(receipt).map(row=>row.blob))];
const pack=git(['pack-objects','--stdout'],{input:[...new Set(objects)].join('\n')+'\n'});
const results=[];
for(const suffix of ['first','with spaces']){
  const root=mkdtempSync(join(tmpdir(),'combined77-reconstruct-')),directory=join(root,suffix);mkdirSync(directory);git(['init','--bare','--quiet',directory]);
  const env={...process.env,GIT_DIR:directory,GIT_INDEX_FILE:join(root,'index'),GIT_ALTERNATE_OBJECT_DIRECTORIES:'',GIT_OBJECT_DIRECTORY:join(directory,'objects')};
  for(const receipt of chain)assert.notEqual(spawnSync('git',['cat-file','-e',receipt.candidate],{env}).status,0);
  git(['index-pack','--stdin'],{env,input:pack});
  const commits=[];
  for(const receipt of chain){git(['read-tree',receipt.base],{env});for(const row of changes(receipt)){assert.equal(sha(git(['cat-file','blob',row.blob],{env})),row.sha256);git(['update-index','--add','--cacheinfo','100644',row.blob,row.path],{env});}const tree=git(['write-tree','--missing-ok'],{env}).toString().trim();assert.equal(tree,receipt.tree);const raw=Buffer.from(receipt.rawCommitBase64,'base64');assert.equal(sha(raw),receipt.rawCommitSha256);assert.match(raw.toString(),new RegExp(`^tree ${tree}\nparent ${receipt.base}\n`,'u'));const commit=git(['hash-object','-w','-t','commit','--stdin'],{env,input:raw}).toString().trim();assert.equal(commit,receipt.candidate);commits.push({commit,tree});}
  results.push({directory,allThreeSyntheticCommitsAbsentInitially:true,commits});
}
const report={candidate:chain.at(-1).candidate,reachableAnchors:anchors,packBytes:pack.length,packSha256:sha(pack),results,qualification:'Three exact synthetic commits reconstructed from reachable tree skeletons/selected blobs and recorded raw commit bodies; full unchanged product content comes from reachable44, not the small reconstruction pack',refsCreated:false};
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
