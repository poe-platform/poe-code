import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.dirname(new URL(import.meta.url).pathname);
const capture=fs.openSync(root+'/PREPARE.capture.data','wx',0o600);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=row=>fs.writeSync(capture,JSON.stringify(row)+'\n');
try{
 record({event:'START',at:new Date().toISOString()});
 const manifest=JSON.parse(fs.readFileSync(root+'/evidence/MANIFEST.json'));
 const get=name=>{const row=manifest.rows.find(row=>row.path.endsWith('/'+name));if(!row)throw Error('MISSING');const bytes=fs.readFileSync(root+'/evidence/'+row.capture);if(hash(bytes)!==row.sha256||bytes.length!==row.bytes)throw Error('INTEGRITY');return bytes;};
 fs.mkdirSync(root+'/modules');const files=[];
 for(const name of ['state.mjs','storage.mjs','capture.mjs','observer-state.mjs','admission.mjs','lifecycle.mjs','group-observer.mjs']){const bytes=get(name);fs.writeFileSync(root+'/modules/'+name,bytes,{flag:'wx'});files.push({path:'modules/'+name,sha256:hash(bytes),bytes:bytes.length,role:'EXACT_AUTHOR_HELPER'});}
 const original=get('control-owner.mjs').toString('utf8');const begin=original.indexOf(' function fakeOperations(');const end=original.indexOf(' const storage=new Storage(capture,',begin);if(begin<0||end<begin)throw Error('BLOCK_BOUNDARY');
 const body=original.slice(begin,end);
 const imports="import fs from 'node:fs';\nimport {completion,cleanupTimes,deadlineAdmission,ManagedLedger} from './state.mjs';\nimport {Storage} from './storage.mjs';\nimport {finalizeCaptures} from './capture.mjs';\nimport {classifyGroup} from './observer-state.mjs';\nimport {small,validateReview,hash} from './admission.mjs';\n";
 const prefix="export function authorBranches(capture,plan){const results=[];const assert=(value,message)=>{if(!value)throw Error(message);};const reject=callback=>{let rejected=false;try{callback();}catch{rejected=true;}assert(rejected,'EXPECTED_REJECTION');};const good=()=>({exit:true,close:true,group:{state:'absent'},signal:null,stop:null,errors:[],capture:[{flush:true,size:true,hash:true,close:true},{flush:true,size:true,hash:true,close:true}],filesVerified:true,receiptPublished:true});\n";
 const adapted=Buffer.from(imports+prefix+body+'return results;}\n');fs.writeFileSync(root+'/modules/AUTHOR-BRANCHES.mjs',adapted,{flag:'wx'});files.push({path:'modules/AUTHOR-BRANCHES.mjs',sha256:hash(adapted),bytes:adapted.length,role:'EXACT_TEN_BRANCHES_NEW_CONTROLLER',originalBlockSha256:hash(Buffer.from(body))});
 const payload="const fs=process.getBuiltinModule('fs');const one=fs.fstatSync(1),two=fs.fstatSync(2);const info={pid:process.pid,one:{ino:one.ino,dev:one.dev,mode:one.mode&511},two:{ino:two.ino,dev:two.dev,mode:two.mode&511}};fs.writeSync(1,JSON.stringify(info)+'\\n');fs.writeSync(1,Buffer.from([65,0,66,10]));fs.writeSync(2,'WRAPPER_STDERR\\n');const probe=Buffer.alloc(1);if(fs.readSync(1,probe,0,1,0)!==1||probe[0]!==123)process.exitCode=21;if(fs.readSync(2,probe,0,1,0)!==1||probe[0]!==87)process.exitCode=22;";
 fs.writeFileSync(root+'/WRAPPER-PAYLOAD.data',payload,{flag:'wx'});files.push({path:'WRAPPER-PAYLOAD.data',sha256:hash(Buffer.from(payload)),bytes:Buffer.byteLength(payload),role:'LITERAL_NO_IMPORT_FD_CHECK'});
 const wrapper=JSON.parse(get('APPROVAL-REQUEST.template.json')).parameters.cmd;
 const prefixEnd=wrapper.indexOf(' /Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-surface-independent-20260829/functional-reference-v2/entry.mjs');
 const redirectStart=wrapper.indexOf(' >/private/tmp/');if(prefixEnd<0||redirectStart<prefixEnd)throw Error('WRAPPER_BOUNDARY');
 const structure={prefix:wrapper.slice(0,prefixEnd),removedPayload:wrapper.slice(prefixEnd,redirectStart),redirections:wrapper.slice(redirectStart),payload,root};
 fs.writeFileSync(root+'/WRAPPER-DERIVATIVE.json',JSON.stringify(structure,null,2)+'\n',{flag:'wx'});
 for(const name of ['review-controls.mjs','CONTROL-PRESEAL.md','WRAPPER-DERIVATIVE.json']){const bytes=fs.readFileSync(root+'/'+name);files.push({path:name,sha256:hash(bytes),bytes:bytes.length,role:'REVIEW_CONTROL'});}
 fs.writeFileSync(root+'/CONTROL-SEAL.json',JSON.stringify({source:'a5fd225af5f9985ae805f48ab1b1790a9c3fbc7f',evidence:'f9fe59338cf01863735ee67bef5ae03ef993d053',files,authorBranches:10,authorLiteralFixtures:2,novel:10,nodeProcessesIncludingOwner:5,extraRefusalShells:2,nativeEntryExecuted:false},null,2)+'\n',{flag:'wx'});
 record({event:'SEALED',files:files.length});console.log(JSON.stringify({status:'CONTROL_PRESEALED',files:files.length}));
}catch(error){record({event:'STOP',message:error.message});process.exitCode=1;}finally{fs.closeSync(capture);}
