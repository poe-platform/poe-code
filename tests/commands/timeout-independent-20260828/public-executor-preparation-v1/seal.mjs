import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve, relative } from 'node:path';
import { recipe, owned, repository, freeze, freezeHash, node, fileHash, read, sha, save, write, safe } from './common.mjs';
import { legacyAdapter } from './legacy-transform.mjs';
assert.equal(fs.existsSync(resolve(recipe,'MANIFEST.json')),false,'ALREADY_SEALED');
assert.equal(process.execPath,node);assert.equal(process.version,'v22.22.2');assert.equal(fileHash(resolve(freeze,'MANIFEST.json')),freezeHash);
const frozen=read(resolve(freeze,'MANIFEST.json')),binding=read(resolve(freeze,'BINDINGS.json'));
for(const row of frozen.files)assert.equal(fileHash(resolve(freeze,row.path)),row.sha256);
for(const row of binding.tools)assert.equal(fileHash(row.path),row.sha256);
for(const row of binding.protectedFiles)assert.equal(fileHash(resolve(repository,safe(row.path))),row.sha256);
const old=resolve(owned,'repaired-f22-v1/recipe/cases.mjs'),expected=binding.protectedFiles.find(row=>row.path===relative(repository,old)).sha256;
const adapter=legacyAdapter(fs.readFileSync(old),expected);write(resolve(recipe,'legacy-adapter.mjs'),adapter.source);save(resolve(recipe,'ADAPTER.json'),{...adapter,source:undefined,sourcePath:relative(repository,old),sourceInspectedPreviously:true,newPublicCandidateInspected:false});
const names=['README.md','common.mjs','admission.mjs','type-trace.mjs','supervisor.mjs','legacy-transform.mjs','legacy-adapter.mjs','ADAPTER.json','preload.mjs','runtime.mjs','execute.mjs','negative-worker.mjs','negative-protocol.mjs','archive.mjs','seal.mjs','controls.mjs'];
const references=[
  ...['MANIFEST.json','BINDINGS.json','cases.mjs','types.mjs','predicates.mjs'].map(name=>resolve(freeze,name)),
  ...['cases.mjs','io.mjs','tool-observer.cjs','borrowed-boundary.mjs','BINDINGS.json'].map(name=>resolve(owned,'repaired-f22-v1/recipe',name)),
  resolve(owned,'clock.mjs'),resolve(owned,'review-preparation-v1/recipe/support.mjs'),resolve(repository,binding.toolClosure.path),
].map(filename=>({path:relative(repository,filename),repositoryRelative:true,sha256:fileHash(filename),bytes:fs.statSync(filename).size}));
const files=names.map(path=>({path,bytes:fs.statSync(resolve(recipe,path)).size,sha256:fileHash(resolve(recipe,path))}));
save(resolve(recipe,'MANIFEST.json'),{schema:'timeout-public-executor-preparation/1',sealedAt:new Date().toISOString(),freezeCommit:'031d4ddfed2fd88e2747bcf1d69242384096b754',freezeSha256:freezeHash,baseline:binding.baseline,acceptedModule:binding.acceptedModule,publicCandidate:null,status:'PREPARATION_ONLY_WAITING_EXACT_CANDIDATE',files,references,tools:binding.tools,profile:{runtimeFamilies:30,runtimeLayouts:3,typePayloads:10,typeLayouts:2,admissionFamilies:8,freshGuards:6,packageNegatives:7,productMutants:8,original32Replay:false,numeric70Replay:false,native:0,safeJS:0},supervision:{perCaseMilliseconds:10000,perTypeMilliseconds:10000,buildPackInstallMilliseconds:120000,childOutputBytes:16*1024**2,runtimeRecordBytes:1024**2,compactArchiveBytes:128*1024**2},preparationControls:26,actualPublicRuntime:0,actualPublicTypes:0,actualProductImports:0,actualBuildPackInstall:0,chronology:'Accepted a238 module already inspected; no public candidate handoff/inspection or execution. Adapter selects aggregate and retains exact caller/retirement predicates; no module policy change.'});
console.log(JSON.stringify({manifestSha256:fileHash(resolve(recipe,'MANIFEST.json')),adapterSha256:adapter.sourceSha256,files:files.length,references:references.length,productExecution:0}));
