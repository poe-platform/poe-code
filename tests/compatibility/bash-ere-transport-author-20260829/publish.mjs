import { open, lstat, readFile, writeFile, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const own=dirname(fileURLToPath(import.meta.url)),root=resolve(own,'../../..');
const outer=await open(join(own,'PUBLICATION.outer.jsonl'),'wx');
const started=Date.now(),deadline=started+480000,children=[];
let captureBytes=0;
const report={schema:'ere-transport-publication-only-v1',started:new Date(started).toISOString(),pid:process.pid,children,runtimeImports:0,workers:0,compilerStarts:0,oldPhase64Compliance:'NOT ESTABLISHED; retained publication HOLD',historicalProbes:0};
await outer.write(JSON.stringify(report)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function check(){if(Date.now()>deadline)throw new Error('publication deadline');}
async function bytes(path,maximum=4*1024*1024){check();const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maximum)throw new Error('regular bounded input required: '+path);const value=await readFile(path);if(value.length!==stat.size)throw new Error('size drift');return value;}
async function binding(path){check();const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024*1024)throw new Error('regular bounded binding: '+path);const digest=createHash('sha256');let size=0;for await(const chunk of createReadStream(path,{highWaterMark:65536})){size+=chunk.length;if(size>stat.size)throw new Error('growth');digest.update(chunk);}if(size!==stat.size)throw new Error('size drift');return{path,size,mode:stat.mode&511,sha256:digest.digest('hex')};}
async function verify(row,path=row.path){const value=await binding(path);if(value.size!==row.size||value.mode!==row.mode||value.sha256!==row.sha256)throw new Error('retained binding mismatch: '+path);return value;}
async function git(args,name){
  check();if(children.length>=12)throw new Error('publication Git child ceiling');
  const stdout=await open(join(own,`PUBLICATION-${name}.stdout`),'wx'),stderr=await open(join(own,`PUBLICATION-${name}.stderr`),'wx');
  const receipt={name,args,started:new Date().toISOString(),pid:null,closed:false,code:null,signal:null};
  let child,fault,writing=Promise.resolve();const chunks=[];
  try{
    child=spawn('/usr/bin/git',['-c','gc.auto=0','-c','maintenance.auto=false','-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false',...args],{cwd:root,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',HOME:process.env.HOME},stdio:['ignore','pipe','pipe']});
    children.push(receipt);receipt.pid=child.pid??null;
    const closed=new Promise(resolveClose=>{child.once('error',error=>{receipt.error=String(error);});child.once('close',(code,signal)=>{receipt.closed=true;receipt.code=code;receipt.signal=signal;resolveClose();});});
    const save=(target,chunk,isOut)=>{captureBytes+=chunk.length;if(captureBytes>16*1024*1024){fault=new Error('capture cap');child.kill('SIGKILL');return;}if(isOut)chunks.push(chunk);writing=writing.then(()=>target.write(chunk)).catch(error=>{fault=error;child.kill('SIGKILL');});};
    child.stdout.on('data',chunk=>save(stdout,chunk,true));child.stderr.on('data',chunk=>save(stderr,chunk,false));
    const timer=setTimeout(()=>{fault=new Error('child deadline');child.kill('SIGKILL');},Math.min(60000,deadline-Date.now()));
    await closed;clearTimeout(timer);await writing;await outer.write(JSON.stringify(receipt)+'\n');if(fault)throw fault;if(receipt.error||receipt.signal||receipt.code!==0)throw new Error('Git child failure '+name);return Buffer.concat(chunks);
  }finally{await stdout.close();await stderr.close();}
}
const published=[];
try{
  const seal1=JSON.parse(await bytes(join(own,'SEAL.json'))),rawSeal2=await bytes(join(own,'SEAL-v2.json'));
  if(hash(rawSeal2)!=='f6ff74e59b15c98e230a2011af8c5c21d6922e44599bc88084a3705846cc55d1')throw new Error('final seal hash');
  const seal2=JSON.parse(rawSeal2);
  report.finalSealSha256=hash(rawSeal2);report.sourceBindings=[];
  for(const row of seal2.sources)report.sourceBindings.push(await verify(row));
  for(const row of [...seal2.fixtures,...seal2.design])await verify(row);
  report.node=await verify(seal2.node);
  report.commits=(await git(['rev-parse','65f0e080^{commit}','0f36459c^{commit}'],'source-commits')).toString('utf8').trim().split('\n');
  for(const [commit,file]of [[report.commits[0],'SEAL.json'],[report.commits[1],'SEAL-v2.json']]){const stored=await git(['show',commit+':'+relative(root,join(own,file))],file==='SEAL.json'?'seal1-blob':'seal2-blob');if(hash(stored)!==hash(await bytes(join(own,file))))throw new Error('stored seal differs');}
  report.preexistingForeignIndex=await git(['diff','--cached','--raw','--no-abbrev','-z'],'index-before');
  report.cohorts=[];
  for(const [label,seal]of [['TYPE-01',seal1],['TYPE-02',seal2]]){
    const dir=join(own,label),result=JSON.parse(await bytes(join(dir,'RESULT.json'))),observed=[];
    if(result.children.length!==3||result.knownRetired!==3||!result.sourceTypes||!result.positive||!result.negative.pass)throw new Error('retained type result disagreement');
    if(JSON.stringify(result.children.map(row=>[row.name,row.code,row.closed,row.signal]))!==JSON.stringify([['source',0,true,null],['positive',0,true,null],['negative',2,true,null]]))throw new Error('retained child status');
    const outerRows=(await bytes(join(dir,'OUTER.jsonl'))).toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
    for(const child of result.children){if(!outerRows.some(row=>row.name===child.name&&row.pid===child.pid&&row.code===child.code&&row.closed===true))throw new Error('child receipt mismatch');}
    for(const row of seal.sources){const copied=join(dir,'work/source',relative(join(root,'src/commands/regex-execution/ere'),row.path));observed.push(await verify(row,copied));}
    for(const row of seal.tools){const copied=join(dir,'work/node_modules',relative(join(root,'node_modules'),row.path));observed.push(await verify(row,copied));}
    for(const name of ['consumer.mts','negative.mts']){const row=seal.fixtures.find(row=>row.path===join(own,name));observed.push(await verify(row,join(dir,'work',name)));}
    const pkg=await bytes(join(dir,'work/package.json'));if(pkg.toString('utf8')!=='{"type":"module"}\n')throw new Error('retained package marker');observed.push(await binding(join(dir,'work/package.json')));
    if(observed.length!==result.admittedFiles||observed.reduce((sum,row)=>sum+row.size,0)!==result.admittedBytes)throw new Error('retained admitted census');
    const emitted=[];for(const row of result.emitted){if(!row.path.startsWith(join(dir,'work/emitted')+'/')||!row.path.endsWith('.js')&&!row.path.endsWith('.d.ts'))throw new Error('emitted path scope');emitted.push(await verify(row));published.push(relative(root,row.path));}
    const raw=[];let total=0;for(const name of ['source','positive','negative'])for(const channel of ['stdout','stderr']){const path=join(dir,`${name}.${channel}`),value=await bytes(path);raw.push(await binding(path));total+=value.length;if(name!=='negative'&&value.length!==0)throw new Error('unexpected retained positive output');published.push(relative(root,path));}
    if(total!==342||total!==result.captureBytes)throw new Error('retained raw capture size');
    const diagnostic=(await bytes(join(dir,'negative.stdout'))).toString('utf8')+(await bytes(join(dir,'negative.stderr'))).toString('utf8');
    const codes=[...diagnostic.matchAll(/negative\.mts\((\d+),(\d+)\): error TS(\d+):/g)].map(match=>[Number(match[1]),Number(match[2]),Number(match[3])]);
    if(JSON.stringify(codes)!=='[[2,108,2353],[3,59,2322],[5,47,2345]]')throw new Error('retained exact diagnostics');
    for(const name of ['RESULT.json','OUTER.jsonl'])published.push(relative(root,join(dir,name)));
    report.cohorts.push({label,result:await binding(join(dir,'RESULT.json')),outer:await binding(join(dir,'OUTER.jsonl')),inputs:observed,emitted,raw,compilerPids:result.children.map(row=>row.pid),capturedBytes:total,historicalCaptureHashQualification:'new publication hash; result/outer had no independently sealed historical digest'});
  }
  const priorOwner=seal1.sources.find(row=>row.path.endsWith('/transport/owner.ts')),newOwner=seal2.sources.find(row=>row.path===priorOwner.path);
  report.ownerRevision={before:priorOwner,after:newOwner};
  for(const row of seal1.sources){const current=seal2.sources.find(other=>other.path===row.path);if(!current||row.path!==priorOwner.path&&(row.sha256!==current.sha256||row.size!==current.size||row.mode!==current.mode))throw new Error('unexpected source revision');}
  const validation=seal2.design.find(row=>row.path.endsWith('/VALIDATION.json'));await verify(validation);const cases=JSON.parse(await bytes(validation.path));
  report.runtimeProposal={manifest:validation,families:cases.families,variants:cases.finiteVariants,status:cases.status,rows:cases.rows,authorization:'NONE: later ROOT decision and engine-capture adjudication required'};
  if(cases.rows.length!==32||cases.rows.reduce((sum,row)=>sum+row.variants.length,0)!==60||cases.rows.some(row=>row.status!=='UNRUN'))throw new Error('runtime DATA census');
  report.historicalAccounting={observedCompilerStarts:6,observedCompilerRetirements:6,observedTypeCoordinators:2,observedSealCoordinators:2,observedVersionPreparationHelper:1,observedInspectionHelper:1,lowerBoundObservedProcesses:12,administrativeShellGitEditingStarts:'additional starts visible in conversation, not comprehensively enrolled',unrecordedTransitives:'UNKNOWN; no historical process probes',ceiling64:'NOT CERTIFIED; no inferred upper bound'};
  report.preexistingForeignIndexSha256=hash(report.preexistingForeignIndex);delete report.preexistingForeignIndex;
  report.publicationKnownEvents={preDriver:['P01 instruction-context shell','P02 shell replaced by apply_patch editing role; wrapper/interpreter details not an independently observed descendant census','P03 shell launched one apply_patch correction, then exec-replaced by this Node publication coordinator'],gitChildren:children,peakKnown:2,scope:'known direct administrative starts; no process-global or historical transitive census claim'};
  report.newCaptureBytes=captureBytes;report.authenticated=true;report.completedAuthentication=new Date().toISOString();
  await writeFile(join(own,'PUBLICATION.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  const fixed=['HANDOFF.md','publish.mjs','PUBLICATION-START.log','PUBLICATION.json'];
  for(const name of fixed)published.push(relative(root,join(own,name)));
  const evidencePaths=[...new Set(published)].sort();
  await writeFile(join(own,'PUBLICATION-PATHS.json'),JSON.stringify(evidencePaths,null,2)+'\n',{flag:'wx'});evidencePaths.push(relative(root,join(own,'PUBLICATION-PATHS.json')));
  await git(['add','--',...evidencePaths],'add');
  await git(['commit','--only','-m','docs: preserve private ERE transport source and type-only handoff','--',...evidencePaths],'commit');
  const commit=(await git(['rev-parse','HEAD'],'publication-commit')).toString('utf8').trim();
  const indexAfter=await git(['diff','--cached','--raw','--no-abbrev','-z'],'index-after');
  if(hash(indexAfter)!==report.preexistingForeignIndexSha256)throw new Error('foreign staged-index changed; do not infer cause');
  for(const row of seal2.sources)await verify(row);for(const cohort of report.cohorts){await verify(cohort.result);await verify(cohort.outer);for(const row of [...cohort.emitted,...cohort.raw])await verify(row);}
  const finish={commit,sourceCommits:report.commits,completed:new Date().toISOString(),elapsedMs:Date.now()-started,gitChildren:children.length,retired:children.filter(row=>row.closed).length,newCaptureBytes:captureBytes,indexUnchanged:true,sourceAndRetainedEvidencePostcheck:true,compressedInputs:0,newRuntime:0,old64Compliance:'NOT CERTIFIED',outerAndGitRaw:'retained untracked append/finalization receipts; not claimed inside earlier commit'};
  check();await writeFile(join(own,'PUBLICATION-FINAL.json'),JSON.stringify(finish,null,2)+'\n',{flag:'wx'});await outer.write(JSON.stringify(finish)+'\n');console.log(JSON.stringify(finish));
}catch(error){await outer.write(JSON.stringify({failure:String(error?.stack??error),children,ended:new Date().toISOString()})+'\n');process.exitCode=1;console.error(String(error?.stack??error));}finally{await outer.close();}
