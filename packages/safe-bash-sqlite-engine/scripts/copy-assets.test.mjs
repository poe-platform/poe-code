import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {createFsFromVolume,Volume} from 'memfs';
import {copySqliteAssets} from './copy-assets.mjs';
function fixture(){
 const files=createFsFromVolume(new Volume());files.mkdirSync('/package/src/native',{recursive:true});files.mkdirSync('/package/dist');
 const artifacts={};
 for(const name of ['native.mjs','native.wasm','callback.wasm','vfs.mjs','node-assets.mjs','LICENSE']){
  const bytes=Buffer.from(name);files.writeFileSync('/package/src/native/'+name,bytes);artifacts[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 }
 for(const name of ['native.d.mts','vfs.d.mts'])files.writeFileSync('/package/src/native/'+name,'export {};');
 files.writeFileSync('/package/src/native/sources.json',JSON.stringify({artifacts}));return {files,artifacts};
}
test('copies authenticated runtime assets and declarations',async()=>{
 const {files}=fixture();const copied=await copySqliteAssets({root:'/package',fileSystem:files});
 assert.equal(copied.length,9);for(const path of copied)assert.deepEqual(files.readFileSync('/package/dist/native/'+path),files.readFileSync('/package/src/native/'+path));
});
test('authenticates every artifact before modifying an output',async()=>{
 const {files}=fixture();files.mkdirSync('/package/dist/native');files.writeFileSync('/package/dist/native/native.mjs','previous');files.writeFileSync('/package/src/native/vfs.mjs','corrupt');
 await assert.rejects(copySqliteAssets({root:'/package',fileSystem:files}),/artifact (size|digest)/);assert.equal(files.readFileSync('/package/dist/native/native.mjs','utf8'),'previous');
});
test('rejects unlisted paths and source/output symlinks',async()=>{
 const {files,artifacts}=fixture();artifacts['../escape']={bytes:1,sha256:'invalid'};files.writeFileSync('/package/src/native/sources.json',JSON.stringify({artifacts}));
 await assert.rejects(copySqliteAssets({root:'/package',fileSystem:files}),/artifact paths/);assert.equal(files.existsSync('/package/dist/native'),false);
 for(const location of ['src','dist']){
  const {files}=fixture();files.writeFileSync('/protected','protected');const path='/package/'+location+'/native/native.mjs';
  if(location==='src')files.unlinkSync(path);else files.mkdirSync('/package/dist/native');files.symlinkSync('/protected',path);
  await assert.rejects(copySqliteAssets({root:'/package',fileSystem:files}));assert.equal(files.readFileSync('/protected','utf8'),'protected');
 }
});
