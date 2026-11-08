import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
const root=path.resolve('tests/compatibility/bash-ere-native-reference-20260829'),own=root+'/preflight-v2',materialized=root+'/preflight-v2/materialized',scratch=own+'/scratch';
const started=Date.now(),deadline=started+120000;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function admitted(filename,pin){const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const stat=fs.fstatSync(fd);assert(stat.isFile()&&stat.nlink===1&&stat.size<=1048576);assert.equal(stat.size,pin.bytes);assert.equal(stat.mode&511,pin.mode);const bytes=fs.readFileSync(fd);assert.equal(digest(bytes),pin.sha256);assert.equal(bytes.length,stat.size);return bytes;}finally{fs.closeSync(fd);}}
assert.equal(process.argv.length,3);assert.match(process.argv[2],/^[0-9a-f]{64}$/);
const sealStat=fs.lstatSync(own+'/CONTROL-PRESEAL.json');
const seal=JSON.parse(admitted(own+'/CONTROL-PRESEAL.json',{bytes:sealStat.size,mode:384,sha256:process.argv[2]}));
for(const item of seal.files)admitted(root+'/'+item.path,item);
assert.equal(seal.fixtureChildren,0);assert.equal(seal.cases.length,12);
const runtimeSeal=JSON.parse(admitted(materialized+'/PRESEAL.json',seal.files.find(item=>item.path==='preflight-v2/materialized/PRESEAL.json')));
for(const item of runtimeSeal.files){const bytes=admitted(materialized+'/'+item.path,item);if(item.path.endsWith('.mjs'))new vm.SourceTextModule(bytes.toString('utf8'),{identifier:item.path});}
const admission=await import('./materialized/admission.mjs');
const {Storage}=await import('./materialized/storage.mjs');
const {completion,cleanupTimes,deadlineAdmission,ManagedLedger,creditObservation}=await import('./materialized/state.mjs');
const {finalizeCaptures}=await import('./materialized/capture.mjs');
const {decodeObservation}=await import('./materialized/observation.mjs');
const read=relative=>JSON.parse(admitted(materialized+'/'+relative,runtimeSeal.files.find(item=>item.path===relative)));
const cohort=read('COHORT.json'),requests=read('REQUESTS.json'),runtimeRoot='/private/tmp/safe-bash-ere-native-observations-20260829-v1';
const template=JSON.parse(admitted(own+'/APPROVAL-PROPOSAL.template.json',seal.files.find(item=>item.path==='preflight-v2/APPROVAL-PROPOSAL.template.json')));
assert(!fs.existsSync(scratch));fs.mkdirSync(scratch,{mode:0o700});
const results=[];let assertions=0;
function check(value){assertions++;assert(value);}
function rejects(action,pattern){assertions++;assert.throws(action,pattern);}
function clone(value){return structuredClone(value);}
function jsonFile(name,bytes){const filename=scratch+'/'+name;fs.writeFileSync(filename,bytes,{flag:'wx',mode:0o600});return filename;}
function pin(filename){const stat=fs.lstatSync(filename),bytes=fs.readFileSync(filename);return {bytes:bytes.length,mode:stat.mode&511,sha256:digest(bytes)};}
function eligible(){return {id:'SYNTHETIC',exit:true,close:true,group:{state:'absent'},signal:null,stop:null,errors:[],capture:[{flush:true,size:true,hash:true,close:true},{flush:true,size:true,hash:true,close:true}],filesVerified:true,receiptPublished:true};}
async function control(id,action){const begin=Date.now(),before=assertions;try{assert(begin<=deadline);await action();results.push({id,status:'PASS',assertions:assertions-before,elapsedMs:Date.now()-begin,role:'DATA_NO_NATIVE_OBSERVATION'});}catch(error){results.push({id,status:'FAIL',assertions:assertions-before,elapsedMs:Date.now()-begin,error:{name:error?.name,message:String(error?.message??error)}});}console.log(JSON.stringify(results.at(-1)));}
await control('C01',()=>{
 check(admission.validateCohort(cohort,requests,runtimeRoot));
 const extra=clone(cohort);extra.cases.push({...extra.cases[0],id:'N13'});rejects(()=>admission.validateCohort(extra,requests,runtimeRoot),/EXACT12/);
 const fixtures=clone(cohort);fixtures.fixtures.push({path:'old-fixture'});rejects(()=>admission.validateCohort(fixtures,requests,runtimeRoot),/EXACT12/);
 const reordered=clone(requests);[reordered[0],reordered[1]]=[reordered[1],reordered[0]];rejects(()=>admission.validateCohort(cohort,reordered,runtimeRoot),/ID/);
 for(const literal of cohort.cases){const value=admitted(materialized+'/programs/'+literal.id+'.bash.data',runtimeSeal.files.find(item=>item.path==='programs/'+literal.id+'.bash.data'));check(value.equals(Buffer.from(literal.program)));}
});
await control('C02',()=>{
 for(const mutate of [value=>value[0].argv[3]+='\n$(unapproved)',value=>value[0].argv=['unapproved-file'],value=>value[0].executable='/bin/other',value=>value[0].stdinBase64='eA==']){const changed=clone(requests);mutate(changed);rejects(()=>admission.validateCohort(cohort,changed,runtimeRoot),/BINDING/);}
 const wrong=clone(cohort);wrong.cases[0].programSha256='0'.repeat(64);rejects(()=>admission.validateCohort(wrong,requests,runtimeRoot),/LITERAL_BINDING/);
});
await control('C03',()=>{
 check(admission.validateManifest(runtimeSeal));
 const filename=jsonFile('bounded.json','{}'),expected=pin(filename);check(admission.small(filename,expected).equals(Buffer.from('{}')));
 rejects(()=>admission.small(filename,{...expected,sha256:'0'.repeat(64)}),/PIN_BYTES/);
 rejects(()=>admission.small(filename,{...expected,mode:420}),/PIN_METADATA/);
 rejects(()=>admission.small(filename,{...expected,bytes:1048577}),/PIN_METADATA/);
 rejects(()=>admission.small(scratch,{...expected}),/PIN_METADATA/);
 const malformed=jsonFile('malformed.json','not-json'),malformedPin=pin(malformed);let parsed=false;rejects(()=>{const bytes=admission.small(malformed,{...malformedPin,sha256:'0'.repeat(64)});parsed=true;JSON.parse(bytes);},/PIN_BYTES/);check(!parsed);
 const names=new Set(runtimeSeal.files.filter(item=>item.path.endsWith('.mjs')).map(item=>item.path));
 const builtin=new Set(['node:fs','node:path','node:crypto','node:process','node:url','node:child_process']);
 for(const item of runtimeSeal.files.filter(item=>item.path.endsWith('.mjs'))){const module=new vm.SourceTextModule(admitted(materialized+'/'+item.path,item).toString('utf8'));for(const dependency of module.dependencySpecifiers)check(builtin.has(dependency)||(dependency.startsWith('./')&&names.has(dependency.slice(2))));}
 const changed=clone(runtimeSeal);changed.files[0].path='../escape';rejects(()=>admission.validateManifest(changed),/SEAL_PATH/);
 const modulePin=runtimeSeal.files.find(item=>item.path==='entry.mjs');rejects(()=>admission.pinned(materialized+'/entry.mjs',{...modulePin,sha256:'0'.repeat(64)}),/PIN_HASH/);
 const nodePin=read('TOOLS.json').toolPins[0];rejects(()=>admission.pinned(nodePin.path,{...nodePin,bytes:nodePin.bytes+1}),/PIN_METADATA/);
});
await control('C04',()=>{
 const expected={presealSha256:'1'.repeat(64),requestsSha256:'2'.repeat(64)},receipt={schema:'ere-capture-independent-acceptance-v1',decision:'ACCEPT',profile:'ere-capture-reference-v1',...expected,reviewer:'SYNTHETIC_DATA_NOT_AUTHORITY',reviewCommit:'3'.repeat(40)};
 check(admission.validateReview(receipt,expected));
 for(const value of [null,{...receipt,profile:'functional-old37'},{...receipt,presealSha256:'4'.repeat(64)},{...receipt,extra:true}])rejects(()=>admission.validateReview(value,expected));
 const getter=clone(receipt);Object.defineProperty(getter,'reviewer',{get(){throw Error('GETTER_MUST_NOT_RUN');},enumerable:true});rejects(()=>admission.validateReview(getter,expected),/DATA_PROPERTY/);
 const foreign=vm.runInNewContext('JSON.parse(text)',{text:JSON.stringify(receipt)});check(admission.validateReview(foreign,expected));
});
await control('C05',()=>{
 const grant={schema:'ere-capture-root-grant-v1',decision:'GO',profile:'ere-capture-reference-v1',deadlineEpochMs:100,startupScope:admission.startupScope,preseal:{},independentReviewReceipt:{},preprovision:{},limits:{}};
 check(admission.validateGrant(grant,99));rejects(()=>admission.validateGrant(grant,100),/GRANT_CONTENT/);
 let now=100,writes=0,closes=0;const operations={openSync(){return 9;},writeFileSync(){writes++;},fsyncSync(){},closeSync(){closes++;}};
 const storage=new Storage(scratch,{deadline:100},{now:()=>now,terminalOperations:operations});check(storage.terminal({synthetic:true}));check(writes===1&&closes===1&&storage.terminalState.qualified);
 const expired=new Storage(scratch,{deadline:100},{now:()=>101,terminalOperations:operations});rejects(()=>expired.terminal({}),/FINALIZATION_DEADLINE/);check(writes===1);
 const late=new Storage(scratch,{deadline:100},{now:()=>now,terminalOperations:{...operations,closeSync(){now=101;}}});rejects(()=>late.terminal({}),/FINALIZATION_DEADLINE/);check(late.terminalState.closed&&!late.terminalState.qualified&&late.terminalState.late);
 let observations=0;const sink={checkTime(){if(now>100)throw Error('FINALIZATION_DEADLINE');},record(){observations++;now=101;}};now=100;rejects(()=>creditObservation(eligible(),sink,0),/FINALIZATION_DEADLINE/);check(observations===1);
 for(const reason of [false,0,null,undefined]){let caught=false,actual,closeCount=0;const owner=new Storage(scratch,{deadline:100},{now:()=>99,terminalOperations:{openSync(){return 9;},writeFileSync(){throw reason;},fsyncSync(){throw Error('UNREACHABLE');},closeSync(){closeCount++;if(closeCount===1)throw Error('SECONDARY_CLOSE');}}});try{owner.terminal({});}catch(error){caught=true;actual=error;}check(caught&&Object.is(actual,reason)&&closeCount===2&&!owner.terminalState.qualified&&owner.terminalState.closed&&owner.terminalState.secondary.length===1);}
 check(!deadlineAdmission(100,6000,3000,2000,1000,0));check(deadlineAdmission(0,66000));
});
await control('C06',()=>{
 const sha='a'.repeat(64),resolved=clone(template.parameters);resolved.cmd=resolved.cmd.replace('ROOT_APPROVED_GRANT_SHA256',sha);check(admission.resolveApproval(template,resolved,sha));
 for(const changed of [{...resolved,cmd:resolved.cmd+' '},{...resolved,prefix_rule:['node']},{...resolved,login:true},{...resolved,sandbox_permissions:'use_default'}])rejects(()=>admission.resolveApproval(template,changed,sha));
 const duplicate=clone(template);duplicate.parameters.cmd+=' ROOT_APPROVED_GRANT_SHA256';rejects(()=>admission.resolveApproval(duplicate,resolved,sha),/SLOT_COUNT/);
 check(!runtimeSeal.files.some(item=>['GO.json','PREPROVISION.json','REVIEW-ACCEPTANCE.json','PRESEAL.json'].includes(item.path)));check(!fs.existsSync(materialized+'/GO.json'));
});
await control('C07',()=>{
 const observations=[];
 for(const content of ['', 'ABCDE']){
  const filename=jsonFile(content.length?'descriptor-full.data':'descriptor-empty.data',content),stat=fs.lstatSync(filename);
  for(const [label,flag] of [['readwrite',fs.constants.O_RDWR],['readonly',fs.constants.O_RDONLY],['writeonly',fs.constants.O_WRONLY]]){
   const fd=fs.openSync(filename,flag|fs.constants.O_NOFOLLOW);let readCalls=0,writeCalls=0;const reads=[];
   try{
    const operations={fstatSync(){return fs.fstatSync(fd);},lstatSync(){return fs.lstatSync(filename);},realpathSync(value){return value;},readSync(unused,buffer,offset,length,position){readCalls++;check(length===1&&position===0);const amount=fs.readSync(fd,buffer,offset,length,position);reads.push({length,position,amount});return amount;},writeSync(unused,...args){writeCalls++;return fs.writeSync(fd,...args);}};
    if(label==='readwrite'){
     if(content.length){const first=Buffer.alloc(1);check(fs.readSync(fd,first,0,1,null)===1&&first[0]===65);}
     check(admission.validateOuter('/synthetic','stdout',1,operations).ino===stat.ino);
     check(readCalls===1&&writeCalls===1&&reads[0].amount===(content.length?1:0));
     if(content.length){const next=Buffer.alloc(1);check(fs.readSync(fd,next,0,1,null)===1&&next[0]===66);}
     for(const override of [{lstatSync(){return {...stat,isFile:()=>true,isSymbolicLink:()=>false,ino:stat.ino+1};}},{fstatSync(){return {...stat,isFile:()=>true,mode:420};}},{lstatSync(){return {...stat,isFile:()=>false,isSymbolicLink:()=>false};}},{realpathSync(){return '/other';}}]){const beforeRead=readCalls,beforeWrite=writeCalls;rejects(()=>admission.validateOuter('/synthetic','stdout',1,{...operations,...override}),/OUTER_FD_BINDING/);check(readCalls===beforeRead&&writeCalls===beforeWrite);}
     const beforeRead=readCalls,beforeWrite=writeCalls;rejects(()=>admission.validateOuter('/synthetic','stdout',1,{...operations,fstatSync(){throw Object.assign(Error('REFUSED_DESCRIPTOR'),{code:'EBADF'});}}),/REFUSED_DESCRIPTOR/);check(readCalls===beforeRead&&writeCalls===beforeWrite);
    }else{
     let rejected=false,code;
     try{admission.validateOuter('/synthetic','stdout',1,operations);}catch(error){rejected=true;code=error.code;}
     check(rejected&&code==='EBADF');check(readCalls===1&&writeCalls===(label==='readonly'?1:0));
     if(label==='readonly')check(reads.length===1&&reads[0].amount===(content.length?1:0));else check(reads.length===0);
    }
    observations.push({contentBytes:content.length,openRole:label,readCalls,writeCalls,reads,descriptorClosedInFinally:true});
   }finally{fs.closeSync(fd);}
  }
  check(fs.readFileSync(filename).equals(Buffer.from(content)));
 }
 const parents=['/synthetic','/synthetic/outer','/synthetic/cases','/synthetic/captures'].map(filename=>({path:filename,device:'1',inode:'2',mode:448}));
 const operations={lstatSync(){return {dev:1n,ino:2n,mode:448n,isDirectory:()=>true,isSymbolicLink:()=>false};},realpathSync:value=>value};
 check(admission.validateProvision({parents},'/synthetic',operations));
 rejects(()=>admission.validateProvision({parents:parents.slice(1)},'/synthetic',operations),/PROVISION_MEMBERSHIP/);
 console.log(JSON.stringify({event:'C07_DESCRIPTOR_OBSERVATIONS',observations,oldThreeAssertionsCompleted:true,emptyReadIsEOF:true,cursorProof:'nonempty next sequential byte remains B'}));
});
await control('C08',()=>{
 for(const phase of ['none','flush','size','hash','close']){let closeCalls=0;const operations={fsyncSync(){if(phase==='flush')throw Error('FLUSH');},fstatSync(){return {size:phase==='size'?65537:1,ino:1,nlink:1,mtimeMs:1,isFile:()=>true};},readSync(unused,buffer){if(phase==='hash')throw Error('READ_HASH');buffer[0]=65;return 1;},closeSync(){closeCalls++;if(phase==='close'&&closeCalls===1)throw Error('CLOSE');}};const result=finalizeCaptures([{name:'stdout',fd:1,ino:1},{name:'stderr',fd:2,ino:1}],65536,operations);check(result.success===(phase==='none'));check(closeCalls===(phase==='close'?3:2));check(result.captures.length===2);if(phase!=='none')check(result.errors.length>0);}
});
await control('C09',()=>{
 const actualTerm=1007,times=cleanupTimes(actualTerm);check(times.termAt===1007&&times.killAt===3007&&times.endAt===4007);
 const row=eligible();check(completion(row));for(const changed of [{...row,exit:false},{...row,close:false},{...row,group:{state:'present'}},{...row,group:{state:'unknown'}},{...row,signal:'SIGKILL'},{...row,stop:'TIMEOUT'}])check(!completion(changed));
 const source=admitted(materialized+'/lifecycle.mjs',runtimeSeal.files.find(item=>item.path==='lifecycle.mjs')).toString('utf8');check(source.includes('cleanupTimes(row.termAttemptAt??firstStop,termMs,killMs)'));check(source.includes('row.exit&&row.close&&row.group.state'));check(source.includes("send('SIGKILL');observe()"));
});
await control('C10',()=>{
 check(admission.validateStartupScope(template.initialToolShellStartup.scope));rejects(()=>admission.validateStartupScope('login:false means clean'),/STARTUP_SCOPE/);
 for(const mutation of [env=>env.BASH_ENV='/not-read',env=>env.ENV='/not-read',env=>env.PATH='/usr/bin',env=>env.HOME='/ambient',env=>env['BASH_FUNC_test%%']='() { :; }']){const value=clone(requests);mutation(value[0].environment);rejects(()=>admission.validateCohort(cohort,value,runtimeRoot));}
 const dirname=scratch+'/empty-path';fs.mkdirSync(dirname,{mode:0o700});check(fs.readdirSync(dirname).length===0);check(requests.every(request=>Object.keys(request.environment).join(',')==='LC_ALL,LANG,TZ,HOME,TMPDIR,PATH'));
});
await control('C11',()=>{
 function row(status,slots){const fields=['EREOBS1','N01',String(status),String(slots.filter(slot=>slot.present).length)];for(let index=0;index<4;index++){const slot=slots[index]??{present:false,value:''};fields.push(String(index),slot.present?'1':'0',slot.value);}const bytes=Buffer.from(fields.join('\0')+'\0');return {id:'N01',status,capture:[{name:'stdout',hash:true,base64:bytes.toString('base64'),sha256:digest(bytes)}]};}
 for(const status of [0,1,2]){const value=row(status,[{present:true,value:''},{present:true,value:'a b'},{present:false,value:''}]);const decoded=decodeObservation(value);check(decoded.regexStatus===status&&decoded.cardinality===2&&decoded.slots[0].shellSlotPresent&&decoded.slots[0].bytes===0&&!decoded.slots[2].shellSlotPresent);check(decoded.hiddenNativeSpans==='UNOBSERVABLE'&&decoded.nativeParticipationFromEmptyString==='NOT_INFERRED');}
 const value=row(0,[]);check(decodeObservation(value).cardinality===0);const wrong=clone(value);wrong.status=1;rejects(()=>decodeObservation(wrong),/EXIT_STATUS/);const badHash=clone(value);badHash.capture[0].sha256='0'.repeat(64);rejects(()=>decodeObservation(badHash),/HASH/);
 for(const mutate of [bytes=>bytes.subarray(0,bytes.length-1),bytes=>Buffer.from(bytes.toString().replace('N01','N02')),bytes=>{const fields=bytes.toString().split('\0');fields[3]='5';return Buffer.from(fields.join('\0'));}]){const changed=clone(value),bytes=mutate(Buffer.from(changed.capture[0].base64,'base64'));changed.capture[0].base64=bytes.toString('base64');changed.capture[0].sha256=digest(bytes);rejects(()=>decodeObservation(changed));}
 rejects(()=>decodeObservation(row(0,[{present:false,value:'not-empty'}])),/UNSET_VALUE/);
});
await control('C12',()=>{
 const ledger=new ManagedLedger(2,2);ledger.enter('control');ledger.confirm('control');check(ledger.active===2);rejects(()=>ledger.enter('control'),/CAP/);ledger.retire(true);check(ledger.active===1&&ledger.activeConfirmed===1);rejects(()=>ledger.retire(),/UNDERFLOW/);
 const storage=new Storage(scratch,{capture:1048576,work:1048576,deadline});const before=storage.scan();jsonFile('new-namespace-entry.data','x');const after=storage.scan();check(after.entries===before.entries+1&&after.bytes===before.bytes+1);
 const tiny=new Storage(scratch,{capture:0,work:0,deadline});rejects(()=>tiny.scan(),/STORAGE_CAP/);rejects(()=>storage.admit(262145),/BEFORE_WRITE_STORAGE_CAP/);
 const row=eligible();row.group={state:'unknown'};rejects(()=>creditObservation(row,{checkTime(){},record(){throw Error('NO_CREDIT');}},0),/INELIGIBLE/);
});
for(const item of seal.files)admitted(root+'/'+item.path,item);
const remaining=fs.readdirSync(scratch);for(const name of remaining){const filename=scratch+'/'+name,stat=fs.lstatSync(filename);assert(!stat.isSymbolicLink());if(stat.isDirectory()){assert.equal(fs.readdirSync(filename).length,0);fs.rmdirSync(filename);}else fs.unlinkSync(filename);}fs.rmdirSync(scratch);
assert(Date.now()<=deadline);const outcome={schema:'ere-preflight-controls-v1',started,finished:Date.now(),controlSealSha256:process.argv[2],results,passed:results.filter(row=>row.status==='PASS').length,failed:results.filter(row=>row.status==='FAIL').length,assertions,fixtureChildren:0,targetChildren:0,nativeObservations:0,entryImported:false,allDescriptorsClosed:true,scratchRemoved:true,finalIntegrity:true,actualNativeStatus:'12_UNRUN'};
fs.writeFileSync(own+'/CONTROL-RESULT.json',JSON.stringify(outcome,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(outcome));process.exitCode=outcome.failed?1:0;
