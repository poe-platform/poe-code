import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {createHash} from 'node:crypto';
import {ensureSafeRunLogDir,slugifyPlanPath,makeRunLogFileName} from '../dist/index.js';
import {native} from '../dist/native.js';
function slug(value){let out='';for(const char of value){const c=char.charCodeAt(0),unit=c>=65&&c<=90?String.fromCharCode(c+32):c>=97&&c<=122||c>=48&&c<=57||char==='_'?char:'-';if(unit!=='-'||out&&out.at(-1)!=='-')out+=unit;}return out.endsWith('-')?out.slice(0,-1):out;}
test('run filenames match UTC components including extended years and invalid dates',()=>{
 for(const epoch of [0,-62167219200000,-62198755200000,8640000000000000,-8640000000000000,NaN])for(const role of ['Inspector: QA','___','--é😀--','\ud800','BUILD2']){
 const date=new Date(epoch),pad=(n,w)=>String(n).padStart(w,'0');
 const expected=`${date.getUTCFullYear()}${pad(date.getUTCMonth()+1,2)}${pad(date.getUTCDate(),2)}-${pad(date.getUTCHours(),2)}${pad(date.getUTCMinutes(),2)}${pad(date.getUTCSeconds(),2)}-${pad(date.getUTCMilliseconds(),3)}-${slug(role)||'role'}.jsonl`;
 assert.equal(makeRunLogFileName(role,date),expected);
 }
 assert.throws(()=>native.harnessLogFilename('builder',[]),/seven UTC/);
});
test('plan slug retains platform normalization and exact digest with pathological basenames',()=>{
 for(const input of ['/repo/.hidden','/repo/é😀.md','/repo/one/../Plan.MD','./docs/../plan.md','/repo/___','/repo/','']){
 const base=path.basename(input),dot=base.lastIndexOf('.'),label=slug(dot>0?base.slice(0,dot):base)||'plan';
 const digest=createHash('sha256').update(path.normalize(path.isAbsolute(input)?input:path.resolve(input))).digest('hex').slice(0,12);
 assert.equal(slugifyPlanPath(input),`${label}-${digest}`);
 }
});
test('canonical ancestor admission prevents outside writes and preserves host error identity',async()=>{
 const writes=[],state='/home/.poe-code',error={code:'EACCES'};
 const options={homeDir:'/home',runner:'pipeline',planPath:'/repo/plan.md'};
 await assert.rejects(ensureSafeRunLogDir({...options,fs:{async mkdir(target){writes.push(target);},async realpath(target){return target===`${state}/logs/pipeline`?'/outside':target;}}}),/resolves outside/);
 assert.deepEqual(writes,[state,`${state}/logs`]);
 await assert.rejects(ensureSafeRunLogDir({...options,fs:{async mkdir(){},async realpath(){throw error;}}}),e=>e===error);
 writes.length=0;
 const result=await ensureSafeRunLogDir({...options,fs:{async mkdir(target){writes.push(target);},async realpath(target){if(target.startsWith(`${state}/logs/pipeline`))throw {code:'ENOENT'};return target;}}}).catch(e=>e);
 assert.equal(result.code,'ENOENT');assert.equal(writes.length,3);
});
