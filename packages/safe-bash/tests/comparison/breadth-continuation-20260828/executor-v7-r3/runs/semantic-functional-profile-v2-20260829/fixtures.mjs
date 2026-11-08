import {functionalProfile} from './functional-profile.mjs';
import {createInvocationRecorder,invocationContext} from './invocations.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCoordinator } from './body.mjs';
import { assessSemanticTerminal } from './semantic-assessor.mjs';
import { verifySuccessor, baseRoot, home, acceptedAdmission, digest } from './profile.mjs';
import { readDocument, encode } from '../../../executor-v7-r2/records.mjs';
import { writeReserved } from '../../../executor-v7/evidence.mjs';
import { selectOperation } from '../../../executor-v4/operations.mjs';
import { qualify } from '../../../executor-v4/predicates.mjs';
const source=path.resolve(baseRoot,'..');
const read=name=>JSON.parse(fs.readFileSync(path.join(source,name)));
const configuration={plan:read('executor-v7-r3/OPERATION-PLAN.json'),legacy:read('LEGACY-RECIPES.json').rows.map(row=>row.recipe),workflows:read('WORKFLOWS.json').rows,schedule:read('executor-preparation-v1/SCHEDULE.json')};
export const references={review:{commit:'1'.repeat(40),path:'synthetic/review.json',sha256:'2'.repeat(64)},grant:{commit:'3'.repeat(40),path:'synthetic/grant.json',sha256:'4'.repeat(64)}};
export const authorityRows=()=>['review','grant'].map((role,index)=>({role:'synthetic-authority-metadata',ordinal:index+1,reference:references[role],pid:800001+index,group:-(800001+index),status:0,signal:null,errorCode:null,stdoutBytes:1,stdoutSha256:references[role].sha256,stderrBase64:'',reaped:true}));
export function receipt(records,stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),pid=900001,exit=0) {
  const rows=records.map((row,index)=>({sequence:index,...row}));const raw=Buffer.concat(rows.map(row=>encode(row,262144)));
  return {pid,exit:{code:exit,signal:null},close:{code:exit,signal:null},reaped:true,failures:[],signals:[],records:rows,captureBytes:{stdout:stdout.length,stderr:stderr.length,records:raw.length},stdout:stdout.toString('base64'),stderr:stderr.toString('base64'),rawRecords:raw.toString('base64'),natural:exit===0};
}
function census(specimen,after=false) {
  const entries=new Map([['/fixture',{path:'/fixture',type:'directory',mode:493,size:0}]]);
  const directory=name=>{if(!entries.has(name))entries.set(name,{path:name,type:'directory',mode:493,size:0});};
  const file=(name,value)=>{let parent=path.posix.dirname('/fixture/'+name);while(parent.startsWith('/fixture')){directory(parent);if(parent==='/fixture')break;parent=path.posix.dirname(parent);}entries.set('/fixture/'+name,{path:'/fixture/'+name,type:'file',mode:value.mode??420,size:Buffer.from(value.base64??'','base64').length,base64:value.base64??''});};
  for(const name of specimen.directories)directory('/fixture/'+name);
  for(const [name,value]of Object.entries(specimen.files))file(name,value);
  for(const [name,target]of Object.entries(specimen.symlinks))entries.set('/fixture/'+name,{path:'/fixture/'+name,type:'symlink',mode:511,size:target.length,target});
  if(after){for(const [name,value]of Object.entries(specimen.expected.addedFiles??specimen.expected.files??{}))file(name,value);for(const name of specimen.expected.absent??[])entries.delete('/fixture/'+name);}
  return {complete:true,entries:[...entries.values()].sort((left,right)=>left.path<right.path?-1:left.path>right.path?1:0),bytes:0};
}
function reportFor(specimen,operation,wrong=false) {
  const ours=operation.layout!=='baseline-installed';const expected=specimen.expected;
  let stdout=Buffer.from(expected.stdoutBase64??Buffer.from((expected.stdoutIncludes??[]).join(' ')).toString('base64'),'base64');if(wrong)stdout=Buffer.from('WRONG_CAPTURED_BYTES');
  const stderr=Buffer.from(expected.stderrBase64??'','base64');
  const report={engine:ours?'ours':'baseline',caseId:specimen.id,captureErrors:[],events:[],additionalObservations:Object.fromEntries((specimen.additionalObservations??[]).map(value=>[value,true])),cleanup:{completion:'returned',disposed:ours,baselineDisposeAPI:false},before:census(specimen),after:census(specimen,true),setup:ours?{execCalls:1,emptySource:true,dispatches:0,namespaceUnchanged:true,settled:true}:{execCalls:0,settled:true},result:{exitCode:expected.exitCode,stdoutBoundary:ours?'raw ShellResult.stdoutBytes':'stdoutAsBytes ByteString encoded Latin-1',stderrBoundary:ours?'raw ShellResult.stderrBytes':'derived UTF-8 public stderr string'},safety:{safe:true,disposed:true,errors:[],hasPrimary:false},loads:{count:1,evaluated:true,denied:[],entryResolutions:[],consumerResolutions:[]},resources:{pending:0,descriptors:0,violations:[]},postGuard:true,late:[],bootstrap:null,authorityMetadata:authorityRows(),cleanupErrors:[]};
  if(expected.elapsedAtLeastMs!==undefined)report.productElapsedMs=expected.elapsedAtLeastMs;
  if(specimen.id==='W03'){
    const unqualified={status:'UNQUALIFIED',reason:'Synthetic protocol fixture; no actual observer credit'};
    const sourceReceipt={acquire:1,next:5,returns:0,settled:1,active:0,yieldedBytes:7,yieldedLengths:[1,2,1,3]};
    report.telemetry=ours?{inputAdmission:{status:'OBSERVABLE_CHUNK_ADMISSION',inputBase64:'AP9BCg2AAA=='},chunks:{status:'QUALIFIED',receipt:sourceReceipt},dispatch:{status:'QUALIFIED',catCount:1,events:[{command:'cat',phase:'semantic'}]},timers:unqualified,iteratorCleanup:{status:'QUALIFIED',receipt:sourceReceipt}}:{inputAdmission:{status:'OBSERVABLE_BYTE_ADMISSION',inputBase64:'AP9BCg2AAA=='},chunks:unqualified,dispatch:unqualified,timers:unqualified,iteratorCleanup:unqualified};
  }
  return {report,stdout,stderr};
}
export async function compose(name,{wrongFirst=false,preparationFailure=false,unsafeFirst=false}={}) {
  const fixtureRoot=path.join(home,'evidence','fixtures',name);fs.mkdirSync(fixtureRoot,{recursive:true});
  const repository=path.join(fixtureRoot,'runs','fixture-repository');
  const admissionFile=path.join(repository,acceptedAdmission.path);fs.mkdirSync(path.dirname(admissionFile),{recursive:true});
  const actualAdmission=path.resolve(baseRoot,'../../../..',acceptedAdmission.path);
  for(const filename of ['RESULT.json','STAGED.json','STAGED.json.part-0000.data','STAGED.json.part-0001.data','STAGED.json.part-0002.data','STAGED.json.part-0003.data'])fs.copyFileSync(path.join(path.dirname(actualAdmission),filename),path.join(path.dirname(admissionFile),filename),fs.constants.COPYFILE_EXCL);
  const recipe=verifySuccessor(),runId='synthetic-'+name,root=path.join(fixtureRoot,'runs',runId),events=[];
  const context={root:fixtureRoot,phase:'cohort',runId,outputRoot:root};
  const approved={functionalProfile,phase:'cohort',runId,outputRoot:root,planSha256:digest(Buffer.from(JSON.stringify({limits:configuration.plan.limits,command:configuration.plan.command,phase:'cohort',operations:configuration.plan.cohort}))),command:{entry:'coordinator.mjs',phase:'cohort',runId,nodeArgs:configuration.plan.command.nodeArgs},acceptedAdmission};
  const drivers={
    checkpoint:async()=>{},spawnObserved:()=>{},inheritedExitCode:()=>0,
    configure(){if(preparationFailure)throw undefined;return {...configuration,recipe};},
    authorize(input){const metadata=authorityRows();input.metadataChildren.push(...metadata);events.push(...metadata.map(receipt=>({kind:'authority-observed',receipt})));return {recipe,approved,plan:configuration.plan,context,authorization:{repository,phase:'cohort',runId,outputRoot:root,review:references.review,grant:references.grant},metadataChildren:input.metadataChildren,synthetic:true};},
    integrity:async()=>{},stageDeclaration:()=>({views:[],aliases:[],evidenceFiles:[]}),
    selectOperation:(permission,config,worker)=>selectOperation(permission.approved,config,permission.plan,permission.context,worker),
    async supervise(prepared,synthetic,work,attach){if(synthetic)throw Error('NO_CONTROL_WORKERS');const config=prepared.configValue,operation=configuration.plan.cohort[config.operationOrdinal-1];writeReserved(config.claimPermit,encode({operation,recipe}));const data=reportFor(config.specimen,operation,wrongFirst&&operation.ordinal===1);const metadata=authorityRows();const consumerURL=pathToFileURL(path.join(config.view.root,config.view.consumerPath)).href;
      const entryResolution={kind:'consumer-entry-resolution',specifier:consumerURL,parentURL:pathToFileURL(path.join(home,'worker.mjs')).href,url:consumerURL,expectedParentURL:pathToFileURL(path.join(home,'worker.mjs')).href,expectedURL:consumerURL,accepted:true};
      const entryFile=config.view.files.find(row=>row.path.endsWith('/index.js'));
      const consumerResolution={kind:'consumer-resolution',specifier:config.view.engine,parentURL:consumerURL,url:pathToFileURL(path.join(config.view.root,entryFile.path)).href,expectedParentURL:consumerURL,accepted:true};
      const delivered=[config.view.files.find(row=>row.path===config.view.consumerPath),entryFile];
      data.report.loads={count:delivered.length,evaluated:true,denied:[],entryResolutions:[entryResolution],consumerResolutions:[consumerResolution]};
      const engineEvents=[entryResolution,consumerResolution,...delivered.map(row=>({kind:'nextLoad',path:row.path,format:'module',bytes:row.bytes,sha256:row.sha256,evaluationProven:false,origin:'actual-nextLoad-source'}))];
      if(config.view.engine==='just-bash'){data.report.bootstrap={profile:'JUST_BASH_3_4_2_UNAVAILABLE_BOOTSTRAP_V1',opened:true,revoked:true,consumed:2,nativeDelegations:0,violations:[],callerAuthenticated:false,stockNodeCapabilities:false};engineEvents.push(...['module','worker_threads'].map((query,index)=>({kind:'bootstrap-unavailable',query,slot:index+1,nativeDelegation:false})));}engineEvents.push({kind:'consumer-evaluated',engine:config.view.engine});
      const invocationEvents=[];
      const invocation=createInvocationRecorder(invocationContext({operationId:operation.id,operationOrdinal:operation.ordinal,launchOrdinal:config.launchOrdinal,specimenSha256:operation.specimenSha256,layout:operation.layout}),event=>invocationEvents.push(event));
      if(operation.layout!=='baseline-installed')await invocation.invoke('empty-setup',null,()=>({exitCode:0}),[]);
      await invocation.invoke('semantic',null,()=>({exitCode:data.report.result.exitCode}),[]);
      const profileEvent={kind:'functional-profile-applied',functionalProfile,adapterRole:'FUNCTIONAL_ADAPTER_V2',engine:config.view.engine,defenseInDepth:config.view.engine==='just-bash'?false:null};
      const records=[...metadata.map(receipt=>({kind:'authority-observed',receipt})),{kind:'worker-operation-authorized',operationId:operation.id,operationOrdinal:operation.ordinal,launchOrdinal:config.launchOrdinal},...engineEvents,profileEvent,...invocationEvents,{kind:'final',workerRole:'SEMANTIC_FUNCTIONAL_WORKER_V2',functionalProfile,invocations:invocation.snapshot(),report:data.report,cleanupErrors:[],late:[],authorityMetadata:metadata}];const result=receipt(records,data.stdout,data.stderr,900000+operation.ordinal,unsafeFirst&&operation.ordinal===1?1:0);attach({pid:result.pid},result);return result;},
    qualify,async cleanup(){if(preparationFailure)throw false;},writeStream:(_descriptor,bytes)=>terminalBytes.push(Buffer.from(bytes))
  };
  const terminalBytes=[];
  const result=await runCoordinator({root:fixtureRoot,repository,mode:'cohort',runId,authorizationPath:'SYNTHETIC_ONLY',authorizationSha256:'0'.repeat(64)},drivers);
  const final={kind:'final',report:{mode:result.output.mode,runId,status:result.publication.status,unsafe:result.publication.unsafe,result:result.publication.reference,children:result.ledger.length,allChildrenReaped:result.ledger.every(row=>row.reaped)}};
  const captured=receipt([...events,final],Buffer.concat(terminalBytes),Buffer.alloc(0),990001,result.publication.exitCode);
  return {root,result,receipt:captured,assess:()=>assessSemanticTerminal(captured,root,{syntheticOnly:true}),realWorkers:0,modeledReceiptRows:result.ledger.length};
}
export function changedTerminal(captured,mutate) {
  const clone=structuredClone(captured);const terminal=JSON.parse(Buffer.from(clone.stdout,'base64'));mutate(terminal);const bytes=encode(terminal,32768);clone.stdout=bytes.toString('base64');clone.captureBytes.stdout=bytes.length;return clone;
}

