import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const binding=JSON.parse(readFileSync(new URL('./PRE-WIRING.json',import.meta.url)));
const source=process.argv[2];assert.match(source??'',/^[a-f0-9]{40}$/u);
const git=(args,options={})=>execFileSync('git',['--no-replace-objects',...args],{maxBuffer:32*1024*1024,...options});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const revision of [source,binding.whichModule])git(['merge-base','--is-ancestor',revision,'HEAD']);
const output=mkdtempSync(join(tmpdir(),'which77-assembly-'));
const env={...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_INDEX_FILE:join(output,'index')};
git(['read-tree',binding.base76],{env});
const paths=[...Object.keys(binding.rootPaths).map(path=>({path,revision:source})),...Object.keys(binding.modulePaths).map(path=>({path,revision:binding.whichModule}))];
const changes=paths.map(({path,revision})=>{
  const bytes=git(['show',`${revision}:${path}`]);
  const blob=git(['rev-parse',`${revision}:${path}`]).toString().trim();
  if(revision===binding.whichModule)assert.equal(sha(bytes),binding.modulePaths[path]);
  git(['update-index','--add','--cacheinfo','100644',blob,path],{env});
  return{path,sourceRevision:revision,blob,sha256:sha(bytes),bytes:bytes.length};
});
const tree=git(['write-tree'],{env}).toString().trim();
const candidate=git(['commit-tree',tree,'-p',binding.base76],{input:'Isolated WHICH77: frozen76 plus accepted0902 module and four public wiring paths\n'}).toString().trim();
assert.deepEqual(git(['diff','--name-only',binding.base76,candidate]).toString().trim().split('\n').sort(),paths.map(entry=>entry.path).sort());
for(const path of ['package-lock.json','tsconfig.json','tsconfig.build.json','src/shell','src/contracts','src/commands/expr','src/commands/regex-execution','src/commands/internal.ts']){
  assert.equal(git(['rev-parse',`${binding.base76}:${path}`]).toString(),git(['rev-parse',`${candidate}:${path}`]).toString());
}
const raw=git(['cat-file','commit',candidate]);
const receipt={schema:1,createdAt:new Date().toISOString(),candidate,tree,base:binding.base76,rootSource:source,moduleSource:binding.whichModule,independentFreeze:binding.independentFreeze,changes,rawCommitBase64:raw.toString('base64'),rawCommitSha256:sha(raw),sourceTree:git(['rev-parse',`${candidate}:src`]).toString().trim(),packageManifestSha256:sha(git(['show',`${candidate}:package.json`])),publicStatus:'AUTHOR_CANDIDATE_NOT_INDEPENDENT_ACCEPTANCE',wholeGateLaunched:false};
writeFileSync(join(output,'CANDIDATE.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,candidate,tree,paths:changes.length,base:binding.base76}));
