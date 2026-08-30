import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const directory=dirname(fileURLToPath(import.meta.url));
const repository=resolve(directory,'../../../../..');
const prefix='tests/integration/full-gate-20260827/unified76-driver/';
const originalDriver='86f75025b423f9d25a9dbcb35d07e73e95d33f9d';
const source=process.argv[2];
assert.match(source??'',/^[a-f0-9]{40}$/u);
const git=(args,options={})=>execFileSync('git',['--no-replace-objects',...args],{cwd:repository,maxBuffer:32*1024*1024,...options});
const blob=(path,revision=originalDriver)=>git(['show',`${revision}:${path}`]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const freeze=JSON.parse(readFileSync(join(directory,'FREEZE.json')));
const original=JSON.parse(blob(prefix+'CANDIDATE.json'));
assert.equal(original.candidate,freeze.previousCandidate);
git(['merge-base','--is-ancestor',source,'HEAD']);
git(['merge-base','--is-ancestor',original.base,source]);
const before=blob(freeze.path,original.candidate);
assert.equal(sha(before),freeze.beforeSha256);
assert.equal(before.toString().split(freeze.from).length,2);
const expected=before.toString().replace(freeze.from,freeze.to);
assert.equal(sha(expected),freeze.afterSha256);
assert.equal(blob(freeze.path,source).toString(),expected);
const output=mkdtempSync(join(tmpdir(),'unified76-amendment-'));
const env={...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_INDEX_FILE:join(output,'index')};
git(['read-tree',original.base],{env});
const changes=original.changes.map(entry=>{
  const bytes=blob(entry.path,source);
  const changed=entry.path===freeze.path;
  assert.equal(sha(bytes),changed?freeze.afterSha256:entry.afterSha256);
  const afterBlob=git(['rev-parse',`${source}:${entry.path}`]).toString().trim();
  git(['update-index','--add','--cacheinfo','100644',afterBlob,entry.path],{env});
  return{...entry,afterBlob,afterSha256:sha(bytes),replacements:changed?[...entry.replacements,[freeze.from,freeze.to]]:entry.replacements};
});
const tree=git(['write-tree'],{env}).toString().trim();
const commit=git(['commit-tree',tree,'-p',original.base],{input:'Unify76 v2: exactly four fixture paths, adding only authorized ordinary count hunk\n'}).toString().trim();
assert.deepEqual(git(['diff','--name-only',original.candidate,commit]).toString().trim().split('\n'),[freeze.path]);
const actualDiff=git(['diff','--unified=0',original.candidate,commit,'--',freeze.path]).toString();
assert.deepEqual(actualDiff.split('\n').filter(line=>/^[+-]/u.test(line)&&!/^---|^\+\+\+/u.test(line)),['-  '+freeze.from,'+  '+freeze.to]);
assert.deepEqual(git(['diff','--name-only',original.base,commit]).toString().trim().split('\n').sort(),changes.map(entry=>entry.path).sort());
for(const path of ['src','package.json','package-lock.json','README.md','tsconfig.json','tsconfig.build.json'])assert.equal(git(['rev-parse',`${original.candidate}:${path}`]).toString(),git(['rev-parse',`${commit}:${path}`]).toString());
const raw=git(['cat-file','commit',commit]);
const candidate={...original,schema:2,createdAt:new Date().toISOString(),candidate:commit,tree,fixtureSourceCommit:source,changes,rawCommitBase64:raw.toString('base64'),rawCommitSha256:sha(raw),previousCandidate:original.candidate,previousDriver:originalDriver,amendmentFreezeSha256:sha(readFileSync(join(directory,'FREEZE.json'))),wholeGateLaunched:false};
const save=(name,value)=>writeFileSync(join(output,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});
save('CANDIDATE.json',candidate);
const oldSeal=JSON.parse(blob(prefix+'DRIVER.json'));
const codeFiles=Object.keys(oldSeal.files).filter(name=>name.endsWith('.mjs')||name.endsWith('.fixture'));
const lineage=[];
for(const name of [...codeFiles,'reconstruct.mjs','restore.mjs']){
  const oldBytes=blob(prefix+name);let bytes=oldBytes.toString();
  if(name==='common.mjs'||name==='profile.mjs'){
    assert.equal(bytes.split("'../../../..'").length,2);
    bytes=bytes.replace("'../../../..'","'../../../../../..'");
  }
  save(name,bytes);lineage.push({name,originalSha256:sha(oldBytes),amendedSha256:sha(bytes),difference:bytes===oldBytes.toString()?'none':'directory-depth-only, four to six parents'});
}
save('CODE-LINEAGE.json',{originalDriver,candidate:commit,files:lineage,qualification:'Runtime bodies unchanged except two lexical repository-depth adjustments for this versioned directory.'});
console.log(JSON.stringify({output,candidate:commit,tree,fixtureSource:source,oldCandidate:original.candidate,paths:changes.length,fullGateLaunched:false}));
