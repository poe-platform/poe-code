import assert from 'node:assert/strict';
import {readPinned,hash} from './frozen/auth.mjs';
import {finalize} from './frozen/finalization.mjs';
import {finishOwner} from './frozen/owner-finalization.mjs';
import {canonicalRoot,assertOwned} from './frozen/canonical.mjs';
import {qualifyDirect} from './frozen/direct-child.mjs';
import {validateActivation} from './frozen/activation.mjs';
import {preauthRecord} from './frozen/preauth.mjs';
export function replay(root,seal,packet,results){
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

}
