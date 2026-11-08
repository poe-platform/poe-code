import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as reference from '../../config-mutations/dist/index.js';
test('additive config package exposes the current SDK root API',async()=>{
 const rust=await import('@poe-code/config-mutations-rust');
 assert.deepEqual(Object.keys(rust).sort(),Object.keys(reference).sort());
 assert.equal(rust.renderTemplate('{{name}} {{#items}}[{{.}}]{{/items}}',{name:'<K>&',items:['🦀']}),reference.renderTemplate('{{name}} {{#items}}[{{.}}]{{/items}}',{name:'<K>&',items:['🦀']}));
 for(const value of [null,undefined,0,'value',[],new Date(),{},Object.create(null)])assert.equal(rust.isConfigObject(value),reference.isConfigObject(value));
});
test('root filesystem helpers preserve own-code boundaries, lazy code getters and IO receivers',async()=>{
 const rust=await import('@poe-code/config-mutations-rust');
 const coded=Object.assign(Error('missing'),{code:'ENOENT'}),callable=Object.assign(()=>{},{code:'ENOENT'});
 for(const error of [null,undefined,0,'ENOENT',coded,{code:'ENOENT'},Object.create({code:'ENOENT'}),callable,{code:'EPERM'}])assert.equal(rust.isNotFound(error),reference.isNotFound(error));
 for(const fn of [rust,reference]){const events=[],failure=Error('code getter'),error={get code(){events.push('code');throw failure;}};assert.throws(()=>fn.isNotFound(error),e=>e===failure);assert.deepEqual(events,['code']);
  const fs={async readFile(path,encoding){assert.equal(this,fs);assert.equal(path,'target');assert.equal(encoding,'utf8');return 'content';},async stat(path){assert.equal(this,fs);assert.equal(path,'target');return {};}};
  assert.equal(await fn.readFileIfExists(fs,'target'),'content');assert.equal(await fn.pathExists(fs,'target'),true);
  fs.readFile=fs.stat=async()=>{throw coded;};assert.equal(await fn.readFileIfExists(fs,'target'),null);assert.equal(await fn.pathExists(fs,'target'),false);
  fs.readFile=fs.stat=async()=>{throw failure;};await assert.rejects(fn.readFileIfExists(fs,'target'),e=>e===failure);await assert.rejects(fn.pathExists(fs,'target'),e=>e===failure);
 }
});
test('root timestamp helper keeps host clock hooks and extended ISO years',async()=>{
 const rust=await import('@poe-code/config-mutations-rust'),realDate=Date;
 try{for(const instant of ['2026-09-20T12:34:56.789Z','+010000-01-01T00:00:00.000Z','-000001-01-01T00:00:00.000Z']){globalThis.Date=class extends realDate{constructor(){super(instant);}};assert.equal(rust.createTimestamp(),reference.createTimestamp());}}
 finally{globalThis.Date=realDate;}
});
test('unknown mutations keep default SDK observer details and fail before target access',async()=>{
 const rust=await import('@poe-code/config-mutations-rust');
 for(const fn of [rust,reference]){const events=[],mutation={kind:'unknown',get target(){throw Error('unused target');}};await assert.rejects(fn.runMutations([mutation],{homeDir:'/home/k',fs:{},observers:{onStart(details){events.push(details);}}}),e=>e.message==='Unknown mutation kind: unknown');assert.deepEqual(events,[{kind:'unknown',label:'unknown'}]);}
});
