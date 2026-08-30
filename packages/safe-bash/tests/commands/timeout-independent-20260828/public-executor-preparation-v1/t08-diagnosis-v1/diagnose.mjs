import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { recipe, owned, repository, read, fileHash, sha, write, save, inventory, sameInventory, authenticatePreparation, reason } from '../common.mjs';
import { materializeTools } from '../admission.mjs';
import { supervisor, absent } from '../supervisor.mjs';
import { qualifyType, parseDiagnostics } from '../type-trace.mjs';
import { consumers, compilerOptions } from '../../public-integration-freeze-v1/types.mjs';
import { tarEntries } from '../../repaired-f22-v1/recipe/io.mjs';
import { archiveEvidence } from '../archive.mjs';
const scope=resolve(recipe,'t08-diagnosis-v1'),manifest=read(resolve(scope,'MANIFEST.json'));
assert.equal(fileHash(resolve(scope,'MANIFEST.json')),process.argv[2]);
for(const row of manifest.files)assert.equal(fileHash(resolve(repository,row.path)),row.sha256);
const {binding}=authenticatePreparation('45d41c9e97d69febabaa700766f84950a9c36db3ca6fd99c921492296a518813');
const run=resolve(recipe,'runs/t08-diagnosis-v1'),raw=resolve(run,'raw'),work=resolve(recipe,'node_modules/t08-diagnosis-v1');
assert.equal(fs.existsSync(run),false);assert.equal(fs.existsSync(work),false);fs.mkdirSync(raw,{recursive:true});fs.mkdirSync(work,{recursive:true});
const state={schema:'timeout-public-T08-independent-diagnosis/1',candidate:manifest.candidate,startedAt:new Date().toISOString(),children:[],status:'RUNNING',publicRuntime:0,publicTypeQualification:0,retries:0};
const guards=new Map();
const guard=()=>{authenticatePreparation('45d41c9e97d69febabaa700766f84950a9c36db3ca6fd99c921492296a518813');for(const row of manifest.files)assert.equal(fileHash(resolve(repository,row.path)),row.sha256);for(const [root,expected] of guards)sameInventory(inventory(root),expected);};
const child=supervisor({raw,work,guard,children:state.children});
try{
  const tools=materializeTools(binding,work);guards.set(resolve(work,'tools'),inventory(resolve(work,'tools')));guards.set(resolve(work,'dependencies'),inventory(resolve(work,'dependencies')));
  const supplied=read(resolve(repository,manifest.packageInventory));assert.equal(fileHash(supplied.pack.physical),manifest.packSha256);const bytes=fs.readFileSync(supplied.pack.physical);assert.equal(bytes.length,749907);
  const members=tarEntries(bytes,true).map(row=>{assert.ok(row.path.startsWith('package/'));return {...row,path:row.path.slice(8)};});const packageFiles=supplied.files.entries.filter(row=>row.kind==='file');assert.equal(packageFiles.length,858);sameInventory(members,packageFiles);
  const consumer=resolve(work,'consumer'),packageRoot=resolve(consumer,'node_modules/virtual-bash');fs.mkdirSync(packageRoot,{recursive:true});
  for(const row of members){write(resolve(packageRoot,row.path),row.body);fs.chmodSync(resolve(packageRoot,row.path),row.mode);}guards.set(packageRoot,inventory(packageRoot));
  save(resolve(consumer,'package.json'),{private:true,type:'module'});const spec=consumers.find(row=>row.id==='T08');write(resolve(consumer,'consumer.ts'),spec.source);save(resolve(consumer,'tsconfig.json'),{compilerOptions:{...compilerOptions,typeRoots:[resolve(work,'dependencies/node_modules/@types')]},files:['consumer.ts']});
  const trace=resolve(raw,'compiler-reads.jsonl');const result=await child('T08-original-payload',['--require',resolve(owned,'repaired-f22-v1/recipe/tool-observer.cjs'),tools.compiler,'--pretty','false','-p',resolve(consumer,'tsconfig.json')],consumer,{DU_ADMISSION_WORK:work,DU_ADMISSION_RUN:recipe,DU_ADMISSION_LOG:trace,DU_TOOL_MAP:resolve(work,'tool-map.json')});
  result.records=fs.readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);save(resolve(raw,'RAW-TYPE-RESULT.json'),{code:result.code,signal:result.signal,stdout:result.stdout,stderr:result.stderr});
  const context={packageRoot,packageFiles,consumerPath:resolve(consumer,'consumer.ts'),configPath:resolve(consumer,'tsconfig.json'),configHash:fileHash(resolve(consumer,'tsconfig.json')),consumerPackagePath:resolve(consumer,'package.json'),consumerPackageHash:fileHash(resolve(consumer,'package.json')),toolMap:tools.toolMap,compilerHash:tools.toolMap[resolve(work,'tools/typescript/lib/_tsc.js')]};
  const diagnostics=parseDiagnostics(result.stdout,spec.source);state.actualDiagnostics=diagnostics;state.originalPayloadSha256=sha(spec.source);state.rootDeclarationSha256=packageFiles.find(row=>row.path==='dist/index.d.ts').sha256;
  let oldFailure;try{qualifyType(result,spec,context);}catch(error){oldFailure=reason(error);}assert.ok(oldFailure?.message.includes('TYPE_DIAGNOSTIC_CODE'));state.originalFrozenPredicate={expectedCode:2353,status:'REJECTED_ACTUAL_DIAGNOSTIC',failure:oldFailure};
  assert.equal(diagnostics.length,1);assert.deepEqual({file:diagnostics[0].file,line:diagnostics[0].line,column:diagnostics[0].column,code:diagnostics[0].code,token:diagnostics[0].token},{file:'consumer.ts',line:2,column:spec.source.split('\n')[1].indexOf('invoker')+1,code:2561,token:'invoker'});
  const expectedMessage='Object literal may only specify known properties, but \'invoker\' does not exist in type \'Omit<TimeoutCommandsOptions, "replace">\'. Did you mean to write \'invoke\'?';assert.equal(diagnostics[0].message,expectedMessage);
  const qualified=qualifyType(result,{...spec,code:2561},context);state.authenticatedRootClosure=qualified.authenticatedReads;state.dependencyReads=qualified.dependencyReads.length;state.fullMessage=expectedMessage;state.proposedCorrection={caseId:'T08',oldCode:2353,newCode:2561,column:diagnostics[0].column,message:expectedMessage,unchangedPayload:true,unchangedExpectedRejection:true,entrypoint:'root',notOldRescore:true};state.status='EXACT_T08_VERIFIER_CATEGORY_DIAGNOSED';
}catch(error){state.status='STOP_NO_RETRY';state.failure=reason(error);process.exitCode=1;}
finally{try{guard();for(const row of state.children)if(row.pid)absent(row.pid);state.allChildrenReaped=true;state.archive=archiveEvidence({run,raw,work,children:state.children,remove:state.status==='EXACT_T08_VERIFIER_CATEGORY_DIAGNOSED'});}catch(error){state.status='STOP_NO_RETRY';state.finalFailure=reason(error);process.exitCode=1;}state.finishedAt=new Date().toISOString();save(resolve(run,'RESULT.json'),state);console.log(JSON.stringify(state));}
