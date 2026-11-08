import test from 'node:test';import assert from 'node:assert/strict';import {PassThrough} from 'node:stream';
import {runPoeCommand,createPoeCommandSession} from '../dist/index.js';import {native} from '../dist/native.js';
function state(){const entries=new Map();return {entries,jobs:{async put(entry){entries.set(entry.id,entry);},async update(id,patch){const value=entries.get(id);if(!value)return null;const next={...value,...patch,id};entries.set(id,next);return next;},async remove(id){entries.delete(id);},async get(id){return entries.get(id)??null;},async list(){return [...entries.values()];}},templates:{async get(){return null;},async put(){},async remove(){},async list(){return [];}}};}
function spec(){return {cwd:'/repo',runtime:{type:'host',build_args:{},mounts:[]},env:{},uploadIgnoreFiles:[],jobLabel:{tool:'mock',argv:['mock','arg']},execution:{wrapForLogTee:false,captureOutput:true}};}
test('native ULID matches BigInt base32 encoding including truncated high words and negatives',()=>{
 const alphabet='0123456789ABCDEFGHJKMNPQRSTVWXYZ',encode=(input,size)=>{let out='';for(let i=0;i<size;i++){out=alphabet[Number(input&31n)]+out;input>>=5n;}return out;};
 for(const time of [0n,1n,-1n,2n**50n-1n,2n**64n+5n,-(2n**80n+7n),2n**200n+123n])for(let seed=0;seed<32;seed++){
 const entropy=Buffer.from(Array.from({length:10},(_,i)=>(i*97+seed*31)&255));let value=0n;for(const byte of entropy)value=value<<8n|BigInt(byte);
 assert.equal(native.harnessUlid(time,entropy),encode(time,10)+encode(value,16));
 }
 assert.throws(()=>native.harnessUlid(0n,Buffer.alloc(9)),/ten entropy/);
 const lifecycle=new native.NativeHarnessCommand();assert.equal(lifecycle.failureAction,'remove');assert.throws(()=>lifecycle.terminal(),/must be running/);assert.equal(lifecycle.failureAction,'remove');lifecycle.running();assert.equal(lifecycle.failureAction,'lost');lifecycle.terminal();assert.equal(lifecycle.failureAction,'none');
});
test('sync execution records terminal state and reuses a session environment',async()=>{
 const storage=state(),events=[],download={files:1,bytes:4,conflicts:[]};let opened=0;
 const env={id:'mock-env',job:null,async uploadWorkspace(){events.push('upload');return {files:0,bytes:0,skipped:[]};},async downloadWorkspace(){events.push('download');return download;},exec(){const stdout=new PassThrough();const result=Promise.resolve().then(()=>{stdout.end('done');return {exitCode:0};});return {pid:null,stdin:null,stdout,stderr:null,result,kill(){}};},async close(){events.push('close');}};
 const factory={type:'host',async open(){opened++;return env;}};
 const result=await runPoeCommand({factory,openSpec:spec(),detach:false,state:storage});assert.equal(result.exitCode,0);assert.equal(result.stdout,'done');assert.equal((await storage.jobs.list())[0].status,'exited');
 const session=createPoeCommandSession({factory,state:storage});await session.run(spec());await session.run(spec());await session.close();await session.close();assert.equal(opened,2);assert.equal(events.filter(event=>event==='upload').length,2);assert.equal(events.filter(event=>event==='close').length,2);assert.equal((await storage.jobs.list()).length,3);
});
test('opening failures remove pending jobs and preserve thrown identity',async()=>{
 const storage=state(),error={sentinel:true};await assert.rejects(runPoeCommand({factory:{type:'host',async open(){throw error;}},openSpec:spec(),detach:false,state:storage}),value=>value===error);assert.equal(storage.entries.size,0);
});
