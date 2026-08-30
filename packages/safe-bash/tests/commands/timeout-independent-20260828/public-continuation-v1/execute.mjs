import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recipe, repository, owned, freeze, read, fileHash, sha, save, write, safe, inventory, sameInventory, authenticatePreparation, reason } from './common.mjs';
import { requireAuthorization, materializeInputs, materializeTools, applyMutant } from './admission.mjs';
import { supervisor, absent } from './supervisor.mjs';
import { runtime as runtimeCases } from '../public-integration-freeze-v1/cases.mjs';
import { tarEntries } from '../repaired-f22-v1/recipe/io.mjs';
import { archiveEvidence } from './archive.mjs';

const requestFile = process.env.TIMEOUT_PUBLIC_BINDING;
assert.ok(requestFile, 'WAITING_EXACT_CANDIDATE_HANDOFF');
assert.ok(resolve(requestFile).startsWith(`${recipe}/`), 'CANDIDATE_BINDING_OUTSIDE_OWNED_PREPARATION');safe(relative(recipe,resolve(requestFile)));assert.ok(fs.lstatSync(requestFile).isFile()&&!fs.lstatSync(requestFile).isSymbolicLink());assert.equal(fs.realpathSync(requestFile),resolve(requestFile));
const requestBytes = fs.readFileSync(requestFile), requestHash = sha(requestBytes), request = JSON.parse(requestBytes);
requireAuthorization(process.argv.slice(2), request, requestHash);
const { binding, manifest } = authenticatePreparation(request.preparationSha256);
const boundAuthor=read(resolve(recipe,'../public-candidate-execution-v1/AUTHOR-BINDINGS.json'));for(const key of ['candidate','baseline','module','public','packageFiles','mutants'])assert.deepEqual(request[key],boundAuthor[key],'SEALED_CANDIDATE_FIELD:'+key);
const run = resolve(recipe,'runs',safe(request.runName)), work = resolve(recipe,'node_modules',request.runName), raw = resolve(run,'raw');
assert.equal(fs.existsSync(run),false,'NO_RETRY_EXISTING_RUN');assert.equal(fs.existsSync(work),false,'NO_RETRY_EXISTING_WORK');
fs.mkdirSync(raw,{recursive:true});fs.mkdirSync(work,{recursive:true});write(resolve(run,'CANDIDATE.json'),requestBytes);
const state={schema:'timeout-public-execution/1',candidate:request.candidate,baseline:request.baseline,module:request.module,requestHash,preparationSha256:request.preparationSha256,startedAt:new Date().toISOString(),status:'RUNNING',attempts:1,retries:0,children:[],git:[],guards:[],runtime:[],types:[],negatives:[],mutants:[],boundaryControls:[],admission:[],native:0,safeJS:0};
const continuation=read(resolve(recipe,'CONTINUATION.json'));assert.deepEqual(continuation.selected,["R01","R12","R21","R23","R24","R25","R28","R29"]);assert.equal(continuation.candidate,request.candidate);const selectedCases=runtimeCases.filter(row=>continuation.selected.includes(row.id));assert.equal(selectedCases.length,8);const priorResult=read(resolve(repository,continuation.priorResultPath));assert.equal(fileHash(resolve(repository,continuation.priorResultPath)),continuation.priorResultSha256);
const guarded=new Map();
function guard(label){authenticatePreparation(request.preparationSha256);assert.equal(fileHash(resolve(run,'CANDIDATE.json')),requestHash);for(const [root,expected] of guarded)sameInventory(inventory(root),expected);state.guards.push({label,at:new Date().toISOString(),unchanged:true});}
const child=supervisor({raw,work,guard,children:state.children});
let tools, source, packFile;const sourceReadMap=new Map();
async function tool(label,entry,args,cwd,milliseconds=120000){
  const trace=resolve(raw,`${label}-tool.jsonl`),observer=resolve(owned,'repaired-f22-v1/recipe/tool-observer.cjs');
  const result=await child(label,['--require',observer,entry,...args],cwd,{DU_ADMISSION_WORK:work,DU_ADMISSION_RUN:recipe,DU_ADMISSION_LOG:trace,DU_TOOL_MAP:resolve(work,'tool-map.json')},milliseconds);
  const records=fs.readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(records.filter(row=>row.kind==='tool-observer-start').length,1);assert.equal(records.filter(row=>row.kind==='tool-observer-exit').length,1);
  const compiles=records.filter(row=>row.kind==='actual-commonjs-compile');assert.ok(compiles.length>0,'ACTUAL_TOOL_LOAD');
  for(const row of compiles){assert.equal(row.compileSha256,tools.toolMap[row.path]);assert.equal(row.diskSha256,row.compileSha256);}
  for(const row of records.filter(item=>item.kind==='actual-file-read'))if(source&&row.path.startsWith(`${source}/`)){const expected=sourceReadMap.get(row.path)??(row.path.startsWith(`${source}/dist/`)?fileHash(row.path):undefined);assert.equal(row.sha256,expected,'ACTUAL_COMMITTED_BUILD_INPUT_READ');}
  return {...result,records};
}
function helperLoads(){
  const loads={};for(const row of [...manifest.files,...manifest.references])if(row.path.endsWith('.mjs')){const filename=row.repositoryRelative?resolve(repository,row.path):resolve(recipe,row.path);loads[filename]=row.sha256;}return loads;
}
async function runtime(profile,productRoot,consumer,caseId,mutation,boundaryControl){
  const label=`${profile}-${caseId}`,output=resolve(raw,label);fs.mkdirSync(output);
  const entry=resolve(consumer,`${label}.mjs`);write(entry,`await import(${JSON.stringify(pathToFileURL(resolve(recipe,'runtime.mjs')).href)});\n`);
  const loads=helperLoads();loads[entry]=fileHash(entry);
  for(const row of inventory(productRoot))if(row.path.endsWith(profile==='source'||mutation||boundaryControl?'.ts':'.js'))loads[resolve(productRoot,row.path)]=row.sha256;
  const config={profile:profile==='source'||mutation||boundaryControl?'source':profile,candidate:request.candidate,executionAuthorized:true,caseId,productRoot,consumerEntry:entry,loads,sourceEntries:{'virtual-bash':resolve(productRoot,'src/index.ts'),'virtual-bash/commands/timeout':resolve(productRoot,'src/commands/timeout/index.ts')},trace:resolve(output,'loads.jsonl'),output,guardRoots:[{root:productRoot,entries:inventory(productRoot)}],diagnostics:read(resolve(owned,'repaired-f22-v1/recipe/BINDINGS.json')).diagnostics,...(mutation?{intentionalMutation:mutation}:{}),...(boundaryControl?{boundaryControl}:{})};
  const configuration=resolve(work,`${label}-config.json`);save(configuration,config);
  const result=await child(label,['--permission',`--allow-fs-read=${owned}`,`--allow-fs-write=${output}`,'--import',resolve(recipe,'preload.mjs'),entry],consumer,{TIMEOUT_CONFIG:configuration,TIMEOUT_CONFIG_SHA256:fileHash(configuration)});
  const captured=read(resolve(output,'RESULT.json')),observations=fs.readFileSync(config.trace,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const required=['virtual-bash','virtual-bash/commands/timeout'];
  for(const specifier of required){const row=observations.find(item=>item.kind==='entrypoint-resolution'&&item.specifier===specifier);assert.ok(row,'ACTUAL_ENTRYPOINT_RESOLUTION');assert.equal(row.throughActualPackageExports,config.profile!=='source');const target=specifier==='virtual-bash'?'index':'commands/timeout/index';const path=resolve(productRoot,config.profile==='source'?`src/${target}.ts`:`dist/${target}.js`);assert.ok(observations.some(item=>item.kind==='actual-module-load'&&item.path===path&&item.sha256===loads[path]),'ACTUAL_ENTRYPOINT_LOAD');}
  assert.equal(captured.cleanup.pending,0);assert.equal(captured.cleanup.timers,0);assert.deepEqual(captured.cleanup.unhandled,[]);assert.equal(captured.integrity,'UNCHANGED');assert.notEqual(captured.status,'STOP_NO_RETRY');assert.equal(result.signal,null);
  captured.loadProof={actualModuleLoads:observations.filter(row=>row.kind==='actual-module-load').length,publicPackageExports:config.profile!=='source'};
  if(mutation){assert.ok(observations.some(row=>row.kind==='actual-module-load'&&row.path===resolve(productRoot,mutation.path)&&row.sha256===mutation.afterSha256),'ACTUAL_MUTATED_LOAD');const record={id:mutation.id,status:'KILLED',caseId,result:captured};try{assert.equal(result.code,1,'MUTANT_SURVIVED');assert.equal(captured.status,'FAIL');assert.ok(captured.failure.text.includes(mutation.failure),'WRONG_MUTANT_FAILURE');if(mutation.id==='M07'){const observation=captured.observations.find(row=>row.kind==='PC01-boundaries');assert.ok(observation);assert.deepEqual(observation.dispatch,{timeout:1,child:1,outer:0});assert.equal(observation.sameCallerSentinel,true);assert.equal(observation.sameHandlerSignalReason,true);assert.equal(observation.beforeRelease.handler.status,'pending');assert.equal(observation.beforeRelease.outer.status,'pending');assert.equal(observation.handler.status,'fulfilled');assert.equal(observation.handler.exitCode,124);assert.equal(observation.outer.status,'rejected');assert.equal(observation.outer.sameSentinel,true);assert.equal(observation.childClosed,true);assert.equal(observation.resources,0);}if(mutation.id==='M06'){const observation=captured.observations.find(row=>row.kind==='public-default-clock-result');assert.equal(observation?.status,125);assert.equal(observation.stdoutBase64,'');assert.equal(Buffer.from(observation.stderrBase64,'base64').toString(),'timeout: timer setup failed\n');}if(mutation.id==='M08')assert.ok(captured.observations.some(row=>row.kind==='PC02-direct-retirement'&&row.entered&&row.threw&&row.sameSentinel),'RETIREMENT_NOT_ACTIVATED');}catch(error){record.status='FAIL';record.failure=reason(error);}state.mutants.push(record);}
  else if(boundaryControl){const record={id:boundaryControl.id,status:'KILLED',caseId,result:captured};try{assert.equal(result.code,1);assert.equal(captured.status,'FAIL');assert.ok(captured.failure.text.includes(boundaryControl.failure),'WRONG_BOUNDARY_MUTANT_FAILURE');const observation=captured.observations.find(row=>row.kind===(boundaryControl.id==='B01'?'R12-raw-before-assertion':boundaryControl.id==='B03'?'R12-return-admission-failure':'R12-shell-before-release'));assert.ok(observation,'ACTUAL_BOUNDARY_OBSERVATION');if(boundaryControl.id==='B01'){assert.equal(observation.counts.acquire,1);assert.equal(observation.counts.next,0);}if(boundaryControl.id==='B02'){assert.equal(observation.counts.next,1);assert.equal(observation.counts.contentBytes,1);}if(boundaryControl.id==='B03'){assert.equal(observation.counts.acquire,1);assert.equal(observation.counts.returned,0);}if(boundaryControl.id==='B04'){assert.equal(observation.counts.returned,1);assert.equal(observation.counts.settled,1);}}catch(error){record.status='FAIL';record.failure=reason(error);}state.boundaryControls.push(record);}
  else{assert.equal(result.code,captured.status==='PASS'?0:1);state.runtime.push(captured);}
  return captured;
}
try{
  guard('BEFORE_ADMISSION');
  const focused=read(resolve(recipe,'FOCUSED-CONTROLS.json'));assert.equal(focused.manifestSha256,request.preparationSha256);assert.equal(focused.requestSha256,requestHash);assert.equal(focused.passed,18);assert.equal(focused.failed,0);
  source=resolve(work,'source');const materialized=materializeInputs(binding,request,source,state.git);state.admission.push({id:'A01-fresh',status:'PASS',...materialized.proof});
  for(const row of materialized.inputs)sourceReadMap.set(resolve(source,row.path),row.sha256);
  tools=materializeTools(binding,work);guarded.set(resolve(work,'tools'),inventory(resolve(work,'tools')));guarded.set(resolve(work,'dependencies'),inventory(resolve(work,'dependencies')));
  save(resolve(raw,'PRE-RUN-BINDINGS.json'),{requestHash,preparationSha256:request.preparationSha256,inputs:materialized.inputs,tools:{regular:tools.regular,aliases:tools.aliases},pristineAndPatchedHashAuthenticated:true,continuation});
  const build=await tool('build',tools.compiler,['-p','tsconfig.build.json','--typeRoots',resolve(work,'dependencies/node_modules/@types')],source);assert.equal(build.code,0);assert.equal(build.stderr,'');
  sameInventory(inventory(source).filter(row=>!row.path.startsWith('dist/')),materialized.inputs);
  const destination=resolve(work,'pack');fs.mkdirSync(destination);const packed=await tool('pack',tools.npm,['pack','--ignore-scripts','--json','--pack-destination',destination],source);assert.equal(packed.code,0);packFile=resolve(destination,safe(JSON.parse(packed.stdout)[0].filename));assert.equal(fileHash(packFile),request.pack.sha256,'EXACT_WHOLE_PACK_REPRODUCTION');
  const members=tarEntries(fs.readFileSync(packFile),true).map(row=>{assert.ok(row.path.startsWith('package/'));return {...row,path:row.path.slice(8)};});sameInventory(members,request.packageFiles);state.admission.push({id:'A03-fresh',status:'PASS',wholePackSha256:fileHash(packFile),members:members.length});
  guarded.set(source,inventory(source));
  const installed=resolve(work,'installed');fs.mkdirSync(installed);save(resolve(installed,'package.json'),{private:true,type:'module'});
  const installation=await tool('install',tools.npm,['install','--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false','--save-exact',packFile],installed);assert.equal(installation.code,0);
  const packageRoot=resolve(installed,'node_modules/virtual-bash');sameInventory(inventory(packageRoot),request.packageFiles);guarded.set(packageRoot,inventory(packageRoot));
  const sourceConsumer=resolve(work,'source-consumer');fs.mkdirSync(sourceConsumer);save(resolve(sourceConsumer,'package.json'),{private:true,type:'module'});
  for(const row of selectedCases)await runtime('source',source,sourceConsumer,row.id);
  for(const row of selectedCases)await runtime('installed',packageRoot,installed,row.id);
  const moved=resolve(work,'moved');guarded.delete(packageRoot);fs.renameSync(installed,moved);assert.equal(fs.existsSync(installed),false);const movedPackage=resolve(moved,'node_modules/virtual-bash');sameInventory(inventory(movedPackage),request.packageFiles);guarded.set(movedPackage,inventory(movedPackage));
  for(const row of selectedCases)await runtime('moved',movedPackage,moved,row.id);
  state.admission.push({id:'A04-fresh',status:'PASS',physicallyMoved:true,oldInstallAbsent:true});
  const mutation=request.mutants.find(row=>row.id==='M07');assert.deepEqual(mutation,continuation.productMutant);
  const mutant=resolve(work,'M07');fs.mkdirSync(mutant);for(const row of materialized.inputs){const target=resolve(mutant,row.path),original=materialized.bodies.get(row.path);write(target,row.path===mutation.path?applyMutant(original,mutation):original);fs.chmodSync(target,parseInt(row.mode,8)&511);}guarded.set(mutant,inventory(mutant));
  const mutantConsumer=resolve(work,'M07-consumer');fs.mkdirSync(mutantConsumer);save(resolve(mutantConsumer,'package.json'),{private:true,type:'module'});await runtime('M07',mutant,mutantConsumer,mutation.caseId,mutation);
  for(const boundaryControl of continuation.boundaryControls){const consumer=resolve(work,`${boundaryControl.id}-consumer`);fs.mkdirSync(consumer);save(resolve(consumer,'package.json'),{private:true,type:'module'});await runtime(boundaryControl.id,source,consumer,'R12',undefined,boundaryControl);}
  state.boundProof={priorEvidenceCommit:continuation.priorEvidenceCommit,priorResultSha256:continuation.priorResultSha256,runtimePerLayout:22,typeOutcomes:20,packageNegatives:7,freshControls:6,priorProductMutantKills:7,notRerun:true};
  state.admission.push({id:'A07-composed',status:state.mutants.length===1&&state.mutants[0].status==='KILLED'?'PASS':'FAIL',boundPriorKills:7,newMutants:state.mutants.length});
  state.admission.push({id:'A08-new',status:'PASS',allRecordedChildrenReaped:state.children.every(row=>row.reaped),perCaseClosure:true});
  state.composedRuntime=Object.fromEntries(['source','installed','moved'].map(profile=>{const oldIds=priorResult.runtime.filter(row=>row.profile===profile&&row.status==='PASS').map(row=>row.id),newIds=state.runtime.filter(row=>row.profile===profile&&row.status==='PASS').map(row=>row.id);assert.equal(new Set([...oldIds,...newIds]).size,oldIds.length+newIds.length,'NO_OLD_RESCORE');return[profile,{bound:oldIds.length,newQualified:newIds.length,qualified:oldIds.length+newIds.length}];}));
  state.status=state.runtime.length===24&&state.runtime.every(row=>row.status==='PASS')&&state.mutants.length===1&&state.mutants[0].status==='KILLED'&&state.boundaryControls.length===4&&state.boundaryControls.every(row=>row.status==='KILLED')?'COMPOSED_SCOPED_PUBLIC_TIMEOUT_PROOF_PASSED':'SCOPED_PUBLIC_TIMEOUT_CONTINUATION_FINDINGS';
  if(state.status!=='COMPOSED_SCOPED_PUBLIC_TIMEOUT_PROOF_PASSED')process.exitCode=1;
}catch(error){state.status='STOP_NO_RETRY';state.failure=reason(error);process.exitCode=1;}
finally{
  try{guard('FINAL');for(const row of state.children)if(row.pid)absent(row.pid);state.allChildrenReaped=true;}catch(error){state.status='STOP_NO_RETRY';state.finalFailure=reason(error);process.exitCode=1;}
  state.finishedAt=new Date().toISOString();state.unexecutedRuntime=['source','installed','moved'].flatMap(profile=>selectedCases.filter(row=>!state.runtime.some(done=>done.profile===profile&&done.id===row.id)).map(row=>`${profile}:${row.id}`));
  state.typesNotRerun=20;state.priorSuccessfulRuntimeNotRerun=66;state.unexecutedMutants=state.mutants.length?[]:['M07'];state.unexecutedBoundaryControls=continuation.boundaryControls.filter(row=>!state.boundaryControls.some(done=>done.id===row.id)).map(row=>row.id);
  if(state.allChildrenReaped)try{state.archive=archiveEvidence({run,raw,work,children:state.children,remove:state.status!=='STOP_NO_RETRY'});}catch(error){state.status='STOP_NO_RETRY';state.archiveFailure=reason(error);process.exitCode=1;}
  save(resolve(run,'RESULT.json'),state);console.log(JSON.stringify({status:state.status,runtime:state.runtime.length,mutants:state.mutants.length,boundaryControls:state.boundaryControls.length,reaped:state.allChildrenReaped,publicAcceptance:false}));
}
