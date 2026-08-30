import assert from 'node:assert/strict';
import {wire,finishOwner} from './frozen/owner-finalization.mjs';
import {canonicalRoot,assertOwned} from './frozen/canonical.mjs';
import {caseArguments} from './frozen/profile.mjs';
import {readPinned} from './frozen/auth.mjs';
import {validateActivation} from './frozen/activation.mjs';
export function replayPrior(state,novel){
const check=(id,body)=>{try{body();novel.push({id,pass:true});}catch(error){novel.push({id,pass:false,error:String(error)});}};
const valid=()=>({started:state.activationExpected.started,grant:{...structuredClone(state.validGrant),work:state.work},review:structuredClone(state.validReview)});
const refuses=(grant,review,work,started)=>{try{validateActivation(grant,review,{...state.activationExpected,work,started});return false;}catch(error){if(!error.message.startsWith('AUTH_'))throw error;return true;}};
check('N01',()=>{const value=valid();assert.equal(refuses(value.grant,value.review,state.work,value.started),false);});
check('N02',()=>{const value=valid();delete value.grant.latestStartEpochMs;delete value.grant.expiresEpochMs;assert.equal(refuses(value.grant,value.review,state.work,value.started),true);});
check('N03',()=>{const value=valid();value.grant.latestStartEpochMs='not-a-time';value.grant.expiresEpochMs='not-a-time';assert.equal(refuses(value.grant,value.review,state.work,value.started),true);});
check('N04',()=>{for(const change of [value=>{value.grant.decision='PENDING';},value=>{value.grant.preseal='wrong';},value=>{value.grant.latestStartEpochMs=0;},value=>{value.grant.expiresEpochMs=0;}]){const value=valid();change(value);assert.equal(refuses(value.grant,value.review,state.work,value.started),true);}});
check('N05',()=>{for(const reason of [undefined,null,false,0]){const value=wire({primaryPresent:true,primary:reason,secondaryPresent:false,secondary:[],sampledWorkPresent:false,publicationAttempted:false,publicationSucceeded:false});assert.equal(value.primaryPresent,true);assert.equal(value.primary.kind,reason===null?'null':typeof reason);if(reason===false||reason===0)assert.equal(value.primary.value,reason);}});
check('N06',()=>{const seen=[];const reason={tag:'primary'};const value=finishOwner({initial:{primaryPresent:true,primary:reason},captures:[{path:'a',fd:1},{path:'b',fd:2}],operations:{fsyncSync(fd){seen.push(['flush',fd]);throw undefined;},closeSync(fd){seen.push(['close',fd]);throw false;}},census(){throw null;},publish(){throw 0;}});assert.equal(value.primary,reason);assert.deepEqual(seen,[['flush',1],['close',1],['flush',2],['close',2]]);assert.deepEqual(value.secondary.map(row=>row.reason),[undefined,false,undefined,false,null,0]);});
check('N07',()=>{assert.equal(canonicalRoot(state.work),state.work);for(const name of [state.work+'-sibling/a',state.work+'/../a',state.work+'/./a'])assert.throws(()=>assertOwned(state.work,name));});
check('N08',()=>{const item=state.roles[0];const role=JSON.parse(readPinned(item.rolePath,item.rolePin));const args=caseArguments(role);assert.equal(args[0],'--permission');assert.ok(!args.some(arg=>arg==='--allow-worker'||arg==='--allow-child-process'));for(const key of ['workerPermission','childProcessPermission','loaderThreads'])assert.throws(()=>caseArguments({...role,[key]:1}));});

}
