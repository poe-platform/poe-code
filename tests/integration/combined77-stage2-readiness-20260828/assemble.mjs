import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const freeze=JSON.parse(readFileSync(new URL('./FREEZE.json',import.meta.url)));
const fixtureSource=process.argv[2];assert.match(fixtureSource??'',/^[a-f0-9]{40}$/u);
const git=(args,options={})=>execFileSync('git',['--no-replace-objects',...args],{timeout:60000,maxBuffer:32*1024*1024,...options});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const output=mkdtempSync(join(tmpdir(),'combined77-stage2-assembly-'));
const env={...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_INDEX_FILE:join(output,'index')};
git(['read-tree',freeze.base],{env});
const changes=[];
for(const entry of freeze.sourcePaths){
  git(['merge-base','--is-ancestor',entry.revision,'HEAD']);const bytes=git(['show',`${entry.revision}:${entry.path}`]);
  assert.equal(sha(bytes),entry.sha256);assert.equal(git(['rev-parse',`${entry.revision}:${entry.path}`]).toString().trim(),entry.blob);
  git(['update-index','--add','--cacheinfo','100644',entry.blob,entry.path],{env});changes.push({...entry,bytes:bytes.length,role:'accepted source/doc blob'});
}
git(['merge-base','--is-ancestor',fixtureSource,'HEAD']);
for(const entry of freeze.files){
  const bytes=git(['show',`${fixtureSource}:${entry.path}`]);assert.equal(sha(bytes),entry.afterSha256);
  const object=git(['rev-parse',`${fixtureSource}:${entry.path}`]).toString().trim();git(['update-index','--add','--cacheinfo','100644',object,entry.path],{env});
  changes.push({path:entry.path,revision:fixtureSource,blob:object,sha256:sha(bytes),bytes:bytes.length,role:'authorized maintained inventory fixture'});
}
const tree=git(['write-tree'],{env}).toString().trim();
const candidate=git(['commit-tree',tree,'-p',freeze.base],{input:'Coherent77 readiness: accepted WHICH77 + helper578 + exact Stage2 five blobs + four maintained inventories\n'}).toString().trim();
assert.equal(changes.length,10);assert.deepEqual(git(['diff','--name-only',freeze.base,candidate]).toString().trim().split('\n').sort(),changes.map(row=>row.path).sort());
for(const path of ['package.json','package-lock.json','README.md','src/index.ts','src/plugins/index.ts','src/commands','src/fs','tsconfig.json','tsconfig.build.json'])assert.equal(git(['rev-parse',`${freeze.base}:${path}`]).toString(),git(['rev-parse',`${candidate}:${path}`]).toString(),path);
const raw=git(['cat-file','commit',candidate]);
const receipt={schema:1,createdAt:new Date().toISOString(),candidate,tree,sourceTree:git(['rev-parse',`${candidate}:src`]).toString().trim(),base:freeze.base,fixtureSource,freezeSha256:sha(readFileSync(new URL('./FREEZE.json',import.meta.url))),changes,rawCommitBase64:raw.toString('base64'),rawCommitSha256:sha(raw),packageManifestSha256:sha(git(['show',`${candidate}:package.json`])),basePackageSha256:'49191d098e1e9f5b946f24dd898377144062110047cf6975d3cbf5d2c71214c0',packageQualification:'The accepted base tarball is historical; a new package hash must be observed after the Stage2 rebuild.',defaultCount:77,customCount:78,wholeGateLaunched:false,independentCombinedAcceptance:false};
writeFileSync(join(output,'CANDIDATE.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,candidate,tree,sourceTree:receipt.sourceTree,paths:changes.length}));
