import {test}from'node:test';import assert from'node:assert/strict';import {native}from'../dist/native.js';
const create=()=>new native.UploadTransaction({workspace:'/workspace',upload:'/upload',archive:'/upload/workspace.tar'},['nested/😀.bin']);
test('native upload effects preserve UTF16 paths and expose no host callback or buffer references',()=>{
 const tx=create(),effects=[];for(let i=0;i<32;i++){const effect=tx.next();effects.push(effect);if(effect.kind==='done'){assert.equal(effect.success,true);break;}assert.equal(tx.advance(true,true),null);}assert.equal(effects.at(-1).kind,'done');assert.deepEqual(effects.find(effect=>effect.kind==='writeFile'),{kind:'writeFile',path:'/workspace.upload-tmp',relative:'nested/😀.bin',index:0});assert.deepEqual(effects.filter(effect=>effect.kind==='rename').map(({source,target})=>[source,target]),[['/workspace','/workspace.upload-backup'],['/workspace.upload-tmp','/workspace'],['/upload/workspace.tar.upload-tmp','/upload/workspace.tar']]);assert.equal(tx.advance(false,false),null);
 const failed=create();assert.equal(failed.advance(false,false),'primary');assert.deepEqual(failed.next(),{kind:'done',success:false});
});
