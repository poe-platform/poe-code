import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
const root=path.resolve('tests/compatibility/bash-ere-native-reference-20260829'),own=root+'/preflight-v1',destination=root+'/materialized';
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const requireValue=(value,message)=>{if(!value)throw Error(message);};
function bytes(filename,pin,maximum=1048576){const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const stat=fs.fstatSync(fd);requireValue(stat.isFile()&&stat.nlink===1&&stat.size<=maximum,'INPUT_TYPE_SIZE');if(pin)requireValue(stat.size===pin.bytes&&(stat.mode&511)===pin.mode,'INPUT_METADATA');const result=fs.readFileSync(fd);requireValue(result.length===stat.size&&(!pin||digest(result)===pin.sha256),'INPUT_HASH');return result;}finally{fs.closeSync(fd);}}
function write(filename,value){fs.writeFileSync(filename,value,{flag:'wx',mode:0o600});}
const sealBytes=bytes(root+'/PACKET-SEAL.json',{bytes:6292,mode:384,sha256:'7ceac39234b1ce5e789bfb9d5452ec9cf7c718284c2ce78b8c5434dad64a42a1'}),seal=JSON.parse(sealBytes);
const admitted=new Map();for(const item of seal.files)admitted.set(item.path,bytes(root+'/'+item.path,item));
const tools=JSON.parse(admitted.get('TOOLS.json'));
for(const pin of [...tools.toolPins,tools.environmentLauncher,tools.toolShell].filter(Boolean)){
 const descriptor=fs.openSync(pin.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const stat=fs.fstatSync(descriptor);requireValue(stat.isFile()&&stat.size===pin.bytes&&(stat.mode&511)===pin.mode,'TOOL_METADATA');const hash=crypto.createHash('sha256'),buffer=Buffer.alloc(1048576);let count,total=0;while((count=fs.readSync(descriptor,buffer,0,buffer.length,null))>0){total+=count;requireValue(total<=134217728,'TOOL_CAP');hash.update(buffer.subarray(0,count));}requireValue(total===pin.bytes&&hash.digest('hex')===pin.sha256,'TOOL_HASH');}finally{fs.closeSync(descriptor);}
}
requireValue(!fs.existsSync(destination),'UNUSED_MATERIALIZED');fs.mkdirSync(destination,{mode:0o700});fs.mkdirSync(destination+'/programs',{mode:0o700});
const deltas=[];
for(const name of ['entry','admission','capture','lifecycle','group-observer','observer-state','state','storage','observation']){
 const original=admitted.get('draft/'+name+'.mjs.data');requireValue(original!==undefined,'DRAFT_MEMBERSHIP');let output=original;
 if(name==='admission')output=bytes(own+'/admission.mjs');
 if(name==='entry'){
  let text=original.toString('utf8');
  const changes=[
   ["import {admit,small,pinned,hash} from './admission.mjs';","import {admit,small,pinned,hash,validateOuter,validateProvision,validateCohort} from './admission.mjs';"],
   [" const provision=JSON.parse(fs.readFileSync(directory+'/PREPROVISION.json'));\n for(const parent of provision.parents){const stat=fs.lstatSync(parent.path,{bigint:true});assert(stat.isDirectory()&&String(stat.dev)===parent.device&&String(stat.ino)===parent.inode&&Number(stat.mode&511n)===parent.mode,'PREPROVISION_DRIFT');}\n for(const [name,fd] of [['stdout',1],['stderr',2]]){const filename=root+'/outer/bootstrap.'+name,stat=fs.fstatSync(fd),named=fs.lstatSync(filename);assert(stat.isFile()&&named.isFile()&&!named.isSymbolicLink()&&stat.ino===named.ino&&stat.dev===named.dev&&stat.nlink===1&&(stat.mode&511)===384,'OUTER_FD_BINDING');outerHandles.push({name,fd,ino:stat.ino,path:filename});}\n storage.record({event:'RAW_START_BEFORE_ADMISSION',pid:process.pid,started,externalCapture:'pre-opened regular descriptors before Node module loading'});", " for(const [name,fd] of [['stdout',1],['stderr',2]])outerHandles.push(validateOuter(root,name,fd));"],
   [" const accepted=admit(directory,process.argv[3],process.argv[5]);"," const accepted=admit(directory,process.argv[3],process.argv[5]);\n storage.deadline=Math.min(accepted.grant.deadlineEpochMs,started+600000);storage.checkTime();\n validateProvision(accepted.provision,root);\n storage.record({event:'AUTHENTICATED_START',pid:process.pid,started,externalCapture:'pre-opened regular descriptors before Node module loading'});"],
   [" const expectedIds=audit.cases.map(row=>row.id);"," validateCohort(audit,accepted.requests,root);\n for(const literal of audit.cases){const relative='programs/'+literal.id+'.bash.data';assert(small(directory+'/'+relative,accepted.seal.files.find(item=>item.path===relative)).equals(Buffer.from(literal.program)),'PROGRAM_FILE_BINDING');}\n const expectedIds=audit.cases.map(row=>row.id);"],
  ];
  for(const [before,after] of changes){requireValue(text.split(before).length===2,'EXACT_ENTRY_DELTA');text=text.replace(before,after);}output=Buffer.from(text);deltas.push({name,changes});
 }
 new vm.SourceTextModule(output.toString('utf8'),{identifier:name+'.mjs'});
 write(destination+'/'+name+'.mjs',output);deltas.push({name,parentSha256:digest(original),materializedSha256:digest(output),unchanged:original.equals(output)});
}
for(const relative of ['COHORT.json','REQUESTS.json','PROTOCOL.json','TOOLS.json',...Array.from({length:12},(_,index)=>'programs/N'+String(index+1).padStart(2,'0')+'.bash.data')])write(destination+'/'+relative,admitted.get(relative));
const files=[];function inventory(directory,relative=''){for(const name of fs.readdirSync(directory).sort()){const filename=directory+'/'+name,rel=relative?relative+'/'+name:name,stat=fs.lstatSync(filename);if(stat.isDirectory())inventory(filename,rel);else{const value=bytes(filename);files.push({path:rel,bytes:value.length,mode:stat.mode&511,sha256:digest(value)});}}}inventory(destination);
const preseal={schema:'ere-capture-executable-preseal-v1',role:'PREEXECUTION_NOT_GO',parentProposalCommit:'8f85329b9e6906947ff3c1805447e90c3d60bcae',parentPacketSha256:digest(sealBytes),files};write(destination+'/PRESEAL.json',JSON.stringify(preseal,null,2)+'\n');
write(own+'/MATERIALIZATION.json',JSON.stringify({createdAt:new Date().toISOString(),parentPacketSha256:digest(sealBytes),presealSha256:digest(fs.readFileSync(destination+'/PRESEAL.json')),syntax:'all9 parsed unlinked and unevaluated before controls',deltas,programsUnchanged:12,fixtures:0,nativeExecutions:0,toolsReauthenticated:true},null,2)+'\n');
console.log(JSON.stringify({materialized:files.length,modules:9,programs:12,nativeExecutions:0,presealSha256:digest(fs.readFileSync(destination+'/PRESEAL.json'))}));
