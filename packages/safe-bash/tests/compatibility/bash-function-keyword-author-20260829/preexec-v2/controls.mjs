import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {readPinned,hash,pinExecutable,publish} from './auth.mjs';
import {finalize} from './finalization.mjs';
import {finishOwner,wire} from './owner-finalization.mjs';
import {canonicalRoot,validateCanonicalRole,assertOwned} from './canonical.mjs';
import {PROFILE,caseArguments} from './profile.mjs';
import {runDirect,qualifyDirect} from './direct-child.mjs';
import {sample} from './package.mjs';
const packet=process.argv[2],sealPin=JSON.parse(process.argv[3]),seal=JSON.parse(readPinned(packet+'/CONTROL-PRESEAL.json',sealPin));
const root=seal.work,deadline=seal.deadline,results=[];const ledger={starts:1,maximum:3,active:0,stopped:false,captureBytes:0,captureMaximum:4194304,rows:[]};
let primaryPresent=false,primary;
try{
 for(const [name,pin]of Object.entries(seal.files))readPinned(packet+'/'+name,pin);pinExecutable(seal.node);canonicalRoot(root);if(Date.now()>=deadline)throw Error('CONTROL_DEADLINE');
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
 for(const item of seal.roles){if(Date.now()>=deadline)throw Error('CONTROL_DEADLINE');const role=JSON.parse(readPinned(item.rolePath,item.rolePin));validateCanonicalRole(root,role,item.env);const child=await runDirect({id:role.id,node:seal.node,args:caseArguments(role),cwd:role.app,env:item.env,capture:item.capture,timeoutMs:5000,bodyDeadline:deadline-10000,finalDeadline:deadline},ledger);if(!child.row.qualified)throw Error('CONTROL_RETIREMENT');const stdout=child.row.captures.find(row=>row.kind==='stdout'),stderr=child.row.captures.find(row=>row.kind==='stderr');if(child.row.status!==0||stdout.base64!==Buffer.from('B35_CANONICAL_READY\n').toString('base64')||stderr.bytes!==0)throw Error('CONTROL_STARTUP_STOP');const stat=fs.lstatSync(role.trace);if(!stat.isFile()||stat.size>65536)throw Error('TRACE_LIMIT');const bytes=fs.readFileSync(role.trace);ledger.captureBytes+=bytes.length;const events=bytes.toString().trim().split('\n').map(row=>JSON.parse(row));assert.equal(events.filter(row=>row.event==='permission-admitted').length,1);assert.equal(events.filter(row=>row.event==='synchronous-hooks-installed').length,1);results.push({id:role.id,kind:'HARMLESS_NODE',pass:true,rolePin:item.rolePin,trace:{bytes:bytes.length,sha256:hash(bytes),events},lifecycle:child.row});}
}catch(reason){primaryPresent=true;primary=reason;}
const terminal=finalize({primaryPresent,primary,census:()=>sample(root,201326592),publish(state){publish(root+'/capture/CONTROLS.json',Buffer.from(JSON.stringify({results,ledger,finalization:wire(state)},null,2)+'\n'),deadline);}});
process.stdout.write(JSON.stringify({results:results.map(row=>({id:row.id,kind:row.kind,pass:row.pass})),ledger,finalization:wire(terminal)})+'\n');if(terminal.primaryPresent)process.exitCode=1;
