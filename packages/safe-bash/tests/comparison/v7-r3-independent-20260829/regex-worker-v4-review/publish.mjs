import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const home=path.dirname(fileURLToPath(import.meta.url));
const descriptor=fs.openSync(path.join(home,'PUBLICATION.json'),'wx',0o600);
const insist=(value,code)=>{if(!value)throw Error(code);};
async function binding(filename,cap=262144){const info=fs.lstatSync(filename);insist(info.isFile()&&!info.isSymbolicLink()&&info.size<=cap,'FILE_ADMISSION');const digest=createHash('sha256');let bytes=0;for await(const chunk of fs.createReadStream(filename,{highWaterMark:65536})){bytes+=chunk.length;insist(bytes<=info.size,'HASH_GROWTH');digest.update(chunk);}insist(bytes===info.size,'HASH_SHORT');return{path:filename,bytes,mode:info.mode&511,sha256:digest.digest('hex')};}
function json(filename){const info=fs.lstatSync(filename);insist(info.isFile()&&!info.isSymbolicLink()&&info.size<=262144,'JSON_ADMISSION');return JSON.parse(fs.readFileSync(filename,'utf8'));}
let output;
try{
 const seal=json(path.join(home,'PRESEAL.json')),result=json(path.join(home,'RESULT.json'));
 insist(result.status==='SCOPED_CONTROLS_PASS'&&result.novel.passed===12&&result.smallFixtures.rows.length===2,'CONTROL_RESULT');
 const guards=[];
 for(const row of[...seal.inputs,...seal.copies,...seal.own,...seal.tools]){const actual=await binding(row.path,120000000);insist(actual.bytes===row.bytes&&actual.mode===row.mode&&actual.sha256===row.sha256,'POSTGUARD');guards.push(actual);}
 const history=[];
 for(const version of[2,3]){const filename=path.join(path.dirname(seal.source),'regex-worker-instrumented-v'+version+'-20260829','REPORT.md');history.push(await binding(filename,12000));}
 const sourceCopyDelta={filesByteExact:30,derivedSealOnly:'inherited helper absolute paths',fixtureAuthorization:'independent-review-fixture; actualRootGrant:false',originalInputsChanged:false};
 const files=[];let bytes=0;
 const excluded=new Set(['PUBLICATION.json','publish.stdout.raw','publish.stderr.raw']);
 async function walk(directory){for(const name of fs.readdirSync(directory).sort()){const filename=path.join(directory,name),relative=path.relative(home,filename),info=fs.lstatSync(filename);if(excluded.has(relative))continue;if(info.isDirectory()){await walk(filename);continue;}insist(files.length<256,'ENTRY_CAP');if(info.isSymbolicLink()){const target=fs.readlinkSync(filename);insist(relative==='faults/N05/witness.data'&&target==='target.data','OWNED_LINK');files.push({path:relative,type:'symlink',target,mode:info.mode&511});continue;}const row=await binding(filename);bytes+=row.bytes;insist(bytes<=4194304,'EVIDENCE_CAP');files.push({...row,path:relative,type:'regular'});}}
 await walk(home);
 const review=await binding(path.join(home,'REVIEW.json'));
 const controlCaptureBytes=result.parent.observed.reduce((sum,value)=>sum+value,0)+result.smallFixtures.rows.reduce((sum,row)=>sum+row.state.observed.reduce((a,b)=>a+b,0),0);
 output={schema:'INDEPENDENT_REGEX_V4_PUBLICATION',status:'PREEXECUTION_ACCEPTED_SCOPED',review,sourceSealSha256:seal.sourceSealSha256,postguards:guards,history,sourceCopyDelta,files,totalRetainedFileBytes:bytes,fixtureRawObservedRetainedBytes:controlCaptureBytes,additionalOuterRaw:await binding(path.join(home,'run.stdout.raw')),cohorts:{smallQualifications:2,intentionalOrdinaryFailures:2,novel:12,full55Executed:0,Workers:0,actualEngines:0},lifecycle:{fixtureNodeStarts:4,peak:3,parent:result.parent,children:result.smallFixtures.rows.map(row=>row.state),allCapturedChildClosuresKnown:true,outerObservedByToolExit:true,globalAbsenceClaim:false},administration:{allOwnedRoleUpperBoundIncludingFinalGit:44,authorizedCap:48,qualification:'Tool-route accounting bound includes shell/Git/patch helper allowances and four fixture roles; not44 independently measured PIDs or a global census. Final Git/status still prospective here.'},checkpoint:new Date().toISOString(),activation:false,full55NeedsFreshPlanSealRootGrant:true};
}catch(error){output={status:'HOLD',message:error.message,activation:false};process.exitCode=1;}
fs.writeSync(descriptor,JSON.stringify(output,null,2)+'\n');fs.fsyncSync(descriptor);fs.closeSync(descriptor);process.stdout.write(JSON.stringify({status:output.status,reviewSha256:output.review?.sha256,postguards:output.postguards?.length,files:output.files?.length,bytes:output.totalRetainedFileBytes,fixtureRaw:output.fixtureRawObservedRetainedBytes,message:output.message??null})+'\n');
