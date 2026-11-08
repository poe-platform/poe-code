import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const freeze=JSON.parse(readFileSync(new URL('./FREEZE.json',import.meta.url)));
const source=process.argv[2];assert.match(source??'',/^[a-f0-9]{40}$/u);
const git=(args,options={})=>execFileSync('git',['--no-replace-objects',...args],{timeout:60000,maxBuffer:32*1024*1024,...options});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const output=mkdtempSync(join(tmpdir(),'timeout78-assembly-'));
const env={...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_INDEX_FILE:join(output,'index')};
git(['read-tree',freeze.baseline],{env});
const modulePaths=['src/commands/timeout/README.md','src/commands/timeout/duration.ts','src/commands/timeout/index.ts','src/commands/timeout/scheduler.ts'];
const changes=[];
for(const [revision,paths,role]of [[freeze.acceptedModule,modulePaths,'accepted unchanged module'],[source,freeze.publicPaths,'root public integration']]){
  git(['merge-base','--is-ancestor',revision,'HEAD']);
  for(const path of paths){const bytes=git(['show',revision+':'+path]),blob=git(['rev-parse',revision+':'+path]).toString().trim();git(['update-index','--add','--cacheinfo','100644',blob,path],{env});changes.push({path,revision,role,mode:'100644',bytes:bytes.length,blob,sha256:sha(bytes)});}
}
const tree=git(['write-tree'],{env}).toString().trim();
const candidate=git(['commit-tree',tree,'-p',freeze.baseline],{input:'Timeout78 public candidate: exact coherent5137 + accepted a238 module + three explicit root blobs\n'}).toString().trim();
assert.deepEqual(git(['diff','--name-only',freeze.baseline,candidate]).toString().trim().split('\n').sort(),changes.map(row=>row.path).sort());
for(const path of ['src/fs','src/shell','src/contracts','README.md','package-lock.json','tsconfig.json','tsconfig.build.json','tests'])assert.equal(git(['rev-parse',freeze.baseline+':'+path]).toString(),git(['rev-parse',candidate+':'+path]).toString(),path);
const raw=git(['cat-file','commit',candidate]);
const receipt={createdAt:new Date().toISOString(),candidate,tree,sourceTree:git(['rev-parse',candidate+':src']).toString().trim(),base:freeze.baseline,source,acceptedModule:freeze.acceptedModule,changes,rawCommitBase64:raw.toString('base64'),rawCommitSha256:sha(raw),packageManifestSha256:sha(git(['show',candidate+':package.json'])),readme:{revision:freeze.baseline,sha256:sha(git(['show',candidate+':README.md'])),qualification:'Exact baseline packed README retained; current root documentation and maintained test deltas separately bound, not silently overlaid'},defaultCount:78,fullGateLaunched:false,independentlyAccepted:false};
writeFileSync(join(output,'CANDIDATE.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
const chain=JSON.parse(readFileSync(new URL('../combined77-stage2-readiness-20260828/RECONSTRUCTION-CHAIN.json',import.meta.url)));assert.equal(chain.at(-1).candidate,freeze.baseline);chain.push(receipt);
writeFileSync(join(output,'RECONSTRUCTION-CHAIN.json'),JSON.stringify(chain,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,candidate,tree,changes:changes.length}));
