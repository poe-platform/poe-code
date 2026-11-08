import fs from 'node:fs';
import assert from 'node:assert/strict';
import {readPinned,hash,pinExecutable,publish} from './auth.mjs';
import {finalize} from './finalization.mjs';
import {finishOwner,wire} from './owner-finalization.mjs';
import {canonicalRoot,assertOwned} from './canonical.mjs';
import {qualifyDirect} from './direct-child.mjs';
import {collect} from './collector-core.mjs';
import {caseArguments} from './profile.mjs';
import {sample} from './package.mjs';
import {validateActivation} from './activation.mjs';
import {preauthRecord} from './preauth.mjs';
process.stderr.write('B35_BOOTSTRAP_CAPTURE_READY\n');
const packet=process.argv[2],seal=JSON.parse(readPinned(packet+'/CONTROL-SEAL.json',JSON.parse(process.argv[3]))),root=seal.work,results=[],ledger={starts:1,maximum:3,active:0,stopped:false,captureBytes:0,captureMaximum:4194304,rows:[]};let primaryPresent=false,primary;
try{
 for(const [name,pin]of Object.entries(seal.files))readPinned(packet+'/'+name,pin);for(const [name,pin]of Object.entries(seal.fixtures))readPinned(name,pin);pinExecutable(seal.node);canonicalRoot(root);if(Date.now()>=seal.deadline)throw Error('CONTROL_DEADLINE');
 const check=(id,callback)=>{callback();results.push({id,kind:'PURE',pass:true});};
 check('D01',()=>assert.equal(canonicalRoot(root),root));
 check('D02',()=>assert.throws(()=>canonicalRoot(root.replace('/private/tmp/','/tmp/')),/CANONICAL_ROOT/));
 check('D03',()=>assert.throws(()=>assertOwned(root,'/tmp'),/OWNED_PATH/));
 check('D04',()=>assert.throws(()=>assertOwned(root,root+'/../escape'),/PATH_COMPONENT/));
 check('D05',()=>{const bytes=readPinned(packet+'/fixture-package.json.data',seal.files['fixture-package.json.data']);assert.equal(hash(bytes),seal.packageBoundary.sha256);});
 check('D06',()=>assert.equal(hash(readPinned(packet+'/finalization.mjs',seal.files['finalization.mjs'])),seal.finalizationSha256));
 check('D07',()=>assert.equal(qualifyDirect({primaryPresent:false,forced:false,exit:true,close:true,stdoutEOF:true,stderrEOF:true,capturesQualified:true,knownOutstanding:1}),false));
 for(const [id,reason]of [['D08',undefined],['D09',null],['D10',false],['D11',0]])check(id,()=>{let called=0;const state=finalize({primaryPresent:true,primary:reason,census(){throw false;},publish(){called++;throw 0;}});assert.equal(state.primaryPresent,true);assert.equal(state.primary,reason);assert.equal(state.secondary.length,2);assert.equal(state.secondary[0].reason,false);assert.equal(state.secondary[1].reason,0);assert.equal(called,1);});
 check('D12',()=>{for(const kind of ['fsync','close']){let closed=0,published=0;const ops={fsyncSync(){if(kind==='fsync')throw false;},fstatSync(){return {size:0,isFile:()=>true};},readSync(){return 0;},closeSync(){closed++;if(kind==='close')throw 0;}};const state=finishOwner({initial:{primaryPresent:true,primary:undefined},captures:[{path:'DATA',fd:1}],operations:ops,census(){throw null;},publish(){published++;throw 'publication';}});assert.equal(state.primaryPresent,true);assert.equal(state.primary,undefined);assert.equal(closed,1);assert.equal(published,1);assert.equal(state.secondary.length,3);assert.equal(state.secondary[0].reason,kind==='fsync'?false:0);assert.equal(state.secondary[1].reason,null);assert.equal(state.secondary[2].reason,'publication');}const state=finalize({primaryPresent:false,primary:undefined,census(){throw 0;},publish(){throw false;}});assert.equal(state.primary,0);assert.equal(state.secondary[0].reason,false);});

 const expected=seal.activationExpected,valid=seal.validGrant,review=seal.validReview;
 const rejects=grant=>assert.throws(()=>validateActivation(grant,review,expected));
 check('D13',()=>{for(const field of ['issuedAtEpochMs','latestStartEpochMs','expiresEpochMs']){const missing={...valid};delete missing[field];rejects(missing);for(const value of [undefined,null,false,true,'1000','not-a-time'])rejects({...valid,[field]:value});}});
 check('D14',()=>{for(const field of ['issuedAtEpochMs','latestStartEpochMs','expiresEpochMs'])for(const value of [NaN,Infinity,-Infinity,-1,0.5,Number.MAX_SAFE_INTEGER+1])rejects({...valid,[field]:value});});
 check('D15',()=>{rejects({...valid,issuedAtEpochMs:valid.latestStartEpochMs+1});rejects({...valid,latestStartEpochMs:valid.latestStartEpochMs+1});rejects({...valid,expiresEpochMs:1});rejects({...valid,issuedAtEpochMs:0});});
 check('D16',()=>{assert.throws(()=>validateActivation(valid,review,{...expected,now:valid.latestStartEpochMs+1}));assert.throws(()=>validateActivation(valid,review,{...expected,started:valid.issuedAtEpochMs-1}));assert.throws(()=>validateActivation(valid,review,{...expected,now:expected.started-1}));});
 check('D17',()=>{assert.equal(validateActivation(valid,review,expected).duration,1500000);rejects({...valid,extra:true});rejects({...valid,calls:'54'});const accessor={...valid};Object.defineProperty(accessor,'expiresEpochMs',{get(){throw Error('GETTER_MUST_NOT_RUN');},enumerable:true});assert.throws(()=>validateActivation(accessor,review,expected),/AUTH_SCHEMA/);});
 check('D18',()=>{for(const [reason,record]of [[undefined,{kind:'undefined'}],[null,{kind:'null'}],[false,{kind:'boolean',value:false}],[0,{kind:'number',value:0}]]){const wire=JSON.parse(JSON.stringify(preauthRecord(true,reason,[{phase:'control',reason}])));assert.deepEqual(wire.primary,record);assert.deepEqual(wire.secondary[0].reason,record);assert.equal(wire.primaryPresent,true);assert.equal(wire.secondary[0].present,true);}});
 for(const item of seal.roles){const role=JSON.parse(readPinned(item.rolePath,item.rolePin));const child=await collect({id:role.id,node:seal.node,args:caseArguments(role),cwd:role.app,env:item.env,capture:item.capture,timeoutMs:5000,bodyDeadline:seal.deadline-10000,finalDeadline:seal.deadline},ledger);if(!child.row.qualified)throw Error('CONTROL_RETIREMENT_UNKNOWN');const out=child.row.captures.find(row=>row.kind==='stdout'),err=child.row.captures.find(row=>row.kind==='stderr');assert.equal(child.row.status,0);assert.equal(out.base64,item.expectedStdoutBase64);assert.equal(err.base64,item.expectedStderrBase64);const trace=fs.readFileSync(role.trace);if(trace.length>65536)throw Error('TRACE_BOUND');const events=trace.toString().trim().split('\n').map(row=>JSON.parse(row));assert.equal(events.filter(row=>row.event==='permission-admitted').length,1);assert.equal(events.filter(row=>row.event==='synchronous-hooks-installed').length,1);results.push({id:role.id,kind:'HARMLESS_NODE',pass:true,trace:{bytes:trace.length,sha256:hash(trace),events},lifecycle:child.row});}
}catch(reason){primaryPresent=true;primary=reason;}
const state=finalize({primaryPresent,primary,census:()=>sample(root,201326592),publish(state){publish(root+'/capture/CONTROL-RESULT.json',Buffer.from(JSON.stringify({results,ledger,state:wire(state)},null,2)+'\n'),seal.deadline);}});process.stdout.write(JSON.stringify({results:results.map(row=>({id:row.id,kind:row.kind,pass:row.pass})),ledger,state:wire(state)})+'\n');if(state.primaryPresent)process.exitCode=1;
